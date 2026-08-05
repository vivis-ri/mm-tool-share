// ============================================================
//  pdf.js — PDF 내보내기 / 인쇄
//  Electron: 네이티브 PDF 저장 / 웹: 인쇄 대화상자
// ============================================================
window.PDF = (function () {
  const { esc, fmtDate } = UI;

  // 가로(landscape) 기본 — 웹 인쇄와 Electron 저장 모두 가로. 세로가 필요하면 output에 {landscape:false}
  function pageCss(landscape) {
    return `@page { size: A4 ${landscape ? 'landscape' : 'portrait'}; margin: 12mm; }`;
  }

  const styles = `
    <style>
      * { box-sizing: border-box; }
      body { font-family: "Pretendard","Malgun Gothic",sans-serif; color:#2A2B29; margin:0; padding:22px 26px; -webkit-print-color-adjust:exact; print-color-adjust:exact; }
      h1 { font-size:22px; margin:0 0 4px; }
      .sub { color:#8b8c84; font-size:12px; margin-bottom:18px; }
      table { width:100%; border-collapse:collapse; margin-bottom:22px; font-size:12px; }
      th,td { border:1px solid #e0dccf; padding:7px 9px; text-align:left; vertical-align:top; }
      th { background:#faf5ec; font-weight:700; }
      .st { display:inline-block; padding:2px 8px; border-radius:10px; font-size:11px; font-weight:600; white-space:nowrap; }
      .plan{background:#eef0f2;color:#6b7076;} .run{background:#fff0e0;color:#E06E00;}
      .pause{background:#eef3f6;color:#607086;}
      .done{background:#e6f4ec;color:#1f9d63;} .late{background:#fdecec;color:#e5484d;}
      h2 { font-size:15px; margin:18px 0 8px; border-left:4px solid #FA8619; padding-left:8px; }
      .foot { margin-top:24px; color:#b0aca0; font-size:10px; text-align:right; }
      .r{text-align:right;} .muted{color:#b0aca0;}

      /* 진행률 막대 */
      .prog{ min-width:78px; }
      .bar{ display:inline-block; width:64px; height:7px; background:#eee7d8; border-radius:6px; overflow:hidden; vertical-align:middle; margin-right:6px; }
      .bar > i{ display:block; height:100%; background:#FA8619; }
      .prog span{ font-size:11px; font-weight:600; color:#6b6c66; }

      /* 요약 표 — 서비스별 진행 칩 */
      td.chips{ line-height:1.9; }
      .pchip{ display:inline-block; padding:2px 8px; margin:0 4px 3px 0; border-radius:8px; font-size:10.5px; border:1px solid #e0dccf; background:#fff; }
      .pchip b{ font-weight:700; }
      .pchip.plan{background:#f4f5f6;border-color:#dfe3e6;color:#565a5f;}
      .pchip.run{background:#fff4e8;border-color:#f7c896;color:#c65f00;}
      .pchip.pause{background:#f1f5f8;border-color:#cdd8e2;color:#556377;}
      .pchip.done{background:#eef8f1;border-color:#b7e0c8;color:#178a53;}
      .pchip.late{background:#fdeeee;border-color:#f2bcbe;color:#d23a3f;}

      /* 진행 보드 */
      .board{ display:flex; flex-direction:column; gap:14px; }
      .bd-co{ border:1px solid #e0dccf; border-radius:12px; padding:12px 14px; break-inside:avoid; page-break-inside:avoid; }
      .bd-co-head{ display:flex; align-items:center; flex-wrap:wrap; gap:8px 14px; padding-bottom:10px; border-bottom:1px dashed #ece6d7; margin-bottom:10px; }
      .bd-co-name{ font-size:16px; font-weight:800; margin-right:2px; }
      .bd-co-meta{ font-size:11.5px; color:#8b8c84; }
      .bd-co-prog{ margin-left:auto; display:flex; align-items:center; }
      .bd-co-prog .bar{ width:120px; height:8px; }
      .bd-svc{ margin:8px 0 4px; }
      .bd-svc-head{ display:flex; align-items:center; gap:8px; margin-bottom:6px; }
      .bd-svc-name{ font-size:12.5px; font-weight:700; }
      .bd-svc-amt{ font-size:11px; color:#a7a89f; margin-left:auto; }
      .bd-stages{ display:flex; flex-wrap:wrap; gap:7px; }
      .bd-stage{ position:relative; min-width:104px; border:1px solid #e0dccf; border-left-width:4px; border-radius:8px; padding:6px 9px; background:#fff; }
      .bd-stage-idx{ position:absolute; top:6px; right:8px; font-size:9px; font-weight:700; color:#c3c0b4; }
      .bd-stage-name{ font-size:11.5px; font-weight:700; color:#2A2B29; padding-right:14px; }
      .bd-stage-st{ font-size:10px; font-weight:700; margin-top:2px; }
      .bd-stage-date{ font-size:9.5px; color:#8b8c84; margin-top:3px; }
      .bd-stage-asg{ font-size:9.5px; color:#6f7069; margin-top:3px; font-weight:600; }
      .bd-stage.st-plan{ border-left-color:#c3c9cf; } .bd-stage.st-plan .bd-stage-st{color:#6b7076;}
      .bd-stage.st-run{ border-left-color:#FA8619; background:#fffaf3; } .bd-stage.st-run .bd-stage-st{color:#E06E00;}
      .bd-stage.st-pause{ border-left-color:#8ea3b8; } .bd-stage.st-pause .bd-stage-st{color:#607086;}
      .bd-stage.st-done{ border-left-color:#2fbd7a; background:#f6fbf8; } .bd-stage.st-done .bd-stage-st{color:#1f9d63;}
      .bd-stage.st-late{ border-left-color:#e5484d; background:#fdf6f6; } .bd-stage.st-late .bd-stage-st{color:#d23a3f;}
      .bd-empty{ font-size:11px; color:#b0aca0; padding:4px 2px; }

      /* 월간 달력 PDF */
      .cal-legend{ display:flex; align-items:center; flex-wrap:wrap; gap:6px 9px; margin:0 0 11px; }
      .cal-leg{ display:inline-flex; align-items:center; gap:5px; padding:3px 7px; border:1px solid #e0dccf; border-radius:8px; background:#fff; font-size:10px; font-weight:700; }
      .cal-dot{ width:7px; height:7px; border-radius:50%; display:inline-block; flex:none; }
      .cal-grid{ display:grid; grid-template-columns:repeat(7, 1fr); gap:5px; }
      .cal-grid.weeks-1 .cal-cell{ min-height:118px; }
      .cal-grid.weeks-2 .cal-cell{ min-height:102px; }
      .cal-grid.weeks-4 .cal-cell{ min-height:82px; }
      .cal-grid.weeks-6 .cal-cell{ min-height:66px; }
      .cal-grid.weeks-8 .cal-cell{ min-height:56px; }
      .cal-dow{ text-align:center; background:#faf5ec; border:1px solid #e0dccf; border-radius:6px; padding:5px 4px; font-size:10.5px; font-weight:800; }
      .cal-dow.sun{ color:#e5484d; } .cal-dow.sat{ color:#476f96; }
      .cal-cell{ min-height:76px; border:1px solid #e0dccf; border-radius:8px; padding:5px; background:#fff; break-inside:avoid; page-break-inside:avoid; }
      .cal-cell.empty{ background:#fbfaf7; border-color:#f0eadf; color:#b0aca0; }
      .cal-cell-top{ display:flex; align-items:center; justify-content:space-between; gap:4px; margin-bottom:4px; font-size:10.5px; font-weight:800; }
      .cal-holiday{ overflow:hidden; text-overflow:ellipsis; white-space:nowrap; color:#e5484d; font-size:8.5px; font-weight:700; }
      .cal-items{ display:flex; flex-direction:column; gap:3px; }
      .cal-item{ border:1px solid #e0dccf; border-radius:7px; padding:4px 5px; font-size:8.8px; line-height:1.28; overflow:hidden; }
      .cal-item-title{ display:flex; align-items:center; gap:4px; font-weight:800; color:#2A2B29; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
      .cal-status{ width:6px; height:6px; border-radius:50%; display:inline-block; flex:none; }
      .cal-item-meta{ margin-top:2px; color:#6f7069; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
    </style>`;

  function stClass(s) { return ({ '예정': 'plan', '진행중': 'run', '일시정지': 'pause', '종료': 'done', '지연': 'late' })[s] || 'plan'; }
  function stTag(s) { return `<span class="st ${stClass(s)}">${esc(s || '예정')}</span>`; }
  function statusColor(s) {
    return ({ '예정': '#9AA0A6', '진행중': '#FA8619', '일시정지': '#607086', '종료': '#1f9d63', '지연': '#e5484d' })[s] || '#9AA0A6';
  }
  function today() { const d = new Date(); return `${d.getFullYear()}.${d.getMonth() + 1}.${d.getDate()}`; }
  function ymd(d) { return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; }
  function addDays(d, n) { const x = new Date(d); x.setDate(x.getDate() + n); return x; }
  function parseYmd(value) {
    const s = String(value || '').slice(0, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return null;
    const d = new Date(s + 'T00:00:00');
    return Number.isNaN(d.getTime()) ? null : d;
  }
  function startOfWeek(d) {
    const x = new Date(d);
    x.setHours(0, 0, 0, 0);
    x.setDate(x.getDate() - x.getDay());
    return x;
  }
  function isHiddenCompany(c) {
    return c && (c.hidden === true || c.hidden === 'true' || c.is_hidden === true || !!c.hidden_at);
  }
  function sortByQuoteDate(a, b) {
    if (window.Companies && window.Companies.sortByQuoteDate) return window.Companies.sortByQuoteDate(a, b);
    return String(a.first_quote_date || '9999-99-99').localeCompare(String(b.first_quote_date || '9999-99-99'));
  }
  function scheduleText(p) {
    return (p && p.end_date) ? fmtDate(p.end_date) : '-';
  }
  function assigneeText(p) {
    return (p && p.assignee) ? p.assignee : '-';
  }
  function monthAnchor(anchor) {
    const base = anchor ? new Date(anchor) : (window.Schedule ? window.Schedule.startToday() : new Date());
    if (Number.isNaN(base.getTime())) return new Date(new Date().getFullYear(), new Date().getMonth(), 1);
    return new Date(base.getFullYear(), base.getMonth(), 1);
  }
  function monthLabel(anchor) {
    const d = monthAnchor(anchor);
    return `${d.getFullYear()}년 ${d.getMonth() + 1}월`;
  }
  function monthFileSuffix(anchor) {
    const d = monthAnchor(anchor);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
  }
  function monthCells(anchor) {
    const first = monthAnchor(anchor);
    const start = new Date(first);
    start.setDate(first.getDate() - first.getDay());
    return Array.from({ length: 42 }, (_, i) => {
      const d = new Date(start);
      d.setDate(start.getDate() + i);
      return d;
    });
  }
  function fullDate(d) {
    return `${d.getFullYear()}.${String(d.getMonth() + 1).padStart(2, '0')}.${String(d.getDate()).padStart(2, '0')}`;
  }
  function calendarRange(opts) {
    const weeks = Math.max(1, Math.min(12, Number(opts && opts.weeks) || 0));
    const start = parseYmd(opts && opts.startDate);
    if (start && weeks) {
      const rangeStart = startOfWeek(start);
      const rangeEnd = addDays(rangeStart, weeks * 7);
      const rangeLast = addDays(rangeEnd, -1);
      return {
        mode: 'weeks',
        start: rangeStart,
        end: rangeEnd,
        days: weeks * 7,
        weeks,
        label: `${fullDate(rangeStart)} ~ ${fullDate(rangeLast)} · ${weeks}주`,
        suffix: `${ymd(rangeStart)}_${ymd(rangeLast)}`
      };
    }
    const anchor = monthAnchor(opts && opts.anchor);
    const cells = monthCells(anchor);
    return {
      mode: 'month',
      start: cells[0],
      end: addDays(cells[cells.length - 1], 1),
      days: cells.length,
      weeks: Math.ceil(cells.length / 7),
      month: anchor.getMonth(),
      label: monthLabel(anchor),
      suffix: monthFileSuffix(anchor)
    };
  }
  function filePart(s) {
    return String(s || '').replace(/[\\/:*?"<>|]/g, '_').trim() || '업체';
  }

  function output(title, inner, filename, opts) {
    const landscape = !opts || opts.landscape !== false;
    const html = `<!DOCTYPE html><html><head><meta charset="utf-8"><title>${esc(title)}</title>
      <style>${pageCss(landscape)}</style>${styles}</head><body>
      ${inner}<div class="foot">MM-tool · 출력일 ${today()}</div></body></html>`;
    if (window.mm && window.mm.isElectron) {
      window.mm.exportPdf(html, filename).then(r => {
        if (r && r.ok) {
          UI.toast('PDF로 저장했습니다 · 폴더를 엽니다');
          if (window.mm.revealPath && r.filePath) window.mm.revealPath(r.filePath);
        }
      });
    } else {
      const w = window.open('', '_blank');
      w.document.write(html); w.document.close();
      setTimeout(() => { w.focus(); w.print(); }, 350);
    }
  }

  // 업체 + 서비스 항목 + 프로세스 단계 한 번에 로드(숨김 업체 제외, 견적일순 정렬)
  async function loadAll() {
    const companies = (await DB.list('companies')).filter(c => !isHiddenCompany(c)).sort(sortByQuoteDate);
    UI.setCompanyColors(companies);
    const templates = await DB.list('service_templates');
    const services = (await DB.list('services')).sort(UI.serviceSorter(templates));
    const processes = await DB.list('processes');
    const svcBy = {}; services.forEach(s => { (svcBy[s.company_id] = svcBy[s.company_id] || []).push(s); });
    const procBySvc = {}; processes.forEach(p => { (procBySvc[p.service_id] = procBySvc[p.service_id] || []).push(p); });
    return { companies, svcBy, procBySvc };
  }

  // 한 업체의 전체 완료/전체 단계 수 집계
  function progressOf(svcs, procBySvc) {
    let done = 0, total = 0;
    svcs.forEach(s => { const ps = procBySvc[s.id] || []; done += ps.filter(p => p.status === '종료').length; total += ps.length; });
    return { done, total, pct: total ? Math.round(done / total * 100) : 0 };
  }

  // ── 요약 표(가로) — 업체별 진행률 + 서비스 항목별 프로세스 현황 열 포함
  async function companies() {
    const { companies: cos, svcBy, procBySvc } = await loadAll();
    let sumDone = 0, sumTotal = 0;
    const rows = cos.map((c, i) => {
      const svcs = svcBy[c.id] || [];
      const pr = progressOf(svcs, procBySvc);
      sumDone += pr.done; sumTotal += pr.total;
      const chips = svcs.length ? svcs.map(s => {
        const ps = procBySvc[s.id] || [];
        const d = ps.filter(p => p.status === '종료').length;
        return `<span class="pchip ${stClass(s.status)}">${esc(s.name)} <b>${ps.length ? d + '/' + ps.length : '-'}</b></span>`;
      }).join('') : '<span class="muted">서비스 항목 없음</span>';
      return `<tr>
        <td>${i + 1}</td><td>${esc(c.first_quote_date || '-')}</td><td><b>${esc(c.name)}</b></td>
        <td>${esc(c.rep_name || '-')}</td><td>${esc(c.manager || '-')}</td>
        <td class="r">${esc(UI.moneyVatText(c.total_quote))}</td><td>${stTag(c.status)}</td>
        <td class="prog"><span class="bar"><i style="width:${pr.pct}%"></i></span><span>${pr.total ? pr.done + '/' + pr.total : '-'}</span></td>
        <td class="chips">${chips}</td>
      </tr>`;
    }).join('');
    const totalPct = sumTotal ? Math.round(sumDone / sumTotal * 100) : 0;
    output('프로젝트 현황 요약표',
      `<h1>프로젝트 전체 현황 (요약표)</h1>
       <div class="sub">전체 ${cos.length}개 업체 · 전체 프로세스 ${sumDone}/${sumTotal}단계 완료 (${totalPct}%)</div>
      <table><thead><tr>
        <th>No</th><th>최초견적일</th><th>업체명</th><th>대표자</th><th>담당자</th><th class="r">총견적</th><th>상태</th><th>진행률</th><th>서비스 항목별 진행현황 (완료/전체)</th>
      </tr></thead>
       <tbody>${rows}</tbody></table>`,
      '프로젝트현황_요약표', { landscape: true });
  }

  // ── 진행 보드(가로) — 업체별 프로세스 단계를 상태색 카드로 한눈에
  async function progressBoard() {
    const { companies: cos, svcBy, procBySvc } = await loadAll();
    const blocks = cos.map(c => {
      const svcs = svcBy[c.id] || [];
      const pr = progressOf(svcs, procBySvc);
      const svcBlocks = svcs.length ? svcs.map(s => {
        const ps = procBySvc[s.id] || [];
        const stages = ps.length ? ps.map((p, i) => {
          const sched = scheduleText(p);
          return `
            <div class="bd-stage st-${stClass(p.status)}">
              <div class="bd-stage-idx">${i + 1}</div>
              <div class="bd-stage-name">${esc(p.name)}</div>
              <div class="bd-stage-st">${esc(p.status || '예정')}</div>
              <div class="bd-stage-asg">담당 ${esc(assigneeText(p))}</div>
              <div class="bd-stage-date">일정 ${esc(sched)}</div>
            </div>`;
        }).join('') : '<div class="bd-empty">프로세스 단계 없음</div>';
        return `<div class="bd-svc">
          <div class="bd-svc-head"><span class="bd-svc-name">${esc(s.name)}</span>${stTag(s.status)}<span class="bd-svc-amt">${esc(UI.moneyVatText(s.amount))}</span></div>
          <div class="bd-stages">${stages}</div>
        </div>`;
      }).join('') : '<div class="bd-empty">등록된 서비스 항목이 없습니다.</div>';
      return `<div class="bd-co">
        <div class="bd-co-head">
          <span class="bd-co-name">${esc(c.name)}</span>${stTag(c.status)}
          <span class="bd-co-meta">${esc(c.rep_name || '-')} · 담당 ${esc(c.manager || '-')} · ${esc(UI.moneyVatText(c.total_quote))}</span>
          <span class="bd-co-prog"><span class="bar"><i style="width:${pr.pct}%"></i></span><span class="prog"><span>${pr.total ? pr.done + '/' + pr.total + '단계 (' + pr.pct + '%)' : '단계 없음'}</span></span></span>
        </div>
        ${svcBlocks}
      </div>`;
    }).join('');
    output('업체별 진행현황',
      `<h1>업체별 진행현황 (진행 보드)</h1>
       <div class="sub">전체 ${cos.length}개 업체 · 서비스 항목별 프로세스 단계 · 예정/진행중/일시정지/종료/지연 색 구분</div>
       <div class="board">${blocks}</div>`,
      '업체별_진행현황', { landscape: true });
  }

  async function company(id) {
    const c = (await DB.list('companies', { id }))[0];
    const serviceTemplates = await DB.list('service_templates');
    const svcs = (await DB.list('services', { company_id: id })).sort(UI.serviceSorter(serviceTemplates));
    let inner = `<h1>${esc(c.name)}</h1><div class="sub">${esc(c.rep_name)} · ${esc(c.item)} · ${esc(c.contact)}</div>
      <table><tbody>
        <tr><th>대표자</th><td>${esc(c.rep_name)}</td><th>아이템</th><td>${esc(c.item)}</td></tr>
        <tr><th>최초견적일</th><td>${esc(c.first_quote_date || '-')}</td><th>총견적</th><td>${esc(UI.moneyVatText(c.total_quote))}</td></tr>
        <tr><th>담당자</th><td>${esc(c.manager)}</td><th>상태</th><td>${stTag(c.status)}</td></tr>
        <tr><th>비고</th><td colspan="3">${esc(c.memo || '')}</td></tr>
      </tbody></table>`;
    for (const s of svcs) {
      const ps = await DB.list('processes', { service_id: s.id });
      inner += `<h2>${esc(s.name)} · ${esc(UI.moneyVatText(s.amount))} · ${stTag(s.status)}</h2>
        <table><thead><tr><th>단계</th><th>담당</th><th>일정</th><th>상태</th><th>메모</th></tr></thead><tbody>
        ${ps.length ? ps.map(p => `<tr><td>${esc(p.name)}</td><td>${esc(assigneeText(p))}</td>
          <td>${esc(scheduleText(p))}</td>
          <td>${stTag(p.status)}</td><td>${esc(p.memo || '')}</td></tr>`).join('')
          : '<tr><td colspan="5">프로세스 없음</td></tr>'}
        </tbody></table>`;
    }
    output(c.name, inner, c.name + '_진행현황');
  }

  async function calendar(companyId, opts) {
    if (companyId && typeof companyId === 'object') {
      opts = companyId;
      companyId = opts.companyId;
    }
    const { companies: cos, svcBy, procBySvc } = await loadAll();
    const targetId = companyId == null ? '' : String(companyId);
    const selected = targetId ? cos.filter(c => String(c.id) === targetId) : cos;
    if (targetId && !selected.length) {
      UI.toast('업체를 찾지 못했습니다');
      return;
    }

    const range = calendarRange(opts);
    const byDate = {};
    selected.forEach(c => {
      (svcBy[c.id] || []).forEach(s => {
        (procBySvc[s.id] || []).forEach(p => {
          const key = String(p.end_date || '').slice(0, 10);
          const d = parseYmd(key);
          if (!d || d < range.start || d >= range.end) return;
          (byDate[key] = byDate[key] || []).push({ company: c, service: s, process: p });
        });
      });
    });
    Object.keys(byDate).forEach(key => {
      byDate[key].sort((a, b) =>
        String(a.company.name || '').localeCompare(String(b.company.name || ''), 'ko-KR') ||
        String(a.service.name || '').localeCompare(String(b.service.name || ''), 'ko-KR') ||
        String(a.process.name || '').localeCompare(String(b.process.name || ''), 'ko-KR'));
    });

    const isSingle = !!targetId && selected.length === 1;
    const subject = isSingle ? selected[0].name : '전체 업체';
    const total = Object.keys(byDate).reduce((sum, key) => sum + byDate[key].length, 0);
    const legend = selected.length
      ? selected.map(c => {
        const tone = UI.companyTone ? UI.companyTone(c.id) : { dot: '#FA8619' };
        return `<span class="cal-leg"><span class="cal-dot" style="background:${tone.dot}"></span>${esc(c.name)}</span>`;
      }).join('')
      : '<span class="muted">표시할 업체가 없습니다.</span>';
    const dows = ['일', '월', '화', '수', '목', '금', '토']
      .map((d, i) => `<div class="cal-dow ${i === 0 ? 'sun' : (i === 6 ? 'sat' : '')}">${d}</div>`).join('');
    const cells = Array.from({ length: range.days }, (_, i) => addDays(range.start, i)).map(d => {
      const key = ymd(d);
      const items = byDate[key] || [];
      const holiday = window.Schedule && window.Schedule.holidayName ? window.Schedule.holidayName(d) : '';
      const outMonth = range.mode === 'month' && d.getMonth() !== range.month;
      const dateText = range.mode === 'weeks' ? `${d.getMonth() + 1}.${d.getDate()}` : d.getDate();
      return `<div class="cal-cell ${outMonth ? 'empty' : ''}">
        <div class="cal-cell-top"><span>${dateText}</span>${holiday ? `<span class="cal-holiday">${esc(holiday)}</span>` : ''}</div>
        <div class="cal-items">
          ${items.map(it => {
            const tone = UI.companyTone ? UI.companyTone(it.company.id) : { bg: '#fff4e6', line: '#f2b66c', dot: '#FA8619' };
            const status = it.process.status || '예정';
            const title = isSingle
              ? `${it.service.name || '-'} · ${it.process.name || '-'}`
              : `${it.company.name || '-'} · ${it.service.name || '-'}`;
            const meta = isSingle
              ? `${status}`
              : `${it.process.name || '-'} · ${status}`;
            return `<div class="cal-item" style="background:${tone.bg};border-color:${tone.line}">
              <div class="cal-item-title"><span class="cal-status" style="background:${statusColor(status)}"></span>${esc(title)}</div>
              <div class="cal-item-meta">${esc(meta)}</div>
            </div>`;
          }).join('')}
        </div>
      </div>`;
    }).join('');

    output(`${subject} 달력`,
      `<h1>${esc(subject)} 달력</h1>
       <div class="sub">${esc(range.label)} 마감일 기준 · ${selected.length}개 업체 · ${total}건</div>
       <div class="cal-legend">${legend}</div>
       <div class="cal-grid weeks-${range.weeks}">${dows}${cells}</div>`,
      `${filePart(subject)}_달력_${range.suffix}`, { landscape: true });
  }

  async function diary(dates) {
    const routines = await DB.list('routines', { person: '나' });
    const checks = await DB.list('task_checks', { person: '나' });
    const S = window.Schedule;
    const movedPrefix = 'mm-moved-to:';
    const isMoved = (ch) => String((ch && ch.memo) || '').startsWith(movedPrefix);
    const DOW = ['일', '월', '화', '수', '목', '금', '토'];
    const cmap = {}; checks.forEach(ch => { if (ch.routine_id) cmap[ch.routine_id + '_' + ch.date] = ch; });
    let cols = dates.map(d => {
      const key = ymd(d);
      const applied = routines.filter(r => S.routineApplies(r, d));
      const items = applied.map(r => {
        const ch = cmap[r.id + '_' + key];
        if (isMoved(ch)) return null;
        return { t: r.title, done: (ch || {}).done };
      }).filter(Boolean)
        .concat(checks.filter(ch => !ch.routine_id && !ch.deadline_key && ch.date === key).map(ch => ({ t: ch.title, done: ch.done })));
      return `<td><b>${d.getMonth() + 1}.${d.getDate()}(${DOW[d.getDay()]})</b><br>${
        items.map(it => `${it.done ? '☑' : '☐'} ${esc(it.t)}`).join('<br>') || '-'}</td>`;
    }).join('');
    output('업무일지',
      `<h1>업무일지</h1><div class="sub">${ymd(dates[0])} ~ ${ymd(dates[6])}</div>
       <table><tbody><tr>${cols}</tr></tbody></table>`,
      '업무일지');
  }

  return { companies, progressBoard, company, calendar, diary };
})();
