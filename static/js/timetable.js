// MyClass 課表（教師端）
// 課表屬於教師本人，不屬於某個班級：教師先設定自己的身分與任教清單，再依清單排課。
//   導師：只有一個班級，勾選自己教的科目，排課時只需點科目。
//   科任：有多個班級與科目，先建立「哪一班的什麼科目」清單，排課時直接點選。
// 開啟軟體時比對當下時間，提醒教師這一節是哪一班的什麼課，並自動切換到該班級；之後只更新
// 頁首提示，不會在上課中自動切換班級。
(function () {
  const WEEKDAYS = [
    { key: 1, label: '週一' }, { key: 2, label: '週二' }, { key: 3, label: '週三' },
    { key: 4, label: '週四' }, { key: 5, label: '週五' },
  ];
  const DAY_NAMES = ['', '週一', '週二', '週三', '週四', '週五', '週六', '週日'];
  // 科目底色：依科目清單順序輪流取用，不在清單內的科目用灰色
  const PALETTE = [
    ['#fee2e2', '#b91c1c'], ['#dbeafe', '#1d4ed8'], ['#fef3c7', '#b45309'], ['#dcfce7', '#15803d'],
    ['#f3e8ff', '#7e22ce'], ['#cffafe', '#0e7490'], ['#ffe4e6', '#be123c'], ['#e0e7ff', '#4338ca'],
    ['#ecfccb', '#4d7c0f'], ['#ffedd5', '#c2410c'],
  ];

  const S = { loaded: false, role: '', homeCourseId: null, assignments: [], periods: [], subjects: [], entries: [], announced: false, draftCourse: '', draftSubject: '' };

  const $ = (id) => document.getElementById(id);
  const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const toast = (m, t) => (window.showToast ? window.showToast(m, t) : console.log(m));
  const courses = () => (window.AppState && window.AppState.courses) || [];
  const courseName = (id) => { const c = courses().find((x) => x.id === id); return c ? c.name : ''; };
  const toMin = (hm) => Number(hm.slice(0, 2)) * 60 + Number(hm.slice(3, 5));
  const entryAt = (weekday, periodId) => S.entries.find((e) => e.weekday === weekday && e.period_id === periodId);

  // 導師班（班級已被刪除時視為未設定）
  const homeId = () => (S.homeCourseId && courseName(S.homeCourseId) ? S.homeCourseId : null);
  // 目前身分下可用來排課的任教清單
  const myAssignments = () => S.assignments.filter((a) => (S.role === 'homeroom' ? a.course_id === homeId() : courseName(a.course_id)));

  function subjectColor(subject) {
    const i = S.subjects.findIndex((s) => s.name === subject);
    return i < 0 ? ['#f1f5f9', '#475569'] : PALETTE[i % PALETTE.length];
  }

  function lessonLabel(entry) {
    return [courseName(entry.course_id), entry.subject].filter(Boolean).join(' ') || entry.note || '（未命名）';
  }

  // ---------- 現在是哪一節 ----------

  function nowTaipei() {
    const parts = Object.fromEntries(
      new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Taipei', weekday: 'short', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' })
        .formatToParts(new Date()).map((p) => [p.type, p.value])
    );
    const weekday = { Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6, Sun: 7 }[parts.weekday];
    return { weekday, minutes: (Number(parts.hour) % 24) * 60 + Number(parts.minute) };
  }

  function lessonsOf(weekday) {
    return S.periods
      .map((period) => ({ period, entry: entryAt(weekday, period.id) }))
      .filter((l) => l.entry);
  }

  // now＝正在上課；next＝今天接下來的課（下課時間或空堂）；later＝今天沒課了，顯示下一個上課日的第一節
  function computeStatus() {
    const { weekday, minutes } = nowTaipei();
    const todays = lessonsOf(weekday);
    const cur = todays.find((l) => toMin(l.period.start_time) <= minutes && minutes < toMin(l.period.end_time));
    if (cur) return { kind: 'now', weekday, ...cur, minutesLeft: toMin(cur.period.end_time) - minutes };
    const next = todays.find((l) => toMin(l.period.start_time) > minutes);
    if (next) return { kind: 'next', weekday, ...next, minutesUntil: toMin(next.period.start_time) - minutes };
    for (let i = 1; i <= 7; i++) {
      const d = ((weekday - 1 + i) % 7) + 1;
      const ls = lessonsOf(d);
      if (ls.length) return { kind: 'later', weekday: d, dayLabel: i === 1 ? '明天' : DAY_NAMES[d], ...ls[0] };
    }
    return null;
  }

  function statusText(st) {
    const p = st.period;
    if (st.kind === 'now') return `${p.name} ${lessonLabel(st.entry)}`;
    if (st.kind === 'next') return `${p.start_time} ${p.name} ${lessonLabel(st.entry)}`;
    return `${st.dayLabel}${p.name} ${lessonLabel(st.entry)}`;
  }

  function statusHeadline(st) {
    const p = st.period;
    if (st.kind === 'now') return `現在是 ${p.name}（${p.start_time}–${p.end_time}），還有 ${st.minutesLeft} 分鐘下課`;
    if (st.kind === 'next') return `下一節是 ${p.name}（${p.start_time}–${p.end_time}），${st.minutesUntil} 分鐘後開始`;
    return `今天沒有課了。${st.dayLabel}第一堂是 ${p.name}（${p.start_time}–${p.end_time}）`;
  }

  // ---------- 頁首提示 ----------

  // 頁首提示前方使用課表圖示（static/pic/timetable.svg），不使用 emoji
  function setChipText(chip, text) {
    chip.innerHTML = '<img src="/static/pic/timetable.svg" alt="" style="width: 20px; height: 20px; vertical-align: -5px; margin-right: 6px;">';
    chip.appendChild(document.createTextNode(text));
  }

  function updateChip() {
    const chip = $('timetable-now-chip');
    if (!chip) return;
    if (!S.loaded || document.body.classList.contains('mobile-scoring-only')) { chip.style.display = 'none'; return; }
    chip.style.display = '';
    const st = computeStatus();
    if (!st) {
      setChipText(chip, '設定課表');
      chip.title = '尚未排課，點一下設定我的課表';
      chip.onclick = () => { if (typeof switchTab === 'function') switchTab('timetable'); };
      return;
    }
    setChipText(chip, statusText(st));
    chip.title = `${statusHeadline(st)}\n點一下切換到這一班；已在這一班時開啟課表`;
    // 點擊當下才判斷（教師可能已手動換過班級）
    chip.onclick = () => {
      const id = st.entry.course_id;
      if (st.kind !== 'later' && id && courseName(id) && id !== window.AppState.currentCourseId) switchCourse(id);
      else if (typeof switchTab === 'function') switchTab('timetable');
    };
  }

  function switchCourse(id) {
    const select = $('course-select');
    if (!select) return;
    select.value = String(id);
    select.dispatchEvent(new Event('change', { bubbles: true }));
  }

  // ---------- 開啟軟體時的提醒 ----------

  async function onAppReady() {
    if (S.announced) return;
    S.announced = true;
    try {
      await fetchData();
    } catch (err) {
      console.error('Timetable load error:', err);
      return;
    }
    updateChip();
    if (document.body.classList.contains('mobile-scoring-only')) return;
    const st = computeStatus();
    if (!st) return;

    // 上課中或今天還有課：自動切到那一班（網址已指定班級時不干預）
    const prevId = window.AppState.currentCourseId;
    const targetId = st.entry.course_id;
    const urlPinned = new URLSearchParams(window.location.search).has('course_id');
    let switchedFrom = null;
    if (st.kind !== 'later' && targetId && courseName(targetId) && targetId !== prevId && !urlPinned) {
      switchedFrom = prevId;
      switchCourse(targetId);
      updateChip();
    }
    showBanner(st, switchedFrom);
  }

  function showBanner(st, switchedFrom) {
    const [bg, fg] = subjectColor(st.entry.subject);
    const el = document.createElement('div');
    el.style.cssText = 'position:fixed;top:76px;left:50%;transform:translateX(-50%);z-index:9000;width:min(520px,calc(100% - 24px));background:var(--card-bg,#fff);color:var(--text-main,#1e293b);border:1.5px solid var(--primary);border-radius:16px;padding:14px 16px;box-shadow:0 16px 48px rgba(0,0,0,0.28);';
    el.innerHTML = `
      <div style="font-size: 0.85rem; font-weight: 700; color: var(--text-muted);">${esc(statusHeadline(st))}</div>
      <div style="display: flex; align-items: center; gap: 10px; flex-wrap: wrap; margin-top: 8px;">
        <span style="font-size: 1.35rem; font-weight: 900;">${esc(courseName(st.entry.course_id) || lessonLabel(st.entry))}</span>
        ${st.entry.subject && courseName(st.entry.course_id) ? `<span style="font-size: 1.1rem; font-weight: 900; padding: 3px 14px; border-radius: 9999px; background: ${bg}; color: ${fg};">${esc(st.entry.subject)}</span>` : ''}
        ${st.entry.note ? `<span style="font-size: 0.88rem; color: var(--text-muted); font-weight: 700;">📌 ${esc(st.entry.note)}</span>` : ''}
      </div>
      <div data-progress style="display: none; margin-top: 8px; font-size: 0.85rem; line-height: 1.5; border-left: 3px solid var(--primary); padding-left: 8px;"></div>
      ${switchedFrom ? `<div style="margin-top: 8px; font-size: 0.82rem; color: var(--text-muted);">已自動切換到這個班級。</div>` : ''}
      <div style="display: flex; gap: 8px; justify-content: flex-end; flex-wrap: wrap; margin-top: 12px;">
        ${switchedFrom ? `<button type="button" class="btn btn-secondary" data-back style="padding: 6px 12px; font-size: 0.85rem;">↩ 回到「${esc(courseName(switchedFrom))}」</button>` : ''}
        <button type="button" class="btn btn-secondary" data-open style="padding: 6px 12px; font-size: 0.85rem;">🗓️ 查看課表</button>
        <button type="button" class="btn" data-ok style="padding: 6px 18px; font-size: 0.85rem;">知道了</button>
      </div>`;
    document.body.appendChild(el);

    const timer = setTimeout(() => el.remove(), 20000);
    const close = () => { clearTimeout(timer); el.remove(); };
    el.querySelector('[data-ok]').addEventListener('click', close);
    el.querySelector('[data-open]').addEventListener('click', () => { close(); if (typeof switchTab === 'function') switchTab('timetable'); });
    const back = el.querySelector('[data-back]');
    if (back) back.addEventListener('click', () => { close(); switchCourse(switchedFrom); updateChip(); });

    // 附上這一班上次的教學進度（教學日誌的「進度」紀錄），沒有就不顯示
    if (st.entry.course_id && courseName(st.entry.course_id)) {
      API.get(`/api/journal/${st.entry.course_id}?tag=progress`).then((logs) => {
        const last = logs[0];
        const box = el.querySelector('[data-progress]');
        if (!last || !box) return;
        const where = [last.unit_title, last.sub_unit_title].filter(Boolean).join(' › ');
        box.innerHTML = `<b>上次進度（${esc(last.date)}）</b>${where ? `　${esc(where)}` : ''}<br>${esc(String(last.content).slice(0, 80))}`;
        box.style.display = 'block';
      }).catch(() => { /* 進度只是輔助資訊 */ });
    }
  }

  // ---------- 課表頁 ----------

  async function fetchData() {
    const data = await API.get('/api/timetable');
    S.role = data.role;
    S.homeCourseId = data.home_course_id;
    S.assignments = data.assignments;
    S.periods = data.periods;
    S.subjects = data.subjects;
    S.entries = data.entries;
    S.loaded = true;
  }

  async function load() {
    const root = $('timetable-root');
    if (!root) return;
    try {
      await fetchData();
      render();
      updateChip();
    } catch (err) {
      console.error('Timetable load error:', err);
      root.innerHTML = `<div class="glass-card" style="color: var(--accent-negative);">載入失敗：${esc(err.message)}</div>`;
    }
  }

  function render() {
    const root = $('timetable-root');
    if (!root) return;
    if (!$('tt-profile')) root.innerHTML = '<div id="tt-profile"></div><div id="tt-grid"></div>';
    renderProfile();
    renderGrid();
  }

  // ---------- 我的任教設定（身分、班級、科目） ----------

  function renderProfile() {
    const box = $('tt-profile');
    if (!box) return;
    const list = courses();
    const label = 'font-size: 0.85rem; font-weight: 800; white-space: nowrap;';
    const row = 'display: flex; gap: 8px; align-items: center; flex-wrap: wrap; margin-top: 12px;';
    let body = '<div style="margin-top: 12px; color: var(--text-muted); font-weight: 700;">請先選擇你這學期的身分，再設定任教的班級與科目。</div>';

    if (S.role === 'homeroom') {
      const home = homeId();
      const taught = new Set(myAssignments().map((a) => a.subject));
      body = `
        <div style="${row}">
          <span style="${label}">我的班級</span>
          <select id="tt-home" class="input-control" style="width: auto; min-width: 160px;">
            <option value="">（請選擇）</option>
            ${list.map((c) => `<option value="${c.id}" ${c.id === home ? 'selected' : ''}>${esc(c.name)}</option>`).join('')}
          </select>
          <button type="button" id="tt-new-class" class="btn btn-secondary" style="font-size: 0.85rem; padding: 6px 12px;">➕ 建立班級</button>
        </div>
        <div style="${row}">
          <span style="${label}">我教的科目</span>
          ${home ? S.subjects.map((s) => `<button type="button" class="btn ${taught.has(s.name) ? '' : 'btn-secondary'}" data-teach="${esc(s.name)}" style="padding: 6px 14px; font-weight: 800;">${taught.has(s.name) ? '✓ ' : ''}${esc(s.name)}</button>`).join('') : '<span style="color: var(--text-muted);">請先選擇或建立班級</span>'}
          ${home ? '<button type="button" id="tt-teach-other" class="btn btn-secondary" style="padding: 6px 12px; font-size: 0.85rem;">➕ 其他科目</button>' : ''}
        </div>
        <div style="margin-top: 8px; font-size: 0.8rem; color: var(--text-muted);">點選你自己授課的科目（可複選）。排課時只會列出這些科目；科任老師上的課可在排課時手動輸入。</div>`;
    } else if (S.role === 'subject') {
      const mine = myAssignments();
      body = `
        <div style="${row}">
          <span style="${label}">任教清單</span>
          ${mine.length ? mine.map((a) => {
            const [bg, fg] = subjectColor(a.subject);
            return `<span style="display: inline-flex; align-items: center; gap: 6px; background: ${bg}; color: ${fg}; font-weight: 800; padding: 5px 6px 5px 14px; border-radius: 9999px;">${esc(courseName(a.course_id))} ${esc(a.subject)}<button type="button" data-unassign="${a.id}" title="移除" style="border: none; background: rgba(0,0,0,0.08); color: inherit; border-radius: 50%; width: 22px; height: 22px; cursor: pointer; font-weight: 900;">×</button></span>`;
          }).join('') : '<span style="color: var(--text-muted);">尚未加入任何任教班級與科目</span>'}
        </div>
        <div style="${row}">
          <span style="${label}">新增</span>
          <select id="tt-as-course" class="input-control" style="width: auto; min-width: 150px;">
            <option value="">選擇班級</option>
            ${list.map((c) => `<option value="${c.id}" ${String(c.id) === S.draftCourse ? 'selected' : ''}>${esc(c.name)}</option>`).join('')}
            <option value="new">＋ 建立新班級…</option>
          </select>
          <select id="tt-as-subject" class="input-control" style="width: auto; min-width: 130px;">
            <option value="">選擇科目</option>
            ${S.subjects.map((s) => `<option value="${esc(s.name)}" ${s.name === S.draftSubject ? 'selected' : ''}>${esc(s.name)}</option>`).join('')}
            <option value="__other">＋ 其他科目…</option>
          </select>
          <button type="button" id="tt-as-add" class="btn" style="padding: 6px 14px;">➕ 加入任教清單</button>
        </div>
        <div style="margin-top: 8px; font-size: 0.8rem; color: var(--text-muted);">例如：4年1班 自然、6年2班 自然、5年3班 科技。全部加入後，到下方課表點格子，直接從清單選取。</div>`;
    }

    box.innerHTML = `
      <div class="glass-card" style="margin-bottom: 16px;">
        <div class="glass-card-header" style="flex-wrap: wrap; gap: 10px;">
          <div>
            <div class="glass-card-title">👩‍🏫 我的任教設定</div>
            <div style="font-size: 0.85rem; color: var(--text-muted); margin-top: 4px;">課表是老師自己的課表：先設定身分與任教的班級、科目，再到下方排課。</div>
          </div>
          <div style="display: inline-flex; gap: 4px; background: rgba(0,0,0,0.05); padding: 3px; border-radius: 10px;">
            <button type="button" class="btn ${S.role === 'homeroom' ? '' : 'btn-secondary'}" data-role="homeroom" style="padding: 7px 16px; font-weight: 800;">🏫 我是導師</button>
            <button type="button" class="btn ${S.role === 'subject' ? '' : 'btn-secondary'}" data-role="subject" style="padding: 7px 16px; font-weight: 800;">🎨 我是科任</button>
          </div>
        </div>
        ${body}
      </div>`;

    box.querySelectorAll('[data-role]').forEach((b) =>
      b.addEventListener('click', async () => {
        if (b.dataset.role === S.role) return;
        try {
          await API.put('/api/timetable/profile', { role: b.dataset.role });
          S.role = b.dataset.role;
          // 導師只有一個班：系統裡剛好只有一個班級時直接帶入
          if (S.role === 'homeroom' && !homeId() && courses().length === 1) await setHome(courses()[0].id);
          render();
        } catch (err) {
          toast(`儲存失敗：${err.message}`, 'error');
        }
      })
    );

    const home = $('tt-home');
    if (home) {
      home.addEventListener('change', async () => { await setHome(Number(home.value) || null); render(); });
      $('tt-new-class').addEventListener('click', async () => {
        const id = await createCourse();
        // 建立班級會觸發整頁重新載入課表，這裡等設定寫入後再讀一次，確保畫面是最新狀態
        if (id) { await setHome(id); await fetchData(); render(); }
      });
      box.querySelectorAll('[data-teach]').forEach((b) =>
        b.addEventListener('click', async () => {
          const existing = myAssignments().find((a) => a.subject === b.dataset.teach);
          if (existing) await unassign(existing.id); else await assign(homeId(), b.dataset.teach);
          render();
        })
      );
      const other = $('tt-teach-other');
      if (other) other.addEventListener('click', async () => {
        const name = (window.prompt('請輸入科目名稱（例如：綜合、健康、體育）') || '').trim();
        if (name) { await assign(homeId(), name); render(); }
      });
    }

    const asCourse = $('tt-as-course');
    if (asCourse) {
      const asSubject = $('tt-as-subject');
      asCourse.addEventListener('change', async () => {
        if (asCourse.value === 'new') {
          const id = await createCourse();
          S.draftCourse = id ? String(id) : '';
          renderProfile();
        } else {
          S.draftCourse = asCourse.value;
        }
      });
      asSubject.addEventListener('change', async () => {
        if (asSubject.value === '__other') {
          const name = (window.prompt('請輸入科目名稱（例如：綜合、健康、體育）') || '').trim().slice(0, 20);
          if (name) {
            try {
              const created = await API.post('/api/timetable/subjects', { name });
              if (!S.subjects.some((s) => s.id === created.id)) S.subjects.push(created);
            } catch (err) {
              toast(`新增失敗：${err.message}`, 'error');
            }
          }
          S.draftSubject = name;
          renderProfile();
        } else {
          S.draftSubject = asSubject.value;
        }
      });
      $('tt-as-add').addEventListener('click', async () => {
        if (!S.draftCourse || !S.draftSubject) { toast('請選擇班級與科目', 'error'); return; }
        if (await assign(Number(S.draftCourse), S.draftSubject)) {
          // 保留班級，方便同一班連續加入多個科目
          S.draftSubject = '';
          render();
        }
      });
      box.querySelectorAll('[data-unassign]').forEach((b) =>
        b.addEventListener('click', async () => { await unassign(Number(b.dataset.unassign)); render(); })
      );
    }
  }

  async function setHome(id) {
    try {
      await API.put('/api/timetable/profile', { home_course_id: id });
      S.homeCourseId = id;
    } catch (err) {
      toast(`儲存失敗：${err.message}`, 'error');
    }
  }

  async function assign(courseId, subject) {
    try {
      const res = await API.post('/api/timetable/assignments', { course_id: courseId, subject });
      if (!S.assignments.some((a) => a.id === res.assignment.id)) S.assignments.push(res.assignment);
      S.subjects = res.subjects;
      return true;
    } catch (err) {
      toast(`儲存失敗：${err.message}`, 'error');
      return false;
    }
  }

  async function unassign(id) {
    try {
      await API.delete(`/api/timetable/assignments/${id}`);
      S.assignments = S.assignments.filter((a) => a.id !== id);
    } catch (err) {
      toast(`移除失敗：${err.message}`, 'error');
    }
  }

  // 在課表設定中直接建立班級（只需名稱，名冊之後再到「學生名冊管理」匯入）
  async function createCourse() {
    const name = (window.prompt('請輸入班級名稱（例如：5年1班）') || '').trim();
    if (!name) return null;
    try {
      const res = await API.post('/api/courses', { name, teacher_type: S.role || 'homeroom' });
      if (typeof loadCourses === 'function') await loadCourses();
      toast(`已建立班級「${name}」，學生名冊可稍後再匯入`, 'success');
      return res.id;
    } catch (err) {
      toast(`建立班級失敗：${err.message}`, 'error');
      return null;
    }
  }

  // ---------- 課表 ----------

  function renderGrid() {
    const root = $('tt-grid');
    if (!root) return;
    const { weekday, minutes } = nowTaipei();
    const st = computeStatus();
    const showClass = S.role === 'subject' || (S.role !== 'homeroom' && courses().length > 1);
    const emptyHint = !S.role ? '請先在上方選擇身分，並設定任教的班級與科目。'
      : !myAssignments().length ? '請先在上方設定任教的班級與科目，再點下方格子排課。'
      : '課表還是空的，點下方任一格開始排課。';

    const cell = (day, period) => {
      const e = entryAt(day.key, period.id);
      const isNow = day.key === weekday && toMin(period.start_time) <= minutes && minutes < toMin(period.end_time);
      const base = `cursor: pointer; padding: 6px; vertical-align: middle; height: 62px; border: 1px solid var(--card-border, #e2e8f0); ${day.key === weekday ? 'background: rgba(59,130,246,0.05);' : ''} ${isNow ? 'outline: 2.5px solid var(--primary); outline-offset: -2px;' : ''}`;
      if (!e) return `<td class="tt-cell" data-day="${day.key}" data-period="${period.id}" style="${base} text-align: center; color: #cbd5e1; font-size: 1.1rem;" title="點一下排課">＋</td>`;
      const [bg, fg] = subjectColor(e.subject);
      const cn = courseName(e.course_id);
      return `<td class="tt-cell" data-day="${day.key}" data-period="${period.id}" style="${base}">
        <div style="background: ${bg}; color: ${fg}; border-radius: 8px; padding: 5px 8px; min-height: 50px; box-sizing: border-box; display: flex; flex-direction: column; align-items: center; justify-content: center; text-align: center;">
          <div style="font-weight: 900; font-size: 0.98rem;">${esc(e.subject || cn || e.note)}</div>
          ${e.subject && cn && showClass ? `<div style="font-size: 0.78rem; font-weight: 700;">${esc(cn)}</div>` : ''}
          ${e.note && (e.subject || cn) ? `<div style="font-size: 0.74rem; opacity: 0.85;">📌 ${esc(e.note)}</div>` : ''}
        </div>
      </td>`;
    };

    root.innerHTML = `
      <div class="glass-card">
        <div class="glass-card-header" style="flex-wrap: wrap; gap: 10px;">
          <div>
            <div class="glass-card-title">🗓️ 每週課表</div>
            <div style="font-size: 0.85rem; color: var(--text-muted); margin-top: 4px;">點任一格，從任教清單選取。開啟系統時會依課表提醒這一節是哪一班的什麼課，並自動切換到該班級。</div>
          </div>
          <div style="display: flex; gap: 8px; flex-wrap: wrap;">
            <button type="button" id="tt-btn-periods" class="btn btn-secondary" style="font-size: 0.85rem; padding: 6px 12px;">⏰ 作息時間設定</button>
            <button type="button" id="tt-btn-subjects" class="btn btn-secondary" style="font-size: 0.85rem; padding: 6px 12px;">📚 科目管理</button>
          </div>
        </div>

        <div style="padding: 10px 14px; border-radius: 12px; margin-bottom: 14px; font-weight: 800; ${st ? 'background: rgba(59,130,246,0.08); border: 1px solid rgba(59,130,246,0.3); color: #1d4ed8;' : 'background: rgba(100,116,139,0.08); border: 1px dashed rgba(100,116,139,0.4); color: #64748b;'}">
          ${st ? `${esc(statusHeadline(st))}：${esc(lessonLabel(st.entry))}${st.entry.note && (st.entry.subject || courseName(st.entry.course_id)) ? `（${esc(st.entry.note)}）` : ''}` : emptyHint}
        </div>

        ${S.periods.length ? `<div style="overflow-x: auto;">
          <table style="width: 100%; min-width: 640px; border-collapse: collapse; table-layout: fixed;">
            <tr>
              <th style="width: 108px; padding: 8px 6px; border: 1px solid var(--card-border, #e2e8f0); font-size: 0.82rem; color: var(--text-muted);">節次</th>
              ${WEEKDAYS.map((d) => `<th style="padding: 8px 6px; border: 1px solid var(--card-border, #e2e8f0); ${d.key === weekday ? 'background: var(--primary); color: #fff;' : ''}">${d.label}${d.key === weekday ? '（今天）' : ''}</th>`).join('')}
            </tr>
            ${S.periods.map((p) => `<tr>
              <td style="padding: 6px; border: 1px solid var(--card-border, #e2e8f0); text-align: center;">
                <div style="font-weight: 900;">${esc(p.name)}</div>
                <div style="font-size: 0.74rem; color: var(--text-muted);">${esc(p.start_time)}–${esc(p.end_time)}</div>
              </td>
              ${WEEKDAYS.map((d) => cell(d, p)).join('')}
            </tr>`).join('')}
          </table>
        </div>` : '<div style="padding: 18px; color: var(--text-muted);">尚未設定任何節次，請先按「⏰ 作息時間設定」新增。</div>'}
      </div>`;

    $('tt-btn-periods').addEventListener('click', openPeriods);
    $('tt-btn-subjects').addEventListener('click', openSubjects);
    root.querySelectorAll('.tt-cell').forEach((td) =>
      td.addEventListener('click', () => openEditor(Number(td.dataset.day), Number(td.dataset.period)))
    );
  }

  function overlay(inner, onClose, width = 520) {
    const el = document.createElement('div');
    el.style.cssText = 'position:fixed;inset:0;z-index:9999;background:rgba(15,23,42,0.55);display:flex;align-items:center;justify-content:center;padding:14px;';
    el.innerHTML = `<div style="background: var(--card-bg, #fff); color: var(--text-main, #1e293b); border-radius: 18px; width: min(${width}px, 100%); max-height: 88vh; overflow-y: auto; padding: 18px 18px 14px; box-shadow: 0 20px 60px rgba(0,0,0,0.35);">${inner}</div>`;
    const close = () => { el.remove(); if (onClose) onClose(); };
    el.addEventListener('mousedown', (e) => { if (e.target === el) close(); });
    document.body.appendChild(el);
    return { el, close };
  }

  // ---------- 排課視窗 ----------

  function openEditor(weekday, periodId) {
    const period = S.periods.find((p) => p.id === periodId);
    if (!period) return;
    const cur = entryAt(weekday, periodId);
    const list = courses();
    const mine = myAssignments();
    const isHomeroom = S.role === 'homeroom' && homeId();
    // 導師：班級固定為導師班，只需選科目。科任：直接點「哪一班的什麼科目」，其他情況才展開手動選擇。
    const quickPick = !isHomeroom && mine.length > 0;
    const defaultCourse = cur ? cur.course_id
      : isHomeroom ? homeId()
      : quickPick ? null
      : (window.AppState.currentCourseId || (list[0] && list[0].id) || null);
    let subject = cur ? cur.subject : '';
    // 排課視窗的科目按鈕：導師只列自己教的科目（尚未勾選時列出全部）
    const subjectChoices = isHomeroom && mine.length ? mine.map((a) => a.subject) : S.subjects.map((s) => s.name);
    const isPreset = () => subjectChoices.includes(subject);
    const curInList = cur && mine.some((a) => a.course_id === cur.course_id && a.subject === cur.subject);

    const { el, close } = overlay(`
      <div style="font-size: 1.1rem; font-weight: 900; margin-bottom: 2px;">${DAY_NAMES[weekday]} ${esc(period.name)}</div>
      <div style="font-size: 0.85rem; color: var(--text-muted); margin-bottom: 14px;">${esc(period.start_time)}–${esc(period.end_time)}</div>

      ${quickPick ? `<label style="font-size: 0.85rem; font-weight: 800;">我的任教清單</label>
      <div id="tt-ed-mine" style="display: flex; gap: 6px; flex-wrap: wrap; margin: 6px 0 12px;"></div>` : ''}

      ${quickPick ? `<details ${cur && !curInList ? 'open' : ''} style="margin-bottom: 12px;"><summary style="cursor: pointer; font-size: 0.85rem; font-weight: 800; color: var(--text-muted);">其他（不在任教清單的班級或科目）</summary><div style="padding-top: 10px;">` : ''}
      <div style="${isHomeroom ? 'display: none;' : ''}">
        <label style="font-size: 0.85rem; font-weight: 800;">班級</label>
        <select id="tt-ed-course" class="input-control" style="width: 100%; margin: 4px 0 12px;">
          <option value="">（不指定班級）</option>
          ${list.map((c) => `<option value="${c.id}" ${c.id === defaultCourse ? 'selected' : ''}>${esc(c.name)}</option>`).join('')}
        </select>
      </div>

      <label style="font-size: 0.85rem; font-weight: 800;">科目</label>
      <div id="tt-ed-subjects" style="display: flex; gap: 6px; flex-wrap: wrap; margin: 6px 0 8px;"></div>
      <input type="text" id="tt-ed-custom" class="input-control" maxlength="20" placeholder="${isHomeroom ? '其他課程（例如科任老師上的：英語、體育、音樂）' : '手動輸入其他科目（例如：綜合、健康、體育）'}" value="${isPreset() ? '' : esc(subject)}" style="width: 100%; margin-bottom: 12px;">
      ${quickPick ? '</div></details>' : ''}

      <label style="font-size: 0.85rem; font-weight: 800;">備註（選填）</label>
      <input type="text" id="tt-ed-note" class="input-control" maxlength="40" placeholder="例如：自然教室、科任王老師" value="${esc(cur ? cur.note : '')}" style="width: 100%; margin: 4px 0 14px;">

      <div style="display: flex; justify-content: space-between; align-items: center; gap: 8px; flex-wrap: wrap;">
        ${cur ? '<button type="button" class="btn btn-secondary" data-clear style="padding: 6px 12px; color: var(--accent-negative); font-size: 0.85rem;">🗑️ 清除這一節</button>' : '<span></span>'}
        <div style="display: flex; gap: 8px;">
          <button type="button" class="btn btn-secondary" data-cancel style="padding: 6px 16px;">取消</button>
          <button type="button" class="btn" data-save style="padding: 6px 22px;">儲存</button>
        </div>
      </div>
    `);

    const custom = el.querySelector('#tt-ed-custom');
    const chips = el.querySelector('#tt-ed-subjects');
    const courseSel = el.querySelector('#tt-ed-course');
    const mineBox = el.querySelector('#tt-ed-mine');
    const drawChips = () => {
      if (mineBox) {
        mineBox.innerHTML = mine.map((a) => {
          const on = Number(courseSel.value) === a.course_id && subject === a.subject;
          return `<button type="button" class="btn ${on ? '' : 'btn-secondary'}" data-mine="${a.id}" style="padding: 9px 16px; font-weight: 800;">${esc(courseName(a.course_id))} ${esc(a.subject)}</button>`;
        }).join('');
        mineBox.querySelectorAll('[data-mine]').forEach((b) =>
          b.addEventListener('click', () => {
            const a = mine.find((x) => x.id === Number(b.dataset.mine));
            courseSel.value = String(a.course_id);
            subject = a.subject;
            custom.value = '';
            drawChips();
          })
        );
      }
      chips.innerHTML = subjectChoices.map((name) => `<button type="button" class="btn ${name === subject ? '' : 'btn-secondary'}" data-subject="${esc(name)}" style="padding: 7px 16px; font-weight: 800;">${esc(name)}</button>`).join('');
      chips.querySelectorAll('[data-subject]').forEach((b) =>
        b.addEventListener('click', () => {
          subject = subject === b.dataset.subject ? '' : b.dataset.subject;
          custom.value = '';
          drawChips();
        })
      );
    };
    drawChips();
    custom.addEventListener('input', () => { subject = custom.value.trim(); drawChips(); });
    courseSel.addEventListener('change', drawChips);

    const submit = async (payload) => {
      try {
        const res = await API.put('/api/timetable/entry', { weekday, period_id: periodId, ...payload });
        S.entries = S.entries.filter((e) => !(e.weekday === weekday && e.period_id === periodId));
        if (res.entry) S.entries.push(res.entry);
        S.subjects = res.subjects;
        close();
        render();
        updateChip();
      } catch (err) {
        toast(`儲存失敗：${err.message}`, 'error');
      }
    };

    el.querySelector('[data-cancel]').addEventListener('click', close);
    el.querySelector('[data-save]').addEventListener('click', () => {
      const courseId = Number(el.querySelector('#tt-ed-course').value) || null;
      const note = el.querySelector('#tt-ed-note').value.trim();
      if (!subject && !note) { toast('請選擇或輸入科目', 'error'); return; }
      submit({ course_id: courseId, subject, note });
    });
    custom.addEventListener('keydown', (e) => { if (e.key === 'Enter') el.querySelector('[data-save]').click(); });
    const clearBtn = el.querySelector('[data-clear]');
    if (clearBtn) clearBtn.addEventListener('click', () => submit({ course_id: null, subject: '', note: '' }));
  }

  // ---------- 作息時間設定 ----------

  function openPeriods() {
    const { el, close } = overlay('<div id="tt-pd-body"></div>', () => load(), 600);
    const body = el.querySelector('#tt-pd-body');
    const grid = 'display: grid; grid-template-columns: minmax(120px, 1fr) 154px 154px 44px; gap: 10px; align-items: center;';

    // 時間以「時」「分」兩個下拉選單選擇（24 小時制、每 5 分鐘一格），比瀏覽器內建的時間欄位好點選
    const pad = (n) => String(n).padStart(2, '0');
    const fromMin = (m) => `${pad(Math.floor(m / 60))}:${pad(m % 60)}`;
    const selStyle = 'width: 68px; padding: 8px 4px; text-align: center; font-weight: 700;';
    const timePick = (value, attrs) => {
      const [h, m] = value.split(':');
      const mins = [];
      for (let i = 0; i < 60; i += 5) mins.push(pad(i));
      if (!mins.includes(m)) mins.push(m);
      mins.sort();
      return `<span class="tt-time" ${attrs} style="display: inline-flex; align-items: center; gap: 3px; white-space: nowrap;">
        <select class="input-control" data-h style="${selStyle}">${Array.from({ length: 24 }, (_, i) => pad(i)).map((x) => `<option ${x === h ? 'selected' : ''}>${x}</option>`).join('')}</select>
        <b>:</b>
        <select class="input-control" data-m style="${selStyle}">${mins.map((x) => `<option ${x === m ? 'selected' : ''}>${x}</option>`).join('')}</select>
      </span>`;
    };
    const readTime = (wrap) => `${wrap.querySelector('[data-h]').value}:${wrap.querySelector('[data-m]').value}`;
    const writeTime = (wrap, value) => {
      const [h, m] = value.split(':');
      const ms = wrap.querySelector('[data-m]');
      if (![...ms.options].some((o) => o.value === m)) ms.add(new Option(m, m));
      wrap.querySelector('[data-h]').value = h;
      ms.value = m;
    };

    const draw = () => {
      // 新節次預設接在最後一節之後（下課 10 分鐘、上課 40 分鐘）
      const lastEnd = S.periods.length ? Math.max(...S.periods.map((p) => toMin(p.end_time))) : 8 * 60 + 30;
      const newStart = Math.min(lastEnd + 10, 23 * 60);
      const newEnd = Math.min(newStart + 40, 23 * 60 + 55);
      body.innerHTML = `
        <div style="font-size: 1.1rem; font-weight: 900; margin-bottom: 4px;">⏰ 作息時間設定</div>
        <div style="font-size: 0.82rem; color: var(--text-muted); margin-bottom: 12px; line-height: 1.5;">
          依學校作息調整每一節的起訖時間，修改後自動儲存。刪除節次會一併清除該節次已排的課。
        </div>
        <div style="${grid} font-size: 0.75rem; color: var(--text-muted); font-weight: 700; margin-bottom: 4px;"><span>節次名稱</span><span>開始</span><span>結束</span><span></span></div>
        ${S.periods.map((p) => `
          <div class="tt-pd-row" data-id="${p.id}" style="${grid} margin-bottom: 6px;">
            <input class="input-control" data-f="name" value="${esc(p.name)}" maxlength="20">
            ${timePick(p.start_time, 'data-t="start_time"')}
            ${timePick(p.end_time, 'data-t="end_time"')}
            <button type="button" class="btn btn-secondary" data-del title="刪除" style="padding: 5px 9px; color: var(--accent-negative);">🗑️</button>
          </div>`).join('')}
        <div style="border-top: 1px dashed var(--card-border, #cbd5e1); margin-top: 10px; padding-top: 10px; ${grid}">
          <input class="input-control" id="tt-pd-name" maxlength="20" placeholder="新節次名稱">
          ${timePick(fromMin(newStart), 'id="tt-pd-start"')}
          ${timePick(fromMin(newEnd), 'id="tt-pd-end"')}
          <button type="button" class="btn" id="tt-pd-add" style="padding: 6px 12px;">➕</button>
        </div>
        <div style="text-align: right; margin-top: 14px;"><button type="button" class="btn" id="tt-pd-done" style="padding: 7px 20px;">完成</button></div>`;

      body.querySelector('#tt-pd-done').addEventListener('click', close);

      body.querySelectorAll('.tt-pd-row').forEach((row) => {
        const id = Number(row.dataset.id);
        const startWrap = row.querySelector('[data-t="start_time"]');
        const endWrap = row.querySelector('[data-t="end_time"]');
        const savePeriod = async () => {
          try {
            const upd = await API.put(`/api/timetable/periods/${id}`, {
              name: row.querySelector('[data-f="name"]').value.trim(),
              start_time: readTime(startWrap),
              end_time: readTime(endWrap),
            });
            S.periods[S.periods.findIndex((p) => p.id === id)] = upd;
            toast('已儲存', 'success');
          } catch (err) {
            toast(`儲存失敗：${err.message}`, 'error');
            draw();
          }
        };
        row.querySelector('[data-f="name"]').addEventListener('change', savePeriod);
        endWrap.addEventListener('change', savePeriod);
        // 開始時間改到結束時間之後時，結束時間跟著後移（維持原本的上課長度），不必先改結束時間
        startWrap.addEventListener('change', () => {
          const p = S.periods.find((x) => x.id === id);
          const start = toMin(readTime(startWrap));
          if (start >= toMin(readTime(endWrap))) {
            writeTime(endWrap, fromMin(Math.min(start + toMin(p.end_time) - toMin(p.start_time), 23 * 60 + 59)));
          }
          savePeriod();
        });
        row.querySelector('[data-del]').addEventListener('click', async () => {
          const p = S.periods.find((x) => x.id === id);
          const used = S.entries.filter((e) => e.period_id === id).length;
          if (!confirm(`確定要刪除「${p.name}」嗎？${used ? `\n這個節次已排的 ${used} 堂課會一併清除。` : ''}`)) return;
          try {
            await API.delete(`/api/timetable/periods/${id}`);
            S.periods = S.periods.filter((x) => x.id !== id);
            S.entries = S.entries.filter((e) => e.period_id !== id);
            draw();
          } catch (err) {
            toast(`刪除失敗：${err.message}`, 'error');
          }
        });
      });

      body.querySelector('#tt-pd-add').addEventListener('click', async () => {
        try {
          const created = await API.post('/api/timetable/periods', {
            name: body.querySelector('#tt-pd-name').value.trim(),
            start_time: readTime(body.querySelector('#tt-pd-start')),
            end_time: readTime(body.querySelector('#tt-pd-end')),
          });
          S.periods.push(created);
          S.periods.sort((a, b) => a.start_time.localeCompare(b.start_time));
          draw();
        } catch (err) {
          toast(`新增失敗：${err.message}`, 'error');
        }
      });
    };
    draw();
  }

  // ---------- 科目管理 ----------

  function openSubjects() {
    const { el, close } = overlay('<div id="tt-sj-body"></div>', () => load(), 460);
    const body = el.querySelector('#tt-sj-body');

    const draw = () => {
      body.innerHTML = `
        <div style="font-size: 1.1rem; font-weight: 900; margin-bottom: 4px;">📚 科目管理</div>
        <div style="font-size: 0.82rem; color: var(--text-muted); margin-bottom: 12px; line-height: 1.5;">
          這裡的科目會出現在排課視窗的快速選單。刪除科目不會影響已排好的課表。
        </div>
        <div style="display: flex; gap: 8px; flex-wrap: wrap; margin-bottom: 14px;">
          ${S.subjects.map((s) => {
            const [bg, fg] = subjectColor(s.name);
            return `<span style="display: inline-flex; align-items: center; gap: 6px; background: ${bg}; color: ${fg}; font-weight: 800; padding: 5px 6px 5px 14px; border-radius: 9999px;">${esc(s.name)}<button type="button" data-del="${s.id}" title="刪除" style="border: none; background: rgba(0,0,0,0.08); color: inherit; border-radius: 50%; width: 22px; height: 22px; cursor: pointer; font-weight: 900;">×</button></span>`;
          }).join('') || '<span style="color: var(--text-muted);">尚無科目</span>'}
        </div>
        <div style="display: flex; gap: 6px;">
          <input class="input-control" id="tt-sj-name" maxlength="20" placeholder="新增科目（例如：綜合、健康、體育）" style="flex: 1;">
          <button type="button" class="btn" id="tt-sj-add" style="padding: 6px 14px;">➕ 新增</button>
        </div>
        <div style="text-align: right; margin-top: 14px;"><button type="button" class="btn" id="tt-sj-done" style="padding: 7px 20px;">完成</button></div>`;

      body.querySelector('#tt-sj-done').addEventListener('click', close);
      body.querySelectorAll('[data-del]').forEach((b) =>
        b.addEventListener('click', async () => {
          const id = Number(b.dataset.del);
          try {
            await API.delete(`/api/timetable/subjects/${id}`);
            S.subjects = S.subjects.filter((s) => s.id !== id);
            draw();
          } catch (err) {
            toast(`刪除失敗：${err.message}`, 'error');
          }
        })
      );
      const add = async () => {
        const name = body.querySelector('#tt-sj-name').value.trim();
        if (!name) { toast('請填寫科目名稱', 'error'); return; }
        try {
          const created = await API.post('/api/timetable/subjects', { name });
          if (!S.subjects.some((s) => s.id === created.id)) S.subjects.push(created);
          draw();
          body.querySelector('#tt-sj-name').focus();
        } catch (err) {
          toast(`新增失敗：${err.message}`, 'error');
        }
      };
      body.querySelector('#tt-sj-add').addEventListener('click', add);
      body.querySelector('#tt-sj-name').addEventListener('keydown', (e) => { if (e.key === 'Enter') add(); });
    };
    draw();
  }

  // 每 30 秒更新頁首提示；課表頁開著時一併更新「今天／這一節」的標示
  setInterval(() => {
    if (!S.loaded) return;
    updateChip();
    const pane = $('pane-timetable');
    if (pane && pane.classList.contains('active')) renderGrid();
  }, 30000);

  window.Timetable = { load, onAppReady };
})();
