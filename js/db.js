// ============================================================
//  db.js — 데이터 계층
//  Supabase가 설정돼 있으면 클라우드, 아니면 로컬(localStorage)로 자동 동작.
//  두 경우 모두 동일한 인터페이스: DB.list / DB.insert / DB.update / DB.remove
// ============================================================
(function () {
  const cfg = window.MM_CONFIG || {};
  const READONLY = !!cfg.readonly;
  const SHARE = !!cfg.share;   // 대표님 공유(암호화 스냅샷) 모드
  const useCloud =
    cfg.url && cfg.anonKey &&
    cfg.url !== 'YOUR_SUPABASE_URL' &&
    cfg.anonKey !== 'YOUR_SUPABASE_ANON_KEY' &&
    !!(window.supabase && window.supabase.createClient);

  const TABLES = [
    'service_templates', 'process_templates',
    'companies', 'services', 'processes',
    'routines', 'task_checks'
  ];

  // ---------- 로컬 어댑터 (Electron=파일 / 웹=localStorage) ----------
  const Local = (function () {
    const KEY = 'mm-tool-db-v1';
    let data = null;
    let loadPromise = null;

    async function doLoad() {
      // Electron: userData의 JSON 파일에서 로드(재시작해도 유지)
      if (window.mm && window.mm.dataLoad) {
        try {
          const raw = await window.mm.dataLoad();
          if (raw) { data = JSON.parse(raw); return; }
        } catch {}
        data = seed(); await persist(); return;
      }
      // 웹: localStorage
      try {
        const raw = localStorage.getItem(KEY);
        if (raw) { data = JSON.parse(raw); return; }
      } catch {}
      data = seed(); await persist();
    }
    function ensure() { if (!loadPromise) loadPromise = doLoad(); return loadPromise; }

    async function persist() {
      const json = JSON.stringify(data);
      try { localStorage.setItem(KEY, json); } catch {}
      if (window.mm && window.mm.dataSave) { try { await window.mm.dataSave(json); } catch (e) { console.error(e); } }
    }

    function uid() { return 'id_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7); }
    function matches(row, filter) {
      if (!filter) return true;
      return Object.keys(filter).every(k => String(row[k]) === String(filter[k]));
    }

    return {
      init: ensure,
      reload() { loadPromise = null; data = null; return ensure(); },
      async list(table, filter) {
        await ensure();
        const rows = (data[table] || []).filter(r => matches(r, filter));
        rows.sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0));
        return rows.map(r => ({ ...r }));
      },
      async insert(table, row) {
        await ensure();
        const rec = { id: uid(), created_at: new Date().toISOString(), ...row };
        data[table] = data[table] || [];
        data[table].push(rec);
        await persist();
        return { ...rec };
      },
      async update(table, id, patch) {
        await ensure();
        const arr = data[table] || [];
        const i = arr.findIndex(r => String(r.id) === String(id));
        if (i >= 0) { arr[i] = { ...arr[i], ...patch }; await persist(); return { ...arr[i] }; }
        return null;
      },
      async remove(table, id) {
        await ensure();
        data[table] = (data[table] || []).filter(r => String(r.id) !== String(id));
        await persist();
        return true;
      },
      async _reset() { await ensure(); data = seed(); await persist(); }
    };
  })();

  // ---------- Supabase 어댑터 ----------
  const Cloud = (function () {
    if (!useCloud) return null;
    const client = window.supabase.createClient(cfg.url, cfg.anonKey);
    return {
      client,
      async list(table, filter) {
        let q = client.from(table).select('*');
        if (filter) Object.keys(filter).forEach(k => { q = q.eq(k, filter[k]); });
        q = q.order('sort_order', { ascending: true, nullsFirst: true });
        const { data, error } = await q;
        if (error) { console.error(error); return []; }
        return data || [];
      },
      async insert(table, row) {
        const { data, error } = await client.from(table).insert(row).select().single();
        if (error) { console.error(error); throw error; }
        return data;
      },
      async update(table, id, patch) {
        const { data, error } = await client.from(table).update(patch).eq('id', id).select().single();
        if (error) { console.error(error); throw error; }
        return data;
      },
      async remove(table, id) {
        const { error } = await client.from(table).delete().eq('id', id);
        if (error) { console.error(error); throw error; }
        return true;
      }
    };
  })();

  // ---------- 공유 스냅샷 어댑터 (읽기전용, 암호 복호화 후 window.MM_SNAPSHOT 주입) ----------
  const Snapshot = (function () {
    if (!SHARE) return null;
    let readyPromise = null;
    function store() { return window.MM_SNAPSHOT || {}; }
    function matches(row, filter) {
      if (!filter) return true;
      return Object.keys(filter).every(k => String(row[k]) === String(filter[k]));
    }
    return {
      // 게이트가 복호화를 끝내고 window.__mmSnapshotReady() 를 호출할 때까지 대기
      init() {
        if (window.MM_SNAPSHOT) return Promise.resolve();
        if (!readyPromise) readyPromise = new Promise(res => { window.__mmSnapshotReady = res; });
        return readyPromise;
      },
      reload() { return Promise.resolve(); },
      async list(table, filter) {
        const rows = (store()[table] || []).filter(r => matches(r, filter));
        rows.sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0));
        return rows.map(r => ({ ...r }));
      },
      async insert() { return null; },
      async update() { return null; },
      async remove() { return true; }
    };
  })();

  const backend = Snapshot || Cloud || Local;

  window.DB = {
    READONLY: READONLY || SHARE,
    mode: SHARE ? 'share' : (Cloud ? 'cloud' : 'local'),
    init: () => (backend.init ? backend.init() : Promise.resolve()),
    reload: () => (backend.reload ? backend.reload() : Promise.resolve()),
    list: (t, f) => backend.list(t, f),
    insert: (t, r) => backend.insert(t, r),
    update: (t, id, p) => backend.update(t, id, p),
    remove: (t, id) => backend.remove(t, id),
    resetLocal: () => { if (!Cloud) return Local._reset(); }
  };

  // ---------- 샘플 데이터(로컬 최초 실행 시) ----------
  function seed() {
    const now = new Date().toISOString();
    // 서비스 항목 템플릿 + 프로세스 템플릿
    const st = [
      { id: 'st_contract', name: '계약', category: '운영', default_amount: 0, sort_order: 1 },
      { id: 'st_consulting', name: '진단컨설팅', category: '컨설팅', default_amount: 0, sort_order: 2 },
      { id: 'st_online_edu', name: '온라인마케팅교육', category: '교육', default_amount: 0, sort_order: 3 },
      { id: 'st_brand', name: '브랜딩', category: '디자인', default_amount: 3000000, sort_order: 4 },
      { id: 'st_pkg', name: '패키지', category: '디자인', default_amount: 2000000, sort_order: 5 },
      { id: 'st_shoot', name: '촬영', category: '디자인', default_amount: 1500000, sort_order: 6 },
      { id: 'st_wadiz', name: '와디즈상세페이지', category: '운영', default_amount: 2500000, sort_order: 7 },
      { id: 'st_wadiz_all', name: '와디즈올인원', category: '운영', default_amount: 0, sort_order: 8 },
      { id: 'st_store_detail', name: '스마트스토어 상세페이지', category: '운영', default_amount: 0, sort_order: 9 },
      { id: 'st_store', name: '스마트스토어 구축', category: '운영', default_amount: 1000000, sort_order: 10 },
      { id: 'st_reviewers', name: '체험단', category: '운영', default_amount: 0, sort_order: 11 },
      { id: 'st_instagram', name: '인스타그램 운영', category: '운영', default_amount: 0, sort_order: 12 }
    ];
    const pt = [
      // 브랜딩
      { id: 'pt1', service_template_id: 'st_brand', name: '컨설팅', default_assignee: '', sort_order: 1 },
      { id: 'pt2', service_template_id: 'st_brand', name: '네이밍/로고', default_assignee: '', sort_order: 2 },
      { id: 'pt3', service_template_id: 'st_brand', name: '가이드 전달', default_assignee: '', sort_order: 3 },
      // 패키지
      { id: 'pt4', service_template_id: 'st_pkg', name: '구조 설계', default_assignee: '', sort_order: 1 },
      { id: 'pt5', service_template_id: 'st_pkg', name: '디자인', default_assignee: '', sort_order: 2 },
      { id: 'pt6', service_template_id: 'st_pkg', name: '인쇄 감리', default_assignee: '', sort_order: 3 },
      // 촬영
      { id: 'pt7', service_template_id: 'st_shoot', name: '기획/콘티', default_assignee: '', sort_order: 1 },
      { id: 'pt8', service_template_id: 'st_shoot', name: '촬영일', default_assignee: '', sort_order: 2 },
      { id: 'pt9', service_template_id: 'st_shoot', name: '보정 납품', default_assignee: '', sort_order: 3 },
      // 와디즈
      { id: 'pt10', service_template_id: 'st_wadiz', name: '상세페이지', default_assignee: '', sort_order: 1 },
      { id: 'pt11', service_template_id: 'st_wadiz', name: '오픈예정', default_assignee: '', sort_order: 2 },
      { id: 'pt12', service_template_id: 'st_wadiz', name: '펀딩 오픈', default_assignee: '', sort_order: 3 },
      // 스토어
      { id: 'pt13', service_template_id: 'st_store', name: '입점 세팅', default_assignee: '', sort_order: 1 },
      { id: 'pt14', service_template_id: 'st_store', name: '상세 등록', default_assignee: '', sort_order: 2 }
    ];

    // 샘플 업체 2개 + 서비스/프로세스
    const companies = [
      { id: 'co_1', name: '모해나키친', rep_name: '김모해', item: '반찬/HMR', contact: '010-1234-5678', first_quote_date: '2026-05-02', total_quote: 6500000, manager: '이비비', status: '진행중', hidden: false, memo: '와디즈 6월 오픈 목표', created_at: now, sort_order: 1 },
      { id: 'co_2', name: '시내쫄면', rep_name: '박시내', item: '분식 프랜차이즈', contact: '010-9876-5432', first_quote_date: '2026-04-18', total_quote: 4500000, manager: '이비비', status: '지연', hidden: false, memo: '촬영 일정 조율 중', created_at: now, sort_order: 2 }
    ];
    const services = [
      { id: 'sv_1', company_id: 'co_1', template_id: 'st_brand', name: '브랜딩', category: '디자인', amount: 3000000, status: '종료', sort_order: 1 },
      { id: 'sv_2', company_id: 'co_1', template_id: 'st_wadiz', name: '와디즈상세페이지', category: '운영', amount: 2500000, status: '진행중', sort_order: 2 },
      { id: 'sv_3', company_id: 'co_2', template_id: 'st_pkg', name: '패키지', category: '디자인', amount: 2000000, status: '진행중', sort_order: 1 },
      { id: 'sv_4', company_id: 'co_2', template_id: 'st_shoot', name: '촬영', category: '디자인', amount: 1500000, status: '예정', sort_order: 2 }
    ];
    const processes = [
      { id: 'pr_1', service_id: 'sv_1', name: '컨설팅', assignee: '', start_date: '2026-05-03', end_date: '2026-05-05', status: '종료', memo: '', sort_order: 1 },
      { id: 'pr_2', service_id: 'sv_1', name: '네이밍/로고', assignee: '', start_date: '2026-05-06', end_date: '2026-05-15', status: '종료', memo: '', sort_order: 2 },
      { id: 'pr_3', service_id: 'sv_1', name: '가이드 전달', assignee: '', start_date: '2026-05-16', end_date: '2026-05-18', status: '종료', memo: '', sort_order: 3 },
      { id: 'pr_4', service_id: 'sv_2', name: '상세페이지', assignee: '', start_date: '2026-05-20', end_date: '2026-06-02', status: '진행중', memo: '초안 검토중', sort_order: 1 },
      { id: 'pr_5', service_id: 'sv_2', name: '오픈예정', assignee: '', start_date: '2026-06-03', end_date: '2026-06-10', status: '예정', memo: '', sort_order: 2 },
      { id: 'pr_6', service_id: 'sv_2', name: '펀딩 오픈', assignee: '', start_date: '2026-06-11', end_date: '', status: '예정', memo: '', sort_order: 3 },
      { id: 'pr_7', service_id: 'sv_3', name: '구조 설계', assignee: '', start_date: '2026-04-20', end_date: '2026-04-28', status: '종료', memo: '', sort_order: 1 },
      { id: 'pr_8', service_id: 'sv_3', name: '디자인', assignee: '', start_date: '2026-04-29', end_date: '2026-05-20', status: '진행중', memo: '', sort_order: 2 },
      { id: 'pr_9', service_id: 'sv_4', name: '기획/콘티', assignee: '', start_date: '', end_date: '', status: '예정', memo: '일정 미정', sort_order: 1 }
    ];

    // 반복업무 + 오늘 체크 샘플
    const routines = [
      { id: 'rt_1', person: '나', title: '메일/카톡 확인', recurrence: JSON.stringify({ type: 'daily' }), sort_order: 1 },
      { id: 'rt_2', person: '나', title: '업체별 진행상황 업데이트', recurrence: JSON.stringify({ type: 'daily' }), sort_order: 2 },
      { id: 'rt_3', person: '나', title: '주간 보고 정리', recurrence: JSON.stringify({ type: 'weekly', days: [5] }), sort_order: 3 }
    ];

    const out = { service_templates: st, process_templates: pt, companies, services, processes, routines, task_checks: [] };
    return out;
  }
})();
