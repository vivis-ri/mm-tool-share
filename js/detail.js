// ============================================================
//  detail.js — 업체 상세(기본정보 · 서비스 항목별 금액 · 가로 보드형 프로세스)
//  설정 템플릿의 항목을 체크하면 프로세스·금액이 자동 복사됨
// ============================================================
window.Detail = (function () {
  const { esc, money, badge, statusClass, toast, modal, confirm } = UI;
  const ACTIVE_STATUSES = ['진행중', '지연', '일시정지'];

  async function render(root, companyId, back) {
    const companies = (await DB.list('companies')).sort(window.Companies.sortByQuoteDate);
    const c = companies.find(x => String(x.id) === String(companyId));
    if (!c) { back(); return; }
    const hidden = window.Companies.isHidden(c);
    const idx = companies.findIndex(x => String(x.id) === String(companyId));
    const prev = companies[idx - 1], next = companies[idx + 1];

    const serviceTemplates = await DB.list('service_templates');
    const services = (await DB.list('services', { company_id: companyId })).sort(UI.serviceSorter(serviceTemplates));
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
            ${info('담당자', c.manager || '미지정')}
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
          <span class="muted">항목 합계 ${UI.moneyVatText(svcSum)} · 총견적 ${UI.moneyVatText(c.total_quote)}</span>
        </div>
        <button class="btn primary only-edit" id="d-add-svc">+ 항목 추가</button>
      </div>

      <div class="svc-list">
        ${services.length ? services.map(s => svcBlock(s, procBy[s.id] || [])).join('')
          : `<div class="empty"><div class="em-ic">🧩</div><p>아직 서비스 항목이 없습니다.<br><b>+ 항목 추가</b>로 이 업체가 진행할 항목을 선택하세요.</p></div>`}
      </div>`;

    bind(root, c, back);
    if (window.App && window.App.refreshSidebar) window.App.refreshSidebar();
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
      <div class="svc-block card" data-sid="${s.id}">
        <div class="svc-head">
          <div class="svc-head-l">
            <span class="dot"></span>
            <b>${esc(s.name)}</b>
            ${badge(s.status)}
            <span class="svc-amt">${UI.moneyVatHTML(s.amount, '포함')}</span>
            ${current ? `<span class="cur-stage">진행: ${esc(current.name)}</span>` : ''}
          </div>
          <div class="svc-head-r">
            <span class="mini-prog"><span style="width:${pct}%"></span></span>
            <span class="mini-prog-t">${pct}%</span>
            <button class="icon-btn only-edit" data-edit-svc title="금액/상태 수정">✎</button>
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
      : (p.start_date ? UI.fmtDate(p.start_date) : '일정 미정');
    return `
      <div class="stage-card st-${cls} only-clickable" data-pid="${p.id}">
        <div class="stage-idx">${i + 1}</div>
        <div class="stage-name">${esc(p.name)}</div>
        <div class="stage-status" data-status-toggle title="클릭해서 상태 변경">${badge(p.status)}</div>
        <div class="stage-meta">
          <span class="stage-sched ${p.end_date ? 'due' : ''}">${sched}</span>
          ${p.assignee ? `<span class="stage-asg">👤 ${esc(p.assignee)}</span>` : ''}
        </div>
        ${p.memo ? `<div class="stage-memo" title="${esc(p.memo)}">💬 ${esc(p.memo)}</div>` : ''}
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

    root.querySelectorAll('.svc-block').forEach(block => {
      const sid = block.dataset.sid;
      block.querySelector('[data-edit-svc]')?.addEventListener('click', async () => {
        const s = (await DB.list('services', { id: sid }))[0]; editService(root, c, back, s);
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

      block.querySelectorAll('.stage-card').forEach(cardEl => {
        const pid = cardEl.dataset.pid;
        cardEl.addEventListener('click', async (e) => {
          if (e.target.closest('[data-del-proc]') || e.target.closest('[data-status-toggle]')) return;
          if (DB.READONLY) return;
          const p = (await DB.list('processes', { id: pid }))[0]; editProcess(root, c, back, sid, p);
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
  async function addServices(root, c, back) {
    const templates = UI.sortServiceTemplates(await DB.list('service_templates'));
    const existingCounts = {};
    (await DB.list('services', { company_id: c.id })).forEach(s => {
      const key = String(s.template_id || '');
      if (key) existingCounts[key] = (existingCounts[key] || 0) + 1;
    });
    if (!templates.length) { toast('먼저 [항목 설정] 탭에서 서비스 항목을 만들어 주세요'); return; }
    // 대분류별 그룹
    const groups = {};
    templates.forEach(t => { const c = t.category || '기타'; (groups[c] = groups[c] || []).push(t); });
    modal({
      title: '진행할 서비스 항목 선택',
      wide: true,
      bodyHTML: `
        <p class="muted" style="margin-bottom:14px">선택한 항목이 추가되고, 각 항목의 <b>프로세스 단계와 기본 금액이 자동으로 복사</b>됩니다.</p>
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
          </div>`).join('')}`,
      saveLabel: '선택 항목 추가',
      onSave: async (m) => {
        const picked = [...m.querySelectorAll('input:checked')].map(i => i.value);
        if (!picked.length) { toast('추가할 항목을 선택하세요'); return false; }
        let order = (await DB.list('services', { company_id: c.id })).length;
        for (const tid of picked) {
          const t = templates.find(x => String(x.id) === String(tid));
          order++;
          const svc = await DB.insert('services', {
            company_id: c.id, template_id: t.id, name: t.name, category: t.category || '기타',
            amount: t.default_amount || 0, status: '예정', sort_order: order
          });
          const steps = await DB.list('process_templates', { service_template_id: t.id });
          let so = 0;
          for (const st of steps) {
            so++;
            await DB.insert('processes', {
              service_id: svc.id, name: st.name, assignee: st.default_assignee || '',
              start_date: null, end_date: null, status: '예정', memo: '', sort_order: so
            });
          }
        }
        await syncCompanyQuote(c.id);
        await syncCompanyStatus(c.id);
        toast(`${picked.length}개 항목을 세팅했습니다`);
        render(root, c.id, back);
      }
    });
  }

  function editService(root, c, back, s) {
    modal({
      title: '항목 수정',
      bodyHTML: `
        <div class="field"><label>항목명</label><input class="input" id="s-name" value="${esc(s.name)}"></div>
        <div class="grid-2">
          <div class="field"><label>받은 금액 (원, VAT 포함)</label><input class="input" id="s-amt" type="number" value="${s.amount}"><span class="help-text">${UI.moneyVatText(s.amount)}</span></div>
          <div class="field"><label>상태</label><select class="select" id="s-status">${UI.statusOptions(s.status)}</select></div>
        </div>`,
      onSave: async (m) => {
        await DB.update('services', s.id, {
          name: m.querySelector('#s-name').value.trim() || s.name,
          amount: Number(m.querySelector('#s-amt').value) || 0,
          status: m.querySelector('#s-status').value
        });
        await syncCompanyQuote(c.id);
        await syncCompanyStatus(c.id, { syncServices: false });
        toast('저장했습니다'); render(root, c.id, back);
      }
    });
  }

  function editProcess(root, c, back, serviceId, p) {
    const isNew = !p;
    modal({
      title: isNew ? '프로세스 단계 추가' : '단계 수정',
      wide: true,
      bodyHTML: `
        <div class="field"><label>단계명 *</label><input class="input" id="p-name" value="${p ? esc(p.name) : ''}"></div>
        <div class="grid-2">
          <div class="field"><label>담당자 <span class="muted">(추후 지정)</span></label><input class="input" id="p-asg" value="${p ? esc(p.assignee) : ''}"></div>
          <div class="field"><label>상태</label><select class="select" id="p-status">${UI.statusOptions(p ? p.status : '예정')}</select></div>
          <div class="field"><label>시작일</label><input class="input" id="p-start" type="date" value="${p ? (p.start_date || '') : ''}"></div>
          <div class="field"><label>🚩 마감일 <span class="muted">(업무일지 연동)</span></label><input class="input" id="p-end" type="date" value="${p ? (p.end_date || '') : ''}"></div>
        </div>
        <div class="field"><label>메모</label><textarea class="input" id="p-memo">${p ? esc(p.memo) : ''}</textarea></div>`,
      saveLabel: isNew ? '추가' : '저장',
      onSave: async (m) => {
        const name = m.querySelector('#p-name').value.trim();
        if (!name) { toast('단계명을 입력하세요'); return false; }
        const payload = {
          name, assignee: m.querySelector('#p-asg').value.trim(),
          start_date: m.querySelector('#p-start').value || null,
          end_date: m.querySelector('#p-end').value || null,
          status: m.querySelector('#p-status').value,
          memo: m.querySelector('#p-memo').value.trim()
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

  return { render, syncCompanyStatus, syncCompanyQuote };
})();
