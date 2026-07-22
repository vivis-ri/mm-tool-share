// ============================================================
//  schedule.js — 날짜·반복·공휴일·마감일 공유 로직 (diary/panel 공용)
// ============================================================
window.Schedule = (function () {
  const DOW = ['일', '월', '화', '수', '목', '금', '토'];

  // 2026 대한민국 공휴일(대체공휴일 포함, 추정치 — 필요 시 수정 가능)
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

  function ymd(d) { return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; }
  function addDays(d, n) { const x = new Date(d); x.setDate(x.getDate() + n); return x; }
  function startToday() { const d = new Date(); d.setHours(0, 0, 0, 0); return d; }
  function isToday(d) { return ymd(d) === ymd(startToday()); }
  function isWeekend(d) { const g = d.getDay(); return g === 0 || g === 6; }
  function isHoliday(d) { return !!HOLIDAYS[ymd(d)]; }
  function holidayName(d) { return HOLIDAYS[ymd(d)] || ''; }

  function parseRec(r) { return typeof r === 'string' ? JSON.parse(r || '{}') : (r || {}); }

  // 반복업무가 특정 날짜에 나타나는가 (주말·공휴일 제외)
  function routineApplies(routine, date) {
    if (isHoliday(date)) return false;                 // 공휴일은 모든 반복 제외
    const r = parseRec(routine.recurrence);
    if (r.type === 'daily') return !isWeekend(date);   // 매일 = 평일만
    if (r.type === 'weekly') return (r.days || []).includes(date.getDay());
    if (r.type === 'monthly') return date.getDate() === (r.day || 1);
    return false;
  }

  // 일(0)~토(6) 시작 주간 7일
  function weekDates(anchor) {
    const start = addDays(anchor, -anchor.getDay());
    return Array.from({ length: 7 }, (_, i) => addDays(start, i));
  }

  // 프로세스 단계 마감일 → 날짜별 라벨 맵  { 'YYYY-MM-DD': [{company, service, stage, status}] }
  function deadlineMap(companies, services, processes) {
    const coName = {}; companies.forEach(c => coName[c.id] = c.name);
    const svc = {}; services.forEach(s => svc[s.id] = s);
    const map = {};
    processes.forEach(p => {
      if (!p.end_date) return;
      const s = svc[p.service_id]; if (!s) return;
      const key = String(p.end_date).slice(0, 10);
      (map[key] = map[key] || []).push({
        pid: p.id, service_id: p.service_id, company_id: s.company_id,
        company: coName[s.company_id] || '?', service: s.name, stage: p.name, status: p.status
      });
    });
    return map;
  }

  return {
    DOW, HOLIDAYS, ymd, addDays, startToday, isToday, isWeekend, isHoliday, holidayName,
    parseRec, routineApplies, weekDates, deadlineMap
  };
})();
