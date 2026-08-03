// ============================================================
//  panel.js — 미니 위젯(오늘 · 주간 · 월간 · 업체)
// ============================================================
(function () {
  const S = window.Schedule;
  const DOW = S.DOW;
  const person = '나';
  const MOVED_TO_PREFIX = 'mm-moved-to:';
  let tab = 'today';
  let cache = null;
  let selMonthDate = null;   // 월간에서 선택한 날짜(ymd)
  let expandedCo = null;     // 업체 탭에서 펼친 회사 id
  let weekOffset = 0;        // 주간 탭 이동(주 단위, 0=이번 주)
  let monthOffset = 0;       // 월간 탭 이동(월 단위, 0=이번 달)
  let focusAdd = false;      // 렌더 후 할 일 입력칸에 포커스 복귀

  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }
  function statusClass(s) { return ({ '예정': 'plan', '진행중': 'run', '일시정지': 'pause', '종료': 'done', '지연': 'late' })[s] || 'plan'; }
  function parseDate(value) {
    const s = String(value || '').slice(0, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return null;
    const d = new Date(s + 'T00:00:00');
    return Number.isNaN(d.getTime()) ? null : d;
  }
  function sortByQuoteDate(a, b) {
    const ad = parseDate(a.first_quote_date);
    const bd = parseDate(b.first_quote_date);
    const av = ad ? ad.getTime() : Number.MAX_SAFE_INTEGER;
    const bv = bd ? bd.getTime() : Number.MAX_SAFE_INTEGER;
    if (av !== bv) return av - bv;
    return String(a.name || '').localeCompare(String(b.name || ''), 'ko-KR');
  }
  function isHiddenCompany(c) {
    return c && (c.hidden === true || c.hidden === 'true' || c.is_hidden === true || !!c.hidden_at);
  }
  function movedTo(ch) {
    const memo = String((ch && ch.memo) || '');
    return memo.startsWith(MOVED_TO_PREFIX) ? memo.slice(MOVED_TO_PREFIX.length) : '';
  }
  function progressOf(items) {
    const done = items.filter(i => i.done).length;
    const total = items.length;
    return { done, total, pct: total ? Math.round(done / total * 100) : 0 };
  }
  async function loadData() {
    const routines = await DB.list('routines', { person });
    const checks = await DB.list('task_checks', { person });
    const companies = (await DB.list('companies')).filter(c => !isHiddenCompany(c)).sort(sortByQuoteDate);
    const companyIds = new Set(companies.map(c => String(c.id)));
    const services = (await DB.list('services')).filter(s => companyIds.has(String(s.company_id)));
    const serviceIds = new Set(services.map(s => String(s.id)));
    const processes = (await DB.list('processes')).filter(p => serviceIds.has(String(p.service_id)));
    const checkMap = {}, oneoffs = {};
    checks.forEach(ch => {
      if (ch.deadline_key) return;                        // 옛 마감 체크행은 사용 안 함 — 프로세스 단계 상태로 대체
      if (ch.routine_id) checkMap['r_' + ch.routine_id + '_' + ch.date] = ch;
      else (oneoffs[ch.date] = oneoffs[ch.date] || []).push(ch);
    });
    return { routines, checkMap, oneoffs, companies, services, processes, deadlines: S.deadlineMap(companies, services, processes) };
  }

  function itemsFor(date, data) {
    const key = S.ymd(date);
    const items = data.routines.filter(r => S.routineApplies(r, date)).map(r => {
      const ch = data.checkMap['r_' + r.id + '_' + key];
      if (movedTo(ch)) return null;
      return { type: 'r', id: r.id, title: r.title, done: ch ? ch.done : false };
    }).filter(Boolean);
    (data.oneoffs[key] || []).forEach(o => items.push({ type: 'o', id: o.id, title: o.title, done: o.done }));
    (data.deadlines[key] || []).forEach(d => {
      // 마감(🚩)은 프로세스 단계 상태(종료 여부)를 그대로 사용 — 업무일지·프로젝트 현황과 동일 기준
      items.push({ type: 'd', pid: d.pid, companyId: d.company_id, title: `${d.company} · ${d.stage} 마감`, done: d.status === '종료' });
    });
    return items;
  }

  function taskRow(it) {
    if (it.type === 'd') return `<label class="p-task deadline ${it.done ? 'done' : ''}" data-type="d" data-id="${esc(it.pid)}" data-company="${esc(it.companyId)}">
      <input type="checkbox" ${it.done ? 'checked' : ''}><span class="flag">🚩</span><span>${esc(it.title)}</span></label>`;
    return `<label class="p-task ${it.done ? 'done' : ''}" data-type="${it.type}" data-id="${it.id}">
      <input type="checkbox" ${it.done ? 'checked' : ''}><span>${esc(it.title)}</span></label>`;
  }

  async function render() {
    await DB.reload();               // 파일에서 최신 데이터 다시 읽기(메인 창 변경 반영)
    cache = await loadData();
    const data = cache;
    const content = document.getElementById('p-content');
    const heading = document.getElementById('p-heading');
    const today = S.startToday();

    document.querySelectorAll('.ptab').forEach(b => b.classList.toggle('on', b.dataset.tab === tab));

    if (tab === 'today') {
      heading.textContent = '오늘 할 일';
      const items = itemsFor(today, data);
      const prog = progressOf(items);
      content.innerHTML = panelProgress(prog) + (items.length ? items.map(taskRow).join('')
        : `<div class="p-empty">오늘 할 일이 없어요 🎉</div>`)
        + addComposer(S.ymd(today));
      bindChecks(content, S.ymd(today), data);
      bindAdd(content);
    }
    else if (tab === 'week') {
      const weekAnchor = S.addDays(today, weekOffset * 7);
      const days = S.weekDates(weekAnchor);
      const wl = `${days[0].getMonth() + 1}.${days[0].getDate()} ~ ${days[6].getMonth() + 1}.${days[6].getDate()}`;
      heading.textContent = weekOffset === 0 ? '이번 주' : '주간';
      content.innerHTML = navHeader(wl, weekOffset) + days.map(d => {
        const items = itemsFor(d, data);
        const prog = progressOf(items);
        const hol = S.holidayName(d);
        return `<div class="p-day ${S.isToday(d) ? 'today' : ''}" data-date="${S.ymd(d)}">
          <div class="p-day-h"><b>${d.getMonth() + 1}.${d.getDate()}</b> <span>${DOW[d.getDay()]}</span>${hol ? `<em>${esc(hol)}</em>` : ''}</div>
          ${panelProgress(prog)}
          ${items.length ? items.map(taskRow).join('') : '<div class="p-none">-</div>'}
        </div>`;
      }).join('');
      bindChecks(content, null, data);
      bindNav(content);
    }
    else if (tab === 'month') {
      heading.textContent = monthOffset === 0 ? '이번 달' : '월간';
      const base = new Date(today.getFullYear(), today.getMonth() + monthOffset, 1);
      const y = base.getFullYear(), m = base.getMonth();
      const first = new Date(y, m, 1), pad = first.getDay();
      const dim = new Date(y, m + 1, 0).getDate();
      const cells = [];
      for (let i = 0; i < pad; i++) cells.push(null);
      for (let d = 1; d <= dim; d++) cells.push(new Date(y, m, d));
      // 선택 날짜가 표시 중인 달에 없으면: 이 달에 '오늘'이 있으면 오늘, 없으면 1일
      let selKey = selMonthDate;
      if (!selKey || !cells.some(d => d && S.ymd(d) === selKey)) {
        selKey = cells.some(d => d && S.isToday(d)) ? S.ymd(today) : S.ymd(first);
      }
      selMonthDate = selKey;
      content.innerHTML = navHeader(`${y}. ${m + 1}`, monthOffset) +
        `<div class="p-month">
          ${DOW.map(d => `<span class="p-mh">${d}</span>`).join('')}
          ${cells.map(d => {
            if (!d) return '<span class="p-mc empty"></span>';
            const key = S.ymd(d);
            const items = itemsFor(d, data);
            const active = items.filter(i => i.type !== 'd');
            const prog = progressOf(active);
            const hol = S.holidayName(d);
            const dot = items.length
              ? `<i class="${prog.total && prog.done === prog.total ? 'full' : ''}"></i>`
              : '';
            return `<span class="p-mc ${S.isToday(d) ? 'today' : ''} ${hol ? 'hol' : ''} ${key === selKey ? 'sel' : ''}" data-date="${key}">
              <b>${d.getDate()}</b>${dot}</span>`;
          }).join('')}
        </div>
        <div class="p-month-detail" id="p-month-detail"></div>`;
      renderMonthDetail(selKey, data);
      content.querySelectorAll('.p-mc[data-date]').forEach(cell =>
        cell.addEventListener('click', () => { selMonthDate = cell.dataset.date; render(); }));
      bindNav(content);
    }
    else if (tab === 'co') {
      heading.textContent = '프로젝트 현황';
      const procByCo = {}; const svcCo = {}; data.services.forEach(s => svcCo[s.id] = s.company_id);
      data.processes.forEach(p => { const co = svcCo[p.service_id]; if (co) (procByCo[co] = procByCo[co] || []).push(p); });
      content.innerHTML = data.companies.length ? data.companies.map(c => {
        const ps = procByCo[c.id] || [];
        const done = ps.filter(p => p.status === '종료').length;
        const total = ps.length;
        const pct = total ? Math.round(done / total * 100) : 0;
        const full = total && done === total;
        const cur = ps.find(p => ['진행중', '지연', '일시정지'].includes(p.status));
        const open = String(expandedCo) === String(c.id);
        const svcs = data.services.filter(s => String(s.company_id) === String(c.id));
        return `<div class="p-co ${open ? 'open' : ''}" data-co="${esc(c.id)}">
          <button class="p-co-h" data-co-toggle type="button">
            <span class="p-co-name"><b>${esc(c.name)}</b><span class="badge ${statusClass(c.status)}">${esc(c.status)}</span></span>
            <span class="p-co-caret">▾</span>
          </button>
          ${total
            ? `<div class="p-progress ${full ? 'full' : ''}"><span style="width:${pct}%"></span><b>${pct}%</b></div>
               <div class="p-co-m">${cur ? '현재 · ' + esc(cur.name) + ' · ' : ''}완료 ${done}/${total}</div>`
            : `<div class="p-co-m">항목 없음</div>`}
          ${open ? coDetail(svcs, procByCo, data) : ''}
        </div>`;
      }).join('') : `<div class="p-empty">등록된 업체가 없어요</div>`;
      content.querySelectorAll('[data-co-toggle]').forEach(b => b.addEventListener('click', () => {
        const id = b.closest('.p-co').dataset.co;
        expandedCo = String(expandedCo) === String(id) ? null : id;
        render();
      }));
      const openMain = content.querySelector('[data-open-main]');
      if (openMain) openMain.addEventListener('click', () => window.mm && window.mm.openMain());
    }

    // 공통 하단 요약
    const run = data.companies.filter(c => c.status === '진행중').length;
    const pause = data.companies.filter(c => c.status === '일시정지').length;
    const late = data.companies.filter(c => c.status === '지연').length;
    const done = data.companies.filter(c => c.status === '종료').length;
    document.getElementById('p-foot').innerHTML = `
      <div class="foot-stat run"><b>${run}</b><span>진행중</span></div>
      <div class="foot-stat pause"><b>${pause}</b><span>정지</span></div>
      <div class="foot-stat late"><b>${late}</b><span>지연</span></div>
      <div class="foot-stat done"><b>${done}</b><span>종료</span></div>`;

    // 방금 추가했다면 입력칸에 포커스 복귀 → 연속 입력 편하게
    if (focusAdd) {
      focusAdd = false;
      const inp = content.querySelector('.p-add-in');
      if (inp) inp.focus();
    }
  }

  function panelProgress(p) {
    if (!p.total) return '';
    return `<div class="p-progress ${p.done === p.total ? 'full' : ''}">
      <span style="width:${p.pct}%"></span><b>${p.pct}%</b>
    </div>`;
  }

  // 주/월 이동 네비게이션 (‹ 이전 · 오늘 · 다음 ›)
  function navHeader(label, offset) {
    return `<div class="p-nav">
      <button class="p-nav-btn" data-nav="prev" type="button" title="이전">‹</button>
      <span class="p-nav-label">${esc(label)}</span>
      <button class="p-nav-btn" data-nav="next" type="button" title="다음">›</button>
      <button class="p-nav-today ${offset === 0 ? 'hide' : ''}" data-nav="today" type="button">오늘</button>
    </div>`;
  }
  function bindNav(container) {
    container.querySelectorAll('[data-nav]').forEach(b => b.addEventListener('click', () => {
      const dir = b.dataset.nav;
      const step = dir === 'prev' ? -1 : dir === 'next' ? 1 : 0;
      if (tab === 'week') weekOffset = dir === 'today' ? 0 : weekOffset + step;
      else if (tab === 'month') { monthOffset = dir === 'today' ? 0 : monthOffset + step; selMonthDate = null; }
      render();
    }));
  }

  // 할 일 추가 입력줄 (읽기전용이면 표시 안 함)
  function addComposer(dateKey) {
    if (DB.READONLY) return '';
    return `<form class="p-add" data-date="${esc(dateKey)}">
      <input type="text" class="p-add-in" placeholder="+ 할 일 추가" autocomplete="off">
      <button type="submit" class="p-add-btn" title="추가">추가</button>
    </form>`;
  }
  async function addOneoff(dateKey, title) {
    if (DB.READONLY || !title) return;
    const existing = (await DB.list('task_checks'))
      .filter(ch => !ch.routine_id && !ch.deadline_key && ch.date === dateKey).length;
    await DB.insert('task_checks', { routine_id: null, person, title, date: dateKey, done: false, sort_order: 500 + existing + 1 });
  }
  function bindAdd(container) {
    container.querySelectorAll('.p-add').forEach(f => {
      f.addEventListener('submit', async (e) => {
        e.preventDefault();
        const inp = f.querySelector('.p-add-in');
        const val = (inp.value || '').trim();
        if (!val) { inp.focus(); return; }
        focusAdd = true;
        await addOneoff(f.dataset.date, val);
        cache = null; render();
      });
    });
  }

  // 월간 — 선택한 날짜의 업무일지 리스트
  function renderMonthDetail(dateKey, data) {
    const box = document.getElementById('p-month-detail');
    if (!box) return;
    const d = parseDate(dateKey);
    if (!d) { box.innerHTML = ''; return; }
    const items = itemsFor(d, data);
    const prog = progressOf(items);
    const hol = S.holidayName(d);
    box.innerHTML = `
      <div class="p-md-h"><b>${d.getMonth() + 1}.${d.getDate()}</b> <span>${DOW[d.getDay()]}</span>${hol ? `<em>${esc(hol)}</em>` : ''}</div>
      ${items.length
        ? panelProgress(prog) + items.map(taskRow).join('')
        : `<div class="p-none">이 날은 등록된 업무가 없어요</div>`}
      ${addComposer(dateKey)}`;
    bindChecks(box, dateKey, data);
    bindAdd(box);
  }

  // 업체 — 펼쳤을 때 서비스 항목별 단계 상세
  function coDetail(svcs, procByCo, data) {
    const procBySvc = {};
    data.processes.forEach(p => { (procBySvc[p.service_id] = procBySvc[p.service_id] || []).push(p); });
    const body = svcs.length ? svcs.map(s => {
      const ps = procBySvc[s.id] || [];
      const d = ps.filter(p => p.status === '종료').length;
      const pct = ps.length ? Math.round(d / ps.length * 100) : 0;
      const full = ps.length && d === ps.length;
      return `<div class="p-svc">
        <div class="p-svc-h">
          <span class="p-svc-n">${esc(s.name)}</span>
          <span class="badge ${statusClass(s.status)}">${esc(s.status)}</span>
          <span class="p-svc-pct ${full ? 'full' : ''}">${ps.length ? pct + '%' : '-'}</span>
        </div>
        ${ps.length ? `<div class="p-stages">${ps.map(p =>
          `<span class="p-stage st-${statusClass(p.status)}" title="${esc(s.name)} · ${esc(p.name)} · ${esc(p.status || '예정')}${p.end_date ? ' · 마감 ' + esc(String(p.end_date).slice(0, 10)) : ''}">${esc(p.name)}</span>`
        ).join('')}</div>` : '<div class="p-none">단계 없음</div>'}
      </div>`;
    }).join('') : `<div class="p-none">서비스 항목이 없어요</div>`;
    return `<div class="p-co-detail">${body}
      <button class="p-co-open" data-open-main type="button">대시보드에서 자세히 보기 →</button>
    </div>`;
  }

  function bindChecks(container, dateKey, data) {
    container.querySelectorAll(`.p-task input`).forEach(cb => {
      cb.addEventListener('change', async () => {
        const t = cb.closest('.p-task');
        const day = t.closest('.p-day');
        const useDate = day ? day.dataset.date : dateKey;
        await toggle(t.dataset.type, t.dataset.id, useDate, cb.checked, data.routines, { company: t.dataset.company });
        cache = null; render();
      });
    });
  }

  // 마감 체크로 단계 상태가 바뀌면 서비스·업체 상태도 함께 정리(프로젝트 현황과 동일 규칙)
  function aggregateStatus(statuses) {
    if (!statuses.length) return null;
    if (statuses.every(s => s === '종료')) return '종료';
    if (statuses.includes('지연')) return '지연';
    if (statuses.includes('진행중')) return '진행중';
    if (statuses.includes('일시정지')) return '일시정지';
    if (statuses.includes('종료')) return '진행중';
    return '예정';
  }
  async function rollupCompany(companyId) {
    if (!companyId) return;
    const services = await DB.list('services', { company_id: companyId });
    const serviceStatuses = [];
    for (const s of services) {
      const procs = await DB.list('processes', { service_id: s.id });
      const next = aggregateStatus(procs.map(p => p.status || '예정'));
      if (next && s.status !== next) await DB.update('services', s.id, { status: next });
      serviceStatuses.push(next || s.status || '예정');
    }
    const co = (await DB.list('companies', { id: companyId }))[0];
    if (co) {
      const nextCo = aggregateStatus(serviceStatuses);
      if (nextCo && co.status !== nextCo) await DB.update('companies', companyId, { status: nextCo });
    }
  }

  async function toggle(type, id, date, done, routines, extra) {
    if (DB.READONLY) return;
    if (type === 'd') {
      // 마감 체크 = 그 프로세스 단계를 종료/진행중으로 → 업무일지·프로젝트 현황과 동기화
      if (!id) return;
      await DB.update('processes', id, { status: done ? '종료' : '진행중' });
      await rollupCompany(extra && extra.company);
      return;
    }
    if (type === 'r') {
      const checks = await DB.list('task_checks');
      const existing = checks.find(ch => String(ch.routine_id) === String(id) && ch.date === date);
      const routine = routines.find(r => String(r.id) === String(id));
      if (existing) await DB.update('task_checks', existing.id, { done });
      else await DB.insert('task_checks', { routine_id: id, person, title: routine ? routine.title : '', date, done });
    } else if (type === 'o') {
      await DB.update('task_checks', id, { done });
    }
  }

  document.querySelectorAll('.ptab').forEach(b => b.addEventListener('click', () => {
    tab = b.dataset.tab;
    weekOffset = 0; monthOffset = 0; selMonthDate = null;   // 탭 바꾸면 항상 이번 주/달·오늘 기준으로
    render();
  }));
  document.getElementById('p-close').addEventListener('click', () => window.mm && window.mm.closePanel());
  document.getElementById('p-open').addEventListener('click', () => window.mm && window.mm.openMain());
  document.getElementById('p-refresh').addEventListener('click', () => { cache = null; render(); });

  // 핀(항상 위에 고정) 토글 — Electron 전용. 웹에선 버튼 숨김
  const pinBtn = document.getElementById('p-pin');
  if (pinBtn) {
    if (window.mm && window.mm.setPanelPin) {
      const applyPinUI = (on) => {
        pinBtn.classList.toggle('on', !!on);
        pinBtn.title = on ? '항상 위에 고정: 켜짐 (클릭하면 해제)' : '항상 위에 고정: 꺼짐 (클릭하면 고정)';
      };
      window.mm.getPanelPin().then(applyPinUI).catch(() => applyPinUI(true));
      pinBtn.addEventListener('click', async () => {
        const next = !pinBtn.classList.contains('on');
        const saved = await window.mm.setPanelPin(next);
        applyPinUI(saved);
      });
    } else {
      pinBtn.style.display = 'none';
    }
  }

  render();
  setInterval(() => { cache = null; render(); }, 60000);
})();
