// ============================================================
//  app.js — 네비게이션 · 초기화
// ============================================================
(function () {
  const views = {
    diary: { el: document.getElementById('view-diary'), mod: () => window.Diary },
    companies: { el: document.getElementById('view-companies'), mod: () => window.Companies },
    schedule: { el: document.getElementById('view-schedule'), mod: () => window.SchedulePlan },
    settings: { el: document.getElementById('view-settings'), mod: () => window.Settings }
  };

  let current = 'diary';

  function switchView(name) {
    current = name;
    document.querySelectorAll('.nav-item').forEach(b =>
      b.classList.toggle('active', b.dataset.view === name));
    Object.keys(views).forEach(k =>
      views[k].el.classList.toggle('active', k === name));
    const mod = views[name].mod();
    if (mod && mod.render) mod.render(views[name].el);
  }

  // 다른 모듈에서 화면 전환/새로고침 요청
  window.App = {
    go: switchView,
    refresh: () => { const m = views[current].mod(); if (m && m.render) m.render(views[current].el); },
    openCompany: (id) => { switchView('companies'); if (window.Companies) window.Companies.open(id, views.companies.el); },
    refreshSidebar
  };

  document.querySelectorAll('.nav-item').forEach(b =>
    b.addEventListener('click', () => {
      // 프로젝트 현황 탭을 누르면 항상 전체현황(목록)부터
      if (b.dataset.view === 'companies' && window.Companies && window.Companies.resetOpen) window.Companies.resetOpen();
      switchView(b.dataset.view);
    }));

  // ----- 사이드바 업체 바로가기 -----
  const navCo = document.getElementById('nav-co');
  const navCoList = document.getElementById('nav-co-list');
  if (localStorage.getItem('nav-co-collapsed') === '1') navCo.classList.add('collapsed');
  document.getElementById('nav-co-toggle').addEventListener('click', () => {
    navCo.classList.toggle('collapsed');
    localStorage.setItem('nav-co-collapsed', navCo.classList.contains('collapsed') ? '1' : '0');
  });

  async function refreshSidebar() {
    const companies = (await window.DB.list('companies'))
      .filter(c => !(window.Companies && window.Companies.isHidden(c)))
      .sort(window.Companies ? window.Companies.sortByQuoteDate : undefined);

    const services = await window.DB.list('services');
    const serviceCompany = {};
    services.forEach(s => { serviceCompany[s.id] = s.company_id; });
    const procByCo = {};
    (await window.DB.list('processes')).forEach(p => {
      const companyId = serviceCompany[p.service_id];
      if (companyId) (procByCo[companyId] = procByCo[companyId] || []).push(p);
    });

    const cos = companies.map(c => {
      const procs = procByCo[c.id] || [];
      const activeStatus = window.Companies && window.Companies.isActiveStatus;
      const active = activeStatus
        ? activeStatus(c.status) || procs.some(p => activeStatus(p.status))
        : c.status === '진행중' || c.status === '지연' || c.status === '일시정지';
      const current = active && (!window.Companies || !window.Companies.companyTouchesMonth || window.Companies.companyTouchesMonth(c, procs));
      return { ...c, _current: current };
    }).sort((a, b) => {
      if (a._current !== b._current) return a._current ? -1 : 1;
      return window.Companies && window.Companies.sortByQuoteDate ? window.Companies.sortByQuoteDate(a, b) : 0;
    });

    navCoList.innerHTML = cos.length
      ? cos.map(c => `<button class="nav-co-item ${c._current ? 'fav' : ''}" data-id="${c.id}" title="${c._current ? '현재 진행 업체' : ''}">
          <span class="co-dot ${UI.statusClass(c.status)}"></span>
          <span class="nav-co-name">${UI.esc(c.name)}</span>
          ${c._current ? '<span class="nav-co-star">★</span>' : ''}</button>`).join('')
      : '<div class="nav-co-empty">등록된 업체 없음</div>';
    navCoList.querySelectorAll('.nav-co-item').forEach(b =>
      b.addEventListener('click', () => window.App.openCompany(b.dataset.id)));
  }

  // 미니 패널 버튼(Electron 전용)
  const panelBtn = document.getElementById('btn-panel');
  if (window.mm && window.mm.isElectron) {
    panelBtn.addEventListener('click', () => window.mm.togglePanel());
  } else {
    panelBtn.style.display = 'none';
  }

  // 저장 모드 배지
  const badge = document.getElementById('mode-badge');
  if (window.DB.mode === 'cloud') { badge.textContent = '☁ 클라우드 연결됨'; badge.style.color = '#8fd6a8'; }
  else { badge.textContent = '💾 로컬 저장 (내 PC)'; }

  // 읽기전용(대표님 웹)
  if (window.DB.READONLY) document.body.classList.add('readonly');

  // 창이 다시 활성화되면 파일에서 최신 데이터 반영(미니 패널에서 바꾼 내용 등)
  window.addEventListener('focus', async () => {
    await window.DB.reload();
    refreshSidebar();
    window.App.refresh();
  });

  window.DB.init().then(() => { refreshSidebar(); switchView('diary'); });
})();
