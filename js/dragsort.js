// ============================================================
//  dragsort.js — 공용 드래그 순서변경 헬퍼 (HTML5 Drag&Drop)
//  DragSort.enable(container, {
//    itemSelector, handleSelector, horizontal, onReorder(idsInNewOrder)
//  })
//  각 아이템은 data-id 를 가져야 함.
// ============================================================
window.DragSort = (function () {
  function getAfter(container, itemSelector, x, y, horizontal) {
    const els = [...container.querySelectorAll(itemSelector + ':not(.dragging)')];
    let closest = { offset: -Infinity, el: null };
    for (const child of els) {
      const box = child.getBoundingClientRect();
      const offset = horizontal ? (x - box.left - box.width / 2) : (y - box.top - box.height / 2);
      if (offset < 0 && offset > closest.offset) closest = { offset, el: child };
    }
    return closest.el;
  }

  function enable(container, opts) {
    if (!container || window.DB && window.DB.READONLY) return;
    const { itemSelector, handleSelector, horizontal = false, onReorder } = opts;
    let dragEl = null;

    container.querySelectorAll(itemSelector).forEach(item => {
      const useHandle = !!handleSelector && item.querySelector(handleSelector);
      item.draggable = !useHandle;
      if (useHandle) {
        const h = item.querySelector(handleSelector);
        h.style.cursor = 'grab';
        h.addEventListener('mousedown', () => { item.draggable = true; });
        item.addEventListener('dragend', () => { item.draggable = false; });
        window.addEventListener('mouseup', () => { item.draggable = false; }, { once: true });
      }
      item.addEventListener('dragstart', (e) => {
        if (useHandle && !item.draggable) return;
        dragEl = item; item.classList.add('dragging');
        e.dataTransfer.effectAllowed = 'move';
        try { e.dataTransfer.setData('text/plain', item.dataset.id || ''); } catch {}
      });
      item.addEventListener('dragend', () => {
        item.classList.remove('dragging');
        if (dragEl) {
          const ids = [...container.querySelectorAll(itemSelector)].map(x => x.dataset.id);
          dragEl = null;
          if (onReorder) onReorder(ids);
        }
      });
    });

    container.addEventListener('dragover', (e) => {
      if (!dragEl) return;
      e.preventDefault();
      const after = getAfter(container, itemSelector, e.clientX, e.clientY, horizontal);
      if (after == null) container.appendChild(dragEl);
      else container.insertBefore(dragEl, after);
    });
  }

  // 스크롤되는 가장 가까운 부모(없으면 문서)
  function scrollParent(el) {
    for (let n = el && el.parentElement; n && n !== document.body; n = n.parentElement) {
      const oy = getComputedStyle(n).overflowY;
      if ((oy === 'auto' || oy === 'scroll') && n.scrollHeight > n.clientHeight + 1) return n;
    }
    return document.scrollingElement || document.documentElement;
  }

  // 여러 칸(예: 견적 차수별 목록) 사이를 오가며 옮길 수 있는 버전.
  // 브라우저 기본 드래그 대신 마우스(포인터)를 직접 따라가므로, 끄는 중에도 휠 스크롤이 되고
  // 화면 위·아래 가장자리로 가져가면 저절로 스크롤된다.
  // opts: itemSelector, handleSelector, ghostSelector(따라다닐 부분, 기본=항목 전체),
  //       dropZoneFor(container) → 그 칸으로 보내는 추가 표적(예: 접힌 차수의 머리줄),
  //       onReorder([{ container, ids }]) — 실제로 자리가 바뀐 경우에만 호출.
  function enableGroup(containers, opts) {
    if (!containers || !containers.length || (window.DB && window.DB.READONLY)) return;
    const { itemSelector, handleSelector, ghostSelector, onReorder, dropZoneFor } = opts;
    const zones = dropZoneFor ? containers.map(c => ({ container: c, zone: dropZoneFor(c) })).filter(z => z.zone) : [];
    const itemsOf = (c) => [...c.children].filter(el => el.matches(itemSelector));
    let st = null;   // 진행 중인 드래그 상태

    function appendTo(container) {
      const tail = container.querySelector(':scope > [data-drop-tail]');
      if (tail) container.insertBefore(st.item, tail); else container.appendChild(st.item);
    }

    function begin() {
      const { item } = st;
      st.active = true;
      item.classList.add('dragging');
      containers.forEach(c => c.classList.add('drop-ready'));
      document.body.classList.add('is-dragging-group');
      // 레이아웃이 접힌 뒤의 크기로 따라다니는 미리보기 생성
      const src = (ghostSelector && item.querySelector(ghostSelector)) || item;
      const r = src.getBoundingClientRect();
      const g = src.cloneNode(true);
      g.classList.add('drag-ghost');
      Object.assign(g.style, { position: 'fixed', left: r.left + 'px', top: '0px', width: r.width + 'px', margin: '0', pointerEvents: 'none', zIndex: 9999 });
      document.body.appendChild(g);
      st.ghost = g; st.gx = st.x - r.left; st.gy = Math.min(r.height / 2, 24);
      st.scroller = scrollParent(containers[0]);
      tick();
    }

    function place() {
      const { item, x, y, ghost } = st;
      ghost.style.left = (x - st.gx) + 'px';
      ghost.style.top = (y - st.gy) + 'px';
      const el = document.elementFromPoint(x, y);
      zones.forEach(z => z.zone.classList.remove('drop-hover'));
      if (!el) return;
      const hit = zones.find(z => z.zone.contains(el));
      if (hit) {
        hit.zone.classList.add('drop-hover');
        if (item.parentElement !== hit.container) appendTo(hit.container);
        return;
      }
      const container = containers.find(c => c.contains(el));
      if (!container) return;
      let after = null, best = -Infinity;
      for (const child of itemsOf(container)) {
        if (child === item || !child.offsetParent) continue;
        const box = child.getBoundingClientRect();
        const off = y - box.top - box.height / 2;
        if (off < 0 && off > best) { best = off; after = child; }
      }
      if (after) { if (item.nextElementSibling !== after) container.insertBefore(item, after); }
      else if (item.parentElement !== container || itemsOf(container).pop() !== item) appendTo(container);
    }

    // 가장자리 자동 스크롤
    function tick() {
      if (!st || !st.active) return;
      const sc = st.scroller;
      const isDoc = sc === document.scrollingElement || sc === document.documentElement;
      const top = isDoc ? 0 : sc.getBoundingClientRect().top;
      const bottom = isDoc ? window.innerHeight : sc.getBoundingClientRect().bottom;
      const edge = 70;
      let dy = 0;
      if (st.y < top + edge) dy = -Math.ceil((top + edge - st.y) / 4);
      else if (st.y > bottom - edge) dy = Math.ceil((st.y - (bottom - edge)) / 4);
      if (dy) { sc.scrollTop += dy; place(); }
      st.raf = requestAnimationFrame(tick);
    }

    function onMove(e) {
      if (!st) return;
      st.x = e.clientX; st.y = e.clientY;
      if (!st.active) {
        if (Math.abs(st.x - st.sx) + Math.abs(st.y - st.sy) < 5) return;   // 살짝 누른 건 클릭으로 취급
        begin();
      }
      e.preventDefault();
      place();
    }
    function onScroll() { if (st && st.active) place(); }   // 휠로 스크롤하면 그 자리 기준으로 다시 계산

    function finish(cancel) {
      if (!st) return;
      const { item, active, origParent, origNext } = st;
      document.removeEventListener('pointermove', onMove);
      document.removeEventListener('pointerup', onUp);
      document.removeEventListener('pointercancel', onCancel);
      document.removeEventListener('keydown', onKey, true);
      window.removeEventListener('scroll', onScroll, true);
      cancelAnimationFrame(st.raf);
      if (st.ghost) st.ghost.remove();
      zones.forEach(z => z.zone.classList.remove('drop-hover'));
      item.classList.remove('dragging');
      containers.forEach(c => c.classList.remove('drop-ready'));
      document.body.classList.remove('is-dragging-group');
      st = null;
      if (!active) return;
      if (cancel) { origParent.insertBefore(item, origNext); return; }
      const changed = item.parentElement !== origParent || item.nextElementSibling !== origNext;
      if (changed && onReorder) onReorder(containers.map(c => ({ container: c, ids: itemsOf(c).map(el => el.dataset.id) })));
    }
    const onUp = () => finish(false);
    const onCancel = () => finish(true);
    const onKey = (e) => { if (e.key === 'Escape') { e.preventDefault(); finish(true); } };

    containers.forEach(container => {
      itemsOf(container).forEach(item => {
        const h = (handleSelector && item.querySelector(handleSelector)) || item;
        h.style.cursor = 'grab';
        h.style.touchAction = 'none';
        h.addEventListener('pointerdown', (e) => {
          if (e.button !== 0 || st) return;
          e.preventDefault();
          st = { item, sx: e.clientX, sy: e.clientY, x: e.clientX, y: e.clientY, active: false,
                 origParent: item.parentElement, origNext: item.nextElementSibling };
          document.addEventListener('pointermove', onMove);
          document.addEventListener('pointerup', onUp);
          document.addEventListener('pointercancel', onCancel);
          document.addEventListener('keydown', onKey, true);
          window.addEventListener('scroll', onScroll, true);
        });
      });
    });
  }

  return { enable, enableGroup };
})();
