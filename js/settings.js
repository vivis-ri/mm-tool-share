// ============================================================
//  settings.js — 마스터(템플릿) 관리
//  서비스 항목 · 담당자 · 필요서류 묶음 · 작업물 카테고리
// ============================================================
window.Settings = (function () {
  const { esc, toast, modal, confirm } = UI;
  const CATS = ['디자인', '컨설팅', '교육', '운영', '기타'];
  const SET_KINDS = ['인허가', '서비스', '공통'];
  const CHANNELS = ['카톡', '드라이브', '메일', '직접전달', '기타'];

  const TABS = [
    { id: 'service', label: '서비스 항목', sub: '서비스 항목 노출 순서를 정해두면 프로젝트 현황과 업체 상세에서 같은 순서로 표시됩니다.' },
    { id: 'managers', label: '담당자', sub: '담당자를 등록해두면 업체와 프로세스 단계에서 선택 한 번으로 채워집니다. 연락처는 클라이언트 대시보드에도 표시됩니다.' },
    { id: 'reqsets', label: '필요서류 묶음', sub: '인허가 유형이나 서비스 항목별로 필요 서류를 묶어두면, 업체에 지정할 때 요청사항 체크리스트가 자동으로 만들어집니다.' },
    { id: 'delcats', label: '작업물 묶음', sub: '작업물 전달 기록의 분류이자, 시안 진행 순서 묶음입니다. 단계를 넣어두면 업체에 한 번에 깔 수 있습니다.' }
  ];

  let tab = localStorage.getItem('mm-settings-tab') || 'service';

  // ---------- 렌더 ----------
  async function render(root) {
    if (!TABS.some(t => t.id === tab)) tab = 'service';
    const meta = TABS.find(t => t.id === tab);

    const body =
      tab === 'service' ? await serviceBody() :
      tab === 'managers' ? await managersBody() :
      tab === 'reqsets' ? await reqSetsBody() :
      await delCatsBody();

    root.innerHTML = `
      <div class="page-head">
        <div>
          <div class="page-title">항목 설정</div>
          <div class="page-sub">${esc(meta.sub)}</div>
        </div>
      </div>
      <div class="set-tabs">
        ${TABS.map(t => `<button class="set-tab ${t.id === tab ? 'on' : ''}" data-tab="${t.id}">${esc(t.label)}</button>`).join('')}
      </div>
      ${body}`;

    root.querySelectorAll('[data-tab]').forEach(b => b.addEventListener('click', () => {
      tab = b.dataset.tab;
      localStorage.setItem('mm-settings-tab', tab);
      render(root);
    }));

    if (tab === 'service') bindService(root);
    else if (tab === 'managers') bindManagers(root);
    else if (tab === 'reqsets') bindReqSets(root);
    else bindDelCats(root);
  }

  const empty = (ic, msg) => `<div class="empty"><div class="em-ic">${ic}</div><p>${msg}</p></div>`;
  const hint = (msg) => `<div class="hint-box only-edit">💡 ${msg}</div>`;

  // ============================================================
  //  1. 서비스 항목
  // ============================================================
  async function serviceBody() {
    const templates = UI.sortServiceTemplates(await DB.list('service_templates'));
    const allProc = await DB.list('process_templates');
    const sets = await DB.list('request_sets');
    const setName = {}; sets.forEach(s => { setName[s.id] = s.name; });
    (await DB.list('delivery_categories')).forEach(c => { setName[c.id] = c.name; });
    const procBy = {};
    allProc.forEach(p => { (procBy[p.service_template_id] = procBy[p.service_template_id] || []).push(p); });

    return `
      <div class="set-toolbar only-edit">
        <button class="btn ghost" id="reset-tpl-order">기본 순서 적용</button>
        <button class="btn primary" id="add-tpl">+ 서비스 항목 추가</button>
      </div>
      ${templates.length ? `
        <div class="cat-group">
          <div class="cat-head">
            <span class="cat-badge">노출 순서</span>
            <span class="cat-cnt">${templates.length}개 항목 · 카드를 잡고 끌어서 순서를 바꾸세요.</span>
          </div>
          <div class="tpl-list service-order-list" data-template-list>
            ${templates.map((t, i) => tplCard(t, procBy[t.id] || [], i, setName)).join('')}
          </div>
        </div>` : empty('📦', '아직 서비스 항목이 없습니다.<br>오른쪽 위 <b>+ 서비스 항목 추가</b>로 시작하세요.')}
      ${hint('서비스 항목 카드는 프로젝트 현황 노출 순서를, 프로세스 단계 줄은 업체 상세의 단계 순서를 정합니다. 항목에 <b>필요서류 묶음</b>을 걸어두면 업체에 그 항목을 추가할 때 요청사항이 자동으로 생깁니다.')}`;
  }

  function tplCard(t, procs, index, setName) {
    const linked = (t.request_set_ids || []).map(id => setName[id]).filter(Boolean);
    const linkedDlv = (t.delivery_set_ids || []).map(id => setName[id]).filter(Boolean);
    return `
      <div class="tpl-card card" data-id="${t.id}">
        <div class="tpl-top">
          <div class="tpl-name">
            <span class="drag-handle tpl-drag only-edit" title="끌어서 항목 노출 순서 변경">⠿</span>
            <span class="tpl-order">${index + 1}</span>
            <span class="dot"></span>
            <b>${esc(t.name)}</b>
            <span class="tpl-cat">${esc(t.category || '기타')}</span>
            <span class="tpl-amt">${UI.moneyVatHTML(t.default_amount, '포함')}</span>
          </div>
          <div class="tpl-actions only-edit">
            <button class="btn sm ghost" data-bulk>📋 일괄 추가</button>
            <button class="icon-btn" data-edit-tpl title="항목 수정">✎</button>
            <button class="icon-btn" data-del-tpl title="항목 삭제">🗑</button>
          </div>
        </div>
        ${linked.length ? `<div class="tpl-sets">📋 서류 ${linked.map(n => `<span class="set-chip">${esc(n)}</span>`).join('')}</div>` : ''}
        ${linkedDlv.length ? `<div class="tpl-sets">📦 작업물 ${linkedDlv.map(n => `<span class="set-chip dlv">${esc(n)}</span>`).join('')}</div>` : ''}
        <div class="proc-steps" data-steps>
          ${procs.length
            ? procs.map((p, i) => stepRow(p, i)).join('')
            : `<div class="proc-empty">프로세스 단계가 없습니다.</div>`}
        </div>
        <button class="add-step only-edit" data-add-step>+ 프로세스 단계 추가</button>
      </div>`;
  }

  function stepRow(p, i) {
    return `
      <div class="step-row" data-id="${p.id}">
        <span class="drag-handle only-edit" title="끌어서 순서 변경">⠿</span>
        <span class="step-idx">${i + 1}</span>
        <span class="step-name">${esc(p.name)}</span>
        <span class="step-tools only-edit">
          <button class="icon-btn xs" data-edit-step>✎</button>
          <button class="icon-btn xs" data-del-step>✕</button>
        </span>
      </div>`;
  }

  function defaultSortedTemplates(templates) {
    return [...(templates || [])].sort((a, b) => {
      const ad = UI.defaultServiceOrder(a.name);
      const bd = UI.defaultServiceOrder(b.name);
      if (ad !== bd) return ad - bd;
      const av = Number(a.sort_order) || Number.MAX_SAFE_INTEGER;
      const bv = Number(b.sort_order) || Number.MAX_SAFE_INTEGER;
      if (av !== bv) return av - bv;
      return String(a.name || '').localeCompare(String(b.name || ''), 'ko-KR');
    });
  }

  async function nextTemplateSortOrder(name) {
    const templates = await DB.list('service_templates');
    if (UI.hasManualServiceOrder(templates)) {
      const max = templates.reduce((n, t) => Math.max(n, Number(t.sort_order) || 0), UI.MANUAL_SERVICE_ORDER_BASE - 1);
      return Math.max(max + 1, UI.MANUAL_SERVICE_ORDER_BASE);
    }
    const order = UI.defaultServiceOrder(name);
    return order === Number.MAX_SAFE_INTEGER ? templates.length + 1 : order + 1;
  }

  function bindService(root) {
    root.querySelector('#add-tpl')?.addEventListener('click', () => editTemplate(root));
    root.querySelector('#reset-tpl-order')?.addEventListener('click', () => {
      confirm('서비스 항목 노출 순서를 기본 순서로 다시 맞출까요?', async () => {
        const ordered = defaultSortedTemplates(await DB.list('service_templates'));
        for (let i = 0; i < ordered.length; i++) await DB.update('service_templates', ordered[i].id, { sort_order: i + 1 });
        toast('기본 순서를 적용했습니다');
        render(root);
      });
    });

    const templateList = root.querySelector('[data-template-list]');
    if (templateList) {
      DragSort.enable(templateList, {
        itemSelector: '.tpl-card', handleSelector: '.tpl-drag',
        onReorder: async (ids) => {
          for (let i = 0; i < ids.length; i++) {
            await DB.update('service_templates', ids[i], { sort_order: UI.MANUAL_SERVICE_ORDER_BASE + i });
          }
          toast('항목 노출 순서를 저장했습니다');
          render(root);
        }
      });
    }

    root.querySelectorAll('.tpl-card').forEach(cardEl => {
      const id = cardEl.dataset.id;
      const q = s => cardEl.querySelector(s);

      q('[data-edit-tpl]')?.addEventListener('click', async () => {
        const t = (await DB.list('service_templates', { id }))[0]; editTemplate(root, t);
      });
      q('[data-del-tpl]')?.addEventListener('click', () => {
        confirm('이 서비스 항목과 하위 프로세스 단계를 모두 삭제할까요?', async () => {
          const procs = await DB.list('process_templates', { service_template_id: id });
          for (const p of procs) await DB.remove('process_templates', p.id);
          await DB.remove('service_templates', id);
          toast('삭제했습니다'); render(root);
        }, true);
      });
      q('[data-add-step]')?.addEventListener('click', () => editStep(root, id));
      q('[data-bulk]')?.addEventListener('click', () => bulkAdd(root, {
        title: '프로세스 단계 일괄 추가', unit: '단계', placeholder: '컨설팅\n네이밍/로고\n가이드 전달\n...',
        table: 'process_templates', fk: { service_template_id: id }, extra: { default_assignee: '' }
      }));

      cardEl.querySelectorAll('.step-row').forEach(rowEl => {
        const pid = rowEl.dataset.id;
        rowEl.querySelector('[data-edit-step]')?.addEventListener('click', async () => {
          const p = (await DB.list('process_templates', { id: pid }))[0]; editStep(root, id, p);
        });
        rowEl.querySelector('[data-del-step]')?.addEventListener('click', async () => {
          await DB.remove('process_templates', pid); toast('삭제했습니다'); render(root);
        });
      });

      const stepsBox = q('[data-steps]');
      if (stepsBox) DragSort.enable(stepsBox, {
        itemSelector: '.step-row', handleSelector: '.drag-handle',
        onReorder: async (ids) => {
          for (let i = 0; i < ids.length; i++) await DB.update('process_templates', ids[i], { sort_order: i + 1 });
          render(root);
        }
      });
    });
  }

  async function editTemplate(root, t) {
    const isNew = !t;
    const sets = await DB.list('request_sets');
    const picked = new Set(t ? (t.request_set_ids || []) : []);
    const allCats = await DB.list('delivery_categories');
    const stageCnt = {};
    (await DB.list('delivery_templates')).forEach(s => { stageCnt[s.category_id] = (stageCnt[s.category_id] || 0) + 1; });
    const dlvSets = allCats.filter(c => stageCnt[c.id]);
    const pickedDlv = new Set(t ? (t.delivery_set_ids || []) : []);
    modal({
      title: isNew ? '서비스 항목 추가' : '서비스 항목 수정',
      bodyHTML: `
        <div class="field"><label>대분류</label>
          <input class="input" id="f-cat" list="cat-list" placeholder="예: 디자인" value="${t ? esc(t.category || '기타') : ''}">
          <datalist id="cat-list">${CATS.map(c => `<option>${c}</option>`).join('')}</datalist>
        </div>
        <div class="field"><label>항목명</label>
          <input class="input" id="f-name" placeholder="예: 브랜딩, 패키지, 촬영" value="${t ? esc(t.name) : ''}"></div>
        <div class="field"><label>기본 금액 (원, VAT 포함)</label>
          <input class="input" id="f-amt" type="number" placeholder="예: 3000000" value="${t ? t.default_amount : ''}"></div>
        <div class="field"><label>필요서류 묶음 <span class="muted">(이 항목을 업체에 추가하면 자동으로 요청사항이 생깁니다)</span></label>
          ${sets.length
            ? `<div class="chk-grid">${sets.map(s => `
                <label class="chk"><input type="checkbox" data-set="${s.id}" ${picked.has(s.id) ? 'checked' : ''}>
                <span>${esc(s.name)}<em>${esc(s.kind || '공통')}</em></span></label>`).join('')}</div>`
            : `<div class="muted">등록된 묶음이 없습니다. 필요서류 묶음 탭에서 먼저 만들어 주세요.</div>`}
        </div>
        <div class="field"><label>작업물 묶음 <span class="muted">(이 항목을 업체에 추가하면 시안 단계가 예정으로 깔립니다)</span></label>
          ${dlvSets.length
            ? `<div class="chk-grid">${dlvSets.map(c => `
                <label class="chk"><input type="checkbox" data-dset="${c.id}" ${pickedDlv.has(c.id) ? 'checked' : ''}>
                <span>${esc(c.name)}<em>${stageCnt[c.id]}단계</em></span></label>`).join('')}</div>`
            : `<div class="muted">단계가 있는 작업물 묶음이 없습니다. 작업물 묶음 탭에서 먼저 만들어 주세요.</div>`}
        </div>`,
      saveLabel: isNew ? '추가' : '저장',
      onSave: async (m) => {
        const name = m.querySelector('#f-name').value.trim();
        const cat = m.querySelector('#f-cat').value.trim() || '기타';
        const amt = Number(m.querySelector('#f-amt').value) || 0;
        const setIds = [...m.querySelectorAll('[data-set]:checked')].map(c => c.dataset.set);
        const dsetIds = [...m.querySelectorAll('[data-dset]:checked')].map(c => c.dataset.dset);
        if (!name) { toast('항목명을 입력하세요'); return false; }
        if (isNew) {
          await DB.insert('service_templates', { name, category: cat, default_amount: amt, request_set_ids: setIds, delivery_set_ids: dsetIds, sort_order: await nextTemplateSortOrder(name) });
        } else {
          await DB.update('service_templates', t.id, { name, category: cat, default_amount: amt, request_set_ids: setIds, delivery_set_ids: dsetIds });
        }
        toast('저장했습니다'); render(root);
      }
    });
  }

  function editStep(root, tplId, p) {
    const isNew = !p;
    modal({
      title: isNew ? '프로세스 단계 추가' : '단계 수정',
      bodyHTML: `
        <div class="field"><label>단계명</label>
          <input class="input" id="f-sname" placeholder="예: 컨설팅, 촬영일, 상세페이지" value="${p ? esc(p.name) : ''}"></div>`,
      saveLabel: isNew ? '추가' : '저장',
      onSave: async (m) => {
        const name = m.querySelector('#f-sname').value.trim();
        if (!name) { toast('단계명을 입력하세요'); return false; }
        if (isNew) {
          const cnt = (await DB.list('process_templates', { service_template_id: tplId })).length;
          await DB.insert('process_templates', { service_template_id: tplId, name, default_assignee: '', sort_order: cnt + 1 });
        } else {
          await DB.update('process_templates', p.id, { name });
        }
        toast('저장했습니다'); render(root);
      }
    });
  }

  // ============================================================
  //  2. 담당자
  // ============================================================
  async function managersBody() {
    const rows = await DB.list('managers');
    return `
      <div class="set-toolbar only-edit">
        <button class="btn primary" id="add-mgr">+ 담당자 추가</button>
      </div>
      ${rows.length ? `
        <div class="mst-list" data-mgr-list>
          ${rows.map(m => `
            <div class="mst-row card" data-id="${m.id}">
              <span class="drag-handle only-edit" title="끌어서 순서 변경">⠿</span>
              <span class="mst-name">${esc(m.name)}</span>
              <span class="mst-sub">${esc(m.contact || '연락처 없음')}</span>
              <span class="mst-sub">${esc(m.email || '')}</span>
              <span class="mst-tools only-edit">
                <button class="icon-btn xs" data-edit>✎</button>
                <button class="icon-btn xs" data-del>✕</button>
              </span>
            </div>`).join('')}
        </div>` : empty('👤', '등록된 담당자가 없습니다.<br><b>+ 담당자 추가</b>로 시작하세요.')}
      ${hint('여기 등록한 담당자는 업체 정보와 프로세스 단계에서 선택할 수 있고, 이름·연락처가 클라이언트 대시보드의 담당자 카드에 표시됩니다.')}`;
  }

  function bindManagers(root) {
    root.querySelector('#add-mgr')?.addEventListener('click', () => editManager(root));
    const list = root.querySelector('[data-mgr-list]');
    if (list) DragSort.enable(list, {
      itemSelector: '.mst-row', handleSelector: '.drag-handle',
      onReorder: async (ids) => {
        for (let i = 0; i < ids.length; i++) await DB.update('managers', ids[i], { sort_order: i + 1 });
        render(root);
      }
    });
    root.querySelectorAll('.mst-row').forEach(rowEl => {
      const id = rowEl.dataset.id;
      rowEl.querySelector('[data-edit]')?.addEventListener('click', async () => {
        editManager(root, (await DB.list('managers', { id }))[0]);
      });
      rowEl.querySelector('[data-del]')?.addEventListener('click', () => {
        confirm('이 담당자를 삭제할까요? 이미 지정된 업체의 담당자 표시는 이름만 남습니다.', async () => {
          await DB.remove('managers', id); toast('삭제했습니다'); render(root);
        }, true);
      });
    });
  }

  function editManager(root, m) {
    const isNew = !m;
    modal({
      title: isNew ? '담당자 추가' : '담당자 수정',
      bodyHTML: `
        <div class="field"><label>이름</label>
          <input class="input" id="f-mname" placeholder="예: 이비비" value="${m ? esc(m.name) : ''}"></div>
        <div class="field"><label>연락처 <span class="muted">(클라이언트 대시보드에 표시됩니다)</span></label>
          <input class="input" id="f-mcontact" placeholder="예: 010-5820-0421" value="${m ? esc(m.contact || '') : ''}"></div>
        <div class="field"><label>이메일 <span class="muted">(선택)</span></label>
          <input class="input" id="f-memail" placeholder="예: mmcl2020@naver.com" value="${m ? esc(m.email || '') : ''}"></div>`,
      saveLabel: isNew ? '추가' : '저장',
      onSave: async (mm) => {
        const name = mm.querySelector('#f-mname').value.trim();
        const contact = mm.querySelector('#f-mcontact').value.trim();
        const email = mm.querySelector('#f-memail').value.trim();
        if (!name) { toast('이름을 입력하세요'); return false; }
        if (isNew) {
          const cnt = (await DB.list('managers')).length;
          await DB.insert('managers', { name, contact, email, memo: '', sort_order: cnt + 1 });
        } else {
          await DB.update('managers', m.id, { name, contact, email });
        }
        toast('저장했습니다'); render(root);
      }
    });
  }

  // ============================================================
  //  3. 필요서류 묶음
  // ============================================================
  async function reqSetsBody() {
    const sets = await DB.list('request_sets');
    const docs = await DB.list('request_templates');
    const docBy = {};
    docs.forEach(d => { (docBy[d.set_id] = docBy[d.set_id] || []).push(d); });

    const byKind = {};
    sets.forEach(s => { (byKind[s.kind || '공통'] = byKind[s.kind || '공통'] || []).push(s); });

    const groups = SET_KINDS.filter(k => byKind[k]).map(k => `
      <div class="cat-group">
        <div class="cat-head">
          <span class="cat-badge">${esc(k)}</span>
          <span class="cat-cnt">${byKind[k].length}개 묶음</span>
        </div>
        <div class="tpl-list" data-set-list="${esc(k)}">
          ${byKind[k].map(s => setCard(s, docBy[s.id] || [])).join('')}
        </div>
      </div>`).join('');

    return `
      <div class="set-toolbar only-edit">
        <button class="btn primary" id="add-set">+ 묶음 추가</button>
      </div>
      ${sets.length ? groups : empty('📋', '아직 필요서류 묶음이 없습니다.<br><b>+ 묶음 추가</b>로 시작하세요.')}
      ${hint('<b>인허가</b> 묶음은 업체에 인허가 유형을 지정하면, <b>서비스</b> 묶음은 서비스 항목에 걸어두면 자동으로 요청사항이 만들어집니다. 같은 서류가 여러 묶음에 겹쳐도 업체에는 한 번만 들어갑니다.')}`;
  }

  function setCard(s, docs) {
    return `
      <div class="tpl-card card" data-id="${s.id}">
        <div class="tpl-top">
          <div class="tpl-name">
            <span class="drag-handle tpl-drag only-edit" title="끌어서 순서 변경">⠿</span>
            <span class="dot"></span>
            <b>${esc(s.name)}</b>
            <span class="tpl-cat">${esc(s.kind || '공통')}</span>
            <span class="tpl-amt">서류 ${docs.length}건</span>
          </div>
          <div class="tpl-actions only-edit">
            <button class="btn sm ghost" data-bulk>📋 일괄 추가</button>
            <button class="icon-btn" data-edit-set title="묶음 수정">✎</button>
            <button class="icon-btn" data-del-set title="묶음 삭제">🗑</button>
          </div>
        </div>
        <div class="proc-steps" data-docs>
          ${docs.length
            ? docs.map((d, i) => `
              <div class="step-row" data-id="${d.id}">
                <span class="drag-handle only-edit" title="끌어서 순서 변경">⠿</span>
                <span class="step-idx">${i + 1}</span>
                <span class="step-name">${esc(d.name)}${d.memo ? `<em class="step-memo">${esc(d.memo)}</em>` : ''}</span>
                <span class="step-tools only-edit">
                  <button class="icon-btn xs" data-edit-doc>✎</button>
                  <button class="icon-btn xs" data-del-doc>✕</button>
                </span>
              </div>`).join('')
            : `<div class="proc-empty">서류가 없습니다.</div>`}
        </div>
        <button class="add-step only-edit" data-add-doc>+ 서류 추가</button>
      </div>`;
  }

  function bindReqSets(root) {
    root.querySelector('#add-set')?.addEventListener('click', () => editSet(root));

    root.querySelectorAll('[data-set-list]').forEach(listEl => {
      DragSort.enable(listEl, {
        itemSelector: '.tpl-card', handleSelector: '.tpl-drag',
        onReorder: async (ids) => {
          for (let i = 0; i < ids.length; i++) await DB.update('request_sets', ids[i], { sort_order: i + 1 });
          render(root);
        }
      });
    });

    root.querySelectorAll('.tpl-card').forEach(cardEl => {
      const id = cardEl.dataset.id;
      const q = s => cardEl.querySelector(s);

      q('[data-edit-set]')?.addEventListener('click', async () => {
        editSet(root, (await DB.list('request_sets', { id }))[0]);
      });
      q('[data-del-set]')?.addEventListener('click', () => {
        confirm('이 묶음과 안에 든 서류 목록을 모두 삭제할까요? 이미 업체에 들어간 요청사항은 그대로 남습니다.', async () => {
          for (const d of await DB.list('request_templates', { set_id: id })) await DB.remove('request_templates', d.id);
          await DB.remove('request_sets', id);
          toast('삭제했습니다'); render(root);
        }, true);
      });
      q('[data-add-doc]')?.addEventListener('click', () => editDoc(root, id));
      q('[data-bulk]')?.addEventListener('click', () => bulkAdd(root, {
        title: '필요 서류 일괄 추가', unit: '서류', placeholder: '사업자등록증\n통장 사본\n영업신고증\n...',
        table: 'request_templates', fk: { set_id: id }, extra: { memo: '' }
      }));

      cardEl.querySelectorAll('.step-row').forEach(rowEl => {
        const did = rowEl.dataset.id;
        rowEl.querySelector('[data-edit-doc]')?.addEventListener('click', async () => {
          editDoc(root, id, (await DB.list('request_templates', { id: did }))[0]);
        });
        rowEl.querySelector('[data-del-doc]')?.addEventListener('click', async () => {
          await DB.remove('request_templates', did); toast('삭제했습니다'); render(root);
        });
      });

      const docsBox = q('[data-docs]');
      if (docsBox) DragSort.enable(docsBox, {
        itemSelector: '.step-row', handleSelector: '.drag-handle',
        onReorder: async (ids) => {
          for (let i = 0; i < ids.length; i++) await DB.update('request_templates', ids[i], { sort_order: i + 1 });
          render(root);
        }
      });
    });
  }

  function editSet(root, s) {
    const isNew = !s;
    modal({
      title: isNew ? '필요서류 묶음 추가' : '묶음 수정',
      bodyHTML: `
        <div class="field"><label>종류</label>
          <select class="input" id="f-kind">
            ${SET_KINDS.map(k => `<option ${s && s.kind === k ? 'selected' : ''}>${k}</option>`).join('')}
          </select>
          <div class="muted" style="margin-top:6px">인허가 = 업체의 인허가 유형으로 자동 적용 · 서비스 = 서비스 항목에 걸어서 자동 적용 · 공통 = 필요할 때 직접 가져오기</div>
        </div>
        <div class="field"><label>묶음 이름</label>
          <input class="input" id="f-setname" placeholder="예: 즉석판매제조가공업, 와디즈 기본" value="${s ? esc(s.name) : ''}"></div>`,
      saveLabel: isNew ? '추가' : '저장',
      onSave: async (m) => {
        const name = m.querySelector('#f-setname').value.trim();
        const kind = m.querySelector('#f-kind').value;
        if (!name) { toast('묶음 이름을 입력하세요'); return false; }
        if (isNew) {
          const cnt = (await DB.list('request_sets')).length;
          await DB.insert('request_sets', { name, kind, sort_order: cnt + 1 });
        } else {
          await DB.update('request_sets', s.id, { name, kind });
        }
        toast('저장했습니다'); render(root);
      }
    });
  }

  function editDoc(root, setId, d) {
    const isNew = !d;
    modal({
      title: isNew ? '필요 서류 추가' : '서류 수정',
      bodyHTML: `
        <div class="field"><label>서류명</label>
          <input class="input" id="f-dname" placeholder="예: 사업자등록증" value="${d ? esc(d.name) : ''}"></div>
        <div class="field"><label>안내 문구 <span class="muted">(선택 — 클라이언트에게 함께 보입니다)</span></label>
          <input class="input" id="f-dmemo" placeholder="예: 사본 가능, 최근 3개월 이내" value="${d ? esc(d.memo || '') : ''}"></div>`,
      saveLabel: isNew ? '추가' : '저장',
      onSave: async (m) => {
        const name = m.querySelector('#f-dname').value.trim();
        const memo = m.querySelector('#f-dmemo').value.trim();
        if (!name) { toast('서류명을 입력하세요'); return false; }
        if (isNew) {
          const cnt = (await DB.list('request_templates', { set_id: setId })).length;
          await DB.insert('request_templates', { set_id: setId, name, memo, sort_order: cnt + 1 });
        } else {
          await DB.update('request_templates', d.id, { name, memo });
        }
        toast('저장했습니다'); render(root);
      }
    });
  }

  // ============================================================
  //  4. 작업물 카테고리
  // ============================================================
  async function delCatsBody() {
    const cats = await DB.list('delivery_categories');
    const stages = await DB.list('delivery_templates');
    const byCat = {};
    stages.forEach(s => { (byCat[s.category_id] = byCat[s.category_id] || []).push(s); });

    return `
      <div class="set-toolbar only-edit">
        <button class="btn primary" id="add-cat">+ 묶음 추가</button>
      </div>
      ${cats.length ? `
        <div class="tpl-list" data-cat-list>
          ${cats.map(c => catCard(c, byCat[c.id] || [])).join('')}
        </div>` : empty('📦', '작업물 묶음이 없습니다.<br><b>+ 묶음 추가</b>로 시작하세요.')}
      ${hint(`단계를 넣어둔 묶음(예: 패키지 = 컨셉제안서 → 1차시안 → …)은 업체 상세의 <b>작업물 전달 기록 → 묶음에서 가져오기</b>로 한 번에 깔 수 있고, 클라이언트 대시보드에서는 이 묶음 이름으로 필터가 만들어집니다. 단계를 안 넣으면 단순 분류로만 쓰입니다. 전달 수단(${CHANNELS.join(' / ')})은 고정입니다.`)}`;
  }

  function catCard(c, stages) {
    return `
      <div class="tpl-card card" data-id="${c.id}">
        <div class="tpl-top">
          <div class="tpl-name">
            <span class="drag-handle tpl-drag only-edit" title="끌어서 순서 변경">⠿</span>
            <span class="dot"></span>
            <b>${esc(c.name)}</b>
            <span class="tpl-amt">${stages.length ? `${stages.length}단계` : '분류 전용'}</span>
          </div>
          <div class="tpl-actions only-edit">
            <button class="btn sm ghost" data-bulk>📋 일괄 추가</button>
            <button class="icon-btn" data-edit-cat title="묶음 수정">✎</button>
            <button class="icon-btn" data-del-cat title="묶음 삭제">🗑</button>
          </div>
        </div>
        <div class="proc-steps" data-stages>
          ${stages.length
            ? stages.map((s, i) => `
              <div class="step-row" data-id="${s.id}">
                <span class="drag-handle only-edit" title="끌어서 순서 변경">⠿</span>
                <span class="step-idx">${i + 1}</span>
                <span class="step-name">${esc(s.name)}</span>
                <span class="step-tools only-edit">
                  <button class="icon-btn xs" data-edit-stage>✎</button>
                  <button class="icon-btn xs" data-del-stage>✕</button>
                </span>
              </div>`).join('')
            : `<div class="proc-empty">단계가 없습니다(분류로만 사용).</div>`}
        </div>
        <button class="add-step only-edit" data-add-stage>+ 단계 추가</button>
      </div>`;
  }

  function bindDelCats(root) {
    root.querySelector('#add-cat')?.addEventListener('click', () => editCat(root));

    const list = root.querySelector('[data-cat-list]');
    if (list) DragSort.enable(list, {
      itemSelector: '.tpl-card', handleSelector: '.tpl-drag',
      onReorder: async (ids) => {
        for (let i = 0; i < ids.length; i++) await DB.update('delivery_categories', ids[i], { sort_order: i + 1 });
        render(root);
      }
    });

    root.querySelectorAll('.tpl-card').forEach(cardEl => {
      const id = cardEl.dataset.id;
      const q = s => cardEl.querySelector(s);

      q('[data-edit-cat]')?.addEventListener('click', async () => {
        editCat(root, (await DB.list('delivery_categories', { id }))[0]);
      });
      q('[data-del-cat]')?.addEventListener('click', () => {
        confirm('이 묶음과 안에 든 단계를 모두 삭제할까요? 이미 기록된 작업물은 분류만 비워집니다.', async () => {
          for (const s of await DB.list('delivery_templates', { category_id: id })) await DB.remove('delivery_templates', s.id);
          await DB.remove('delivery_categories', id);
          toast('삭제했습니다'); render(root);
        }, true);
      });
      q('[data-add-stage]')?.addEventListener('click', () => editStage(root, id));
      q('[data-bulk]')?.addEventListener('click', () => bulkAdd(root, {
        title: '작업물 단계 일괄 추가', unit: '단계', placeholder: '컨셉제안서\n1차시안\n2차시안\n수정본\n최종시안\n...',
        table: 'delivery_templates', fk: { category_id: id }, extra: {}
      }));

      cardEl.querySelectorAll('.step-row').forEach(rowEl => {
        const sid = rowEl.dataset.id;
        rowEl.querySelector('[data-edit-stage]')?.addEventListener('click', async () => {
          editStage(root, id, (await DB.list('delivery_templates', { id: sid }))[0]);
        });
        rowEl.querySelector('[data-del-stage]')?.addEventListener('click', async () => {
          await DB.remove('delivery_templates', sid); toast('삭제했습니다'); render(root);
        });
      });

      const box = q('[data-stages]');
      if (box) DragSort.enable(box, {
        itemSelector: '.step-row', handleSelector: '.drag-handle',
        onReorder: async (ids) => {
          for (let i = 0; i < ids.length; i++) await DB.update('delivery_templates', ids[i], { sort_order: i + 1 });
          render(root);
        }
      });
    });
  }

  function editCat(root, c) {
    const isNew = !c;
    modal({
      title: isNew ? '작업물 묶음 추가' : '묶음 수정',
      bodyHTML: `
        <div class="field"><label>묶음 이름</label>
          <input class="input" id="f-cname" placeholder="예: 패키지, 로고, 상세페이지, 촬영 원본" value="${c ? esc(c.name) : ''}"></div>`,
      saveLabel: isNew ? '추가' : '저장',
      onSave: async (m) => {
        const name = m.querySelector('#f-cname').value.trim();
        if (!name) { toast('묶음 이름을 입력하세요'); return false; }
        if (isNew) {
          const cnt = (await DB.list('delivery_categories')).length;
          await DB.insert('delivery_categories', { name, sort_order: cnt + 1 });
        } else {
          await DB.update('delivery_categories', c.id, { name });
        }
        toast('저장했습니다'); render(root);
      }
    });
  }

  function editStage(root, catId, s) {
    const isNew = !s;
    modal({
      title: isNew ? '작업물 단계 추가' : '단계 수정',
      bodyHTML: `
        <div class="field"><label>단계명</label>
          <input class="input" id="f-stname" placeholder="예: 1차시안, 최종시안, 인쇄가이드 및 인쇄용 파일" value="${s ? esc(s.name) : ''}"></div>`,
      saveLabel: isNew ? '추가' : '저장',
      onSave: async (m) => {
        const name = m.querySelector('#f-stname').value.trim();
        if (!name) { toast('단계명을 입력하세요'); return false; }
        if (isNew) {
          const cnt = (await DB.list('delivery_templates', { category_id: catId })).length;
          await DB.insert('delivery_templates', { category_id: catId, name, sort_order: cnt + 1 });
        } else {
          await DB.update('delivery_templates', s.id, { name });
        }
        toast('저장했습니다'); render(root);
      }
    });
  }

  // ============================================================
  //  일괄 추가(엑셀/텍스트) — 프로세스 단계·필요 서류 공용
  // ============================================================
  function bulkAdd(root, opt) {
    modal({
      title: opt.title,
      wide: true,
      bodyHTML: `
        <p class="muted" style="margin-bottom:12px">엑셀에서 한 열을 복사해 붙여넣거나(한 줄에 하나), 파일을 선택하세요.</p>
        <div class="field">
          <label>파일 선택 <span class="muted">(.xlsx / .csv / .txt)</span></label>
          <input type="file" id="bulk-file" accept=".xlsx,.xls,.csv,.txt" class="input">
        </div>
        <div class="field">
          <label>${esc(opt.unit)} 목록 (한 줄에 하나)</label>
          <textarea class="input" id="bulk-text" style="min-height:150px" placeholder="${esc(opt.placeholder)}"></textarea>
        </div>
        <div class="muted" id="bulk-count"></div>`,
      saveLabel: '추가',
      onOpen: (m) => {
        const ta = m.querySelector('#bulk-text');
        const cnt = m.querySelector('#bulk-count');
        const upd = () => {
          const n = ta.value.split(/\r?\n/).map(s => s.trim()).filter(Boolean).length;
          cnt.textContent = n ? `${n}개 ${opt.unit}가 추가됩니다.` : '';
        };
        ta.addEventListener('input', upd);
        m.querySelector('#bulk-file').addEventListener('change', async (e) => {
          const file = e.target.files[0]; if (!file) return;
          try {
            const names = await parseFile(file);
            ta.value = (ta.value.trim() ? ta.value.trim() + '\n' : '') + names.join('\n');
            upd(); toast(`${names.length}개 읽었습니다`);
          } catch (err) { console.error(err); toast('파일을 읽지 못했습니다'); }
        });
      },
      onSave: async (m) => {
        const names = m.querySelector('#bulk-text').value.split(/\r?\n/).map(s => s.trim()).filter(Boolean);
        if (!names.length) { toast(`추가할 ${opt.unit}가 없습니다`); return false; }
        let cnt = (await DB.list(opt.table, opt.fk)).length;
        for (const name of names) {
          cnt++;
          await DB.insert(opt.table, { ...opt.fk, ...(opt.extra || {}), name, sort_order: cnt });
        }
        toast(`${names.length}개 추가했습니다`); render(root);
      }
    });
  }

  function parseFile(file) {
    const ext = (file.name.split('.').pop() || '').toLowerCase();
    if (ext === 'xlsx' || ext === 'xls') {
      return file.arrayBuffer().then(buf => {
        const wb = XLSX.read(buf, { type: 'array' });
        const ws = wb.Sheets[wb.SheetNames[0]];
        const rows = XLSX.utils.sheet_to_json(ws, { header: 1, blankrows: false });
        // 각 행의 첫 번째 비어있지 않은 칸을 이름으로
        return rows.map(r => (r || []).map(c => String(c == null ? '' : c).trim()).find(Boolean)).filter(Boolean);
      });
    }
    // csv / txt
    return file.text().then(text => text.split(/\r?\n/).map(line => {
      const cell = line.split(/[,\t]/)[0]; return (cell || '').trim();
    }).filter(Boolean));
  }

  return { render };
})();
