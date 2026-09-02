// ============================================================
//  client.js — 클라이언트 열람용 대시보드(읽기 전용)
//  · 링크의 # 뒤 열쇠로 data.js 의 암호문을 복호화해서 그린다.
//    (# 뒤는 서버로 전송되지 않으므로 접속 로그에 열쇠가 남지 않는다)
//  · 금액은 애초에 데이터에 들어있지 않다(빌드 단계에서 제외).
// ============================================================
(function () {
  const app = document.getElementById('app');
  const esc = (s) => String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');

  let D = null;                 // 복호화된 데이터
  let calAnchor = new Date();   // 달력 기준월(부팅 시 일정이 있는 달로 맞춘다)
  let dlvFilter = '';           // 작업물 카테고리 필터
  let reqOpen = false;          // 요청사항 전체 펼침
  let reqTab = 'todo';          // 요청사항 탭(접수 전 / 접수 완료)

  // ---------- 날짜 ----------
  const DOW = ['일', '월', '화', '수', '목', '금', '토'];
  const HOLIDAYS = {
    '2026-01-01': '신정',
    '2026-02-16': '설날 연휴', '2026-02-17': '설날', '2026-02-18': '설날 연휴',
    '2026-03-01': '삼일절', '2026-03-02': '삼일절 대체',
    '2026-05-05': '어린이날', '2026-05-24': '부처님오신날', '2026-05-25': '대체공휴일',
    '2026-06-06': '현충일',
    '2026-08-15': '광복절', '2026-08-17': '광복절 대체',
    '2026-09-24': '추석 연휴', '2026-09-25': '추석', '2026-09-26': '추석 연휴', '2026-09-28': '추석 대체',
    '2026-10-03': '개천절', '2026-10-05': '개천절 대체', '2026-10-09': '한글날',
    '2026-12-25': '성탄절'
  };
  const pad = (n) => String(n).padStart(2, '0');
  const ymd = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  function today() { const d = new Date(); d.setHours(0, 0, 0, 0); return d; }
  function parseYmd(s) {
    if (!s) return null;
    const p = String(s).slice(0, 10).split('-').map(Number);
    if (p.length !== 3 || p.some(isNaN)) return null;
    const d = new Date(p[0], p[1] - 1, p[2]); d.setHours(0, 0, 0, 0); return d;
  }
  function fmtDate(s) {
    const d = parseYmd(s); if (!d) return '-';
    return `${d.getMonth() + 1}월 ${d.getDate()}일(${DOW[d.getDay()]})`;
  }
  function fmtShort(s) {
    const d = parseYmd(s); if (!d) return '-';
    return `${pad(d.getMonth() + 1)}.${pad(d.getDate())}`;
  }
  function dday(s) {
    const d = parseYmd(s); if (!d) return null;
    return Math.round((d - today()) / 86400000);
  }
  function ddayText(n) {
    if (n == null) return '';
    if (n === 0) return 'D-DAY';
    return n > 0 ? 'D-' + n : 'D+' + Math.abs(n);
  }
  function agoText(iso) {
    if (!iso) return '';
    const t = new Date(iso);
    if (isNaN(t)) return '';
    const min = Math.floor((Date.now() - t.getTime()) / 60000);
    if (min < 2) return '방금 전';
    if (min < 60) return `${min}분 전`;
    const h = Math.floor(min / 60);
    if (h < 24) return `${h}시간 전`;
    return `${Math.floor(h / 24)}일 전`;
  }

  const STCLS = { '예정': 'plan', '진행중': 'run', '일시정지': 'pause', '종료': 'done', '지연': 'late' };
  const stCls = (s) => STCLS[s] || 'plan';
  const badge = (s) => `<span class="badge ${stCls(s)}">${esc(s || '예정')}</span>`;

  // ============================================================
  //  부팅 — 복호화
  // ============================================================
  function b64uToBytes(s) {
    let t = String(s).replace(/-/g, '+').replace(/_/g, '/');
    while (t.length % 4) t += '=';
    const bin = atob(t);
    const u = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i);
    return u;
  }

  function fail(title, msg) {
    app.innerHTML = `
      <div class="boot err">
        <div class="boot-mark">MM</div>
        <h1>${esc(title)}</h1>
        <p>${msg}</p>
      </div>`;
  }

  const LSK = 'mm-client-key';

  async function boot() {
    const enc = window.MM_ENC;
    if (!enc) return fail('페이지를 불러오지 못했습니다', '잠시 후 다시 열어 주세요.');

    // 열쇠는 링크의 # 뒤에서 읽고, 한 번 열면 이 기기에만 기억해 둔다.
    // (홈 화면에 추가해서 열 때처럼 주소에 # 이 없는 경우를 위해)
    const m = (location.hash || '').match(/[#&]k=([A-Za-z0-9\-_]+)/);
    let k = m ? m[1] : '';
    if (!k) { try { k = localStorage.getItem(LSK) || ''; } catch (e) {} }
    if (!k) {
      return fail('링크가 올바르지 않습니다',
        '주소의 뒷부분이 잘린 것 같습니다.<br>전달받은 링크를 <b>전체 복사</b>해서 다시 열어 주세요.');
    }
    try {
      const key = await crypto.subtle.importKey('raw', b64uToBytes(k), { name: 'AES-GCM' }, false, ['decrypt']);
      const buf = await crypto.subtle.decrypt(
        { name: 'AES-GCM', iv: b64uToBytes(enc.iv) }, key, b64uToBytes(enc.ct));
      D = JSON.parse(new TextDecoder().decode(buf));
      try { localStorage.setItem(LSK, k); } catch (e) {}
    } catch (e) {
      try { localStorage.removeItem(LSK); } catch (e2) {}
      return fail('링크가 만료되었거나 올바르지 않습니다',
        '담당자에게 새 링크를 요청해 주세요.');
    }
    document.title = (D.company && D.company.name ? D.company.name + ' · ' : '') + '프로젝트 현황';
    calAnchor = bestCalendarMonth();
    render();
  }

  // 달력 첫 화면 — 이번 달이 비어 있으면 일정이 실제로 있는 달로 맞춰 연다.
  // (안 그러면 지난 일정만 있는 프로젝트에서 빈 달력이 보인다)
  function bestCalendarMonth() {
    const rows = scheduleRows();
    if (!rows.length) return new Date();
    const mk = (s) => { const d = parseYmd(s); return new Date(d.getFullYear(), d.getMonth(), 1); };
    const thisMonth = ymd(new Date()).slice(0, 7);
    if (rows.some(r => String(r.end_date).slice(0, 7) === thisMonth)) return new Date();
    const upcoming = rows.filter(r => r.d >= 0);
    if (upcoming.length) return mk(upcoming[0].end_date);          // 가장 가까운 앞날
    return mk(rows[rows.length - 1].end_date);                     // 없으면 가장 최근 일정
  }

  // ============================================================
  //  집계
  // ============================================================
  function procsOf(serviceId) {
    return (D.processes || []).filter(p => String(p.service_id) === String(serviceId))
      .sort((a, b) => (a.sort_order || 0) - (b.sort_order || 0));
  }
  function progress() {
    const all = D.processes || [];
    const done = all.filter(p => p.status === '종료').length;
    return { done, total: all.length, pct: all.length ? Math.round(done / all.length * 100) : 0 };
  }
  // 다가오는 주요일정(마감일 있고 아직 안 끝난 것) — 가까운 순
  function milestones(limit) {
    const rows = (D.processes || [])
      .filter(p => p.milestone && p.end_date && p.status !== '종료')
      .map(p => ({ ...p, d: dday(p.end_date) }))
      .filter(p => p.d != null)
      .sort((a, b) => a.d - b.d);
    return limit ? rows.slice(0, limit) : rows;
  }
  function svcName(serviceId) {
    const s = (D.services || []).find(x => String(x.id) === String(serviceId));
    return s ? s.name : '';
  }
  function scheduleRows() {
    return (D.processes || []).filter(p => p.end_date)
      .map(p => ({ ...p, service: svcName(p.service_id), d: dday(p.end_date) }))
      .sort((a, b) => String(a.end_date).localeCompare(String(b.end_date)));
  }

  // ============================================================
  //  렌더
  // ============================================================
  function render() {
    const c = D.company || {};
    app.innerHTML =
      header(c) +
      `<main class="wrap">` +
        progressSection() +
        managerBar(c) +
        requestsSection() +
        widgetsSection() +
        noteSection(c) +
        scheduleSection() +
        deliveriesSection() +
      `</main>` +
      footer();
    bind();
  }

  // ---------- 1. 헤더 (+ D-day 한 줄) ----------
  function header(c) {
    const next = milestones(1)[0];
    return `
      <header class="hd">
        <div class="hd-in">
          <div class="hd-mark">MM</div>
          <div class="hd-txt">
            <h1>${esc(c.name || '프로젝트')}</h1>
            <span>${c.item ? esc(c.item) + ' · ' : ''}업데이트 ${esc(agoText(c.updated_at) || '-')}</span>
          </div>
          <span class="hd-badge">${esc(c.status || '진행중')}</span>
        </div>
        ${next ? `
          <div class="dday-bar">
            <span class="dd-ic">⭐</span>
            <span class="dd-name">${esc(next.name)}</span>
            <b class="dd-num ${next.d <= 3 ? 'soon' : ''}">${ddayText(next.d)}</b>
            <span class="dd-date">${esc(fmtDate(next.end_date))}</span>
          </div>` : ''}
      </header>`;
  }

  // ---------- 2. 진행 현황 (접힘 기본) ----------
  function progressSection() {
    const p = progress();
    const changes = (D.changes || []).slice(0, 3);
    return `
      <section class="sec">
        <button class="prog-head" id="prog-toggle" aria-expanded="false">
          <div class="prog-row">
            <h2>진행 현황</h2>
            <span class="prog-pct">${p.pct}%</span>
          </div>
          <div class="bar"><span style="width:${p.pct}%"></span></div>
          <div class="prog-sub">
            <span>전체 ${p.total}단계 중 ${p.done}단계 완료</span>
            <span class="more">자세히 보기 <i class="caret">▾</i></span>
          </div>
        </button>
        <div class="prog-body" id="prog-body" hidden>
          ${changes.length ? `
            <div class="changes">
              <div class="changes-t">최근 변경</div>
              ${changes.map(ch => `<div class="change"><span class="ch-d">${esc(fmtShort(ch.date))}</span><span>${esc(ch.text)}</span></div>`).join('')}
            </div>` : ''}
          ${(D.services || []).length
            ? (D.services || []).map(svcBlock).join('')
            : `<p class="none">등록된 항목이 없습니다.</p>`}
        </div>
      </section>`;
  }

  function svcBlock(s) {
    const ps = procsOf(s.id);
    const done = ps.filter(x => x.status === '종료').length;
    const pct = ps.length ? Math.round(done / ps.length * 100) : 0;
    return `
      <div class="svc">
        <div class="svc-h">
          <b>${esc(s.name)}</b>
          ${badge(s.status)}
          <span class="svc-pct">${pct}%</span>
        </div>
        <div class="bar sm"><span style="width:${pct}%"></span></div>
        <ul class="steps">
          ${ps.length ? ps.map(p => `
            <li class="step ${stCls(p.status)}">
              <span class="step-dot"></span>
              <div class="step-main">
                <span class="step-name">${esc(p.name)}</span>
                ${p.client_memo ? `<span class="step-memo">${esc(p.client_memo)}</span>` : ''}
              </div>
              ${p.milestone ? '<span class="step-star">⭐</span>' : ''}
              <span class="step-date">${p.end_date ? esc(fmtShort(p.end_date)) : '미정'}</span>
              ${badge(p.status)}
            </li>`).join('')
            : '<li class="none">단계 정보가 없습니다.</li>'}
        </ul>
      </div>`;
  }

  // ---------- 담당자 (진행현황 바로 아래, 한 줄) ----------
  function managerBar(c) {
    const m = (c && c.manager) || null;
    if (!m || !m.name) return '';
    const tel = String(m.contact || '').replace(/[^0-9+]/g, '');
    return `
      <div class="mgr-bar">
        <div class="mgr-av">${esc(String(m.name).slice(0, 1))}</div>
        <div class="mgr-main">
          <span class="mgr-n">${esc(m.name)} <em>담당</em></span>
          <span class="mgr-c">엠엠컨설팅연구소</span>
        </div>
        ${m.contact ? `<a class="mgr-ic" href="tel:${esc(tel)}" title="${esc(m.contact)}">📞 ${esc(m.contact)}</a>` : ''}
        ${m.email ? `<a class="mgr-ic ghost" href="mailto:${esc(m.email)}" title="${esc(m.email)}">✉</a>` : ''}
      </div>`;
  }

  // ---------- 3. 요청사항 (중요만 먼저 · 펼치면 접수 전/완료 탭) ----------
  const isImportant = (r) => !!r.important;

  function requestsSection() {
    const rows = D.requests || [];
    if (!rows.length) return '';
    const done = rows.filter(r => r.done);
    const todo = rows.filter(r => !r.done);
    const pct = Math.round(done.length / rows.length * 100);

    const bySort = (a, b) => (a.sort_order || 0) - (b.sort_order || 0);
    // 접힘 상태: 중요 표시된 미완료 항목. 없으면 미완료 앞쪽 3건.
    const important = todo.filter(isImportant).sort(bySort);
    const brief = important.length ? important : todo.slice().sort(bySort).slice(0, 3);
    const hidden = rows.length - brief.length;

    const list = (arr) => arr.length
      ? `<ul class="reqs">${arr.map(reqItem).join('')}</ul>`
      : `<p class="none">해당 항목이 없습니다.</p>`;

    return `
      <section class="sec">
        <button class="req-head ${reqOpen ? 'open' : ''}" id="req-toggle" aria-expanded="${reqOpen}">
          <div class="prog-row">
            <h2>요청사항</h2>
            <span class="prog-pct sm">${done.length}<i>/${rows.length}</i></span>
          </div>
          <div class="bar sm"><span style="width:${pct}%"></span></div>
          <div class="prog-sub">
            <span>${important.length ? `중요 ${important.length}건 먼저 보기` : `남은 요청 ${todo.length}건`}</span>
            <span class="more">${reqOpen ? '접기' : `전체 보기${hidden > 0 ? ` (+${hidden})` : ''}`} <i class="caret">▾</i></span>
          </div>
        </button>

        ${reqOpen ? '' : list(brief)}

        <div class="req-body" ${reqOpen ? '' : 'hidden'}>
          <div class="tabs sm">
            <button class="tab ${reqTab === 'todo' ? 'on' : ''}" data-rtab="todo">접수 전 ${todo.length}</button>
            <button class="tab ${reqTab === 'done' ? 'on' : ''}" data-rtab="done">접수 완료 ${done.length}</button>
          </div>
          ${list((reqTab === 'done' ? done : todo).slice().sort((a, b) => {
            if (reqTab === 'todo' && isImportant(a) !== isImportant(b)) return isImportant(a) ? -1 : 1;
            return bySort(a, b);
          }))}
        </div>

        <p class="sec-sub">확인하거나 전달해 주실 항목입니다. 자료 전달, 시안 확인, 표시사항 검토 등이 포함되며 처리되면 자동으로 체크됩니다.</p>
      </section>`;
  }

  function reqItem(r) {
    return `
      <li class="req ${r.done ? 'done' : ''} ${isImportant(r) && !r.done ? 'imp' : ''}">
        <span class="req-box">${r.done ? '✓' : ''}</span>
        <div class="req-main">
          <span class="req-t">${isImportant(r) && !r.done ? '<i class="req-star">★</i>' : ''}${esc(r.title)}</span>
          ${r.memo ? `<span class="req-m">${esc(r.memo)}</span>` : ''}
        </div>
        ${r.due_date ? `<span class="req-due">~${esc(fmtShort(r.due_date))}</span>` : ''}
      </li>`;
  }

  // ---------- 4. 위젯 (다가오는 주요일정) ----------
  function widgetsSection() {
    const ms = milestones(3);
    if (!ms.length) return '';
    return `
      <div class="widgets">
        <div class="w">
          <h3>다가오는 주요일정</h3>
          <ul class="dd-list">
            ${ms.map(p => `
              <li>
                <b class="dd-num ${p.d <= 3 ? 'soon' : ''}">${ddayText(p.d)}</b>
                <div class="dd-main">
                  <span class="dd-n">${esc(p.name)}</span>
                  <span class="dd-s">${esc(svcName(p.service_id))} · ${esc(fmtDate(p.end_date))}</span>
                </div>
              </li>`).join('')}
          </ul>
        </div>
      </div>`;
  }

  // ---------- 5. 메모 ----------
  function noteSection(c) {
    if (!c.client_note) return '';
    return `<section class="note"><span class="note-ic">📌</span><div>${esc(c.client_note).replace(/\n/g, '<br>')}</div></section>`;
  }

  // ---------- 6. 일정 (달력) ----------
  function scheduleSection() {
    const undated = (D.processes || []).filter(p => !p.end_date && p.status !== '종료').length;
    return `
      <section class="sec">
        <div class="sec-h"><h2>일정</h2></div>
        <div id="sch-body">${schedBody()}</div>
        ${undated ? `<p class="sec-sub">아직 날짜가 정해지지 않은 단계 ${undated}건은 위 <b>진행 현황</b>에서 확인하실 수 있습니다.</p>` : ''}
      </section>`;
  }

  function schedBody() { return schedCal(); }

  function schedCal() {
    const y = calAnchor.getFullYear(), mo = calAnchor.getMonth();
    const first = new Date(y, mo, 1);
    const start = new Date(y, mo, 1 - first.getDay());
    const map = {};
    scheduleRows().forEach(r => { (map[String(r.end_date).slice(0, 10)] = map[String(r.end_date).slice(0, 10)] || []).push(r); });
    const tk = ymd(today());

    let cells = '';
    for (let i = 0; i < 42; i++) {
      const d = new Date(start.getFullYear(), start.getMonth(), start.getDate() + i);
      const k = ymd(d);
      const out = d.getMonth() !== mo;
      const items = map[k] || [];
      const hol = HOLIDAYS[k];
      cells += `
        <div class="cal-c ${out ? 'out' : ''} ${k === tk ? 'today' : ''} ${d.getDay() === 0 || hol ? 'sun' : ''} ${d.getDay() === 6 ? 'sat' : ''}">
          <div class="cal-n">${d.getDate()}${hol ? `<span class="cal-hol">${esc(hol)}</span>` : ''}</div>
          ${items.map(r => `<div class="cal-i ${stCls(r.status)}" title="${esc(r.service)} · ${esc(r.name)}">${r.milestone ? '⭐' : ''}${esc(r.name)}</div>`).join('')}
        </div>`;
    }
    // 좁은 화면에서는 칸 안의 글자가 잘리므로, 그 달 일정을 아래에 목록으로 함께 보여준다.
    const mk = `${y}-${pad(mo + 1)}`;
    const monthRows = scheduleRows().filter(r => String(r.end_date).slice(0, 7) === mk);

    return `
      <div class="cal-head">
        <button class="cal-nav" data-cal="-1">‹</button>
        <b>${y}년 ${mo + 1}월</b>
        <button class="cal-nav" data-cal="1">›</button>
      </div>
      <div class="cal-dow">${DOW.map((d, i) => `<span class="${i === 0 ? 'sun' : i === 6 ? 'sat' : ''}">${d}</span>`).join('')}</div>
      <div class="cal">${cells}</div>
      <div class="cal-list">
        <div class="cal-list-t">${mo + 1}월 일정 ${monthRows.length}건</div>
        ${monthRows.length ? monthRows.map(r => `
          <div class="cal-li ${r.status === '종료' ? 'done' : ''}">
            <b>${esc(fmtShort(r.end_date))}</b>
            <span class="cal-li-n">${r.milestone ? '⭐ ' : ''}${esc(r.name)}</span>
            <span class="cal-li-s">${esc(r.service)}</span>
            ${badge(r.status)}
          </div>`).join('')
          : `<p class="none">이 달에는 일정이 없습니다.</p>`}
      </div>`;
  }

  // ---------- 7. 작업물 전달 기록 ----------
  function deliveriesSection() {
    const all = D.deliveries || [];
    if (!all.length) return '';
    const cats = [...new Set(all.map(r => r.category).filter(Boolean))];
    const shown = dlvFilter ? all.filter(r => r.category === dlvFilter) : all;
    const done = shown.filter(r => r.delivered)
      .sort((a, b) => String(b.date || '').localeCompare(String(a.date || '')));
    const todo = shown.filter(r => !r.delivered)
      .sort((a, b) => (a.sort_order || 0) - (b.sort_order || 0));

    const row = (r) => `
      <li class="dlv ${r.delivered ? '' : 'todo'}">
        <span class="dlv-dir ${r.delivered ? (r.direction === '수령' ? 'in' : 'out') : 'wait'}">${r.delivered ? (r.direction === '수령' ? '받음' : '보냄') : '예정'}</span>
        <div class="dlv-main">
          <span class="dlv-n">${esc(r.name)}</span>
          <span class="dlv-s">${r.category ? esc(r.category) : ''}${r.delivered && r.channel ? ' · ' + esc(r.channel) : ''}${r.memo ? ' · ' + esc(r.memo) : ''}</span>
        </div>
        <span class="dlv-d">${r.date ? esc(fmtShort(r.date)) : ''}</span>
        ${r.url ? `<a class="dlv-go" href="${esc(r.url)}" target="_blank" rel="noopener">열기 ↗</a>` : ''}
      </li>`;

    return `
      <section class="sec">
        <div class="sec-h">
          <h2>작업물</h2>
          <span class="cnt">전달 ${all.filter(r => r.delivered).length}건${all.some(r => !r.delivered) ? ` · 예정 ${all.filter(r => !r.delivered).length}건` : ''}</span>
        </div>
        ${cats.length ? `
          <div class="chips">
            <button class="chip ${dlvFilter ? '' : 'on'}" data-cat="">전체</button>
            ${cats.map(c => `<button class="chip ${dlvFilter === c ? 'on' : ''}" data-cat="${esc(c)}">${esc(c)}</button>`).join('')}
          </div>` : ''}
        ${done.length ? `<ul class="dlvs">${done.map(row).join('')}</ul>` : ''}
        ${todo.length ? `<div class="dlv-sub">앞으로 전달드릴 작업물</div><ul class="dlvs">${todo.map(row).join('')}</ul>` : ''}
        ${shown.length ? '' : '<p class="none">이 분류에 기록이 없습니다.</p>'}
      </section>`;
  }

  // ---------- 8. 푸터 ----------
  function footer() {
    return `
      <footer class="ft">
        <div class="ft-name">엠엠컨설팅연구소</div>
        <div class="ft-row">
          <a href="tel:0233790300">02-379-0300</a>
          <span>·</span>
          <a href="tel:01058200421">010-5820-0421</a>
        </div>
        <div class="ft-row"><a href="mailto:mmcl2020@naver.com">mmcl2020@naver.com</a></div>
        <div class="ft-addr">서울시 종로구 종로 1, 15층</div>
        <div class="ft-note">본 페이지는 열람 전용입니다. 링크를 다른 곳에 공유하지 말아 주세요.</div>
      </footer>`;
  }

  // ---------- 이벤트 ----------
  function bind() {
    const tgl = document.getElementById('prog-toggle');
    const body = document.getElementById('prog-body');
    if (tgl && body) tgl.addEventListener('click', () => {
      const open = body.hasAttribute('hidden');
      if (open) body.removeAttribute('hidden'); else body.setAttribute('hidden', '');
      tgl.setAttribute('aria-expanded', String(open));
      tgl.classList.toggle('open', open);
    });

    // 요청사항 — 전체 펼치기 / 접수 전·완료 탭
    document.getElementById('req-toggle')?.addEventListener('click', () => {
      reqOpen = !reqOpen;
      render();
      document.querySelector('#req-toggle')?.scrollIntoView({ block: 'start', behavior: 'smooth' });
    });
    document.querySelectorAll('[data-rtab]').forEach(b => b.addEventListener('click', () => {
      reqTab = b.dataset.rtab;
      render();
      document.querySelector('#req-toggle')?.scrollIntoView({ block: 'start' });
    }));

    bindSched();

    document.querySelectorAll('[data-cat]').forEach(b => b.addEventListener('click', () => {
      dlvFilter = b.dataset.cat;
      render();
      // 필터를 누른 자리로 되돌아오게
      const el = document.querySelector('.dlvs');
      if (el) el.scrollIntoView({ block: 'center' });
    }));
  }

  function bindSched() {
    document.querySelectorAll('[data-cal]').forEach(b => b.addEventListener('click', () => {
      calAnchor = new Date(calAnchor.getFullYear(), calAnchor.getMonth() + Number(b.dataset.cal), 1);
      document.getElementById('sch-body').innerHTML = schedBody();
      bindSched();
    }));
  }

  boot();
})();
