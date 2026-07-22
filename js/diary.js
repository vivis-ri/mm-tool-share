// ============================================================
//  diary.js — 업무일지(주간/월간 · 반복업무 · 마감일 연동)
//  날짜/반복/공휴일/마감일 계산은 Schedule 모듈 공용 사용
// ============================================================
window.Diary = (function () {
  const { esc, toast, modal } = UI;
  const S = window.Schedule;
  const DOW = S.DOW;
  const state = { view: 'week', anchor: S.startToday(), person: '나' };
  const MOVED_TO_PREFIX = 'mm-moved-to:';
  const MOVED_FROM_PREFIX = 'mm-moved-from:';
  let draggingTask = null;
  let suppressNextSort = false;

  function movedTo(ch) {
    const memo = String((ch && ch.memo) || '');
    return memo.startsWith(MOVED_TO_PREFIX) ? memo.slice(MOVED_TO_PREFIX.length) : '';
  }

  function movedToMemo(date) { return MOVED_TO_PREFIX + date; }
  function movedFromMemo(date, routineId) { return `${MOVED_FROM_PREFIX}${date};routine:${routineId}`; }

  function progressOf(items) {
    const checkables = items.filter(i => i.type !== 'd');
    const done = checkables.filter(i => i.done).length;
    const total = checkables.length;
    return { done, total, pct: total ? Math.round(done / total * 100) : 0 };
  }

  async function loadData() {
    const routines = await DB.list('routines', { person: state.person });
    const checks = await DB.list('task_checks', { person: state.person });
    const companies = (await DB.list('companies')).filter(c => !(window.Companies && window.Companies.isHidden(c)));
    const companyIds = new Set(companies.map(c => String(c.id)));
    const services = (await DB.list('services')).filter(s => companyIds.has(String(s.company_id)));
    const serviceIds = new Set(services.map(s => String(s.id)));
    const processes = (await DB.list('processes')).filter(p => serviceIds.has(String(p.service_id)));
    const checkMap = {}, oneoffs = {};
    checks.forEach(ch => {
      if (ch.deadline_key) return;                       // 마감 체크 행은 일회성 목록에서 제외
      if (ch.routine_id) checkMap['r_' + ch.routine_id + '_' + ch.date] = ch;
      else (oneoffs[ch.date] = oneoffs[ch.date] || []).push(ch);
    });
    return { routines, checkMap, oneoffs, deadlines: S.deadlineMap(companies, services, processes) };
  }

  // 특정 날짜의 항목들(반복+일회성+마감) — sort_order 기준 정렬
  function itemsFor(date, data) {
    const key = S.ymd(date);
    const applied = data.routines.filter(r => S.routineApplies(r, date));
    const items = applied.map((r, i) => {
      const ch = data.checkMap['r_' + r.id + '_' + key];
      if (movedTo(ch)) return null;
      return { type: 'r', id: r.id, title: r.title, done: ch ? ch.done : false, ord: r.sort_order ?? i };
    }).filter(Boolean);
    (data.oneoffs[key] || []).forEach((o, i) => items.push({ type: 'o', id: o.id, title: o.title, done: o.done, ord: o.sort_order ?? (500 + i) }));
    items.sort((a, b) => a.ord - b.ord);
    (data.deadlines[key] || []).forEach(d => items.push({
      type: 'd', title: `${d.company} · ${d.service} · ${d.stage} 마감`, status: d.status, ord: 9000
    }));
    return items;
  }

  async function render(root) {
    const data = await loadData();

    root.innerHTML = `
      <div class="page-head">
        <div>
          <div class="page-title">업무일지</div>
          <div class="page-sub">${state.view === 'week' ? '이번 주 체크리스트' : '월간 보기'} · 반복업무는 주말·공휴일 자동 제외 · 🚩는 업체 마감일</div>
        </div>
        <div class="head-actions">
          <div class="seg">
            <button class="seg-btn ${state.view === 'week' ? 'on' : ''}" data-view="week">주간</button>
            <button class="seg-btn ${state.view === 'month' ? 'on' : ''}" data-view="month">월간</button>
          </div>
          <button class="btn ghost only-edit" id="mng-routine">🔁 반복업무</button>
          <button class="btn ghost" id="di-pdf">📄 PDF</button>
        </div>
      </div>

      <div class="date-nav">
        <button class="icon-btn" id="prev">‹</button>
        <div class="date-label" id="date-label"></div>
        <button class="icon-btn" id="next">›</button>
        <button class="btn sm ghost" id="today">오늘</button>
      </div>
      <div id="diary-body"></div>`;

    const body = root.querySelector('#diary-body');
    const label = root.querySelector('#date-label');

    if (state.view === 'week') {
      const days = S.weekDates(state.anchor).filter(d => d.getDay() !== 0 && d.getDay() !== 6); // 평일만
      const last = days[days.length - 1];
      label.textContent = `${days[0].getFullYear()}. ${days[0].getMonth() + 1}.${days[0].getDate()} ~ ${last.getMonth() + 1}.${last.getDate()}`;
      body.innerHTML = `<div class="week-grid">${days.map(d => dayColumn(d, data)).join('')}</div>`;
    } else {
      renderMonth(body, label, data);
    }
    bind(root, data);
  }

  function taskLabel(it) {
    if (it.type === 'd') return `<div class="task deadline"><span class="flag">🚩</span><span>${esc(it.title)}</span></div>`;
    return `<div class="task ${it.done ? 'done' : ''}" data-type="${it.type}" data-id="${it.id}" data-title="${esc(it.title)}" data-done="${it.done ? '1' : '0'}">
      <span class="drag-handle only-edit" title="끌어서 순서 변경 또는 다른 날로 이동">⠿</span>
      <input type="checkbox" ${it.done ? 'checked' : ''}>
      <span class="task-txt">${esc(it.title)}</span>
      ${it.type === 'o' ? '<button class="task-del only-edit" data-del title="삭제">✕</button>' : ''}
    </div>`;
  }

  function progressBar(p) {
    if (!p.total) return '';
    return `<div class="day-progress ${p.done === p.total ? 'full' : ''}">
      <div class="day-progress-meta"><span>진행도</span><b>${p.pct}%</b></div>
      <div class="day-progress-track"><i style="width:${p.pct}%"></i></div>
    </div>`;
  }

  function dayColumn(date, data) {
    const key = S.ymd(date);
    const items = itemsFor(date, data);
    const prog = progressOf(items);
    const hol = S.holidayName(date);
    return `
      <div class="day-col ${S.isToday(date) ? 'today' : ''} ${date.getDay() === 0 ? 'sun' : ''} ${date.getDay() === 6 ? 'sat' : ''} ${hol ? 'holiday' : ''}" data-date="${key}">
        <div class="day-head">
          <span class="day-dow">${DOW[date.getDay()]}</span>
          <span class="day-num">${date.getDate()}</span>
          ${prog.total ? `<span class="day-cnt">${prog.done}/${prog.total}</span>` : ''}
        </div>
        ${hol ? `<div class="hol-tag">${esc(hol)}</div>` : ''}
        ${progressBar(prog)}
        <div class="day-items">${items.map(taskLabel).join('')}</div>
        <button class="add-task only-edit" data-add="${key}">+ 할 일</button>
      </div>`;
  }

  function renderMonth(body, label, data) {
    const y = state.anchor.getFullYear(), m = state.anchor.getMonth();
    label.textContent = `${y}년 ${m + 1}월`;
    const first = new Date(y, m, 1);
    const startPad = first.getDay();               // 일요일 시작
    const daysInMonth = new Date(y, m + 1, 0).getDate();
    const cells = [];
    for (let i = 0; i < startPad; i++) cells.push(null);
    for (let d = 1; d <= daysInMonth; d++) cells.push(new Date(y, m, d));
    while (cells.length % 7) cells.push(null);

    body.innerHTML = `
      <div class="month-grid">
        <div class="month-dow">${DOW.map((d, i) => `<span class="${i === 0 ? 'sun' : ''} ${i === 6 ? 'sat' : ''}">${d}</span>`).join('')}</div>
        <div class="month-cells">
          ${cells.map(d => {
            if (!d) return `<div class="mcell empty"></div>`;
            const items = itemsFor(d, data);
            const prog = progressOf(items);
            const hol = S.holidayName(d);
            const shown = items.slice(0, 4);
            const rest = items.length - shown.length;
            return `<div class="mcell ${S.isToday(d) ? 'today' : ''} ${d.getDay() === 0 ? 'sun' : ''} ${d.getDay() === 6 ? 'sat' : ''} ${hol ? 'holiday' : ''}" data-date="${S.ymd(d)}">
              <div class="mcell-top">
                <span class="mnum">${d.getDate()}</span>
                ${prog.total ? `<span class="mbar ${prog.done === prog.total ? 'full' : ''}" title="${prog.done}/${prog.total}">${prog.pct}%</span>` : ''}
              </div>
              ${prog.total ? `<div class="mcell-progress"><i style="width:${prog.pct}%"></i></div>` : ''}
              ${hol ? `<div class="mcell-hol">${esc(hol)}</div>` : ''}
              <div class="mcell-items">
                ${shown.map(it => `<div class="mtask ${it.type === 'd' ? 'dl' : ''} ${it.done ? 'done' : ''}">${it.type === 'd' ? '🚩' : (it.done ? '☑' : '☐')} ${esc(it.title)}</div>`).join('')}
                ${rest > 0 ? `<div class="mtask more">+${rest}개 더</div>` : ''}
              </div>
            </div>`;
          }).join('')}
        </div>
      </div>`;
  }

  // ---------- 이벤트 ----------
  function bind(root, data) {
    root.querySelectorAll('.seg-btn').forEach(b =>
      b.addEventListener('click', () => { state.view = b.dataset.view; render(root); }));
    root.querySelector('#prev').addEventListener('click', () => {
      state.anchor = state.view === 'week' ? S.addDays(state.anchor, -7)
        : new Date(state.anchor.getFullYear(), state.anchor.getMonth() - 1, 1);
      render(root);
    });
    root.querySelector('#next').addEventListener('click', () => {
      state.anchor = state.view === 'week' ? S.addDays(state.anchor, 7)
        : new Date(state.anchor.getFullYear(), state.anchor.getMonth() + 1, 1);
      render(root);
    });
    root.querySelector('#today').addEventListener('click', () => { state.anchor = S.startToday(); render(root); });
    root.querySelector('#mng-routine')?.addEventListener('click', () => manageRoutines(root));
    root.querySelector('#di-pdf')?.addEventListener('click', () => window.PDF.diary(S.weekDates(state.anchor)));

    root.querySelectorAll('.task input[type=checkbox]').forEach(cb =>
      cb.addEventListener('change', (e) => {
        e.stopPropagation();
        const t = cb.closest('.task');
        toggleTask(root, t.dataset.type, t.dataset.id, t.closest('.day-col').dataset.date, cb.checked);
      }));
    root.querySelectorAll('.task[data-id] .task-txt').forEach(txt =>
      txt.addEventListener('click', () => {
        const cb = txt.closest('.task').querySelector('input');
        cb.checked = !cb.checked; cb.dispatchEvent(new Event('change'));
      }));
    root.querySelectorAll('.task [data-del]').forEach(b =>
      b.addEventListener('click', async (e) => {
        e.preventDefault(); e.stopPropagation();
        await DB.remove('task_checks', b.closest('.task').dataset.id); render(root);
      }));
    root.querySelectorAll('[data-add]').forEach(b =>
      b.addEventListener('click', () => addOneoff(root, b.dataset.add)));
    root.querySelectorAll('.month-cells .mcell:not(.empty)').forEach(cell =>
      cell.addEventListener('click', () => dayModal(root, cell.dataset.date, data)));
    bindTaskDragMoves(root);

    // 주간: 각 날짜 칸에서 체크리스트 항목 드래그 순서변경
    root.querySelectorAll('.day-col .day-items').forEach(box => {
      DragSort.enable(box, {
        itemSelector: '.task[data-id]', handleSelector: '.drag-handle',
        onReorder: async () => {
          if (suppressNextSort) { suppressNextSort = false; return; }
          const items = [...box.querySelectorAll('.task[data-id]')];
          for (let i = 0; i < items.length; i++) {
            const el = items[i];
            if (el.dataset.type === 'r') await DB.update('routines', el.dataset.id, { sort_order: i + 1 });
            else if (el.dataset.type === 'o') await DB.update('task_checks', el.dataset.id, { sort_order: i + 1 });
          }
          render(root);
        }
      });
    });
  }

  function bindTaskDragMoves(root) {
    root.querySelectorAll('.day-col .task[data-id]').forEach(task => {
      task.addEventListener('dragstart', () => {
        const col = task.closest('.day-col');
        if (!col) return;
        draggingTask = {
          type: task.dataset.type,
          id: task.dataset.id,
          title: task.dataset.title || '',
          done: task.dataset.done === '1',
          fromDate: col.dataset.date
        };
      });
      task.addEventListener('dragend', () => setTimeout(() => { draggingTask = null; }, 0));
    });

    root.querySelectorAll('.day-col').forEach(col => {
      col.addEventListener('dragover', (e) => {
        if (!draggingTask || draggingTask.fromDate === col.dataset.date) return;
        e.preventDefault();
        col.classList.add('drop-target');
        if (e.dataTransfer) e.dataTransfer.dropEffect = 'move';
      });
      col.addEventListener('dragleave', (e) => {
        if (!e.relatedTarget || !col.contains(e.relatedTarget)) col.classList.remove('drop-target');
      });
      col.addEventListener('drop', async (e) => {
        if (!draggingTask || draggingTask.fromDate === col.dataset.date) return;
        e.preventDefault();
        e.stopPropagation();
        col.classList.remove('drop-target');
        suppressNextSort = true;
        await moveTaskToDate(root, draggingTask, col.dataset.date);
        setTimeout(() => { suppressNextSort = false; }, 500);
      });
    });
  }

  async function nextSortOrder(date) {
    const checks = await DB.list('task_checks', { person: state.person });
    const sameDay = checks.filter(ch => ch.date === date && !movedTo(ch));
    const max = sameDay.reduce((n, ch) => Math.max(n, Number(ch.sort_order) || 0), 500);
    return max + 1;
  }

  async function moveTaskToDate(root, task, toDate) {
    if (DB.READONLY || !task || task.fromDate === toDate) return;
    const order = await nextSortOrder(toDate);
    if (task.type === 'o') {
      await DB.update('task_checks', task.id, { date: toDate, sort_order: order });
    } else if (task.type === 'r') {
      const checks = await DB.list('task_checks', { person: state.person });
      const existing = checks.find(ch => String(ch.routine_id) === String(task.id) && ch.date === task.fromDate);
      const sourcePatch = { title: task.title, done: false, memo: movedToMemo(toDate) };
      if (existing) await DB.update('task_checks', existing.id, sourcePatch);
      else await DB.insert('task_checks', { routine_id: task.id, person: state.person, title: task.title, date: task.fromDate, done: false, memo: movedToMemo(toDate), sort_order: 0 });
      await DB.insert('task_checks', { routine_id: null, person: state.person, title: task.title, date: toDate, done: task.done, memo: movedFromMemo(task.fromDate, task.id), sort_order: order });
    }
    toast(`${task.title} 업무를 ${toDate}로 옮겼습니다`);
    render(root);
  }

  async function toggleTask(root, type, id, date, done) {
    if (DB.READONLY) return;
    if (type === 'r') {
      const existing = (await DB.list('task_checks')).find(ch => String(ch.routine_id) === String(id) && ch.date === date);
      const routine = (await DB.list('routines', { id }))[0];
      if (existing) await DB.update('task_checks', existing.id, { done });
      else await DB.insert('task_checks', { routine_id: id, person: state.person, title: routine ? routine.title : '', date, done });
    } else if (type === 'o') {
      await DB.update('task_checks', id, { done });
    }
    render(root);
  }

  async function addOneoff(root, date) {
    modal({
      title: '할 일 추가',
      bodyHTML: `
        <div class="field"><label>날짜</label><input class="input" id="o-date" type="date" value="${date}"></div>
        <div class="field">
          <label>할 일 <span class="muted">(여러 개는 줄바꿈으로 한 번에)</span></label>
          <textarea class="input" id="o-title" style="min-height:130px" placeholder="예: OO업체 시안 발송&#10;OO 견적서 보내기&#10;세금계산서 발행"></textarea>
        </div>
        <div class="muted" id="o-count"></div>`,
      saveLabel: '추가',
      onOpen: (m) => {
        const ta = m.querySelector('#o-title'), cnt = m.querySelector('#o-count');
        ta.addEventListener('input', () => {
          const n = ta.value.split(/\r?\n/).map(s => s.trim()).filter(Boolean).length;
          cnt.textContent = n > 1 ? `${n}개를 한 번에 추가합니다.` : '';
        });
      },
      onSave: async (m) => {
        const dt = m.querySelector('#o-date').value;
        const lines = m.querySelector('#o-title').value.split(/\r?\n/).map(s => s.trim()).filter(Boolean);
        if (!lines.length) { toast('할 일을 입력하세요'); return false; }
        let cnt = (await DB.list('task_checks')).filter(ch => !ch.routine_id && !ch.deadline_key && ch.date === dt).length;
        for (const title of lines) { cnt++; await DB.insert('task_checks', { routine_id: null, person: state.person, title, date: dt, done: false, sort_order: 500 + cnt }); }
        toast(`${lines.length}개 추가했습니다`); render(root);
      }
    });
  }

  async function dayModal(root, date, data) {
    const d = new Date(date + 'T00:00:00');
    const items = itemsFor(d, data);
    const hol = S.holidayName(d);
    modal({
      title: `${d.getMonth() + 1}월 ${d.getDate()}일 (${DOW[d.getDay()]})${hol ? ' · ' + hol : ''}`,
      bodyHTML: `
        <div class="day-modal-list">
          ${items.length ? items.map(it => it.type === 'd'
            ? `<div class="task deadline"><span class="flag">🚩</span><span>${esc(it.title)}</span></div>`
            : `<label class="task ${it.done ? 'done' : ''}" data-type="${it.type}" data-id="${it.id}"><input type="checkbox" ${it.done ? 'checked' : ''}><span>${esc(it.title)}</span></label>`
          ).join('') : '<p class="muted">이 날은 할 일이 없습니다.</p>'}
        </div>
        <button class="btn sm only-edit" id="dm-add" style="margin-top:12px">+ 할 일 추가</button>`,
      saveLabel: '닫기',
      onOpen: (m) => {
        m.querySelectorAll('.task input').forEach(cb => cb.addEventListener('change', async () => {
          const t = cb.closest('.task');
          await toggleTask(root, t.dataset.type, t.dataset.id, date, cb.checked);
        }));
        m.querySelector('#dm-add')?.addEventListener('click', () => addOneoff(root, date));
      },
      onSave: () => { render(root); }
    });
  }

  function recLabel(routine) {
    const r = S.parseRec(routine.recurrence);
    if (r.type === 'daily') return '매일(평일)';
    if (r.type === 'weekly') return '매주 ' + (r.days || []).map(d => DOW[d]).join('·');
    if (r.type === 'monthly') return `매월 ${r.day || 1}일`;
    return '';
  }

  function manageRoutines(root) {
    modal({
      title: '반복업무 관리',
      wide: true,
      bodyHTML: `
        <div class="routine-list" id="rlist"></div>
        <hr style="border:none;border-top:1px solid var(--line);margin:16px 0">
        <div class="field"><label>새 반복업무</label><input class="input" id="rt-title" placeholder="예: 메일 확인"></div>
        <div class="field"><label>반복 주기</label>
          <select class="select" id="rt-type">
            <option value="daily">매일 (주말·공휴일 제외)</option>
            <option value="weekly">매주 (요일 선택)</option>
            <option value="monthly">매월 (날짜 선택)</option>
          </select>
        </div>
        <div class="field" id="rt-weekly" style="display:none"><label>요일</label>
          <div class="dow-pick">${[0,1,2,3,4,5,6].map(i => `<label class="dow-chip"><input type="checkbox" value="${i}"><span>${DOW[i]}</span></label>`).join('')}</div>
        </div>
        <div class="field" id="rt-monthly" style="display:none"><label>매월 며칠</label><input class="input" id="rt-day" type="number" min="1" max="31" value="1"></div>
        <button class="btn primary" id="rt-add" style="margin-top:4px">+ 반복업무 추가</button>`,
      saveLabel: '닫기',
      onOpen: (m) => {
        const listEl = m.querySelector('#rlist');

        // 모달 내부의 목록만 갱신(창을 새로 띄우지 않음)
        async function refreshList() {
          const routines = await DB.list('routines', { person: state.person });
          listEl.innerHTML = routines.length ? routines.map(r => `
            <div class="routine-row" data-id="${r.id}">
              <span class="drag-handle" title="끌어서 순서 변경">⠿</span>
              <div class="routine-title"><b>${esc(r.title)}</b><span class="rec-tag">${recLabel(r)}</span></div>
              <button class="icon-btn xs" data-del-rt title="삭제">✕</button>
            </div>`).join('') : '<p class="muted">등록된 반복업무가 없습니다.</p>';
          listEl.querySelectorAll('[data-del-rt]').forEach(b => b.addEventListener('click', async () => {
            await DB.remove('routines', b.closest('.routine-row').dataset.id);
            toast('삭제했습니다'); await refreshList(); render(root);
          }));
          DragSort.enable(listEl, {
            itemSelector: '.routine-row', handleSelector: '.drag-handle',
            onReorder: async () => {
              const rows = [...listEl.querySelectorAll('.routine-row')];
              for (let i = 0; i < rows.length; i++) await DB.update('routines', rows[i].dataset.id, { sort_order: i + 1 });
              render(root);
            }
          });
        }
        refreshList();

        const typeSel = m.querySelector('#rt-type');
        typeSel.addEventListener('change', () => {
          m.querySelector('#rt-weekly').style.display = typeSel.value === 'weekly' ? '' : 'none';
          m.querySelector('#rt-monthly').style.display = typeSel.value === 'monthly' ? '' : 'none';
        });
        m.querySelector('#rt-add').addEventListener('click', async () => {
          const titleEl = m.querySelector('#rt-title');
          const title = titleEl.value.trim();
          if (!title) { toast('업무명을 입력하세요'); return; }
          let rec = { type: typeSel.value };
          if (typeSel.value === 'weekly') {
            rec.days = [...m.querySelectorAll('#rt-weekly input:checked')].map(i => Number(i.value));
            if (!rec.days.length) { toast('요일을 선택하세요'); return; }
          }
          if (typeSel.value === 'monthly') rec.day = Number(m.querySelector('#rt-day').value) || 1;
          const cnt = (await DB.list('routines', { person: state.person })).length;
          await DB.insert('routines', { person: state.person, title, recurrence: JSON.stringify(rec), sort_order: cnt + 1 });
          titleEl.value = '';
          toast('추가했습니다'); await refreshList(); render(root);
        });
      },
      onSave: () => { render(root); }
    });
  }

  return { render };
})();
