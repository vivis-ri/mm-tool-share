// ============================================================
//  settings.js — 항목/프로세스/금액 템플릿(마스터)
//  대분류 그룹 · 프로세스 드래그 정렬 · 엑셀/텍스트 일괄 추가
// ============================================================
window.Settings = (function () {
  const { esc, money, toast, modal, confirm } = UI;
  const CATS = ['디자인', '컨설팅', '교육', '운영', '기타'];

  async function render(root) {
    const templates = UI.sortServiceTemplates(await DB.list('service_templates'));
    const allProc = await DB.list('process_templates');
    const procBy = {};
    allProc.forEach(p => { (procBy[p.service_template_id] = procBy[p.service_template_id] || []).push(p); });

    root.innerHTML = `
      <div class="page-head">
        <div>
          <div class="page-title">항목 설정</div>
          <div class="page-sub">서비스 항목 노출 순서를 정해두면 프로젝트 현황과 업체 상세에서 같은 순서로 표시됩니다.</div>
        </div>
        <div class="head-actions only-edit">
          <button class="btn ghost" id="reset-tpl-order">기본 순서 적용</button>
          <button class="btn primary" id="add-tpl">+ 서비스 항목 추가</button>
        </div>
      </div>
      ${templates.length ? `
        <div class="cat-group">
          <div class="cat-head">
            <span class="cat-badge">노출 순서</span>
            <span class="cat-cnt">${templates.length}개 항목 · 카드를 잡고 끌어서 순서를 바꾸세요.</span>
          </div>
          <div class="tpl-list service-order-list" data-template-list>
            ${templates.map((t, i) => card(t, procBy[t.id] || [], i)).join('')}
          </div>
        </div>` : emptyState()}
      <div class="hint-box only-edit">
        💡 서비스 항목 카드는 프로젝트 현황 노출 순서를, 프로세스 단계 줄은 업체 상세의 단계 순서를 정합니다.
      </div>`;

    bind(root);
  }

  function emptyState() {
    return `<div class="empty"><div class="em-ic">📦</div><p>아직 서비스 항목이 없습니다.<br>오른쪽 위 <b>+ 서비스 항목 추가</b>로 시작하세요.</p></div>`;
  }

  function card(t, procs, index) {
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

  // ---------- 이벤트 ----------
  function bind(root) {
    root.querySelector('#add-tpl')?.addEventListener('click', () => editTemplate());
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
        const t = (await DB.list('service_templates', { id }))[0]; editTemplate(t);
      });
      q('[data-del-tpl]')?.addEventListener('click', () => {
        confirm('이 서비스 항목과 하위 프로세스 단계를 모두 삭제할까요?', async () => {
          const procs = await DB.list('process_templates', { service_template_id: id });
          for (const p of procs) await DB.remove('process_templates', p.id);
          await DB.remove('service_templates', id);
          toast('삭제했습니다'); render(root);
        }, true);
      });
      q('[data-add-step]')?.addEventListener('click', () => editStep(id));
      q('[data-bulk]')?.addEventListener('click', () => bulkAdd(root, id));

      cardEl.querySelectorAll('.step-row').forEach(rowEl => {
        const pid = rowEl.dataset.id;
        rowEl.querySelector('[data-edit-step]')?.addEventListener('click', async () => {
          const p = (await DB.list('process_templates', { id: pid }))[0]; editStep(id, p);
        });
        rowEl.querySelector('[data-del-step]')?.addEventListener('click', async () => {
          await DB.remove('process_templates', pid); toast('삭제했습니다'); render(root);
        });
      });

      // 드래그 정렬
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

  // ---------- 모달 ----------
  function editTemplate(t) {
    const isNew = !t;
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
          <input class="input" id="f-amt" type="number" placeholder="예: 3000000" value="${t ? t.default_amount : ''}"></div>`,
      saveLabel: isNew ? '추가' : '저장',
      onSave: async (m) => {
        const name = m.querySelector('#f-name').value.trim();
        const cat = m.querySelector('#f-cat').value.trim() || '기타';
        const amt = Number(m.querySelector('#f-amt').value) || 0;
        if (!name) { toast('항목명을 입력하세요'); return false; }
        if (isNew) {
          await DB.insert('service_templates', { name, category: cat, default_amount: amt, sort_order: await nextTemplateSortOrder(name) });
        } else {
          await DB.update('service_templates', t.id, { name, category: cat, default_amount: amt });
        }
        toast('저장했습니다'); App.refresh();
      }
    });
  }

  function editStep(tplId, p) {
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
        toast('저장했습니다'); App.refresh();
      }
    });
  }

  // ---------- 일괄 추가(엑셀/텍스트) ----------
  function bulkAdd(root, tplId) {
    modal({
      title: '프로세스 단계 일괄 추가',
      wide: true,
      bodyHTML: `
        <p class="muted" style="margin-bottom:12px">엑셀에서 한 열을 복사해 붙여넣거나(한 줄에 한 단계), 파일을 선택하세요.</p>
        <div class="field">
          <label>파일 선택 <span class="muted">(.xlsx / .csv / .txt)</span></label>
          <input type="file" id="bulk-file" accept=".xlsx,.xls,.csv,.txt" class="input">
        </div>
        <div class="field">
          <label>단계 목록 (한 줄에 하나)</label>
          <textarea class="input" id="bulk-text" style="min-height:150px" placeholder="컨설팅\n네이밍/로고\n가이드 전달\n..."></textarea>
        </div>
        <div class="muted" id="bulk-count"></div>`,
      saveLabel: '추가',
      onOpen: (m) => {
        const ta = m.querySelector('#bulk-text');
        const cnt = m.querySelector('#bulk-count');
        const upd = () => {
          const n = ta.value.split(/\r?\n/).map(s => s.trim()).filter(Boolean).length;
          cnt.textContent = n ? `${n}개 단계가 추가됩니다.` : '';
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
        if (!names.length) { toast('추가할 단계가 없습니다'); return false; }
        let cnt = (await DB.list('process_templates', { service_template_id: tplId })).length;
        for (const name of names) { cnt++; await DB.insert('process_templates', { service_template_id: tplId, name, default_assignee: '', sort_order: cnt }); }
        toast(`${names.length}개 단계를 추가했습니다`); render(root);
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
        // 각 행의 첫 번째 비어있지 않은 칸을 단계명으로
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
