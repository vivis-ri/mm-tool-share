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
  // 마감 항목의 안정적인 체크 키(회사|서비스|단계 + 날짜) — 저장/조회에 공통 사용
  function dlKey(d, dateKey) { return 'dl:' + dateKey + ':' + d.company + '|' + d.service + '|' + d.stage; }

  async function loadData() {
    const routines = await DB.list('routines', { person });
    const checks = await DB.list('task_checks', { person });
    const companies = (await DB.list('companies')).filter(c => !isHiddenCompany(c)).sort(sortByQuoteDate);
    const companyIds = new Set(companies.map(c => String(c.id)));
    const services = (await DB.list('services')).filter(s => companyIds.has(String(s.company_id)));
    const serviceIds = new Set(services.map(s => String(s.id)));
    const processes = (await DB.list('processes')).filter(p => serviceIds.has(String(p.service_id)));
    const checkMap = {}, oneoffs = {}, dlMap = {};
    checks.forEach(ch => {
      if (ch.deadline_key) dlMap[ch.deadline_key] = ch;
      else if (ch.routine_id) checkMap['r_' + ch.routine_id + '_' + ch.date] = ch;
      else (oneoffs[ch.date] = oneoffs[ch.date] || []).push(ch);
    });
    return { routines, checkMap, oneoffs, dlMap, companies, services, processes, deadlines: S.deadlineMap(companies, services, processes) };
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
      const dk = dlKey(d, key);
      const ch = data.dlMap[dk];
      items.push({ type: 'd', dlKey: dk, title: `${d.company} · ${d.stage} 마감`, done: ch ? ch.done : false });
    });
    return items;
  }

  function taskRow(it) {
    if (it.type === 'd') return `<label class="p-task deadline ${it.done ? 'done' : ''}" data-type="d" data-key="${esc(it.dlKey)}" data-title="${esc(it.title)}">
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
        : `<div class="p-empty">오늘 할 일이 없어요 🎉</div>`);
      bindChecks(content, S.ymd(today), data);
    }
    else if (tab === 'week') {
      heading.textContent = '이번 주';
      const days = S.weekDates(today);
      content.innerHTML = days.map(d => {
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
    }
    else if (tab === 'month') {
      heading.textContent = '월간';
      const y = today.getFullYear(), m = today.getMonth();
      const first = new Date(y, m, 1), pad = first.getDay();
      const dim = new Date(y, m + 1, 0).getDate();
      const cells = [];
      for (let i = 0; i < pad; i++) cells.push(null);
      for (let d = 1; d <= dim; d++) cells.push(new Date(y, m, d));
      content.innerHTML = `<div class="p-month-t">${y}. ${m + 1}</div>
        <div class="p-month">
          ${DOW.map(d => `<span class="p-mh">${d}</span>`).join('')}
          ${cells.map(d => {
            if (!d) return '<span class="p-mc empty"></span>';
            const items = itemsFor(d, data).filter(i => i.type !== 'd');
            const prog = progressOf(items);
            const hol = S.holidayName(d);
            return `<span class="p-mc ${S.isToday(d) ? 'today' : ''} ${hol ? 'hol' : ''}">
              <b>${d.getDate()}</b>${items.length ? `<i class="${prog.done === prog.total ? 'full' : ''}" style="height:${Math.max(4, prog.pct / 10)}px"></i>` : ''}</span>`;
          }).join('')}
        </div>`;
    }
    else if (tab === 'co') {
      heading.textContent = '프로젝트 현황';
      const svcByCo = {}; data.services.forEach(s => svcByCo[s.company_id] = svcByCo[s.company_id] || []);
      const procByCo = {}; const svcCo = {}; data.services.forEach(s => svcCo[s.id] = s.company_id);
      data.processes.forEach(p => { const co = svcCo[p.service_id]; if (co) (procByCo[co] = procByCo[co] || []).push(p); });
      content.innerHTML = data.companies.length ? data.companies.map(c => {
        const ps = procByCo[c.id] || [];
        const done = ps.filter(p => p.status === '종료').length;
        const cur = ps.find(p => ['진행중', '지연', '일시정지'].includes(p.status));
        return `<div class="p-co">
          <div class="p-co-h"><b>${esc(c.name)}</b><span class="badge ${statusClass(c.status)}">${esc(c.status)}</span></div>
          <div class="p-co-m">${cur ? '현재 ' + esc(cur.name) + ' · ' : ''}${ps.length ? `완료 ${done}/${ps.length}` : '항목 없음'}</div>
        </div>`;
      }).join('') : `<div class="p-empty">등록된 업체가 없어요</div>`;
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
  }

  function panelProgress(p) {
    if (!p.total) return '';
    return `<div class="p-progress ${p.done === p.total ? 'full' : ''}">
      <span style="width:${p.pct}%"></span><b>${p.pct}%</b>
    </div>`;
  }

  function bindChecks(container, dateKey, data) {
    container.querySelectorAll(`.p-task input`).forEach(cb => {
      cb.addEventListener('change', async () => {
        const t = cb.closest('.p-task');
        const day = t.closest('.p-day');
        const useDate = day ? day.dataset.date : dateKey;
        await toggle(t.dataset.type, t.dataset.id, useDate, cb.checked, data.routines, { key: t.dataset.key, title: t.dataset.title });
        cache = null; render();
      });
    });
  }

  async function toggle(type, id, date, done, routines, extra) {
    if (DB.READONLY) return;
    if (type === 'd') {
      const key = extra && extra.key;
      if (!key) return;
      const checks = await DB.list('task_checks');
      const existing = checks.find(ch => ch.deadline_key === key && ch.date === date);
      if (existing) await DB.update('task_checks', existing.id, { done });
      else await DB.insert('task_checks', { routine_id: null, deadline_key: key, person, title: (extra && extra.title) || '', date, done });
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

  document.querySelectorAll('.ptab').forEach(b => b.addEventListener('click', () => { tab = b.dataset.tab; render(); }));
  document.getElementById('p-close').addEventListener('click', () => window.mm && window.mm.closePanel());
  document.getElementById('p-open').addEventListener('click', () => window.mm && window.mm.openMain());
  document.getElementById('p-refresh').addEventListener('click', () => { cache = null; render(); });

  render();
  setInterval(() => { cache = null; render(); }, 60000);
})();
