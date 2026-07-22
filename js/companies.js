// ============================================================
//  companies.js — 프로젝트 전체 현황(업체 목록 · 필터 · 요약)
// ============================================================
window.Companies = (function () {
  const { esc, money, badge, statusClass, toast, modal, confirm } = UI;
  const state = { filter: '전체', scope: 'month', showDone: false, openId: null, layout: 'card' };
  const STATUSES = ['전체', '진행중', '일시정지', '지연', '예정', '종료'];
  const ACTIVE_STATUSES = ['진행중', '지연', '일시정지'];

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

  function isHidden(c) {
    return c && (c.hidden === true || c.hidden === 'true' || c.is_hidden === true || !!c.hidden_at);
  }

  function currentMonthRange() {
    const today = window.Schedule.startToday();
    return {
      start: new Date(today.getFullYear(), today.getMonth(), 1),
      end: new Date(today.getFullYear(), today.getMonth() + 1, 1)
    };
  }

  function currentMonthLabel() {
    const { start } = currentMonthRange();
    return `${start.getFullYear()}년 ${start.getMonth() + 1}월`;
  }

  function ymd(d) {
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  }

  function addDays(d, n) {
    const x = new Date(d);
    x.setDate(x.getDate() + n);
    return x;
  }

  function startOfWeek(d) {
    const x = new Date(d);
    x.setHours(0, 0, 0, 0);
    x.setDate(x.getDate() - x.getDay());
    return x;
  }

  function formatFullDate(d) {
    return `${d.getFullYear()}.${String(d.getMonth() + 1).padStart(2, '0')}.${String(d.getDate()).padStart(2, '0')}`;
  }

  function isoWeekValue(date) {
    const d = addDays(startOfWeek(date), 1);
    d.setHours(0, 0, 0, 0);
    d.setDate(d.getDate() + 3 - ((d.getDay() + 6) % 7));
    const week1 = new Date(d.getFullYear(), 0, 4);
    const week = 1 + Math.round(((d - week1) / 86400000 - 3 + ((week1.getDay() + 6) % 7)) / 7);
    return `${d.getFullYear()}-W${String(week).padStart(2, '0')}`;
  }

  function dateFromIsoWeek(value) {
    const m = String(value || '').match(/^(\d{4})-W(\d{2})$/);
    if (!m) return startOfWeek(window.Schedule.startToday());
    const year = Number(m[1]);
    const week = Number(m[2]);
    const jan4 = new Date(year, 0, 4);
    const jan4Day = jan4.getDay() || 7;
    const monday = new Date(year, 0, 4 - jan4Day + 1 + (week - 1) * 7);
    return startOfWeek(monday);
  }

  function nextMonthFirstWeek() {
    const today = window.Schedule.startToday();
    return startOfWeek(new Date(today.getFullYear(), today.getMonth() + 1, 1));
  }

  function inRange(value, start, end) {
    const d = parseDate(value);
    return !!(d && d >= start && d < end);
  }

  function processTouchesMonth(p, start, end) {
    if (inRange(p.start_date, start, end) || inRange(p.end_date, start, end)) return true;
    const sd = parseDate(p.start_date);
    const ed = parseDate(p.end_date);
    const running = ACTIVE_STATUSES.includes(p.status);
    if (!running) return false;
    if (sd && sd < end && (!ed || ed >= start)) return true;
    return !sd && !ed;
  }

  function companyTouchesMonth(c, procs) {
    const { start, end } = currentMonthRange();
    if (inRange(c.first_quote_date, start, end)) return true;
    if ((procs || []).some(p => processTouchesMonth(p, start, end))) return true;
    return ACTIVE_STATUSES.includes(c.status);
  }

  function groupBy(arr, key) {
    const o = {};
    arr.forEach(x => { (o[x[key]] = o[x[key]] || []).push(x); });
    return o;
  }

  function statusCounts(list) {
    const counts = { 전체: list.length, 예정: 0, 진행중: 0, 일시정지: 0, 종료: 0, 지연: 0 };
    list.forEach(c => { counts[c.status] = (counts[c.status] || 0) + 1; });
    return counts;
  }

  // 업체를 '종료'로 바꿀 때: 그 업체의 모든 서비스·프로세스 단계를 '종료'로 맞춤
  // → 업무일지의 마감항목(프로세스 기반)도 전부 체크됨(동기화)
  async function cascadeCompanyDone(companyId) {
    const services = await DB.list('services', { company_id: companyId });
    for (const s of services) {
      if (s.status !== '종료') await DB.update('services', s.id, { status: '종료' });
      const procs = await DB.list('processes', { service_id: s.id });
      for (const p of procs) {
        if (p.status !== '종료') await DB.update('processes', p.id, { status: '종료' });
      }
    }
  }

  async function render(root) {
    if (window.App && window.App.refreshSidebar) window.App.refreshSidebar();
    // 업체 상세가 열려 있으면 상세 화면으로 위임
    if (state.openId) {
      return window.Detail.render(root, state.openId, () => { state.openId = null; render(root); });
    }

    const companies = (await DB.list('companies')).sort(sortByQuoteDate);
    const serviceTemplates = await DB.list('service_templates');
    const serviceSorter = UI.serviceSorter(serviceTemplates);
    const services = (await DB.list('services')).sort(serviceSorter);
    const processes = await DB.list('processes');

    // 그룹핑
    const svcBy = groupBy(services, 'company_id');
    const svcIds = {}; services.forEach(s => svcIds[s.id] = s.company_id);
    const procByCo = {};
    processes.forEach(p => {
      const co = svcIds[p.service_id];
      if (co) (procByCo[co] = procByCo[co] || []).push(p);
    });

    const visibleCompanies = companies.filter(c => !isHidden(c));
    const hiddenCompanies = companies.filter(isHidden);
    const monthCompanies = visibleCompanies.filter(c => companyTouchesMonth(c, procByCo[c.id] || []));
    const scoped = state.scope === 'hidden'
      ? hiddenCompanies
      : (state.scope === 'all' ? visibleCompanies : monthCompanies);
    const doneFiltered = state.scope === 'hidden' || state.scope === 'all' || state.showDone
      ? scoped
      : scoped.filter(c => c.status !== '종료');
    const counts = statusCounts(doneFiltered);
    const list = (state.filter === '전체' ? doneFiltered : doneFiltered.filter(c => c.status === state.filter)).sort(sortByQuoteDate);
    const totalQuote = list.reduce((a, c) => a + (Number(c.total_quote) || 0), 0);
    const layout = state.scope === 'all' ? 'table' : state.layout;

    // 이번 주 마감 예정(오늘~+7일) — 숨김 업체는 제외
    const S = window.Schedule;
    const today = S.startToday();
    const in7 = S.addDays(today, 8);
    const deadlineCompanies = visibleCompanies.filter(c => state.showDone || c.status !== '종료');
    const deadlineCoIds = new Set(deadlineCompanies.map(c => String(c.id)));
    const deadlineServices = services.filter(s => deadlineCoIds.has(String(s.company_id)));
    const deadlineSvcIds = new Set(deadlineServices.map(s => String(s.id)));
    const deadlineProcesses = processes.filter(p => deadlineSvcIds.has(String(p.service_id)));
    const dmap = S.deadlineMap(deadlineCompanies, deadlineServices, deadlineProcesses);
    const upcoming = [];
    Object.keys(dmap).forEach(dt => {
      const d = new Date(dt + 'T00:00:00');
      if (d >= today && d < in7) dmap[dt].forEach(x => upcoming.push({ date: dt, ...x }));
    });
    upcoming.sort((a, b) => a.date.localeCompare(b.date));

    root.innerHTML = `
      <div class="page-head">
        <div>
          <div class="page-title">프로젝트 현황</div>
          <div class="page-sub">${scopeLabel()} · 표시 ${list.length}개 업체 · 총 견적 ${money(totalQuote)}(VAT포함) · 공급가 ${money(UI.vatParts(totalQuote).supply)} · 숨김 ${hiddenCompanies.length}개</div>
        </div>
        <div class="head-actions">
          ${state.scope === 'all' ? '' : `
            <div class="seg layout-seg">
              <button class="seg-btn ${layout === 'card' ? 'on' : ''}" data-layout="card">카드</button>
              <button class="seg-btn ${layout === 'table' ? 'on' : ''}" data-layout="table">표</button>
              <button class="seg-btn ${layout === 'kanban' ? 'on' : ''}" data-layout="kanban">칸반</button>
            </div>`}
          ${state.scope === 'month' ? `<button class="btn ghost" id="toggle-done">${state.showDone ? '종료업체 숨김' : '종료업체 보임'}</button>` : ''}
          <button class="btn ghost" id="co-pdf-board" title="업체별 프로세스 단계를 상태색으로 한눈에 (가로 PDF)">📄 진행 보드</button>
          <button class="btn ghost" id="co-pdf" title="업체별 진행률 + 서비스 항목별 진행현황 표 (가로 PDF)">📄 요약표</button>
          <button class="btn ghost" id="co-pdf-cal-all" title="이번 달 전체 업체 마감일 달력 PDF">📅 전체 달력</button>
          <button class="btn ghost" id="co-pdf-cal-company" title="업체를 선택해 이번 달 마감일 달력 PDF">📅 업체 달력</button>
          <button class="btn ghost only-edit" id="co-share" title="대표님께 읽기전용 웹 링크 + 암호로 공유">🔗 대표님 공유</button>
          <button class="btn primary only-edit" id="co-add">+ 새 업체</button>
        </div>
      </div>

      <div class="scope-tabs">
        <button class="scope-tab ${state.scope === 'month' ? 'on' : ''}" data-scope="month">
          현재 진행 업체<span>${monthCompanies.length}</span>
        </button>
        <button class="scope-tab ${state.scope === 'all' ? 'on' : ''}" data-scope="all">
          전체업체<span>${visibleCompanies.length}</span>
        </button>
        <button class="scope-tab ${state.scope === 'hidden' ? 'on' : ''}" data-scope="hidden">
          숨김<span>${hiddenCompanies.length}</span>
        </button>
        <div class="scope-note">${state.scope === 'all' ? '전체업체는 표 보기로 표시됩니다' : `${currentMonthLabel()} 기준`}</div>
      </div>

      <div class="overview-top">
        <div class="stat-row">
          ${stat('진행중', counts['진행중'], 'run')}
          ${stat('일시정지', counts['일시정지'], 'pause')}
          ${stat('지연', counts['지연'], 'late')}
          ${stat('종료', counts['종료'], 'done')}
          ${stat('예정', counts['예정'], 'plan')}
        </div>
        ${upcoming.length ? `
          <div class="upcoming card">
            <div class="upcoming-h">🚩 이번 주 마감 예정 <span>${upcoming.length}건</span></div>
            <div class="upcoming-list">
              ${upcoming.slice(0, 6).map(u => `
                <div class="up-item">
                  <span class="up-date">${UI.fmtDate(u.date)}</span>
                  <span class="up-co">${esc(u.company)}</span>
                  <span class="up-stage">${esc(u.service)} · ${esc(u.stage)}</span>
                </div>`).join('')}
              ${upcoming.length > 6 ? `<div class="up-more">외 ${upcoming.length - 6}건</div>` : ''}
            </div>
          </div>` : `
          <div class="upcoming card empty-up">
            <div class="upcoming-h">🚩 이번 주 마감 예정</div>
            <div class="up-none">이번 주 마감 예정인 단계가 없습니다.</div>
          </div>`}
      </div>

      <div class="legend">
        <span><i class="lg run"></i>진행중</span>
        <span><i class="lg pause"></i>일시정지</span>
        <span><i class="lg late"></i>지연</span>
        <span><i class="lg done"></i>종료</span>
        <span><i class="lg plan"></i>예정</span>
        <span class="legend-note">정렬 = 최초견적일 오래된순 · 숨김 업체는 숨김 탭에서 복원 가능</span>
      </div>

      ${layout !== 'kanban' ? `
        <div class="filter-chips">
          ${STATUSES.map(f => `
            <button class="chip ${state.filter === f ? 'on' : ''}" data-f="${f}">
              ${f}<span class="chip-n">${counts[f] || 0}</span>
            </button>`).join('')}
        </div>` : ''}

      ${layout === 'card' ? `
        <div class="co-grid">
          ${list.length ? list.map(c => coCard(c, svcBy[c.id] || [], procByCo[c.id] || [])).join('')
            : `<div class="empty"><div class="em-ic">🏢</div><p>${emptyText()}</p></div>`}
        </div>`
      : layout === 'table'
        ? tableView(list, procByCo)
        : kanbanView(doneFiltered, procByCo)}`;

    bind(root);
  }

  function scopeLabel() {
    if (state.scope === 'month') return `현재 진행 업체(${currentMonthLabel()} 기준)`;
    if (state.scope === 'hidden') return '숨김 업체 보기';
    return '전체업체';
  }

  function emptyText() {
    if (state.scope === 'month') return '이번 달 기준 현재 진행 중인 업체가 없습니다.';
    if (state.scope === 'hidden') return '숨김 처리된 업체가 없습니다.';
    return '해당 조건의 업체가 없습니다.';
  }

  function stat(label, n, cls) {
    return `<div class="stat card"><div class="stat-n ${cls}">${n}</div><div class="stat-l">${label}</div></div>`;
  }

  function statusBadgeHTML(c) {
    return DB.READONLY
      ? badge(c.status)
      : `<button class="badge ${statusClass(c.status)} badge-edit" data-status title="클릭해서 상태 변경">${esc(c.status)}</button>`;
  }

  function actionButtons(c) {
    const hidden = isHidden(c);
    return `<div class="co-actions only-edit">
      ${hidden
        ? `<button class="co-action" data-co-action data-unhide title="목록에 다시 표시">복원</button>`
        : `<button class="co-action" data-co-action data-hide title="일반 목록에서 숨김">숨김</button>`}
      <button class="co-action danger" data-co-action data-delete title="업체와 관련 항목 삭제">삭제</button>
    </div>`;
  }

  function quoteMeta(c) {
    return c.first_quote_date ? `견적 ${UI.fmtDate(c.first_quote_date)}` : '견적일 미정';
  }

  function coCard(c, svcs, procs) {
    const done = procs.filter(p => p.status === '종료').length;
    const current = procs.find(p => ACTIVE_STATUSES.includes(p.status));
    const statusBadge = statusBadgeHTML(c);
    const hidden = isHidden(c);
    const svcRows = svcs.length ? svcs.map(s => {
      const sp = procs.filter(p => String(p.service_id) === String(s.id));
      const sdone = sp.filter(p => p.status === '종료').length;
      return `<div class="co-svc">
        <span class="co-svc-name">${esc(s.name)}</span>
        <span class="co-svc-prog">${sp.length ? sdone + '/' + sp.length : '-'}</span>
        <span class="badge ${statusClass(s.status)}">${esc(s.status)}</span>
      </div>`;
    }).join('') : '<div class="co-svc-empty">서비스 항목 미설정</div>';
    return `
      <div class="co-card card ${hidden ? 'hidden-co' : ''}" data-id="${c.id}">
        <div class="co-card-head">
          <div class="co-name">${esc(c.name)}${hidden ? '<span class="hidden-tag">숨김</span>' : ''}</div>
          ${statusBadge}
        </div>
        <div class="co-meta">
          <span>${esc(quoteMeta(c))}</span><i>·</i><span>${esc(c.rep_name || '-')}</span><i>·</i><span>${esc(c.item || '-')}</span>
        </div>
        <div class="co-quote">${UI.moneyVatHTML(c.total_quote)}</div>
        <div class="co-svc-title">서비스 항목별 상태</div>
        <div class="co-services">${svcRows}</div>
        <div class="co-stage-txt">
          ${procs.length ? `전체 완료 ${done}/${procs.length}단계${current ? ` · 현재 ${esc(current.name)}` : ''}` : '프로세스 없음'}
        </div>
        <div class="co-foot">
          <span class="co-mgr">👤 ${esc(c.manager || '미지정')}</span>
          <div class="co-foot-r">
            ${actionButtons(c)}
            <span class="co-open">상세 보기 →</span>
          </div>
        </div>
      </div>`;
  }

  // 표(그리드) 보기
  function tableView(list, procByCo) {
    if (!list.length) return `<div class="empty"><div class="em-ic">🏢</div><p>${emptyText()}</p></div>`;
    return `<div class="co-table-wrap"><table class="co-table">
      <thead><tr>
        <th>최초견적일</th><th>업체명</th><th>대표자</th><th>아이템</th><th class="right">총견적</th><th>담당자</th><th>진행</th><th>상태</th><th class="only-edit">관리</th>
      </tr></thead>
      <tbody>
        ${list.map(c => {
          const procs = procByCo[c.id] || [];
          const done = procs.filter(p => p.status === '종료').length;
          const pct = procs.length ? Math.round(done / procs.length * 100) : 0;
          return `<tr class="co-row ${isHidden(c) ? 'hidden-co' : ''}" data-id="${c.id}">
            <td>${esc(c.first_quote_date || '-')}</td>
            <td class="tc-name">${esc(c.name)}${isHidden(c) ? '<span class="hidden-tag">숨김</span>' : ''}</td>
            <td>${esc(c.rep_name || '-')}</td>
            <td>${esc(c.item || '-')}</td>
            <td class="right"><span class="money-cell">${UI.moneyVatHTML(c.total_quote)}</span></td>
            <td>${esc(c.manager || '-')}</td>
            <td><div class="tc-prog"><span class="tc-bar"><i style="width:${pct}%"></i></span><span class="tc-frac">${procs.length ? done + '/' + procs.length : '-'}</span></div></td>
            <td>${statusBadgeHTML(c)}</td>
            <td class="only-edit">${actionButtons(c)}</td>
          </tr>`;
        }).join('')}
      </tbody></table></div>`;
  }

  // 상태별 칸반 보기
  function kanbanView(companies, procByCo) {
    const cols = ['예정', '진행중', '일시정지', '지연', '종료'];
    return `<div class="kanban">
      ${cols.map(st => {
        const items = companies.filter(c => c.status === st).sort(sortByQuoteDate);
        return `<div class="kan-col">
          <div class="kan-head ${statusClass(st)}"><span>${st}</span><span class="kan-n">${items.length}</span></div>
          <div class="kan-list">
            ${items.length ? items.map(c => {
              const procs = procByCo[c.id] || [];
              const done = procs.filter(p => p.status === '종료').length;
              const cur = procs.find(p => ACTIVE_STATUSES.includes(p.status));
              return `<div class="kan-card st-${statusClass(st)} ${isHidden(c) ? 'hidden-co' : ''}" data-id="${c.id}">
                <div class="kan-name">${esc(c.name)}${isHidden(c) ? '<span class="hidden-tag">숨김</span>' : ''}</div>
                <div class="kan-quote">${UI.moneyVatHTML(c.total_quote)}</div>
                <div class="kan-meta">${esc(quoteMeta(c))} · ${cur ? '현재 ' + esc(cur.name) + ' · ' : ''}${procs.length ? done + '/' + procs.length + '단계' : '항목 없음'}</div>
                ${actionButtons(c)}
              </div>`;
            }).join('') : '<div class="kan-empty">없음</div>'}
          </div>
        </div>`;
      }).join('')}
    </div>`;
  }

  function bind(root) {
    root.querySelectorAll('.layout-seg .seg-btn').forEach(b =>
      b.addEventListener('click', () => { state.layout = b.dataset.layout; render(root); }));
    root.querySelectorAll('.scope-tab').forEach(b =>
      b.addEventListener('click', () => { state.scope = b.dataset.scope; state.filter = '전체'; render(root); }));
    root.querySelector('#toggle-done')?.addEventListener('click', () => {
      state.showDone = !state.showDone;
      state.filter = state.showDone ? state.filter : (state.filter === '종료' ? '전체' : state.filter);
      render(root);
    });
    root.querySelectorAll('.chip').forEach(b =>
      b.addEventListener('click', () => { state.filter = b.dataset.f; render(root); }));

    // 카드 / 표 행 / 칸반 카드 공통: 클릭 → 상세, 상태배지/관리버튼 → 자체 처리
    root.querySelectorAll('.co-card, .co-row, .kan-card').forEach(el => {
      const id = el.dataset.id;
      el.addEventListener('click', (e) => {
        if (e.target.closest('[data-status], [data-co-action]')) return;
        state.openId = id; render(root);
      });
      el.addEventListener('contextmenu', (e) => {
        if (e.target.closest('[data-status], [data-co-action]')) return;
        e.preventDefault();
        showContextMenu(root, e, id, isHiddenFromElement(el));
      });
    });
    root.querySelectorAll('[data-status]').forEach(sbtn => {
      const host = sbtn.closest('[data-id]');
      const id = host && host.dataset.id;
      sbtn.addEventListener('click', (e) => {
        e.stopPropagation();
        UI.statusPicker(sbtn, sbtn.textContent.trim(), async (s) => {
          await DB.update('companies', id, { status: s });
          // 업체를 '종료'로 바꾸면 전체 단계·서비스도 완료(종료) 처리 → 업무일지 마감항목 체크와 동기화
          if (s === '종료') { await cascadeCompanyDone(id); UI.toast('업체와 모든 단계를 완료(종료) 처리했습니다'); }
          else UI.toast('상태를 변경했습니다');
          render(root);
        });
      });
    });
    root.querySelectorAll('[data-hide]').forEach(b => b.addEventListener('click', (e) => {
      e.stopPropagation();
      setHidden(b.closest('[data-id]').dataset.id, true).then(() => render(root));
    }));
    root.querySelectorAll('[data-unhide]').forEach(b => b.addEventListener('click', (e) => {
      e.stopPropagation();
      setHidden(b.closest('[data-id]').dataset.id, false).then(() => render(root));
    }));
    root.querySelectorAll('[data-delete]').forEach(b => b.addEventListener('click', (e) => {
      e.stopPropagation();
      const id = b.closest('[data-id]').dataset.id;
      confirm('이 업체와 연결된 서비스 항목, 프로세스 단계를 모두 삭제할까요?', async () => {
        await deleteCompany(id);
        render(root);
      }, true);
    }));

    root.querySelector('#co-add')?.addEventListener('click', () => editCompany(root));
    root.querySelector('#co-pdf')?.addEventListener('click', () => window.PDF.companies());
    root.querySelector('#co-pdf-board')?.addEventListener('click', () => window.PDF.progressBoard());
    root.querySelector('#co-pdf-cal-all')?.addEventListener('click', () => openCalendarPdfRange());
    root.querySelector('#co-pdf-cal-company')?.addEventListener('click', () => openCalendarPdfPicker());
    root.querySelector('#co-share')?.addEventListener('click', () => window.Share && window.Share.open());
  }

  function calendarRangeControls() {
    const thisWeek = startOfWeek(window.Schedule.startToday());
    const nextWeek = addDays(thisWeek, 7);
    const nextMonth = nextMonthFirstWeek();
    return `
      <div class="cal-range-box">
        <div class="cal-range-grid">
          <div class="field">
            <label>시작 주</label>
            <input class="input" id="cal-start-week" type="week" value="${isoWeekValue(thisWeek)}">
          </div>
          <div class="field">
            <label>기간</label>
            <select class="select" id="cal-weeks">
              <option value="1">1주</option>
              <option value="2">2주</option>
              <option value="4" selected>4주</option>
              <option value="6">6주</option>
              <option value="8">8주</option>
            </select>
          </div>
        </div>
        <div class="cal-week-presets">
          <button type="button" data-cal-week="${isoWeekValue(thisWeek)}">이번 주</button>
          <button type="button" data-cal-week="${isoWeekValue(nextWeek)}">다음 주</button>
          <button type="button" data-cal-week="${isoWeekValue(nextMonth)}">다음 달 첫 주</button>
          <button type="button" data-cal-week="${isoWeekValue(nextMonth)}" data-cal-weeks="6">다음 달 6주</button>
        </div>
        <div class="cal-range-preview" id="cal-range-preview"></div>
      </div>`;
  }

  function readCalendarRange(m) {
    const start = dateFromIsoWeek(m.querySelector('#cal-start-week')?.value);
    const weeks = Math.max(1, Math.min(12, Number(m.querySelector('#cal-weeks')?.value) || 4));
    return { startDate: ymd(start), weeks };
  }

  function bindCalendarRangeControls(m) {
    const weekInput = m.querySelector('#cal-start-week');
    const weeksSelect = m.querySelector('#cal-weeks');
    const preview = m.querySelector('#cal-range-preview');
    const update = () => {
      const range = readCalendarRange(m);
      const start = new Date(range.startDate + 'T00:00:00');
      const end = addDays(start, range.weeks * 7 - 1);
      if (preview) preview.textContent = `${formatFullDate(start)} ~ ${formatFullDate(end)} · ${range.weeks}주`;
    };
    m.querySelectorAll('[data-cal-week]').forEach(btn => {
      btn.addEventListener('click', () => {
        if (weekInput) weekInput.value = btn.dataset.calWeek;
        if (btn.dataset.calWeeks && weeksSelect) weeksSelect.value = btn.dataset.calWeeks;
        update();
      });
    });
    if (weekInput) weekInput.addEventListener('change', update);
    if (weeksSelect) weeksSelect.addEventListener('change', update);
    update();
  }

  function openCalendarPdfRange() {
    modal({
      title: '전체 달력 PDF',
      wide: true,
      bodyHTML: `
        <p class="cal-pdf-lead">마감일 기준으로 전체 업체 달력을 저장합니다. 시작 주와 출력 기간을 주 단위로 선택하세요.</p>
        ${calendarRangeControls()}`,
      saveLabel: 'PDF 저장',
      onOpen: bindCalendarRangeControls,
      onSave: async (m) => {
        window.PDF.calendar(null, readCalendarRange(m));
      }
    });
  }

  async function openCalendarPdfPicker() {
    const companies = (await DB.list('companies')).filter(c => !isHidden(c)).sort(sortByQuoteDate);
    modal({
      title: '업체 달력 PDF',
      wide: true,
      bodyHTML: `
        <p class="cal-pdf-lead">마감일 기준으로 업체별 달력을 저장합니다. 시작 주와 출력 기간을 고른 뒤 업체를 눌러 주세요.</p>
        ${calendarRangeControls()}
        <div class="cal-pdf-pick">
          ${companies.length ? companies.map(c => `
            <button type="button" class="cal-pdf-row" data-cal-co="${c.id}">
              <span class="cal-pdf-dot" style="${UI.companyDotStyle(c.id)}"></span>
              <span class="cal-pdf-name">${esc(c.name)}</span>
              <span class="cal-pdf-meta">${esc(c.item || '항목 미정')} · 담당 ${esc(c.manager || '미지정')}</span>
            </button>`).join('') : '<div class="cal-pdf-empty">표시할 업체가 없습니다.</div>'}
        </div>`,
      saveLabel: '닫기',
      onOpen: (m) => {
        bindCalendarRangeControls(m);
        m.querySelectorAll('[data-cal-co]').forEach(btn => {
          btn.addEventListener('click', () => window.PDF.calendar(btn.dataset.calCo, readCalendarRange(m)));
        });
      }
    });
  }

  function isHiddenFromElement(el) {
    return !!(el && el.classList.contains('hidden-co'));
  }

  function closeContextMenu() {
    document.querySelectorAll('.co-context').forEach(m => m.remove());
    document.removeEventListener('keydown', closeContextOnEscape);
  }

  function closeContextOnEscape(e) {
    if (e.key === 'Escape') closeContextMenu();
  }

  function showContextMenu(root, e, id, hidden) {
    closeContextMenu();
    const menu = document.createElement('div');
    menu.className = 'co-context';
    menu.innerHTML = `
      <button data-ctx="open">상세 보기</button>
      ${DB.READONLY ? '' : `
        <div class="ctx-sep"></div>
        <button data-ctx="duplicate">복제</button>
        <button data-ctx="${hidden ? 'unhide' : 'hide'}">${hidden ? '숨김 해제' : '숨김 처리'}</button>
        <button class="danger" data-ctx="delete">삭제</button>`}
    `;
    document.body.appendChild(menu);
    const rect = menu.getBoundingClientRect();
    menu.style.left = Math.max(8, Math.min(e.clientX, window.innerWidth - rect.width - 8)) + 'px';
    menu.style.top = Math.max(8, Math.min(e.clientY, window.innerHeight - rect.height - 8)) + 'px';

    menu.addEventListener('click', async (ev) => {
      ev.stopPropagation();
      const btn = ev.target.closest('[data-ctx]');
      if (!btn) return;
      const action = btn.dataset.ctx;
      closeContextMenu();
      if (action === 'open') {
        state.openId = id;
        render(root);
      } else if (action === 'duplicate') {
        await duplicateCompany(id);
        render(root);
      } else if (action === 'hide') {
        await setHidden(id, true);
        render(root);
      } else if (action === 'unhide') {
        await setHidden(id, false);
        render(root);
      } else if (action === 'delete') {
        confirm('이 업체와 연결된 서비스 항목, 프로세스 단계를 모두 삭제할까요?', async () => {
          await deleteCompany(id);
          render(root);
        }, true);
      }
    });

    setTimeout(() => document.addEventListener('click', closeContextMenu, { once: true }), 0);
    document.addEventListener('keydown', closeContextOnEscape);
  }

  async function setHidden(id, hidden) {
    try {
      await DB.update('companies', id, { hidden });
    } catch (e) {
      console.error(e);
      toast('숨김 저장에 실패했습니다. 클라우드 사용 시 hidden 컬럼을 추가해 주세요.');
      return false;
    }
    if (window.App && window.App.refreshSidebar) window.App.refreshSidebar();
    toast(hidden ? '숨김 처리했습니다' : '숨김을 해제했습니다');
    return true;
  }

  async function deleteCompany(id) {
    const services = await DB.list('services', { company_id: id });
    for (const s of services) {
      const ps = await DB.list('processes', { service_id: s.id });
      for (const p of ps) await DB.remove('processes', p.id);
      await DB.remove('services', s.id);
    }
    await DB.remove('companies', id);
    if (state.openId === id) state.openId = null;
    if (window.App && window.App.refreshSidebar) window.App.refreshSidebar();
    toast('업체를 삭제했습니다');
  }

  async function duplicateCompany(id) {
    const source = (await DB.list('companies', { id }))[0];
    if (!source) { toast('복제할 업체를 찾지 못했습니다'); return null; }
    const companyCount = (await DB.list('companies')).length;
    const clone = await DB.insert('companies', {
      name: `${source.name || '업체'} (복제)`,
      rep_name: source.rep_name || '',
      item: source.item || '',
      contact: source.contact || '',
      first_quote_date: source.first_quote_date || null,
      total_quote: Number(source.total_quote) || 0,
      manager: source.manager || '',
      status: source.status || '예정',
      hidden: false,
      memo: source.memo || '',
      sort_order: companyCount + 1
    });

    const services = (await DB.list('services', { company_id: id })).sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0));
    for (let i = 0; i < services.length; i++) {
      const s = services[i];
      const svc = await DB.insert('services', {
        company_id: clone.id,
        template_id: s.template_id || null,
        name: s.name || '',
        category: s.category || '기타',
        amount: Number(s.amount) || 0,
        status: s.status || '예정',
        sort_order: s.sort_order ?? (i + 1)
      });
      const processes = (await DB.list('processes', { service_id: s.id })).sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0));
      for (let j = 0; j < processes.length; j++) {
        const p = processes[j];
        await DB.insert('processes', {
          service_id: svc.id,
          name: p.name || '',
          assignee: p.assignee || '',
          start_date: p.start_date || null,
          end_date: p.end_date || null,
          status: p.status || '예정',
          memo: p.memo || '',
          sort_order: p.sort_order ?? (j + 1)
        });
      }
    }

    if (window.App && window.App.refreshSidebar) window.App.refreshSidebar();
    toast('업체를 복제했습니다');
    return clone;
  }

  // ---------- 업체 추가/수정 모달 ----------
  function editCompany(root, c) {
    const isNew = !c;
    modal({
      title: isNew ? '새 업체 추가' : '업체 정보 수정',
      wide: true,
      bodyHTML: `
        <div class="grid-2">
          <div class="field"><label>업체명 *</label><input class="input" id="f-name" value="${c ? esc(c.name) : ''}"></div>
          <div class="field"><label>대표자</label><input class="input" id="f-rep" value="${c ? esc(c.rep_name) : ''}"></div>
          <div class="field"><label>아이템 / 업종</label><input class="input" id="f-item" value="${c ? esc(c.item) : ''}"></div>
          <div class="field"><label>연락처</label><input class="input" id="f-contact" value="${c ? esc(c.contact) : ''}"></div>
          <div class="field"><label>최초견적일</label><input class="input" id="f-date" type="date" value="${c ? (c.first_quote_date || '') : ''}"></div>
          <div class="field"><label>총 견적 (원, VAT 포함)</label><input class="input" id="f-quote" type="number" value="${c ? c.total_quote : ''}"><span class="help-text">서비스 항목 금액이 있으면 합계로 자동 갱신됩니다.</span></div>
          <div class="field"><label>내부 담당자</label><input class="input" id="f-mgr" value="${c ? esc(c.manager) : ''}"></div>
          <div class="field"><label>진행단계</label><select class="select" id="f-status">${UI.statusOptions(c ? c.status : '예정')}</select></div>
        </div>
        <div class="field"><label>비고</label><textarea class="input" id="f-memo">${c ? esc(c.memo) : ''}</textarea></div>`,
      saveLabel: isNew ? '추가' : '저장',
      onSave: async (m) => {
        const v = id => m.querySelector(id).value;
        const name = v('#f-name').trim();
        if (!name) { toast('업체명을 입력하세요'); return false; }
        const payload = {
          name, rep_name: v('#f-rep').trim(), item: v('#f-item').trim(), contact: v('#f-contact').trim(),
          first_quote_date: v('#f-date') || null, total_quote: Number(v('#f-quote')) || 0,
          manager: v('#f-mgr').trim(), status: v('#f-status'), memo: v('#f-memo').trim()
        };
        if (isNew) {
          const cnt = (await DB.list('companies')).length;
          const co = await DB.insert('companies', { ...payload, hidden: false, sort_order: cnt + 1 });
          toast('업체를 추가했습니다');
          state.openId = co.id; // 바로 상세로 이동해 항목 설정 유도
        } else {
          await DB.update('companies', c.id, payload);
          toast('저장했습니다');
        }
        render(root);
      }
    });
  }

  function open(id, root) { state.openId = id; render(root); }
  function close(root) { state.openId = null; render(root); }
  function resetOpen() { state.openId = null; }

  return {
    render, editCompany, open, close, resetOpen, setHidden, deleteCompany, duplicateCompany,
    sortByQuoteDate, isHidden, companyTouchesMonth,
    isActiveStatus: (status) => ACTIVE_STATUSES.includes(status)
  };
})();
