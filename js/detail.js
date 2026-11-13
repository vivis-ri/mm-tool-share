// ============================================================
//  detail.js — 업체 상세(기본정보 · 서비스 항목별 금액 · 가로 보드형 프로세스)
//  설정 템플릿의 항목을 체크하면 프로세스·금액이 자동 복사됨
// ============================================================
window.Detail = (function () {
  const { esc, money, badge, statusClass, toast, modal, confirm } = UI;
  const ACTIVE_STATUSES = ['진행중', '지연', '일시정지'];
  // 화면 상태: 순서 정리 모드 여부, 순서 정리에서 단계를 펼친 항목
  const view = { companyId: null, orderMode: false, expanded: new Set() };
  const OPEN_KEY = 'mm-quote-open';

  // ---------- 견적 차수 ----------
  const pad2 = n => String(n).padStart(2, '0');
  function localDay(v) {
    if (!v) return '';
    const d = new Date(v);
    if (isNaN(d)) return String(v).slice(0, 10);
    return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
  }
  const todayDay = () => localDay(new Date());
  const fmtDay = (s) => s ? s.replace(/-/g, '.') : '날짜 미정';

  // 차수가 없는 항목(예전 데이터)은 추가된 날짜끼리 묶어 차수를 만든다. 번호 = 견적일 순서.
  async function ensureQuotes(c, services) {
    const quotes = await DB.list('quotes', { company_id: c.id });
    const known = new Set(quotes.map(q => String(q.id)));
    const loose = services.filter(s => !s.quote_id || !known.has(String(s.quote_id)));
    if (loose.length) {
      const byDay = {};
      loose.forEach(s => {
        const d = localDay(s.created_at) || c.first_quote_date || todayDay();
        (byDay[d] = byDay[d] || []).push(s);
      });
      const days = Object.keys(byDay).sort();
      const hadNone = !quotes.length;
      for (const d of days) {
        let q = quotes.find(x => x.quote_date === d);
        if (!q) {
          // 처음 묶는 1차는 업체의 최초견적일이 더 이르면 그 날짜를 쓴다
          const qd = (hadNone && d === days[0] && c.first_quote_date && c.first_quote_date < d) ? c.first_quote_date : d;
          const row = { company_id: c.id, quote_date: qd, memo: '', no: 0, sort_order: 0 };
          q = DB.READONLY ? { id: 'virtual_' + c.id + '_' + d, ...row } : await DB.insert('quotes', row);
          quotes.push(q);
        }
        for (const s of byDay[d]) {
          s.quote_id = q.id;
          if (!DB.READONLY) await DB.update('services', s.id, { quote_id: q.id });
        }
      }
      quotes.sort((a, b) => String(a.quote_date || '').localeCompare(String(b.quote_date || '')) || (a.no || 0) - (b.no || 0));
      await renumberQuotes(quotes);
    }
    return quotes.sort((a, b) => (a.no || 0) - (b.no || 0));
  }

  async function renumberQuotes(quotes) {
    for (let i = 0; i < quotes.length; i++) {
      if (quotes[i].no === i + 1) continue;
      quotes[i].no = i + 1; quotes[i].sort_order = i + 1;
      if (!DB.READONLY && !String(quotes[i].id).startsWith('virtual_')) {
        await DB.update('quotes', quotes[i].id, { no: i + 1, sort_order: i + 1 });
      }
    }
  }

  // 업체 목록·PDF 등 다른 화면도 같은 순서를 쓰도록 전체 업체를 한 번에 정리(세션당 1회)
  let migrated = false;
  async function migrateAllQuotes() {
    if (migrated || DB.READONLY) return;
    migrated = true;
    const services = await DB.list('services');
    const quotes = await DB.list('quotes');
    const known = new Set(quotes.map(q => String(q.id)));
    const needs = new Set(services.filter(s => !s.quote_id || !known.has(String(s.quote_id))).map(s => String(s.company_id)));
    if (!needs.size) return;
    const companies = await DB.list('companies');
    for (const c of companies) {
      if (!needs.has(String(c.id))) continue;
      await ensureQuotes(c, services.filter(s => String(s.company_id) === String(c.id)));
    }
  }

  function readOpen() { try { return JSON.parse(localStorage.getItem(OPEN_KEY) || '{}'); } catch { return {}; } }
  function writeOpen(id, open) {
    try { const m = readOpen(); m[id] = open; localStorage.setItem(OPEN_KEY, JSON.stringify(m)); } catch {}
  }

  function quoteGroup(q, svcs, procBy, quoteCount) {
    const sum = svcs.reduce((a, s) => a + (Number(s.amount) || 0), 0);
    const procs = svcs.flatMap(s => procBy[s.id] || []);
    const done = procs.filter(p => p.status === '종료').length;
    const pct = procs.length ? Math.round(done / procs.length * 100) : 0;
    const allDone = svcs.length > 0 && svcs.every(s => s.status === '종료');
    const saved = readOpen()[q.id];
    const open = view.orderMode || (saved != null ? saved : !(allDone && quoteCount > 1));

    const head = `
      <div class="q-head" ${view.orderMode ? '' : 'data-q-toggle'}>
        ${view.orderMode ? '' : '<span class="q-chev" aria-hidden="true"></span>'}
        <span class="q-no">${q.no}차 견적</span>
        <span class="q-date">${fmtDay(q.quote_date)}</span>
        ${q.memo ? `<span class="q-memo" title="${esc(q.memo)}">${esc(q.memo)}</span>` : ''}
        <span class="q-meta" title="${esc(UI.moneyVatText(sum))}">항목 ${svcs.length}개 · VAT포함 ${UI.money(sum)}</span>
        ${allDone ? '<span class="q-done">완료</span>' : ''}
        <span class="q-spacer"></span>
        ${procs.length && !view.orderMode ? `<span class="mini-prog"><span style="width:${pct}%"></span></span><span class="mini-prog-t">${pct}%</span>` : ''}
        <span class="q-tools only-edit">
          ${view.orderMode ? '' : `<button class="icon-btn" data-q-add title="이 견적에 항목 추가">＋</button>`}
          <button class="icon-btn" data-q-edit title="견적일·메모 수정">✎</button>
        </span>
      </div>`;

    if (view.orderMode) {
      return `
        <section class="q-group is-open" data-qid="${q.id}">
          ${head}
          <div class="ord-list" data-qid="${q.id}">
            ${svcs.map(s => orderRow(s, procBy[s.id] || [])).join('')}
            <div class="ord-tail" data-drop-tail>${svcs.length ? '여기로 끌어 놓으면 맨 뒤로' : '비어 있는 차수예요. 항목을 여기로 끌어 놓으세요.'}</div>
          </div>
        </section>`;
    }
    return `
      <section class="q-group ${open ? 'is-open' : ''}" data-qid="${q.id}">
        ${head}
        <div class="q-body" data-qid="${q.id}">
          ${svcs.length ? svcs.map(s => svcBlock(s, procBy[s.id] || [])).join('')
            : `<div class="q-empty">이 차수에 항목이 없습니다. 다른 차수의 항목을 ⠿로 끌어오거나, 비어 있으면 ✎에서 지울 수 있어요.</div>`}
          <div class="q-drop-tail only-edit" data-drop-tail>여기에 놓으면 ${q.no}차 견적으로 옮겨져요</div>
        </div>
      </section>`;
  }

  function orderRow(s, procs) {
    const ex = view.expanded.has(String(s.id));
    return `
      <div class="ord-row ${ex ? 'is-expanded' : ''}" data-id="${s.id}">
        <div class="ord-line">
          <span class="ord-handle" title="끌어서 순서 변경">⠿</span>
          <span class="ord-name">${esc(s.name)}</span>
          ${badge(s.status)}
          <span class="ord-amt">${UI.money(s.amount)}</span>
          <button class="ord-steps-btn" data-ord-expand ${procs.length ? '' : 'disabled'}>단계 ${procs.length}<span class="ord-caret" aria-hidden="true"></span></button>
        </div>
        ${ex && procs.length ? `
          <div class="ord-steps" data-sid="${s.id}">
            ${procs.map((p, i) => `
              <div class="ord-step" data-id="${p.id}">
                <span class="ord-handle" title="끌어서 단계 순서 변경">⠿</span>
                <span class="ord-step-no">${i + 1}</span>
                <span class="ord-step-name">${esc(p.name)}</span>
                ${badge(p.status)}
              </div>`).join('')}
          </div>` : ''}
      </div>`;
  }

  async function render(root, companyId, back) {
    const companies = (await DB.list('companies')).sort(window.Companies.sortByQuoteDate);
    UI.setCompanyColors(companies);
    const c = companies.find(x => String(x.id) === String(companyId));
    if (!c) { back(); return; }
    const hidden = window.Companies.isHidden(c);
    const idx = companies.findIndex(x => String(x.id) === String(companyId));
    const prev = companies[idx - 1], next = companies[idx + 1];

    const managers = await DB.list('managers');
    const mgr = managerOf(c, managers);
    if (view.companyId !== String(c.id)) { view.companyId = String(c.id); view.orderMode = false; view.expanded = new Set(); }
    const services = await DB.list('services', { company_id: companyId });
    const quotes = await ensureQuotes(c, services);
    services.sort(UI.addedOrderSorter(quotes));
    const allProc = await DB.list('processes');
    const procBy = {};
    allProc.forEach(p => { (procBy[p.service_id] = procBy[p.service_id] || []).push(p); });
    const svcSum = services.reduce((a, s) => a + (Number(s.amount) || 0), 0);
    if (services.length && Number(c.total_quote || 0) !== svcSum) {
      await DB.update('companies', companyId, { total_quote: svcSum });
      c.total_quote = svcSum;
      if (window.App && window.App.refreshSidebar) window.App.refreshSidebar();
    }

    root.innerHTML = `
      <div class="d-topbar">
        <button class="back-link" id="d-back">← 프로젝트 현황</button>
        <div class="co-switch only-nav">
          <button class="icon-btn" id="co-prev" ${prev ? '' : 'disabled'} title="이전 업체">‹</button>
          <select class="co-select" id="co-select">
            ${companies.map(x => `<option value="${x.id}" ${String(x.id) === String(companyId) ? 'selected' : ''}>${esc(x.name)}</option>`).join('')}
          </select>
          <button class="icon-btn" id="co-next" ${next ? '' : 'disabled'} title="다음 업체">›</button>
        </div>
      </div>

      <div class="d-head card">
        <div class="d-head-main">
          <div class="d-title-row">
            <h2>${esc(c.name)}${hidden ? '<span class="hidden-tag">숨김</span>' : ''}</h2>
            ${badge(c.status)}
          </div>
          <div class="d-info">
            ${info('대표자', c.rep_name)} ${info('아이템', c.item)} ${info('연락처', c.contact)}
            ${info('최초견적일', c.first_quote_date || '-')} ${infoHTML('총 견적', UI.moneyVatHTML(c.total_quote))}
            ${info('담당자', mgr.name ? (mgr.contact ? `${mgr.name} · ${mgr.contact}` : mgr.name) : '미지정')}
            ${c.license_type ? info('인허가', c.license_type) : ''}
          </div>
          ${c.memo ? `<div class="d-memo">📝 ${esc(c.memo)}</div>` : ''}
        </div>
        <div class="d-head-side">
          <button class="btn ghost" id="d-pdf">📄 PDF</button>
          <button class="btn only-edit" id="d-edit">정보 수정</button>
          <button class="btn ghost only-edit" id="d-hide">${hidden ? '숨김 해제' : '숨김'}</button>
          <button class="btn danger only-edit" id="d-delete">삭제</button>
        </div>
      </div>

      <div class="d-section-head">
        <div>
          <h3>서비스 항목</h3>
          <span class="muted">견적 ${quotes.length}회 · 항목 합계 ${UI.moneyVatText(svcSum)} · 총견적 ${UI.moneyVatText(c.total_quote)}</span>
        </div>
        <div class="d-section-tools">
          ${view.orderMode
            ? `<button class="btn ghost only-edit" id="d-new-quote">+ 빈 견적 차수</button>
               <button class="btn primary only-edit" id="d-order-done">✓ 정리 끝내기</button>`
            : `${services.length ? '<button class="btn ghost only-edit" id="d-order">⇅ 순서 정리</button>' : ''}
               <button class="btn primary only-edit" id="d-add-svc">+ 항목 추가</button>`}
        </div>
      </div>

      <div class="svc-list ${view.orderMode ? 'is-ordering' : ''}">
        ${view.orderMode ? `<div class="ord-hint">⠿ 손잡이를 잡고 끌어서 순서를 바꾸세요. 다른 견적 차수로 옮길 수도 있어요. <b>단계</b> 버튼을 누르면 그 항목의 단계 순서도 바꿀 수 있어요.</div>` : ''}
        ${services.length || quotes.length
          ? quotes.map(q => quoteGroup(q, services.filter(s => String(s.quote_id) === String(q.id)), procBy, quotes.length)).join('')
          : `<div class="empty"><div class="em-ic">🧩</div><p>아직 서비스 항목이 없습니다.<br><b>+ 항목 추가</b>로 이 업체가 진행할 항목을 선택하세요.</p></div>`}
      </div>

      ${await window.ClientShare.sectionsHTML(c)}`;

    bind(root, c, back);
    window.ClientShare.bind(root, c, () => render(root, c.id, back));
    if (window.App && window.App.refreshSidebar) window.App.refreshSidebar();
  }

  // 담당자 마스터(managers)를 우선 쓰고, 없으면 예전 텍스트 필드(manager)를 그대로 보여준다.
  function managerOf(c, managers) {
    const m = (managers || []).find(x => String(x.id) === String(c.manager_id));
    if (m) return { name: m.name, contact: m.contact || '', email: m.email || '' };
    return { name: c.manager || '', contact: '', email: '' };
  }

  function info(label, val) {
    return `<div class="info-cell"><span class="info-l">${label}</span><span class="info-v">${esc(val || '-')}</span></div>`;
  }
  function infoHTML(label, html) {
    return `<div class="info-cell"><span class="info-l">${label}</span><span class="info-v">${html || '-'}</span></div>`;
  }

  function svcBlock(s, procs) {
    const done = procs.filter(p => p.status === '종료').length;
    const pct = procs.length ? Math.round(done / procs.length * 100) : 0;
    const current = procs.find(p => ACTIVE_STATUSES.includes(p.status));
    return `
      <div class="svc-block card" data-sid="${s.id}" data-id="${s.id}">
        <div class="svc-head">
          <div class="svc-head-l">
            <span class="svc-handle only-edit" title="끌어서 순서 변경 · 다른 견적 차수로 이동">⠿</span>
            <span class="dot"></span>
            <b>${esc(s.name)}</b>
            ${badge(s.status)}
            <span class="svc-amt">${UI.moneyVatHTML(s.amount, '포함')}</span>
            ${current ? `<span class="cur-stage">진행: ${esc(current.name)}</span>` : ''}
          </div>
          <div class="svc-head-r">
            <span class="mini-prog"><span style="width:${pct}%"></span></span>
            <span class="mini-prog-t">${pct}%</span>
            <button class="icon-btn only-edit" data-svc-eye title="${s.client_visible === false ? '클라이언트에게 숨김' : '클라이언트에게 보임'}">${s.client_visible === false ? '🙈' : '👁'}</button>
            <button class="icon-btn only-edit" data-edit-svc title="금액·상태·견적 차수 수정">✎</button>
            <button class="icon-btn only-edit" data-del-svc title="항목 삭제">🗑</button>
          </div>
        </div>
        <div class="stage-board">
          ${procs.map((p, i) => stageCard(p, i)).join('')}
          <button class="stage-add only-edit" data-add-proc>＋<span>단계</span></button>
        </div>
      </div>`;
  }

  function stageCard(p, i) {
    const cls = statusClass(p.status);
    const sched = p.end_date
      ? `🚩 ${UI.fmtDate(p.end_date)}`
      : '일정 미정';
    return `
      <div class="stage-card st-${cls} only-clickable" data-pid="${p.id}" data-id="${p.id}">
        <div class="stage-idx" data-drag-handle title="잡고 좌우로 끌면 단계 순서가 바뀌어요"><span class="si-n">${i + 1}</span><span class="si-g" aria-hidden="true">⠿</span></div>
        <div class="stage-name">${esc(p.name)}</div>
        <div class="stage-status" data-status-toggle title="클릭해서 상태 변경">${badge(p.status)}</div>
        <div class="stage-meta">
          <span class="stage-sched ${p.end_date ? 'due' : ''}">${sched}</span>
          ${p.assignee ? `<span class="stage-asg">👤 ${esc(p.assignee)}</span>` : ''}
        </div>
        ${p.memo ? `<div class="stage-memo" title="${esc(p.memo)}">💬 ${esc(p.memo)}</div>` : ''}
        <div class="stage-flags only-edit">
          <button class="flag-btn ${p.milestone ? 'on' : ''}" data-flag-star title="${p.milestone ? '주요일정 — 클라이언트 대시보드 D-day에 표시' : '주요일정으로 지정'}">${p.milestone ? '⭐' : '☆'}</button>
          <button class="flag-btn ${p.client_visible === false ? 'off' : ''}" data-flag-eye title="${p.client_visible === false ? '클라이언트에게 숨김' : '클라이언트에게 보임'}">${p.client_visible === false ? '🙈' : '👁'}</button>
        </div>
        ${p.milestone ? '<span class="stage-star-mark" title="주요일정">⭐</span>' : ''}
        <button class="stage-del only-edit" data-del-proc title="삭제">✕</button>
      </div>`;
  }

  // ---------- 이벤트 ----------
  function bind(root, c, back) {
    root.querySelector('#d-back').addEventListener('click', back);
    root.querySelector('#co-prev')?.addEventListener('click', (e) => {
      const sel = root.querySelector('#co-select'); const i = sel.selectedIndex;
      if (i > 0) window.Companies.open(sel.options[i - 1].value, root);
    });
    root.querySelector('#co-next')?.addEventListener('click', () => {
      const sel = root.querySelector('#co-select'); const i = sel.selectedIndex;
      if (i < sel.options.length - 1) window.Companies.open(sel.options[i + 1].value, root);
    });
    root.querySelector('#co-select')?.addEventListener('change', (e) => window.Companies.open(e.target.value, root));

    root.querySelector('#d-pdf')?.addEventListener('click', () => window.PDF.company(c.id));
    root.querySelector('#d-edit')?.addEventListener('click', () => window.Companies.editCompany(root, c));
    root.querySelector('#d-hide')?.addEventListener('click', async () => {
      await window.Companies.setHidden(c.id, !window.Companies.isHidden(c));
      render(root, c.id, back);
    });
    root.querySelector('#d-delete')?.addEventListener('click', () => {
      confirm('이 업체와 연결된 서비스 항목, 프로세스 단계를 모두 삭제할까요?', async () => {
        await window.Companies.deleteCompany(c.id);
        back();
      }, true);
    });
    root.querySelector('#d-add-svc')?.addEventListener('click', () => addServices(root, c, back));
    root.querySelector('#d-order')?.addEventListener('click', () => { view.orderMode = true; render(root, c.id, back); });
    root.querySelector('#d-order-done')?.addEventListener('click', () => { view.orderMode = false; render(root, c.id, back); });
    root.querySelector('#d-new-quote')?.addEventListener('click', async () => {
      const qs = await DB.list('quotes', { company_id: c.id });
      const no = qs.reduce((n, q) => Math.max(n, Number(q.no) || 0), 0) + 1;
      await DB.insert('quotes', { company_id: c.id, quote_date: todayDay(), memo: '', no, sort_order: no });
      toast(`${no}차 견적을 만들었어요. 항목을 끌어다 넣으세요`);
      render(root, c.id, back);
    });

    // 견적 차수 아코디언
    root.querySelectorAll('.q-group').forEach(g => {
      const qid = g.dataset.qid;
      g.querySelector('[data-q-toggle]')?.addEventListener('click', (e) => {
        if (e.target.closest('.q-tools')) return;
        const open = !g.classList.contains('is-open');
        g.classList.toggle('is-open', open);
        writeOpen(qid, open);
      });
      g.querySelector('[data-q-add]')?.addEventListener('click', () => addServices(root, c, back, qid));
      g.querySelector('[data-q-edit]')?.addEventListener('click', () => editQuote(root, c, back, qid));
    });

    // 평소 화면: 항목 머리의 ⠿를 잡고 다른 견적 차수로(또는 같은 차수 안에서) 이동
    if (!view.orderMode) {
      const bodies = [...root.querySelectorAll('.q-body')];
      DragSort.enableGroup(bodies, {
        itemSelector: '.svc-block', handleSelector: '.svc-head .svc-handle',
        dropZoneFor: (body) => body.closest('.q-group')?.querySelector('.q-head'),
        onReorder: (groups) => saveServiceGroups(root, c, back, groups)
      });
    }

    // 순서 정리 모드: 항목(차수 사이 이동 가능) · 단계 드래그
    if (view.orderMode) {
      const lists = [...root.querySelectorAll('.ord-list')];
      DragSort.enableGroup(lists, {
        itemSelector: '.ord-row', handleSelector: '.ord-line > .ord-handle',
        onReorder: (groups) => saveServiceGroups(root, c, back, groups)
      });
      root.querySelectorAll('.ord-row').forEach(row => {
        row.querySelector('[data-ord-expand]')?.addEventListener('click', () => {
          const id = String(row.dataset.id);
          if (view.expanded.has(id)) view.expanded.delete(id); else view.expanded.add(id);
          render(root, c.id, back);
        });
        const steps = row.querySelector('.ord-steps');
        if (steps) DragSort.enable(steps, {
          itemSelector: '.ord-step', handleSelector: '.ord-handle',
          onReorder: async (ids) => {
            const ordered = ids.filter(Boolean);
            for (let i = 0; i < ordered.length; i++) await DB.update('processes', ordered[i], { sort_order: i + 1 });
            toast('단계 순서를 변경했습니다');
            render(root, c.id, back);
          }
        });
      });
    }

    root.querySelectorAll('.svc-block').forEach(block => {
      const sid = block.dataset.sid;
      block.querySelector('[data-edit-svc]')?.addEventListener('click', async () => {
        const s = (await DB.list('services', { id: sid }))[0]; editService(root, c, back, s);
      });
      block.querySelector('[data-svc-eye]')?.addEventListener('click', async () => {
        if (DB.READONLY) return;
        const s = (await DB.list('services', { id: sid }))[0];
        await DB.update('services', sid, { client_visible: s.client_visible === false });
        render(root, c.id, back);
      });
      block.querySelector('[data-del-svc]')?.addEventListener('click', () => {
        confirm('이 서비스 항목과 프로세스 단계를 삭제할까요?', async () => {
          const ps = await DB.list('processes', { service_id: sid });
          for (const p of ps) await DB.remove('processes', p.id);
          await DB.remove('services', sid);
          await syncCompanyQuote(c.id);
          await syncCompanyStatus(c.id);
          toast('삭제했습니다'); render(root, c.id, back);
        }, true);
      });
      block.querySelector('[data-add-proc]')?.addEventListener('click', () => editProcess(root, c, back, sid));

      // 프로세스 단계 순서 변경(번호를 잡고 드래그) — 이 서비스 항목 안에서만
      const board = block.querySelector('.stage-board');
      if (board) DragSort.enable(board, {
        itemSelector: '.stage-card', handleSelector: '.stage-idx', horizontal: true,
        onReorder: async (ids) => {
          const ordered = ids.filter(Boolean);
          for (let i = 0; i < ordered.length; i++) await DB.update('processes', ordered[i], { sort_order: i + 1 });
          toast('단계 순서를 변경했습니다');
          render(root, c.id, back);
        }
      });

      block.querySelectorAll('.stage-card').forEach(cardEl => {
        const pid = cardEl.dataset.pid;
        cardEl.addEventListener('click', async (e) => {
          if (e.target.closest('[data-del-proc]') || e.target.closest('[data-status-toggle]') || e.target.closest('.stage-flags')) return;
          if (DB.READONLY) return;
          const p = (await DB.list('processes', { id: pid }))[0]; editProcess(root, c, back, sid, p);
        });
        // ⭐ 주요일정(클라이언트 D-day) / 👁 클라이언트 공개 여부
        cardEl.querySelector('[data-flag-star]')?.addEventListener('click', async (e) => {
          e.stopPropagation();
          if (DB.READONLY) return;
          const p = (await DB.list('processes', { id: pid }))[0];
          await DB.update('processes', pid, { milestone: !p.milestone });
          render(root, c.id, back);
        });
        cardEl.querySelector('[data-flag-eye]')?.addEventListener('click', async (e) => {
          e.stopPropagation();
          if (DB.READONLY) return;
          const p = (await DB.list('processes', { id: pid }))[0];
          await DB.update('processes', pid, { client_visible: p.client_visible === false });
          render(root, c.id, back);
        });
        // 상태 배지 클릭 → 즉시 토글
        cardEl.querySelector('[data-status-toggle]')?.addEventListener('click', async (e) => {
          e.stopPropagation();
          if (DB.READONLY) return;
          const anchor = e.currentTarget;   // await 이후엔 null이 되므로 미리 캡처
          const p = (await DB.list('processes', { id: pid }))[0];
          UI.statusPicker(anchor, p.status, async (s) => {
            await DB.update('processes', pid, { status: s });
            await syncCompanyStatus(c.id);
            toast('상태를 변경했습니다'); render(root, c.id, back);
          });
        });
        cardEl.querySelector('[data-del-proc]')?.addEventListener('click', async (e) => {
          e.stopPropagation();
          await DB.remove('processes', pid); await syncCompanyStatus(c.id); toast('삭제했습니다'); render(root, c.id, back);
        });
      });
    });
  }

  // ---------- 항목 추가(템플릿 자동 세팅) ----------
  async function addServices(root, c, back, presetQid) {
    const templates = UI.sortServiceTemplates(await DB.list('service_templates'));
    const companyServices = await DB.list('services', { company_id: c.id });
    const quotes = (await DB.list('quotes', { company_id: c.id })).sort((a, b) => (a.no || 0) - (b.no || 0));
    const existingCounts = {};
    companyServices.forEach(s => {
      const key = String(s.template_id || '');
      if (key) existingCounts[key] = (existingCounts[key] || 0) + 1;
    });
    // 대분류별 그룹
    const groups = {};
    templates.forEach(t => { const c = t.category || '기타'; (groups[c] = groups[c] || []).push(t); });
    const categories = [...new Set(templates.map(t => t.category || '기타'))];
    const nextNo = quotes.reduce((n, q) => Math.max(n, Number(q.no) || 0), 0) + 1;
    const last = quotes[quotes.length - 1];
    // 기본 선택: 특정 차수에서 눌렀으면 그 차수, 오늘 만든 차수가 있으면 그 차수, 아니면 새 견적
    const defaultQ = presetQid || (last && last.quote_date === todayDay() ? String(last.id) : 'new');
    modal({
      title: '진행할 서비스 항목 선택',
      wide: true,
      bodyHTML: `
        <div class="q-pick">
          <div class="field">
            <label>어느 견적에 넣을까요?</label>
            <select class="select" id="aq-quote">
              <option value="new" ${defaultQ === 'new' ? 'selected' : ''}>＋ 새 견적 (${nextNo}차)</option>
              ${quotes.map(q => `<option value="${q.id}" ${String(q.id) === String(defaultQ) ? 'selected' : ''}>${q.no}차 견적 · ${fmtDay(q.quote_date)}${q.memo ? ' · ' + esc(q.memo) : ''}</option>`).join('')}
            </select>
          </div>
          <div class="field" id="aq-new-fields" ${defaultQ === 'new' ? '' : 'hidden'}>
            <label>견적일</label>
            <input class="input" type="date" id="aq-date" value="${quotes.length ? todayDay() : (c.first_quote_date || todayDay())}">
          </div>
          <div class="field" id="aq-new-memo" ${defaultQ === 'new' ? '' : 'hidden'}>
            <label>메모 <span class="muted">(선택)</span></label>
            <input class="input" id="aq-memo" placeholder="예: 추가 촬영 건">
          </div>
        </div>
        <p class="muted" style="margin:4px 0 14px">선택한 항목이 추가되고, 각 항목의 <b>프로세스 단계와 기본 금액이 자동으로 복사</b>됩니다.</p>
        ${templates.length ? '' : '<p class="muted" style="margin-bottom:12px">설정에 등록된 서비스 항목이 없어요. 아래 <b>기타 항목</b>으로 직접 만들 수 있어요.</p>'}
        ${Object.keys(groups).map(cat => `
          <div class="pick-cat">${esc(cat)}</div>
          <div class="tpl-pick">
            ${groups[cat].map(t => {
              const addedCount = existingCounts[String(t.id)] || 0;
              return `<label class="pick-row ${addedCount ? 'dup-ok' : ''}">
                <input type="checkbox" value="${t.id}">
                <span class="pick-name">${esc(t.name)}</span>
                <span class="pick-amt">${UI.moneyVatText(t.default_amount)}</span>
                ${addedCount ? `<span class="pick-tag">기존 ${addedCount}개</span>` : ''}
              </label>`;
            }).join('')}
          </div>`).join('')}

        <details class="custom-svc" id="cs-box" ${templates.length ? '' : 'open'}>
          <summary><span class="cs-plus">＋</span> 기타 항목 직접 만들기 <span class="muted">목록에 없는 일회성 항목</span></summary>
          <div class="cs-body">
            <div class="grid-2">
              <div class="field"><label>항목명 *</label><input class="input" id="cs-name" placeholder="예: 박람회 부스 디자인"></div>
              <div class="field"><label>분류</label>
                <input class="input" id="cs-cat" list="cs-cat-list" placeholder="고르거나 새로 입력" value="기타">
                <datalist id="cs-cat-list">${categories.map(x => `<option value="${esc(x)}"></option>`).join('')}</datalist></div>
            </div>
            <div class="field"><label>금액 (원, VAT 포함)</label><input class="input" id="cs-amt" type="number" min="0" placeholder="0"><span class="help-text" id="cs-amt-t"></span></div>
            <div class="field"><label>단계 <span class="muted">(쉼표나 → 로 구분, 비워두면 나중에 추가)</span></label>
              <input class="input" id="cs-steps" placeholder="예: 기획, 시안, 수정, 납품"></div>
            <div class="chk-row">
              <label class="chk"><input type="checkbox" id="cs-vis" checked><span>👁 클라이언트에게 공개</span></label>
              <label class="chk"><input type="checkbox" id="cs-save"><span>설정의 서비스 항목에도 저장 <em>다음에 목록에서 고를 수 있어요</em></span></label>
            </div>
          </div>
        </details>`,
      saveLabel: '선택 항목 추가',
      onSave: async (m) => {
        const picked = [...m.querySelectorAll('.tpl-pick input:checked')].map(i => i.value);
        const csName = m.querySelector('#cs-name').value.trim();
        if (!picked.length && !csName) { toast('추가할 항목을 고르거나 기타 항목 이름을 입력하세요'); return false; }

        // 견적 차수 정하기
        let qid = m.querySelector('#aq-quote').value;
        if (qid === 'new') {
          const q = await DB.insert('quotes', {
            company_id: c.id, quote_date: m.querySelector('#aq-date').value || todayDay(),
            memo: m.querySelector('#aq-memo').value.trim(), no: nextNo, sort_order: nextNo
          });
          qid = q.id;
        }
        let order = companyServices.filter(s => String(s.quote_id) === String(qid))
          .reduce((n, s) => Math.max(n, Number(s.sort_order) || 0), 0);
        let docsAdded = 0, dlvAdded = 0;
        for (const tid of picked) {
          const t = templates.find(x => String(x.id) === String(tid));
          order++;
          const svc = await DB.insert('services', {
            company_id: c.id, template_id: t.id, name: t.name, category: t.category || '기타',
            amount: t.default_amount || 0, status: '예정', client_visible: true, sort_order: order, quote_id: qid
          });
          const steps = await DB.list('process_templates', { service_template_id: t.id });
          let so = 0;
          for (const st of steps) {
            so++;
            await DB.insert('processes', {
              service_id: svc.id, name: st.name, assignee: st.default_assignee || '',
              start_date: null, end_date: null, status: '예정', memo: '',
              client_memo: '', milestone: false, client_visible: true, sort_order: so
            });
          }
          // 항목에 걸린 묶음 → 요청사항·작업물 단계 자동 생성(중복 제외)
          docsAdded += await window.ClientShare.applyRequestSets(c.id, t.request_set_ids || [], svc.id);
          dlvAdded += await window.ClientShare.applyDeliverySets(c.id, t.delivery_set_ids || [], svc.id);
        }

        // 기타 항목(직접 입력)
        if (csName) {
          const cat = m.querySelector('#cs-cat').value.trim() || '기타';
          const amt = Number(m.querySelector('#cs-amt').value) || 0;
          const stepNames = m.querySelector('#cs-steps').value.split(/[,，→>\n]+/).map(x => x.trim()).filter(Boolean);
          let templateId = null;
          if (m.querySelector('#cs-save').checked) {
            const maxOrder = templates.reduce((n, t) => Math.max(n, Number(t.sort_order) || 0), 0);
            const t = await DB.insert('service_templates', {
              name: csName, category: cat, default_amount: amt,
              request_set_ids: [], delivery_set_ids: [], sort_order: maxOrder + 1
            });
            templateId = t.id;
            for (let i = 0; i < stepNames.length; i++) {
              await DB.insert('process_templates', { service_template_id: t.id, name: stepNames[i], default_assignee: '', sort_order: i + 1 });
            }
          }
          order++;
          const svc = await DB.insert('services', {
            company_id: c.id, template_id: templateId, name: csName, category: cat, custom: true,
            amount: amt, status: '예정', client_visible: m.querySelector('#cs-vis').checked, sort_order: order, quote_id: qid
          });
          for (let i = 0; i < stepNames.length; i++) {
            await DB.insert('processes', {
              service_id: svc.id, name: stepNames[i], assignee: '',
              start_date: null, end_date: null, status: '예정', memo: '',
              client_memo: '', milestone: false, client_visible: true, sort_order: i + 1
            });
          }
        }

        await syncCompanyQuote(c.id);
        await syncCompanyStatus(c.id);
        const total = picked.length + (csName ? 1 : 0);
        toast(`${total}개 항목을 세팅했습니다`
          + (docsAdded ? ` · 요청사항 ${docsAdded}건` : '')
          + (dlvAdded ? ` · 작업물 ${dlvAdded}단계` : ''));
        render(root, c.id, back);
      }
    });

    // 모달 안 상호작용: 새 견적 선택 시 견적일 입력칸 표시, 금액 한글 표기
    const mEl = document.querySelector('#modal-root .modal-backdrop:last-child .modal');
    if (!mEl) return;
    const sel = mEl.querySelector('#aq-quote');
    sel.addEventListener('change', () => {
      const isNew = sel.value === 'new';
      mEl.querySelector('#aq-new-fields').hidden = !isNew;
      mEl.querySelector('#aq-new-memo').hidden = !isNew;
    });
    const amt = mEl.querySelector('#cs-amt');
    amt.addEventListener('input', () => { mEl.querySelector('#cs-amt-t').textContent = amt.value ? UI.moneyVatText(Number(amt.value)) : ''; });
  }

  function editQuote(root, c, back, qid) {
    DB.list('quotes', { company_id: c.id }).then(async (quotes) => {
      const q = quotes.find(x => String(x.id) === String(qid));
      if (!q) return;
      const count = (await DB.list('services', { company_id: c.id })).filter(s => String(s.quote_id) === String(qid)).length;
      modal({
        title: `${q.no}차 견적 수정`,
        bodyHTML: `
          <div class="field"><label>견적일</label><input class="input" type="date" id="eq-date" value="${q.quote_date || ''}"></div>
          <div class="field"><label>메모</label><input class="input" id="eq-memo" placeholder="예: 추가 촬영 건" value="${esc(q.memo || '')}"></div>
          <div class="eq-danger">
            ${count
              ? `<span class="muted">항목이 ${count}개 있어 지울 수 없어요. <b>⇅ 순서 정리</b>에서 다른 차수로 옮기면 지울 수 있어요.</span>`
              : `<button class="btn danger" type="button" id="eq-del">이 견적 차수 삭제</button>`}
          </div>`,
        onSave: async (m) => {
          await DB.update('quotes', qid, {
            quote_date: m.querySelector('#eq-date').value || q.quote_date,
            memo: m.querySelector('#eq-memo').value.trim()
          });
          toast('저장했습니다'); render(root, c.id, back);
        }
      });
      const mEl = document.querySelector('#modal-root .modal-backdrop:last-child');
      mEl?.querySelector('#eq-del')?.addEventListener('click', async () => {
        await DB.remove('quotes', qid);
        await renumberQuotes(quotes.filter(x => String(x.id) !== String(qid)).sort((a, b) => (a.no || 0) - (b.no || 0)));
        mEl.remove();
        toast('견적 차수를 삭제했습니다'); render(root, c.id, back);
      });
    });
  }

  // 드래그 결과 저장: 칸(견적 차수)마다 항목 순서와 소속 차수를 반영
  async function saveServiceGroups(root, c, back, groups) {
    const svcs = await DB.list('services', { company_id: c.id });
    const byId = {}; svcs.forEach(s => { byId[String(s.id)] = s; });
    let moved = 0;
    for (const { container, ids } of groups) {
      const qid = container.dataset.qid;
      for (let i = 0; i < ids.length; i++) {
        const s = byId[String(ids[i])];
        if (!s) continue;
        const patch = {};
        if (String(s.quote_id) !== String(qid)) { patch.quote_id = qid; moved++; }
        if (Number(s.sort_order) !== i + 1) patch.sort_order = i + 1;
        if (Object.keys(patch).length) await DB.update('services', s.id, patch);
      }
    }
    if (moved) {
      // 옮겨간 차수는 펼쳐서 바로 보이게
      const target = groups.find(g => g.ids.some(id => String(byId[String(id)]?.quote_id) !== String(g.container.dataset.qid)));
      if (target) writeOpen(target.container.dataset.qid, true);
    }
    toast(moved ? '항목을 다른 견적 차수로 옮겼습니다' : '항목 순서를 변경했습니다');
    render(root, c.id, back);
  }

  async function editService(root, c, back, s) {
    const quotes = (await DB.list('quotes', { company_id: c.id })).sort((a, b) => (a.no || 0) - (b.no || 0));
    modal({
      title: '항목 수정',
      bodyHTML: `
        <div class="field"><label>항목명</label><input class="input" id="s-name" value="${esc(s.name)}"></div>
        <div class="field"><label>견적 차수 <span class="muted">(바꾸면 그 차수의 맨 뒤로 옮겨져요)</span></label>
          <select class="select" id="s-quote">
            ${quotes.map(q => `<option value="${q.id}" ${String(q.id) === String(s.quote_id) ? 'selected' : ''}>${q.no}차 견적 · ${fmtDay(q.quote_date)}${q.memo ? ' · ' + esc(q.memo) : ''}</option>`).join('')}
          </select></div>
        <div class="grid-2">
          <div class="field"><label>받은 금액 (원, VAT 포함)</label><input class="input" id="s-amt" type="number" value="${s.amount}"><span class="help-text">${UI.moneyVatText(s.amount)}</span></div>
          <div class="field"><label>상태</label><select class="select" id="s-status">${UI.statusOptions(s.status)}</select></div>
        </div>`,
      onSave: async (m) => {
        const patch = {
          name: m.querySelector('#s-name').value.trim() || s.name,
          amount: Number(m.querySelector('#s-amt').value) || 0,
          status: m.querySelector('#s-status').value
        };
        const qid = m.querySelector('#s-quote')?.value;
        if (qid && String(qid) !== String(s.quote_id)) {
          const inTarget = (await DB.list('services', { company_id: c.id })).filter(x => String(x.quote_id) === String(qid));
          patch.quote_id = qid;
          patch.sort_order = inTarget.reduce((n, x) => Math.max(n, Number(x.sort_order) || 0), 0) + 1;
          writeOpen(qid, true);
        }
        await DB.update('services', s.id, patch);
        await syncCompanyQuote(c.id);
        await syncCompanyStatus(c.id, { syncServices: false });
        toast('저장했습니다'); render(root, c.id, back);
      }
    });
  }

  async function editProcess(root, c, back, serviceId, p) {
    const isNew = !p;
    const managers = await DB.list('managers');
    modal({
      title: isNew ? '프로세스 단계 추가' : '단계 수정',
      wide: true,
      bodyHTML: `
        <div class="field"><label>단계명 *</label><input class="input" id="p-name" value="${p ? esc(p.name) : ''}"></div>
        <div class="grid-2">
          <div class="field"><label>담당자</label>
            <input class="input" id="p-asg" list="p-mgr-list" placeholder="${managers.length ? '목록에서 고르거나 직접 입력' : '항목 설정 → 담당자에서 등록해두면 골라 쓸 수 있습니다'}" value="${p ? esc(p.assignee) : ''}">
            <datalist id="p-mgr-list">${managers.map(m => `<option value="${esc(m.name)}"></option>`).join('')}</datalist></div>
          <div class="field"><label>상태</label><select class="select" id="p-status">${UI.statusOptions(p ? p.status : '예정')}</select></div>
        </div>
        <div class="field"><label>🚩 마감일 <span class="muted">(업무일지 연동)</span></label><input class="input" id="p-end" type="date" value="${p ? (p.end_date || '') : ''}"></div>
        <div class="field"><label>메모 <span class="muted">(내부용 — 클라이언트에게 보이지 않습니다)</span></label><textarea class="input" id="p-memo">${p ? esc(p.memo) : ''}</textarea></div>
        <div class="field"><label>클라이언트 안내 문구 <span class="muted">(대시보드에 이 단계와 함께 표시)</span></label>
          <input class="input" id="p-cmemo" placeholder="예: 시안 확인 후 인쇄 진행합니다" value="${p ? esc(p.client_memo || '') : ''}"></div>
        <div class="chk-row">
          <label class="chk"><input type="checkbox" id="p-star" ${p && p.milestone ? 'checked' : ''}><span>⭐ 주요일정 <em>대시보드 D-day에 표시</em></span></label>
          <label class="chk"><input type="checkbox" id="p-vis" ${!p || p.client_visible !== false ? 'checked' : ''}><span>👁 클라이언트에게 공개</span></label>
        </div>`,
      saveLabel: isNew ? '추가' : '저장',
      onSave: async (m) => {
        const name = m.querySelector('#p-name').value.trim();
        if (!name) { toast('단계명을 입력하세요'); return false; }
        const payload = {
          name, assignee: m.querySelector('#p-asg').value.trim(),
          start_date: null,
          end_date: m.querySelector('#p-end').value || null,
          status: m.querySelector('#p-status').value,
          memo: m.querySelector('#p-memo').value.trim(),
          client_memo: m.querySelector('#p-cmemo').value.trim(),
          milestone: m.querySelector('#p-star').checked,
          client_visible: m.querySelector('#p-vis').checked
        };
        if (isNew) {
          const cnt = (await DB.list('processes', { service_id: serviceId })).length;
          await DB.insert('processes', { service_id: serviceId, ...payload, sort_order: cnt + 1 });
        } else {
          await DB.update('processes', p.id, payload);
        }
        await syncCompanyStatus(c.id);
        toast('저장했습니다'); render(root, c.id, back);
      }
    });
  }

  function aggregateStatus(items) {
    if (!items.length) return null;
    const statuses = items.map(x => x.status || '예정');
    if (statuses.every(s => s === '종료')) return '종료';
    if (statuses.includes('지연')) return '지연';
    if (statuses.includes('진행중')) return '진행중';
    if (statuses.includes('일시정지')) return '일시정지';
    if (statuses.includes('종료')) return '진행중';
    return '예정';
  }

  async function syncCompanyQuote(companyId) {
    const services = await DB.list('services', { company_id: companyId });
    const total = services.reduce((sum, s) => sum + (Number(s.amount) || 0), 0);
    await DB.update('companies', companyId, { total_quote: total });
    return total;
  }

  // 프로세스 상태 변경 시 서비스 항목과 업체 상태를 함께 정리
  async function syncCompanyStatus(companyId, opts) {
    const syncServices = !(opts && opts.syncServices === false);
    const services = await DB.list('services', { company_id: companyId });
    const serviceStatuses = [];
    for (const s of services) {
      const procs = await DB.list('processes', { service_id: s.id });
      const nextServiceStatus = aggregateStatus(procs);
      if (syncServices && nextServiceStatus && s.status !== nextServiceStatus) {
        await DB.update('services', s.id, { status: nextServiceStatus });
        serviceStatuses.push(nextServiceStatus);
      } else {
        serviceStatuses.push(s.status || nextServiceStatus || '예정');
      }
    }

    const co = (await DB.list('companies', { id: companyId }))[0];
    if (!co) return;
    const nextCompanyStatus = aggregateStatus(serviceStatuses.map(status => ({ status })));
    if (nextCompanyStatus && co.status !== nextCompanyStatus) {
      await DB.update('companies', companyId, { status: nextCompanyStatus });
    }
  }

  return { render, syncCompanyStatus, syncCompanyQuote, migrateAllQuotes };
})();
