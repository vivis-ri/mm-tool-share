// ============================================================
//  schedule-plan.js — 프로젝트 일정 조율(월간)
//  · 진행 중인 업체의 "마감일 미정" 프로세스 단계를 달력에 드래그&드롭 → end_date 설정
//  · 배치 즉시 업체현황 / 업무일지 🚩 / PDF 진행보드에 자동 반영(모두 end_date 참조)
//  · 개인 체크리스트(업무일지)와 분리 — 여기선 프로세스 단계만 다룸
// ============================================================
window.SchedulePlan = (function () {
  const { esc, toast } = UI;
  const S = window.Schedule;
  const DOW = S.DOW;
  const state = { anchor: S.startToday(), companyFilter: null };
  let dragging = null; // { id, fromDate|null }

  function isHidden(c) { return window.Companies && window.Companies.isHidden(c); }
  function isActiveCompany(c) { return window.Companies && window.Companies.isActiveStatus(c.status); }
  function stClass(s) { return UI.statusClass(s); }

  async function loadData() {
    const companiesAll = (await DB.list('companies')).filter(c => !isHidden(c));
    const companies = companiesAll
      .filter(isActiveCompany)
      .sort(window.Companies ? window.Companies.sortByQuoteDate : undefined);
    const coIds = new Set(companies.map(c => String(c.id)));
    const coName = {}; companies.forEach(c => { coName[c.id] = c.name; });

    const serviceTemplates = await DB.list('service_templates');
    const services = (await DB.list('services'))
      .filter(s => coIds.has(String(s.company_id)))
      .sort(UI.serviceSorter(serviceTemplates));
    const svcById = {}; services.forEach(s => { svcById[s.id] = s; });

    const processes = (await DB.list('processes')).filter(p => svcById[p.service_id]);

    // 필터(단일 업체 보기)
    const inFilter = (companyId) => !state.companyFilter || String(state.companyFilter) === String(companyId);

    // 미배정 풀(company→service→[proc]): end_date 없음 + 종료 아님
    const byCo = {};
    processes.forEach(p => {
      if (p.end_date || p.status === '종료') return;
      const s = svcById[p.service_id];
      if (!inFilter(s.company_id)) return;
      const rec = { ...p, _companyId: s.company_id, _company: coName[s.company_id], _service: s.name };
      (byCo[s.company_id] = byCo[s.company_id] || { name: coName[s.company_id], svcs: {} });
      (byCo[s.company_id].svcs[s.id] = byCo[s.company_id].svcs[s.id] || { name: s.name, status: s.status, items: [] }).items.push(rec);
    });

    // 날짜별 배치된 단계
    const scheduledByDate = {};
    processes.forEach(p => {
      if (!p.end_date) return;
      const s = svcById[p.service_id];
      if (!inFilter(s.company_id)) return;
      const key = String(p.end_date).slice(0, 10);
      (scheduledByDate[key] = scheduledByDate[key] || []).push({
        ...p, _company: coName[s.company_id], _service: s.name
      });
    });

    // 미배정 개수
    let poolCount = 0;
    Object.values(byCo).forEach(co => Object.values(co.svcs).forEach(sv => { poolCount += sv.items.length; }));

    return { companies, byCo, scheduledByDate, poolCount };
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

      ${data.companies.length ? `
      <div class="filter-chips sp-filter">
        <button class="chip ${!state.companyFilter ? 'on' : ''}" data-co="">전체 진행업체<span class="chip-n">${data.companies.length}</span></button>
        ${data.companies.map(c => `<button class="chip ${String(state.companyFilter) === String(c.id) ? 'on' : ''}" data-co="${c.id}">
          <i class="lg ${stClass(c.status)}"></i>${esc(c.name)}</button>`).join('')}
      </div>` : ''}

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
    const label = place === 'cal' ? `${esc(p._company)} · ${esc(p.name)}` : `${esc(p.name)}`;
    return `<div class="sp-chip st-${stClass(p.status)} ${DB.READONLY ? '' : 'draggable'}"
        draggable="${DB.READONLY ? 'false' : 'true'}" data-pid="${p.id}" data-place="${place}" title="${esc(p._company)} · ${esc(p._service)} · ${esc(p.name)} (${esc(p.status || '예정')})">
        <span class="sp-chip-dot"></span><span class="sp-chip-tx">${label}</span></div>`;
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
    const groups = Object.entries(data.byCo);
    host.innerHTML = `
      <div class="sp-pool-head">
        <span>🗂 마감일 미정</span><span class="sp-pool-n">${data.poolCount}</span>
      </div>
      <div class="sp-pool-hint">${DB.READONLY ? '읽기전용' : '단계를 달력 날짜로 끌어다 놓으세요'}</div>
      <div class="sp-pool-body" id="sp-pool-body">
        ${groups.length ? groups.map(([cid, co]) => `
          <div class="sp-pg">
            <div class="sp-pg-co">${esc(co.name)}</div>
            ${Object.values(co.svcs).map(sv => `
              <div class="sp-pg-svc">
                <div class="sp-pg-svc-h"><span class="badge ${stClass(sv.status)}">${esc(sv.status)}</span>${esc(sv.name)}</div>
                <div class="sp-pg-items">${sv.items.map(p => chipHTML(p, 'pool')).join('')}</div>
              </div>`).join('')}
          </div>`).join('')
        : `<div class="sp-pool-empty">🎉 진행 중인 업체의 모든 단계에<br>마감일이 잡혀 있습니다.</div>`}
      </div>`;
  }

  // ---------- 이벤트 ----------
  function bind(root) {
    root.querySelector('#sp-prev').addEventListener('click', () => { state.anchor = new Date(state.anchor.getFullYear(), state.anchor.getMonth() - 1, 1); render(root); });
    root.querySelector('#sp-next').addEventListener('click', () => { state.anchor = new Date(state.anchor.getFullYear(), state.anchor.getMonth() + 1, 1); render(root); });
    root.querySelector('#sp-today').addEventListener('click', () => { state.anchor = S.startToday(); render(root); });
    root.querySelectorAll('.sp-filter .chip').forEach(b => b.addEventListener('click', () => {
      state.companyFilter = b.dataset.co || null; render(root);
    }));

    if (DB.READONLY) return;
    bindDnD(root);
  }

  function bindDnD(root) {
    root.querySelectorAll('.sp-chip.draggable').forEach(chip => {
      chip.addEventListener('dragstart', (e) => {
        const cell = chip.closest('.sp-cell');
        dragging = { id: chip.dataset.pid, fromDate: cell ? cell.dataset.date : null };
        chip.classList.add('dragging');
        if (e.dataTransfer) { e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/plain', chip.dataset.pid); }
      });
      chip.addEventListener('dragend', () => { chip.classList.remove('dragging'); setTimeout(() => { dragging = null; }, 0); });
    });

    // 달력 날짜 칸 = 드롭 대상 → 마감일 설정/변경
    root.querySelectorAll('.sp-cell:not(.empty)').forEach(cell => {
      cell.addEventListener('dragover', (e) => {
        if (!dragging || dragging.fromDate === cell.dataset.date) return;
        e.preventDefault(); cell.classList.add('drop-target');
        if (e.dataTransfer) e.dataTransfer.dropEffect = 'move';
      });
      cell.addEventListener('dragleave', (e) => { if (!e.relatedTarget || !cell.contains(e.relatedTarget)) cell.classList.remove('drop-target'); });
      cell.addEventListener('drop', async (e) => {
        if (!dragging || dragging.fromDate === cell.dataset.date) return;
        e.preventDefault(); e.stopPropagation(); cell.classList.remove('drop-target');
        const id = dragging.id, toDate = cell.dataset.date;
        await DB.update('processes', id, { end_date: toDate });
        toast(`마감일을 ${toDate}로 ${dragging.fromDate ? '변경' : '설정'}했습니다`);
        dragging = null; render(root);
      });
    });

    // 풀 = 드롭 대상 → 마감일 해제(미정)
    const pool = root.querySelector('#sp-pool-body');
    const poolBox = root.querySelector('#sp-pool');
    [pool, poolBox].forEach(box => {
      if (!box) return;
      box.addEventListener('dragover', (e) => {
        if (!dragging || !dragging.fromDate) return; // 이미 미정인 건 무시
        e.preventDefault(); poolBox.classList.add('drop-target');
        if (e.dataTransfer) e.dataTransfer.dropEffect = 'move';
      });
      box.addEventListener('dragleave', (e) => { if (!e.relatedTarget || !poolBox.contains(e.relatedTarget)) poolBox.classList.remove('drop-target'); });
      box.addEventListener('drop', async (e) => {
        if (!dragging || !dragging.fromDate) return;
        e.preventDefault(); e.stopPropagation(); poolBox.classList.remove('drop-target');
        const id = dragging.id;
        await DB.update('processes', id, { end_date: '' });
        toast('마감일을 해제했습니다 (미정)');
        dragging = null; render(root);
      });
    });
  }

  return { render };
})();
