// MyClass 教師手機專用頁（/mobile）
// 流程：登入（教師每日密碼）→ 選班級（卡片）→ 功能首頁 → 各功能
//   出缺席點名／快速加減分（+、−）／特殊表現紀錄／教學日誌／教學小工具（公布欄、計時、抽籤）
// 教學小工具會透過 WebSocket 通知同班級的教師電腦主畫面，電腦端自動切換到對應功能（見 app.js handleDesktopToolkitAction）。
// 介面語系：繁體中文／English（頁首按鈕切換，選擇記在這支手機的瀏覽器）。
(function () {
  'use strict';

  const TOKEN_KEY = 'auth_token';
  const DATE_KEY = 'auth_date';
  const LAST_COURSE_KEY = 'mobile_last_course';
  const LANG_KEY = 'app_lang'; // 與電腦端介面使用相同的鍵值（'zh-TW' | 'en'）
  // 手機發佈的佈告標題前綴（固定中文，與電腦端的佈告清單一致）
  const PHONE_POST_PREFIX = '手機公告';

  // ------------------------------------------------------------------ 多語系
  const DICT = {
    'zh-TW': {
      docTitle: 'MyClass 教師手機版',
      loading: '載入中…',
      back: '‹ 返回',
      switchClass: '換班',
      langBtn: 'EN',
      sessionExpired: '登入已逾期，請重新登入',
      opFailed: '操作失敗（{n}）',
      opFailedShort: '操作失敗',
      // 標題
      tCourses: '選擇班級', tAttendance: '出缺席點名', tScore: '快速加減分', tNotes: '特殊表現紀錄',
      tJournal: '教學日誌', tTools: '教學互動工具', tBulletin: '課堂公佈欄', tTimer: '計時', tDraw: '抽籤',
      // 登入
      loginTitle: '🔐 教師登入',
      loginHint: '請輸入教師密碼（密碼字頭＋今天月日，與電腦登入相同）。',
      password: '密碼', login: '登入', enterPw: '請輸入密碼', wrongPw: '密碼錯誤',
      // 班級
      noCourses: '目前沒有任何班級，請先在電腦上建立班級。',
      pickCourse: '請選擇要操作的班級',
      studentsCount: '{n} 位學生', lastUsed: '・上次使用',
      // 首頁
      fAttendance: '出缺席點名', fScore: '快速加減分', fNotes: '特殊表現紀錄', fJournal: '教學日誌', fTools: '教學互動工具',
      toolsSub: '課堂公佈欄・計時・抽籤（電腦畫面會同步切換）',
      // 點名
      attSummary: '{date}　未到／請假 <b>{n}</b> 人',
      attAll: '✅ 全班出席', attSave: '💾 儲存點名', attSaved: '已儲存點名',
      st_present: '出席', st_sick_leave: '病假', st_personal_leave: '事假', st_official_leave: '公假', st_bereavement_leave: '喪假', st_late: '遲到',
      seatNo: '{n} 號',
      // 加減分
      scoreHint: '點 ＋ 加 1 分、點 － 扣 1 分，每按一下就立即寫入該生的累計分數。卡片右上角是這次在手機上的增減。',
      scoreTotal: '累計 {n} 分',
      scorePlusAria: '{name} 加一分', scoreMinusAria: '{name} 扣一分',
      undoLast: '↩ 復原上一筆', undone: '已復原上一筆',
      // 紀錄
      student: '學生', pickStudent: '請選擇學生…', content: '內容',
      notePh: '例如：主動協助同學整理教室、發表很有條理…',
      mediaOpt: '照片／影片（選填）', saveNote: '💾 儲存紀錄', noteSaved: '已儲存特殊表現紀錄',
      secInClass: '🚀 課堂進行', secRoutine: '📋 班級經營',
      quickPhrases: '常用片語（點選帶入，可再補充文字）', camera: '📷 拍照／錄影', pickFile: '🖼️ 選擇檔案',
      noteFromScore: '紀錄特殊表現',
      needStudent: '請選擇學生', needContent: '請輸入內容或選擇照片／影片',
      // 日誌
      category: '分類',
      tag_general: '一般', tag_progress: '進度', tag_classroom: '班級經營', tag_material: '教材', tag_todo: '待辦',
      journalPh: '今天的教學進度、課堂狀況、待辦事項…', saveJournal: '💾 儲存日誌', journalSaved: '已儲存教學日誌',
      // 工具
      toolsHint: '開啟功能後，教師電腦的畫面會自動切換到同一個功能。',
      toolBulletin: '課堂公佈欄', toolTimer: '計時', toolDraw: '抽籤',
      announceText: '公告內容', announcePh: '輸入要顯示在電腦與大螢幕的公告…',
      announcePost: '📢 發佈到電腦與大螢幕', announceClear: '清除大螢幕上的公告',
      postsTitle: '已建立的佈告（點選要操作的佈告）',
      showOnPc: '📺 顯示在電腦', deletePost: '🗑️ 刪除所選佈告', deletePosts: '🗑️ 刪除所選 {n} 則佈告',
      selectAll: '全選', selectNone: '取消選取', selectedCount: '已選 {n} 則',
      showOneOnly: '一次只能顯示一則佈告，請只選取一則',
      confirmDeletePost: '確定要刪除佈告「{title}」嗎？此動作無法復原。',
      confirmDeletePosts: '確定要刪除所選的 {n} 則佈告嗎？\n\n{titles}\n\n此動作無法復原。',
      postDeleted: '已刪除佈告', postsDeleted: '已刪除 {n} 則佈告', selectPostFirst: '請先選擇佈告',
      needAnnounce: '請輸入公告內容', announced: '已發佈', announceTitlePrefix: '手機公告',
      countdown: '倒數時間', minutesN: '{n} 分鐘', customMin: '自訂（分鐘）', customPh: '例如 7',
      start: '▶ 開始', stop: '■ 停止',
      drawTarget: '抽籤對象', drawStudents: '👤 學生', drawGroups: '👥 小組', drawCount: '抽出人數',
      drawExclude: '排除已抽過的人', drawGo: '🎲 開始抽籤', drawReset: '🔄 重置抽籤池',
      drawWinner: '🎉 {n} 號 {name}',
      // 同步狀態
      syncOffline: '⚠️ 與伺服器的即時連線中斷，請重新整理頁面。',
      syncOkDesktop: '✅ 已同步到教師電腦', syncOkBoth: '✅ 已同步到教師電腦與大螢幕',
      syncProjOnly: '⚠️ 大螢幕已收到，但找不到開著這個班級的教師電腦畫面（請在電腦上開啟 MyClass 並選擇同一個班級）。',
      syncNone: '⚠️ 找不到開著這個班級的教師電腦畫面（請在電腦上開啟 MyClass 並選擇同一個班級）。',
      syncDetail: '：{what}',
      doAnnounced: '公告已發佈', doCleared: '已清除公告', doShown: '已在電腦顯示佈告',
      doTimerStarted: '{n} 分鐘倒數已開始', doTimerStopped: '倒數已停止',
      doDrawing: '電腦正在抽籤，結果會顯示在這裡', doPoolReset: '抽籤池已重置',
      drawLocal: '⚠️ 電腦沒有開著這個班級，已改由手機直接抽籤（結果不會記到電腦的抽籤池）。',
      noGroups: '這個班級還沒有建立小組', noStudents: '這個班級沒有學生',
      // 課表提醒
      ttNow: '現在是 {p}（{s}–{e}），還有 {m} 分鐘下課',
      ttNext: '下一節是 {p}（{s}–{e}），{m} 分鐘後開始',
      ttLater: '今天沒有課了。{d}第一堂是 {p}（{s}–{e}）',
      ttTomorrow: '明天', ttEnter: '進入{c}', ttOpenHome: '回到這班',
      ttDays: ['', '週一', '週二', '週三', '週四', '週五', '週六', '週日'],
    },
    en: {
      docTitle: 'MyClass Teacher Mobile',
      loading: 'Loading…',
      back: '‹ Back',
      switchClass: 'Switch',
      langBtn: '中文',
      sessionExpired: 'Session expired. Please log in again.',
      opFailed: 'Action failed ({n})',
      opFailedShort: 'Action failed',
      tCourses: 'Choose a class', tAttendance: 'Attendance', tScore: 'Quick scoring', tNotes: 'Student notes',
      tJournal: 'Lesson journal', tTools: 'Interactive tools', tBulletin: 'Bulletin board', tTimer: 'Timer', tDraw: 'Random draw',
      loginTitle: '🔐 Teacher login',
      loginHint: "Enter the teacher password (same as the computer login: password prefix + today's date).",
      password: 'Password', login: 'Log in', enterPw: 'Please enter the password', wrongPw: 'Wrong password',
      noCourses: 'No classes yet. Please create a class on the computer first.',
      pickCourse: 'Choose a class',
      studentsCount: '{n} students', lastUsed: ' · last used',
      fAttendance: 'Attendance', fScore: 'Quick scoring', fNotes: 'Student notes', fJournal: 'Lesson journal', fTools: 'Interactive tools',
      toolsSub: 'Bulletin · Timer · Draw (your computer screen follows)',
      attSummary: '{date}   Absent / on leave: <b>{n}</b>',
      attAll: '✅ All present', attSave: '💾 Save attendance', attSaved: 'Attendance saved',
      st_present: 'Present', st_sick_leave: 'Sick', st_personal_leave: 'Personal', st_official_leave: 'Official', st_bereavement_leave: 'Bereave.', st_late: 'Late',
      seatNo: 'No. {n}',
      scoreHint: 'Tap ＋ for +1 and － for −1. Every tap is written to the student’s total immediately. The badge at the top right is this phone’s change.',
      scoreTotal: 'Total {n}',
      scorePlusAria: '{name} +1 point', scoreMinusAria: '{name} −1 point',
      undoLast: '↩ Undo last', undone: 'Last change undone',
      student: 'Student', pickStudent: 'Choose a student…', content: 'Content',
      notePh: 'e.g. Helped tidy the classroom, presented very clearly…',
      mediaOpt: 'Photo / video (optional)', saveNote: '💾 Save note', noteSaved: 'Note saved',
      secInClass: '🚀 In class', secRoutine: '📋 Class management',
      quickPhrases: 'Common phrases (tap to insert, then add details)', camera: '📷 Take photo / video', pickFile: '🖼️ Choose file',
      noteFromScore: 'Record a note',
      needStudent: 'Please choose a student', needContent: 'Please enter text or choose a photo/video',
      category: 'Category',
      tag_general: 'General', tag_progress: 'Progress', tag_classroom: 'Classroom', tag_material: 'Materials', tag_todo: 'To-do',
      journalPh: "Today's lesson progress, classroom situation, to-dos…", saveJournal: '💾 Save journal', journalSaved: 'Journal saved',
      toolsHint: "Opening a tool makes your computer's screen switch to the same tool.",
      toolBulletin: 'Bulletin board', toolTimer: 'Timer', toolDraw: 'Random draw',
      announceText: 'Announcement', announcePh: 'Type an announcement to show on the computer and projector…',
      announcePost: '📢 Publish to computer & projector', announceClear: 'Clear projector announcement',
      postsTitle: 'Existing posts (tap one to select it)',
      showOnPc: '📺 Show on computer', deletePost: '🗑️ Delete selected post', deletePosts: '🗑️ Delete {n} selected posts',
      selectAll: 'Select all', selectNone: 'Clear selection', selectedCount: '{n} selected',
      showOneOnly: 'Only one post can be shown at a time. Please select just one.',
      confirmDeletePost: 'Delete the post "{title}"? This cannot be undone.',
      confirmDeletePosts: 'Delete the {n} selected posts?\n\n{titles}\n\nThis cannot be undone.',
      postDeleted: 'Post deleted', postsDeleted: '{n} posts deleted', selectPostFirst: 'Please select a post first',
      needAnnounce: 'Please enter an announcement', announced: 'Published', announceTitlePrefix: '手機公告',
      countdown: 'Countdown', minutesN: '{n} min', customMin: 'Custom (minutes)', customPh: 'e.g. 7',
      start: '▶ Start', stop: '■ Stop',
      drawTarget: 'Draw from', drawStudents: '👤 Students', drawGroups: '👥 Groups', drawCount: 'How many',
      drawExclude: 'Exclude already drawn', drawGo: '🎲 Draw', drawReset: '🔄 Reset draw pool',
      drawWinner: '🎉 No. {n} {name}',
      syncOffline: '⚠️ The live connection to the server was lost. Please reload the page.',
      syncOkDesktop: "✅ Synced to the teacher's computer", syncOkBoth: "✅ Synced to the teacher's computer and projector",
      syncProjOnly: "⚠️ The projector received it, but no computer screen has this class open (open MyClass on the computer and choose the same class).",
      syncNone: '⚠️ No computer screen has this class open (open MyClass on the computer and choose the same class).',
      syncDetail: ': {what}',
      doAnnounced: 'Announcement published', doCleared: 'Announcement cleared', doShown: 'Post shown on the computer',
      doTimerStarted: '{n}-minute countdown started', doTimerStopped: 'Countdown stopped',
      doDrawing: 'The computer is drawing; the result will appear here', doPoolReset: 'Draw pool reset',
      drawLocal: '⚠️ No computer has this class open, so the draw was done on the phone (it is not counted in the computer’s draw pool).',
      noGroups: 'This class has no groups yet', noStudents: 'This class has no students',
      // Timetable reminder
      ttNow: 'Now: {p} ({s}–{e}), {m} min left',
      ttNext: 'Next: {p} ({s}–{e}), starts in {m} min',
      ttLater: 'No more classes today. {d}: first is {p} ({s}–{e})',
      ttTomorrow: 'Tomorrow', ttEnter: 'Open {c}', ttOpenHome: 'Back to this class',
      ttDays: ['', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'],
    },
  };

  function initialLang() {
    try {
      const saved = localStorage.getItem(LANG_KEY);
      if (saved === 'en' || saved === 'zh-TW') return saved;
    } catch (_) { /* ignore */ }
    return 'zh-TW';
  }

  let lang = initialLang();

  function t(key, params) {
    const table = DICT[lang] || DICT['zh-TW'];
    let s = table[key] ?? DICT['zh-TW'][key] ?? key;
    if (params) s = s.replace(/\{(\w+)\}/g, (_, k) => (params[k] !== undefined ? params[k] : `{${k}}`));
    return s;
  }

  const isEn = () => lang === 'en';
  /** 英文介面優先顯示英文姓名（沒有就用中文姓名），與電腦端的規則一致。 */
  const nameOf = (s) => ((isEn() && s.english_name && String(s.english_name).trim()) ? String(s.english_name).trim() : s.name);
  const seatLabel = (n) => t('seatNo', { n });

  const S = {
    view: 'boot',        // boot | login | courses | home | attendance | score | notes | journal | tools | bulletin | timer | draw
    courses: [],
    course: null,        // { id, name, student_count }
    today: '',
    students: [],        // 目前班級的學生
    att: [],             // 點名：{ student_id, student_number, name, english_name, status }
    scoreDelta: {},      // student_id -> 本次手機操作累計
    totals: {},          // student_id -> 學生目前的累計分數（學期總計，來自伺服器）
    undoStack: [],       // 快速加減分的復原紀錄（undo_id）
    posts: [],
    selectedPosts: [],   // 佈告清單中被選取的佈告 id（可多選；多選時只能刪除，不能「顯示在電腦」）
    socket: null,
    ackWaiters: [],
    status: null,        // 小工具頁底部的同步狀態：{ kind, key, what } 或 { raw }
    statusKind: 'ok',
    drawWinners: null,   // { mode, winners }（切換語系時重新產生顯示文字）
    timerSecs: 180,
    drawMode: 'student',
    drawCount: 1,
    drawExclude: true,
    journalTag: 'general',
    notePick: '',
    notesFrom: 'home',   // 特殊表現紀錄的返回頁：home | score
    tt: null,            // 課表：{ periods, entries }；未載入或沒排課時為 null
  };

  const $ = (id) => document.getElementById(id);
  const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const app = () => $('app');

  // ------------------------------------------------------------------ 共用

  function toast(msg, isErr) {
    const el = $('toast');
    if (!el) return;
    el.textContent = msg;
    el.className = `toast show${isErr ? ' err' : ''}`;
    clearTimeout(toast.timer);
    toast.timer = setTimeout(() => { el.className = 'toast'; }, 2200);
  }

  function token() {
    try { return localStorage.getItem(TOKEN_KEY) || ''; } catch (_) { return ''; }
  }

  async function api(path, opts = {}) {
    const headers = { ...(opts.headers || {}) };
    const tk = token();
    if (tk) headers.Authorization = `Bearer ${tk}`;
    if (opts.json !== undefined) {
      headers['Content-Type'] = 'application/json';
      opts = { ...opts, body: JSON.stringify(opts.json), method: opts.method || 'POST' };
    }
    const res = await fetch(path, { ...opts, headers, credentials: 'same-origin' });
    if (res.status === 401) {
      go('login');
      throw new Error(t('sessionExpired'));
    }
    const body = await res.json().catch(() => ({}));
    // 伺服器回傳的錯誤訊息是繁體中文；英文介面改顯示通用訊息，避免整句混語言
    if (!res.ok) throw new Error(isEn() ? t('opFailed', { n: res.status }) : (body.detail || t('opFailed', { n: res.status })));
    return body;
  }

  function setHeader(show, title) {
    const top = $('top');
    if (!top) return;
    top.hidden = !show;
    $('topTitle').textContent = title || 'MyClass';
    $('btnSwitch').textContent = t('switchClass');
    $('btnBack').textContent = t('back');
    $('btnLang').textContent = t('langBtn');
    $('btnSwitch').style.display = S.course && S.view !== 'courses' ? '' : 'none';
    $('btnBack').style.display = S.view === 'courses' ? 'none' : '';
  }

  function go(view) {
    S.view = view;
    render();
    window.scrollTo(0, 0);
  }

  function applyDocLang() {
    if (document.documentElement) document.documentElement.lang = lang === 'en' ? 'en' : 'zh-Hant';
    document.title = t('docTitle');
  }

  function setLang(next) {
    if (next !== 'en' && next !== 'zh-TW') return;
    lang = next;
    try { localStorage.setItem(LANG_KEY, lang); } catch (_) { /* ignore */ }
    applyDocLang();
    // 同步狀態與抽籤結果是依語系產生的文字，重新組一次
    refreshStatusText();
    refreshDrawText();
    render();
  }

  // ------------------------------------------------------------------ 即時連線（教學小工具指令 / 回報）

  function connectSocket() {
    if (S.socket) { try { S.socket.close(); } catch (_) { /* ignore */ } S.socket = null; }
    if (!S.course || typeof io === 'undefined') return;
    const sock = io({ query: { course_id: S.course.id, token: token(), role: 'mobile' } });
    S.socket = sock;
    sock.on('server_event', (data) => {
      if (!data) return;
      if (data.event === 'toolkit_ack') {
        const i = S.ackWaiters.findIndex((w) => w.action === data.action);
        if (i >= 0) S.ackWaiters.splice(i, 1)[0].resolve(data.receivers || {});
      } else if (data.event === 'toolkit_action' && data.action === 'draw') {
        showDrawResult(data.payload || {});
      } else if (data.event === 'score_updated') {
        scheduleTotalsRefresh();
      } else if (data.event === 'bulletin_updated') {
        scheduleBulletinRefresh();
      }
    });
  }

  /** 送出工具箱指令，並等待伺服器回報「送達了哪些畫面」（最多 2 秒）。 */
  function sendAction(action, payload) {
    return new Promise((resolve) => {
      if (!S.socket) { resolve({ desktop: 0, projection: 0, mobile: 0, offline: true }); return; }
      const waiter = { action, resolve };
      S.ackWaiters.push(waiter);
      S.socket.emit('toolkit_action', { action, payload: payload || {} });
      setTimeout(() => {
        const i = S.ackWaiters.indexOf(waiter);
        if (i >= 0) { S.ackWaiters.splice(i, 1); resolve({ desktop: 0, projection: 0, mobile: 0, timeout: true }); }
      }, 2000);
    });
  }

  /** 同步狀態以「代碼」保存，顯示時才依目前語系轉成文字，切換語系後仍然正確。 */
  function statusText() {
    const st = S.status;
    if (!st) return '';
    if (st.raw) return t(st.raw);
    const what = st.what ? t('syncDetail', { what: st.whatText ? st.whatText() : st.what }) : '';
    return t(st.key) + (st.key.startsWith('syncOk') ? what : '');
  }

  function paintStatus() {
    const el = $('syncStatus');
    if (!el) return;
    const text = statusText();
    el.textContent = text;
    el.className = `status ${S.statusKind}`;
    el.style.display = text ? '' : 'none';
  }

  function refreshStatusText() { paintStatus(); }

  function reportSync(r, what) {
    // what 為「語系字典鍵」或 { key, params }，顯示時才翻譯
    const whatText = what ? () => (typeof what === 'string' ? t(what) : t(what.key, what.params)) : null;
    if (r.offline || r.timeout) {
      S.status = { key: 'syncOffline' };
      S.statusKind = 'warn';
    } else if (r.desktop > 0) {
      S.status = { key: r.projection > 0 ? 'syncOkBoth' : 'syncOkDesktop', what: !!what, whatText };
      S.statusKind = 'ok';
    } else if (r.projection > 0) {
      S.status = { key: 'syncProjOnly' };
      S.statusKind = 'warn';
    } else {
      S.status = { key: 'syncNone' };
      S.statusKind = 'warn';
    }
    paintStatus();
  }

  // ------------------------------------------------------------------ 資料載入

  async function loadCourses() {
    S.courses = await api('/api/courses');
  }

  async function loadStudents() {
    S.students = await api(`/api/courses/${S.course.id}/students`);
  }

  /** 快速加減分用：同時取得學生與「學期累計」分數（伺服器上已寫入的總分）。 */
  async function loadScoreboard() {
    const d = await api(`/api/reports/${S.course.id}/dashboard?period=semester`);
    S.students = d.students.map((s) => ({ id: s.id, student_number: s.student_number, name: s.name, english_name: s.english_name, gender: s.gender }));
    S.totals = {};
    d.students.forEach((s) => { S.totals[s.id] = Number(s.score) || 0; });
  }

  function refreshTotal(id) {
    const el = $(`total-${id}`);
    if (el) el.textContent = String(S.totals[id] || 0);
  }

  // 其他裝置（電腦、另一支手機）或這支手機的寫入完成後，伺服器會廣播 score_updated；
  // 稍等一下再重新讀取累計分數，讓畫面和資料庫一致。
  let totalsTimer = null;
  function scheduleTotalsRefresh() {
    if (S.view !== 'score' || !S.course) return;
    clearTimeout(totalsTimer);
    totalsTimer = setTimeout(async () => {
      try {
        const d = await api(`/api/reports/${S.course.id}/dashboard?period=semester`);
        d.students.forEach((s) => { S.totals[s.id] = Number(s.score) || 0; refreshTotal(s.id); });
      } catch (_) { /* 下次再同步 */ }
    }, 700);
  }

  // 佈告清單即時同步：電腦或其他手機新增、刪除、改名佈告時，伺服器廣播 bulletin_updated。
  let bulletinTimer = null;
  function scheduleBulletinRefresh() {
    if (!S.course) return;
    clearTimeout(bulletinTimer);
    bulletinTimer = setTimeout(async () => {
      try {
        S.posts = await api(`/api/bulletin/${S.course.id}`);
        paintPosts();
      } catch (_) { /* 下次再同步 */ }
    }, 250);
  }

  function postsHtml() {
    if (!S.posts.length) return '';
    // 選取的佈告已被別處刪除時，自動從選取中移除
    S.selectedPosts = S.selectedPosts.filter((id) => S.posts.some((p) => p.id === id));
    const n = S.selectedPosts.length;
    const sel = new Set(S.selectedPosts);
    return `
      <h2 class="section">${esc(t('postsTitle'))}</h2>
      <div class="row" style="justify-content:space-between; margin-bottom:8px;">
        <div class="hint" style="margin:0;">${n ? esc(t('selectedCount', { n })) : ''}</div>
        <div class="chips">
          <button type="button" class="chip" data-act="bulletin-select-all">${esc(t('selectAll'))}</button>
          <button type="button" class="chip" data-act="bulletin-select-none" ${n ? '' : 'disabled'}>${esc(t('selectNone'))}</button>
        </div>
      </div>
      <div class="chips">${S.posts.map((p) => `<button type="button" class="chip ${sel.has(p.id) ? 'on' : ''}" data-act="bulletin-select" data-id="${p.id}">${esc(p.title)}</button>`).join('')}</div>
      <div class="row" style="margin-top:12px;">
        <!-- 防呆：多選時「顯示在電腦」停用（一次只能顯示一則），只能刪除 -->
        <button type="button" class="btn" style="flex:1;" data-act="bulletin-show-selected" ${n === 1 ? '' : 'disabled'}>${esc(t('showOnPc'))}</button>
        <button type="button" class="btn bad" style="flex:1;" data-act="bulletin-delete" ${n >= 1 ? '' : 'disabled'}>${esc(n > 1 ? t('deletePosts', { n }) : t('deletePost'))}</button>
      </div>
      ${n > 1 ? `<div class="hint">${esc(t('showOneOnly'))}</div>` : ''}`;
  }

  /** 只更新佈告清單區塊，不動上方的輸入框（避免打到一半的公告被清掉）。 */
  function paintPosts() {
    const box = $('postsBox');
    if (box) box.innerHTML = postsHtml();
  }

  async function loadAttendance() {
    const d = await api(`/api/attendance/${S.course.id}?date=${S.today}`);
    S.att = d.records.map((r) => ({
      student_id: r.student_id,
      student_number: r.student_number,
      name: r.name,
      english_name: r.english_name,
      status: r.status === 'absent' ? 'sick_leave' : r.status,
    }));
  }

  // ------------------------------------------------------------------ 課表提醒
  // 與電腦版（static/js/timetable.js）相同的判斷：以台北時間比對目前星期與時間。

  async function loadTimetable() {
    try {
      const d = await api('/api/timetable');
      S.tt = d.entries.length ? { periods: d.periods, entries: d.entries } : null;
    } catch (_) { S.tt = null; /* 課表只是輔助資訊 */ }
  }

  function ttStatus() {
    if (!S.tt) return null;
    const parts = Object.fromEntries(
      new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Taipei', weekday: 'short', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' })
        .formatToParts(new Date()).map((p) => [p.type, p.value])
    );
    const weekday = { Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6, Sun: 7 }[parts.weekday];
    const minutes = (Number(parts.hour) % 24) * 60 + Number(parts.minute);
    const toMin = (hm) => Number(hm.slice(0, 2)) * 60 + Number(hm.slice(3, 5));
    const lessonsOf = (wd) => S.tt.periods
      .map((period) => ({ period, entry: S.tt.entries.find((e) => e.weekday === wd && e.period_id === period.id) }))
      .filter((l) => l.entry);
    const todays = lessonsOf(weekday);
    const cur = todays.find((l) => toMin(l.period.start_time) <= minutes && minutes < toMin(l.period.end_time));
    if (cur) return { kind: 'now', ...cur, m: toMin(cur.period.end_time) - minutes };
    const next = todays.find((l) => toMin(l.period.start_time) > minutes);
    if (next) return { kind: 'next', ...next, m: toMin(next.period.start_time) - minutes };
    for (let i = 1; i <= 7; i++) {
      const d = ((weekday - 1 + i) % 7) + 1;
      const ls = lessonsOf(d);
      if (ls.length) return { kind: 'later', ...ls[0], day: i === 1 ? t('ttTomorrow') : t('ttDays')[d] };
    }
    return null;
  }

  /** 課表提醒卡：現在（或下一節）是哪一班的什麼課；班級還在時附「進入」按鈕。 */
  function timetableCardHtml() {
    const st = ttStatus();
    if (!st) return '';
    const p = st.period;
    const base = { p: p.name, s: p.start_time, e: p.end_time, m: st.m, d: st.day };
    const headline = t(st.kind === 'now' ? 'ttNow' : st.kind === 'next' ? 'ttNext' : 'ttLater', base);
    const course = S.courses.find((c) => c.id === st.entry.course_id);
    const title = [course ? course.name : '', st.entry.subject].filter(Boolean).join(' ') || st.entry.note || '';
    const canEnter = course && st.kind !== 'later' && !(S.view === 'home' && S.course && S.course.id === course.id);
    return `
      <div class="panel" style="margin-bottom:14px; border:1.5px solid var(--primary, #4f46e5);">
        <div class="hint" style="margin:0 0 6px; font-weight:700;">🗓️ ${esc(headline)}</div>
        <div style="font-size:1.25rem; font-weight:900;">${esc(title)}</div>
        ${st.entry.note && title !== st.entry.note ? `<div class="hint" style="margin-top:4px;">📌 ${esc(st.entry.note)}</div>` : ''}
        ${canEnter ? `<div class="spacer"></div><button type="button" class="btn block" data-act="pick-course" data-id="${course.id}">${esc(t('ttEnter', { c: course.name }))}</button>` : ''}
      </div>`;
  }

  // ------------------------------------------------------------------ 畫面

  function render() {
    const root = app();
    if (!root) return;
    const course = S.course;
    switch (S.view) {
      case 'login': setHeader(false); root.innerHTML = loginHtml(); break;
      case 'courses': setHeader(true, t('tCourses')); root.innerHTML = coursesHtml(); break;
      case 'home': setHeader(true, course ? course.name : ''); root.innerHTML = homeHtml(); break;
      case 'attendance': setHeader(true, t('tAttendance')); root.innerHTML = attendanceHtml(); break;
      case 'score': setHeader(true, t('tScore')); root.innerHTML = scoreHtml(); break;
      case 'notes': setHeader(true, t('tNotes')); root.innerHTML = notesHtml(); break;
      case 'journal': setHeader(true, t('tJournal')); root.innerHTML = journalHtml(); break;
      case 'tools': setHeader(true, t('tTools')); root.innerHTML = toolsHtml(); break;
      case 'bulletin': setHeader(true, t('tBulletin')); root.innerHTML = bulletinHtml(); paintStatus(); break;
      case 'timer': setHeader(true, t('tTimer')); root.innerHTML = timerHtml(); paintStatus(); break;
      case 'draw': setHeader(true, t('tDraw')); root.innerHTML = drawHtml(); paintStatus(); break;
      default: setHeader(false); root.innerHTML = `<div class="center hint" style="padding:40px 0;">${esc(t('loading'))}</div>`;
    }
  }

  function loginHtml() {
    return `
      <div class="row" style="justify-content:flex-end; margin-top:10px;"><button type="button" class="chip" data-act="lang">🌐 ${esc(t('langBtn'))}</button></div>
      <div class="panel" style="margin-top:14px;">
        <h2 class="section">${esc(t('loginTitle'))}</h2>
        <p class="hint">${esc(t('loginHint'))}</p>
        <label class="field" for="pw">${esc(t('password'))}</label>
        <input class="txt" id="pw" type="password" autocomplete="current-password" inputmode="text">
        <div class="spacer"></div>
        <button type="button" class="btn block" data-act="login">${esc(t('login'))}</button>
      </div>`;
  }

  function coursesHtml() {
    if (!S.courses.length) return `<div class="panel center">${esc(t('noCourses'))}</div>`;
    const last = Number(localStorage.getItem(LAST_COURSE_KEY));
    return `
      ${timetableCardHtml()}
      <p class="hint">${esc(t('pickCourse'))}</p>
      <div class="grid">
        ${S.courses.map((c) => `
          <button type="button" class="card-btn ${c.id === last ? 'last' : ''}" data-act="pick-course" data-id="${c.id}">
            <span class="ico">🏫</span>
            <span>${esc(c.name)}</span>
            <span class="sub">${esc(t('studentsCount', { n: c.student_count }))}${c.id === last ? esc(t('lastUsed')) : ''}</span>
          </button>`).join('')}
      </div>`;
  }

  function homeHtml() {
    return `
      ${timetableCardHtml()}
      <h2 class="section">${esc(t('secInClass'))}</h2>
      <div class="grid">
        <button type="button" class="card-btn" data-act="open" data-view="score"><span class="ico">⭐</span><span>${esc(t('fScore'))}</span></button>
        <button type="button" class="card-btn" data-act="open" data-view="notes"><span class="ico">📝</span><span>${esc(t('fNotes'))}</span></button>
        <button type="button" class="card-btn wide" data-act="open" data-view="tools"><span class="ico">🧰</span><span>${esc(t('fTools'))}</span><span class="sub">${esc(t('toolsSub'))}</span></button>
      </div>
      <h2 class="section" style="margin-top:18px;">${esc(t('secRoutine'))}</h2>
      <div class="grid">
        <button type="button" class="card-btn" data-act="open" data-view="attendance"><span class="ico">📋</span><span>${esc(t('fAttendance'))}</span></button>
        <button type="button" class="card-btn" data-act="open" data-view="journal"><span class="ico">📓</span><span>${esc(t('fJournal'))}</span></button>
      </div>`;
  }

  // ---- 出缺席點名
  const ATT = [
    ['present', ''], ['sick_leave', 'warn'], ['personal_leave', 'warn'],
    ['official_leave', 'warn'], ['bereavement_leave', 'warn'], ['late', 'bad'],
  ];

  function attendanceHtml() {
    const count = S.att.filter((r) => r.status !== 'present').length;
    return `
      <div class="row" style="justify-content:space-between; margin-bottom:10px;">
        <div class="hint" style="margin:0;">${t('attSummary', { date: esc(S.today), n: count })}</div>
        <button type="button" class="chip" data-act="att-all">${esc(t('attAll'))}</button>
      </div>
      <div class="list">
        ${S.att.map((r) => `
          <div class="item att-item">
            <span class="num">${esc(seatLabel(r.student_number))}</span><span class="name">${esc(nameOf(r))}</span>
            <div class="chips">
              ${ATT.map(([k, cls]) => `<button type="button" class="chip ${r.status === k ? 'on ' + cls : ''}" data-act="att-set" data-id="${r.student_id}" data-status="${k}">${esc(t('st_' + k))}</button>`).join('')}
            </div>
          </div>`).join('')}
      </div>
      <div class="bar-bottom"><button type="button" class="btn block good" data-act="att-save">${esc(t('attSave'))}</button></div>`;
  }

  // ---- 快速加減分（簡單模式：每位學生一個 − 與 +）
  function scoreHtml() {
    return `
      <p class="hint">${esc(t('scoreHint'))}</p>
      <div class="sc-grid">
        ${S.students.map((s) => {
          const d = S.scoreDelta[s.id] || 0;
          return `
          <div class="sc-card">
            <span class="sc-delta ${d > 0 ? 'pos' : d < 0 ? 'neg' : ''}" id="delta-${s.id}">${d > 0 ? '+' + d : d}</span>
            <button type="button" class="sc-note" data-act="note-for" data-id="${s.id}" aria-label="${esc(t('noteFromScore'))}">📝</button>
            <div class="sc-head">
              <span class="sc-num">${String(s.student_number).padStart(2, '0')}</span>
              <span class="sc-name">${esc(nameOf(s))}</span>
            </div>
            <div class="sc-total">${t('scoreTotal', { n: `<b id="total-${s.id}">${S.totals[s.id] || 0}</b>` })}</div>
            <div class="sc-btns">
              <button type="button" class="sc-btn minus" data-act="score" data-id="${s.id}" data-v="-1" aria-label="${esc(t('scoreMinusAria', { name: nameOf(s) }))}">−</button>
              <button type="button" class="sc-btn plus" data-act="score" data-id="${s.id}" data-v="1" aria-label="${esc(t('scorePlusAria', { name: nameOf(s) }))}">＋</button>
            </div>
          </div>`;
        }).join('')}
      </div>
      <div class="bar-bottom"><button type="button" class="btn block secondary" data-act="score-undo" ${S.undoStack.length ? '' : 'disabled'} id="btnUndo">${esc(t('undoLast'))}</button></div>`;
  }

  // ---- 特殊表現紀錄（點選學生 → 點常用片語 → 拍照／錄影 → 儲存）
  const NOTE_PHRASES = [
    { zh: '主動發言', en: 'Spoke up', tone: '' },
    { zh: '專注認真', en: 'Focused', tone: '' },
    { zh: '幫助同學', en: 'Helped a classmate', tone: '' },
    { zh: '進步明顯', en: 'Clear progress', tone: '' },
    { zh: '創意表現', en: 'Creative work', tone: '' },
    { zh: '分享想法', en: 'Shared ideas', tone: '' },
    { zh: '需要提醒', en: 'Needs a reminder', tone: 'warn' },
    { zh: '情緒不穩', en: 'Upset', tone: 'warn' },
    { zh: '與同學衝突', en: 'Conflict with peers', tone: 'warn' },
    { zh: '作業未完成', en: 'Homework missing', tone: 'warn' },
  ];

  function noteStudentChips() {
    return S.students.map((s) => `
      <button type="button" class="chip stu ${String(s.id) === String(S.notePick) ? 'on' : ''}" data-act="note-pick" data-id="${s.id}">
        <span class="n">${esc(s.student_number)}</span><span class="nm">${esc(nameOf(s))}</span>
      </button>`).join('');
  }

  function notesHtml() {
    return `
      <div class="panel">
        <label class="field" style="margin-top:0;">${esc(t('student'))}</label>
        <div class="note-students" id="noteStudents">${noteStudentChips()}</div>
        <label class="field">${esc(t('quickPhrases'))}</label>
        <div class="chips">
          ${NOTE_PHRASES.map((ph, i) => `<button type="button" class="chip phrase ${ph.tone}" data-act="note-phrase" data-i="${i}">${esc(isEn() ? ph.en : ph.zh)}</button>`).join('')}
        </div>
        <label class="field" for="noteText">${esc(t('content'))}</label>
        <textarea class="txt" id="noteText" placeholder="${esc(t('notePh'))}"></textarea>
        <label class="field">${esc(t('mediaOpt'))}</label>
        <div class="row" style="gap:8px;">
          <label class="btn secondary file-btn">${esc(t('camera'))}<input type="file" id="noteCamera" accept="image/*,video/*" capture="environment" hidden></label>
          <label class="btn secondary file-btn">${esc(t('pickFile'))}<input type="file" id="noteFile" accept="image/*,video/*" hidden></label>
        </div>
        <div class="hint" id="noteFileName"></div>
        <div class="spacer"></div>
        <button type="button" class="btn block good" data-act="note-save">${esc(t('saveNote'))}</button>
      </div>`;
  }

  // ---- 教學日誌
  const TAGS = ['general', 'progress', 'classroom', 'material', 'todo'];

  function journalHtml() {
    return `
      <div class="panel">
        <label class="field" style="margin-top:0;">${esc(t('category'))}</label>
        <div class="chips">${TAGS.map((k) => `<button type="button" class="chip ${S.journalTag === k ? 'on' : ''}" data-act="journal-tag" data-tag="${k}">${esc(t('tag_' + k))}</button>`).join('')}</div>
        <label class="field" for="journalText">${esc(t('content'))}</label>
        <textarea class="txt" id="journalText" placeholder="${esc(t('journalPh'))}"></textarea>
        <label class="field" for="journalFile">${esc(t('mediaOpt'))}</label>
        <input class="txt" id="journalFile" type="file" accept="image/*,video/*">
        <div class="spacer"></div>
        <button type="button" class="btn block good" data-act="journal-save">${esc(t('saveJournal'))}</button>
      </div>`;
  }

  // ---- 教學小工具
  function toolsHtml() {
    return `
      <p class="hint">${esc(t('toolsHint'))}</p>
      <div class="grid">
        <button type="button" class="card-btn" data-act="tool" data-tool="bulletin"><span class="ico">📌</span><span>${esc(t('toolBulletin'))}</span></button>
        <button type="button" class="card-btn" data-act="tool" data-tool="timer"><span class="ico">⏱️</span><span>${esc(t('toolTimer'))}</span></button>
        <button type="button" class="card-btn wide" data-act="tool" data-tool="draw"><span class="ico">🎲</span><span>${esc(t('toolDraw'))}</span></button>
      </div>`;
  }

  function syncBox() {
    const text = statusText();
    return `<div class="status ${S.statusKind}" id="syncStatus" style="${text ? '' : 'display:none;'}">${esc(text)}</div>`;
  }

  function bulletinHtml() {
    return `
      <div class="panel">
        <label class="field" for="bulletinText" style="margin-top:0;">${esc(t('announceText'))}</label>
        <textarea class="txt" id="bulletinText" placeholder="${esc(t('announcePh'))}"></textarea>
        <div class="spacer"></div>
        <button type="button" class="btn block" data-act="bulletin-post">${esc(t('announcePost'))}</button>
        <div class="spacer"></div>
        <button type="button" class="btn block secondary" data-act="bulletin-clear">${esc(t('announceClear'))}</button>
      </div>
      <div id="postsBox">${postsHtml()}</div>
      ${syncBox()}`;
  }

  function timerHtml() {
    const presets = [60, 180, 300, 600, 900];
    return `
      <div class="panel">
        <label class="field" style="margin-top:0;">${esc(t('countdown'))}</label>
        <div class="chips">${presets.map((s) => `<button type="button" class="chip ${S.timerSecs === s ? 'on' : ''}" data-act="timer-preset" data-s="${s}">${esc(t('minutesN', { n: s / 60 }))}</button>`).join('')}</div>
        <label class="field" for="timerCustom">${esc(t('customMin'))}</label>
        <input class="txt" id="timerCustom" type="number" inputmode="numeric" min="1" max="180" placeholder="${esc(t('customPh'))}">
        <div class="spacer"></div>
        <div class="row">
          <button type="button" class="btn good" style="flex:2;" data-act="timer-start">${esc(t('start'))}</button>
          <button type="button" class="btn bad" style="flex:1;" data-act="timer-stop">${esc(t('stop'))}</button>
        </div>
      </div>
      ${syncBox()}`;
  }

  function drawResultHtml() {
    const dw = S.drawWinners;
    if (!dw || !dw.winners || !dw.winners.length) return '';
    return dw.winners.map((w) => (dw.mode === 'group'
      ? `🎉 ${esc(w.group_name)}`
      : esc(t('drawWinner', { n: w.student_number, name: nameOf(w) })))).join('<br>');
  }

  function drawHtml() {
    const result = drawResultHtml();
    return `
      <div class="panel">
        <label class="field" style="margin-top:0;">${esc(t('drawTarget'))}</label>
        <div class="chips">
          <button type="button" class="chip ${S.drawMode === 'student' ? 'on' : ''}" data-act="draw-mode" data-m="student">${esc(t('drawStudents'))}</button>
          <button type="button" class="chip ${S.drawMode === 'group' ? 'on' : ''}" data-act="draw-mode" data-m="group">${esc(t('drawGroups'))}</button>
        </div>
        <label class="field">${esc(t('drawCount'))}</label>
        <div class="row">
          <button type="button" class="pm minus" data-act="draw-count" data-v="-1">−</button>
          <div class="delta" style="font-size:1.6rem; min-width:60px;" id="drawCount">${S.drawCount}</div>
          <button type="button" class="pm plus" data-act="draw-count" data-v="1">＋</button>
        </div>
        <label class="field" style="display:flex; gap:8px; align-items:center;">
          <input type="checkbox" id="drawExclude" ${S.drawExclude ? 'checked' : ''} style="width:22px;height:22px;"> ${esc(t('drawExclude'))}
        </label>
        <div class="spacer"></div>
        <button type="button" class="btn block" data-act="draw-go">${esc(t('drawGo'))}</button>
        <div class="spacer"></div>
        <button type="button" class="btn block secondary" data-act="draw-reset">${esc(t('drawReset'))}</button>
      </div>
      <div class="panel" id="drawBox" style="${result ? '' : 'display:none;'}"><div class="winner" id="drawResult">${result}</div></div>
      ${syncBox()}`;
  }

  function showDrawResult(payload) {
    const list = payload.winners || [];
    if (!list.length) return;
    S.drawWinners = { mode: payload.mode, winners: list };
    refreshDrawText();
  }

  function refreshDrawText() {
    if (S.view !== 'draw') return;
    const box = $('drawBox');
    const res = $('drawResult');
    const html = drawResultHtml();
    if (box && res && html) { res.innerHTML = html; box.style.display = ''; }
  }

  // ------------------------------------------------------------------ 動作

  async function doLogin() {
    const pw = ($('pw') && $('pw').value || '').trim();
    if (!pw) { toast(t('enterPw'), true); return; }
    try {
      const res = await fetch('/api/system/verify_password', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ password: pw }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(isEn() ? t('wrongPw') : (body.detail || t('wrongPw')));
      localStorage.setItem(TOKEN_KEY, body.auth_token);
      localStorage.setItem(DATE_KEY, body.auth_date || '');
      S.today = body.auth_date || S.today;
      await start();
    } catch (err) {
      toast(err.message, true);
    }
  }

  async function pickCourse(id) {
    const c = S.courses.find((x) => Number(x.id) === Number(id));
    if (!c) return;
    S.course = c;
    S.scoreDelta = {};
    S.totals = {};
    S.undoStack = [];
    S.posts = [];
    S.selectedPosts = [];
    S.status = null;
    S.drawWinners = null;
    try { localStorage.setItem(LAST_COURSE_KEY, String(c.id)); } catch (_) { /* ignore */ }
    connectSocket();
    go('home');
  }

  async function openView(view) {
    try {
      if (view === 'attendance') { await loadAttendance(); }
      else if (view === 'score') { await loadScoreboard(); }
      else if (view === 'notes') { await loadStudents(); }
      go(view);
    } catch (err) {
      toast(err.message, true);
    }
  }

  async function saveAttendance() {
    try {
      const res = await api(`/api/attendance/${S.course.id}`, {
        json: { date: S.today, items: S.att.map((r) => ({ student_id: r.student_id, status: r.status })) },
      });
      toast(t('attSaved'));
      return res;
    } catch (err) {
      toast(err.message, true);
    }
  }

  async function quickScore(studentId, v) {
    const s = S.students.find((x) => Number(x.id) === Number(studentId));
    if (!s) return;
    // 先更新畫面再送出，失敗時還原
    S.scoreDelta[s.id] = (S.scoreDelta[s.id] || 0) + v;
    S.totals[s.id] = (S.totals[s.id] || 0) + v;
    refreshDelta(s.id);
    refreshTotal(s.id);
    try {
      const res = await api(`/api/scores/${S.course.id}/batch`, {
        // 寫入資料庫的項目名稱固定用中文（與電腦端的紀錄、報表一致）
        json: { date: S.today, updates: [{ student_id: s.id, score: v, rule_title: v > 0 ? '手機快速加分' : '手機快速扣分' }] },
      });
      if (res.undo_id) {
        S.undoStack.push({ undo_id: res.undo_id, student_id: s.id, v });
        const b = $('btnUndo');
        if (b) b.disabled = false;
      }
      toast(`${seatLabel(s.student_number)} ${nameOf(s)}　${v > 0 ? '+1' : '−1'}`);
    } catch (err) {
      S.scoreDelta[s.id] -= v;
      S.totals[s.id] -= v;
      refreshDelta(s.id);
      refreshTotal(s.id);
      toast(err.message, true);
    }
  }

  function refreshDelta(id) {
    const el = $(`delta-${id}`);
    if (!el) return;
    const d = S.scoreDelta[id] || 0;
    el.textContent = d > 0 ? `+${d}` : String(d);
    el.className = `sc-delta ${d > 0 ? 'pos' : d < 0 ? 'neg' : ''}`;
  }

  async function undoLast() {
    const last = S.undoStack.pop();
    if (!last) return;
    try {
      await api('/api/scores/undo', { json: { undo_id: last.undo_id } });
      S.scoreDelta[last.student_id] = (S.scoreDelta[last.student_id] || 0) - last.v;
      S.totals[last.student_id] = (S.totals[last.student_id] || 0) - last.v;
      refreshDelta(last.student_id);
      refreshTotal(last.student_id);
      const b = $('btnUndo');
      if (b) b.disabled = S.undoStack.length === 0;
      toast(t('undone'));
    } catch (err) {
      S.undoStack.push(last);
      toast(err.message, true);
    }
  }

  async function saveNote() {
    const sid = S.notePick;
    const text = $('noteText').value.trim();
    const file = ($('noteCamera') && $('noteCamera').files[0]) || $('noteFile').files[0];
    if (!sid) { toast(t('needStudent'), true); return; }
    if (!text && !file) { toast(t('needContent'), true); return; }
    try {
      if (file) {
        const fd = new FormData();
        fd.append('student_id', sid);
        fd.append('date_str', S.today);
        fd.append('note_text', text);
        fd.append('media_file', file);
        await api(`/api/notes/${S.course.id}/with_media`, { method: 'POST', body: fd });
      } else {
        await api(`/api/notes/${S.course.id}`, { json: { student_id: Number(sid), note_text: text, date: S.today } });
      }
      toast(t('noteSaved'));
      S.notePick = sid;
      go('notes');
    } catch (err) {
      toast(err.message, true);
    }
  }

  async function saveJournal() {
    const text = $('journalText').value.trim();
    const file = $('journalFile').files[0];
    if (!text && !file) { toast(t('needContent'), true); return; }
    try {
      if (file) {
        const fd = new FormData();
        fd.append('content', text);
        fd.append('tag', S.journalTag);
        fd.append('date', S.today);
        fd.append('media_file', file);
        await api(`/api/journal/${S.course.id}/with_media`, { method: 'POST', body: fd });
      } else {
        await api(`/api/journal/${S.course.id}`, { json: { content: text, tag: S.journalTag, date: S.today } });
      }
      toast(t('journalSaved'));
      go('journal');
    } catch (err) {
      toast(err.message, true);
    }
  }

  async function openTool(tool) {
    S.status = null;
    if (tool === 'bulletin') {
      try { S.posts = await api(`/api/bulletin/${S.course.id}`); } catch (_) { S.posts = []; }
    }
    go(tool);
    // 一打開功能，電腦就跟著切換過去
    const r = await sendAction('open_tool', { tool });
    reportSync(r, null);
  }

  async function postBulletin() {
    const text = ($('bulletinText').value || '').trim();
    if (!text) { toast(t('needAnnounce'), true); return; }
    const now = new Date();
    const hhmm = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
    try {
      const post = await api(`/api/bulletin/${S.course.id}`, {
        // 佈告標題固定用中文，與電腦端的佈告清單一致
        // 標題帶上內容的前幾個字，同一分鐘發佈多則時也分得出是哪一則（選取刪除時用得到）
        json: { title: `${PHONE_POST_PREFIX} ${hhmm} ${text.replace(/\s+/g, ' ').slice(0, 12)}`.trim(), content: esc(text).replace(/\n/g, '<br>') },
      });
      if (!S.posts.some((x) => x.id === post.id)) S.posts.push(post);
      paintPosts();
      const r1 = await sendAction('bulletin_show', { postId: post.id, text });
      await sendAction('announcement', { text, postId: post.id });
      reportSync(r1, 'doAnnounced');
      toast(t('announced'));
    } catch (err) {
      toast(err.message, true);
    }
  }

  /** 清除大螢幕上的公告：只關閉大螢幕的公告與電腦上的全螢幕佈告，不會刪除任何佈告。 */
  async function clearAnnouncements() {
    const r = await sendAction('announcement_clear', {});
    await sendAction('bulletin_clear', {});
    reportSync(r, 'doCleared');
  }

  function selectedPostObjs() {
    return S.posts.filter((p) => S.selectedPosts.includes(p.id));
  }

  /** 選取「恰好一則」佈告後，顯示在電腦上（多選時按鈕已停用；這裡再擋一次，避免誤送）。 */
  async function showSelectedPost() {
    const list = selectedPostObjs();
    if (list.length === 0) { toast(t('selectPostFirst'), true); return; }
    if (list.length > 1) { toast(t('showOneOnly'), true); return; }
    const postObj = list[0];
    const plainText = (postObj.content || '').replace(/<br\s*\/?>/gi, '\n').replace(/<[^>]+>/g, '').trim() || postObj.title;
    const r = await sendAction('bulletin_show', { postId: postObj.id, text: plainText });
    await sendAction('announcement', { text: plainText, postId: postObj.id });
    reportSync(r, 'doShown');
  }

  /** 刪除所選的佈告（一則或多則；手機端先確認，刪除後電腦與其他手機會即時同步）。 */
  async function deleteSelectedPosts() {
    const list = selectedPostObjs();
    if (list.length === 0) { toast(t('selectPostFirst'), true); return; }
    const msg = list.length === 1
      ? t('confirmDeletePost', { title: list[0].title })
      : t('confirmDeletePosts', {
        n: list.length,
        titles: list.slice(0, 8).map((p) => `・${p.title}`).join('\n') + (list.length > 8 ? `\n… +${list.length - 8}` : ''),
      });
    const ok = typeof confirm === 'function' ? confirm(msg) : true;
    if (!ok) return;

    let done = 0;
    let lastErr = null;
    for (const p of list) {
      try {
        await api(`/api/bulletin/${S.course.id}/${p.id}`, { method: 'DELETE' });
        S.posts = S.posts.filter((x) => x.id !== p.id);
        S.selectedPosts = S.selectedPosts.filter((id) => id !== p.id);
        done += 1;
      } catch (err) {
        lastErr = err;
      }
    }
    paintPosts();
    if (done > 0) toast(done === 1 ? t('postDeleted') : t('postsDeleted', { n: done }));
    if (lastErr) toast(lastErr.message, true); // 部分失敗時，失敗的佈告仍保持選取，可再按一次
  }

  async function startTimer() {
    const custom = parseInt(($('timerCustom') && $('timerCustom').value) || '', 10);
    const secs = Number.isFinite(custom) && custom > 0 ? custom * 60 : S.timerSecs;
    const r = await sendAction('timer_start', { durationMs: secs * 1000 });
    reportSync(r, { key: 'doTimerStarted', params: { n: Math.round(secs / 60 * 10) / 10 } });
  }

  function shuffleSample(list, n) {
    const a = list.slice();
    for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; }
    return a.slice(0, n);
  }

  async function doDraw() {
    S.drawExclude = $('drawExclude') ? $('drawExclude').checked : S.drawExclude;
    const r = await sendAction('draw_request', { mode: S.drawMode, count: S.drawCount, exclude: S.drawExclude });
    if (r.desktop > 0) {
      reportSync(r, 'doDrawing');
      return;
    }
    // 電腦沒有開這個班級時，改在手機上抽，並把結果送到大螢幕
    try {
      let winners;
      if (S.drawMode === 'group') {
        const groups = await api(`/api/groups/${S.course.id}`).catch(() => []);
        const list = Array.isArray(groups) ? groups : (groups.groups || []);
        if (!list.length) { toast(t('noGroups'), true); return; }
        winners = shuffleSample(list, Math.min(S.drawCount, list.length)).map((g) => ({ group_name: g.group_name || g.name, icon_url: g.icon_url }));
      } else {
        await loadStudents();
        const list = S.students;
        if (!list.length) { toast(t('noStudents'), true); return; }
        winners = shuffleSample(list, Math.min(S.drawCount, list.length)).map((w) => ({ id: w.id, student_number: w.student_number, name: w.name, english_name: w.english_name, gender: w.gender }));
      }
      showDrawResult({ mode: S.drawMode, winners });
      await sendAction('draw', { mode: S.drawMode, winners });
      S.status = { raw: 'drawLocal' };
      S.statusKind = 'warn';
      paintStatus();
    } catch (err) {
      toast(err.message, true);
    }
  }

  // ------------------------------------------------------------------ 事件

  async function handle(act, d) {
    switch (act) {
      case 'lang': return setLang(isEn() ? 'zh-TW' : 'en');
      case 'login': return doLogin();
      case 'courses': S.course = null; if (S.socket) { try { S.socket.close(); } catch (_) { /* ignore */ } S.socket = null; } try { await loadCourses(); } catch (_) { /* ignore */ } return go('courses');
      case 'back': {
        const parent = { attendance: 'home', score: 'home', notes: S.notesFrom || 'home', journal: 'home', tools: 'home', bulletin: 'tools', timer: 'tools', draw: 'tools', home: 'courses' };
        if (S.view === 'home') return handle('courses', {});
        return go(parent[S.view] || 'home');
      }
      case 'pick-course': return pickCourse(d.id);
      case 'open':
        if (d.view === 'notes') S.notesFrom = 'home';
        return openView(d.view);
      case 'note-for':
        S.notePick = String(d.id);
        S.notesFrom = 'score';
        return openView('notes');
      case 'note-pick': {
        // 只更新選取狀態，不重繪頁面（避免清掉已輸入的文字）
        S.notePick = String(S.notePick) === String(d.id) ? '' : String(d.id);
        document.querySelectorAll('#noteStudents .chip').forEach((el) => el.classList.toggle('on', S.notePick !== '' && el.dataset.id === S.notePick));
        return undefined;
      }
      case 'note-phrase': {
        const ph = NOTE_PHRASES[Number(d.i)];
        const box = $('noteText');
        if (!ph || !box) return undefined;
        const label = isEn() ? ph.en : ph.zh;
        const cur = box.value.trim();
        if (!cur.includes(label)) box.value = cur ? `${cur}${isEn() ? ', ' : '、'}${label}` : label;
        return undefined;
      }
      case 'att-set': {
        const r = S.att.find((x) => String(x.student_id) === String(d.id));
        if (r) { r.status = d.status; render(); }
        return undefined;
      }
      case 'att-all': S.att.forEach((r) => { r.status = 'present'; }); return render();
      case 'att-save': return saveAttendance();
      case 'score': return quickScore(d.id, Number(d.v));
      case 'score-undo': return undoLast();
      case 'note-save': return saveNote();
      case 'journal-tag': S.journalTag = d.tag; return render();
      case 'journal-save': return saveJournal();
      case 'tool': return openTool(d.tool);
      case 'bulletin-post': return postBulletin();
      case 'bulletin-clear': return clearAnnouncements();
      case 'bulletin-select': {
        const id = Number(d.id);
        S.selectedPosts = S.selectedPosts.includes(id) ? S.selectedPosts.filter((x) => x !== id) : [...S.selectedPosts, id];
        return paintPosts();
      }
      case 'bulletin-select-all': S.selectedPosts = S.posts.map((p) => p.id); return paintPosts();
      case 'bulletin-select-none': S.selectedPosts = []; return paintPosts();
      case 'bulletin-show-selected': return showSelectedPost();
      case 'bulletin-delete': return deleteSelectedPosts();
      case 'timer-preset': S.timerSecs = Number(d.s); return render();
      case 'timer-start': return startTimer();
      case 'timer-stop': { const r = await sendAction('timer_stop', {}); return reportSync(r, 'doTimerStopped'); }
      case 'draw-mode': S.drawMode = d.m; return render();
      case 'draw-count': S.drawCount = Math.max(1, Math.min(30, S.drawCount + Number(d.v))); { const el = $('drawCount'); if (el) el.textContent = S.drawCount; } return undefined;
      case 'draw-go': return doDraw();
      case 'draw-reset': { const r = await sendAction('draw_reset_pool', {}); return reportSync(r, 'doPoolReset'); }
      default: return undefined;
    }
  }

  document.addEventListener('click', (e) => {
    const el = e.target.closest && e.target.closest('[data-act]');
    if (!el) return;
    handle(el.dataset.act, el.dataset).catch((err) => toast(err.message || t('opFailedShort'), true));
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && S.view === 'login') doLogin();
  });
  document.addEventListener('change', (e) => {
    const el = e.target;
    if (!el || (el.id !== 'noteCamera' && el.id !== 'noteFile')) return;
    const other = $(el.id === 'noteCamera' ? 'noteFile' : 'noteCamera');
    if (other) other.value = '';
    const label = $('noteFileName');
    if (label) label.textContent = el.files && el.files[0] ? `📎 ${el.files[0].name}` : '';
  });

  // ------------------------------------------------------------------ 啟動

  async function start() {
    try {
      const headers = token() ? { Authorization: `Bearer ${token()}` } : {};
      const auth = await fetch('/api/system/check_auth', { headers, credentials: 'same-origin' }).then((r) => r.json());
      S.today = auth.today_str || S.today;
      const savedDate = localStorage.getItem(DATE_KEY);
      if (!token() || !auth.authenticated || (savedDate && savedDate !== auth.today_str)) {
        return go('login');
      }
      await loadCourses();
      await loadTimetable();
      // 只有一個班級時直接進入；否則先選班級
      if (S.courses.length === 1) return pickCourse(S.courses[0].id);
      return go('courses');
    } catch (err) {
      if (S.view !== 'login') go('login');
      return undefined;
    }
  }

  applyDocLang();
  window.MobileApp = { handle, state: S, start, t, setLang, getLang: () => lang }; // 供測試使用
  start();
})();
