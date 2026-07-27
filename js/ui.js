// ============================================================
//  ui.js — 공통 UI 헬퍼(모달 · 토스트 · 상태배지 · 포맷)
// ============================================================
window.UI = (function () {
  const STATUSES = ['예정', '진행중', '일시정지', '종료', '지연'];
  const STATUS_CLASS = { '예정': 'plan', '진행중': 'run', '일시정지': 'pause', '종료': 'done', '지연': 'late' };
  const MANUAL_SERVICE_ORDER_BASE = 1000;
  const SERVICE_ORDER = [
    '계약',
    '진단컨설팅',
    '온라인마케팅교육',
    '브랜딩',
    '패키지',
    '촬영',
    '와디즈상세페이지',
    '와디즈올인원',
    '스마트스토어 상세페이지',
    '스마트스토어 구축',
    '체험단',
    '인스타그램 운영'
  ];
  const SERVICE_ALIASES = {
    '온라인마케팅 교육': '온라인마케팅교육',
    '와디즈': '와디즈상세페이지',
    '와디즈 상세페이지': '와디즈상세페이지',
    '스마트스토어상세페이지': '스마트스토어 상세페이지',
    '스마트스토어': '스마트스토어 구축',
    '스토어': '스마트스토어 구축',
    '인스타그램운영': '인스타그램 운영'
  };
  const COMPANY_TONES = [
    { bg: '#ffd6ac', line: '#f2892a', dot: '#ef6c00' }, // 주황
    { bg: '#bcd8ff', line: '#4f97e6', dot: '#1565d8' }, // 파랑
    { bg: '#aee5be', line: '#3fb268', dot: '#0f8a42' }, // 초록
    { bg: '#ffbdd2', line: '#ec6f97', dot: '#d81b60' }, // 분홍
    { bg: '#d2beff', line: '#9575e6', dot: '#6a3fd4' }, // 보라
    { bg: '#a9e5e0', line: '#3fbcb5', dot: '#0b8a83' }, // 청록
    { bg: '#f3d97f', line: '#cfa81f', dot: '#a67c07' }, // 골드
    { bg: '#c0c7f5', line: '#7784e3', dot: '#3949c4' }  // 남색
  ];

  // 업체별 수동 색상 저장소: id -> tone{bg,line,dot}. 없으면 id 해시로 자동배정.
  const companyColorOverrides = {};
  function clampHex(h) {
    const m = /^#?([0-9a-fA-F]{6})$/.exec(String(h || '').trim());
    return m ? '#' + m[1].toLowerCase() : null;
  }
  function mixWhite(hex, ratio) {
    const n = parseInt(hex.slice(1), 16);
    const r = (n >> 16) & 255, g = (n >> 8) & 255, b = n & 255;
    const mr = Math.round(r + (255 - r) * ratio);
    const mg = Math.round(g + (255 - g) * ratio);
    const mb = Math.round(b + (255 - b) * ratio);
    return '#' + ((1 << 24) + (mr << 16) + (mg << 8) + mb).toString(16).slice(1);
  }
  function hexToTone(hex) {
    const dot = clampHex(hex);
    return dot ? { dot, line: mixWhite(dot, 0.42), bg: mixWhite(dot, 0.80) } : null;
  }
  // 업체 레코드의 color 필드로 수동색 등록. color: 0~7(프리셋) | '#rrggbb'(직접) | null/''(자동)
  function setCompanyColors(list) {
    (list || []).forEach(c => {
      if (!c || c.id == null) return;
      const key = String(c.id), v = c.color;
      if (v == null || v === '') { delete companyColorOverrides[key]; return; }
      if (typeof v === 'string' && v[0] === '#') {
        const t = hexToTone(v);
        if (t) companyColorOverrides[key] = t; else delete companyColorOverrides[key];
        return;
      }
      const idx = Number(v);
      if (Number.isInteger(idx) && COMPANY_TONES[idx]) companyColorOverrides[key] = COMPANY_TONES[idx];
      else delete companyColorOverrides[key];
    });
  }

  function statusClass(s) { return STATUS_CLASS[s] || 'plan'; }
  function badge(status) {
    return `<span class="badge ${statusClass(status)}">${esc(status || '예정')}</span>`;
  }
  function companyTone(id) {
    const key = String(id || '');
    if (companyColorOverrides[key]) return companyColorOverrides[key];
    let n = 0;
    for (let i = 0; i < key.length; i++) n = ((n << 5) - n + key.charCodeAt(i)) | 0;
    return COMPANY_TONES[Math.abs(n) % COMPANY_TONES.length];
  }
  function companyStyle(id) {
    const tone = companyTone(id);
    return `--sp-co-bg:${tone.bg};--sp-co-line:${tone.line};--sp-co-dot:${tone.dot};`;
  }
  function companyDotStyle(id) {
    const tone = companyTone(id);
    return `--co-dot:${tone.dot};--co-dot-soft:${tone.bg};--co-dot-line:${tone.line};`;
  }

  function serviceKey(name) {
    return String(name == null ? '' : name).replace(/[\s\-_/·.()]/g, '').toLowerCase();
  }

  const SERVICE_ORDER_MAP = SERVICE_ORDER.reduce((map, name, index) => {
    map[serviceKey(name)] = index;
    return map;
  }, {});
  Object.keys(SERVICE_ALIASES).forEach(alias => {
    SERVICE_ORDER_MAP[serviceKey(alias)] = SERVICE_ORDER_MAP[serviceKey(SERVICE_ALIASES[alias])];
  });

  function defaultServiceOrder(name) {
    const order = SERVICE_ORDER_MAP[serviceKey(name)];
    return Number.isFinite(order) ? order : Number.MAX_SAFE_INTEGER;
  }

  function hasManualServiceOrder(templates) {
    return (templates || []).some(t => Number(t.sort_order) >= MANUAL_SERVICE_ORDER_BASE);
  }

  function sortServiceTemplates(templates) {
    const list = [...(templates || [])];
    const manual = hasManualServiceOrder(list);
    return list.sort((a, b) => {
      const av = Number(a.sort_order) || Number.MAX_SAFE_INTEGER;
      const bv = Number(b.sort_order) || Number.MAX_SAFE_INTEGER;
      if (manual) {
        const am = av >= MANUAL_SERVICE_ORDER_BASE ? av : Number.MAX_SAFE_INTEGER;
        const bm = bv >= MANUAL_SERVICE_ORDER_BASE ? bv : Number.MAX_SAFE_INTEGER;
        if (am !== bm) return am - bm;
        const ad = defaultServiceOrder(a.name);
        const bd = defaultServiceOrder(b.name);
        if (ad !== bd) return ad - bd;
        if (av !== bv) return av - bv;
        return String(a.name || '').localeCompare(String(b.name || ''), 'ko-KR');
      }
      const ad = defaultServiceOrder(a.name);
      const bd = defaultServiceOrder(b.name);
      if (ad !== bd) return ad - bd;
      if (av !== bv) return av - bv;
      return String(a.name || '').localeCompare(String(b.name || ''), 'ko-KR');
    });
  }

  function serviceSorter(templates) {
    const ordered = sortServiceTemplates(templates);
    const byTemplateId = {};
    const byName = {};
    ordered.forEach((t, index) => {
      byTemplateId[String(t.id)] = index;
      byName[serviceKey(t.name)] = index;
    });
    function rank(service) {
      const tid = String(service.template_id || '');
      if (tid && byTemplateId[tid] != null) return byTemplateId[tid];
      const key = serviceKey(service.name);
      if (byName[key] != null) return byName[key];
      const order = defaultServiceOrder(service.name);
      if (order !== Number.MAX_SAFE_INTEGER) return order;
      return Number.MAX_SAFE_INTEGER;
    }
    return (a, b) => {
      const ar = rank(a);
      const br = rank(b);
      if (ar !== br) return ar - br;
      const av = Number(a.sort_order) || Number.MAX_SAFE_INTEGER;
      const bv = Number(b.sort_order) || Number.MAX_SAFE_INTEGER;
      if (av !== bv) return av - bv;
      return String(a.name || '').localeCompare(String(b.name || ''), 'ko-KR');
    };
  }

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, c =>
      ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }

  function money(n) {
    n = Number(n) || 0;
    return n.toLocaleString('ko-KR') + '원';
  }
  function vatParts(gross) {
    gross = Number(gross) || 0;
    const supply = Math.round(gross / 1.1);
    const vat = gross - supply;
    return { supply, vat, gross };
  }
  function moneyVatText(gross) {
    const p = vatParts(gross);
    return `공급가 ${money(p.supply)} · VAT ${money(p.vat)} · 포함 ${money(p.gross)}`;
  }
  function moneyVatHTML(gross, mainLabel) {
    const p = vatParts(gross);
    const label = mainLabel || 'VAT포함';
    return `<span class="money-main">${esc(label)} ${money(p.gross)}</span><span class="money-sub">공급가 ${money(p.supply)} · VAT ${money(p.vat)}</span>`;
  }
  function moneyShort(n) {
    n = Number(n) || 0;
    if (n >= 100000000) return (n / 100000000).toFixed(n % 100000000 ? 1 : 0) + '억';
    if (n >= 10000) return Math.round(n / 10000).toLocaleString('ko-KR') + '만';
    return n.toLocaleString('ko-KR');
  }

  function fmtDate(d) {
    if (!d) return '';
    const s = String(d).slice(0, 10);
    const parts = s.split('-');
    if (parts.length === 3) return `${parts[1]}.${parts[2]}`;
    return s;
  }

  // 상태 옵션 <option> 문자열
  function statusOptions(sel) {
    return STATUSES.map(s => `<option value="${s}" ${s === sel ? 'selected' : ''}>${s}</option>`).join('');
  }

  // ---------- 토스트 ----------
  function toast(msg) {
    const root = document.getElementById('toast-root');
    const t = document.createElement('div');
    t.className = 'toast';
    t.textContent = msg;
    root.appendChild(t);
    setTimeout(() => { t.style.opacity = '0'; t.style.transition = 'opacity .3s'; }, 1800);
    setTimeout(() => t.remove(), 2200);
  }

  // ---------- 모달 ----------
  // opts: { title, bodyHTML, saveLabel, wide, onOpen(modalEl), onSave(modalEl) -> return false to keep open }
  function modal(opts) {
    const root = document.getElementById('modal-root');
    const back = document.createElement('div');
    back.className = 'modal-backdrop';
    back.innerHTML = `
      <div class="modal ${opts.wide ? 'wide' : ''}">
        <div class="modal-head">
          <h3>${esc(opts.title || '')}</h3>
          <button class="icon-btn" data-close>✕</button>
        </div>
        <div class="modal-body">${opts.bodyHTML || ''}</div>
        <div class="modal-foot">
          <button class="btn ghost" data-close>취소</button>
          <button class="btn primary" data-save>${esc(opts.saveLabel || '저장')}</button>
        </div>
      </div>`;
    root.appendChild(back);
    const modalEl = back.querySelector('.modal');
    function close() { back.remove(); }
    back.addEventListener('click', (e) => { if (e.target === back) close(); });
    back.querySelectorAll('[data-close]').forEach(b => b.addEventListener('click', close));
    back.querySelector('[data-save]').addEventListener('click', async () => {
      if (opts.onSave) { const r = await opts.onSave(modalEl); if (r === false) return; }
      close();
    });
    if (opts.onOpen) opts.onOpen(modalEl);
    const first = modalEl.querySelector('input, select, textarea');
    if (first) setTimeout(() => first.focus(), 30);
    return { close, el: modalEl };
  }

  function confirmModal(msg, onYes, danger) {
    modal({
      title: '확인',
      bodyHTML: `<p style="font-size:14.5px;line-height:1.6">${esc(msg)}</p>`,
      saveLabel: danger ? '삭제' : '확인',
      onSave: () => { onYes && onYes(); }
    });
  }

  // ---------- 상태 선택 팝오버 ----------
  function statusPicker(anchorEl, current, onPick) {
    document.querySelectorAll('.status-pop').forEach(p => p.remove());
    const pop = document.createElement('div');
    pop.className = 'status-pop';
    pop.innerHTML = STATUSES.map(s =>
      `<button class="sp-item ${s === current ? 'on' : ''}" data-s="${s}"><span class="badge ${statusClass(s)}">${s}</span></button>`
    ).join('');
    document.body.appendChild(pop);
    const r = (anchorEl && anchorEl.getBoundingClientRect)
      ? anchorEl.getBoundingClientRect()
      : { top: 100, bottom: 100, left: window.innerWidth / 2 - 70, right: window.innerWidth / 2 + 70 };
    // 창(뷰포트) 밖으로 잘리지 않도록: 실제 크기를 재서 아래→위 뒤집기 + 좌우/상하 보정
    const gap = 6, margin = 8;
    const vw = window.innerWidth, vh = window.innerHeight;
    const pr = pop.getBoundingClientRect();
    // 좌우: 앵커 왼쪽 기준, 오른쪽이 넘치면 왼쪽으로 당김
    let left = r.left;
    if (left + pr.width + margin > vw) left = vw - pr.width - margin;
    left = Math.max(margin, left);
    // 상하: 아래 공간이 충분하면 아래, 아니면 위로 뒤집기, 둘 다 부족하면 화면 안으로 클램프
    const spaceBelow = vh - r.bottom, spaceAbove = r.top;
    let top;
    if (spaceBelow >= pr.height + gap + margin) top = r.bottom + gap;
    else if (spaceAbove >= pr.height + gap + margin) top = r.top - pr.height - gap;
    else top = Math.max(margin, vh - pr.height - margin);
    pop.style.top = top + 'px';
    pop.style.left = left + 'px';
    const close = () => { pop.remove(); document.removeEventListener('click', onDoc, true); };
    function onDoc(e) { if (!pop.contains(e.target)) close(); }
    setTimeout(() => document.addEventListener('click', onDoc, true), 0);
    pop.querySelectorAll('.sp-item').forEach(b =>
      b.addEventListener('click', (e) => { e.stopPropagation(); close(); onPick(b.dataset.s); }));
  }

  return {
    STATUSES, STATUS_CLASS, SERVICE_ORDER, MANUAL_SERVICE_ORDER_BASE,
    statusClass, badge, companyTone, companyStyle, companyDotStyle, setCompanyColors, companyTones: COMPANY_TONES,
    esc, money, moneyShort, fmtDate, statusOptions, toast, modal, confirm: confirmModal, statusPicker,
    vatParts, moneyVatText, moneyVatHTML,
    serviceKey, defaultServiceOrder, hasManualServiceOrder, sortServiceTemplates, serviceSorter
  };
})();
