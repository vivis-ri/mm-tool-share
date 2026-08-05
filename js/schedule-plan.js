// ============================================================
//  schedule-plan.js — 프로젝트 일정 조율(월간)
//  · 진행 중인 업체의 "마감일 미정" 프로세스 단계를 달력에 드래그&드롭 → end_date(마감일) 설정
//  · 배치된 마감일 카드를 다른 날짜로 드래그 → 마감일만 변경(시작일 개념 없음)
//  · 배치 즉시 업체현황 / 업무일지 🚩 / PDF 진행보드에 자동 반영
//  · 개인 체크리스트(업무일지)와 분리 — 여기선 프로세스 단계만 다룸
// ============================================================
window.SchedulePlan = (function () {
  const { esc, toast } = UI;
  const S = window.Schedule;
  const DOW = S.DOW;
  const state = { anchor: S.startToday(), companyFilters: [], searchTerm: '', searchExact: false, collapsedSvcs: {} };
  let dragging = null; // { id, fromDate|null }
  let searchTimer = null;

  function isHidden(c) { return window.Companies && window.Companies.isHidden(c); }
  function isActiveCompany(c) { return window.Companies && window.Companies.isActiveStatus(c.status); }
  function stClass(s) { return UI.statusClass(s); }
  function dateValue(v) {
    const s = String(v || '').slice(0, 10);
    return /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : '';
  }
  function chipScheduleText(p, place) {
    const end = dateValue(p.end_date);
    if (place === 'cal' && end) return `마감 ${UI.fmtDate(end)}`;
    return '';
  }
  function fullSchedText(p) {
    const e = dateValue(p.end_date);
    return e ? `마감 ${UI.fmtDate(e)}` : '아직 미정';
  }
  function chipTip(p) {
    const lines = [
      `업체 · ${p._company || '-'}`,
      `서비스 · ${p._service || '-'}`,
      `단계 · ${p.name || '-'}`,
      `상태 · ${p.status || '예정'}`,
      `일정 · ${fullSchedText(p)}`
    ];
    if (p.assignee) lines.push(`담당 · ${p.assignee}`);
    if (p.memo) lines.push(`메모 · ${p.memo}`);
    return lines.join('\n');
  }
  function datePatch(targetDate) {
    return { end_date: targetDate };
  }
  function dateToast(patch) {
    return `마감일을 ${patch.end_date}로 설정했습니다`;
  }

  async function loadData() {
    const companiesAll = (await DB.list('companies')).filter(c => !isHidden(c));
    UI.setCompanyColors(companiesAll);
    const companies = companiesAll
      .filter(isActiveCompany)
      .sort(window.Companies ? window.Companies.sortByQuoteDate : undefined);
    const coIds = new Set(companies.map(c => String(c.id)));
    // 사라진(숨김/종료된) 업체는 선택 목록에서 제거
    state.companyFilters = state.companyFilters.filter(id => coIds.has(String(id)));

    const coName = {};
    const coMeta = {};
    companies.forEach(c => {
      const id = String(c.id);
      coName[id] = c.name;
      coMeta[id] = { ...c, _poolCount: 0 };
    });

    const serviceTemplates = await DB.list('service_templates');
    const services = (await DB.list('services'))
      .filter(s => coIds.has(String(s.company_id)))
      .sort(UI.serviceSorter(serviceTemplates));
    const svcById = {}; services.forEach(s => { svcById[s.id] = s; });

    const processes = (await DB.list('processes')).filter(p => svcById[p.service_id]);

    // 필터 ① 여러 업체 선택(비어 있으면 전체)
    const filterSet = new Set(state.companyFilters.map(String));
    const hasCompanyFilter = filterSet.size > 0;
    const inFilter = (companyId) => !hasCompanyFilter || filterSet.has(String(companyId));

    // 필터 ② 프로세스명 검색(완전일치/부분일치)
    const term = String(state.searchTerm || '').trim().toLowerCase();
    const matchName = (p) => {
      if (!term) return true;
      const name = String(p.name || '').toLowerCase();
      return state.searchExact ? name === term : name.includes(term);
    };

    // 미배정 풀(company→service→[proc]): end_date 없음 + 종료 아님
    const byCo = {};
    processes.forEach(p => {
      if (p.end_date || p.status === '종료') return;
      if (!matchName(p)) return;
      const s = svcById[p.service_id];
      const coId = String(s.company_id);
      if (coMeta[coId]) coMeta[coId]._poolCount += 1;   // 업체 탭 배지 = 검색 반영, 업체선택과 무관
      if (!inFilter(s.company_id)) return;
      const rec = { ...p, _companyId: s.company_id, _company: coName[coId], _service: s.name };
      const coGroup = (byCo[coId] = byCo[coId] || { id: s.company_id, name: coName[coId], status: coMeta[coId] && coMeta[coId].status, count: 0, svcs: {} });
      coGroup.count += 1;
      (coGroup.svcs[s.id] = coGroup.svcs[s.id] || { id: s.id, name: s.name, status: s.status, items: [] }).items.push(rec);
    });

    // 날짜별 배치된 단계
    const scheduledByDate = {};
    processes.forEach(p => {
      if (!p.end_date) return;
      if (!matchName(p)) return;
      const s = svcById[p.service_id];
      if (!inFilter(s.company_id)) return;
      const key = String(p.end_date).slice(0, 10);
      (scheduledByDate[key] = scheduledByDate[key] || []).push({
        ...p, _companyId: s.company_id, _company: coName[String(s.company_id)], _service: s.name
      });
    });

    // 미배정 개수
    let poolCount = 0;
    Object.values(byCo).forEach(co => Object.values(co.svcs).forEach(sv => { poolCount += sv.items.length; }));
    const totalPoolCount = Object.values(coMeta).reduce((sum, c) => sum + c._poolCount, 0);
    let scheduledCount = 0;
    Object.values(scheduledByDate).forEach(arr => { scheduledCount += arr.length; });

    return { companies: companies.map(c => coMeta[String(c.id)]), byCo, scheduledByDate, poolCount, totalPoolCount, scheduledCount };
  }

  async function render(root) {
    if (window.App && window.App.refreshSidebar) window.App.refreshSidebar();
    const data = await loadData();
    const y = state.anchor.getFullYear(), m = state.anchor.getMonth();

    root.innerHTML = `
      <div class="page-head">
        <div>
          <div class="page-title">프로젝트 일정</div>
          <div class="page-sub">진행 중인 업체의 <b>마감일 미정</b> 단계를 달력으로 끌어다 놓으면 일정이 잡힙니다 · 업체현황·업무일지·PDF에 즉시 반영</div>
        </div>
        <div class="head-actions">
          <div class="date-nav inline">
            <button class="icon-btn" id="sp-prev">‹</button>
            <div class="date-label" id="sp-label">${y}년 ${m + 1}월</div>
            <button class="icon-btn" id="sp-next">›</button>
            <button class="btn sm ghost" id="sp-today">오늘</button>
          </div>
        </div>
      </div>

      <div class="sp-layout">
        <div class="sp-cal" id="sp-cal"></div>
        <aside class="sp-pool" id="sp-pool"></aside>
      </div>`;

    renderCalendar(root.querySelector('#sp-cal'), data);
    renderPool(root.querySelector('#sp-pool'), data);
    bind(root);
  }

  function chipHTML(p, place) {
    // place: 'cal' | 'pool'
    const label = `${esc(p._service || '항목')} · ${esc(p.name)}`;
    const sched = chipScheduleText(p, place);
    const schedHTML = sched
      ? `<span class="sp-chip-sched">${sched.split(' · ').map(x => `<i>${esc(x)}</i>`).join('')}</span>`
      : '';
    return `<div class="sp-chip st-${stClass(p.status)} ${DB.READONLY ? '' : 'draggable'}"
        draggable="${DB.READONLY ? 'false' : 'true'}" data-pid="${p.id}" data-place="${place}" data-end="${esc(dateValue(p.end_date))}" style="${UI.companyStyle(p._companyId)}" data-tip="${esc(chipTip(p))}">
        <span class="sp-chip-main"><span class="sp-chip-dot"></span><span class="sp-chip-tx">${label}</span></span>
        ${schedHTML}</div>`;
  }

  function renderCalendar(host, data) {
    const y = state.anchor.getFullYear(), m = state.anchor.getMonth();
    const first = new Date(y, m, 1);
    const startPad = first.getDay();
    const daysInMonth = new Date(y, m + 1, 0).getDate();
    const cells = [];
    for (let i = 0; i < startPad; i++) cells.push(null);
    for (let d = 1; d <= daysInMonth; d++) cells.push(new Date(y, m, d));
    while (cells.length % 7) cells.push(null);

    host.innerHTML = `
      <div class="month-dow">${DOW.map((d, i) => `<span class="${i === 0 ? 'sun' : ''} ${i === 6 ? 'sat' : ''}">${d}</span>`).join('')}</div>
      <div class="sp-cells">
        ${cells.map(d => {
          if (!d) return `<div class="sp-cell empty"></div>`;
          const key = S.ymd(d);
          const hol = S.holidayName(d);
          const items = data.scheduledByDate[key] || [];
          return `<div class="sp-cell ${S.isToday(d) ? 'today' : ''} ${d.getDay() === 0 ? 'sun' : ''} ${d.getDay() === 6 ? 'sat' : ''} ${hol ? 'holiday' : ''}" data-date="${key}">
            <div class="sp-cell-top"><span class="mnum">${d.getDate()}</span>${items.length ? `<span class="sp-cnt">${items.length}</span>` : ''}</div>
            ${hol ? `<div class="mcell-hol">${esc(hol)}</div>` : ''}
            <div class="sp-cell-items">${items.map(p => chipHTML(p, 'cal')).join('')}</div>
          </div>`;
        }).join('')}
      </div>`;
  }

  function renderPool(host, data) {
    const filters = state.companyFilters.map(String);
    const selectedNames = data.companies.filter(c => filters.includes(String(c.id))).map(c => c.name);
    const subText = !filters.length ? '전체 진행업체'
      : (selectedNames.length === 1 ? selectedNames[0] : `${selectedNames.length}개 업체 선택`);
    const term = String(state.searchTerm || '').trim();
    const groups = data.companies
      .map(c => [String(c.id), data.byCo[String(c.id)]])
      .filter(([cid, co]) => co);
    host.innerHTML = `
      <div class="sp-pool-head">
        <div>
          <div class="sp-pool-title">마감일 미정</div>
          <div class="sp-pool-sub">${esc(subText)}</div>
        </div>
        <span class="sp-pool-n">${data.poolCount}</span>
      </div>

      <div class="sp-search">
        <div class="sp-search-box">
          <span class="sp-search-ic">🔍</span>
          <input type="text" id="sp-search" class="sp-search-input" placeholder="프로세스명 검색 (예: 1차시안)" value="${esc(state.searchTerm || '')}" autocomplete="off" spellcheck="false">
          ${term ? `<button class="sp-search-clear" id="sp-search-clear" type="button" title="검색어 지우기">✕</button>` : ''}
        </div>
        <div class="sp-search-modes" role="group" aria-label="검색 방식">
          <button class="sp-search-mode ${!state.searchExact ? 'on' : ''}" type="button" data-mode="partial">부분일치</button>
          <button class="sp-search-mode ${state.searchExact ? 'on' : ''}" type="button" data-mode="exact">완전일치</button>
        </div>
        ${term ? `<div class="sp-search-hint">‘${esc(term)}’ 결과 · 미정 <b>${data.poolCount}</b> · 달력 배치 <b>${data.scheduledCount}</b></div>` : ''}
      </div>

      ${data.companies.length ? `
        <div class="sp-company-tabs-wrap">
          <div class="sp-company-tabs-label">업체별 보기 <span class="sp-company-tabs-hint">여러 곳 선택 가능</span></div>
          <div class="sp-company-tabs" role="group" aria-label="업체별 미정 단계">
            <button class="sp-company-tab ${!filters.length ? 'on' : ''}" type="button" data-co="">
              <span class="sp-company-tab-name">전체</span><span class="sp-company-tab-n">${data.totalPoolCount}</span>
            </button>
            ${data.companies.map(c => `<button class="sp-company-tab ${filters.includes(String(c.id)) ? 'on' : ''}" type="button" data-co="${esc(c.id)}" data-tip="${esc(c.name + '\n미정 ' + c._poolCount + '개')}">
              <i class="lg" style="${UI.companyDotStyle(c.id)}"></i><span class="sp-company-tab-name">${esc(c.name)}</span><span class="sp-company-tab-n">${c._poolCount}</span>
            </button>`).join('')}
          </div>
        </div>` : ''}
      <div class="sp-pool-tools">
        <span>${DB.READONLY ? '읽기전용' : '날짜로 드래그'}</span>
        <div class="sp-tool-actions">
          <button class="sp-tool-btn" id="sp-expand-all" type="button">펼침</button>
          <button class="sp-tool-btn" id="sp-collapse-all" type="button">접기</button>
        </div>
      </div>
      <div class="sp-pool-body" id="sp-pool-body">
        ${groups.length ? groups.map(([cid, co]) => `
          <div class="sp-pg">
            <div class="sp-pg-co">
              <span>${esc(co.name)}</span><span class="sp-pg-count">${co.count}</span>
            </div>
            ${Object.entries(co.svcs).map(([sid, sv]) => {
              const collapsed = !!state.collapsedSvcs[String(sid)];
              return `
              <div class="sp-pg-svc ${collapsed ? 'collapsed' : ''}">
                <button class="sp-pg-svc-h" type="button" data-svc-toggle data-svc="${esc(sid)}" aria-expanded="${collapsed ? 'false' : 'true'}" data-tip="${esc(co.name + '\n' + sv.name + '\n' + sv.status + ' · 미정 ' + sv.items.length + '개')}">
                  <span class="sp-svc-title"><span class="badge ${stClass(sv.status)}">${esc(sv.status)}</span><span class="sp-svc-name">${esc(sv.name)}</span></span>
                  <span class="sp-svc-right"><span class="sp-svc-meta">${sv.items.length}</span><span class="sp-svc-caret">▾</span></span>
                </button>
                <div class="sp-pg-items">${sv.items.map(p => chipHTML(p, 'pool')).join('')}</div>
              </div>`;
            }).join('')}
          </div>`).join('')
        : `<div class="sp-pool-empty">${term
              ? `‘${esc(term)}’와(과) 일치하는<br>마감일 미정 단계가 없습니다.`
              : (filters.length ? '선택한 업체에 마감일 미정<br>단계가 없습니다.' : '진행 중인 업체의 모든 단계에<br>마감일이 잡혀 있습니다.')}</div>`}
      </div>`;
  }

  // ---------- 이벤트 ----------
  function bind(root) {
    root.querySelector('#sp-prev').addEventListener('click', () => { state.anchor = new Date(state.anchor.getFullYear(), state.anchor.getMonth() - 1, 1); render(root); });
    root.querySelector('#sp-next').addEventListener('click', () => { state.anchor = new Date(state.anchor.getFullYear(), state.anchor.getMonth() + 1, 1); render(root); });
    root.querySelector('#sp-today').addEventListener('click', () => { state.anchor = S.startToday(); render(root); });
    // 업체 탭 — 여러 곳 동시 선택(토글). '전체'는 선택 해제
    root.querySelectorAll('.sp-company-tab').forEach(b => b.addEventListener('click', () => {
      const co = b.dataset.co;
      if (!co) {
        state.companyFilters = [];
      } else {
        const id = String(co);
        const i = state.companyFilters.findIndex(x => String(x) === id);
        if (i >= 0) state.companyFilters.splice(i, 1);
        else state.companyFilters.push(id);
      }
      render(root);
    }));

    // 프로세스명 검색 — 입력(디바운스) + 포커스/커서 유지
    const searchInput = root.querySelector('#sp-search');
    if (searchInput) {
      const rerenderKeepFocus = () => {
        const caret = searchInput.selectionStart;
        render(root).then(() => {
          const box = root.querySelector('#sp-search');
          if (box) { box.focus(); try { box.setSelectionRange(caret, caret); } catch {} }
        });
      };
      searchInput.addEventListener('input', () => {
        state.searchTerm = searchInput.value;
        clearTimeout(searchTimer);
        searchTimer = setTimeout(rerenderKeepFocus, 180);
      });
      searchInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') { e.preventDefault(); clearTimeout(searchTimer); state.searchTerm = searchInput.value; rerenderKeepFocus(); }
      });
    }
    const clearBtn = root.querySelector('#sp-search-clear');
    if (clearBtn) clearBtn.addEventListener('click', () => { clearTimeout(searchTimer); state.searchTerm = ''; render(root); });
    root.querySelectorAll('.sp-search-mode').forEach(b => b.addEventListener('click', () => {
      state.searchExact = b.dataset.mode === 'exact';
      render(root).then(() => { const box = root.querySelector('#sp-search'); if (box && state.searchTerm) box.focus(); });
    }));
    root.querySelectorAll('[data-svc-toggle]').forEach(b => b.addEventListener('click', () => {
      const key = String(b.dataset.svc);
      state.collapsedSvcs[key] = !state.collapsedSvcs[key];
      render(root);
    }));
    const expandAll = root.querySelector('#sp-expand-all');
    if (expandAll) expandAll.addEventListener('click', () => {
      root.querySelectorAll('[data-svc-toggle]').forEach(b => { delete state.collapsedSvcs[String(b.dataset.svc)]; });
      render(root);
    });
    const collapseAll = root.querySelector('#sp-collapse-all');
    if (collapseAll) collapseAll.addEventListener('click', () => {
      root.querySelectorAll('[data-svc-toggle]').forEach(b => { state.collapsedSvcs[String(b.dataset.svc)] = true; });
      render(root);
    });

    setupTips(root);

    if (DB.READONLY) return;
    bindDnD(root);
  }

  // 잘리는 텍스트(칩·업체탭·서비스명)에 마우스를 올리면 전체 상세를 보여주는 툴팁
  let tipEl = null;
  function setupTips(root) {
    if (!tipEl) {
      tipEl = document.createElement('div');
      tipEl.className = 'sp-tip';
      tipEl.style.display = 'none';
      document.body.appendChild(tipEl);
    }
    if (root._tipBound) return;   // 델리게이션은 컨테이너당 1회만
    root._tipBound = true;

    const hide = () => { tipEl.style.display = 'none'; };
    const position = (x, y) => {
      const pad = 12;
      const r = tipEl.getBoundingClientRect();
      let left = x + 14, top = y + 16;
      if (left + r.width + pad > window.innerWidth) left = x - r.width - 14;
      if (top + r.height + pad > window.innerHeight) top = y - r.height - 16;
      tipEl.style.left = Math.max(pad, left) + 'px';
      tipEl.style.top = Math.max(pad, top) + 'px';
    };
    const show = (el, x, y) => {
      const tip = el.getAttribute('data-tip');
      if (!tip) return;
      tipEl.innerHTML = tip.split('\n').map(line => {
        const i = line.indexOf(' · ');
        if (i > 0) return `<div class="sp-tip-line"><span class="sp-tip-k">${esc(line.slice(0, i))}</span>${esc(line.slice(i + 3))}</div>`;
        return `<div class="sp-tip-line sp-tip-head">${esc(line)}</div>`;
      }).join('');
      tipEl.style.display = 'block';
      position(x, y);
    };

    root.addEventListener('mouseover', (e) => {
      const el = e.target.closest('[data-tip]');
      if (el && root.contains(el)) show(el, e.clientX, e.clientY);
    });
    root.addEventListener('mousemove', (e) => {
      if (tipEl.style.display !== 'block') return;
      const el = e.target.closest('[data-tip]');
      if (el && root.contains(el)) position(e.clientX, e.clientY);
      else hide();
    });
    root.addEventListener('mouseout', (e) => {
      const el = e.target.closest('[data-tip]');
      if (!el) return;
      if (!e.relatedTarget || !el.contains(e.relatedTarget)) hide();
    });
    root.addEventListener('mouseleave', hide);
    window.addEventListener('scroll', hide, true);
  }

  function bindDnD(root) {
    let dropTarget = null;   // { kind:'date', date } | { kind:'pool' }
    let committing = false;

    function clearHighlights() {
      root.querySelectorAll('.drop-target').forEach(el => el.classList.remove('drop-target'));
    }

    // drop 또는 dragend 어느 쪽이 먼저 오든 한 번만 확정(HTML5 drop 미발화 환경 대비)
    async function commit() {
      const drag = dragging, dt = dropTarget;
      dragging = null; dropTarget = null;
      clearHighlights();
      if (committing || !drag || !dt) return;
      committing = true;
      try {
        if (dt.kind === 'date' && drag.fromDate !== dt.date) {
          const patch = datePatch(dt.date);
          await DB.update('processes', drag.id, patch);
          toast(dateToast(patch));
          await render(root);
        } else if (dt.kind === 'pool' && drag.fromDate) {
          await DB.update('processes', drag.id, { end_date: '' });
          toast('마감일을 해제했습니다 (미정)');
          await render(root);
        }
      } finally { committing = false; }
    }

    root.querySelectorAll('.sp-chip.draggable').forEach(chip => {
      chip.addEventListener('dragstart', (e) => {
        const cell = chip.closest('.sp-cell');
        dragging = {
          id: chip.dataset.pid,
          fromDate: cell ? cell.dataset.date : null
        };
        dropTarget = null;
        chip.classList.add('dragging');
        if (e.dataTransfer) { e.dataTransfer.effectAllowed = 'move'; try { e.dataTransfer.setData('text/plain', chip.dataset.pid); } catch {} }
      });
      // 확정은 dragend에서(항상 발화) — drop이 안 터져도 반영되도록
      chip.addEventListener('dragend', () => { chip.classList.remove('dragging'); commit(); });
    });

    // 달력 날짜 칸 = 드롭 대상 → 마감일 설정/변경
    root.querySelectorAll('.sp-cell:not(.empty)').forEach(cell => {
      const date = cell.dataset.date;
      const canDrop = () => dragging && dragging.fromDate !== date;
      const mark = (e) => { if (canDrop()) { e.preventDefault(); dropTarget = { kind: 'date', date }; cell.classList.add('drop-target'); if (e.dataTransfer) e.dataTransfer.dropEffect = 'move'; } };
      cell.addEventListener('dragenter', mark);
      cell.addEventListener('dragover', mark);
      cell.addEventListener('dragleave', (e) => {
        if (!e.relatedTarget || !cell.contains(e.relatedTarget)) {
          cell.classList.remove('drop-target');
          if (dropTarget && dropTarget.kind === 'date' && dropTarget.date === date) dropTarget = null;
        }
      });
      cell.addEventListener('drop', (e) => { if (canDrop()) { e.preventDefault(); e.stopPropagation(); dropTarget = { kind: 'date', date }; commit(); } });
    });

    // 풀 = 드롭 대상 → 마감일 해제(미정)
    const poolBox = root.querySelector('#sp-pool');
    if (poolBox) {
      const canPool = () => dragging && dragging.fromDate;
      const mark = (e) => { if (canPool()) { e.preventDefault(); dropTarget = { kind: 'pool' }; poolBox.classList.add('drop-target'); if (e.dataTransfer) e.dataTransfer.dropEffect = 'move'; } };
      poolBox.addEventListener('dragenter', mark);
      poolBox.addEventListener('dragover', mark);
      poolBox.addEventListener('dragleave', (e) => {
        if (!e.relatedTarget || !poolBox.contains(e.relatedTarget)) {
          poolBox.classList.remove('drop-target');
          if (dropTarget && dropTarget.kind === 'pool') dropTarget = null;
        }
      });
      poolBox.addEventListener('drop', (e) => { if (canPool()) { e.preventDefault(); e.stopPropagation(); dropTarget = { kind: 'pool' }; commit(); } });
    }
  }

  return { render };
})();
