// ============================================================
//  client-share.js — 클라이언트 공유 대시보드
//  · 업체별 공유 링크(주소 + URL 열쇠) 발급·관리
//  · 요청사항 체크리스트(필요서류 묶음에서 자동 생성)
//  · 작업물 전달 기록(파일명 · 전달수단 · 링크 · 카테고리)
//  업체 상세 화면(detail.js)에 섹션으로 끼워 넣는다.
// ============================================================
window.ClientShare = (function () {
  const { esc, toast, modal, confirm } = UI;

  const CHANNELS = ['카톡', '드라이브', '메일', '직접전달', '기타'];
  const DIRECTIONS = ['전달', '수령'];
  const COMPANY_NAME = '엠엠컨설팅연구소';

  // ============================================================
  //  링크 · 열쇠
  // ============================================================
  function baseUrl() {
    const info = (window.Share && window.Share.load) ? window.Share.load() : {};
    let u = String(info.url || '').trim();
    if (!u) return '';
    return u.endsWith('/') ? u : u + '/';
  }

  function clientUrl(c) {
    const b = baseUrl();
    if (!b || !c.share_slug || !c.share_key) return '';
    return b + 'c/' + c.share_slug + '/#k=' + c.share_key;
  }

  // 256bit 랜덤 열쇠 → base64url. 링크의 # 뒤에 실려 서버로 전송되지 않는다.
  function randKey() {
    const u = new Uint8Array(32);
    crypto.getRandomValues(u);
    let s = '';
    for (let i = 0; i < u.length; i++) s += String.fromCharCode(u[i]);
    return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  }

  function randTail(n) {
    const abc = 'abcdefghijkmnpqrstuvwxyz23456789';
    let s = '';
    for (let i = 0; i < n; i++) s += abc[Math.floor(Math.random() * abc.length)];
    return s;
  }

  // 한글 업체명 → 로마자(개정 로마자 표기법 근사). 주소에 쓰려는 목적이라 음운변화는 생략.
  const CHO = ['g', 'kk', 'n', 'd', 'tt', 'r', 'm', 'b', 'pp', 's', 'ss', '', 'j', 'jj', 'ch', 'k', 't', 'p', 'h'];
  const JUNG = ['a', 'ae', 'ya', 'yae', 'eo', 'e', 'yeo', 'ye', 'o', 'wa', 'wae', 'oe', 'yo', 'u', 'wo', 'we', 'wi', 'yu', 'eu', 'ui', 'i'];
  const JONG = ['', 'k', 'k', 'k', 'n', 'n', 'n', 't', 'l', 'k', 'm', 'l', 'l', 'l', 'p', 'l', 'm', 'p', 't', 't', 'ng', 't', 't', 'k', 't', 'p', 't'];

  function romanize(str) {
    let out = '';
    for (const ch of String(str || '')) {
      const code = ch.charCodeAt(0) - 0xAC00;
      if (code >= 0 && code <= 11171) {
        out += CHO[Math.floor(code / 588)] + JUNG[Math.floor((code % 588) / 28)] + JONG[code % 28];
      } else if (/[a-zA-Z0-9]/.test(ch)) {
        out += ch;
      } else {
        out += '-';
      }
    }
    return out.toLowerCase().replace(/-+/g, '-').replace(/^-|-$/g, '');
  }

  // 업체명 + 랜덤 꼬리표. 관리할 땐 어느 업체인지 보이고, 추측으로는 못 들어온다.
  async function makeSlug(name) {
    let head = romanize(name).replace(/[^a-z0-9-]/g, '').slice(0, 14).replace(/-+$/, '');
    if (!head) head = 'co';
    const taken = new Set((await DB.list('companies')).map(x => x.share_slug).filter(Boolean));
    let slug;
    do { slug = head + '-' + randTail(6); } while (taken.has(slug));
    return slug;
  }

  async function ensureShareKeys(c) {
    const patch = {};
    if (!c.share_slug) patch.share_slug = await makeSlug(c.name);
    if (!c.share_key) patch.share_key = randKey();
    if (Object.keys(patch).length) {
      await DB.update('companies', c.id, patch);
      Object.assign(c, patch);
    }
    return c;
  }

  function isExpired(c) {
    if (!c.share_expires_at) return false;
    return c.share_expires_at < todayKey();
  }
  function todayKey() {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  }

  // ---- 카톡 문구(단톡방 개설 시 1회) ----
  function kakaoText(c) {
    const url = clientUrl(c);
    return [
      `안녕하세요 대표님, ${COMPANY_NAME}입니다.`,
      '',
      '프로젝트 진행현황과 요청드릴 자료를 한 눈에 보실 수 있는 페이지입니다.',
      '내용이 바뀌면 자동으로 반영되니, 편하실 때 확인 부탁드립니다.',
      '',
      '▶ 프로젝트 현황 페이지',
      url || '(아직 공유 링크가 없습니다)',
      '',
      '※ 대표님 전용 링크입니다. 휴대폰에서도 바로 열립니다.'
    ].join('\n');
  }

  async function copy(text) {
    if (!text) return false;
    try {
      if (window.mm && window.mm.writeClipboard) { await window.mm.writeClipboard(text); return true; }
      if (navigator.clipboard && navigator.clipboard.writeText) { await navigator.clipboard.writeText(text); return true; }
    } catch {}
    try {
      const ta = document.createElement('textarea');
      ta.value = text; ta.style.position = 'fixed'; ta.style.opacity = '0';
      document.body.appendChild(ta); ta.select();
      const ok = document.execCommand('copy'); ta.remove(); return ok;
    } catch { return false; }
  }

  // ============================================================
  //  필요서류 묶음 → 요청사항 자동 생성
  // ============================================================
  // 같은 업체에 같은 이름의 요청이 이미 있으면 건너뛴다(여러 묶음에 겹치는 서류 대비).
  async function applyRequestSets(companyId, setIds, serviceId) {
    const ids = (setIds || []).filter(Boolean);
    if (!ids.length) return 0;
    const existing = await DB.list('requests', { company_id: companyId });
    const have = new Set(existing.map(r => String(r.title || '').trim()));
    let order = existing.length;
    let added = 0;
    for (const setId of ids) {
      const docs = await DB.list('request_templates', { set_id: setId });
      for (const d of docs) {
        const title = String(d.name || '').trim();
        if (!title || have.has(title)) continue;
        have.add(title);
        order++; added++;
        await DB.insert('requests', {
          company_id: companyId, service_id: serviceId || null,
          title, done: false, due_date: null, memo: d.memo || '',
          client_visible: true, sort_order: order
        });
      }
    }
    return added;
  }

  // 인허가 유형(업체 정보) → 같은 이름의 인허가 묶음을 적용
  async function applyLicenseSets(companyId, licenseType) {
    const name = String(licenseType || '').trim();
    if (!name) return 0;
    const sets = (await DB.list('request_sets')).filter(s => (s.kind || '공통') === '인허가' && s.name === name);
    return applyRequestSets(companyId, sets.map(s => s.id));
  }

  // ============================================================
  //  섹션 HTML
  // ============================================================
  async function sectionsHTML(c) {
    const [requests, deliveries, cats] = await Promise.all([
      DB.list('requests', { company_id: c.id }),
      DB.list('deliveries', { company_id: c.id }),
      DB.list('delivery_categories')
    ]);
    const catName = {}; cats.forEach(x => { catName[x.id] = x.name; });

    return shareCard(c) + requestsSection(c, requests) + deliveriesSection(c, deliveries, catName);
  }

  function shareCard(c) {
    const on = !!c.share_enabled;
    const url = clientUrl(c);
    const expired = isExpired(c);
    const state = !on ? { cls: 'off', label: '공유 꺼짐' }
      : expired ? { cls: 'exp', label: '만료됨' }
      : !url ? { cls: 'wait', label: '주소 대기' }
      : { cls: 'on', label: '공유 중' };

    return `
      <div class="cs-card card only-edit">
        <div class="cs-top">
          <h3>🔗 클라이언트 공유</h3>
          <span class="cs-state ${state.cls}">${state.label}</span>
          <button class="btn sm ghost" id="cs-settings">⚙ 설정</button>
        </div>
        ${on ? `
          <div class="cs-linkrow">
            <input type="text" id="cs-url" readonly value="${esc(url)}" placeholder="공유-업데이트.bat 을 한 번 실행하면 주소가 만들어집니다">
            <button class="btn sm ghost" data-cs-copy="url">링크 복사</button>
            <button class="btn sm primary" data-cs-copy="kakao">📋 카톡 문구</button>
          </div>
          ${expired ? `<div class="cs-warn">만료일(${esc(c.share_expires_at)})이 지나 다음 배포부터 이 링크는 열리지 않습니다.</div>` : ''}
          ${url ? '' : `<div class="cs-warn">아직 공유 주소가 없습니다. 프로젝트 폴더의 <code>공유-업데이트.bat</code> 을 한 번 실행해 주세요.</div>`}
          <div class="cs-note">금액은 대시보드에 <b>포함되지 않습니다.</b> 링크를 아는 사람은 누구나 볼 수 있으니 단톡방·메일로만 전달하세요.</div>
        ` : `<div class="cs-note">이 업체에 진행현황 페이지를 만들어 공유하려면 <b>⚙ 설정</b>에서 공유를 켜세요.</div>`}
      </div>`;
  }

  function requestsSection(c, rows) {
    const sorted = [...rows].sort((a, b) => (a.done === b.done ? (a.sort_order || 0) - (b.sort_order || 0) : (a.done ? 1 : -1)));
    const done = rows.filter(r => r.done).length;
    const pct = rows.length ? Math.round(done / rows.length * 100) : 0;
    return `
      <div class="d-section-head">
        <div>
          <h3>✅ 요청사항</h3>
          <span class="muted">${rows.length ? `${done}/${rows.length} 완료 · ${pct}%` : '고객에게 요청할 자료·서류 목록'}</span>
        </div>
        <div class="head-actions only-edit">
          <button class="btn ghost" id="req-import">📋 묶음에서 가져오기</button>
          <button class="btn primary" id="req-add">+ 요청 추가</button>
        </div>
      </div>
      <div class="req-list" data-req-list>
        ${sorted.length ? sorted.map(r => reqRow(r)).join('')
          : `<div class="empty sm"><p>요청사항이 없습니다. <b>묶음에서 가져오기</b>로 필요 서류를 한 번에 넣을 수 있습니다.</p></div>`}
      </div>`;
  }

  function reqRow(r) {
    return `
      <div class="req-row card ${r.done ? 'done' : ''}" data-id="${r.id}">
        <span class="drag-handle only-edit" title="끌어서 순서 변경">⠿</span>
        <label class="req-chk"><input type="checkbox" data-req-done ${r.done ? 'checked' : ''}></label>
        <div class="req-main">
          <div class="req-title">${esc(r.title)}</div>
          ${r.memo ? `<div class="req-memo">${esc(r.memo)}</div>` : ''}
        </div>
        ${r.due_date ? `<span class="req-due">~${esc(UI.fmtDate(r.due_date))}</span>` : ''}
        <span class="req-tools only-edit">
          <button class="icon-btn xs" data-req-eye title="${r.client_visible === false ? '클라이언트에게 숨김' : '클라이언트에게 보임'}">${r.client_visible === false ? '🙈' : '👁'}</button>
          <button class="icon-btn xs" data-req-edit>✎</button>
          <button class="icon-btn xs" data-req-del>✕</button>
        </span>
      </div>`;
  }

  function deliveriesSection(c, rows, catName) {
    const sorted = [...rows].sort((a, b) => String(b.date || '').localeCompare(String(a.date || '')));
    return `
      <div class="d-section-head">
        <div>
          <h3>📦 작업물 전달 기록</h3>
          <span class="muted">${rows.length ? `${rows.length}건` : '작업물을 어떤 방법으로 주고받았는지 남겨둡니다'}</span>
        </div>
        <button class="btn primary only-edit" id="dlv-add">+ 기록 추가</button>
      </div>
      <div class="dlv-list">
        ${sorted.length ? sorted.map(d => dlvRow(d, catName)).join('')
          : `<div class="empty sm"><p>전달 기록이 없습니다. 파일명과 전달 방법(카톡·드라이브 등)을 남기면 클라이언트도 같은 목록을 봅니다.</p></div>`}
      </div>`;
  }

  function dlvRow(d, catName) {
    const dir = d.direction === '수령' ? 'in' : 'out';
    return `
      <div class="dlv-row card" data-id="${d.id}">
        <span class="dlv-dir ${dir}">${d.direction === '수령' ? '수령' : '전달'}</span>
        <div class="dlv-main">
          <div class="dlv-name">${esc(d.name)}${d.url ? ` <a class="dlv-link" href="${esc(d.url)}" target="_blank" rel="noopener" title="${esc(d.url)}">↗</a>` : ''}</div>
          ${d.memo ? `<div class="dlv-memo">${esc(d.memo)}</div>` : ''}
        </div>
        ${catName[d.category_id] ? `<span class="dlv-chip">${esc(catName[d.category_id])}</span>` : ''}
        <span class="dlv-chip ch">${esc(d.channel || '기타')}</span>
        <span class="dlv-date">${d.date ? esc(UI.fmtDate(d.date)) : '-'}</span>
        <span class="dlv-tools only-edit">
          <button class="icon-btn xs" data-dlv-eye title="${d.client_visible === false ? '클라이언트에게 숨김' : '클라이언트에게 보임'}">${d.client_visible === false ? '🙈' : '👁'}</button>
          <button class="icon-btn xs" data-dlv-edit>✎</button>
          <button class="icon-btn xs" data-dlv-del>✕</button>
        </span>
      </div>`;
  }

  // ============================================================
  //  이벤트
  // ============================================================
  function bind(root, c, rerender) {
    // ---- 공유 ----
    root.querySelector('#cs-settings')?.addEventListener('click', () => shareSettings(c, rerender));
    root.querySelectorAll('[data-cs-copy]').forEach(b => b.addEventListener('click', async () => {
      const kind = b.dataset.csCopy;
      const url = clientUrl(c);
      if (!url) { toast('먼저 공유-업데이트.bat 을 실행해 주소를 만들어 주세요'); return; }
      const ok = await copy(kind === 'url' ? url : kakaoText(c));
      toast(ok ? '복사했습니다' : '복사 실패 — 직접 선택해 복사하세요');
    }));

    // ---- 요청사항 ----
    root.querySelector('#req-add')?.addEventListener('click', () => editRequest(c, rerender));
    root.querySelector('#req-import')?.addEventListener('click', () => importSets(c, rerender));

    const reqList = root.querySelector('[data-req-list]');
    if (reqList) DragSort.enable(reqList, {
      itemSelector: '.req-row', handleSelector: '.drag-handle',
      onReorder: async (ids) => {
        for (let i = 0; i < ids.length; i++) await DB.update('requests', ids[i], { sort_order: i + 1 });
        rerender();
      }
    });

    root.querySelectorAll('.req-row').forEach(rowEl => {
      const id = rowEl.dataset.id;
      rowEl.querySelector('[data-req-done]')?.addEventListener('change', async (e) => {
        if (DB.READONLY) return;
        await DB.update('requests', id, { done: e.target.checked });
        rerender();
      });
      rowEl.querySelector('[data-req-eye]')?.addEventListener('click', async () => {
        const r = (await DB.list('requests', { id }))[0];
        await DB.update('requests', id, { client_visible: r.client_visible === false });
        rerender();
      });
      rowEl.querySelector('[data-req-edit]')?.addEventListener('click', async () => {
        editRequest(c, rerender, (await DB.list('requests', { id }))[0]);
      });
      rowEl.querySelector('[data-req-del]')?.addEventListener('click', async () => {
        await DB.remove('requests', id); toast('삭제했습니다'); rerender();
      });
    });

    // ---- 작업물 ----
    root.querySelector('#dlv-add')?.addEventListener('click', () => editDelivery(c, rerender));
    root.querySelectorAll('.dlv-row').forEach(rowEl => {
      const id = rowEl.dataset.id;
      rowEl.querySelector('[data-dlv-eye]')?.addEventListener('click', async () => {
        const d = (await DB.list('deliveries', { id }))[0];
        await DB.update('deliveries', id, { client_visible: d.client_visible === false });
        rerender();
      });
      rowEl.querySelector('[data-dlv-edit]')?.addEventListener('click', async () => {
        editDelivery(c, rerender, (await DB.list('deliveries', { id }))[0]);
      });
      rowEl.querySelector('[data-dlv-del]')?.addEventListener('click', async () => {
        await DB.remove('deliveries', id); toast('삭제했습니다'); rerender();
      });
    });
  }

  // ---------- 공유 설정 모달 ----------
  function shareSettings(c, rerender) {
    modal({
      title: '🔗 클라이언트 공유 설정',
      wide: true,
      bodyHTML: `
        <label class="chk cs-bigchk"><input type="checkbox" id="cs-on" ${c.share_enabled ? 'checked' : ''}>
          <span>이 업체에 진행현황 페이지를 공유합니다</span></label>
        <div class="field"><label>공유 만료일 <span class="muted">(비워두면 만료 없음 · 지나면 다음 배포부터 링크가 열리지 않습니다)</span></label>
          <input class="input" id="cs-exp" type="date" value="${esc(c.share_expires_at || '')}"></div>
        <div class="field"><label>대시보드 메모 <span class="muted">(클라이언트에게 보이는 안내문)</span></label>
          <textarea class="input" id="cs-note" placeholder="예: 6월 2주차 와디즈 오픈 목표로 진행 중입니다.">${esc(c.client_note || '')}</textarea></div>
        ${c.share_key ? `
          <div class="field"><label>열쇠 재발급</label>
            <button class="btn ghost" type="button" id="cs-rekey">🔄 새 열쇠 발급 (기존 링크 무효화)</button>
            <span class="help-text">클라이언트에게 보낸 링크를 더 이상 못 쓰게 만들고 새 링크를 발급합니다.</span></div>` : ''}
        <div class="cs-note" style="margin-top:4px">저장 후 <code>공유-업데이트.bat</code> 을 실행해야 실제 페이지에 반영됩니다.</div>`,
      onOpen: (m) => {
        m.querySelector('#cs-rekey')?.addEventListener('click', () => {
          confirm('새 열쇠를 발급할까요? 이미 전달한 링크는 다음 배포부터 열리지 않습니다.', async () => {
            await DB.update('companies', c.id, { share_key: randKey() });
            c.share_key = (await DB.list('companies', { id: c.id }))[0].share_key;
            toast('새 열쇠를 발급했습니다 — 새 링크를 다시 보내주세요');
          }, true);
        });
      },
      onSave: async (m) => {
        const on = m.querySelector('#cs-on').checked;
        const patch = {
          share_enabled: on,
          share_expires_at: m.querySelector('#cs-exp').value || null,
          client_note: m.querySelector('#cs-note').value.trim()
        };
        await DB.update('companies', c.id, patch);
        Object.assign(c, patch);
        if (on) await ensureShareKeys(c);
        toast('저장했습니다');
        rerender();
      }
    });
  }

  // ---------- 요청사항 모달 ----------
  function editRequest(c, rerender, r) {
    const isNew = !r;
    modal({
      title: isNew ? '요청사항 추가' : '요청사항 수정',
      bodyHTML: `
        <div class="field"><label>요청 내용 *</label>
          <input class="input" id="rq-title" placeholder="예: 사업자등록증" value="${r ? esc(r.title) : ''}"></div>
        <div class="field"><label>안내 문구 <span class="muted">(클라이언트에게 함께 보입니다)</span></label>
          <input class="input" id="rq-memo" placeholder="예: 사본 가능, 최근 3개월 이내" value="${r ? esc(r.memo || '') : ''}"></div>
        <div class="field"><label>기한 <span class="muted">(선택)</span></label>
          <input class="input" id="rq-due" type="date" value="${r ? (r.due_date || '') : ''}"></div>`,
      saveLabel: isNew ? '추가' : '저장',
      onSave: async (m) => {
        const title = m.querySelector('#rq-title').value.trim();
        if (!title) { toast('요청 내용을 입력하세요'); return false; }
        const payload = {
          title, memo: m.querySelector('#rq-memo').value.trim(),
          due_date: m.querySelector('#rq-due').value || null
        };
        if (isNew) {
          const cnt = (await DB.list('requests', { company_id: c.id })).length;
          await DB.insert('requests', { company_id: c.id, service_id: null, done: false, client_visible: true, ...payload, sort_order: cnt + 1 });
        } else {
          await DB.update('requests', r.id, payload);
        }
        toast('저장했습니다'); rerender();
      }
    });
  }

  async function importSets(c, rerender) {
    const sets = await DB.list('request_sets');
    if (!sets.length) { toast('먼저 [항목 설정 → 필요서류 묶음]에서 묶음을 만들어 주세요'); return; }
    const docs = await DB.list('request_templates');
    const cnt = {}; docs.forEach(d => { cnt[d.set_id] = (cnt[d.set_id] || 0) + 1; });
    modal({
      title: '필요서류 묶음에서 가져오기',
      wide: true,
      bodyHTML: `
        <p class="muted" style="margin-bottom:12px">선택한 묶음의 서류가 요청사항으로 들어갑니다. 이미 같은 이름이 있으면 건너뜁니다.</p>
        <div class="chk-grid">
          ${sets.map(s => `
            <label class="chk"><input type="checkbox" data-set="${s.id}">
            <span>${esc(s.name)}<em>${esc(s.kind || '공통')} · ${cnt[s.id] || 0}건</em></span></label>`).join('')}
        </div>`,
      saveLabel: '가져오기',
      onSave: async (m) => {
        const ids = [...m.querySelectorAll('[data-set]:checked')].map(x => x.dataset.set);
        if (!ids.length) { toast('가져올 묶음을 선택하세요'); return false; }
        const added = await applyRequestSets(c.id, ids);
        toast(added ? `${added}건을 가져왔습니다` : '새로 추가할 항목이 없습니다(모두 이미 있음)');
        rerender();
      }
    });
  }

  // ---------- 작업물 기록 모달 ----------
  async function editDelivery(c, rerender, d) {
    const isNew = !d;
    const cats = await DB.list('delivery_categories');
    const services = await DB.list('services', { company_id: c.id });
    modal({
      title: isNew ? '작업물 전달 기록 추가' : '전달 기록 수정',
      wide: true,
      bodyHTML: `
        <div class="field"><label>작업물 / 파일명 *</label>
          <input class="input" id="dl-name" placeholder="예: 모해나키친_패키지_최종_인쇄용.ai" value="${d ? esc(d.name) : ''}"></div>
        <div class="grid-2">
          <div class="field"><label>방향</label>
            <select class="select" id="dl-dir">${DIRECTIONS.map(x => `<option ${d && d.direction === x ? 'selected' : ''}>${x}</option>`).join('')}</select></div>
          <div class="field"><label>전달 수단</label>
            <select class="select" id="dl-ch">${CHANNELS.map(x => `<option ${d && d.channel === x ? 'selected' : ''}>${x}</option>`).join('')}</select></div>
          <div class="field"><label>카테고리</label>
            <select class="select" id="dl-cat">
              <option value="">(없음)</option>
              ${cats.map(x => `<option value="${x.id}" ${d && String(d.category_id) === String(x.id) ? 'selected' : ''}>${esc(x.name)}</option>`).join('')}
            </select></div>
          <div class="field"><label>날짜</label>
            <input class="input" id="dl-date" type="date" value="${d ? (d.date || '') : todayKey()}"></div>
        </div>
        <div class="field"><label>링크 <span class="muted">(드라이브·드롭박스 주소 — 넣으면 클릭해서 바로 열립니다)</span></label>
          <input class="input" id="dl-url" placeholder="https://drive.google.com/..." value="${d ? esc(d.url || '') : ''}"></div>
        <div class="field"><label>관련 서비스 항목 <span class="muted">(선택)</span></label>
          <select class="select" id="dl-svc">
            <option value="">(지정 안 함)</option>
            ${services.map(s => `<option value="${s.id}" ${d && String(d.service_id) === String(s.id) ? 'selected' : ''}>${esc(s.name)}</option>`).join('')}
          </select></div>
        <div class="field"><label>메모</label>
          <input class="input" id="dl-memo" placeholder="예: 인쇄소 직접 전달, 원본 2.4GB" value="${d ? esc(d.memo || '') : ''}"></div>`,
      saveLabel: isNew ? '추가' : '저장',
      onSave: async (m) => {
        const name = m.querySelector('#dl-name').value.trim();
        if (!name) { toast('작업물 이름을 입력하세요'); return false; }
        let url = m.querySelector('#dl-url').value.trim();
        if (url && !/^https?:\/\//i.test(url)) url = 'https://' + url;
        const payload = {
          name, url,
          direction: m.querySelector('#dl-dir').value,
          channel: m.querySelector('#dl-ch').value,
          category_id: m.querySelector('#dl-cat').value || null,
          service_id: m.querySelector('#dl-svc').value || null,
          date: m.querySelector('#dl-date').value || null,
          memo: m.querySelector('#dl-memo').value.trim()
        };
        if (isNew) {
          const cnt = (await DB.list('deliveries', { company_id: c.id })).length;
          await DB.insert('deliveries', { company_id: c.id, client_visible: true, ...payload, sort_order: cnt + 1 });
        } else {
          await DB.update('deliveries', d.id, payload);
        }
        toast('저장했습니다'); rerender();
      }
    });
  }

  return {
    sectionsHTML, bind,
    clientUrl, kakaoText, ensureShareKeys, isExpired,
    applyRequestSets, applyLicenseSets,
    CHANNELS, DIRECTIONS
  };
})();
