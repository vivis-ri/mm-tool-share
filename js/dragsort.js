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

  return { enable };
})();
