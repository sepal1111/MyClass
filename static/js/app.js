/* ==========================================================================
   國小課堂即時記錄系統 - Main Frontend Controller App
   ========================================================================== */

const AppState = {
  currentCourseId: null,
  courses: [],
  students: [],
  selectedStudentIds: new Set(),
  rules: [],
  groups: [],
  groupPlans: [],
  currentGroupPlanId: null,
  activeGroupPlanId: null,
  currentScoringGroupTarget: null,
  attendanceRecords: {},
  dashboardPeriod: 'today',
  dashboardViewMode: 'individual',
  scoringPeriod: localStorage.getItem('scoring_period') || 'today',
  scoringStartDate: null,
  scoringEndDate: null,
  projectionViewMode: 'individual',
  quickScoringMode: localStorage.getItem('quick_scoring_mode') === 'true',
  pendingQuickScores: {},
  scoringViewMode: localStorage.getItem('scoring_view_mode') === 'seating' ? 'seating' : 'grid',
  seatingData: null
};
// const at top level isn't a window property; expose explicitly for
// remote-control.js (loaded after this file) to read the current roster.
window.AppState = AppState;

// Defensive fallback: ensure API.postFormData is always available even if api.js was cached
if (typeof API !== 'undefined' && !API.postFormData) {
  API.postFormData = async function(url, formData) {
    const res = await fetch(url, {
      method: 'POST',
      headers: typeof this.getHeaders === 'function' ? this.getHeaders() : {},
      body: formData,
      credentials: 'same-origin'
    });
    if (res.status === 401) {
      if (typeof this.handleUnauthorized === 'function') this.handleUnauthorized();
      const err = await res.json().catch(() => ({ detail: '未登入或身分驗證已逾期' }));
      throw new Error(err.detail || '未登入或身分驗證已逾期');
    }
    if (!res.ok) {
      const err = await res.json().catch(() => ({ detail: res.statusText }));
      throw new Error(err.detail || '請求失敗');
    }
    return res.json();
  };
}

// Push-driven refresh: one long-lived WebSocket per course. Whenever another
// device changes this course's scores/attendance/groups, the server notifies
// us and we simply re-run whichever load function backs the currently
// visible tab — so scoring cards, the dashboard, attendance, seating and
// grouping all pick up the change instantly without polling.
let appRealtimeHandle = null;
let appRealtimeCourseId = null;

function syncAppRealtimeConnection() {
  if (appRealtimeCourseId === AppState.currentCourseId) return;
  if (appRealtimeHandle) {
    appRealtimeHandle.close();
    appRealtimeHandle = null;
  }
  appRealtimeCourseId = AppState.currentCourseId;
  if (typeof connectCourseRealtime === 'function' && AppState.currentCourseId) {
    appRealtimeHandle = connectCourseRealtime(AppState.currentCourseId, (event) => {
      // live_wall_updated 只刷新即時互動牆子模組，避免每則貼文都觸發整個分頁重新整理
      // （refreshActiveTab 用在 attendance_updated/groups_updated/score_updated 這類需要
      // 重抓整個分頁資料的事件，Live Wall 不屬於這個家族）。
      if (event === 'live_wall_updated') {
        if (['toolkit', 'liveWall'].includes(getActiveTabName()) && window.TeachingToolkit && window.TeachingToolkit.liveWall) {
          window.TeachingToolkit.liveWall.refresh();
        }
      } else if (event === 'bulletin_updated') {
        // 佈告清單有增減／改名（例如手機發佈或清除公告）：只同步清單，不重整整個分頁
        if (window.TeachingToolkit && window.TeachingToolkit.bulletin) {
          window.TeachingToolkit.bulletin.refreshPosts();
        }
      } else {
        refreshActiveTab(getActiveTabName());
      }
    }, handleDesktopToolkitAction, undefined, 'desktop');
  }
}

// 教師手機（/mobile）傳來的教學小工具指令：電腦端自動切到「教學小工具」並開啟對應功能。
// 其他分頁（大螢幕投影頁）各自處理同一批指令（projection.js 的 handleToolkitAction）。
function handleDesktopToolkitAction(action, payload) {
  const TK = window.TeachingToolkit;
  if (!TK) return;
  const data = payload || {};
  const goTool = (sub) => {
    switchTab('toolkit');
    TK.switchSubtab(sub);
  };

  switch (action) {
    case 'open_tool':
      if (['bulletin', 'draw', 'timer'].includes(data.tool)) goTool(data.tool);
      break;

    case 'timer_start': {
      goTool('timer');
      const secs = Math.max(1, Math.round((Number(data.durationMs) || 0) / 1000));
      TK.timer.switchTimerMode('countdown');
      TK.timer.setCountdownSeconds(secs);
      TK.timer.startCountdown();
      break;
    }

    case 'timer_stop':
      TK.timer.pauseCountdown();
      break;

    case 'draw_request': {
      goTool('draw');
      const modeEl = document.getElementById('lucky-draw-mode');
      const countEl = document.getElementById('lucky-draw-count');
      const excludeEl = document.getElementById('lucky-draw-exclude-drawn');
      if (modeEl && data.mode) {
        modeEl.value = data.mode === 'group' ? 'group' : 'student';
        modeEl.dispatchEvent(new Event('change'));
      }
      if (countEl) countEl.value = String(Math.max(1, parseInt(data.count, 10) || 1));
      if (excludeEl && typeof data.exclude === 'boolean') {
        excludeEl.checked = data.exclude;
        excludeEl.dispatchEvent(new Event('change'));
      }
      // 抽籤池全部抽完時，電腦端會跳出確認視窗等人按；手機發起時直接重置，避免卡住
      if (modeEl && modeEl.value === 'student' && excludeEl && excludeEl.checked) {
        const left = (TK.luckyDraw.students || []).filter(s => !s.is_absent && !TK.luckyDraw.drawnStudentIds.has(s.id));
        if (left.length === 0) TK.luckyDraw.resetPool();
      }
      if (!TK.luckyDraw.isRolling) {
        TK.luckyDraw._remoteDraw = true;
        TK.luckyDraw.startDraw();
      }
      break;
    }

    case 'draw_reset_pool':
      TK.luckyDraw.resetPool();
      break;

    case 'announcement':
    case 'bulletin_show': {
      const timerFs = document.getElementById('modal-timer-fullscreen');
      if (timerFs && timerFs.classList.contains('open')) {
        timerFs.classList.remove('open');
      }
      goTool('bulletin');
      if (data.postId != null) {
        TK.bulletin.showPost(data.postId);
      } else if (data.text) {
        TK.bulletin.showText(data.text);
      }
      break;
    }

    case 'announcement_clear':
    case 'bulletin_clear':
      // 手機按「清除大螢幕上的公告」：同時關閉電腦上的全螢幕佈告（不會刪除任何佈告）
      TK.bulletin.closeFullscreen();
      break;

    default:
      break;
  }
}

// Lets the mobile remote-control panel (remote-control.js) send a toolkit
// action over this same connection, without that file needing to know about
// AppState/appRealtimeHandle internals.
function sendCourseToolkitAction(action, payload) {
  if (appRealtimeHandle && typeof appRealtimeHandle.sendToolkitAction === 'function') {
    appRealtimeHandle.sendToolkitAction(action, payload);
  }
}
window.sendCourseToolkitAction = sendCourseToolkitAction;

function getStudentDisplayName(student, customMode = null) {
  if (window.I18n && typeof window.I18n.getStudentDisplayName === 'function') {
    return window.I18n.getStudentDisplayName(student, customMode);
  }
  return student ? (student.name || student.student_name || '') : '';
}

document.addEventListener('DOMContentLoaded', () => {
  // Check if Mobile Scoring Mode is requested via URL (?mobile=1 or ?mode=mobile)
  const urlParams = new URLSearchParams(window.location.search);
  const isMobile = urlParams.get('mobile') === '1' || urlParams.get('mode') === 'mobile' || urlParams.get('mobile_scoring') === '1';
  if (isMobile) {
    document.body.classList.add('mobile-scoring-only');
  }
  const paramCourseId = urlParams.get('course_id');
  if (paramCourseId) {
    AppState.currentCourseId = parseInt(paramCourseId);
  }

  initTheme();
  initNavTabs();
  initModals();
  initAuth();
  initCustomFileInputs();
  initEventListeners();

  // Listen to Language & Name Display Mode changes
  window.addEventListener('languageChanged', () => {
    if (window.I18n) window.I18n.updateDOMTranslations();
    const dateBadge = document.getElementById('auth-today-date-badge');
    if (dateBadge && gAuthTodayStr) {
      const isEn = window.I18n && window.I18n.getLanguage() === 'en';
      dateBadge.textContent = isEn ? `📅 Date: ${gAuthTodayStr}` : `📅 今日日期: ${gAuthTodayStr}`;
    }
    renderCourseSelectOptions();
    updateQuickScoringToggleUI();
    updateScoringViewModeUI();
    updateScoringPeriodUI();
    document.querySelectorAll('.custom-file-wrap').forEach(wrap => {
      const input = wrap.querySelector('input[type="file"]');
      const nameSpan = wrap.querySelector('.custom-file-name');
      if (input && nameSpan && (!input.files || input.files.length === 0)) {
        const isEn = window.I18n && window.I18n.getLanguage() === 'en';
        nameSpan.textContent = isEn ? 'No file chosen' : '未選擇任何檔案';
        nameSpan.setAttribute('data-i18n', 'file_none_chosen');
      }
    });
    if (!AppState.courses || AppState.courses.length === 0) {
      renderActiveTabEmptyNotice();
    }
    refreshActiveTab(getActiveTabName(), true);
  });

  window.addEventListener('nameDisplayModeChanged', () => {
    if (window.I18n) window.I18n.updateDOMTranslations();
    const activeTab = getActiveTabName();
    // 優先原位更新畫面上已有學生卡片的顯示姓名，避免重新發起 API 請求與清空 DOM 造成的畫面重繪閃爍
    const updatedCount = updateRenderedStudentNames();
    if (updatedCount === 0 || ['students', 'dashboard', 'reports'].includes(activeTab)) {
      refreshActiveTab(activeTab, true);
    }
  });
});

function updateRenderedStudentNames() {
  if (!AppState || !AppState.students || AppState.students.length === 0) return 0;
  let count = 0;
  const isEn = window.I18n && window.I18n.getLanguage() === 'en';

  // 1. 計分板學生卡片 (Scoring Student Grid)
  document.querySelectorAll('#scoring-student-grid .student-card').forEach(card => {
    const sid = Number(card.dataset.studentId || card.querySelector('[data-student-id]')?.dataset?.studentId || card.querySelector('[id^="score-badge-"]')?.id.replace('score-badge-', ''));
    if (sid) {
      const s = AppState.students.find(item => item.id === sid);
      if (s) {
        const nameEl = card.querySelector('.student-name');
        if (nameEl) {
          const newName = getStudentDisplayName(s);
          nameEl.textContent = newName;
          nameEl.title = newName;
          count++;
        }
        const numEl = card.querySelector('.student-number');
        if (numEl) {
          numEl.textContent = isEn ? `No. ${s.student_number}` : `${s.student_number} 號`;
        }
      }
    }
  });

  // 2. 計分板座次卡片 (Scoring Seating Grid)
  document.querySelectorAll('#scoring-seating-grid .scoring-seat-cell').forEach(cell => {
    const sid = Number(cell.dataset.studentId || cell.querySelector('[data-student-id]')?.dataset?.studentId || cell.querySelector('[id^="score-badge-"]')?.id.replace('score-badge-', ''));
    if (sid) {
      const s = AppState.students.find(item => item.id === sid);
      if (s) {
        const nameEl = cell.querySelector('.student-name');
        if (nameEl) {
          const newName = getStudentDisplayName(s);
          nameEl.textContent = newName;
          nameEl.title = newName;
          count++;
        }
        const numEl = cell.querySelector('.student-number');
        if (numEl) {
          numEl.textContent = isEn ? `No. ${s.student_number}` : `${s.student_number}號`;
        }
      }
    }
  });

  // 3. 點名卡片 (Attendance Student Grid)
  document.querySelectorAll('#attendance-student-grid .student-card').forEach(card => {
    const sid = Number(card.dataset.studentId);
    if (sid) {
      const s = AppState.students.find(item => item.id === sid);
      if (s) {
        const nameEl = card.querySelector('.student-name');
        if (nameEl) {
          const newName = getStudentDisplayName(s);
          nameEl.textContent = newName;
          nameEl.title = newName;
          count++;
        }
      }
    }
  });

  // 4. 小工具 (Teaching Toolkit 如抽籤展示)
  if (window.TeachingToolkit && typeof window.TeachingToolkit.updateDisplayNames === 'function') {
    window.TeachingToolkit.updateDisplayNames();
  }

  return count;
}

// --- Security & Auth System ---
let gAuthTodayStr = '';

// 學生端與教師端共用同一個網址：學生登入成功後不再導向獨立的 /student 頁面，改為顯示這個
// 蓋滿全螢幕的同源 iframe（src 指向內部沿用的 /student 資源，未曾更動 student.html/student.js
// 的任何邏輯）。同源 iframe 本來就共用同一份 localStorage，student_token/student_info 這兩個
// key 一存好，iframe 裡的 student.js 就讀得到，不需要額外傳遞。
function enterStudentMode() {
  const authOverlay = document.getElementById('auth-overlay');
  if (authOverlay) authOverlay.classList.remove('open');
  const frame = document.getElementById('student-app-frame');
  if (!frame) return;
  if (!frame.dataset.loaded) {
    frame.src = '/student';
    frame.dataset.loaded = '1';
  }
  frame.style.display = 'block';
}
window.enterStudentMode = enterStudentMode;

// 學生登出／session 失效時呼叫（由 iframe 內的 student.js 透過 window.parent.exitStudentMode()
// 呼叫回來，因為同源可以直接互相呼叫函式，不需要 postMessage）：卸載 iframe、重新走一次登入檢查流程。
function exitStudentMode() {
  const frame = document.getElementById('student-app-frame');
  if (frame) {
    frame.style.display = 'none';
    frame.removeAttribute('src');
    delete frame.dataset.loaded;
  }
  initAuth();
}
window.exitStudentMode = exitStudentMode;

async function initAuth() {
  // 重新整理頁面時，若 localStorage 已有學生 session，直接回到學生畫面，不用重新登入、
  // 也不需要先跑教師端的 check_auth 檢查。
  if (localStorage.getItem('student_token')) {
    enterStudentMode();
    return;
  }
  const authOverlay = document.getElementById('auth-overlay');
  try {
    const authStatus = await API.get('/api/system/check_auth');
    gAuthTodayStr = authStatus.today_str;

    const dateBadge = document.getElementById('auth-today-date-badge');
    if (dateBadge) {
      const isEn = window.I18n && window.I18n.getLanguage() === 'en';
      dateBadge.textContent = isEn ? `📅 Date: ${authStatus.today_str}` : `📅 今日日期: ${authStatus.today_str}`;
    }

    const savedAuthDate = localStorage.getItem('auth_date');
    const savedToken = localStorage.getItem('auth_token');

    if (authStatus.authenticated && savedAuthDate === authStatus.today_str && savedToken) {
      // Authenticated for today!
      if (authStatus.must_change_prefix) {
        if (authOverlay) authOverlay.classList.remove('open');
        showForcePrefixModal();
        return;
      }
      const urlParams = new URLSearchParams(window.location.search);
      const redirectUrl = urlParams.get('redirect');
      if (redirectUrl) {
        window.location.href = redirectUrl;
        return;
      }

      if (authOverlay) authOverlay.classList.remove('open');
      // 課表提醒：比對當下時間，提示這一節是哪一班的什麼課（見 timetable.js）
      loadCourses().then(() => {
        if (window.Timetable) window.Timetable.onAppReady();
        if (window.UpdateNotice) window.UpdateNotice.onAppReady();
        if (window.TeacherNotify) window.TeacherNotify.onAppReady();
      });
    } else {
      // Must authenticate
      localStorage.removeItem('auth_token');
      localStorage.removeItem('auth_date');
      if (authOverlay) authOverlay.classList.add('open');
      showAuthPanel(getDefaultAuthPanel());
    }
  } catch (err) {
    console.error('Auth check error:', err);
    localStorage.removeItem('auth_token');
    localStorage.removeItem('auth_date');
    if (authOverlay) authOverlay.classList.add('open');
    showAuthPanel(getDefaultAuthPanel());
  }
}

// 主登入介面預設顯示教師登入；只有網址帶 ?login=student（學生連線 QR Code 掃碼進來）才顯示
// 學生登入表單——學生不再從這台裝置手動切換到學生登入，只能透過教師出示的 QR Code 進入。
function getDefaultAuthPanel() {
  const urlParams = new URLSearchParams(window.location.search);
  return urlParams.get('login') === 'student' ? 'student' : 'teacher';
}

// 系統登入頁面：學生登入 / 教師登入面板切換
function showAuthPanel(which) {
  const studentPanel = document.getElementById('auth-panel-student');
  const teacherPanel = document.getElementById('auth-panel-teacher');
  if (studentPanel) studentPanel.style.display = which === 'teacher' ? 'none' : '';
  if (teacherPanel) teacherPanel.style.display = which === 'teacher' ? '' : 'none';
}

async function submitStudentLogin(evt) {
  if (evt) evt.preventDefault();
  const accountInput = document.getElementById('student-login-account');
  const pwdInput = document.getElementById('student-login-password');
  const errorBox = document.getElementById('student-login-error');
  const hintBox = document.getElementById('student-login-hint');
  const isEn = window.I18n && window.I18n.getLanguage() === 'en';
  if (errorBox) {
    errorBox.style.display = 'none';
    errorBox.textContent = '';
  }
  if (hintBox) {
    hintBox.style.display = 'none';
    hintBox.textContent = '';
  }

  const account = accountInput ? accountInput.value.trim() : '';
  const password = pwdInput ? pwdInput.value : '';
  if (!account || !password) {
    if (errorBox) {
      errorBox.textContent = isEn ? 'Please enter both account and password!' : '請輸入登入帳號與密碼！';
      errorBox.style.display = 'block';
    }
    return;
  }

  try {
    const res = await fetch('/api/auth/student/login_by_account', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ account, password }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      // 密碼多次輸入錯誤後，伺服器會附上這個帳號的「密碼提醒」
      if (data.hint && hintBox) {
        hintBox.textContent = (isEn ? '💡 Your password hint: ' : '💡 你的密碼提醒：') + data.hint;
        hintBox.style.display = 'block';
      }
      throw new Error(data.detail || (isEn ? 'Login failed!' : '登入失敗！'));
    }

    localStorage.setItem('student_token', data.token);
    localStorage.setItem('student_info', JSON.stringify(data.student));
    enterStudentMode();
  } catch (err) {
    if (errorBox) {
      errorBox.textContent = err.message || (isEn ? 'Login failed!' : '登入失敗！');
      errorBox.style.display = 'block';
    }
  }
}

// --- 強制修改預設密碼字頭 ---
// 伺服器仍使用預設字頭（Admin）時，登入後必須先改掉才能使用系統（後端 requireAuth 也會擋下其他 API）。
let gForcePrefixKnownPassword = '';

function showForcePrefixModal() {
  if (document.getElementById('force-prefix-overlay')) return;
  const isEn = window.I18n && window.I18n.getLanguage() === 'en';
  const t = isEn
    ? { title: 'Change the password prefix', desc: 'The system is still using the default prefix "Admin", which is public. Please set your own prefix (at least 4 characters, not "Admin") before continuing.', cur: "Today's current password", pre: 'New prefix', pre2: 'Confirm new prefix', btn: 'Save and continue' }
    : { title: '請先修改密碼字頭', desc: '目前仍使用公開的預設字頭「Admin」。請先設定自己的密碼字頭（至少 4 碼，且不可為 Admin）才能繼續使用系統。', cur: '今日目前密碼', pre: '新的字頭', pre2: '再次輸入新字頭', btn: '儲存並繼續' };
  const overlay = document.createElement('div');
  overlay.id = 'force-prefix-overlay';
  overlay.className = 'modal-overlay open';
  overlay.style.cssText = 'z-index: 100002; display: flex; align-items: center; justify-content: center;';
  overlay.innerHTML = `
    <div class="modal-content" style="max-width: 420px; padding: 28px;">
      <div style="font-size: 2.2rem; text-align: center; margin-bottom: 6px;">🔐</div>
      <div class="modal-title" style="text-align: center; margin-bottom: 10px;">${t.title}</div>
      <div style="font-size: 0.9rem; color: var(--text-muted); line-height: 1.6; margin-bottom: 16px;">${t.desc}</div>
      <input type="password" id="force-prefix-current" class="input-control" placeholder="${t.cur}" style="margin-bottom: 10px; ${gForcePrefixKnownPassword ? 'display:none;' : ''}">
      <input type="password" id="force-prefix-new" class="input-control" placeholder="${t.pre}" style="margin-bottom: 10px;">
      <input type="password" id="force-prefix-new2" class="input-control" placeholder="${t.pre2}" style="margin-bottom: 10px;">
      <div id="force-prefix-error" style="color: #dc2626; font-size: 0.85rem; min-height: 1.2em; margin-bottom: 10px;"></div>
      <button id="force-prefix-save" class="btn" style="width: 100%;">${t.btn}</button>
    </div>`;
  document.body.appendChild(overlay);
  const errBox = overlay.querySelector('#force-prefix-error');
  overlay.querySelector('#force-prefix-save').addEventListener('click', async () => {
    const cur = gForcePrefixKnownPassword || overlay.querySelector('#force-prefix-current').value;
    const p1 = overlay.querySelector('#force-prefix-new').value.trim();
    const p2 = overlay.querySelector('#force-prefix-new2').value.trim();
    errBox.textContent = '';
    if (!cur) { errBox.textContent = isEn ? 'Please enter the current password.' : '請輸入今日目前密碼。'; return; }
    if (p1.length < 4) { errBox.textContent = isEn ? 'Prefix must be at least 4 characters.' : '字頭至少需要 4 碼。'; return; }
    if (p1.toLowerCase() === 'admin') { errBox.textContent = isEn ? 'The prefix cannot be "Admin".' : '字頭不可使用預設值 Admin。'; return; }
    if (p1 !== p2) { errBox.textContent = isEn ? 'The two prefixes do not match.' : '兩次輸入的字頭不一致。'; return; }
    try {
      const res = await API.post('/api/system/update_password_prefix', { current_password: cur, new_prefix: p1 });
      gForcePrefixKnownPassword = '';
      overlay.remove();
      alert(res.message);
      window.location.reload();
    } catch (err) {
      errBox.textContent = err.message || (isEn ? 'Failed to change the prefix.' : '修改字頭失敗。');
    }
  });
}
window.showForcePrefixModal = showForcePrefixModal;

async function submitAuthPassword() {
  const pwdInput = document.getElementById('auth-password-input');
  const pwd = pwdInput ? pwdInput.value : '';
  const isEn = window.I18n && window.I18n.getLanguage() === 'en';
  if (!pwd) {
    alert(isEn ? 'Please enter the password!' : '請輸入驗證密碼！');
    return;
  }

  try {
    const res = await API.post('/api/system/verify_password', { password: pwd });
    if (res.success) {
      localStorage.setItem('auth_token', res.auth_token);
      localStorage.setItem('auth_date', res.auth_date);

      if (res.must_change_prefix) {
        gForcePrefixKnownPassword = pwd;
        if (pwdInput) pwdInput.value = '';
        const overlayEl = document.getElementById('auth-overlay');
        if (overlayEl) overlayEl.classList.remove('open');
        showForcePrefixModal();
        return;
      }

      const urlParams = new URLSearchParams(window.location.search);
      const redirectUrl = urlParams.get('redirect');
      if (redirectUrl) {
        window.location.href = redirectUrl;
        return;
      }

      const authOverlay = document.getElementById('auth-overlay');
      if (authOverlay) authOverlay.classList.remove('open');
      if (pwdInput) pwdInput.value = '';
      await loadCourses();
      if (window.Timetable) window.Timetable.onAppReady();
      if (window.UpdateNotice) window.UpdateNotice.onAppReady();
      if (window.TeacherNotify) window.TeacherNotify.onAppReady();
    }
  } catch (err) {
    alert(err.message || (isEn ? 'Authentication failed!' : '密碼驗證失敗！'));
  }
}

function openForgotConfirmModal() {
  openModal('modal-forgot-confirm');
}

async function confirmForgotReset() {
  const isEn = window.I18n && window.I18n.getLanguage() === 'en';
  try {
    await API.post('/api/system/reset_password_prefix');
    const confirmModal = document.getElementById('modal-forgot-confirm');
    if (confirmModal) confirmModal.classList.remove('open');

    openModal('modal-reset-success');
  } catch (err) {
    alert((isEn ? 'Password reset failed: ' : '密碼重置失敗：') + err.message);
  }
}

async function savePasswordPrefix() {
  const currentPwd = document.getElementById('admin-current-password-input').value;
  const newPrefix = document.getElementById('admin-new-prefix-input').value.trim();
  const isEn = window.I18n && window.I18n.getLanguage() === 'en';

  if (!currentPwd) {
    alert(isEn ? 'Please enter current password!' : '請輸入目前驗證密碼！');
    return;
  }
  if (!newPrefix || newPrefix.length < 4) {
    alert(isEn ? 'New prefix must be at least 4 characters long!' : '新的密碼字頭長度至少必須為 4 碼！');
    return;
  }

  try {
    const res = await API.post('/api/system/update_password_prefix', {
      current_password: currentPwd,
      new_prefix: newPrefix
    });
    alert(isEn ? 'Password prefix modified successfully!' : res.message);
    document.getElementById('admin-current-password-input').value = '';
    document.getElementById('admin-new-prefix-input').value = '';
  } catch (err) {
    alert((isEn ? 'Failed to modify prefix: ' : '修改密碼字頭失敗：') + err.message);
  }
}

async function logout() {
  try {
    await API.post('/api/system/logout');
  } catch (err) {
    console.warn('Logout API error:', err);
  }
  localStorage.removeItem('auth_token');
  localStorage.removeItem('auth_date');
  const authOverlay = document.getElementById('auth-overlay');
  if (authOverlay) {
    const pwdInput = document.getElementById('auth-password-input');
    if (pwdInput) pwdInput.value = '';
    authOverlay.classList.add('open');
    showAuthPanel(getDefaultAuthPanel());
  }
}


// --- UI Theme & Avatar Helpers ---
window.StudentPhotoCache = window.StudentPhotoCache || {
  missing: new Set(),
  loaded: new Set()
};

function getStudentAvatarImgHtml(student, sizeStyle = 'width: 100%; height: 100%; object-fit: cover;') {
  if (!student) {
    return `<img src="/static/avatars/boy.png" alt="avatar" style="${sizeStyle}">`;
  }
  let realStudent = student;
  if (AppState && AppState.students && (student.id || student.student_id)) {
    const sid = student.id || student.student_id;
    const found = AppState.students.find(s => s.id === sid);
    if (found) realStudent = found;
  }

  const gender = realStudent.gender || 'M';
  const isFemale = gender === 'female' || gender === 'F' || gender === '女';
  const fallbackGenderSrc = isFemale ? '/static/avatars/girl.png' : '/static/avatars/boy.png';

  // 1. 若後端已告知無照片，直接顯示預設男女頭像，完全避免發送 404 與 onerror 閃爍
  if (realStudent.has_photo === false || student.has_photo === false) {
    return `<img src="${fallbackGenderSrc}" alt="avatar" style="${sizeStyle}">`;
  }

  const code = realStudent.student_code || student.student_code;
  if (!code) {
    return `<img src="${fallbackGenderSrc}" alt="avatar" style="${sizeStyle}">`;
  }

  const codeStr = String(code).trim();
  // 2. 若快取中已知此學號在 bin/photo 中無照片，直接返回預設頭像
  if (window.StudentPhotoCache && window.StudentPhotoCache.missing.has(codeStr)) {
    return `<img src="${fallbackGenderSrc}" alt="avatar" style="${sizeStyle}">`;
  }

  const primarySrc = `/photo/${encodeURIComponent(codeStr)}.jpg`;
  const onerrorChain = `if(window.StudentPhotoCache)window.StudentPhotoCache.missing.add('${codeStr}');this.onerror=null;this.src='${fallbackGenderSrc}';`;
  const onloadChain = `if(window.StudentPhotoCache)window.StudentPhotoCache.loaded.add('${codeStr}');`;

  return `<img src="${primarySrc}" alt="avatar" style="${sizeStyle}" onload="${onloadChain}" onerror="${onerrorChain}">`;
}

const ANIMAL_ICONS_LIST = [
  'penguin', 'rabbit', 'hedgehog', 'polar_bear', 'formosan_black_bear',
  'elephant', 'guinea_pig', 'dog', 'squirrel', 'sika_deer',
  'hippo', 'raccoon', 'sea_otter', 'dolphin', 'turtle',
  'koala', 'panda', 'fox', 'lion', 'cheetah',
  'tiger', 'snake', 'owl', 'giraffe', 'sparrow'
];

const ANIMAL_KEYWORD_MAP = [
  { keys: ['企鵝', 'penguin'], icon: 'penguin' },
  { keys: ['兔', 'rabbit'], icon: 'rabbit' },
  { keys: ['刺蝟', 'hedgehog'], icon: 'hedgehog' },
  { keys: ['北極熊', 'polar_bear', 'polar bear', 'white bear'], icon: 'polar_bear' },
  { keys: ['黑熊', '台灣黑熊', 'bear'], icon: 'formosan_black_bear' },
  { keys: ['象', '大象', 'elephant'], icon: 'elephant' },
  { keys: ['天竺鼠', 'guinea'], icon: 'guinea_pig' },
  { keys: ['狗', '犬', 'dog', 'puppy'], icon: 'dog' },
  { keys: ['松鼠', 'squirrel'], icon: 'squirrel' },
  { keys: ['鹿', '梅花鹿', 'deer'], icon: 'sika_deer' },
  { keys: ['河馬', 'hippo'], icon: 'hippo' },
  { keys: ['浣熊', 'raccoon'], icon: 'raccoon' },
  { keys: ['海獺', '水獺', 'otter'], icon: 'sea_otter' },
  { keys: ['海豚', 'dolphin'], icon: 'dolphin' },
  { keys: ['龜', '烏龜', 'turtle', 'tortoise'], icon: 'turtle' },
  { keys: ['無尾熊', 'koala'], icon: 'koala' },
  { keys: ['熊貓', '貓熊', 'panda'], icon: 'panda' },
  { keys: ['狐', '狐狸', 'fox'], icon: 'fox' },
  { keys: ['獅', '獅子', 'lion'], icon: 'lion' },
  { keys: ['獵豹', '花豹', '豹', 'cheetah', 'leopard'], icon: 'cheetah' },
  { keys: ['虎', '老虎', 'tiger'], icon: 'tiger' },
  { keys: ['蛇', 'snake'], icon: 'snake' },
  { keys: ['貓頭鷹', 'owl'], icon: 'owl' },
  { keys: ['長頸鹿', 'giraffe'], icon: 'giraffe' },
  { keys: ['麻雀', '鳥', 'sparrow', 'bird'], icon: 'sparrow' }
];

function getGroupAvatarSrc(group, fallbackIndex) {
  // 0. If group object has explicit custom icon_url
  if (group && typeof group === 'object' && (group.icon_url || group.group_icon_url)) {
    return group.icon_url || group.group_icon_url;
  }

  let name = '';
  if (typeof group === 'string') {
    name = group;
    // Look up in AppState.groups if available
    if (typeof AppState !== 'undefined' && AppState.groups) {
      const found = AppState.groups.find(g => g.group_name === name);
      if (found && (found.icon_url || found.group_icon_url)) {
        return found.icon_url || found.group_icon_url;
      }
    }
  } else if (group && typeof group === 'object') {
    name = group.group_name || group.name || '';
  }

  const nameLower = name.toLowerCase();

  // 1. Keyword match with animal names
  for (const item of ANIMAL_KEYWORD_MAP) {
    if (item.keys.some(k => nameLower.includes(k.toLowerCase()))) {
      return `/static/pic/animals/${item.icon}.png`;
    }
  }

  // 2. Fallback index or order_index or id mapped to 25 animal icons
  let idx = 0;
  if (typeof fallbackIndex === 'number' && fallbackIndex >= 0) {
    idx = fallbackIndex;
  } else if (group && typeof group === 'object') {
    if (typeof group.order_index === 'number' && group.order_index > 0) {
      idx = group.order_index - 1;
    } else if (typeof group.id === 'number' && group.id > 0) {
      idx = group.id - 1;
    }
  } else {
    const digitMatch = name.match(/\d+/);
    if (digitMatch) {
      const num = parseInt(digitMatch[0], 10);
      if (!isNaN(num) && num > 0) idx = num - 1;
    }
  }

  const animalName = ANIMAL_ICONS_LIST[idx % ANIMAL_ICONS_LIST.length];
  return `/static/pic/animals/${animalName}.png`;
}

function getGroupAvatarImgHtml(group, sizeStyle = 'width: 100%; height: 100%; object-fit: contain;', fallbackIndex) {
  const src = getGroupAvatarSrc(group, fallbackIndex);
  const name = typeof group === 'string' ? group : (group?.group_name || group?.name || '小組');
  return `<img src="${src}" alt="${name}" style="${sizeStyle}">`;
}
window.getGroupAvatarSrc = getGroupAvatarSrc;
window.getGroupAvatarImgHtml = getGroupAvatarImgHtml;

// --- Taiwan (Asia/Taipei, UTC+8) Date/Time Helpers ---
function getTaiwanTodayDateStr() {
  const formatter = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Taipei',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  });
  return formatter.format(new Date());
}

function getTaiwanNowDateTimeStr() {
  const formatter = new Intl.DateTimeFormat('sv-SE', {
    timeZone: 'Asia/Taipei',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit'
  });
  return formatter.format(new Date());
}

function initTheme() {
  document.documentElement.setAttribute('data-theme', 'light');
}

// --- Tab Navigation & Contextual Workflow Architecture（依「使用時機」分五大情境） ---
const TAB_TO_CONTEXT_MAP = {
  // 1. 課堂進行 (inclass)：上課當下連續使用
  scoring: 'inclass',
  dashboard: 'inclass',
  notes: 'inclass',
  toolkit: 'inclass',
  // 舊代碼相容：互動牆／文字雲／答題競賽已併入「教學互動工具」
  liveWall: 'inclass',
  wordCloud: 'inclass',
  kahoot: 'inclass',

  // 2. 班級經營 (routine)：導師每日例行（依一天的時間流程排列）
  attendance: 'routine',
  whereabouts: 'routine',
  journal: 'routine',

  // 3. 教材與作業 (teaching)：備課與課後
  materials: 'teaching',
  filecollect: 'teaching',
  hwscan: 'teaching',
  paperQuiz: 'teaching',

  // 4. 激勵與統計 (assessment)：回顧、獎勵與報表
  rewards: 'assessment',
  pointcards: 'assessment',
  reports: 'assessment',

  // 5. 設定 (settings)：學期初與偶爾調整
  timetable: 'settings',
  students: 'settings',
  seating: 'settings',
  grouping: 'settings',
  rules: 'settings',
  appearance: 'settings',
  security: 'settings',
  manual: 'settings',
  admin: 'settings'
};

// 這幾個舊次分頁沒有自己的內容面板，而是顯示「教學互動工具」面板裡對應的子分頁（供舊代碼相容）
const TAB_PANE_ALIAS = {
  liveWall: { pane: 'toolkit', sub: 'liveWall' },
  wordCloud: { pane: 'toolkit', sub: 'wordCloud' },
  kahoot: { pane: 'toolkit', sub: 'kahoot' }
};

const CONTEXT_DEFAULT_TAB_MAP = {
  inclass: 'scoring',
  routine: 'attendance',
  teaching: 'materials',
  assessment: 'rewards',
  settings: 'students',
  // 舊代碼相容
  live: 'scoring',
  activity: 'toolkit',
  logs: 'attendance',
  manage: 'students',
  admin: 'appearance'
};

const lastActiveTabPerContext = {
  inclass: 'scoring',
  routine: 'attendance',
  teaching: 'materials',
  assessment: 'rewards',
  settings: 'students',
  // 舊代碼相容
  live: 'scoring',
  activity: 'toolkit',
  logs: 'attendance',
  manage: 'students',
  admin: 'appearance'
};

function switchTab(tabName) {
  // No-op on a redundant click (already on this tab) — without this guard, every
  // click fully tears down and rebuilds the current pane (including refetching
  // data and recreating every student avatar <img>) even when nothing changes,
  // which turns any rapid repeat-click (e.g. a flaky mouse double-click) into a
  // visible flicker. Mirrors the equivalent guard in student.js's switchTab().
  const targetTab = document.querySelector(`.nav-tab[data-tab="${tabName}"]`);
  if (targetTab && targetTab.classList.contains('active')) return;

  if (getActiveTabName() === 'paperQuiz' && typeof triggerPaperQuizAutoSave === 'function') {
    triggerPaperQuizAutoSave(true);
  }

  // Auto-flush in-progress bulletin post edit before leaving tab
  if (window.TeachingToolkit?.bulletin && typeof window.TeachingToolkit.bulletin.flushActivePost === 'function') {
    window.TeachingToolkit.bulletin.flushActivePost();
  }

  // Auto-commit pending quick scores if any before leaving tab
  if (AppState.quickScoringMode && AppState.pendingQuickScores) {
    const hasPending = Object.values(AppState.pendingQuickScores).some(s => Number(s) !== 0);
    if (hasPending) {
      commitPendingQuickScores();
    }
  }

  // Auto-hide floating score popover & clear selection on tab switch
  const popover = document.getElementById('cursor-score-popover');
  if (popover) {
    popover.style.display = 'none';
  }
  AppState.selectedStudentIds.clear();
  renderScoringStudentGrid();

  // Determine parent context (inclass / routine / assessment / settings)
  const rawContext = TAB_TO_CONTEXT_MAP[tabName] || 'inclass';
  const legacyMap = { live: 'inclass', activity: 'inclass', logs: 'routine', manage: 'settings', admin: 'settings' };
  const context = legacyMap[rawContext] || rawContext;
  lastActiveTabPerContext[context] = tabName;
  try {
    localStorage.setItem('teachsys_active_context', context);
  } catch (e) {}

  // Sync Tier 1 Desktop Scenario Pills
  document.querySelectorAll('.scenario-pill').forEach(pill => {
    pill.classList.toggle('active', pill.dataset.context === context);
  });

  // Sync Tier 2 Desktop Context Subtab Groups
  document.querySelectorAll('.context-subtab-group').forEach(grp => {
    const isCurrent = grp.dataset.context === context;
    grp.classList.toggle('active', isCurrent);
    grp.style.display = isCurrent ? 'flex' : 'none';
  });

  // Sync Mobile Scenario Pills
  document.querySelectorAll('.mobile-scenario-btn').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.context === context);
  });

  const tabs = document.querySelectorAll('.nav-tab');
  tabs.forEach(t => {
    if (t.dataset.tab === tabName) {
      t.classList.add('active');
    } else {
      t.classList.remove('active');
    }
  });

  const mobileSelect = document.getElementById('mobile-tab-select');
  if (mobileSelect && mobileSelect.value !== tabName) {
    mobileSelect.value = tabName;
  }

  // 「課堂活動」的次分頁沒有獨立面板：顯示教學小工具面板，並切到對應的子分頁
  const alias = TAB_PANE_ALIAS[tabName] || null;
  const paneName = alias ? alias.pane : tabName;

  document.querySelectorAll('.tab-pane').forEach(p => p.classList.remove('active'));
  const targetPane = document.getElementById(`pane-${paneName}`);
  if (targetPane) targetPane.classList.add('active');

  if (paneName === 'toolkit') {
    // 教學互動工具：公布欄／抽籤／計時／互動牆／文字雲／答題競賽 全部在同一個面板的子分頁列
    if (window.TeachingToolkit && alias) {
      window.TeachingToolkit.switchSubtab(alias.sub);
    }
  }

  // Handle Toolkit Timer BGM auto-pause / resume on main tab switch
  if (window.TeachingToolkit?.timer) {
    if (paneName === 'toolkit') {
      const activeSubtab = document.querySelector('.toolkit-subtab-btn.active')?.dataset.toolkitTab;
      if (activeSubtab === 'timer') {
        window.TeachingToolkit.timer.onEnterTimerTab();
      }
    } else {
      window.TeachingToolkit.timer.onLeaveTimerTab();
    }
  }

  // Handle Toolkit LiveWall auto-close when leaving toolkit tab
  if (window.TeachingToolkit?.liveWall && paneName !== 'toolkit') {
    window.TeachingToolkit.liveWall.onLeaveLiveWallTab();
  }

  // Always refresh — every case in refreshActiveTab() already guards for a missing
  // course itself (inline empty-course notice, or for 'toolkit' a prompt + redirect
  // to the course-independent Timer sub-tab). Gating this call on currentCourseId
  // used to skip that per-tab handling entirely whenever no course existed yet.
  refreshActiveTab(tabName);

  // No class exists anywhere in the system yet — besides each pane's inline
  // empty-course notice, also pop the create-class modal so it's impossible
  // to miss regardless of which function tab was just entered.
  // 例外：課表屬於教師本人，不需要先有班級（班級可在課表的任教設定裡建立）。
  if ((!AppState.courses || AppState.courses.length === 0) && tabName !== 'timetable') {
    openModal('modal-add-course');
  }
}

function initNavTabs() {
  const tabs = document.querySelectorAll('.nav-tab');
  tabs.forEach(tab => {
    tab.addEventListener('click', () => {
      switchTab(tab.dataset.tab);
    });
  });

  // Context Scenario Pills (Desktop & Mobile)
  document.querySelectorAll('.scenario-pill, .mobile-scenario-btn').forEach(btn => {
    btn.addEventListener('click', (e) => {
      const rawCtx = e.currentTarget.dataset.context;
      if (!rawCtx) return;
      const legacyMap = { live: 'inclass', activity: 'inclass', logs: 'routine', manage: 'settings', admin: 'settings' };
      const targetContext = legacyMap[rawCtx] || rawCtx;
      const targetTab = lastActiveTabPerContext[targetContext] || CONTEXT_DEFAULT_TAB_MAP[targetContext] || 'scoring';
      switchTab(targetTab);
    });
  });

  const mobileSelect = document.getElementById('mobile-tab-select');
  if (mobileSelect) {
    mobileSelect.addEventListener('change', (e) => {
      switchTab(e.target.value);
    });
  }

  initScoringViewToggle();
}

function getActiveTabName() {
  const activeTab = document.querySelector('.nav-tab.active');
  return activeTab ? activeTab.dataset.tab : 'scoring';
}

function refreshActiveTab(tabName, force = false) {
  switch (tabName) {
    case 'scoring':
      loadScoringData();
      break;
    case 'attendance':
      loadAttendanceData();
      break;
    case 'whereabouts':
      if (window.Whereabouts) window.Whereabouts.load();
      break;
    case 'timetable':
      if (window.Timetable) window.Timetable.load();
      break;
    case 'seating':
      loadSeatingData();
      break;
    case 'grouping':
      loadGroupingData();
      break;
    case 'notes':
      loadNotesData();
      break;
    case 'journal':
      if (window.LessonJournal) window.LessonJournal.load();
      break;
    case 'paperQuiz':
      loadPaperQuizData(force);
      break;
    case 'dashboard':
      // Force refresh on tab switch so all dashboard sections always reflect latest scores
      loadDashboardData(true);
      break;
    case 'materials':
      if (window.LmsMaterials) window.LmsMaterials.load();
      break;
    case 'toolkit':
    case 'liveWall':
    case 'wordCloud':
    case 'kahoot':
      loadToolkitData();
      break;
    case 'students':
      loadAdminStudentsData();
      break;
    case 'rules':
      loadAdminRulesData();
      break;
    case 'reports':
      break;
    case 'rewards':
      if (window.RewardsManager && typeof window.RewardsManager.reload === 'function') {
        window.RewardsManager.reload();
      }
      break;
    case 'filecollect':
      if (window.FileCollectManager && typeof window.FileCollectManager.load === 'function') {
        window.FileCollectManager.load();
      }
      break;
    case 'hwscan':
      if (window.HomeworkScan) window.HomeworkScan.load();
      break;
    case 'pointcards':
      if (window.PointCardsManager && typeof window.PointCardsManager.reload === 'function') {
        window.PointCardsManager.reload();
      }
      break;
    case 'appearance':
      break;
    case 'security':
      break;
    case 'manual':
      break;
    case 'admin':
      loadAdminData();
      break;
  }
}

async function loadToolkitData() {
  if (!AppState.currentCourseId) {
    // 課堂公布欄／隨機抽籤子分頁需要課程資料，改為顯示跟其他分頁一致的「尚無班級」提示卡；
    // 計時器與碼錶不受影響，維持可用，不強制切換子分頁。
    if (window.TeachingToolkit) window.TeachingToolkit.setCourseAvailability(false);
    return;
  }
  if (window.TeachingToolkit) {
    window.TeachingToolkit.setCourseAvailability(true);
    if (window.TeachingToolkit.bulletin) {
      window.TeachingToolkit.bulletin.loadCourse(AppState.currentCourseId);
    }
  }
  try {
    // Use the dashboard endpoint (not the plain roster) so each student
    // carries today's is_absent flag — Lucky Draw depends on it to exclude
    // absent/on-leave students from the draw pool.
    const [dashData, groupsData] = await Promise.all([
      API.get(`/api/reports/${AppState.currentCourseId}/dashboard?period=today`),
      API.get(`/api/groups/${AppState.currentCourseId}`)
    ]);
    AppState.students = dashData.students || [];
    AppState.groups = groupsData.groups || [];
    if (window.TeachingToolkit) {
      window.TeachingToolkit.onCourseLoaded(AppState.currentCourseId, AppState.students, AppState.groups);
    }
  } catch (err) {
    console.error('loadToolkitData error:', err);
  }
}

// Global Quick Award Score (Used by Lucky Draw, etc.)
window.quickAwardScore = async function(targetId, type, points = 1, ruleTitle = '🎲 抽籤表現優良') {
  if (!ensureCourseSelected()) return;
  try {
    if (type === 'student') {
      const student = AppState.students.find(s => s.id === targetId);
      const studentName = getStudentDisplayName(student);
      await API.post(`/api/scores/${AppState.currentCourseId}/add`, {
        student_ids: [targetId],
        score: points,
        rule_title: ruleTitle,
        category: points >= 0 ? 'positive' : 'negative'
      });
      showToast(`✨ 已為【${student ? `${student.student_number}號 ` : ''}${studentName}】加 ${points} 分！`, 'positive');
    } else {
      const group = (AppState.groups || []).find(g => g.id === targetId);
      const groupName = group ? group.group_name : '小組';
      const sids = (group && group.students) ? group.students.map(s => s.id) : [];
      await API.post(`/api/scores/${AppState.currentCourseId}/add`, {
        student_ids: sids,
        score: points,
        rule_title: ruleTitle,
        category: points >= 0 ? 'positive' : 'negative',
        group_id: targetId,
        plan_id: (group && group.plan_id) ? group.plan_id : AppState.activeGroupPlanId
      });
      showToast(`✨ 已為【${groupName}】全組加 ${points} 分！`, 'positive');
    }
    loadScoringData();
    notifyScoreUpdates();
  } catch (err) {
    console.error('quickAwardScore error:', err);
    showToast('加分失敗，請重試', 'error');
  }
};

// --- Courses & Students ---
async function loadStudents() {
  if (!AppState.currentCourseId) return [];
  try {
    // Dashboard (not the plain roster) so every AppState.students entry keeps
    // its is_absent flag — Lucky Draw reads this, and this function is what
    // quickAwardScore() calls to refresh state right after a draw, so an
    // is_absent-less roster here silently breaks the "skip absent" filter on
    // the very next draw.
    const dashData = await API.get(`/api/reports/${AppState.currentCourseId}/dashboard?period=today`);
    const students = dashData.students || [];
    AppState.students = students;
    if (window.TeachingToolkit) {
      window.TeachingToolkit.onCourseLoaded(AppState.currentCourseId, AppState.students, AppState.groups);
    }
    return students;
  } catch (err) {
    console.error('loadStudents error:', err);
    return [];
  }
}

// --- Empty State UI Helpers ---
function renderEmptyCourseNotice(container, customTitle = null) {
  if (!container) return;
  const isEn = window.I18n && window.I18n.getLanguage() === 'en';
  const t = (k, p) => window.I18n ? window.I18n.t(k, p) : k;

  const title = customTitle || (isEn ? 'No courses in system yet' : '目前系統中尚無任何班級');
  const desc = isEn 
    ? 'Welcome to the Classroom Management System! Click the button below to create your first class. Once created, you can import student rosters, arrange seating, organize group competitions, and assign points!'
    : '歡迎使用國小課堂即時記錄系統！請先點擊下方按鈕建立您的第一個班級課程。建立班級後即可進行學生名冊匯入、座位劃分、小組競賽與點數評分！';
  const createBtnText = isEn ? '➕ Click here to create a class' : '➕ 請按此先建立班級';
  const templateTitle = isEn ? '📥 Student roster sample files (ready to import once created):' : '📥 學生名冊匯入範例檔案下載（建立班級後可直接匯入）：';
  const dlExcel = isEn ? '📥 Download Excel Sample (.xlsx)' : '📥 下載 Excel 範例檔 (.xlsx)';
  const dlCsv = isEn ? '📥 Download CSV Sample (.csv)' : '📥 下載 CSV 範例檔 (.csv)';

  container.innerHTML = `
    <div class="glass-card" style="text-align: center; padding: 36px 20px; background: linear-gradient(135deg, rgba(91, 124, 214,0.06), rgba(149, 117, 196,0.06)); border: 2px dashed var(--primary-light); grid-column: 1 / -1; margin: 10px 0;">
      <div style="font-size: 3rem; margin-bottom: 12px;">🏫</div>
      <div style="font-size: 1.3rem; font-weight: 800; color: var(--text-main); margin-bottom: 8px;">${title}</div>
      <div style="font-size: 0.92rem; color: var(--text-muted); max-width: 500px; margin: 0 auto 20px; line-height: 1.6;">
        ${desc}
      </div>
      <div style="display: flex; gap: 12px; justify-content: center; flex-wrap: wrap; margin-bottom: 24px;">
        <button onclick="openModal('modal-add-course')" class="btn" style="padding: 10px 24px; font-size: 1.05rem; font-weight: 800; box-shadow: var(--shadow-primary);">
          ${createBtnText}
        </button>
      </div>
      <div style="border-top: 1px dashed var(--card-border); padding-top: 18px; margin-top: 10px;">
        <div style="font-size: 0.9rem; font-weight: 700; color: var(--text-muted); margin-bottom: 12px;">
          ${templateTitle}
        </div>
        <div style="display: flex; gap: 12px; justify-content: center; flex-wrap: wrap;">
          <a href="/api/courses/template/students_excel" data-auth-download="學生名冊匯入範例.xlsx" class="btn btn-secondary" style="text-decoration: none; padding: 8px 16px; font-size: 0.9rem; display: inline-flex; align-items: center; gap: 6px;">
            ${dlExcel}
          </a>
          <a href="/api/courses/template/students_csv" data-auth-download="學生名冊匯入範例.csv" class="btn btn-secondary" style="text-decoration: none; padding: 8px 16px; font-size: 0.9rem; display: inline-flex; align-items: center; gap: 6px;">
            ${dlCsv}
          </a>
        </div>
      </div>
    </div>
  `;
}

function renderEmptyStudentRosterNotice(container) {
  if (!container) return;
  const isEn = window.I18n && window.I18n.getLanguage() === 'en';
  const t = (k, p) => window.I18n ? window.I18n.t(k, p) : k;

  const title = isEn ? 'No student roster in this class yet' : '本班級目前尚無學生名冊';
  const desc = isEn
    ? 'You can add students manually, paste a text list, or download the template file to upload and import all students at once!'
    : '您可以使用下方按鈕手動新增單一位學生、貼上文字名單，或先下載標準範例檔，填寫完畢後上傳匯入全班學生！';
  const addBtn = isEn ? '➕ Add Student Manually' : '➕ 手動新增學生';
  const importBtn = isEn ? '📥 Import Student Roster' : '📥 匯入學生名冊';
  const templateTitle = isEn ? '📥 Student roster template download:' : '📥 學生名冊範本檔案下載：';
  const dlExcel = isEn ? '📥 Download Excel Template (.xlsx)' : '📥 下載 Excel 範本 (.xlsx)';
  const dlCsv = isEn ? '📥 Download CSV Template (.csv)' : '📥 下載 CSV 範本 (.csv)';

  container.innerHTML = `
    <div class="glass-card" style="text-align: center; padding: 36px 20px; border: 2px dashed var(--card-border); grid-column: 1 / -1; margin: 10px 0;">
      <div style="font-size: 2.8rem; margin-bottom: 10px;">👨‍🎓</div>
      <div style="font-size: 1.2rem; font-weight: 800; color: var(--text-main); margin-bottom: 6px;">${title}</div>
      <div style="font-size: 0.9rem; color: var(--text-muted); max-width: 480px; margin: 0 auto 18px; line-height: 1.6;">
        ${desc}
      </div>
      <div style="display: flex; gap: 12px; justify-content: center; flex-wrap: wrap; margin-bottom: 20px;">
        <button onclick="openAddStudentModal()" class="btn btn-secondary" style="padding: 8px 18px; font-size: 0.9rem;">${addBtn}</button>
        <button onclick="openModal('modal-import-students')" class="btn" style="padding: 8px 20px; font-size: 0.9rem; font-weight: 700;">${importBtn}</button>
      </div>
      <div style="border-top: 1px dashed var(--card-border); padding-top: 16px; margin-top: 6px;">
        <div style="font-size: 0.85rem; font-weight: 700; color: var(--text-muted); margin-bottom: 10px;">${templateTitle}</div>
        <div style="display: flex; gap: 10px; justify-content: center; flex-wrap: wrap;">
          <a href="/api/courses/template/students_excel" data-auth-download="學生名冊匯入範例.xlsx" class="btn btn-secondary" style="text-decoration: none; padding: 6px 14px; font-size: 0.85rem; display: inline-flex; align-items: center; gap: 6px;">${dlExcel}</a>
          <a href="/api/courses/template/students_csv" data-auth-download="學生名冊匯入範例.csv" class="btn btn-secondary" style="text-decoration: none; padding: 6px 14px; font-size: 0.85rem; display: inline-flex; align-items: center; gap: 6px;">${dlCsv}</a>
        </div>
      </div>
    </div>
  `;
}

function renderActiveTabEmptyNotice() {
  renderEmptyCourseNotice(document.getElementById('scoring-student-grid'));
  renderEmptyCourseNotice(document.getElementById('scoring-seating-grid'));
  renderEmptyCourseNotice(document.getElementById('attendance-student-grid'));
  renderEmptyCourseNotice(document.getElementById('seating-grid'));
  renderEmptyCourseNotice(document.getElementById('group-columns-container'));
  renderEmptyCourseNotice(document.getElementById('notes-list-container'));
  renderEmptyCourseNotice(document.getElementById('all-students-score-grid'));
  renderEmptyCourseNotice(document.getElementById('individual-leaderboard'));
  renderEmptyCourseNotice(document.getElementById('admin-students-list-container'));
  renderEmptyCourseNotice(document.getElementById('materials-units-list'));
  if (window.TeachingToolkit) window.TeachingToolkit.setCourseAvailability(false);
}

function renderCourseSelectOptions() {
  const select = document.getElementById('course-select');
  const btnDelete = document.getElementById('btn-delete-course');
  const btnPaneDelete = document.getElementById('btn-pane-delete-course');
  if (!select) return;
  const isEn = window.I18n && window.I18n.getLanguage() === 'en';
  const courses = AppState.courses || [];

  if (btnDelete) btnDelete.disabled = courses.length === 0;
  if (btnPaneDelete) btnPaneDelete.disabled = courses.length === 0;

  if (courses.length === 0) {
    select.innerHTML = `<option value="">${isEn ? '(No class, click ➕ to add)' : '(無課程，請按 ➕ 新增)'}</option>`;
    return;
  }

  const currentVal = AppState.currentCourseId || select.value;
  select.innerHTML = '';
  courses.forEach(c => {
    const opt = document.createElement('option');
    opt.value = c.id;
    const countText = isEn ? `${c.student_count || 0} students` : `${c.student_count || 0}人`;
    opt.textContent = `${c.teacher_type === 'homeroom' ? '🏫' : '🎨'} ${c.name} (${countText})`;
    select.appendChild(opt);
  });

  if (currentVal && courses.some(c => c.id == currentVal)) {
    select.value = currentVal;
  }
}

async function loadCourses() {
  try {
    const courses = await API.get('/api/courses');
    AppState.courses = courses;
    renderCourseSelectOptions();

    if (courses.length === 0) {
      AppState.currentCourseId = null;
      renderActiveTabEmptyNotice();
      openModal('modal-add-course');
      return;
    }

    if (!AppState.currentCourseId && courses.length > 0) {
      AppState.currentCourseId = courses[0].id;
    } else if (courses.length > 0 && !courses.some(c => c.id === AppState.currentCourseId)) {
      AppState.currentCourseId = courses[0].id;
    }

    const select = document.getElementById('course-select');
    if (select) select.value = AppState.currentCourseId;
    syncAppRealtimeConnection();
    refreshActiveTab(getActiveTabName());
  } catch (err) {
    const isEn = window.I18n && window.I18n.getLanguage() === 'en';
    alert(isEn ? `Failed to load courses: ${err.message}` : `載入課程失敗：${err.message}`);
  }
}

// --- Scoring Pane ---
async function loadScoringData() {
  if (!AppState.currentCourseId || (AppState.courses && AppState.courses.length === 0)) {
    renderEmptyCourseNotice(document.getElementById('scoring-student-grid'));
    renderEmptyCourseNotice(document.getElementById('scoring-seating-grid'));
    return;
  }
  try {
    const period = AppState.scoringPeriod || 'today';
    let dashUrl = `/api/reports/${AppState.currentCourseId}/dashboard?period=${period}`;
    if (period === 'range') {
      const s = AppState.scoringStartDate || document.getElementById('scoring-start-date')?.value;
      const e = AppState.scoringEndDate || document.getElementById('scoring-end-date')?.value;
      if (s && e) {
        dashUrl += `&start_date=${encodeURIComponent(s)}&end_date=${encodeURIComponent(e)}`;
      }
    }

    const [rules, dashData, groupsData, seatingData] = await Promise.all([
      API.get(`/api/scores/${AppState.currentCourseId}/rules`),
      API.get(dashUrl),
      API.get(`/api/groups/${AppState.currentCourseId}`),
      API.get(`/api/seating/${AppState.currentCourseId}`).catch(err => {
        console.warn('Seating chart fetch failed:', err);
        return null;
      })
    ]);

    AppState.rules = rules;
    AppState.students = dashData.students;
    AppState.groups = groupsData.groups;
    if (seatingData) {
      AppState.seatingData = seatingData;
    }
    if (dashData.plan && dashData.plan.id) {
      AppState.activeGroupPlanId = dashData.plan.id;
    } else if (groupsData.current_plan && groupsData.current_plan.id) {
      AppState.activeGroupPlanId = groupsData.current_plan.id;
    }

    // Map real-time group scores from dashboard data
    AppState.groupScoresMap = {};
    (dashData.group_leaderboard || []).forEach(g => {
      if (g.id) AppState.groupScoresMap[g.id] = g.total_score;
      if (g.group_name) AppState.groupScoresMap[g.group_name] = g.total_score;
    });

    renderRulesBar();
    renderQuickGroupBar();
    renderScoringView();
    updateScoringPeriodUI();
    if (window.TeachingToolkit && window.TeachingToolkit.floatingDock) {
      window.TeachingToolkit.floatingDock.updatePoolBadge();
    }
  } catch (err) {
    console.error('Scoring data load error:', err);
  }
}

function updateScoringPeriodUI() {
  const period = AppState.scoringPeriod || 'today';
  document.querySelectorAll('.scoring-period-btn').forEach(b => {
    if (b.dataset.period === period) {
      b.classList.add('active');
      b.classList.remove('btn-secondary');
    } else {
      b.classList.remove('active');
      b.classList.add('btn-secondary');
    }
  });

  const rangeInputs = document.getElementById('scoring-range-inputs');
  if (rangeInputs) {
    rangeInputs.style.display = period === 'range' ? 'flex' : 'none';
  }

  const badge = document.getElementById('scoring-period-badge');
  if (badge) {
    const isEn = window.I18n && window.I18n.getLanguage() === 'en';
    const prefix = window.I18n ? window.I18n.t('scoring_period_badge_prefix', '分數統計：') : '分數統計：';
    let label = isEn ? 'Today' : '當天';
    if (period === 'week') {
      label = isEn ? 'This Week' : '當週';
    } else if (period === 'month') {
      label = isEn ? 'This Month' : '當月';
    } else if (period === 'range') {
      const s = document.getElementById('scoring-start-date')?.value || AppState.scoringStartDate;
      const e = document.getElementById('scoring-end-date')?.value || AppState.scoringEndDate;
      if (s && e) {
        label = `${s} ~ ${e}`;
      } else {
        label = isEn ? 'Custom Range (Select Dates)' : '指定期間 (請選擇日期)';
      }
    }
    badge.textContent = `📅 ${prefix}${label}`;
  }
}

function renderRulesBar() {
  const container = document.getElementById('rules-container');
  container.innerHTML = '';

  AppState.rules.forEach(rule => {
    const btn = document.createElement('button');
    btn.className = `rule-btn ${rule.category}`;
    const changeText = rule.score_value > 0 ? `+${rule.score_value}` : `${rule.score_value}`;
    const displayTitle = window.I18n ? window.I18n.getRuleDisplayTitle(rule.title) : rule.title;
    btn.innerHTML = `
      <span>${rule.icon} ${displayTitle}</span>
      <span class="score-badge-change">${changeText}</span>
    `;
    btn.addEventListener('click', () => applyScoreRule(rule));
    container.appendChild(btn);
  });

  // Append integrated Qualitative Text Note button inside scoring popover!
  const noteBtn = document.createElement('button');
  noteBtn.className = 'rule-btn';
  noteBtn.style.borderColor = 'rgba(167, 139, 250, 0.5)';
  noteBtn.style.background = 'rgba(167, 139, 250, 0.15)';
  const noteBtnText = window.I18n ? window.I18n.t('notes_card_title') : '📝 特殊表現紀錄';
  noteBtn.innerHTML = `<span>${noteBtnText}</span>`;
  noteBtn.addEventListener('click', openQuickNoteModal);
  container.appendChild(noteBtn);
}

function openQuickNoteModal() {
  if (AppState.selectedStudentIds.size === 0) {
    alert('請先點選至少一位學生！');
    return;
  }

  // Enforce Single Student Record: retain only the LAST selected student!
  const selectedArr = Array.from(AppState.selectedStudentIds);
  openQuickNoteForStudent(selectedArr[selectedArr.length - 1]);
}

// 直接替某位學生開啟快速紀錄視窗（學生卡片上的 📝 按鈕與評分彈窗共用）
function openQuickNoteForStudent(targetStudentId) {
  AppState.selectedStudentIds.clear();
  AppState.selectedStudentIds.add(targetStudentId);
  renderScoringStudentGrid();

  const student = AppState.students.find(s => s.id === targetStudentId);
  const studentName = student ? `${student.student_number}號 ${getStudentDisplayName(student)}` : '';
  const avatarHtml = student ? `<span style="width: 28px; height: 28px; border-radius: 50%; overflow: hidden; display: inline-block; vertical-align: middle; margin-right: 6px;">${getStudentAvatarImgHtml(student)}</span>` : '';

  const dateInput = document.getElementById('quick-note-date');
  dateInput.value = getTaiwanTodayDateStr();

  document.getElementById('quick-note-modal-title').innerHTML = `📝 ${avatarHtml}【${studentName}】特殊表現紀錄`;
  document.getElementById('quick-note-text').value = '';
  renderNotePhraseChips('quick-note-phrase-chips', 'quick-note-text');
  resetNoteMedia(QUICK_NOTE_MEDIA_INPUT_IDS);
  openModal('modal-quick-note');
}

// 學生卡片右上角的 📝 快速紀錄按鈕
function attachCardNoteButton(cardEl, student) {
  const t = (k, p) => window.I18n ? window.I18n.t(k, p) : k;
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'card-note-btn';
  btn.textContent = '📝';
  btn.title = t('notes_card_title');
  btn.setAttribute('aria-label', t('notes_card_title'));
  btn.addEventListener('click', (e) => {
    e.stopPropagation();
    openQuickNoteForStudent(student.id);
  });
  cardEl.appendChild(btn);
}

async function confirmSaveQuickNote() {
  const selectedArr = Array.from(AppState.selectedStudentIds);
  if (selectedArr.length === 0) return;
  const studentId = selectedArr[0];
  const dateStr = document.getElementById('quick-note-date').value || getTaiwanTodayDateStr();
  const noteText = document.getElementById('quick-note-text').value.trim();
  const mediaFile = getNoteMediaFile(QUICK_NOTE_MEDIA_INPUT_IDS);

  if (!noteText && !mediaFile) {
    alert('請輸入紀錄內容或選擇照片/影片檔案！');
    return;
  }

  try {
    const formData = new FormData();
    formData.append('student_id', studentId);
    formData.append('note_text', noteText);
    formData.append('date_str', dateStr);
    if (mediaFile) {
      formData.append('media_file', mediaFile);
    }

    await API.postFormData(`/api/notes/${AppState.currentCourseId}/with_media`, formData);
    document.querySelectorAll('.modal-overlay').forEach(m => m.classList.remove('open'));
    showUndoToast(null, `已為【${getStudentDisplayName(AppState.students.find(s => s.id === studentId))}】新增質性紀錄！`);
    if (getActiveTabName() === 'notes') {
      loadNotesData();
    }
  } catch (err) {
    alert(`儲存特殊表現紀錄失敗：${err.message}`);
  }
}

// --- Scoring Module ---

// Bulk-select helper for the "全班"/小組 quick buttons: today's absent
// students are skipped entirely rather than added to the scoring selection,
// so a class-wide or group-wide score never lands on someone who isn't here.
function selectStudentsSkippingAbsent(candidateIds) {
  if (AppState.quickScoringMode) return;
  AppState.selectedStudentIds.clear();
  const absentIds = new Set(AppState.students.filter(s => s.is_absent).map(s => s.id));
  let skipped = 0;
  candidateIds.forEach(id => {
    if (absentIds.has(id)) {
      skipped++;
    } else {
      AppState.selectedStudentIds.add(id);
    }
  });
  renderScoringStudentGrid();
  if (skipped > 0 && typeof showToast === 'function') {
    const t = (k, p) => window.I18n ? window.I18n.t(k, p) : k;
    showToast(t('quick_select_skipped_absent', { count: skipped }), 'info');
  }
}

function renderQuickGroupBar() {
  const container = document.getElementById('quick-group-bar');
  if (!container) return;
  container.innerHTML = '';

  const isEn = window.I18n && window.I18n.getLanguage() === 'en';
  const t = (k, p) => window.I18n ? window.I18n.t(k, p) : k;
  const isQuick = Boolean(AppState.quickScoringMode);
  const disabledHint = isQuick ? (t('quick_scoring_groups_disabled_hint') || '快速加減分模式下無法選擇小組') : '';

  // 1. All Class button
  const allBtn = document.createElement('button');
  allBtn.className = 'btn btn-secondary';
  allBtn.style.fontSize = '0.85rem';
  allBtn.style.padding = '6px 14px';
  allBtn.style.display = 'inline-flex';
  allBtn.style.flexDirection = 'column';
  allBtn.style.alignItems = 'center';
  allBtn.style.justifyContent = 'center';
  allBtn.style.gap = '2px';
  allBtn.style.minWidth = '75px';
  if (isQuick) {
    allBtn.disabled = true;
    allBtn.setAttribute('title', disabledHint);
  }
  allBtn.innerHTML = `
    <div style="font-weight: 700; display: flex; align-items: center; gap: 4px;">
      <span>🏫</span>
      <span>${isEn ? 'All Class' : '全班'}</span>
    </div>
    <span style="font-size: 0.72rem; color: var(--text-muted); font-weight: 600;">(${AppState.students.length}${isEn ? ' students' : '人'})</span>
  `;
  allBtn.onclick = () => {
    if (AppState.quickScoringMode) return;
    AppState.currentScoringGroupTarget = null;
    selectStudentsSkippingAbsent(AppState.students.map(s => s.id));
  };
  container.appendChild(allBtn);

  // 2. Group buttons with Real-Time Score Badge beneath group name!
  (AppState.groups || []).forEach((g, idx) => {
    const btn = document.createElement('button');
    btn.className = 'btn btn-secondary';
    btn.style.fontSize = '0.85rem';
    btn.style.padding = '6px 14px';
    btn.style.display = 'inline-flex';
    btn.style.flexDirection = 'column';
    btn.style.alignItems = 'center';
    btn.style.justifyContent = 'center';
    btn.style.gap = '2px';
    btn.style.minWidth = '85px';
    if (isQuick) {
      btn.disabled = true;
      btn.setAttribute('title', disabledHint);
    }

    const groupScore = (AppState.groupScoresMap && AppState.groupScoresMap[g.id] !== undefined)
      ? AppState.groupScoresMap[g.id]
      : ((AppState.groupScoresMap && AppState.groupScoresMap[g.group_name] !== undefined)
          ? AppState.groupScoresMap[g.group_name]
          : 0);

    btn.innerHTML = `
      <div style="display: flex; align-items: center; gap: 6px; font-weight: 700;">
        <img src="${getGroupAvatarSrc(g, idx)}" alt="${g.group_name}" style="width: 18px; height: 18px; object-fit: contain;">
        <span class="quick-group-name-label">${g.group_name}</span>
      </div>
      <div class="quick-group-score-badge" style="font-size: 0.75rem; font-weight: 800; color: #d3a24c; background: rgba(211, 162, 76, 0.15); padding: 1px 8px; border-radius: 9999px; border: 1px solid rgba(211, 162, 76, 0.35); display: inline-flex; align-items: center; justify-content: center; margin-top: 1px;">
        <span>${groupScore} ${t('pts')}</span>
      </div>
    `;
    btn.onclick = () => {
      if (AppState.quickScoringMode) return;
      AppState.currentScoringGroupTarget = {
        plan_id: g.plan_id || AppState.activeGroupPlanId,
        group_id: g.id,
        group_name: g.group_name
      };
      selectStudentsSkippingAbsent((g.students || []).map(s => s.id));
    };
    container.appendChild(btn);
  });
}

let lastClickCoords = { x: window.innerWidth / 2, y: window.innerHeight / 2 };

async function toggleQuickScoringMode() {
  if (AppState.quickScoringMode) {
    // Closing quick scoring -> commit any pending staged scores!
    await commitPendingQuickScores();
    AppState.quickScoringMode = false;
    localStorage.setItem('quick_scoring_mode', 'false');
    updateQuickScoringToggleUI();
    renderScoringView();
  } else {
    // Opening quick scoring -> enter staged mode
    AppState.quickScoringMode = true;
    AppState.pendingQuickScores = {};
    AppState.selectedStudentIds.clear();
    AppState.currentScoringGroupTarget = null;
    updateFloatingScoringDrawer();
    localStorage.setItem('quick_scoring_mode', 'true');
    const groupBar = document.getElementById('quick-group-bar');
    if (groupBar && document.activeElement && groupBar.contains(document.activeElement)) {
      document.activeElement.blur();
    }
    updateQuickScoringToggleUI();
    renderScoringView();
  }
}

async function commitPendingQuickScores() {
  const pending = AppState.pendingQuickScores || {};
  const updates = Object.entries(pending)
    .filter(([_, score]) => Number(score) !== 0)
    .map(([sid, score]) => ({ student_id: Number(sid), score: Number(score) }));

  if (updates.length === 0) {
    AppState.pendingQuickScores = {};
    return;
  }

  const btn = document.getElementById('btn-toggle-quick-scoring');
  if (btn) {
    btn.disabled = true;
  }

  try {
    const res = await API.post(`/api/scores/${AppState.currentCourseId}/batch`, {
      updates
    });

    AppState.pendingQuickScores = {};

    const t = (k, p) => window.I18n ? window.I18n.t(k, p) : k;
    const msg = window.I18n
      ? window.I18n.t('quick_scoring_saved_toast', { count: updates.length })
      : `已成功計入 ${updates.length} 位學生的快速加減分！`;

    if (res.undo_id) {
      showUndoToast(res.undo_id, msg);
    } else {
      showToast(msg);
    }

    // Refresh student scores from server & broadcast to big screen
    await loadScoringData();
    notifyScoreUpdates();
  } catch (err) {
    console.error('Failed to commit quick scores:', err);
    alert(`快速評分計入失敗：${err.message}`);
  } finally {
    if (btn) {
      btn.disabled = false;
    }
  }
}

function updateQuickScoringToggleUI() {
  const btn = document.getElementById('btn-toggle-quick-scoring');
  const icon = document.getElementById('quick-score-toggle-icon');
  const text = document.getElementById('quick-score-toggle-text');
  const hint = document.getElementById('scoring-mode-hint');
  if (!btn) return;

  const t = (key, p) => window.I18n ? window.I18n.t(key, p) : key;
  const isSeating = AppState.scoringViewMode === 'seating';

  if (AppState.quickScoringMode) {
    btn.classList.add('active');
    if (icon) icon.textContent = '⚡';

    const pendingMap = AppState.pendingQuickScores || {};
    const pendingCount = Object.values(pendingMap).filter(v => Number(v) !== 0).length;
    let label = t('quick_scoring_on');
    if (pendingCount > 0) {
      label += t('quick_scoring_pending_suffix', { count: pendingCount });
    }
    if (text) text.textContent = label;
    if (hint) hint.textContent = t('scoring_hint_quick');
  } else {
    btn.classList.remove('active');
    if (icon) icon.textContent = '⚡';
    if (text) text.textContent = t('quick_scoring_off');
    if (hint) hint.textContent = isSeating ? t('scoring_hint_seating_normal') : t('scoring_hint_normal');
  }

  // Synchronize quick group bar buttons disabled state
  const groupBar = document.getElementById('quick-group-bar');
  if (groupBar) {
    const isQuick = Boolean(AppState.quickScoringMode);
    const disabledHint = isQuick ? (t('quick_scoring_groups_disabled_hint') || '快速加減分模式下無法選擇小組') : '';
    const groupButtons = groupBar.querySelectorAll('button');
    groupButtons.forEach(b => {
      b.disabled = isQuick;
      if (isQuick) {
        b.setAttribute('title', disabledHint);
      } else {
        b.removeAttribute('title');
      }
    });
  }
}

function stageQuickScore(student, delta, cardElement) {
  if (!AppState.pendingQuickScores) {
    AppState.pendingQuickScores = {};
  }
  const current = Number(AppState.pendingQuickScores[student.id]) || 0;
  const next = current + delta;
  AppState.pendingQuickScores[student.id] = next;

  // Find badge in cardElement or document
  const badge = cardElement
    ? cardElement.querySelector(`#quick-pending-${student.id}`)
    : document.getElementById(`quick-pending-${student.id}`);

  if (badge) {
    if (next > 0) {
      badge.textContent = `+${next}`;
      badge.className = 'quick-score-pending-badge has-pending positive';
    } else if (next < 0) {
      badge.textContent = `${next}`;
      badge.className = 'quick-score-pending-badge has-pending negative';
    } else {
      badge.textContent = '';
      badge.className = 'quick-score-pending-badge';
    }

    badge.classList.remove('pop-animate');
    void badge.offsetWidth;
    badge.classList.add('pop-animate');
  }

  updateQuickScoringToggleUI();
}

// --- Scoring View Mode Controller (Grid vs Seating) ---
function initScoringViewToggle() {
  const btnGrid = document.getElementById('btn-scoring-view-grid');
  const btnSeating = document.getElementById('btn-scoring-view-seating');
  const btnConfig = document.getElementById('btn-jump-seating-config');

  if (btnGrid) {
    btnGrid.addEventListener('click', () => {
      setScoringViewMode('grid');
    });
  }
  if (btnSeating) {
    btnSeating.addEventListener('click', () => {
      setScoringViewMode('seating');
    });
  }
  if (btnConfig) {
    btnConfig.addEventListener('click', () => {
      switchTab('seating');
    });
  }
}

function setScoringViewMode(mode) {
  AppState.scoringViewMode = mode;
  localStorage.setItem('scoring_view_mode', mode);
  updateScoringViewModeUI();
  if (mode === 'seating' && (!AppState.seatingData || AppState.seatingData.course_id !== AppState.currentCourseId)) {
    loadScoringSeatingDataAndRender();
  } else {
    renderScoringView();
  }
}

async function loadScoringSeatingDataAndRender() {
  if (!AppState.currentCourseId) return;
  try {
    const data = await API.get(`/api/seating/${AppState.currentCourseId}`);
    AppState.seatingData = data;
    renderScoringView();
  } catch (err) {
    console.error('Failed to load seating chart for scoring:', err);
    renderScoringView();
  }
}

function updateScoringViewModeUI() {
  const isSeating = AppState.scoringViewMode === 'seating';
  const btnGrid = document.getElementById('btn-scoring-view-grid');
  const btnSeating = document.getElementById('btn-scoring-view-seating');
  const btnConfig = document.getElementById('btn-jump-seating-config');
  const gridEl = document.getElementById('scoring-student-grid');
  const seatingEl = document.getElementById('scoring-seating-container');
  const hint = document.getElementById('scoring-mode-hint');

  if (btnGrid) btnGrid.classList.toggle('active', !isSeating);
  if (btnSeating) btnSeating.classList.toggle('active', isSeating);
  if (btnConfig) btnConfig.style.display = isSeating ? 'inline-flex' : 'none';
  if (gridEl) gridEl.style.display = isSeating ? 'none' : 'grid';
  if (seatingEl) seatingEl.style.display = isSeating ? 'block' : 'none';

  if (hint) {
    const isQuick = AppState.quickScoringMode;
    const t = (k, p) => window.I18n ? window.I18n.t(k, p) : k;
    if (isSeating) {
      hint.textContent = isQuick ? t('scoring_hint_seating_quick') : t('scoring_hint_seating_normal');
    } else {
      hint.textContent = isQuick ? t('scoring_hint_quick') : t('scoring_hint_normal');
    }
  }
}

function renderScoringView() {
  updateScoringViewModeUI();
  if (AppState.scoringViewMode === 'seating') {
    renderScoringSeatingView();
  } else {
    renderScoringStudentGrid();
  }
}

function renderScoringStudentGrid() {
  if (AppState.scoringViewMode === 'seating') {
    return renderScoringSeatingView();
  }

  const container = document.getElementById('scoring-student-grid');
  container.innerHTML = '';
  updateQuickScoringToggleUI();

  const isEn = window.I18n && window.I18n.getLanguage() === 'en';
  const t = (k, p) => window.I18n ? window.I18n.t(k, p) : k;

  AppState.students.forEach(student => {
    const isSelected = AppState.selectedStudentIds.has(student.id);
    const isAbsent = student.is_absent;
    const attStatus = student.today_attendance || 'present';
    const attLabels = {
      present: t('att_present'),
      sick_leave: t('att_sick_leave'),
      personal_leave: t('att_personal_leave'),
      official_leave: t('att_official_leave'),
      bereavement_leave: t('att_bereavement_leave'),
      late: t('att_late')
    };

    const displayName = getStudentDisplayName(student);
    const numText = isEn ? `No. ${student.student_number}` : `${student.student_number} 號`;
    const scoreUnit = t('pts');

    // Flash the card/badge when this student's score changed since the last render
    // (covers both this device's own scoring and pushes from other devices).
    const prevScore = prevStudentScoresMap[student.id];
    let cardFlashClass = '';
    let scoreAnimClass = '';
    if (prevScore !== undefined && prevScore !== null && prevScore !== student.score) {
      cardFlashClass = student.score > prevScore ? 'card-flash-up' : 'card-flash-down';
      scoreAnimClass = student.score > prevScore ? 'score-animate-up' : 'score-animate-down';
    }

    const card = document.createElement('div');
    card.className = `student-card ${isSelected ? 'selected' : ''} ${isAbsent ? 'absent' : ''} ${isAbsent ? `att-${attStatus}` : ''} ${cardFlashClass}`;
    card.dataset.studentId = student.id;
    if (isAbsent) {
      card.setAttribute('data-att-label', attLabels[attStatus] || '未出席');
    }

    const grpScore = (student.group_id && AppState.groupScoresMap && AppState.groupScoresMap[student.group_id] !== undefined)
      ? AppState.groupScoresMap[student.group_id]
      : ((student.group_name && AppState.groupScoresMap && AppState.groupScoresMap[student.group_name] !== undefined)
          ? AppState.groupScoresMap[student.group_name]
          : 0);

    const groupTagHtml = student.group_name
      ? `<div class="student-card-group-tag" style="font-size: 0.72rem; color: #60a5fa; font-weight: 700; background: rgba(123, 152, 224, 0.12); border: 1px solid rgba(123, 152, 224, 0.25); padding: 1px 7px; border-radius: 4px; display: inline-flex; align-items: center; gap: 4px; max-width: 92%; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; margin-bottom: 3px;"><span>🏷️ ${student.group_name}</span> <span style="color: #d3a24c; font-weight: 800;">${grpScore} ${scoreUnit}</span></div>`
      : '';

    if (AppState.quickScoringMode) {
      const pendingVal = (AppState.pendingQuickScores && Number(AppState.pendingQuickScores[student.id])) || 0;
      card.className = `student-card quick-mode-card ${isAbsent ? 'absent' : ''} ${isAbsent ? `att-${attStatus}` : ''}`;
      card.innerHTML = `
        <div class="quick-score-pending-badge ${pendingVal !== 0 ? 'has-pending' : ''} ${pendingVal > 0 ? 'positive' : (pendingVal < 0 ? 'negative' : '')}" id="quick-pending-${student.id}">
          ${pendingVal > 0 ? `+${pendingVal}` : (pendingVal < 0 ? `${pendingVal}` : '')}
        </div>
        <div class="student-avatar gender-${student.gender}" style="overflow: hidden; padding: 0;">
          ${getStudentAvatarImgHtml(student)}
        </div>
        <div class="student-number">${numText}</div>
        <div class="student-name" title="${displayName}">${displayName}</div>
        <div class="quick-card-actions">
          <button class="btn-quick-staged minus" title="${t('btn_minus_score')}" data-student-id="${student.id}" type="button">
            <svg width="22" height="22" viewBox="0 0 22 22" fill="none">
              <rect x="3" y="9" width="16" height="4" rx="2" fill="#887bc4" />
            </svg>
          </button>
          <button class="btn-quick-staged plus" title="${t('btn_plus_score')}" data-student-id="${student.id}" type="button">
            <svg width="22" height="22" viewBox="0 0 22 22" fill="none">
              <rect x="3" y="9" width="16" height="4" rx="2" fill="#887bc4" />
              <rect x="9" y="3" width="4" height="16" rx="2" fill="#887bc4" />
            </svg>
          </button>
        </div>
      `;

      const btnMinus = card.querySelector('.btn-quick-staged.minus');
      if (btnMinus) {
        btnMinus.addEventListener('click', (e) => {
          e.stopPropagation();
          stageQuickScore(student, -1, card);
        });
      }

      const btnPlus = card.querySelector('.btn-quick-staged.plus');
      if (btnPlus) {
        btnPlus.addEventListener('click', (e) => {
          e.stopPropagation();
          stageQuickScore(student, 1, card);
        });
      }
    } else {
      // Normal Selection & Popover Mode Layout
      card.innerHTML = `
        <div class="student-avatar gender-${student.gender}" style="overflow: hidden; padding: 0;">
          ${getStudentAvatarImgHtml(student)}
        </div>
        <div class="student-number">${numText}</div>
        <div class="student-name" title="${displayName}">${displayName}</div>
        ${groupTagHtml}
        <div class="student-score-badge ${scoreAnimClass}" id="score-badge-${student.id}">⭐ ${student.score} ${scoreUnit}</div>
      `;
      attachCardNoteButton(card, student);
    }

    card.addEventListener('click', async (e) => {
      if (AppState.quickScoringMode) {
        // Do not trigger student selection or popup drawers in quick scoring mode
        return;
      }
      lastClickCoords = { x: e.clientX, y: e.clientY };
      AppState.currentScoringGroupTarget = null;
      if (isAbsent) {
        const leaveLabel = attLabels[attStatus] || '缺席/請假';
        if (!await showConfirmModal({
          icon: '⚠️',
          title: '出缺席狀態提醒',
          desc: `學生【${displayName}】今日登記為【${leaveLabel}】，確定仍要選取評分嗎？`,
          confirmText: '確定選取',
          cancelText: '取消'
        })) {
          return;
        }
      }
      if (AppState.selectedStudentIds.has(student.id)) {
        AppState.selectedStudentIds.delete(student.id);
      } else {
        AppState.selectedStudentIds.add(student.id);
      }
      renderScoringView();
    });

    container.appendChild(card);
  });

  AppState.students.forEach(s => { prevStudentScoresMap[s.id] = s.score; });
  updateFloatingScoringDrawer();
}

function renderScoringSeatingView() {
  const container = document.getElementById('scoring-seating-grid');
  if (!container) return;

  if (!AppState.seatingData) {
    container.innerHTML = `<div style="text-align: center; padding: 30px; color: var(--text-muted); grid-column: 1/-1;">載入座位表中...</div>`;
    return;
  }

  const data = AppState.seatingData;
  container.style.gridTemplateColumns = `repeat(${data.seat_cols}, minmax(110px, 1fr))`;
  container.innerHTML = '';
  updateQuickScoringToggleUI();

  const isEn = window.I18n && window.I18n.getLanguage() === 'en';
  const t = (k, p) => window.I18n ? window.I18n.t(k, p) : k;
  const scoreUnit = t('pts');

  const bbPos = data.blackboard_position || 'top';
  ['top', 'bottom', 'left', 'right'].forEach(p => {
    const el = document.getElementById(`scoring-podium-banner-${p}`);
    if (el) el.style.display = (p === bbPos) ? 'block' : 'none';
  });

  const attLabels = {
    present: t('att_present'),
    sick_leave: t('att_sick_leave'),
    personal_leave: t('att_personal_leave'),
    official_leave: t('att_official_leave'),
    bereavement_leave: t('att_bereavement_leave'),
    late: t('att_late')
  };

  const liveStudentMap = new Map();
  AppState.students.forEach(s => liveStudentMap.set(s.id, s));
  const seatedStudentIds = new Set();

  (data.grid || []).forEach(rowCells => {
    rowCells.forEach(cell => {
      const cellStudent = cell.student;
      const seatEl = document.createElement('div');
      seatEl.dataset.row = cell.row;
      seatEl.dataset.col = cell.col;

      if (cellStudent) {
        const student = liveStudentMap.get(cellStudent.id) || cellStudent;
        seatedStudentIds.add(student.id);

        const isSelected = AppState.selectedStudentIds.has(student.id);
        const isAbsent = student.is_absent;
        const attStatus = student.today_attendance || 'present';

        const prevScore = prevStudentScoresMap[student.id];
        let cardFlashClass = '';
        let scoreAnimClass = '';
        if (prevScore !== undefined && prevScore !== null && prevScore !== student.score) {
          cardFlashClass = student.score > prevScore ? 'card-flash-up' : 'card-flash-down';
          scoreAnimClass = student.score > prevScore ? 'score-animate-up' : 'score-animate-down';
        }

        seatEl.className = `seat-cell scoring-seat-cell occupied ${isSelected ? 'selected' : ''} ${isAbsent ? 'absent' : ''} ${isAbsent ? `att-${attStatus}` : ''} ${cardFlashClass}`;
        if (isAbsent) {
          seatEl.setAttribute('data-att-label', attLabels[attStatus] || '未出席');
        }
        seatEl.dataset.studentId = student.id;

        const displayName = getStudentDisplayName(student);
        const numText = isEn ? `No. ${student.student_number}` : `${student.student_number}號`;

        const grpScore = (student.group_id && AppState.groupScoresMap && AppState.groupScoresMap[student.group_id] !== undefined)
          ? AppState.groupScoresMap[student.group_id]
          : ((student.group_name && AppState.groupScoresMap && AppState.groupScoresMap[student.group_name] !== undefined)
              ? AppState.groupScoresMap[student.group_name]
              : 0);

        const groupTagHtml = student.group_name
          ? `<div class="student-card-group-tag" style="font-size: 0.65rem; color: #60a5fa; font-weight: 700; background: rgba(123, 152, 224, 0.12); border: 1px solid rgba(123, 152, 224, 0.25); padding: 1px 5px; border-radius: 4px; display: inline-flex; align-items: center; gap: 2px; max-width: 95%; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; margin-bottom: 2px;"><span>🏷️ ${student.group_name}</span></div>`
          : '';

        if (AppState.quickScoringMode) {
          const pendingVal = (AppState.pendingQuickScores && Number(AppState.pendingQuickScores[student.id])) || 0;
          seatEl.className = `seat-cell scoring-seat-cell occupied quick-mode-cell ${isAbsent ? 'absent' : ''} ${isAbsent ? `att-${attStatus}` : ''} ${cardFlashClass}`;
          seatEl.innerHTML = `
            <div class="quick-score-pending-badge ${pendingVal !== 0 ? 'has-pending' : ''} ${pendingVal > 0 ? 'positive' : (pendingVal < 0 ? 'negative' : '')}" id="quick-pending-${student.id}">
              ${pendingVal > 0 ? `+${pendingVal}` : (pendingVal < 0 ? `${pendingVal}` : '')}
            </div>
            <div class="seat-coord-badge">(${cell.row},${cell.col})</div>
            <div style="margin-top: 2px; display: flex; justify-content: center;">
              <div class="student-avatar gender-${student.gender}" style="width: 38px; height: 38px; margin-bottom: 2px; overflow: hidden; padding: 0;">
                ${getStudentAvatarImgHtml(student)}
              </div>
            </div>
            <div class="student-number" style="font-size: 0.74rem; font-weight: 700; padding: 1px 6px;">${numText}</div>
            <div class="student-name" style="font-size: 0.86rem; font-weight: 800; margin: 2px 0 6px 0; max-width: 96%; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;" title="${displayName}">${displayName}</div>
            <div class="quick-card-actions" style="gap: 4px;">
              <button class="btn-quick-staged minus" style="height: 38px; border-radius: 10px;" title="${t('btn_minus_score')}" data-student-id="${student.id}" type="button">
                <svg width="18" height="18" viewBox="0 0 22 22" fill="none">
                  <rect x="3" y="9" width="16" height="4" rx="2" fill="#887bc4" />
                </svg>
              </button>
              <button class="btn-quick-staged plus" style="height: 38px; border-radius: 10px;" title="${t('btn_plus_score')}" data-student-id="${student.id}" type="button">
                <svg width="18" height="18" viewBox="0 0 22 22" fill="none">
                  <rect x="3" y="9" width="16" height="4" rx="2" fill="#887bc4" />
                  <rect x="9" y="3" width="4" height="16" rx="2" fill="#887bc4" />
                </svg>
              </button>
            </div>
          `;

          const btnMinus = seatEl.querySelector('.btn-quick-staged.minus');
          if (btnMinus) {
            btnMinus.addEventListener('click', (e) => {
              e.stopPropagation();
              stageQuickScore(student, -1, seatEl);
            });
          }

          const btnPlus = seatEl.querySelector('.btn-quick-staged.plus');
          if (btnPlus) {
            btnPlus.addEventListener('click', (e) => {
              e.stopPropagation();
              stageQuickScore(student, 1, seatEl);
            });
          }
        } else {
          seatEl.innerHTML = `
            <div class="seat-coord-badge">(${cell.row},${cell.col})</div>
            <div style="margin-top: 2px; display: flex; justify-content: center;">
              <div class="student-avatar gender-${student.gender}" style="width: 40px; height: 40px; margin-bottom: 2px; overflow: hidden; padding: 0;">
                ${getStudentAvatarImgHtml(student)}
              </div>
            </div>
            <div style="font-size: 0.78rem; color: var(--text-muted); font-weight: 800;">${numText}</div>
            <div style="font-size: 0.88rem; font-weight: 800; max-width: 96%; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;" title="${displayName}">${displayName}</div>
            ${groupTagHtml}
            <div class="student-score-badge ${scoreAnimClass}" id="score-badge-${student.id}" style="margin-top: 3px;">⭐ ${student.score || 0} ${scoreUnit}</div>
          `;
          attachCardNoteButton(seatEl, student);
        }

        seatEl.addEventListener('click', async (e) => {
          if (AppState.quickScoringMode) {
            // Do not trigger student selection or popup drawers in quick scoring mode
            return;
          }
          lastClickCoords = { x: e.clientX, y: e.clientY };
          AppState.currentScoringGroupTarget = null;
          if (isAbsent) {
            const leaveLabel = attLabels[attStatus] || '缺席/請假';
            if (!await showConfirmModal({
              icon: '⚠️',
              title: '出缺席狀態提醒',
              desc: `學生【${displayName}】今日登記為【${leaveLabel}】，確定仍要選取評分嗎？`,
              confirmText: '確定選取',
              cancelText: '取消'
            })) {
              return;
            }
          }
          if (AppState.selectedStudentIds.has(student.id)) {
            AppState.selectedStudentIds.delete(student.id);
          } else {
            AppState.selectedStudentIds.add(student.id);
          }
          renderScoringView();
        });

      } else {
        // Empty seat
        seatEl.className = 'seat-cell scoring-seat-empty empty';
        seatEl.innerHTML = `
          <div class="seat-coord-badge">(${cell.row},${cell.col})</div>
          <div style="font-size: 0.78rem; margin-top: 14px; color: var(--text-subtle);">${t('seating_empty_slot')}</div>
        `;
      }

      container.appendChild(seatEl);
    });
  });

  // Render unassigned students
  renderScoringUnassignedStudents(seatedStudentIds);

  AppState.students.forEach(s => { prevStudentScoresMap[s.id] = s.score; });
  updateFloatingScoringDrawer();
}

function renderScoringUnassignedStudents(seatedStudentIds) {
  const section = document.getElementById('scoring-seating-unassigned-section');
  const grid = document.getElementById('scoring-seating-unassigned-grid');
  if (!section || !grid) return;

  const unassignedStudents = AppState.students.filter(s => !seatedStudentIds.has(s.id));

  if (unassignedStudents.length === 0) {
    section.style.display = 'none';
    grid.innerHTML = '';
    return;
  }

  section.style.display = 'block';
  grid.innerHTML = '';

  const isEn = window.I18n && window.I18n.getLanguage() === 'en';
  const t = (k, p) => window.I18n ? window.I18n.t(k, p) : k;
  const scoreUnit = t('pts');

  const attLabels = {
    present: t('att_present'),
    sick_leave: t('att_sick_leave'),
    personal_leave: t('att_personal_leave'),
    official_leave: t('att_official_leave'),
    bereavement_leave: t('att_bereavement_leave'),
    late: t('att_late')
  };

  unassignedStudents.forEach(student => {
    const isSelected = AppState.selectedStudentIds.has(student.id);
    const isAbsent = student.is_absent;
    const attStatus = student.today_attendance || 'present';
    const displayName = getStudentDisplayName(student);
    const numText = isEn ? `No. ${student.student_number}` : `${student.student_number} 號`;

    const prevScore = prevStudentScoresMap[student.id];
    let cardFlashClass = '';
    let scoreAnimClass = '';
    if (prevScore !== undefined && prevScore !== null && prevScore !== student.score) {
      cardFlashClass = student.score > prevScore ? 'card-flash-up' : 'card-flash-down';
      scoreAnimClass = student.score > prevScore ? 'score-animate-up' : 'score-animate-down';
    }

    const card = document.createElement('div');
    card.className = `student-card ${isSelected ? 'selected' : ''} ${isAbsent ? 'absent' : ''} ${isAbsent ? `att-${attStatus}` : ''} ${cardFlashClass}`;
    if (isAbsent) card.setAttribute('data-att-label', attLabels[attStatus] || '未出席');

    if (AppState.quickScoringMode) {
      const pendingVal = (AppState.pendingQuickScores && Number(AppState.pendingQuickScores[student.id])) || 0;
      card.className = `student-card quick-mode-card ${isAbsent ? 'absent' : ''} ${isAbsent ? `att-${attStatus}` : ''} ${cardFlashClass}`;
      card.innerHTML = `
        <div class="quick-score-pending-badge ${pendingVal !== 0 ? 'has-pending' : ''} ${pendingVal > 0 ? 'positive' : (pendingVal < 0 ? 'negative' : '')}" id="quick-pending-${student.id}">
          ${pendingVal > 0 ? `+${pendingVal}` : (pendingVal < 0 ? `${pendingVal}` : '')}
        </div>
        <div class="student-avatar gender-${student.gender}" style="overflow: hidden; padding: 0;">
          ${getStudentAvatarImgHtml(student)}
        </div>
        <div class="student-number">${numText}</div>
        <div class="student-name" title="${displayName}">${displayName}</div>
        <div class="quick-card-actions">
          <button class="btn-quick-staged minus" title="${t('btn_minus_score')}" data-student-id="${student.id}" type="button">
            <svg width="22" height="22" viewBox="0 0 22 22" fill="none">
              <rect x="3" y="9" width="16" height="4" rx="2" fill="#887bc4" />
            </svg>
          </button>
          <button class="btn-quick-staged plus" title="${t('btn_plus_score')}" data-student-id="${student.id}" type="button">
            <svg width="22" height="22" viewBox="0 0 22 22" fill="none">
              <rect x="3" y="9" width="16" height="4" rx="2" fill="#887bc4" />
              <rect x="9" y="3" width="4" height="16" rx="2" fill="#887bc4" />
            </svg>
          </button>
        </div>
      `;
      const btnMinus = card.querySelector('.btn-quick-staged.minus');
      if (btnMinus) {
        btnMinus.addEventListener('click', (e) => {
          e.stopPropagation();
          stageQuickScore(student, -1, card);
        });
      }
      const btnPlus = card.querySelector('.btn-quick-staged.plus');
      if (btnPlus) {
        btnPlus.addEventListener('click', (e) => {
          e.stopPropagation();
          stageQuickScore(student, 1, card);
        });
      }
    } else {
      card.innerHTML = `
        <div class="student-avatar gender-${student.gender}" style="overflow: hidden; padding: 0;">
          ${getStudentAvatarImgHtml(student)}
        </div>
        <div class="student-number">${numText}</div>
        <div class="student-name" title="${displayName}">${displayName}</div>
        <div class="student-score-badge ${scoreAnimClass}" id="score-badge-${student.id}">⭐ ${student.score || 0} ${scoreUnit}</div>
      `;
      attachCardNoteButton(card, student);
    }

    card.addEventListener('click', async (e) => {
      if (AppState.quickScoringMode) {
        return;
      }
      lastClickCoords = { x: e.clientX, y: e.clientY };
      AppState.currentScoringGroupTarget = null;
      if (isAbsent) {
        const leaveLabel = attLabels[attStatus] || '缺席/請假';
        if (!await showConfirmModal({
          icon: '⚠️',
          title: '出缺席狀態提醒',
          desc: `學生【${displayName}】今日登記為【${leaveLabel}】，確定仍要選取評分嗎？`,
          confirmText: '確定選取',
          cancelText: '取消'
        })) {
          return;
        }
      }
      if (AppState.selectedStudentIds.has(student.id)) {
        AppState.selectedStudentIds.delete(student.id);
      } else {
        AppState.selectedStudentIds.add(student.id);
      }
      renderScoringView();
    });

    grid.appendChild(card);
  });
}

function updateFloatingScoringDrawer() {
  const drawer = document.getElementById('floating-scoring-bar');
  const label = document.getElementById('selected-students-label');
  if (!drawer || !label) return;

  if (AppState.quickScoringMode) {
    drawer.classList.remove('visible');
    return;
  }

  const count = AppState.selectedStudentIds.size;
  const isEn = window.I18n && window.I18n.getLanguage() === 'en';
  const t = (k, p) => window.I18n ? window.I18n.t(k, p) : k;

  if (count > 0) {
    if (count === 1) {
      const selectedId = Array.from(AppState.selectedStudentIds)[0];
      const student = AppState.students.find(s => s.id === selectedId);
      const numPrefix = isEn ? `No. ${student.student_number}` : `${student.student_number}號`;
      const studentName = student ? `${numPrefix} ${getStudentDisplayName(student)}` : '';
      const logsBtnText = t('btn_view_logs');
      const selectedText = t('selected_single_student', { name: studentName });
      label.innerHTML = `${selectedText} <button id="btn-popover-score-logs" class="btn btn-secondary" style="font-size: 0.75rem; padding: 2px 8px; margin-left: 8px; border-radius: 9999px;" title="${logsBtnText}">${logsBtnText}</button>`;
      const btnLogs = document.getElementById('btn-popover-score-logs');
      if (btnLogs) {
        btnLogs.onclick = (e) => {
          e.stopPropagation();
          openStudentScoreLogsModal(selectedId);
        };
      }
    } else {
      label.textContent = t('selected_students_count', { count });
    }

    drawer.classList.add('visible');

    // Position Popover dynamically near cursor while preventing viewport overflow
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const popWidth = drawer.offsetWidth || 360;
    const popHeight = drawer.offsetHeight || 200;

    let left = lastClickCoords.x + 12;
    let top = lastClickCoords.y + 12;

    // Boundary clamping: if overflowing right edge, flip left of cursor
    if (left + popWidth > vw - 12) {
      left = lastClickCoords.x - popWidth - 12;
    }
    if (left < 12) {
      left = 12;
    }

    // Boundary clamping: if overflowing bottom edge, flip above cursor
    if (top + popHeight > vh - 12) {
      top = lastClickCoords.y - popHeight - 12;
    }
    if (top < 12) {
      top = 12;
    }

    drawer.style.left = `${left}px`;
    drawer.style.top = `${top}px`;
  } else {
    drawer.classList.remove('visible');
  }
}

async function applyScoreRule(rule) {
  if (AppState.selectedStudentIds.size === 0) {
    alert(window.I18n && window.I18n.getLanguage() === 'en' ? 'Please select at least one student!' : '請先點選至少一位學生！');
    return;
  }

  const studentIds = Array.from(AppState.selectedStudentIds);
  const displayRuleTitle = window.I18n ? window.I18n.getRuleDisplayTitle(rule.title) : rule.title;
  try {
    const payload = {
      student_ids: studentIds,
      rule_id: rule.id,
      rule_title: rule.title,
      score: rule.score_value,
      category: rule.category
    };
    if (AppState.currentScoringGroupTarget) {
      payload.plan_id = AppState.currentScoringGroupTarget.plan_id;
      payload.group_id = AppState.currentScoringGroupTarget.group_id;
    }
    const res = await API.post(`/api/scores/${AppState.currentCourseId}/add`, payload);
    AppState.currentScoringGroupTarget = null;

    // Trigger Toast Undo
    const toastMsg = studentIds.length === 1 && AppState.students.find(s => s.id === studentIds[0])
      ? (window.I18n ? window.I18n.t('undo_toast_single', {
          name: getStudentDisplayName(AppState.students.find(s => s.id === studentIds[0])),
          icon: rule.icon,
          rule: displayRuleTitle,
          score: rule.score_value > 0 ? `+${rule.score_value}` : rule.score_value
        }) : `已為【${getStudentDisplayName(AppState.students.find(s => s.id === studentIds[0]))}】套用【${rule.icon} ${displayRuleTitle} ${rule.score_value > 0 ? '+' : ''}${rule.score_value}分】`)
      : (window.I18n ? window.I18n.t('undo_toast', {
          count: studentIds.length,
          icon: rule.icon,
          rule: displayRuleTitle,
          score: rule.score_value > 0 ? `+${rule.score_value}` : rule.score_value
        }) : `已為 ${studentIds.length} 位學生套用【${rule.icon} ${displayRuleTitle} ${rule.score_value > 0 ? '+' : ''}${rule.score_value}分】`);

    showUndoToast(res.undo_id, toastMsg);

    // Auto clear selection & hide floating drawer
    AppState.selectedStudentIds.clear();

    // Refresh scoring data & immediately update Dashboard / Big Screen
    loadScoringData();
    notifyScoreUpdates();
  } catch (err) {
    alert(`評分失敗：${err.message}`);
  }
}

// --- Toast Undo Notification (2.5-Second Countdown) ---
function showUndoToast(undoId, message) {
  const container = document.getElementById('toast-container');
  const toast = document.createElement('div');
  toast.className = 'toast-undo';

  const t = (k) => window.I18n ? window.I18n.t(k) : k;

  toast.innerHTML = `
    <div style="flex: 1;">
      <div style="font-weight: 700; font-size: 0.95rem;">${message}</div>
      <div style="font-size: 0.75rem; color: #94a3b8;">${t('undo_hint')}</div>
    </div>
    <button class="btn-undo">${t('undo_btn')}</button>
  `;

  const btnUndo = toast.querySelector('.btn-undo');
  
  let timerId = setTimeout(() => {
    toast.remove();
  }, 2500);

  btnUndo.addEventListener('click', async () => {
    clearTimeout(timerId);
    try {
      await API.post('/api/scores/undo', { undo_id: undoId });
      toast.remove();
      loadScoringData();
      notifyScoreUpdates();
      if (getActiveTabName() === 'attendance') loadAttendanceData();
    } catch (err) {
      alert(`復原失敗：${err.message}`);
    }
  });

  container.appendChild(toast);
}

// --- Universal Toast Notification Helper ---
function showToast(message, type = 'info') {
  let container = document.getElementById('toast-container');
  if (!container) {
    container = document.createElement('div');
    container.id = 'toast-container';
    container.className = 'toast-container';
    document.body.appendChild(container);
  }
  const toast = document.createElement('div');
  toast.className = `toast-undo toast-${type}`;
  toast.style.cssText = 'background: rgba(15, 23, 42, 0.95); border: 1.5px solid rgba(123, 152, 224, 0.4); color: #fff; padding: 12px 20px; border-radius: 12px; font-weight: 700; font-size: 0.95rem; box-shadow: 0 10px 30px rgba(0,0,0,0.5); backdrop-filter: blur(12px); display: flex; align-items: center; gap: 10px; animation: slideInUp 0.25s ease;';
  
  if (type === 'positive' || type === 'success') {
    toast.style.borderColor = 'rgba(79, 174, 130, 0.6)';
    toast.style.boxShadow = '0 10px 30px rgba(79, 174, 130, 0.25)';
  } else if (type === 'error') {
    toast.style.borderColor = 'rgba(217, 128, 126, 0.6)';
    toast.style.boxShadow = '0 10px 30px rgba(217, 128, 126, 0.25)';
  }

  toast.innerHTML = `<div>${message}</div>`;
  container.appendChild(toast);

  setTimeout(() => {
    toast.style.opacity = '0';
    toast.style.transition = 'opacity 0.3s ease';
    setTimeout(() => toast.remove(), 300);
  }, 2500);
}
window.showToast = showToast;

// --- Shared guard for feature entry points that require an existing class ---
// Passive background data-loaders (loadScoringData, loadAttendanceData, ...) already
// render an inline "no class yet" card via renderEmptyCourseNotice()/renderActiveTabEmptyNotice()
// and should keep silently no-op'ing — this helper is only for direct user-triggered actions
// (button clicks, opening a creation modal, etc.) that would otherwise fail invisibly.
function ensureCourseSelected() {
  if (AppState.currentCourseId && AppState.courses && AppState.courses.length > 0) return true;
  const isEn = window.I18n && window.I18n.getLanguage() === 'en';
  showToast(isEn ? 'Please create a class first!' : '請先建立班級課程！', 'error');
  openModal('modal-add-course');
  return false;
}
window.ensureCourseSelected = ensureCourseSelected;

// --- Attendance Pane ---
async function loadAttendanceData() {
  if (!AppState.currentCourseId || (AppState.courses && AppState.courses.length === 0)) {
    renderEmptyCourseNotice(document.getElementById('attendance-student-grid'));
    return;
  }
  const dateInput = document.getElementById('attendance-date');
  if (!dateInput.value) {
    dateInput.value = getTaiwanTodayDateStr();
  }

  try {
    const data = await API.get(`/api/attendance/${AppState.currentCourseId}?date=${dateInput.value}`);
    AppState.attendanceRecords = data.records;
    renderAttendanceGrid();
  } catch (err) {
    console.error('Attendance load error:', err);
  }
}

function renderAttendanceGrid() {
  const container = document.getElementById('attendance-student-grid');
  container.innerHTML = '';

  const summary = { present: 0, sick_leave: 0, personal_leave: 0, official_leave: 0, bereavement_leave: 0, late: 0 };
  const isEn = window.I18n && window.I18n.getLanguage() === 'en';
  const t = (k, p) => window.I18n ? window.I18n.t(k, p) : k;

  AppState.attendanceRecords.forEach(rec => {
    // If historical data had 'absent', map gracefully to 'sick_leave'
    if (rec.status === 'absent') rec.status = 'sick_leave';
    summary[rec.status] = (summary[rec.status] || 0) + 1;

    const card = document.createElement('div');
    const isNotPresent = rec.status !== 'present';
    card.className = `student-card ${isNotPresent ? 'absent' : ''} ${isNotPresent ? `att-${rec.status}` : ''}`;
    const labelMap = {
      sick_leave: t('att_sick_leave'),
      personal_leave: t('att_personal_leave'),
      official_leave: t('att_official_leave'),
      bereavement_leave: t('att_bereavement_leave'),
      late: t('att_late')
    };
    if (isNotPresent) {
      card.setAttribute('data-att-label', labelMap[rec.status] || 'Leave');
    }
    
    const displayName = getStudentDisplayName(rec);
    const numText = isEn ? `No. ${rec.student_number}` : `${rec.student_number} 號`;

    card.innerHTML = `
      <div class="student-avatar gender-${rec.gender}" style="overflow: hidden; padding: 0;">
        ${getStudentAvatarImgHtml(rec)}
      </div>
      <div class="student-number">${numText}</div>
      <div class="student-name" title="${displayName}">${displayName}</div>
      <div style="margin-top: 8px; width: 100%;">
        <select class="input-control att-status-select" style="font-size: 0.82rem; padding: 5px; font-weight: 700;">
          <option value="present" ${rec.status === 'present' ? 'selected' : ''}>✅ ${t('att_present')}</option>
          <option value="sick_leave" ${rec.status === 'sick_leave' ? 'selected' : ''}>🤒 ${t('att_sick_leave')}</option>
          <option value="personal_leave" ${rec.status === 'personal_leave' ? 'selected' : ''}>🏠 ${t('att_personal_leave')}</option>
          <option value="official_leave" ${rec.status === 'official_leave' ? 'selected' : ''}>🏛️ ${t('att_official_leave')}</option>
          <option value="bereavement_leave" ${rec.status === 'bereavement_leave' ? 'selected' : ''}>🖤 ${t('att_bereavement_leave')}</option>
          <option value="late" ${rec.status === 'late' ? 'selected' : ''}>⏰ ${t('att_late')}</option>
        </select>
      </div>
    `;

    const select = card.querySelector('.att-status-select');
    select.addEventListener('change', (e) => {
      rec.status = e.target.value;
      const isNowNotPresent = rec.status !== 'present';
      card.className = `student-card ${isNowNotPresent ? 'absent' : ''} ${isNowNotPresent ? `att-${rec.status}` : ''}`;
      if (isNowNotPresent) {
        card.setAttribute('data-att-label', labelMap[rec.status] || 'Leave');
      } else {
        card.removeAttribute('data-att-label');
      }

      // Realtime recalculate summary
      const newSummary = { present: 0, sick_leave: 0, personal_leave: 0, official_leave: 0, bereavement_leave: 0, late: 0 };
      AppState.attendanceRecords.forEach(r => {
        const st = (r.status === 'absent') ? 'sick_leave' : r.status;
        newSummary[st] = (newSummary[st] || 0) + 1;
      });
      renderAttendanceSummary(newSummary);
    });

    container.appendChild(card);
  });

  renderAttendanceSummary(summary);
}

function renderAttendanceSummary(summary) {
  const container = document.getElementById('attendance-summary');
  const t = (k, p) => window.I18n ? window.I18n.t(k, p) : k;
  container.innerHTML = `
    <span style="color: #4fae82; background: rgba(79, 174, 130,0.1); padding: 5px 12px; border-radius: 9999px; font-size: 0.88rem; font-weight: 800;">${t('att_summary_present', {count: summary.present || 0})}</span>
    <span style="color: #9a86c4; background: rgba(154, 134, 196,0.1); padding: 5px 12px; border-radius: 9999px; font-size: 0.88rem; font-weight: 800;">${t('att_summary_sick_leave', {count: summary.sick_leave || 0})}</span>
    <span style="color: #ec4899; background: rgba(236,72,153,0.1); padding: 5px 12px; border-radius: 9999px; font-size: 0.88rem; font-weight: 800;">${t('att_summary_personal_leave', {count: summary.personal_leave || 0})}</span>
    <span style="color: #5f9fcf; background: rgba(95, 159, 207,0.1); padding: 5px 12px; border-radius: 9999px; font-size: 0.88rem; font-weight: 800;">${t('att_summary_official_leave', {count: summary.official_leave || 0})}</span>
    <span style="color: #475569; background: rgba(71,85,105,0.12); padding: 5px 12px; border-radius: 9999px; font-size: 0.88rem; font-weight: 800;">${t('att_summary_bereavement_leave', {count: summary.bereavement_leave || 0})}</span>
    <span style="color: #d3a24c; background: rgba(211, 162, 76,0.1); padding: 5px 12px; border-radius: 9999px; font-size: 0.88rem; font-weight: 800;">${t('att_summary_late', {count: summary.late || 0})}</span>
  `;
}

function setAllAttendancePresent() {
  if (!AppState.attendanceRecords || AppState.attendanceRecords.length === 0) return;
  AppState.attendanceRecords.forEach(r => {
    r.status = 'present';
  });
  renderAttendanceGrid();
}

async function saveAttendance() {
  if (!ensureCourseSelected()) return;
  const dateStr = document.getElementById('attendance-date').value;
  const items = AppState.attendanceRecords.map(r => ({
    student_id: r.student_id,
    status: r.status
  }));

  try {
    const res = await API.post(`/api/attendance/${AppState.currentCourseId}`, {
      date: dateStr,
      items: items
    });

    showUndoToast(res.undo_id, `已完成 ${dateStr} 課堂點名紀錄`);
  } catch (err) {
    alert(`儲存點名失敗：${err.message}`);
  }
}

// --- Grouping Pane & Drag & Drop ---
async function loadGroupingData(targetPlanId) {
  if (!AppState.currentCourseId) {
    renderEmptyCourseNotice(document.getElementById('group-columns-container'));
    return;
  }
  try {
    const planParam = targetPlanId || AppState.currentGroupPlanId;
    const url = `/api/groups/${AppState.currentCourseId}` + (planParam ? `?plan_id=${planParam}` : '');
    const data = await API.get(url);
    renderGroupColumns(data);
  } catch (err) {
    console.error('Grouping load error:', err);
  }
}

function renderGroupColumns(data) {
  const container = document.getElementById('group-columns-container');
  if (!container) return;
  container.innerHTML = '';

  const plans = data.plans || [];
  const currentPlan = data.current_plan || null;
  AppState.groupPlans = plans;
  AppState.currentGroupPlanId = currentPlan ? currentPlan.id : null;
  const activePlan = plans.find(p => p.is_active);
  AppState.activeGroupPlanId = activePlan ? activePlan.id : AppState.currentGroupPlanId;

  // Render Plan Selector Dropdown & Active Indicator
  const planSelect = document.getElementById('group-plan-select');
  if (planSelect) {
    planSelect.innerHTML = '';
    plans.forEach(p => {
      const opt = document.createElement('option');
      opt.value = p.id;
      opt.textContent = (p.is_active ? '⭐ ' : '') + p.name;
      if (currentPlan && p.id === currentPlan.id) opt.selected = true;
      planSelect.appendChild(opt);
    });
  }

  const activeBadge = document.getElementById('group-plan-active-badge');
  const btnSetActive = document.getElementById('btn-set-active-group-plan');
  if (activeBadge && btnSetActive) {
    const isCurrentActive = currentPlan && currentPlan.is_active;
    activeBadge.style.display = isCurrentActive ? 'inline-block' : 'none';
    btnSetActive.style.display = isCurrentActive ? 'none' : 'inline-block';
  }

  const groups = data.groups || [];
  const unassigned = data.unassigned || [];
  const realGroups = groups.filter(g => g && g.id);
  AppState.groups = realGroups;
  if (window.TeachingToolkit) {
    window.TeachingToolkit.luckyDraw.setGroups(realGroups);
  }

  const isEn = window.I18n && window.I18n.getLanguage() === 'en';
  const t = (k, p) => window.I18n ? window.I18n.t(k, p) : k;

  // Render unassigned group if exists
  if (unassigned.length > 0) {
    groups.unshift({
      id: null,
      group_name: t('grouping_unassigned_name'),
      students: unassigned
    });
  }

  groups.forEach((g, idx) => {
    const col = document.createElement('div');
    col.className = 'group-column';
    col.dataset.groupId = g.id || '';

    const isUnassigned = !g.id;
    const headerIcon = isUnassigned 
      ? '<span>👥</span>' 
      : `<img src="${getGroupAvatarSrc(g, idx)}" alt="${g.group_name}" style="width: 26px; height: 26px; object-fit: contain;">`;

    const countText = isEn ? `${(g.students || []).length} students` : `${(g.students || []).length} 人`;

    col.innerHTML = `
      <div class="group-header" style="display: flex; align-items: center; justify-content: space-between; padding: 10px 12px;">
        <div class="group-header-info" style="display: flex; align-items: center; gap: 8px; flex: 1; min-width: 0; cursor: ${isUnassigned ? 'default' : 'pointer'};" title="${isUnassigned ? '' : '點擊自訂小組名稱與圖示'}">
          <div style="width: 28px; height: 28px; display: flex; align-items: center; justify-content: center; flex-shrink: 0;">
            ${headerIcon}
          </div>
          <span style="font-weight: 700; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 0.95rem;">${g.group_name}</span>
        </div>
        <div style="display: flex; align-items: center; gap: 6px; flex-shrink: 0;">
          <span style="font-size: 0.8rem; color: var(--text-muted);">${countText}</span>
          ${!isUnassigned ? `<button class="btn-icon btn-edit-group" title="自訂小組名稱與圖示" style="font-size: 0.85rem; padding: 3px 6px; background: rgba(255,255,255,0.08); border-radius: 6px; border: 1px solid var(--card-border);">⚙️</button>` : ''}
        </div>
      </div>
      <div class="group-students-list" style="display: flex; flex-direction: column; gap: 8px; flex: 1; padding: 8px;"></div>
    `;

    if (!isUnassigned) {
      const editBtn = col.querySelector('.btn-edit-group');
      const headerInfo = col.querySelector('.group-header-info');
      if (editBtn) editBtn.addEventListener('click', (e) => { e.stopPropagation(); openEditGroupModal(g); });
      if (headerInfo) headerInfo.addEventListener('click', () => openEditGroupModal(g));
    }

    const listEl = col.querySelector('.group-students-list');

    (g.students || []).forEach(s => {
      const card = document.createElement('div');
      card.className = 'student-card';
      card.style.flexDirection = 'row';
      card.style.justifyContent = 'space-between';
      card.style.padding = '8px 12px';
      card.draggable = true;
      card.dataset.studentId = s.id;
      const numText = isEn ? `No. ${s.student_number}` : `${s.student_number}號`;
      const isLeader = !!s.is_leader;
      const leaderTitle = isLeader ? t('group_unset_leader_title') : t('group_set_leader_title');
      const leaderBtnHtml = !isUnassigned ? `
        <button type="button" class="btn-group-leader-toggle ${isLeader ? 'is-leader' : 'not-leader'}" title="${leaderTitle}" style="margin-left: 6px;">
          👑${isLeader ? `<span class="leader-badge-pill" style="margin-left: 2px;">${t('group_leader_badge')}</span>` : ''}
        </button>
      ` : '';

      card.innerHTML = `
        <div style="display: flex; align-items: center; gap: 8px; flex: 1; min-width: 0;">
          <div style="width: 24px; height: 24px; border-radius: 50%; overflow: hidden; flex-shrink: 0;">
            ${getStudentAvatarImgHtml(s)}
          </div>
          <span style="font-weight: bold; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">${numText} ${getStudentDisplayName(s)}</span>
          ${leaderBtnHtml}
        </div>
        <span style="cursor: grab; color: var(--text-muted); margin-left: 8px;">≡</span>
      `;

      if (!isUnassigned) {
        const leaderBtn = card.querySelector('.btn-group-leader-toggle');
        if (leaderBtn) {
          leaderBtn.addEventListener('click', async (e) => {
            e.stopPropagation();
            try {
              const newLeaderStudentId = isLeader ? null : s.id;
              await api(`/api/groups/${AppState.currentCourseId}/set-leader`, 'POST', {
                plan_id: currentPlan ? currentPlan.id : undefined,
                group_id: g.id,
                student_id: newLeaderStudentId
              });
              showToast(isLeader ? '已取消小組長' : `已指派 ${getStudentDisplayName(s)} 為小組長！`, 'success');
              loadGroupingData();
            } catch (err) {
              showToast(err.message, 'error');
            }
          });
        }
      }

      card.addEventListener('dragstart', (e) => {
        e.dataTransfer.setData('text/plain', s.id);
        card.style.opacity = '0.5';
      });

      card.addEventListener('dragend', () => {
        card.style.opacity = '1';
      });

      listEl.appendChild(card);
    });

    // Drag Over & Drop Events on Column
    col.addEventListener('dragover', (e) => {
      e.preventDefault();
      col.classList.add('drag-over');
    });

    col.addEventListener('dragleave', () => {
      col.classList.remove('drag-over');
    });

    col.addEventListener('drop', async (e) => {
      e.preventDefault();
      col.classList.remove('drag-over');
      const studentId = e.dataTransfer.getData('text/plain');
      if (!studentId) return;

      const targetGroupId = g.id ? parseInt(g.id) : null;
      try {
        await API.put(`/api/groups/${AppState.currentCourseId}/drag`, {
          plan_id: AppState.currentGroupPlanId,
          student_id: parseInt(studentId),
          group_id: targetGroupId
        });
        loadGroupingData(AppState.currentGroupPlanId);
      } catch (err) {
        alert(`拖曳調整組別失敗：${err.message}`);
      }
    });

    container.appendChild(col);
  });
}

// --- Group Plans Management Functions ---
function openCreateGroupPlanModal(copyCurrent = false) {
  if (!ensureCourseSelected()) return;
  const selectCopy = document.getElementById('select-copy-from-plan');
  const nameInput = document.getElementById('input-create-plan-name');
  if (selectCopy) {
    const isEn = window.I18n && window.I18n.getLanguage() === 'en';
    selectCopy.innerHTML = `<option value="">${isEn ? 'Do not copy (blank mode)' : '不複製 (建立空白模式)'}</option>`;
    (AppState.groupPlans || []).forEach(p => {
      const opt = document.createElement('option');
      opt.value = p.id;
      opt.textContent = `${p.is_active ? '⭐ ' : ''}${p.name}`;
      if (copyCurrent && p.id === AppState.currentGroupPlanId) {
        opt.selected = true;
      }
      selectCopy.appendChild(opt);
    });
  }

  const currentPlan = (AppState.groupPlans || []).find(p => p.id === AppState.currentGroupPlanId);
  if (nameInput) {
    if (copyCurrent && currentPlan) {
      nameInput.value = `${currentPlan.name} (複製)`;
    } else {
      nameInput.value = '';
    }
  }

  openModal('modal-create-group-plan');
}

async function submitCreateGroupPlan() {
  const nameInput = document.getElementById('input-create-plan-name');
  const selectCopy = document.getElementById('select-copy-from-plan');
  const name = nameInput ? nameInput.value.trim() : '';
  if (!name) {
    alert(window.I18n && window.I18n.getLanguage() === 'en' ? 'Please enter a mode name!' : '請輸入分組模式名稱！');
    return;
  }
  const copyFromId = selectCopy && selectCopy.value ? parseInt(selectCopy.value) : null;

  try {
    const res = await API.post(`/api/groups/${AppState.currentCourseId}/plans`, {
      name: name,
      copy_from_plan_id: copyFromId
    });
    closeModal('modal-create-group-plan');
    showToast(res.message || '分組模式建立成功！', 'positive');
    await loadGroupingData(res.id);
  } catch (err) {
    alert(`建立分組模式失敗：${err.message}`);
  }
}

function openRenameGroupPlanModal() {
  const currentPlan = (AppState.groupPlans || []).find(p => p.id === AppState.currentGroupPlanId);
  if (!currentPlan) return;
  const nameInput = document.getElementById('input-rename-plan-name');
  if (nameInput) nameInput.value = currentPlan.name;
  openModal('modal-rename-group-plan');
}

async function submitRenameGroupPlan() {
  const nameInput = document.getElementById('input-rename-plan-name');
  const name = nameInput ? nameInput.value.trim() : '';
  if (!name) {
    alert(window.I18n && window.I18n.getLanguage() === 'en' ? 'Please enter a mode name!' : '請輸入分組模式名稱！');
    return;
  }

  try {
    await API.put(`/api/groups/${AppState.currentCourseId}/plans/${AppState.currentGroupPlanId}`, {
      name: name
    });
    closeModal('modal-rename-group-plan');
    showToast('分組模式名稱已更新！', 'positive');
    await loadGroupingData(AppState.currentGroupPlanId);
  } catch (err) {
    alert(`更新分組模式名稱失敗：${err.message}`);
  }
}

async function setActiveGroupPlan() {
  if (!AppState.currentGroupPlanId) return;
  const currentPlan = (AppState.groupPlans || []).find(p => p.id === AppState.currentGroupPlanId);
  const planName = currentPlan ? currentPlan.name : '';

  try {
    await API.put(`/api/groups/${AppState.currentCourseId}/plans/${AppState.currentGroupPlanId}`, {
      is_active: true
    });
    const t = (k, p) => window.I18n ? window.I18n.t(k, p) : k;
    showToast(t('group_plan_activated_toast', { name: planName }), 'positive');
    await loadGroupingData(AppState.currentGroupPlanId);
    loadDashboardData(true);
    refreshProjectionData(true);
  } catch (err) {
    alert(`設為生效模式失敗：${err.message}`);
  }
}

async function confirmDeleteGroupPlan() {
  if (!AppState.currentGroupPlanId) return;
  if ((AppState.groupPlans || []).length <= 1) {
    const t = (k) => window.I18n ? window.I18n.t(k) : k;
    alert(t('group_plan_delete_min_alert'));
    return;
  }

  const currentPlan = (AppState.groupPlans || []).find(p => p.id === AppState.currentGroupPlanId);
  const planName = currentPlan ? currentPlan.name : '';
  const t = (k, p) => window.I18n ? window.I18n.t(k, p) : k;

  if (!await showConfirmModal({
    icon: '🗑️',
    danger: true,
    title: isEn ? 'Delete Grouping Plan' : '刪除分組模式確認',
    desc: t('group_plan_delete_confirm', { name: planName }),
    confirmText: isEn ? 'Delete' : '確定刪除',
    cancelText: isEn ? 'Cancel' : '取消'
  })) return;

  try {
    const res = await API.delete(`/api/groups/${AppState.currentCourseId}/plans/${AppState.currentGroupPlanId}`);
    showToast(res.message || '分組模式已刪除！', 'positive');
    AppState.currentGroupPlanId = null;
    await loadGroupingData();
    loadDashboardData(true);
    refreshProjectionData(true);
  } catch (err) {
    alert(`刪除分組模式失敗：${err.message}`);
  }
}

// --- Group Customization / Modal Functions ---
let currentEditingGroup = null;
let currentSelectedGroupIcon = null;
let currentPendingGroupIconFile = null;

function openAddGroupModal() {
  if (!ensureCourseSelected()) return;
  currentEditingGroup = null;
  currentPendingGroupIconFile = null;

  // 1. Gather all currently used icons in this course
  const usedIcons = new Set(
    (AppState.groups || [])
      .map(g => g.icon_url || getGroupAvatarSrc(g))
      .filter(Boolean)
  );

  // 2. Filter available unused animal icons
  const availableAnimals = ANIMAL_ICONS_LIST
    .map(name => `/static/pic/animals/${name}.png`)
    .filter(url => !usedIcons.has(url));

  let pickedIconUrl;
  if (availableAnimals.length > 0) {
    const rIdx = Math.floor(Math.random() * availableAnimals.length);
    pickedIconUrl = availableAnimals[rIdx];
  } else {
    const rIdx = Math.floor(Math.random() * ANIMAL_ICONS_LIST.length);
    pickedIconUrl = `/static/pic/animals/${ANIMAL_ICONS_LIST[rIdx]}.png`;
  }

  currentSelectedGroupIcon = pickedIconUrl;
  const nextNum = (AppState.groups || []).length + 1;
  const isEn = window.I18n && window.I18n.getLanguage() === 'en';

  document.getElementById('modal-group-title').textContent = window.I18n ? window.I18n.t('group_modal_title') : '➕ 新增自訂小組';
  document.getElementById('edit-group-id').value = '';
  document.getElementById('edit-group-name').value = isEn ? `Group ${nextNum}` : `第 ${nextNum} 組`;
  document.getElementById('edit-group-icon-preview').src = currentSelectedGroupIcon;
  document.getElementById('edit-group-icon-file').value = '';
  document.getElementById('btn-delete-group').style.display = 'none';

  updatePresetIconSelection(currentSelectedGroupIcon);
  openModal('modal-edit-group');
}

function openEditGroupModal(group) {
  currentEditingGroup = group;
  currentPendingGroupIconFile = null;
  currentSelectedGroupIcon = group.icon_url || getGroupAvatarSrc(group);

  const prefix = window.I18n ? window.I18n.t('group_modal_title') : '🎨 自訂小組設定';
  document.getElementById('modal-group-title').textContent = `${prefix} - ${group.group_name}`;
  document.getElementById('edit-group-id').value = group.id;
  document.getElementById('edit-group-name').value = group.group_name;
  document.getElementById('edit-group-icon-preview').src = currentSelectedGroupIcon;
  document.getElementById('edit-group-icon-file').value = '';
  document.getElementById('btn-delete-group').style.display = 'inline-block';

  updatePresetIconSelection(currentSelectedGroupIcon);
  openModal('modal-edit-group');
}

function updatePresetIconSelection(activeSrc) {
  document.querySelectorAll('.group-preset-icon-btn').forEach(btn => {
    if (activeSrc && btn.dataset.icon === activeSrc) {
      btn.style.borderColor = 'var(--primary-light)';
      btn.style.background = 'rgba(154, 134, 196, 0.25)';
      btn.style.boxShadow = '0 0 8px rgba(154, 134, 196, 0.4)';
    } else {
      btn.style.borderColor = 'var(--card-border)';
      btn.style.background = 'rgba(255,255,255,0.05)';
      btn.style.boxShadow = 'none';
    }
  });
}

async function confirmSaveGroup() {
  const groupId = document.getElementById('edit-group-id').value;
  const name = document.getElementById('edit-group-name').value.trim();
  if (!name) {
    alert('請輸入小組名稱！');
    return;
  }

  const submitBtn = document.getElementById('btn-save-group-submit');
  submitBtn.disabled = true;
  submitBtn.textContent = '儲存中...';

  try {
    if (!groupId) {
      // 1. Create new group
      const res = await API.post(`/api/groups/${AppState.currentCourseId}`, {
        plan_id: AppState.currentGroupPlanId,
        group_name: name,
        icon_url: currentPendingGroupIconFile ? null : currentSelectedGroupIcon
      });
      const newGroupId = res.id;

      if (currentPendingGroupIconFile && newGroupId) {
        const formData = new FormData();
        formData.append('file', currentPendingGroupIconFile);
        await API.postFormData(`/api/groups/${AppState.currentCourseId}/${newGroupId}/upload_icon`, formData);
      }
      showToast(`小組「${name}」新增成功！`, 'positive');
    } else {
      // 2. Update existing group
      if (currentPendingGroupIconFile) {
        const formData = new FormData();
        formData.append('file', currentPendingGroupIconFile);
        const upData = await API.postFormData(`/api/groups/${AppState.currentCourseId}/${groupId}/upload_icon`, formData);
        currentSelectedGroupIcon = upData.icon_url;
      }

      await API.put(`/api/groups/${AppState.currentCourseId}/${groupId}`, {
        group_name: name,
        icon_url: currentSelectedGroupIcon
      });
      showToast(`小組「${name}」設定已更新！`, 'positive');
    }

    closeModal('modal-edit-group');
    loadGroupingData(AppState.currentGroupPlanId);
    loadDashboardData(true);
    refreshProjectionData(true);
  } catch (err) {
    alert(`儲存小組失敗：${err.message}`);
  } finally {
    submitBtn.disabled = false;
    submitBtn.textContent = '💾 儲存設定';
  }
}

async function confirmDeleteGroup() {
  const groupId = document.getElementById('edit-group-id').value;
  if (!groupId) return;
  const isEn = window.I18n && window.I18n.getLanguage() === 'en';
  if (!await showConfirmModal({
    icon: '🗑️',
    danger: true,
    title: isEn ? 'Delete Group' : '刪除小組確認',
    desc: isEn ? 'Are you sure you want to delete this group? Members will be moved to Unassigned.' : '確定要刪除此小組嗎？組內成員將會移至「未分組」區。',
    confirmText: isEn ? 'Delete' : '確定刪除',
    cancelText: isEn ? 'Cancel' : '取消'
  })) return;

  try {
    await API.delete(`/api/groups/${AppState.currentCourseId}/${groupId}`);
    showToast('小組已成功刪除！', 'positive');
    closeModal('modal-edit-group');
    loadGroupingData(AppState.currentGroupPlanId);
    loadDashboardData(true);
    refreshProjectionData(true);
  } catch (err) {
    alert(`刪除小組失敗：${err.message}`);
  }
}

// --- Seating Chart Pane ---
async function loadSeatingData() {
  if (!AppState.currentCourseId || (AppState.courses && AppState.courses.length === 0)) {
    renderEmptyCourseNotice(document.getElementById('seating-grid'));
    return;
  }
  try {
    const data = await API.get(`/api/seating/${AppState.currentCourseId}`);
    document.getElementById('seat-rows-input').value = data.seat_rows;
    document.getElementById('seat-cols-input').value = data.seat_cols;
    
    const bbPos = data.blackboard_position || 'top';
    const posInput = document.getElementById('seat-blackboard-pos-input');
    if (posInput) posInput.value = bbPos;

    ['top', 'bottom', 'left', 'right'].forEach(p => {
      const el = document.getElementById(`podium-banner-${p}`);
      if (el) el.style.display = (p === bbPos) ? 'block' : 'none';
    });

    AppState.seatingData = data;
    renderSeatingGrid(data);
  } catch (err) {
    console.error('Seating load error:', err);
  }
}

function renderSeatingGrid(data) {
  const container = document.getElementById('seating-grid');
  container.style.gridTemplateColumns = `repeat(${data.seat_cols}, minmax(110px, 1fr))`;
  container.innerHTML = '';

  const isEn = window.I18n && window.I18n.getLanguage() === 'en';
  const t = (k, p) => window.I18n ? window.I18n.t(k, p) : k;

  (data.grid || []).forEach(rowCells => {
    rowCells.forEach(cell => {
      const seatEl = document.createElement('div');
      const student = cell.student;
      seatEl.className = `seat-cell ${student ? 'occupied' : 'empty'}`;
      seatEl.dataset.row = cell.row;
      seatEl.dataset.col = cell.col;

      if (student) {
        seatEl.draggable = true;
        seatEl.dataset.studentId = student.id;
        const numText = isEn ? `No. ${student.student_number}` : `${student.student_number}號`;

        seatEl.innerHTML = `
          <div class="seat-coord-badge">(${cell.row},${cell.col})</div>
          <div style="margin-top: 4px; display: flex; justify-content: center;">
            <div style="width: 42px; height: 42px; border-radius: 50%; overflow: hidden; border: 1.5px solid var(--primary-light);">
              ${getStudentAvatarImgHtml(student)}
            </div>
          </div>
          <div style="font-size: 0.8rem; color: var(--text-muted); font-weight: bold; margin-top: 2px;">${numText}</div>
          <div style="font-size: 0.9rem; font-weight: bold;" title="${getStudentDisplayName(student)}">${getStudentDisplayName(student)}</div>
        `;

        seatEl.addEventListener('dragstart', (e) => {
          e.dataTransfer.setData('text/plain', student.id);
          seatEl.style.opacity = '0.5';
        });

        seatEl.addEventListener('dragend', () => {
          seatEl.style.opacity = '1';
        });
      } else {
        seatEl.innerHTML = `
          <div class="seat-coord-badge">(${cell.row},${cell.col})</div>
          <div style="font-size: 0.8rem; margin-top: 10px;">${t('seating_empty_slot')}</div>
        `;
      }

      // Drag Over & Drop on seat
      seatEl.addEventListener('dragover', (e) => {
        e.preventDefault();
        seatEl.classList.add('drag-over');
      });

      seatEl.addEventListener('dragleave', () => {
        seatEl.classList.remove('drag-over');
      });

      seatEl.addEventListener('drop', async (e) => {
        e.preventDefault();
        seatEl.classList.remove('drag-over');
        const studentId = e.dataTransfer.getData('text/plain');
        if (!studentId) return;

        try {
          await API.put(`/api/seating/${AppState.currentCourseId}/drag`, {
            student_id: parseInt(studentId),
            target_row: cell.row,
            target_col: cell.col
          });
          loadSeatingData();
        } catch (err) {
          alert(`座位調整失敗：${err.message}`);
        }
      });

      container.appendChild(seatEl);
    });
  });

  // Render unassigned students
  const unassignedContainer = document.getElementById('seating-unassigned-list');
  unassignedContainer.innerHTML = '';

  if ((data.unassigned || []).length === 0) {
    unassignedContainer.innerHTML = `<div style="color: var(--text-muted); font-size: 0.85rem;">${t('seating_all_seated')}</div>`;
  } else {
    data.unassigned.forEach(s => {
      const card = document.createElement('div');
      card.className = 'student-card';
      card.draggable = true;
      card.dataset.studentId = s.id;
      const numText = isEn ? `No. ${s.student_number}` : `${s.student_number}號`;

      card.innerHTML = `
        <div class="student-avatar gender-${s.gender}" style="overflow: hidden; padding: 0;">
          ${getStudentAvatarImgHtml(s)}
        </div>
        <div class="student-number">${numText}</div>
        <div class="student-name" title="${getStudentDisplayName(s)}">${getStudentDisplayName(s)}</div>
      `;

      card.addEventListener('dragstart', (e) => {
        e.dataTransfer.setData('text/plain', s.id);
      });

      unassignedContainer.appendChild(card);
    });
  }
}

async function saveSeatConfig() {
  if (!ensureCourseSelected()) return;
  const rows = parseInt(document.getElementById('seat-rows-input').value);
  const cols = parseInt(document.getElementById('seat-cols-input').value);
  const bbPos = document.getElementById('seat-blackboard-pos-input').value;

  if (rows < 1 || cols < 1) {
    alert('行列數必須大於等於 1');
    return;
  }

  try {
    await API.post(`/api/seating/${AppState.currentCourseId}/config`, {
      seat_rows: rows,
      seat_cols: cols,
      blackboard_position: bbPos
    });
    loadSeatingData();
  } catch (err) {
    alert(`儲存座位設定失敗：${err.message}`);
  }
}

async function autoArrangeSeats(mode) {
  if (!ensureCourseSelected()) return;
  try {
    await API.post(`/api/seating/${AppState.currentCourseId}/auto`, { mode: mode });
    loadSeatingData();
  } catch (err) {
    alert(`自動編排座位失敗：${err.message}`);
  }
}

async function runAutoGrouping() {
  if (!ensureCourseSelected()) return;
  const targetType = document.getElementById('group-target-type').value;
  const targetVal = parseInt(document.getElementById('group-target-value').value);
  const mode = document.getElementById('group-mode').value;

  const payload = { 
    mode: mode,
    plan_id: AppState.currentGroupPlanId
  };
  if (targetType === 'per_group') {
    payload.students_per_group = targetVal;
  } else {
    payload.num_groups = targetVal;
  }

  try {
    const data = await API.post(`/api/groups/${AppState.currentCourseId}/auto`, payload);
    renderGroupColumns(data);
    loadDashboardData(true);
    refreshProjectionData(true);
  } catch (err) {
    alert(`自動分組失敗：${err.message}`);
  }
}

// --- Qualitative Notes Pane ---

// 常用片語：點一下就帶入文字，課堂中不必打字（電腦版紀錄頁與評分頁的快速紀錄視窗共用）
const NOTE_QUICK_PHRASES = [
  { zh: '主動發言', en: 'Spoke up', tone: 'pos' },
  { zh: '專注認真', en: 'Focused', tone: 'pos' },
  { zh: '幫助同學', en: 'Helped a classmate', tone: 'pos' },
  { zh: '進步明顯', en: 'Clear progress', tone: 'pos' },
  { zh: '創意表現', en: 'Creative work', tone: 'pos' },
  { zh: '分享想法', en: 'Shared ideas', tone: 'pos' },
  { zh: '需要提醒', en: 'Needs a reminder', tone: 'neg' },
  { zh: '情緒不穩', en: 'Upset', tone: 'neg' },
  { zh: '與同學衝突', en: 'Conflict with peers', tone: 'neg' },
  { zh: '作業未完成', en: 'Homework missing', tone: 'neg' }
];

function renderNotePhraseChips(containerId, textareaId) {
  const container = document.getElementById(containerId);
  const textarea = document.getElementById(textareaId);
  if (!container || !textarea) return;
  const isEn = window.I18n && window.I18n.getLanguage() === 'en';
  container.innerHTML = '';
  NOTE_QUICK_PHRASES.forEach(ph => {
    const label = isEn ? ph.en : ph.zh;
    const chip = document.createElement('button');
    chip.type = 'button';
    chip.className = `note-phrase-chip ${ph.tone}`;
    chip.textContent = label;
    chip.addEventListener('click', () => {
      const cur = textarea.value.trim();
      if (cur.includes(label)) return;
      textarea.value = cur ? `${cur}${isEn ? ', ' : '、'}${label}` : label;
      textarea.focus();
    });
    container.appendChild(chip);
  });
}

// 「拍照／錄影」與「選擇檔案」兩個輸入擇一：選了其中一個就清掉另一個
function bindExclusiveMediaInputs(inputIds) {
  const inputs = inputIds.map(id => document.getElementById(id)).filter(Boolean);
  inputs.forEach(inp => {
    inp.addEventListener('change', () => {
      if (!inp.files || inp.files.length === 0) return;
      inputs.forEach(other => { if (other !== inp) other.value = ''; });
    });
  });
}

function getNoteMediaFile(inputIds) {
  for (const id of inputIds) {
    const el = document.getElementById(id);
    if (el && el.files && el.files[0]) return el.files[0];
  }
  return null;
}

function resetNoteMedia(inputIds) {
  inputIds.forEach(id => resetCustomFileInput(document.getElementById(id)));
}

const NOTE_MEDIA_INPUT_IDS = ['note-media-camera', 'note-media-file'];
const QUICK_NOTE_MEDIA_INPUT_IDS = ['quick-note-media-camera', 'quick-note-media-file'];

function setNoteDate(dateStr) {
  const input = document.getElementById('note-date');
  if (input) input.value = dateStr;
  const label = document.getElementById('note-date-text');
  if (label) {
    const t = (k, p) => window.I18n ? window.I18n.t(k, p) : k;
    label.textContent = dateStr === getTaiwanTodayDateStr() ? `${dateStr}（${t('notes_date_today')}）` : dateStr;
  }
}

function selectNoteStudent(studentId) {
  const hidden = document.getElementById('note-student-select');
  if (!hidden) return;
  const next = String(hidden.value) === String(studentId) ? '' : String(studentId);
  hidden.value = next;
  document.querySelectorAll('#note-student-picker .note-student-chip').forEach(chip => {
    chip.classList.toggle('selected', next !== '' && chip.dataset.studentId === next);
  });
}

function renderNoteStudentPicker(students) {
  const picker = document.getElementById('note-student-picker');
  const hidden = document.getElementById('note-student-select');
  if (!picker || !hidden) return;
  const isEn = window.I18n && window.I18n.getLanguage() === 'en';
  const keep = hidden.value;
  picker.innerHTML = '';
  students.forEach(s => {
    const chip = document.createElement('button');
    chip.type = 'button';
    chip.className = 'note-student-chip';
    chip.dataset.studentId = s.id;

    const avatar = document.createElement('span');
    avatar.className = 'note-student-avatar';
    avatar.innerHTML = getStudentAvatarImgHtml(s);
    const num = document.createElement('span');
    num.className = 'note-student-num';
    num.textContent = isEn ? `No.${s.student_number}` : `${s.student_number}號`;
    const name = document.createElement('span');
    name.className = 'note-student-name';
    name.textContent = getStudentDisplayName(s);

    chip.append(avatar, num, name);
    chip.addEventListener('click', () => selectNoteStudent(s.id));
    picker.appendChild(chip);
  });
  hidden.value = '';
  if (keep && students.some(s => String(s.id) === String(keep))) selectNoteStudent(keep);
}

function initNoteQuickForm() {
  renderNotePhraseChips('note-phrase-chips', 'note-text-input');
  bindExclusiveMediaInputs(NOTE_MEDIA_INPUT_IDS);
  bindExclusiveMediaInputs(QUICK_NOTE_MEDIA_INPUT_IDS);

  const toggleBtn = document.getElementById('btn-note-toggle-date');
  const editWrap = document.getElementById('note-date-edit-wrap');
  if (toggleBtn && editWrap) {
    toggleBtn.addEventListener('click', () => {
      const show = editWrap.style.display === 'none';
      editWrap.style.display = show ? 'inline-flex' : 'none';
    });
  }
  const dateInput = document.getElementById('note-date');
  if (dateInput) {
    const sync = () => { if (dateInput.value) setNoteDate(dateInput.value); };
    dateInput.addEventListener('change', sync);
    dateInput.addEventListener('input', sync);
  }
}

async function loadNotesData() {
  if (!AppState.currentCourseId || (AppState.courses && AppState.courses.length === 0)) {
    renderEmptyCourseNotice(document.getElementById('notes-list-container'));
    return;
  }
  try {
    const [students, notes] = await Promise.all([
      API.get(`/api/courses/${AppState.currentCourseId}/students`),
      API.get(`/api/notes/${AppState.currentCourseId}`)
    ]);

    renderNoteStudentPicker(students);
    setNoteDate(getTaiwanTodayDateStr());
    renderNotePhraseChips('note-phrase-chips', 'note-text-input');
    renderNotesList(notes);
  } catch (err) {
    console.error('Notes load error:', err);
  }
}

function renderNotesList(notes) {
  const container = document.getElementById('notes-list-container');
  container.innerHTML = '';

  const isEn = window.I18n && window.I18n.getLanguage() === 'en';
  const t = (k, p) => window.I18n ? window.I18n.t(k, p) : k;

  if (notes.length === 0) {
    container.innerHTML = `<div style="color: var(--text-muted); text-align: center; padding: 20px;">${t('notes_no_records')}</div>`;
    return;
  }

  notes.forEach(note => {
    const item = document.createElement('div');
    item.className = 'glass-card';
    item.style.padding = '14px';
    item.style.marginBottom = '10px';

    let mediaHtml = '';
    if (note.media_url) {
      if (note.media_type === 'video') {
        mediaHtml = `<video src="${note.media_url}" controls style="max-width: 100%; max-height: 360px; border-radius: 8px; margin-top: 10px; display: block; border: 1px solid var(--card-border);"></video>`;
      } else {
        mediaHtml = `<img src="${note.media_url}" alt="照片" style="max-width: 100%; max-height: 360px; border-radius: 8px; margin-top: 10px; display: block; cursor: pointer; border: 1px solid var(--card-border);" onclick="window.open('${note.media_url}', '_blank')">`;
      }
    }

    const noteStudent = AppState.students.find(s => s.id === note.student_id) || { id: note.student_id, student_number: note.student_number, name: note.student_name };
    const numText = isEn ? `No. ${note.student_number}` : `${note.student_number}號`;

    item.innerHTML = `
      <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 6px; font-weight: bold; color: var(--primary-light);">
        <div style="display: flex; align-items: center; gap: 8px;">
          <div style="width: 28px; height: 28px; border-radius: 50%; overflow: hidden; flex-shrink: 0;">
            ${getStudentAvatarImgHtml(noteStudent)}
          </div>
          <span>${numText} ${getStudentDisplayName(noteStudent)}</span>
        </div>
        <div style="display: flex; align-items: center; gap: 8px;">
          <span style="font-size: 0.8rem; color: var(--text-muted);">${note.timestamp}</span>
          <button class="btn-del-note btn-icon" style="width: 24px; height: 24px; font-size: 0.7rem;" title="刪除紀錄">✕</button>
        </div>
      </div>
      <div style="font-size: 0.95rem; line-height: 1.5; white-space: pre-wrap;">${note.note_text}</div>
      ${mediaHtml}
    `;

    item.querySelector('.btn-del-note').onclick = async () => {
      const isEn = window.I18n && window.I18n.getLanguage() === 'en';
      if (await showConfirmModal({
        icon: '🗑️',
        danger: true,
        title: isEn ? 'Delete Note' : '刪除特殊表現紀錄',
        desc: t('notes_delete_confirm'),
        confirmText: isEn ? 'Delete' : '確定刪除',
        cancelText: isEn ? 'Cancel' : '取消'
      })) {
        await API.delete(`/api/notes/${AppState.currentCourseId}/${note.id}`);
        loadNotesData();
      }
    };

    container.appendChild(item);
  });
}

async function saveNote() {
  if (!ensureCourseSelected()) return;
  const studentId = document.getElementById('note-student-select').value;
  const noteText = document.getElementById('note-text-input').value.trim();
  const dateStr = document.getElementById('note-date').value || getTaiwanTodayDateStr();
  const mediaFile = getNoteMediaFile(NOTE_MEDIA_INPUT_IDS);
  const t = (k, p) => window.I18n ? window.I18n.t(k, p) : k;

  if (!studentId) {
    alert(t('notes_need_student'));
    return;
  }
  if (!noteText && !mediaFile) {
    alert('請輸入紀錄內容或選擇要上傳的照片/影片！');
    return;
  }

  try {
    if (mediaFile) {
      const formData = new FormData();
      formData.append('student_id', studentId);
      formData.append('note_text', noteText || '【多媒體特殊表現紀錄】');
      formData.append('date_str', dateStr);
      formData.append('media_file', mediaFile);

      await API.postFormData(`/api/notes/${AppState.currentCourseId}/with_media`, formData);
    } else {
      await API.post(`/api/notes/${AppState.currentCourseId}`, {
        student_id: parseInt(studentId),
        note_text: noteText,
        date: dateStr
      });
    }

    // 存完清空學生選取，避免連續紀錄時誤記到同一位學生
    document.getElementById('note-text-input').value = '';
    resetNoteMedia(NOTE_MEDIA_INPUT_IDS);
    document.getElementById('note-student-select').value = '';
    loadNotesData();
  } catch (err) {
    alert(`儲存筆記失敗：${err.message}`);
  }
}

// --- Dashboard & Leaderboard Pane ---
let projectionTimerId = null;
let prevStudentScoresMap = {};
let prevGroupScoresMap = {};
let prevDashStudentScoresMap = {};
let prevDashGroupScoresMap = {};
let lastRosterDisplaySignature = '';
let lastDashboardFingerprint = null;
let lastProjectionFingerprint = null;

function computeDataFingerprint(data, context) {
  if (!data) return '';
  const students = (data.students || []).map(s => `${s.id}:${s.score}:${s.is_absent ? 1 : 0}:${s.group_name || ''}`).join('|');
  const groups = (data.group_leaderboard || []).map(g => `${g.group_name}:${g.total_score}:${g.member_count}`).join('|');
  const indRanks = (data.individual_leaderboard || []).map(s => `${s.id}:${s.score}`).join('|');
  return `${context.courseId}_${context.period}_${context.range || ''}_${context.mode || ''}_S[${students}]_G[${groups}]_R[${indRanks}]`;
}

function notifyScoreUpdates() {
  lastDashboardFingerprint = null;
  // If Dashboard tab is active, reload immediately
  if (getActiveTabName() === 'dashboard') {
    loadDashboardData(true);
  }
  // If Big Screen Overlay is open, reload immediately
  const overlay = document.getElementById('big-screen-projection-overlay');
  if (overlay && overlay.classList.contains('open')) {
    refreshProjectionData(true);
  }
}

async function loadDashboardData(force = false) {
  if (!AppState.currentCourseId || (AppState.courses && AppState.courses.length === 0)) {
    renderEmptyCourseNotice(document.getElementById('all-students-score-grid'));
    renderEmptyCourseNotice(document.getElementById('individual-leaderboard'));
    return;
  }
  try {
    let url = `/api/reports/${AppState.currentCourseId}/dashboard?period=${AppState.dashboardPeriod}`;
    let rangeStr = '';
    if (AppState.dashboardPeriod === 'range') {
      const s = document.getElementById('dash-start-date')?.value;
      const e = document.getElementById('dash-end-date')?.value;
      if (!s || !e) {
        const indContainer = document.getElementById('individual-leaderboard');
        const grpContainer = document.getElementById('group-leaderboard');
        const allGrid = document.getElementById('all-students-score-grid');
        const t = (k, p) => window.I18n ? window.I18n.t(k, p) : k;
        if (indContainer) {
          indContainer.innerHTML = `
            <div class="proj-range-waiting-card" style="padding: 36px 20px;">
              <div class="proj-range-waiting-icon" style="font-size: 2.6rem;">🏆</div>
              <div class="proj-range-waiting-title" style="color: var(--text-main); font-size: 1.1rem;">${t('dash_range_prompt_ind')}</div>
              <div class="proj-range-waiting-desc">可直接選擇日期或點擊快捷標籤（近 7 天、近 30 天、本月）</div>
            </div>
          `;
        }
        if (grpContainer) {
          grpContainer.innerHTML = `
            <div class="proj-range-waiting-card" style="padding: 36px 20px;">
              <div class="proj-range-waiting-icon" style="font-size: 2.6rem;">🚩</div>
              <div class="proj-range-waiting-title" style="color: var(--text-main); font-size: 1.1rem;">${t('dash_range_prompt_grp')}</div>
              <div class="proj-range-waiting-desc">可直接選擇日期或點擊快捷標籤（近 7 天、近 30 天、本月）</div>
            </div>
          `;
        }
        if (allGrid) {
          allGrid.innerHTML = `
            <div class="proj-range-waiting-card" style="padding: 36px 20px; grid-column: 1 / -1;">
              <div class="proj-range-waiting-icon" style="font-size: 2.6rem;">📋</div>
              <div class="proj-range-waiting-title" style="color: var(--text-main); font-size: 1.1rem;">${t('dash_range_prompt_all')}</div>
              <div class="proj-range-waiting-desc">可直接選擇日期或點擊快捷標籤（近 7 天、近 30 天、本月）</div>
            </div>
          `;
        }
        return;
      }
      url += `&start_date=${s}&end_date=${e}`;
      rangeStr = `${s}_${e}`;
    }

    const data = await API.get(url);

    // Compute fingerprint to detect if data has truly changed
    const fingerprint = computeDataFingerprint(data, {
      courseId: AppState.currentCourseId,
      period: AppState.dashboardPeriod,
      range: rangeStr,
      mode: AppState.dashboardViewMode
    });

    // If data didn't change and not forced, skip DOM re-render completely!
    if (!force && fingerprint === lastDashboardFingerprint) {
      return;
    }

    lastDashboardFingerprint = fingerprint;
    renderLeaderboards(data);
  } catch (err) {
    console.error('Dashboard load error:', err);
  }
}

function renderLeaderboards(data) {
  const isEn = window.I18n && window.I18n.getLanguage() === 'en';
  const t = (k, p) => window.I18n ? window.I18n.t(k, p) : k;

  // 1. 個人榮譽排行榜 (Top 10, 0 分不列入排名, 同分並列)
  const indContainer = document.getElementById('individual-leaderboard');
  if (indContainer) {
    indContainer.innerHTML = '';
    const indList = (data.individual_leaderboard || []).filter(s => s.score > 0);
    if (indList.length === 0) {
      indContainer.innerHTML = `<div style="text-align: center; color: var(--text-muted); padding: 30px; font-weight: 600;">${t('dash_no_individual_scores')}</div>`;
    } else {
      let currentRank = 1;
      indList.forEach((s, idx) => {
        if (idx > 0 && s.score < indList[idx - 1].score) {
          currentRank = idx + 1;
        }
        s.rank = currentRank;
        const item = document.createElement('div');
        item.className = 'leader-item';
        const rankClass = s.rank === 1 ? 'rank-1' : s.rank === 2 ? 'rank-2' : s.rank === 3 ? 'rank-3' : '';
        const badgeEmoji = s.rank === 1 ? '🥇' : s.rank === 2 ? '🥈' : s.rank === 3 ? '🥉' : `${s.rank}`;

        const prev = prevDashStudentScoresMap[s.id];
        let animClass = '';
        if (prev !== undefined && prev !== null) {
          if (s.score > prev) animClass = 'score-animate-up';
          else if (s.score < prev) animClass = 'score-animate-down';
        }

        const numPrefix = isEn ? `No. ${s.student_number}` : `${s.student_number}號`;
        const groupText = s.group_name || (isEn ? 'Unassigned' : '未分組');
        const detailBtnText = t('dash_log_detail_btn');

        item.style.cursor = 'pointer';
        item.innerHTML = `
          <div style="display: flex; align-items: center; gap: 12px;">
            <div class="leader-rank ${rankClass}">${badgeEmoji}</div>
            <div style="width: 34px; height: 34px; border-radius: 50%; overflow: hidden; flex-shrink: 0;">
              ${getStudentAvatarImgHtml(s)}
            </div>
            <div>
              <div style="font-weight: 800; font-size: 1rem;">${numPrefix} ${getStudentDisplayName(s)}</div>
              <div style="font-size: 0.76rem; color: var(--text-muted); font-weight: 600;">${groupText}</div>
            </div>
          </div>
          <div style="display: flex; align-items: center; gap: 8px;">
            <div class="${animClass}" style="font-weight: 900; font-size: 1.15rem; color: #d3a24c; display: inline-block;">${s.score} ${t('pts')}</div>
            <button class="btn btn-secondary btn-log-detail" style="font-size: 0.75rem; padding: 3px 9px; border-radius: var(--radius-full);" title="${detailBtnText}">${detailBtnText}</button>
          </div>
        `;
        item.querySelector('.btn-log-detail').onclick = (e) => {
          e.stopPropagation();
          openStudentScoreLogsModal(s.id);
        };
        item.onclick = () => openStudentScoreLogsModal(s.id);
        indContainer.appendChild(item);
      });
    }
  }

  // 2. 小組榮譽排行榜 (0 分不列入排名, 同分並列)
  const grpContainer = document.getElementById('group-leaderboard');
  if (grpContainer) {
    grpContainer.innerHTML = '';
    const grpList = (data.group_leaderboard || []).filter(g => g.total_score > 0);
    if (grpList.length === 0) {
      grpContainer.innerHTML = `<div style="text-align: center; color: var(--text-muted); padding: 30px; font-weight: 600;">${t('dash_no_group_scores')}</div>`;
    } else {
      let currentRank = 1;
      grpList.forEach((g, idx) => {
        if (idx > 0 && g.total_score < grpList[idx - 1].total_score) {
          currentRank = idx + 1;
        }
        g.rank = currentRank;
        const item = document.createElement('div');
        item.className = 'leader-item';
        const rankClass = g.rank === 1 ? 'rank-1' : g.rank === 2 ? 'rank-2' : g.rank === 3 ? 'rank-3' : '';
        const badgeEmoji = g.rank === 1 ? '🥇' : g.rank === 2 ? '🥈' : g.rank === 3 ? '🥉' : `${g.rank}`;

        const prevGrp = prevDashGroupScoresMap[g.group_name];
        let animClass = '';
        if (prevGrp !== undefined && prevGrp !== null) {
          if (g.total_score > prevGrp) animClass = 'score-animate-up';
          else if (g.total_score < prevGrp) animClass = 'score-animate-down';
        }

        const memberText = isEn ? `(${g.member_count} students)` : `(${g.member_count}人)`;
        const totalText = isEn ? `${g.total_score} pts` : `${g.total_score} 分`;

        item.innerHTML = `
          <div style="display: flex; align-items: center; gap: 12px;">
            <div class="leader-rank ${rankClass}">${badgeEmoji}</div>
            <div style="width: 38px; height: 38px; border-radius: 8px; background: rgba(255,255,255,0.06); display: flex; align-items: center; justify-content: center; flex-shrink: 0; padding: 2px;">
              <img src="${getGroupAvatarSrc(g, idx)}" alt="${g.group_name}" style="width: 32px; height: 32px; object-fit: contain;">
            </div>
            <div>
              <div style="font-weight: 800; font-size: 1rem;">${g.group_name} <span style="font-size: 0.8rem; color: var(--text-muted); font-weight: normal;">${memberText}</span></div>
            </div>
          </div>
          <div class="${animClass}" style="font-weight: 900; font-size: 1.18rem; color: #d3a24c; display: inline-block;">${totalText}</div>
        `;
        grpContainer.appendChild(item);
      });
    }
  }

  // 3. 全班座號得分一覽表 (依座號 1 ~ N 排序，原地差量更新防抖動與零重繪)
  const allGrid = document.getElementById('all-students-score-grid');
  if (allGrid) {
    const students = data.students || [];
    if (students.length === 0) {
      allGrid.innerHTML = `<div style="text-align: center; color: var(--text-muted); padding: 30px; grid-column: 1 / -1; font-weight: 600;">${t('dash_no_students')}</div>`;
    } else {
      // Check if existing cards match current student list, or the language /
      // name-display-mode changed since the last render — either invalidates the
      // in-place score-only update path below, since student names must re-render too.
      const displaySignature = `${isEn ? 'en' : 'zh'}_${window.I18n ? window.I18n.getNameDisplayMode() : ''}`;
      const existingCards = allGrid.querySelectorAll('.student-score-card');
      const needFullRebuild = existingCards.length !== students.length ||
                              !document.getElementById(`dash-student-card-${students[0].id}`) ||
                              displaySignature !== lastRosterDisplaySignature;
      lastRosterDisplaySignature = displaySignature;

      if (needFullRebuild) {
        allGrid.innerHTML = '';
        students.forEach(s => {
          const card = document.createElement('div');
          const scoreVal = s.score ?? 0;
          const scoreType = scoreVal > 0 ? 'positive' : scoreVal < 0 ? 'negative' : 'neutral';
          const absentClass = s.is_absent ? 'absent' : '';
          const leaveLabel = isEn ? '(Leave)' : '(請假)';
          const absentBadge = s.is_absent ? `<span style="color:#d9807e; font-size:0.72rem; margin-left:4px;">${leaveLabel}</span>` : '';
          const detailBtnText = t('dash_log_detail_btn');

          card.id = `dash-student-card-${s.id}`;
          card.className = `student-score-card ${absentClass}`;
          card.style.cursor = 'pointer';
          card.innerHTML = `
            <div class="student-score-num-badge">${s.student_number}</div>
            <div class="student-score-center-content">
              <div class="student-score-avatar-sec">
                <div class="student-score-avatar">
                  ${getStudentAvatarImgHtml(s)}
                </div>
              </div>
              <div class="student-score-name-sec">
                <div class="student-score-name" title="${getStudentDisplayName(s)}">${getStudentDisplayName(s)}${absentBadge}</div>
              </div>
              <div class="student-score-val-sec">
                <div id="dash-student-score-${s.id}" class="student-score-badge ${scoreType}">
                  ${scoreVal}
                </div>
              </div>
            </div>
            <button class="btn btn-secondary btn-log-detail" style="position: absolute; top: 6px; right: 6px; font-size: 0.65rem; padding: 1px 6px; border-radius: var(--radius-full); opacity: 0.8; z-index: 5;" title="${detailBtnText}">${detailBtnText}</button>
          `;
          card.querySelector('.btn-log-detail').onclick = (e) => {
            e.stopPropagation();
            openStudentScoreLogsModal(s.id);
          };
          card.onclick = () => openStudentScoreLogsModal(s.id);
          allGrid.appendChild(card);
        });
      } else {
        // In-Place Update: 原地更新學生分數與請假狀態，避免整頁重繪
        students.forEach(s => {
          const scoreEl = document.getElementById(`dash-student-score-${s.id}`);
          const cardEl = document.getElementById(`dash-student-card-${s.id}`);
          const scoreVal = s.score ?? 0;
          const prev = prevDashStudentScoresMap[s.id];
          const scoreType = scoreVal > 0 ? 'positive' : scoreVal < 0 ? 'negative' : 'neutral';

          if (cardEl) {
            cardEl.classList.toggle('absent', Boolean(s.is_absent));
          }

          if (scoreEl) {
            const currentText = scoreEl.textContent.trim();
            // 當 DOM 數值與當前時段分數不一致，或分數有變動時，即刻同步更新
            if (currentText !== String(scoreVal) || (prev !== undefined && prev !== null && scoreVal !== prev)) {
              const hasPrev = prev !== undefined && prev !== null;
              const animClass = hasPrev && scoreVal > prev ? 'score-animate-up' : (hasPrev && scoreVal < prev ? 'score-animate-down' : '');
              
              scoreEl.textContent = `${scoreVal}`;
              scoreEl.className = `student-score-badge ${scoreType} ${animClass}`.trim();
              
              if (animClass) {
                setTimeout(() => {
                  if (scoreEl) {
                    scoreEl.className = `student-score-badge ${scoreType}`;
                  }
                }, 850);
              }
            }
          }
        });
      }
    }
  }

  // Update previous dashboard scores map
  (data.students || []).forEach(s => {
    prevDashStudentScoresMap[s.id] = s.score ?? 0;
  });
  (data.group_leaderboard || []).forEach(g => {
    prevDashGroupScoresMap[g.group_name] = g.total_score ?? 0;
  });
}

// --- Big Screen Projection View (📺 大螢幕即時看板 - 獨立純淨 App 應用程式新視窗) ---
function openBigScreenProjection(opts = {}) {
  if (!ensureCourseSelected()) return;
  // 從即時評分頁開啟時，沿用評分頁目前的統計時段（當天／當週／當月）；指定期間則改用儀表板的設定
  const scoringPeriod = AppState.scoringPeriod;
  const period = opts.fromScoring && ['today', 'week', 'month'].includes(scoringPeriod)
    ? scoringPeriod
    : AppState.dashboardPeriod;
  const url = `/projection?course_id=${AppState.currentCourseId}&period=${period}&mode=${AppState.dashboardViewMode}`;
  const width = screen.availWidth || 1920;
  const height = screen.availHeight || 1080;
  // 透過 popup=yes 與各項 menubar/toolbar/location=no 參數開啟隱藏網址列與功能選單的純淨獨立視窗
  const windowFeatures = `popup=yes,width=${width},height=${height},left=0,top=0,menubar=no,toolbar=no,location=no,status=no,personalbar=no,directories=no,resizable=yes,scrollbars=no`;
  
  const projWin = window.open(url, 'KYPS_Classroom_Projection_Window', windowFeatures);
  if (projWin) {
    projWin.focus();
  }
}

function closeBigScreenProjection() {
  const overlay = document.getElementById('big-screen-projection-overlay');
  overlay.classList.remove('open');

  if (document.exitFullscreen && document.fullscreenElement) {
    try { document.exitFullscreen(); } catch (e) {}
  }

  if (projectionTimerId) {
    clearInterval(projectionTimerId);
    projectionTimerId = null;
  }
}

// Helper function to render Olympic Podium (頒獎台) Stage and Rank 4+ list in Big Screen
function renderPodiumStageAndList(list, isGroup = false) {
  const stage = document.getElementById('proj-podium-stage');
  const runnerList = document.getElementById('proj-runners-up-list');
  if (!stage || !runnerList) return;

  stage.innerHTML = '';
  runnerList.innerHTML = '';

  // 1. Filter out items with score <= 0 (0 分不列入排名)
  const activeList = (list || []).filter(item => {
    const scoreVal = isGroup ? item.total_score : item.score;
    return typeof scoreVal === 'number' && scoreVal > 0;
  });

  // 2. Assign tied rankings (同分並列排名)
  let currentRank = 1;
  const rankedList = activeList.map((item, idx) => {
    const currScore = isGroup ? item.total_score : item.score;
    if (idx > 0) {
      const prevScore = isGroup ? activeList[idx - 1].total_score : activeList[idx - 1].score;
      if (currScore < prevScore) {
        currentRank = idx + 1; // Standard competition ranking: e.g. 1, 1, 3
      }
    }
    return {
      ...item,
      rank: currentRank
    };
  });

  const rank1 = rankedList[0] || null;
  const rank2 = rankedList[1] || null;
  const rank3 = rankedList[2] || null;
  const runners = rankedList.slice(3);

  // Helper to build Podium Step HTML
  function getStepHtml(pedestalIndex, item, pedestalClass, defaultMedalEmoji) {
    if (!item) {
      return `
        <div class="podium-step ${pedestalClass}" style="opacity: 0.35;">
          <div class="podium-winner-info">
            <div class="podium-avatar-wrapper">
              <div class="podium-avatar">👤</div>
            </div>
            <div class="podium-name">虛位以待</div>
            <div class="podium-subtitle">-</div>
            <div class="podium-score">- 分</div>
          </div>
          <div class="podium-block">
            <div class="podium-rank-label">${pedestalIndex}</div>
            <div class="podium-rank-text">${defaultMedalEmoji}</div>
          </div>
        </div>
      `;
    }

    const rankNum = item.rank;
    const crown = (rankNum === 1);
    const rankTitle = rankNum === 1 ? '🥇 冠軍' : rankNum === 2 ? '🥈 亞軍' : rankNum === 3 ? '🥉 季軍' : `第 ${rankNum} 名`;
    const title = isGroup ? item.group_name : `${item.student_number}號 ${item.name}`;
    const subtitle = isGroup ? `${item.member_count} 位組員 (平均: ${item.avg_score}分)` : (item.group_name || '未分組');
    const scoreVal = isGroup ? item.total_score : item.score;
    const avatarHtml = isGroup 
      ? `<div style="width: 100%; height: 100%; display: flex; align-items: center; justify-content: center; padding: 6px;"><img src="${getGroupAvatarSrc(item)}" alt="${item.group_name}" style="width: 100%; height: 100%; object-fit: contain;"></div>`
      : getStudentAvatarImgHtml(item);

    const prevScore = isGroup ? prevGroupScoresMap[item.group_name] : prevStudentScoresMap[item.id];
    let animClass = '';
    if (prevScore !== undefined && prevScore !== null) {
      if (scoreVal > prevScore) animClass = 'score-animate-up';
      else if (scoreVal < prevScore) animClass = 'score-animate-down';
    }

    return `
      <div class="podium-step ${pedestalClass}">
        <div class="podium-winner-info">
          <div class="podium-avatar-wrapper">
            ${crown ? '<div class="podium-crown">👑</div>' : ''}
            <div class="podium-avatar">
              ${avatarHtml}
            </div>
          </div>
          <div class="podium-name" title="${title}">${title}</div>
          <div class="podium-subtitle">${subtitle}</div>
          <div class="podium-score ${animClass}">${scoreVal} 分</div>
        </div>
        <div class="podium-block">
          <div class="podium-rank-label">${rankNum}</div>
          <div class="podium-rank-text">${rankTitle}</div>
        </div>
      </div>
    `;
  }

  // Build stage with Olympic layout: 2nd (Left), 1st (Center), 3rd (Right)
  stage.innerHTML = `
    ${getStepHtml(2, rank2, 'podium-step-2', '🥈 亞軍')}
    ${getStepHtml(1, rank1, 'podium-step-1', '🥇 冠軍')}
    ${getStepHtml(3, rank3, 'podium-step-3', '🥉 季軍')}
  `;

  // Build runner-ups list (Rank 4+)
  if (runners.length === 0) {
    const emptyNotice = rankedList.length === 0 
      ? '目前尚無得分紀錄，虛位以待！' 
      : '無其他名次紀錄';
    runnerList.innerHTML = `<div style="color: #64748b; text-align: center; padding: 20px; grid-column: 1 / -1; font-weight: 600;">${emptyNotice}</div>`;
  } else {
    runners.forEach((item) => {
      const rankNum = item.rank;
      const medalEmoji = rankNum === 1 ? '🥇' : rankNum === 2 ? '🥈' : rankNum === 3 ? '🥉' : `${rankNum}`;
      const title = isGroup ? item.group_name : `${item.student_number}號 ${item.name}`;
      const subtitle = isGroup ? `${item.member_count} 位組員 (組平均: ${item.avg_score}分)` : (item.group_name || '未分組');
      const scoreVal = isGroup ? item.total_score : item.score;
      const avatarHtml = isGroup 
        ? `<div style="width: 38px; height: 38px; display: flex; align-items: center; justify-content: center; flex-shrink: 0;"><img src="${getGroupAvatarSrc(item, rankNum - 1)}" alt="${item.group_name}" style="width: 34px; height: 34px; object-fit: contain;"></div>`
        : `<div style="width: 38px; height: 38px; border-radius: 50%; overflow: hidden; flex-shrink: 0;">${getStudentAvatarImgHtml(item)}</div>`;

      const prevScore = isGroup ? prevGroupScoresMap[item.group_name] : prevStudentScoresMap[item.id];
      let animClass = '';
      let flashClass = '';
      if (prevScore !== undefined && prevScore !== null) {
        if (scoreVal > prevScore) {
          animClass = 'score-animate-up';
          flashClass = 'card-flash-up';
        } else if (scoreVal < prevScore) {
          animClass = 'score-animate-down';
          flashClass = 'card-flash-down';
        }
      }

      const div = document.createElement('div');
      div.className = `proj-item ${flashClass}`;
      div.innerHTML = `
        <div style="display: flex; align-items: center; gap: 14px;">
          <div class="proj-rank">${medalEmoji}</div>
          ${avatarHtml}
          <div>
            <div style="font-weight: 800;">${title}</div>
            <div style="font-size: 0.82rem; color: #94a3b8;">${subtitle}</div>
          </div>
        </div>
        <div class="proj-score ${animClass}">${scoreVal} 分</div>
      `;
      runnerList.appendChild(div);
    });
  }
}

// Render All Students Score Grid for Big Screen View
function renderProjAllStudentsGrid(students) {
  const container = document.getElementById('proj-all-students-grid');
  if (!container) return;
  container.innerHTML = '';

  if (students.length === 0) {
    container.innerHTML = '<div style="color: #94a3b8; text-align: center; padding: 30px; grid-column: 1 / -1; font-size: 1.2rem; font-weight: 700;">目前無學生資料</div>';
    return;
  }

  students.forEach(s => {
    const card = document.createElement('div');
    const prev = prevStudentScoresMap[s.id];
    let animClass = '';
    let flashClass = '';
    if (prev !== undefined && prev !== null) {
      if (s.score > prev) {
        animClass = 'score-animate-up';
        flashClass = 'card-flash-up';
      } else if (s.score < prev) {
        animClass = 'score-animate-down';
        flashClass = 'card-flash-down';
      }
    }

    const scoreType = s.score > 0 ? 'positive' : s.score < 0 ? 'negative' : 'neutral';
    const scorePrefix = s.score > 0 ? '+' : '';
    const absentClass = s.is_absent ? 'absent' : '';
    const absentBadge = s.is_absent ? '<span style="color:#f87171; font-size:0.8rem; margin-left:4px;">(請假)</span>' : '';

    card.className = `proj-score-card ${absentClass} ${flashClass}`;
    card.innerHTML = `
      <div style="display: flex; align-items: center; gap: 12px; min-width: 0;">
        <div class="proj-score-num-badge">${String(s.student_number).padStart(2, '0')}</div>
        <div class="proj-score-avatar">
          ${getStudentAvatarImgHtml(s)}
        </div>
        <div style="min-width: 0;">
          <div class="proj-score-name" title="${s.name}">${s.name}${absentBadge}</div>
          <div class="proj-score-sub">${s.group_name || '未分組'}</div>
        </div>
      </div>
      <div class="proj-score-badge ${scoreType} ${animClass}">
        ${scorePrefix}${s.score}
      </div>
    `;
    container.appendChild(card);
  });
}

async function refreshProjectionData(force = false) {
  if (!AppState.currentCourseId) return;
  try {
    let url = `/api/reports/${AppState.currentCourseId}/dashboard?period=${AppState.dashboardPeriod}`;
    let rangeStr = '';
    if (AppState.dashboardPeriod === 'range') {
      const s = document.getElementById('dash-start-date').value;
      const e = document.getElementById('dash-end-date').value;
      if (s) url += `&start_date=${s}`;
      if (e) url += `&end_date=${e}`;
      rangeStr = `${s}_${e}`;
    }

    const data = await API.get(url);

    // Update course title if changed
    const currentCourse = AppState.courses.find(c => c.id === AppState.currentCourseId);
    if (currentCourse) {
      const titleEl = document.getElementById('proj-course-title');
      const expectedTitle = `${currentCourse.name} - 即時看板`;
      if (titleEl && titleEl.textContent !== expectedTitle) {
        titleEl.textContent = expectedTitle;
      }
    }

    // Update Period Tag label if changed
    const t = (k, p) => window.I18n ? window.I18n.t(k, p) : k;
    const labels = {
      today: t('proj_period_today'),
      week: t('proj_period_week'),
      month: t('proj_period_month'),
      range: t('proj_period_range'),
      semester: t('proj_period_semester')
    };
    const periodLabelEl = document.getElementById('proj-period-label');
    const expectedLabel = labels[AppState.dashboardPeriod] || t('proj_period_today');
    if (periodLabelEl && periodLabelEl.textContent !== expectedLabel) {
      periodLabelEl.textContent = expectedLabel;
    }

    // Compute fingerprint to detect if data has truly changed in big screen view
    const fingerprint = computeDataFingerprint(data, {
      courseId: AppState.currentCourseId,
      period: AppState.dashboardPeriod,
      range: rangeStr,
      mode: AppState.projectionViewMode
    });

    // If data didn't change and not forced, skip DOM re-render completely!
    if (!force && fingerprint === lastProjectionFingerprint) {
      return;
    }

    lastProjectionFingerprint = fingerprint;

    // Toggle container views based on projectionViewMode
    const podiumContainer = document.getElementById('proj-podium-view-container');
    const allStudentsContainer = document.getElementById('proj-all-students-container');

    if (AppState.projectionViewMode === 'all') {
      if (podiumContainer) podiumContainer.style.display = 'none';
      if (allStudentsContainer) allStudentsContainer.style.display = 'block';
      renderProjAllStudentsGrid(data.students || []);
    } else {
      if (podiumContainer) podiumContainer.style.display = 'flex';
      if (allStudentsContainer) allStudentsContainer.style.display = 'none';

      if (AppState.projectionViewMode === 'group') {
        renderPodiumStageAndList(data.group_leaderboard || [], true);
      } else {
        renderPodiumStageAndList(data.individual_leaderboard || [], false);
      }
    }

    // Update scores snapshot
    (data.students || []).forEach(s => {
      prevStudentScoresMap[s.id] = s.score;
    });
    (data.group_leaderboard || []).forEach(g => {
      prevGroupScoresMap[g.group_name] = g.total_score;
    });
  } catch (err) {
    console.error('Projection refresh error:', err);
  }
}

// --- Admin & Export Pane ---
async function loadAdminData() {
  if (!AppState.currentCourseId) {
    renderEmptyCourseNotice(document.getElementById('admin-students-list-container'));
    return;
  }
  loadAdminStudentsData();
  loadAdminRulesData();
  const activeSubtab = document.querySelector('.admin-subtab-btn.active')?.dataset.subtab;
  if (activeSubtab === 'pointcards' && window.PointCardsManager && typeof window.PointCardsManager.reload === 'function') {
    window.PointCardsManager.reload();
  }
}

async function loadAdminStudentsData() {
  const container = document.getElementById('admin-students-list-container');
  if (!container) return;

  const isEn = window.I18n && window.I18n.getLanguage() === 'en';
  const t = (k, p) => window.I18n ? window.I18n.t(k, p) : k;

  if (!AppState.currentCourseId || (AppState.courses && AppState.courses.length === 0)) {
    renderEmptyCourseNotice(container, isEn ? 'No courses in system yet' : '目前系統中尚無任何班級');
    return;
  }

  try {
    const students = await API.get(`/api/courses/${AppState.currentCourseId}/students`);
    container.innerHTML = '';

    if (students.length === 0) {
      renderEmptyStudentRosterNotice(container);
      return;
    }

    students.forEach(s => {
      const item = document.createElement('div');
      item.className = 'glass-card';
      item.style.padding = '10px 14px';
      item.style.display = 'flex';
      item.style.alignItems = 'center';
      item.style.justifyContent = 'space-between';
      item.style.gap = '10px';

      const engStr = s.english_name ? ` (${s.english_name})` : '';
      const codeStr = s.student_code ? (isEn ? ` (ID: ${s.student_code})` : ` (學號: ${s.student_code})`) : '';
      const numText = isEn ? `No. ${s.student_number}` : `${s.student_number}號`;
      const noCodeText = isEn ? 'No ID set' : '未設定學號';
      const accountStr = s.login_account ? (isEn ? ` · 🔑 Login: ${s.login_account}` : ` · 🔑 登入帳號: ${s.login_account}`) : '';
      // 密碼狀態：學生是否已自己設定過密碼（尚未＝仍是預設密碼，或老師恢復預設後還沒再改）
      const pwBadge = s.password_changed
        ? `<span style="display:inline-block; margin-left:6px; padding:1px 8px; border-radius:999px; font-size:0.72rem; font-weight:700; background:rgba(16,185,129,0.15); color:#059669;">${isEn ? '🔒 Own password set' : '🔒 已自訂密碼'}</span>`
        : `<span style="display:inline-block; margin-left:6px; padding:1px 8px; border-radius:999px; font-size:0.72rem; font-weight:700; background:rgba(245,158,11,0.18); color:#b45309;">${isEn ? '⚠️ Not changed yet (default)' : '⚠️ 尚未修改（預設密碼）'}</span>`;
      const hintBadge = s.has_password_hint
        ? `<span title="${isEn ? 'The student has written a password hint' : '學生已寫下密碼提醒'}" style="margin-left:4px; font-size:0.78rem;">💡</span>`
        : '';

      item.innerHTML = `
        <div style="display: flex; align-items: center; gap: 10px; flex: 1;">
          <div style="width: 32px; height: 32px; border-radius: 50%; overflow: hidden; flex-shrink: 0;">
            ${getStudentAvatarImgHtml(s)}
          </div>
          <div>
            <div style="font-weight: bold; font-size: 0.95rem;">${numText} ${getStudentDisplayName(s)}${engStr}${pwBadge}${hintBadge}</div>
            <div style="font-size: 0.78rem; color: var(--text-muted);">${codeStr ? codeStr : noCodeText}${accountStr}</div>
          </div>
        </div>
        <div style="display: flex; gap: 6px;">
          <button class="btn-logs-student btn-icon" style="width: 30px; height: 30px; font-size: 0.8rem;" title="${t('btn_view_logs')}">📜</button>
          <button class="btn-reset-student-pw btn-icon" style="width: 30px; height: 30px; font-size: 0.8rem;" title="${isEn ? 'Restore default password' : '恢復預設密碼（學號）'}">🔑</button>
          <button class="btn-edit-student btn-icon" style="width: 30px; height: 30px; font-size: 0.8rem;" title="${t('admin_edit')}">✏️</button>
          <button class="btn-del-student btn-icon" style="width: 30px; height: 30px; font-size: 0.8rem;" title="${t('admin_delete')}">✕</button>
        </div>
      `;

      item.querySelector('.btn-logs-student').onclick = () => openStudentScoreLogsModal(s.id);
      item.querySelector('.btn-edit-student').onclick = () => openEditStudentModal(s);
      item.querySelector('.btn-reset-student-pw').onclick = async () => {
        const defaultPw = (s.student_code && String(s.student_code).trim()) || String(s.student_number).padStart(4, '0');
        const defaultKind = s.student_code && String(s.student_code).trim()
          ? (isEn ? 'student ID' : '學號')
          : (isEn ? 'seat number (4 digits; no student ID set)' : '座號四碼（此學生未填學號）');
        if (await showConfirmModal({
          icon: '🔑',
          title: isEn ? 'Restore the default password?' : '恢復預設密碼？',
          desc: isEn
            ? `${s.name}'s password will be reset to the default (${defaultKind}: ${defaultPw}). The student must set a new password at next login, and the saved password hint is cleared.`
            : `將【${s.name}】的密碼恢復為預設值（${defaultKind}：${defaultPw}）。學生下次登入時需要自己重新設定密碼，原本寫下的密碼提醒也會一併清除。`,
          confirmText: isEn ? 'Restore' : '確定恢復',
          cancelText: isEn ? 'Cancel' : '取消'
        })) {
          try {
            const res = await API.put(`/api/courses/${AppState.currentCourseId}/students/${s.id}/password`, {});
            showToast(`🔑 ${res.message}`, 'success');
            loadAdminStudentsData();
          } catch (err) {
            showToast(err.message, 'error');
          }
        }
      };
      item.querySelector('.btn-del-student').onclick = async () => {
        if (await showConfirmModal({
          icon: '🗑️',
          danger: true,
          title: isEn ? 'Delete Student Confirmation' : '刪除學生確認',
          desc: isEn ? `Are you sure you want to delete student 【${s.name}】?` : `確定要刪除學生【${s.name}】嗎？此動作將一併移除該學生之所有評分紀錄。`,
          confirmText: isEn ? 'Delete' : '確定刪除',
          cancelText: isEn ? 'Cancel' : '取消'
        })) {
          await API.delete(`/api/courses/${AppState.currentCourseId}/students/${s.id}`);
          loadStudents();
          loadAdminStudentsData();
        }
      };

      container.appendChild(item);
    });
  } catch (err) {
    console.error('Admin students load error:', err);
  }
}

// --- 學生照片：網頁上傳 / 更換 / 移除 ---

/** 將任何瀏覽器可讀的圖片縮成長邊 600px 以內的 JPEG（後端只收 JPEG，檔案也不會過大）。 */
function prepareStudentPhoto(file, maxSide = 600) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      const scale = Math.min(1, maxSide / Math.max(img.naturalWidth, img.naturalHeight));
      const canvas = document.createElement('canvas');
      canvas.width = Math.max(1, Math.round(img.naturalWidth * scale));
      canvas.height = Math.max(1, Math.round(img.naturalHeight * scale));
      const ctx = canvas.getContext('2d');
      ctx.fillStyle = '#fff';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
      URL.revokeObjectURL(url);
      canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('圖片轉換失敗'))), 'image/jpeg', 0.88);
    };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error(`無法讀取圖片：${file.name}`)); };
    img.src = url;
  });
}

/** 照片變更後：清掉前端的「無照片」快取並重新載入名冊與目前頁面。 */
async function afterStudentPhotosChanged() {
  if (window.StudentPhotoCache) { window.StudentPhotoCache.missing.clear(); window.StudentPhotoCache.loaded.clear(); }
  await loadStudents();
  loadAdminStudentsData();
  refreshActiveTab(getActiveTabName());
}

let editingPhotoStudent = null;

function setEditStudentPhotoBlock(student) {
  editingPhotoStudent = student;
  const block = document.getElementById('edit-student-photo-block');
  if (!block) return;
  if (!student) { block.style.display = 'none'; return; }
  const isEn = window.I18n && window.I18n.getLanguage() === 'en';
  block.style.display = 'flex';
  document.getElementById('edit-student-photo-preview').innerHTML = getStudentAvatarImgHtml(student);
  document.getElementById('btn-edit-student-photo-restore').style.display = student.has_photo_backup ? '' : 'none';
  document.getElementById('edit-student-photo-hint').textContent = student.student_code
    ? (isEn ? `Saved as photo/${student.student_code}.jpg` : `將儲存為 photo/${student.student_code}.jpg`)
    : (isEn ? 'Set and save a student ID first (photos are stored by ID).' : '請先設定並儲存學號（照片以學號為檔名）。');
}

async function changeEditingStudentPhoto(file) {
  const s = editingPhotoStudent;
  if (!s || !file) return;
  const isEn = window.I18n && window.I18n.getLanguage() === 'en';
  try {
    const blob = await prepareStudentPhoto(file);
    const fd = new FormData();
    fd.append('file', blob, `${s.student_code || 'photo'}.jpg`);
    await API.putFormData(`/api/courses/${AppState.currentCourseId}/students/${s.id}/photo`, fd);
    await afterStudentPhotosChanged();
    setEditStudentPhotoBlock(AppState.students.find((x) => x.id === s.id) || s);
    showToast(isEn ? 'Photo updated' : '照片已更新', 'success');
  } catch (err) {
    alert(`${isEn ? 'Photo update failed: ' : '更新照片失敗：'}${err.message}`);
  }
}

async function removeEditingStudentPhoto() {
  const s = editingPhotoStudent;
  if (!s) return;
  const isEn = window.I18n && window.I18n.getLanguage() === 'en';
  try {
    await API.delete(`/api/courses/${AppState.currentCourseId}/students/${s.id}/photo`);
    await afterStudentPhotosChanged();
    setEditStudentPhotoBlock(AppState.students.find((x) => x.id === s.id) || s);
    showToast(isEn ? 'Photo removed' : '照片已移除', 'success');
  } catch (err) {
    alert(err.message);
  }
}

/** 批次匯入的預覽視窗：列出每張照片「新增／覆蓋／找不到學號」，由教師勾選要匯入的項目。回傳選中的 File 陣列（取消則為 null）。 */
function showPhotoImportPreview(files, items) {
  const isEn = window.I18n && window.I18n.getLanguage() === 'en';
  const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  return new Promise((resolve) => {
    const urls = files.map((f) => URL.createObjectURL(f));
    // 同一學號出現多張時，預設只勾最後一張，且同學號一次只能勾一張
    const lastOf = new Map();
    items.forEach((it, i) => { if (it.status !== 'unmatched') lastOf.set(it.code, i); });
    const dupCodes = new Set(items.filter((it, i) => it.status !== 'unmatched' && items.findIndex((x) => x.code === it.code && x.status !== 'unmatched') !== i).map((it) => it.code));
    const label = { new: isEn ? 'New' : '新增', overwrite: isEn ? 'Replace existing' : '覆蓋現有照片', unmatched: isEn ? 'No matching ID' : '找不到對應學號' };
    const color = { new: '#15803d', overwrite: '#b45309', unmatched: '#94a3b8' };

    const overlay = document.createElement('div');
    overlay.style.cssText = 'position:fixed;inset:0;z-index:10000;background:rgba(15,23,42,0.55);display:flex;align-items:center;justify-content:center;padding:16px;';
    const rows = items.map((it, i) => {
      const can = it.status !== 'unmatched';
      const checked = can && lastOf.get(it.code) === i;
      // 現有照片讀不到時，與其他頁面一致改顯示預設的男／女生頭像（不顯示破圖）
      const fallback = (it.gender === 'F' || it.gender === 'female' || it.gender === '女') ? '/static/avatars/girl.png' : '/static/avatars/boy.png';
      const current = it.status === 'overwrite' ? `<img src="/photo/${encodeURIComponent(it.code)}.jpg" style="width:44px;height:44px;border-radius:50%;object-fit:cover;" onerror="this.onerror=null;this.src='${fallback}';"><span style="color:var(--text-muted);">→</span>` : '';
      return `
        <label style="display:flex;align-items:center;gap:10px;padding:8px 6px;border-bottom:1px solid var(--glass-border,#e2e8f0);${can ? 'cursor:pointer;' : 'opacity:0.55;'}">
          <input type="checkbox" data-i="${i}" ${checked ? 'checked' : ''} ${can ? '' : 'disabled'}>
          ${current}
          <img src="${urls[i]}" style="width:44px;height:44px;border-radius:50%;object-fit:cover;">
          <div style="flex:1;min-width:0;">
            <div style="font-weight:700;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${esc(it.name)}</div>
            <div style="font-size:0.78rem;color:var(--text-muted);">${can ? `${esc(isEn ? 'No.' : '座號')} ${esc(it.student_number)} ${esc(it.student_name)}（${esc(it.code)}）` : ''}${dupCodes.has(it.code) && can ? (isEn ? ' · duplicate ID: pick one' : ' · 同學號有多張，請擇一') : ''}</div>
          </div>
          <span style="font-size:0.78rem;font-weight:800;color:${color[it.status]};white-space:nowrap;">${label[it.status]}</span>
        </label>`;
    }).join('');
    const nNew = items.filter((x) => x.status === 'new').length;
    const nOver = items.filter((x) => x.status === 'overwrite').length;
    const nNo = items.filter((x) => x.status === 'unmatched').length;
    overlay.innerHTML = `
      <div style="background:var(--card-bg,#fff);color:var(--text-main,#1e293b);border-radius:16px;width:min(620px,100%);max-height:88vh;display:flex;flex-direction:column;box-shadow:0 20px 60px rgba(0,0,0,0.35);">
        <div style="padding:16px 18px 8px;">
          <div style="font-size:1.1rem;font-weight:900;">${isEn ? 'Review photo import' : '批次匯入照片：預覽'}</div>
          <div style="font-size:0.85rem;color:var(--text-muted);margin-top:4px;">
            ${isEn ? `New ${nNew} · Replace ${nOver} · Unmatched ${nNo}. Replaced photos are kept once and can be restored from the student's edit window.` : `新增 ${nNew} 張 · 覆蓋 ${nOver} 張 · 找不到學號 ${nNo} 張。被覆蓋的舊照片會保留一份，可在學生編輯視窗還原。`}
          </div>
        </div>
        <div style="overflow:auto;padding:0 12px;flex:1;">${rows}</div>
        <div style="display:flex;gap:8px;justify-content:flex-end;padding:12px 18px;align-items:center;">
          <span data-count style="margin-right:auto;font-size:0.85rem;color:var(--text-muted);"></span>
          <button type="button" class="btn btn-secondary" data-cancel>${isEn ? 'Cancel' : '取消'}</button>
          <button type="button" class="btn" data-ok>${isEn ? 'Import selected' : '匯入選取的照片'}</button>
        </div>
      </div>`;
    document.body.appendChild(overlay);

    const boxes = Array.from(overlay.querySelectorAll('input[type=checkbox]'));
    const refresh = () => {
      const n = boxes.filter((b) => b.checked).length;
      overlay.querySelector('[data-count]').textContent = isEn ? `${n} selected` : `已選 ${n} 張`;
      overlay.querySelector('[data-ok]').disabled = n === 0;
    };
    boxes.forEach((b) => b.addEventListener('change', () => {
      if (b.checked) {
        const code = items[Number(b.dataset.i)].code;
        boxes.forEach((o) => { if (o !== b && items[Number(o.dataset.i)].code === code) o.checked = false; });
      }
      refresh();
    }));
    refresh();

    const close = (result) => { urls.forEach((u) => URL.revokeObjectURL(u)); overlay.remove(); resolve(result); };
    overlay.querySelector('[data-cancel]').addEventListener('click', () => close(null));
    overlay.querySelector('[data-ok]').addEventListener('click', () => close(boxes.filter((b) => b.checked).map((b) => files[Number(b.dataset.i)])));
  });
}

/** 批次匯入：檔名（不含副檔名）須為學號；先預覽（新增／覆蓋／找不到學號）再由教師確認。 */
async function batchImportStudentPhotos(files) {
  if (!files.length) return;
  if (!ensureCourseSelected()) return;
  const isEn = window.I18n && window.I18n.getLanguage() === 'en';
  try {
    const preview = await API.post(`/api/courses/${AppState.currentCourseId}/students/photos/preview`, { names: files.map((f) => f.name) });
    const chosen = await showPhotoImportPreview(files, preview.items);
    if (!chosen || !chosen.length) return;
    const fd = new FormData();
    for (const f of chosen) {
      fd.append('files', await prepareStudentPhoto(f), f.name);
    }
    const res = await API.postFormData(`/api/courses/${AppState.currentCourseId}/students/photos`, fd);
    await afterStudentPhotosChanged();
    let msg = isEn ? `Imported ${res.saved_count} photo(s).` : `已匯入 ${res.saved_count} 張照片。`;
    if (res.skipped.length) {
      msg += (isEn ? `\n\nSkipped ${res.skipped.length}:\n` : `\n\n略過 ${res.skipped.length} 張：\n`)
        + res.skipped.slice(0, 15).map((x) => `• ${x.name}（${x.reason}）`).join('\n');
      if (res.skipped.length > 15) msg += '\n…';
    }
    alert(msg);
  } catch (err) {
    alert(`${isEn ? 'Photo import failed: ' : '匯入照片失敗：'}${err.message}`);
  }
}

/** 還原上一張照片（被覆蓋或移除前自動保留的那一張）。 */
async function restoreEditingStudentPhoto() {
  const s = editingPhotoStudent;
  if (!s) return;
  const isEn = window.I18n && window.I18n.getLanguage() === 'en';
  try {
    await API.post(`/api/courses/${AppState.currentCourseId}/students/${s.id}/photo/restore`, {});
    await afterStudentPhotosChanged();
    setEditStudentPhotoBlock(AppState.students.find((x) => x.id === s.id) || s);
    showToast(isEn ? 'Previous photo restored' : '已還原上一張照片', 'success');
  } catch (err) {
    alert(err.message);
  }
}

function openAddStudentModal() {
  if (!ensureCourseSelected()) return;
  setEditStudentPhotoBlock(null);
  const nextNumber = AppState.students.length + 1;
  document.getElementById('edit-student-id').value = '';
  document.getElementById('edit-student-number').value = nextNumber;
  document.getElementById('edit-student-code').value = '';
  // 帳號必填——預先帶入建議值（{課程ID}-{座號4碼}），教師可直接沿用或自行改成好記的帳號。
  document.getElementById('edit-student-login-account').value = `${AppState.currentCourseId}-${String(nextNumber).padStart(4, '0')}`;
  document.getElementById('edit-student-password').value = '';
  document.getElementById('edit-student-name').value = '';
  const engInput = document.getElementById('edit-student-english-name');
  if (engInput) engInput.value = '';
  document.getElementById('edit-student-gender').value = 'M';
  document.getElementById('edit-student-modal-title').textContent = window.I18n ? window.I18n.t('modal_add_student_title') : '➕ 新增學生';
  openModal('modal-edit-student');
}

function openEditStudentModal(s) {
  document.getElementById('edit-student-id').value = s.id;
  document.getElementById('edit-student-number').value = s.student_number;
  document.getElementById('edit-student-code').value = s.student_code || '';
  document.getElementById('edit-student-login-account').value = s.login_account || '';
  document.getElementById('edit-student-password').value = '';
  document.getElementById('edit-student-name').value = s.name;
  const engInput = document.getElementById('edit-student-english-name');
  if (engInput) engInput.value = s.english_name || '';
  document.getElementById('edit-student-gender').value = s.gender || 'M';
  setEditStudentPhotoBlock(s);
  const prefix = window.I18n ? window.I18n.t('modal_edit_student_title') : '✏️ 編輯學生資料';
  document.getElementById('edit-student-modal-title').textContent = `${prefix} (${getStudentDisplayName(s)})`;
  openModal('modal-edit-student');
}

async function confirmSaveStudent() {
  const sid = document.getElementById('edit-student-id').value;
  const num = parseInt(document.getElementById('edit-student-number').value);
  const code = document.getElementById('edit-student-code').value.trim();
  const loginAccount = document.getElementById('edit-student-login-account').value.trim();
  const password = document.getElementById('edit-student-password').value.trim();
  const name = document.getElementById('edit-student-name').value.trim();
  const engInput = document.getElementById('edit-student-english-name');
  const englishName = engInput ? engInput.value.trim() : '';
  const gender = document.getElementById('edit-student-gender').value;

  if (!num || !name) {
    alert(window.I18n && window.I18n.getLanguage() === 'en' ? 'Please fill in Seat No. and Name!' : '請填寫座號與姓名！');
    return;
  }
  if (!loginAccount) {
    alert(window.I18n && window.I18n.getLanguage() === 'en' ? 'Please fill in the login account!' : '請填寫學生登入帳號！');
    return;
  }

  try {
    if (sid) {
      await API.put(`/api/courses/${AppState.currentCourseId}/students/${sid}`, {
        student_number: num,
        student_code: code || null,
        login_account: loginAccount,
        name: name,
        english_name: englishName || null,
        gender: gender
      });
      // 密碼欄位留空＝不修改；有值才呼叫專屬的密碼端點更新。
      if (password) {
        await API.put(`/api/courses/${AppState.currentCourseId}/students/${sid}/password`, { password: password });
      }
    } else {
      await API.post(`/api/courses/${AppState.currentCourseId}/students`, {
        student_number: num,
        student_code: code || null,
        login_account: loginAccount,
        password: password || undefined,
        name: name,
        english_name: englishName || null,
        gender: gender
      });
    }

    document.querySelectorAll('.modal-overlay').forEach(m => m.classList.remove('open'));
    await loadStudents();
    loadAdminStudentsData();
    refreshActiveTab(getActiveTabName());
  } catch (err) {
    alert(`儲存學生資料失敗：${err.message}`);
  }
}

async function loadAdminRulesData() {
  if (!AppState.currentCourseId) return;
  try {
    const rules = await API.get(`/api/scores/${AppState.currentCourseId}/rules`);
    const container = document.getElementById('admin-rules-list');
    container.innerHTML = '';

    const isEn = window.I18n && window.I18n.getLanguage() === 'en';
    const t = (k, p) => window.I18n ? window.I18n.t(k, p) : k;

    rules.forEach(r => {
      const item = document.createElement('div');
      item.className = `rule-btn ${r.category}`;
      item.style.cursor = 'default';
      const displayTitle = window.I18n ? window.I18n.getRuleDisplayTitle(r.title) : r.title;
      item.innerHTML = `
        <span>${r.icon} ${displayTitle} (${r.score_value > 0 ? '+' : ''}${r.score_value})</span>
        <div style="display: flex; gap: 4px; margin-left: 8px;">
          <button class="btn-edit-rule btn-icon" style="width: 26px; height: 26px; font-size: 0.75rem;" title="${t('admin_edit')}">✏️</button>
          <button class="btn-del-rule btn-icon" style="width: 26px; height: 26px; font-size: 0.75rem;" title="${t('admin_delete')}">✕</button>
        </div>
      `;

      item.querySelector('.btn-edit-rule').onclick = (e) => {
        e.stopPropagation();
        openEditRuleModal(r);
      };

      item.querySelector('.btn-del-rule').onclick = async (e) => {
        e.stopPropagation();
        if (await showConfirmModal({
          icon: '🗑️',
          danger: true,
          title: isEn ? 'Delete Rule Confirmation' : '刪除評分項目確認',
          desc: isEn ? `Are you sure you want to delete rule 【${displayTitle}】?` : `確定要刪除評分項目【${r.title}】嗎？`,
          confirmText: isEn ? 'Delete' : '確定刪除',
          cancelText: isEn ? 'Cancel' : '取消'
        })) {
          await API.delete(`/api/scores/${AppState.currentCourseId}/rules/${r.id}`);
          loadAdminData();
          loadScoringData();
        }
      };

      container.appendChild(item);
    });
  } catch (err) {
    console.error('Admin load error:', err);
  }
}

function openAddRuleModal() {
  if (!ensureCourseSelected()) return;
  document.getElementById('editing-rule-id').value = '';
  document.getElementById('modal-rule-title').textContent = window.I18n ? window.I18n.t('rule_modal_title_add') : '➕ 新增自訂評分項目';
  document.getElementById('new-rule-title').value = '';
  document.getElementById('new-rule-score').value = '1';
  document.getElementById('new-rule-category').value = 'positive';
  document.getElementById('new-rule-icon').value = '⭐';
  openModal('modal-add-rule');
}

function openEditRuleModal(rule) {
  document.getElementById('editing-rule-id').value = rule.id;
  const displayTitle = window.I18n ? window.I18n.getRuleDisplayTitle(rule.title) : rule.title;
  const prefix = window.I18n ? window.I18n.t('rule_modal_title_edit') : '✏️ 編輯評分項目';
  document.getElementById('modal-rule-title').textContent = `${prefix}【${displayTitle}】`;
  document.getElementById('new-rule-title').value = rule.title;
  document.getElementById('new-rule-score').value = rule.score_value;
  document.getElementById('new-rule-category').value = rule.category;
  document.getElementById('new-rule-icon').value = rule.icon || '⭐';
  openModal('modal-add-rule');
}

async function resetRulesDefault() {
  if (!ensureCourseSelected()) return;
  const isEn = window.I18n && window.I18n.getLanguage() === 'en';
  if (!await showConfirmModal({
    icon: '🔄',
    title: isEn ? 'Restore Default Scoring Rules' : '恢復預設評分項目',
    desc: isEn ? 'Are you sure you want to restore default scoring rules? (Custom rules will be replaced)' : '確定要將本課程的評分項目恢復為預設項目嗎？(現有自訂項目將被取代)',
    confirmText: isEn ? 'Restore' : '確定恢復',
    cancelText: isEn ? 'Cancel' : '取消'
  })) {
    return;
  }
  try {
    await API.post(`/api/scores/${AppState.currentCourseId}/rules/reset_defaults`);
    showToast(isEn ? 'Scoring rules restored to default!' : '已成功恢復預設評分項目！', 'positive');
    loadAdminData();
    loadScoringData();
  } catch (err) {
    showAlertModal(`恢復預設項目失敗：${err.message}`);
  }
}

async function confirmSaveRule() {
  const editingId = document.getElementById('editing-rule-id').value;
  const title = document.getElementById('new-rule-title').value.trim();
  const score = parseInt(document.getElementById('new-rule-score').value);
  const category = document.getElementById('new-rule-category').value;
  const icon = document.getElementById('new-rule-icon').value.trim() || '⭐';

  if (!title) {
    alert(window.I18n && window.I18n.getLanguage() === 'en' ? 'Please enter rule name!' : '請輸入評分項目名稱！');
    return;
  }
  if (isNaN(score)) {
    alert(window.I18n && window.I18n.getLanguage() === 'en' ? 'Please enter a valid score number!' : '請輸入有效的分數數值！');
    return;
  }

  try {
    const payload = {
      title: title,
      score_value: score,
      category: category,
      icon: icon
    };

    if (editingId) {
      await API.put(`/api/scores/${AppState.currentCourseId}/rules/${editingId}`, payload);
    } else {
      await API.post(`/api/scores/${AppState.currentCourseId}/rules`, payload);
    }

    document.getElementById('new-rule-title').value = '';
    document.querySelectorAll('.modal-overlay').forEach(m => m.classList.remove('open'));
    loadAdminData();
    loadScoringData();
  } catch (err) {
    alert(`儲存評分項目失敗：${err.message}`);
  }
}

async function uploadStudentFile() {
  const fileInput = document.getElementById('file-import-students');
  if (!fileInput.files || fileInput.files.length === 0) {
    alert(window.I18n && window.I18n.getLanguage() === 'en' ? 'Please select an Excel or CSV file first!' : '請先選擇要匯入的 Excel 或 CSV 檔案！');
    return;
  }
  const file = fileInput.files[0];
  try {
    const res = await API.uploadFile(`/api/courses/${AppState.currentCourseId}/students/upload`, file);
    alert(window.I18n && window.I18n.getLanguage() === 'en' ? `Imported successfully! Added ${res.imported_count} students` : `匯入成功！已新增 ${res.imported_count} 位學生`);
    resetCustomFileInput(fileInput);
    loadCourses();
  } catch (err) {
    alert(`匯入失敗：${err.message}`);
  }
}

function updateExportExcelButtonState() {
  const startInput = document.getElementById('export-start-date');
  const endInput = document.getElementById('export-end-date');
  const btnExport = document.getElementById('btn-export-excel');
  if (!btnExport) return;

  const startDate = startInput ? startInput.value.trim() : '';
  const endDate = endInput ? endInput.value.trim() : '';

  if (!startDate || !endDate) {
    btnExport.disabled = true;
    btnExport.title = '請先選擇開始日期與結束日期';
    btnExport.style.opacity = '0.6';
    btnExport.style.cursor = 'not-allowed';
  } else if (startDate > endDate) {
    btnExport.disabled = true;
    btnExport.title = '開始日期不能大於結束日期';
    btnExport.style.opacity = '0.6';
    btnExport.style.cursor = 'not-allowed';
  } else {
    btnExport.disabled = false;
    btnExport.removeAttribute('title');
    btnExport.style.opacity = '1';
    btnExport.style.cursor = 'pointer';
  }
}

async function exportExcel() {
  if (!ensureCourseSelected()) return;
  const startDate = document.getElementById('export-start-date')?.value?.trim() || '';
  const endDate = document.getElementById('export-end-date')?.value?.trim() || '';

  if (!startDate || !endDate) {
    showToast('請先選擇匯出報表的開始日期與結束日期！', 'warning');
    updateExportExcelButtonState();
    return;
  }

  if (startDate > endDate) {
    showToast('開始日期不能大於結束日期，請重新選取日期區間！', 'warning');
    updateExportExcelButtonState();
    return;
  }

  const token = localStorage.getItem('auth_token') || '';
  let url = `/api/reports/${AppState.currentCourseId}/export?start_date=${encodeURIComponent(startDate)}&end_date=${encodeURIComponent(endDate)}`;

  const courseObj = (AppState.courses || []).find(c => c.id === AppState.currentCourseId);
  const safeName = (courseObj ? courseObj.name : `班級_${AppState.currentCourseId}`).replace(/[/\\?%*:|"<> ]/g, '_');
  const filename = `${safeName}_全班成績與課堂記錄.xlsx`;

  showToast('正在產生並下載 Excel 資料報表，請稍候...', 'info');

  try {
    const headers = token ? { 'Authorization': `Bearer ${token}` } : {};
    const res = await fetch(url, { headers, credentials: 'same-origin' });
    if (!res.ok) {
      const err = await res.json().catch(() => ({ detail: res.statusText }));
      throw new Error(err.detail || '匯出報表失敗');
    }

    const buffer = await res.arrayBuffer();
    const blob = new Blob([buffer], {
      type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
    });

    const blobUrl = window.URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.style.display = 'none';
    a.href = blobUrl;
    a.download = filename;
    document.body.appendChild(a);
    a.click();

    // 延遲 5 秒清理，確保 Chromium 的下載線程有充裕時間讀取 a.download 檔名與附檔名
    setTimeout(() => {
      if (document.body.contains(a)) {
        document.body.removeChild(a);
      }
      window.URL.revokeObjectURL(blobUrl);
    }, 5000);

    showToast('🎉 Excel 資料報表下載成功！', 'positive');
  } catch (err) {
    console.error('Export Excel failed:', err);
    showToast(`匯出報表失敗：${err.message}`, 'error');
  }
}

// --- Student Score Logs Modal & Logic ---
let currentLogStudentId = null;

async function openStudentScoreLogsModal(studentId) {
  if (!AppState.currentCourseId || !studentId) return;
  currentLogStudentId = studentId;

  const startDateInput = document.getElementById('score-logs-start-date');
  const endDateInput = document.getElementById('score-logs-end-date');
  if (startDateInput) startDateInput.value = '';
  if (endDateInput) endDateInput.value = '';

  const student = AppState.students.find(s => s.id === studentId);
  const titleEl = document.getElementById('score-logs-modal-title');
  const bannerEl = document.getElementById('score-logs-student-banner');
  const isEn = window.I18n && window.I18n.getLanguage() === 'en';
  const t = (k, p) => window.I18n ? window.I18n.t(k, p) : k;

  const sDisplayName = student ? getStudentDisplayName(student) : '';
  const numPrefix = isEn ? `No. ${student?.student_number}` : `${student?.student_number}號`;
  const studentNameStr = student ? `${numPrefix} ${sDisplayName}` : `ID: ${studentId}`;
  if (titleEl) {
    titleEl.textContent = isEn ? `📜 Score History - ${studentNameStr}` : `📜【${studentNameStr}】加減分歷程紀錄`;
  }

  if (bannerEl && student) {
    const groupText = student.group_name ? `${isEn ? 'Group' : '組別'}: ${student.group_name}` : (isEn ? 'Unassigned' : '未分組');
    const codeText = student.student_code ? ` | ${isEn ? 'ID' : '學號'}: ${student.student_code}` : '';
    bannerEl.innerHTML = `
      <div style="display: flex; align-items: center; gap: 12px;">
        <div style="width: 44px; height: 44px; border-radius: 50%; overflow: hidden; flex-shrink: 0; border: 2px solid var(--primary-light);">
          ${getStudentAvatarImgHtml(student)}
        </div>
        <div>
          <div style="font-weight: 800; font-size: 1.05rem;">${numPrefix} ${sDisplayName}</div>
          <div style="font-size: 0.8rem; color: var(--text-muted); font-weight: 600;">${groupText}${codeText}</div>
        </div>
      </div>
      <div id="score-logs-summary-badges" style="display: flex; gap: 8px; font-weight: 800; font-size: 0.88rem; flex-wrap: wrap;">
        <!-- Scores injected by loadStudentScoreLogs -->
      </div>
    `;
  }

  openModal('modal-student-score-logs');
  await loadStudentScoreLogs();
}

async function loadStudentScoreLogs() {
  if (!AppState.currentCourseId || !currentLogStudentId) return;

  const startDate = document.getElementById('score-logs-start-date')?.value;
  const endDate = document.getElementById('score-logs-end-date')?.value;
  const isEn = window.I18n && window.I18n.getLanguage() === 'en';
  const t = (k, p) => window.I18n ? window.I18n.t(k, p) : k;

  let url = `/api/scores/${AppState.currentCourseId}/student/${currentLogStudentId}/logs?`;
  if (startDate) url += `start_date=${startDate}&`;
  if (endDate) url += `end_date=${endDate}&`;

  try {
    const data = await API.get(url);
    const container = document.getElementById('score-logs-list-container');
    const summaryBadges = document.getElementById('score-logs-summary-badges');

    if (summaryBadges) {
      const posText = data.positive_score > 0 ? `+${data.positive_score}` : '0';
      const negText = data.negative_score;
      const totalPrefix = data.total_score > 0 ? '+' : '';
      summaryBadges.innerHTML = `
        <span style="color: #4fae82; background: rgba(79, 174, 130,0.12); padding: 4px 10px; border-radius: 9999px;">${t('badge_positive')}: ${posText}</span>
        <span style="color: #d9807e; background: rgba(217, 128, 126,0.12); padding: 4px 10px; border-radius: 9999px;">${t('badge_negative')}: ${negText}</span>
        <span style="color: #d3a24c; background: rgba(211, 162, 76,0.15); padding: 4px 10px; border-radius: 9999px; font-size: 0.92rem;">⭐ ${isEn ? 'Total' : '總分'}: ${totalPrefix}${data.total_score}</span>
      `;
    }

    if (!container) return;
    container.innerHTML = '';

    const logs = data.logs || [];
    if (logs.length === 0) {
      container.innerHTML = `
        <div style="text-align: center; color: var(--text-muted); padding: 30px; font-weight: 600; font-size: 0.95rem;">
          ${t('score_logs_empty')}
        </div>
      `;
      return;
    }

    logs.forEach(log => {
      const item = document.createElement('div');
      const isPos = log.score > 0;
      const isUndone = log.is_undone === 1;
      item.className = `score-log-item ${isPos ? 'positive' : 'negative'}`;
      if (isUndone) {
        item.style.opacity = '0.55';
        item.style.borderStyle = 'dashed';
      }

      const scoreText = log.score > 0 ? `+${log.score} ${t('pts')}` : `${log.score} ${t('pts')}`;
      const badgeClass = isPos ? 'score-log-badge-positive' : 'score-log-badge-negative';
      const catText = isPos ? t('badge_positive') : t('badge_negative');
      const displayTitle = window.I18n ? window.I18n.getRuleDisplayTitle(log.rule_title) : log.rule_title;

      const groupTagHtml = (log.group_name || log.plan_name)
        ? `<span style="font-size: 0.74rem; background: rgba(123, 152, 224, 0.15); color: #60a5fa; border: 1px solid rgba(123, 152, 224, 0.35); padding: 2px 8px; border-radius: 6px; font-weight: 700; display: inline-flex; align-items: center; gap: 4px;">🏷️ ${log.plan_name ? log.plan_name + ' · ' : ''}${log.group_name || ''}</span>`
        : `<span style="font-size: 0.74rem; background: rgba(255, 255, 255, 0.08); color: var(--text-muted); padding: 2px 7px; border-radius: 6px; font-weight: 600;">👤 ${t('score_log_personal_tag')}</span>`;

      const undoneBadgeHtml = isUndone
        ? `<span style="font-size: 0.72rem; color: #d9807e; background: rgba(217, 128, 126, 0.15); border: 1px solid rgba(217, 128, 126, 0.3); padding: 2px 6px; border-radius: 4px; font-weight: 700;">${t('score_log_revoked_badge')}</span>`
        : '';

      const actionBtnHtml = isUndone
        ? `<button class="btn-restore-score-log btn" style="font-size: 0.75rem; padding: 4px 10px; background: rgba(79, 174, 130, 0.2); color: #4fae82; border: 1px solid rgba(79, 174, 130, 0.4); border-radius: 6px; font-weight: 700; cursor: pointer;" title="${t('score_log_restore_btn')}">${t('score_log_restore_btn')}</button>`
        : `<button class="btn-del-score-log btn-icon" style="width: 28px; height: 28px; font-size: 0.8rem; color: #d9807e;" title="${t('admin_delete')}">🗑️</button>`;

      item.innerHTML = `
        <div style="display: flex; flex-direction: column; gap: 4px; min-width: 0; flex: 1;">
          <div style="display: flex; align-items: center; gap: 8px; flex-wrap: wrap;">
            <span style="font-weight: 800; font-size: 0.98rem; color: var(--text-main); ${isUndone ? 'text-decoration: line-through;' : ''}">${displayTitle}</span>
            <span style="font-size: 0.75rem; color: var(--text-muted);">${catText}</span>
            ${groupTagHtml}
            ${undoneBadgeHtml}
          </div>
          <div style="font-size: 0.78rem; color: var(--text-muted); font-family: monospace;">
            📅 ${log.timestamp || log.date}
          </div>
        </div>
        <div style="display: flex; align-items: center; gap: 10px; flex-shrink: 0;">
          <span class="${badgeClass}" style="${isUndone ? 'text-decoration: line-through; opacity: 0.6;' : ''}">${scoreText}</span>
          ${actionBtnHtml}
        </div>
      `;

      const delBtn = item.querySelector('.btn-del-score-log');
      if (delBtn) {
        delBtn.onclick = async () => {
          const groupContext = (log.group_name || log.plan_name) ? `【${log.plan_name ? log.plan_name + ' · ' : ''}${log.group_name || ''}】` : '';
          const confirmMsg = isEn 
            ? `Are you sure you want to delete score record 【${displayTitle} (${scoreText})】${groupContext}?` 
            : `確定要刪除/撤銷【${log.rule_title} (${scoreText})】${groupContext}這筆紀錄嗎？\n該筆分數將自學生與小組成績中扣除。`;
          if (await showConfirmModal(confirmMsg)) {
            try {
              await API.delete(`/api/scores/${AppState.currentCourseId}/logs/${log.id}`);
              await loadStudentScoreLogs();
              notifyScoreUpdates();
              loadScoringData();
            } catch (err) {
              alert(`刪除評分紀錄失敗：${err.message}`);
            }
          }
        };
      }

      const restoreBtn = item.querySelector('.btn-restore-score-log');
      if (restoreBtn) {
        restoreBtn.onclick = async () => {
          const groupContext = (log.group_name || log.plan_name) ? `【${log.plan_name ? log.plan_name + ' · ' : ''}${log.group_name || ''}】` : '';
          const confirmMsg = isEn
            ? `Restore score record 【${displayTitle} (${scoreText})】${groupContext}?`
            : `確定要回復【${log.rule_title} (${scoreText})】${groupContext}這筆紀錄嗎？\n該筆分數將重新計入學生與小組成績。`;
          if (await showConfirmModal(confirmMsg)) {
            try {
              await API.post(`/api/scores/${AppState.currentCourseId}/logs/${log.id}/restore`);
              showToast(t('score_log_restored_toast'), 'positive');
              await loadStudentScoreLogs();
              notifyScoreUpdates();
              loadScoringData();
            } catch (err) {
              alert(`回復評分紀錄失敗：${err.message}`);
            }
          }
        };
      }

      container.appendChild(item);
    });
  } catch (err) {
    console.error('loadStudentScoreLogs error:', err);
  }
}

// --- Modals & System Info ---
function initModals() {
  document.querySelectorAll('.close-modal').forEach(btn => {
    btn.addEventListener('click', () => {
      const modal = btn.closest('.modal-overlay');
      if (modal && modal.id !== 'auth-overlay') {
        modal.classList.remove('open');
      }
    });
  });
}

function openModal(id) {
  const modal = document.getElementById(id);
  if (modal) modal.classList.add('open');
}

function closeModal(id) {
  if (!id) {
    document.querySelectorAll('.modal-overlay:not(#auth-overlay)').forEach(m => m.classList.remove('open'));
    return;
  }
  const modal = document.getElementById(id);
  if (modal && modal.id !== 'auth-overlay') {
    modal.classList.remove('open');
  }
}
window.openModal = openModal;
window.closeModal = closeModal;

// Beautified stand-in for window.alert() and window.confirm() —
// uses the shared #modal-generic-confirm glassmorphism markup with custom icons and styling.
function showAlertModal(options) {
  const t = (k, p) => window.I18n ? window.I18n.t(k, p) : k;
  let opts = {};
  if (typeof options === 'string' || typeof options === 'number') {
    const str = String(options);
    const lines = str.split('\n');
    opts = {
      title: lines[0] || '',
      desc: lines.slice(1).join('\n')
    };
  } else {
    opts = Object.assign({}, options);
  }

  // Auto detect type & icon if not explicitly provided
  let icon = opts.icon || 'ℹ️';
  let iconBg = opts.iconBg || 'rgba(123, 152, 224, 0.15)';
  let iconBorder = opts.iconBorder || 'rgba(123, 152, 224, 0.4)';
  let btnGradient = opts.okGradient || 'linear-gradient(135deg, #7b98e0, #4a67ba)';

  const textToCheck = (opts.title + ' ' + (opts.desc || '')).toLowerCase();
  if (opts.type === 'error' || textToCheck.includes('失敗') || textToCheck.includes('錯誤') || textToCheck.includes('failed') || textToCheck.includes('error')) {
    icon = opts.icon || '❌';
    iconBg = 'rgba(217, 128, 126, 0.15)';
    iconBorder = 'rgba(217, 128, 126, 0.4)';
    btnGradient = 'linear-gradient(135deg, #d9807e, #dc2626)';
  } else if (opts.type === 'success' || textToCheck.includes('成功') || textToCheck.includes('success')) {
    icon = opts.icon || '✨';
    iconBg = 'rgba(79, 174, 130, 0.15)';
    iconBorder = 'rgba(79, 174, 130, 0.4)';
    btnGradient = 'linear-gradient(135deg, #4fae82, #059669)';
  } else if (opts.type === 'warning' || textToCheck.includes('請先') || textToCheck.includes('請輸入') || textToCheck.includes('注意') || textToCheck.includes('警告') || textToCheck.includes('請選擇')) {
    icon = opts.icon || '⚠️';
    iconBg = 'rgba(211, 162, 76, 0.15)';
    iconBorder = 'rgba(211, 162, 76, 0.4)';
    btnGradient = 'linear-gradient(135deg, #d3a24c, #d97706)';
  }

  const overlay = document.getElementById('modal-generic-confirm');
  if (!overlay) {
    window.alert(opts.title + (opts.desc ? '\n' + opts.desc : ''));
    return Promise.resolve(true);
  }

  const iconWrap = document.getElementById('generic-confirm-icon-wrap');
  const iconEl = document.getElementById('generic-confirm-icon');
  const titleEl = document.getElementById('generic-confirm-title');
  const descEl = document.getElementById('generic-confirm-desc');
  const btnCancel = document.getElementById('btn-generic-confirm-cancel');
  const btnOk = document.getElementById('btn-generic-confirm-ok');

  iconWrap.style.background = iconBg;
  iconWrap.style.border = `2px solid ${iconBorder}`;
  iconEl.textContent = icon;
  titleEl.textContent = opts.title;
  if (opts.desc) {
    descEl.textContent = opts.desc;
    descEl.style.display = 'block';
    descEl.style.whiteSpace = 'pre-line';
  } else {
    descEl.style.display = 'none';
  }

  btnCancel.style.display = 'none';
  btnOk.style.display = 'block';
  btnOk.style.flex = '1';
  btnOk.textContent = opts.okText || t('common_confirm') || '確定';
  btnOk.style.background = btnGradient;

  return new Promise((resolve) => {
    let settled = false;
    function cleanup() {
      if (settled) return;
      settled = true;
      overlay.classList.remove('open');
      btnOk.removeEventListener('click', onOk);
      btnCancel.style.display = '';
      resolve(true);
    }
    function onOk() { cleanup(); }

    btnOk.addEventListener('click', onOk);
    overlay.classList.add('open');
  });
}

function showConfirmModal(options) {
  const t = (k, p) => window.I18n ? window.I18n.t(k, p) : k;
  let opts = {};
  if (typeof options === 'string' || typeof options === 'number') {
    const str = String(options);
    const lines = str.split('\n');
    opts = {
      title: lines[0] || '',
      desc: lines.slice(1).join('\n')
    };
  } else {
    opts = Object.assign({}, options);
  }

  let icon = opts.icon || '❓';
  let iconBg = opts.iconBg || 'rgba(123, 152, 224, 0.15)';
  let iconBorder = opts.iconBorder || 'rgba(123, 152, 224, 0.4)';
  let confirmGradient = opts.confirmGradient || 'linear-gradient(135deg, #7b98e0, #4a67ba)';

  const textToCheck = (opts.title + ' ' + (opts.desc || '')).toLowerCase();
  if (opts.danger || textToCheck.includes('刪除') || textToCheck.includes('撤銷') || textToCheck.includes('delete') || textToCheck.includes('revoke')) {
    icon = opts.icon || '🗑️';
    iconBg = 'rgba(217, 128, 126, 0.15)';
    iconBorder = 'rgba(217, 128, 126, 0.4)';
    confirmGradient = 'linear-gradient(135deg, #d9807e, #dc2626)';
  } else if (textToCheck.includes('回復') || textToCheck.includes('restore')) {
    icon = opts.icon || '↩️';
    iconBg = 'rgba(79, 174, 130, 0.15)';
    iconBorder = 'rgba(79, 174, 130, 0.4)';
    confirmGradient = 'linear-gradient(135deg, #4fae82, #059669)';
  } else if (textToCheck.includes('提醒') || textToCheck.includes('注意') || textToCheck.includes('缺席') || textToCheck.includes('請假')) {
    icon = opts.icon || '⚠️';
    iconBg = 'rgba(211, 162, 76, 0.15)';
    iconBorder = 'rgba(211, 162, 76, 0.4)';
    confirmGradient = 'linear-gradient(135deg, #d3a24c, #d97706)';
  }

  const overlay = document.getElementById('modal-generic-confirm');
  if (!overlay) {
    return Promise.resolve(window.confirm(opts.title + (opts.desc ? '\n' + opts.desc : '')));
  }

  const iconWrap = document.getElementById('generic-confirm-icon-wrap');
  const iconEl = document.getElementById('generic-confirm-icon');
  const titleEl = document.getElementById('generic-confirm-title');
  const descEl = document.getElementById('generic-confirm-desc');
  const btnCancel = document.getElementById('btn-generic-confirm-cancel');
  const btnOk = document.getElementById('btn-generic-confirm-ok');

  iconWrap.style.background = iconBg;
  iconWrap.style.border = `2px solid ${iconBorder}`;
  iconEl.textContent = icon;
  titleEl.textContent = opts.title;
  if (opts.desc) {
    descEl.textContent = opts.desc;
    descEl.style.display = 'block';
    descEl.style.whiteSpace = 'pre-line';
  } else {
    descEl.style.display = 'none';
  }

  btnCancel.style.display = 'block';
  btnCancel.style.flex = '1';
  btnCancel.textContent = opts.cancelText || t('common_cancel') || '取消';
  btnOk.style.display = 'block';
  btnOk.style.flex = '1';
  btnOk.textContent = opts.confirmText || t('common_confirm') || '確定';
  btnOk.style.background = confirmGradient;

  return new Promise((resolve) => {
    let settled = false;
    function cleanup(result) {
      if (settled) return;
      settled = true;
      overlay.classList.remove('open');
      btnCancel.removeEventListener('click', onCancel);
      btnOk.removeEventListener('click', onOk);
      resolve(result);
    }
    function onCancel() { cleanup(false); }
    function onOk() { cleanup(true); }

    btnCancel.addEventListener('click', onCancel);
    btnOk.addEventListener('click', onOk);
    overlay.classList.add('open');
  });
}

/**
 * Beautified stand-in for window.prompt() — uses the shared #modal-generic-prompt
 * glassmorphism markup. Resolves to the entered string (possibly empty) on 確定,
 * or null on 取消/Escape, matching native prompt() semantics so existing
 * `if (result === null) return;` call sites keep working unchanged.
 */
function showPromptModal(options) {
  let opts = {};
  if (typeof options === 'string' || typeof options === 'number') {
    opts = { title: String(options) };
  } else {
    opts = Object.assign({}, options);
  }
  opts.icon = opts.icon || '✏️';
  opts.defaultValue = opts.defaultValue !== undefined ? String(opts.defaultValue) : '';
  opts.confirmText = opts.confirmText || '確定';
  opts.cancelText = opts.cancelText || '取消';

  const overlay = document.getElementById('modal-generic-prompt');
  if (!overlay) {
    return Promise.resolve(window.prompt(opts.title + (opts.desc ? '\n' + opts.desc : ''), opts.defaultValue));
  }

  const iconEl = document.getElementById('generic-prompt-icon');
  const titleEl = document.getElementById('generic-prompt-title');
  const descEl = document.getElementById('generic-prompt-desc');
  const inputEl = document.getElementById('generic-prompt-input');
  const textareaEl = document.getElementById('generic-prompt-textarea');
  const btnCancel = document.getElementById('btn-generic-prompt-cancel');
  const btnOk = document.getElementById('btn-generic-prompt-ok');

  iconEl.textContent = opts.icon;
  titleEl.textContent = opts.title || '';
  if (opts.desc) {
    descEl.textContent = opts.desc;
    descEl.style.display = 'block';
  } else {
    descEl.style.display = 'none';
  }

  const field = opts.multiline ? textareaEl : inputEl;
  const otherField = opts.multiline ? inputEl : textareaEl;
  otherField.style.display = 'none';
  field.style.display = 'block';
  field.value = opts.defaultValue;
  field.placeholder = opts.placeholder || '';

  btnCancel.textContent = opts.cancelText;
  btnOk.textContent = opts.confirmText;

  return new Promise((resolve) => {
    let settled = false;
    function cleanup(result) {
      if (settled) return;
      settled = true;
      overlay.classList.remove('open');
      btnCancel.removeEventListener('click', onCancel);
      btnOk.removeEventListener('click', onOk);
      field.removeEventListener('keydown', onKeydown);
      resolve(result);
    }
    function onCancel() { cleanup(null); }
    function onOk() {
      if (opts.required && !field.value.trim()) {
        field.focus();
        return;
      }
      cleanup(field.value);
    }
    function onKeydown(e) {
      if (!opts.multiline && e.key === 'Enter') {
        e.preventDefault();
        onOk();
      } else if (e.key === 'Escape') {
        onCancel();
      }
    }

    btnCancel.addEventListener('click', onCancel);
    btnOk.addEventListener('click', onOk);
    field.addEventListener('keydown', onKeydown);
    overlay.classList.add('open');
    setTimeout(() => {
      field.focus();
      field.select();
    }, 50);
  });
}

window.showAlertModal = showAlertModal;
window.showConfirmModal = showConfirmModal;
window.showPromptModal = showPromptModal;
window.alert = showAlertModal;

function resetCustomFileInput(inputEl) {
  if (!inputEl) return;
  inputEl.value = '';
  const wrap = inputEl.closest('.custom-file-wrap');
  if (wrap) {
    const nameSpan = wrap.querySelector('.custom-file-name');
    if (nameSpan) {
      const isEn = window.I18n && window.I18n.getLanguage() === 'en';
      nameSpan.textContent = isEn ? 'No file chosen' : '未選擇任何檔案';
      nameSpan.setAttribute('data-i18n', 'file_none_chosen');
    }
  }
}

function initCustomFileInputs() {
  document.querySelectorAll('.custom-file-wrap input[type="file"]').forEach(input => {
    const wrap = input.closest('.custom-file-wrap');
    if (!wrap) return;
    const nameSpan = wrap.querySelector('.custom-file-name');
    input.addEventListener('change', () => {
      if (input.files && input.files.length > 0) {
        nameSpan.textContent = input.files[0].name;
        nameSpan.removeAttribute('data-i18n');
      } else {
        const isEn = window.I18n && window.I18n.getLanguage() === 'en';
        nameSpan.textContent = isEn ? 'No file chosen' : '未選擇任何檔案';
        nameSpan.setAttribute('data-i18n', 'file_none_chosen');
      }
    });
  });
}

async function showQRModal() {
  try {
    const courseParam = AppState.currentCourseId ? `?course_id=${AppState.currentCourseId}&mode=mobile` : `?mode=mobile`;
    const info = await API.get(`/api/system/info${courseParam}`);
    document.getElementById('qr-image').src = info.qr_code;
    document.getElementById('qr-url-text').textContent = info.url;
    openModal('modal-qr');
  } catch (err) {
    alert(`獲取 QR Code 失敗：${err.message}`);
  }
}
window.showQRModal = showQRModal;

// 主登入畫面「📱 學生連線 QR Code」按鈕：這個 API 不需要登入即可呼叫（見 system.ts 的
// GET /api/system/info 沒有掛 requireAuth），所以在 auth-overlay 階段也能直接使用。
async function showStudentQrModal() {
  try {
    const info = await API.get('/api/system/info?mode=student');
    document.getElementById('qr-student-image').src = info.qr_code;
    document.getElementById('qr-student-url-text').textContent = info.url;
    openModal('modal-qr-student-login');
  } catch (err) {
    alert(`獲取 QR Code 失敗：${err.message}`);
  }
}
window.showStudentQrModal = showStudentQrModal;

// 點擊「學生連線 QR Code」圖片：以彈出視窗放大顯示，方便全班快速掃描登入
function openQrFullscreenTab(imgSrc, urlText) {
  if (!imgSrc) return;
  const w = screen.availWidth;
  const h = screen.availHeight;
  const win = window.open(
    '',
    'qr-fullscreen-popup',
    `width=${w},height=${h},left=0,top=0,menubar=no,toolbar=no,location=no,status=no,scrollbars=no,resizable=yes`
  );
  if (!win) {
    alert('請允許瀏覽器開啟彈出視窗，才能放大顯示 QR Code');
    return;
  }
  win.document.title = '學生連線 QR Code';
  const style = win.document.createElement('style');
  style.textContent = `
    html, body { margin: 0; height: 100%; background: #0f172a; }
    .qr-fullscreen-wrap { position: relative; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 24px; height: 100%; box-sizing: border-box; padding: 24px; }
    .qr-fullscreen-wrap img { width: min(80vw, 80vh); height: min(80vw, 80vh); background: #fff; border-radius: 24px; padding: 24px; box-sizing: border-box; box-shadow: 0 20px 60px rgba(0,0,0,0.5); }
    .qr-fullscreen-wrap p { color: #fff; font-family: "Segoe UI", "Microsoft JhengHei", sans-serif; font-size: 1.4rem; font-weight: bold; word-break: break-all; text-align: center; margin: 0; }
    .qr-fullscreen-wrap .btn-row { display: flex; gap: 12px; }
    .qr-fullscreen-wrap button { font-size: 1rem; padding: 10px 20px; border-radius: 10px; border: none; background: #6366f1; color: #fff; cursor: pointer; }
    .qr-fullscreen-wrap .btn-close { position: absolute; top: 16px; right: 16px; width: 40px; height: 40px; padding: 0; border-radius: 50%; background: rgba(255,255,255,0.12); font-size: 1.2rem; line-height: 1; }
  `;
  win.document.head.appendChild(style);

  const wrap = win.document.createElement('div');
  wrap.className = 'qr-fullscreen-wrap';

  const closeBtn = win.document.createElement('button');
  closeBtn.className = 'btn-close';
  closeBtn.textContent = '✕';
  closeBtn.title = '關閉';
  closeBtn.addEventListener('click', () => win.close());

  const img = win.document.createElement('img');
  img.src = imgSrc;
  img.alt = 'QR Code';

  const p = win.document.createElement('p');
  p.textContent = urlText || '';

  const btnRow = win.document.createElement('div');
  btnRow.className = 'btn-row';

  const fsBtn = win.document.createElement('button');
  fsBtn.textContent = '🖥️ 進入全螢幕';
  fsBtn.addEventListener('click', () => {
    const el = win.document.documentElement;
    if (el.requestFullscreen) el.requestFullscreen().catch(() => {});
  });

  const closeBtn2 = win.document.createElement('button');
  closeBtn2.textContent = '✕ 關閉視窗';
  closeBtn2.addEventListener('click', () => win.close());

  btnRow.appendChild(fsBtn);
  btnRow.appendChild(closeBtn2);

  wrap.appendChild(closeBtn);
  wrap.appendChild(img);
  wrap.appendChild(p);
  wrap.appendChild(btnRow);
  win.document.body.appendChild(wrap);
}

// ==========================================================================
// 📝 紙本測驗成績管理模組 (Paper Quiz Management)
// ==========================================================================

AppState.paperQuizzes = [];
AppState.currentPaperQuizId = null;
AppState.currentPaperQuizData = null;

// 動態更新科目篩選下拉選項
function updatePaperQuizSubjectFilter() {
  const subjectSelect = document.getElementById('paper-quiz-filter-subject');
  if (!subjectSelect) return;
  const currentVal = subjectSelect.value;
  const subjects = Array.from(new Set(AppState.paperQuizzes.map(q => q.subject).filter(Boolean))).sort();
  
  const allSubjectsText = (window.I18n && window.I18n.t('paper_quiz_filter_all_subjects')) || '全部科目';
  subjectSelect.innerHTML = `<option value="">${allSubjectsText}</option>`;
  subjects.forEach(subj => {
    const opt = document.createElement('option');
    opt.value = subj;
    opt.textContent = `📚 ${subj}`;
    subjectSelect.appendChild(opt);
  });

  if (subjects.includes(currentVal)) {
    subjectSelect.value = currentVal;
  } else {
    subjectSelect.value = '';
  }
}

// 根據科目與關鍵字篩選並渲染測驗下拉選單
async function filterAndRenderPaperQuizSelect(preferredQuizId = null) {
  const select = document.getElementById('paper-quiz-select');
  const countBadge = document.getElementById('paper-quiz-count-badge');
  const subjectSelect = document.getElementById('paper-quiz-filter-subject');
  const searchInput = document.getElementById('paper-quiz-search-keyword');
  const clearBtn = document.getElementById('btn-clear-quiz-search');

  if (!select) return;

  const selectedSubject = subjectSelect ? subjectSelect.value.trim() : '';
  const keyword = searchInput ? searchInput.value.trim().toLowerCase() : '';

  if (clearBtn) {
    clearBtn.style.display = keyword ? 'block' : 'none';
  }

  const filtered = AppState.paperQuizzes.filter((q) => {
    if (selectedSubject && (q.subject || '') !== selectedSubject) return false;
    if (keyword) {
      const matchTitle = (q.title || '').toLowerCase().includes(keyword);
      const matchSubject = (q.subject || '').toLowerCase().includes(keyword);
      const matchUnit = (q.sub_unit_title || '').toLowerCase().includes(keyword);
      const matchDate = (q.quiz_date || '').toLowerCase().includes(keyword);
      if (!matchTitle && !matchSubject && !matchUnit && !matchDate) return false;
    }
    return true;
  });

  const total = AppState.paperQuizzes.length;
  if (countBadge) {
    const template = (window.I18n && window.I18n.t('paper_quiz_count_badge_text')) || '顯示 {filtered} / {total} 個測驗';
    countBadge.textContent = template.replace('{filtered}', filtered.length).replace('{total}', total);
  }

  select.innerHTML = '';
  if (AppState.paperQuizzes.length === 0) {
    select.innerHTML = '<option value="">尚無紙本測驗，請點擊「➕ 建立新測驗」</option>';
    AppState.currentPaperQuizId = null;
    AppState.currentPaperQuizData = null;
    renderPaperQuizMatrix(null);
    return;
  }

  if (filtered.length === 0) {
    const noMatchText = (window.I18n && window.I18n.t('paper_quiz_no_match')) || '查無符合科目或關鍵字的測驗';
    select.innerHTML = `<option value="">${noMatchText}</option>`;
    AppState.currentPaperQuizId = null;
    AppState.currentPaperQuizData = null;
    renderPaperQuizMatrix(null);
    return;
  }

  filtered.forEach((q) => {
    const opt = document.createElement('option');
    opt.value = q.id;
    const subjStr = q.subject ? `[${q.subject}] ` : '';
    const subTitle = q.sub_unit_title ? ` (${q.sub_unit_title})` : '';
    const pendingStr = q.stats.pending_verify_count > 0 ? ` ⚠️(${q.stats.pending_verify_count}待審)` : '';
    opt.textContent = `${subjStr}${q.quiz_date} ${q.title}${subTitle}${pendingStr}`;
    select.appendChild(opt);
  });

  let chosenId = null;
  if (preferredQuizId && filtered.some(q => q.id === preferredQuizId)) {
    chosenId = preferredQuizId;
  } else if (AppState.currentPaperQuizId && filtered.some(q => q.id === AppState.currentPaperQuizId)) {
    chosenId = AppState.currentPaperQuizId;
  } else {
    chosenId = filtered[0].id;
  }

  select.value = chosenId;
  AppState.currentPaperQuizId = chosenId;
  await loadPaperQuizMatrix(chosenId);
}

async function loadPaperQuizData(force = false, preferredQuizId = null) {
  if (!AppState.currentCourseId) {
    const tbody = document.getElementById('paper-quiz-matrix-tbody');
    if (tbody) tbody.innerHTML = `<tr><td colspan="8" style="text-align: center; padding: 30px; color: var(--text-muted);">尚未選擇班級/課程</td></tr>`;
    return;
  }

  try {
    const data = await API.get(`/api/paper-quizzes/${AppState.currentCourseId}`);
    AppState.paperQuizzes = data.quizzes || [];

    updatePaperQuizSubjectFilter();
    await filterAndRenderPaperQuizSelect(preferredQuizId || AppState.currentPaperQuizId);
  } catch (err) {
    console.error('Failed to load paper quizzes:', err);
    showToast(`載入紙本測驗失敗：${err.message}`, 'error');
  }
}

async function loadPaperQuizMatrix(quizId) {
  if (!quizId) {
    renderPaperQuizMatrix(null);
    return;
  }
  try {
    const matrixData = await API.get(`/api/paper-quizzes/${quizId}/matrix`);
    AppState.currentPaperQuizData = matrixData;
    renderPaperQuizMatrix(matrixData);
  } catch (err) {
    console.error('Failed to load quiz matrix:', err);
    showToast(`載入測驗成績失敗：${err.message}`, 'error');
  }
}

function renderPaperQuizStatsCards(stats, quiz) {
  const statsContainer = document.getElementById('paper-quiz-stats-container');
  if (!statsContainer) return;
  if (!stats || !quiz) {
    statsContainer.innerHTML = '';
    return;
  }

  const avgScoreStr = stats.average_score !== null && stats.average_score !== undefined ? `${stats.average_score}` : '-';
  const passRateStr = stats.scored_count > 0 ? `${stats.pass_rate}%` : '-';
  const highestStr = stats.max_score_actual !== null && stats.max_score_actual !== undefined ? `${stats.max_score_actual}` : '-';
  const lowestStr = stats.min_score_actual !== null && stats.min_score_actual !== undefined ? `${stats.min_score_actual}` : '-';
  const recordedStr = `${(stats.scored_count || 0) + (stats.absent_count || 0)} / ${stats.total_students || 0}`;
  const pendingClass = (stats.pending_verify_count || 0) > 0 ? 'warning' : '';
  const makeupInfo = (stats.makeup_count || 0) > 0 ? ` (${stats.makeup_count}人補考中)` : '';

  statsContainer.innerHTML = `
    <div class="paper-quiz-stat-card">
      <div class="paper-quiz-stat-val ${stats.average_score !== null && stats.average_score >= quiz.passing_score ? 'positive' : ''}">${avgScoreStr}</div>
      <div class="paper-quiz-stat-label">全班平均分</div>
    </div>
    <div class="paper-quiz-stat-card">
      <div class="paper-quiz-stat-val ${stats.pass_rate >= 80 ? 'positive' : ''}">${passRateStr}</div>
      <div class="paper-quiz-stat-label">及格率 (${stats.pass_count || 0}/${stats.scored_count || 0})</div>
    </div>
    <div class="paper-quiz-stat-card">
      <div class="paper-quiz-stat-val">${highestStr} / ${lowestStr}</div>
      <div class="paper-quiz-stat-label">最高分 / 最低分</div>
    </div>
    <div class="paper-quiz-stat-card">
      <div class="paper-quiz-stat-val">${recordedStr}</div>
      <div class="paper-quiz-stat-label">已登記 (${stats.absent_count || 0} 缺考${makeupInfo})</div>
    </div>
    <div class="paper-quiz-stat-card">
      <div class="paper-quiz-stat-val ${pendingClass}">${stats.pending_verify_count || 0}</div>
      <div class="paper-quiz-stat-label">待審核考卷照片</div>
    </div>
  `;
}

function recalculatePaperQuizStatsRealtime() {
  if (!AppState.currentPaperQuizData || !AppState.currentPaperQuizData.quiz) return;
  const { quiz, students } = AppState.currentPaperQuizData;
  if (!Array.isArray(students)) return;

  const tbody = document.getElementById('paper-quiz-matrix-tbody');
  if (tbody) {
    const rows = tbody.querySelectorAll('tr[data-student-id]');
    rows.forEach((tr) => {
      const studentId = Number(tr.dataset.studentId);
      const studentObj = students.find((s) => s.student_id === studentId);
      if (!studentObj) return;

      const scoreInput = tr.querySelector('.score-quick-input');
      const absentCheckbox = tr.querySelector('.quiz-absent-checkbox');

      const isAbsent = absentCheckbox ? absentCheckbox.checked : false;
      const rawVal = scoreInput ? scoreInput.value.trim() : '';
      const allowMakeup = tr.dataset.allowMakeup === '1';

      studentObj.is_absent = isAbsent;
      if (isAbsent && !allowMakeup) {
        studentObj.score = null;
      } else {
        if (rawVal !== '' && !isNaN(parseFloat(rawVal))) {
          studentObj.score = Math.min(parseFloat(rawVal), quiz.max_score);
          if (allowMakeup && isAbsent) {
            studentObj.is_makeup = true;
          }
        } else {
          studentObj.score = null;
        }
      }
    });
  }

  const scoredList = [];
  let absentCount = 0;
  let makeupCount = 0;
  let pendingVerifyCount = 0;

  students.forEach((s) => {
    if (s.photo_url && !s.is_verified) {
      pendingVerifyCount++;
    }
    if (s.allow_makeup) {
      makeupCount++;
    }
    if (s.is_absent && (!s.allow_makeup || s.score === null)) {
      absentCount++;
    } else if (s.score !== null && s.score !== undefined && !isNaN(s.score)) {
      scoredList.push(Number(s.score));
    }
  });

  scoredList.sort((a, b) => a - b);
  const scoredCount = scoredList.length;
  const passCount = scoredList.filter((v) => v >= quiz.passing_score).length;
  const failCount = scoredList.filter((v) => v < quiz.passing_score).length;
  const passRate = scoredCount > 0 ? Math.round((passCount / scoredCount) * 1000) / 10 : 0;

  let avgScore = null;
  let highest = null;
  let lowest = null;

  if (scoredCount > 0) {
    const sum = scoredList.reduce((acc, v) => acc + v, 0);
    avgScore = Math.round((sum / scoredCount) * 10) / 10;
    highest = scoredList[scoredCount - 1];
    lowest = scoredList[0];
  }

  const updatedStats = {
    total_students: students.length,
    recorded_count: scoredCount + absentCount,
    scored_count: scoredCount,
    absent_count: absentCount,
    makeup_count: makeupCount,
    pass_count: passCount,
    fail_count: failCount,
    pass_rate: passRate,
    average_score: avgScore,
    max_score_actual: highest,
    min_score_actual: lowest,
    pending_verify_count: pendingVerifyCount,
  };

  AppState.currentPaperQuizData.stats = updatedStats;
  renderPaperQuizStatsCards(updatedStats, quiz);

  // 同步更新已載入測驗列表的快取統計
  const cachedQuiz = AppState.paperQuizzes.find((q) => q.id === quiz.id);
  if (cachedQuiz && cachedQuiz.stats) {
    cachedQuiz.stats.recorded_count = updatedStats.recorded_count;
    cachedQuiz.stats.scored_count = updatedStats.scored_count;
    cachedQuiz.stats.absent_count = updatedStats.absent_count;
    cachedQuiz.stats.makeup_count = updatedStats.makeup_count;
    cachedQuiz.stats.pass_count = updatedStats.pass_count;
    cachedQuiz.stats.fail_count = updatedStats.fail_count;
    cachedQuiz.stats.average_score = updatedStats.average_score;
    cachedQuiz.stats.pending_verify_count = updatedStats.pending_verify_count;
  }
}

function renderPaperQuizMatrix(matrixData) {
  const statsContainer = document.getElementById('paper-quiz-stats-container');
  const tbody = document.getElementById('paper-quiz-matrix-tbody');
  const thMaxScore = document.getElementById('th-quiz-max-score');
  const filterUnrecorded = document.getElementById('paper-quiz-filter-unrecorded')?.checked;
  const filterPending = document.getElementById('paper-quiz-filter-pending-photos')?.checked;
  const filterAbsent = document.getElementById('paper-quiz-filter-absent')?.checked;
  const filterMakeup = document.getElementById('paper-quiz-filter-makeup')?.checked;

  if (!matrixData || !matrixData.quiz) {
    if (statsContainer) statsContainer.innerHTML = '';
    if (tbody) {
      tbody.innerHTML = `<tr><td colspan="8" style="text-align: center; padding: 40px; color: var(--text-muted); font-size: 0.95rem;">
        📝 目前尚無測驗或未選擇測驗。<br>請點擊右上角「➕ 建立新測驗」以開始登記成績！
      </td></tr>`;
    }
    return;
  }

  const { quiz, stats, students } = matrixData;
  if (thMaxScore) thMaxScore.textContent = quiz.max_score;

  // 1. 渲染統計儀表卡片
  renderPaperQuizStatsCards(stats, quiz);
  setPaperQuizAutoSaveStatus('ready', '自動儲存已啟用');

  // 2. 渲染全班學生登錄矩陣
  if (tbody) {
    tbody.innerHTML = '';
    const isEn = window.I18n && window.I18n.getLanguage() === 'en';

    students.forEach((s, rowIndex) => {
      const hasRecord = s.score !== null || s.is_absent;
      const isPendingPhoto = !!(s.photo_url && !s.is_verified);

      if (filterUnrecorded && hasRecord) return;
      if (filterPending && !isPendingPhoto) return;
      if (filterAbsent && !s.is_absent) return;
      if (filterMakeup && !s.allow_makeup) return;

      const tr = document.createElement('tr');
      tr.dataset.studentId = s.student_id;
      tr.dataset.rowIndex = rowIndex;
      tr.dataset.leaveType = s.leave_type || '';
      tr.dataset.allowMakeup = s.allow_makeup ? '1' : '0';
      tr.dataset.isMakeup = s.is_makeup ? '1' : '0';

      if (s.is_absent) tr.classList.add('is-absent');

      const numText = isEn ? `No. ${s.student_number}` : `${s.student_number}號`;
      const groupBadge = s.group_id 
        ? `<span style="font-weight: 600; color: var(--text-main); font-size: 0.85rem;">${s.group_name}</span>${s.is_leader ? ' <span class="leader-badge-pill" style="font-size:0.7rem; padding:1px 5px;">👑組長</span>' : ''}` 
        : '<span style="color: var(--text-muted); font-size: 0.82rem;">未分組</span>';

      let photoColHtml = '<span style="color: var(--text-muted); font-size: 0.82rem;">無佐證</span>';
      if (s.photo_url) {
        const isVerified = s.is_verified;
        photoColHtml = `
          <a href="javascript:void(0)" class="quiz-photo-badge ${isVerified ? 'verified' : 'pending'}" data-photo-url="${s.photo_url}" data-student-id="${s.student_id}" data-student-name="${getStudentDisplayName(s)}" data-student-num="${s.student_number}" data-score="${s.score ?? ''}" data-verified="${isVerified ? '1' : '0'}" title="點擊查驗放大考卷照片">
            <span>📷</span>
            <span>${isVerified ? '已核准' : '待查驗'}</span>
          </a>
        `;
      }

      let sourceTagHtml = '-';
      if (s.is_makeup) {
        sourceTagHtml = `<span class="quiz-source-tag" style="background: rgba(16, 185, 129, 0.15); color: #10b981; border: 1px solid rgba(16, 185, 129, 0.3);">補考成績</span>`;
      } else if (s.submitted_by === 'student') {
        sourceTagHtml = `<span class="quiz-source-tag student">學生自登</span>`;
      } else if (s.submitted_by === 'leader') {
        sourceTagHtml = `<span class="quiz-source-tag leader">組長代登</span>`;
      } else if (s.submitted_by === 'teacher' || (s.score !== null || s.is_absent)) {
        sourceTagHtml = `<span class="quiz-source-tag teacher">教師登記</span>`;
      }

      const scoreVal = s.score !== null ? s.score : '';
      const isInputDisabled = s.is_absent && !s.allow_makeup;

      // 假別標示
      let leaveBadgeHtml = '';
      if (s.leave_label) {
        leaveBadgeHtml = `<span class="badge" style="font-size: 0.72rem; padding: 2px 6px; background: rgba(239, 68, 68, 0.12); color: #ef4444; border-radius: 4px; border: 1px solid rgba(239, 68, 68, 0.25); white-space: nowrap;">${s.leave_label}</span>`;
      }

      // 補考切換按鈕
      let makeupBtnHtml = '';
      if (s.is_absent) {
        if (s.allow_makeup) {
          makeupBtnHtml = `
            <button type="button" class="btn-makeup-toggle" data-student-id="${s.student_id}" data-allow="0" title="點擊關閉該生補考" style="font-size: 0.72rem; font-weight: 700; padding: 2px 6px; border-radius: 4px; border: 1px solid rgba(16, 185, 129, 0.35); background: rgba(16, 185, 129, 0.15); color: #10b981; cursor: pointer; white-space: nowrap;">
              ✅ 補考中 (點擊關閉)
            </button>
          `;
        } else {
          makeupBtnHtml = `
            <button type="button" class="btn-makeup-toggle" data-student-id="${s.student_id}" data-allow="1" title="點擊開啟該生補考" style="font-size: 0.72rem; font-weight: 600; padding: 2px 6px; border-radius: 4px; border: 1px solid var(--card-border); background: rgba(255, 255, 255, 0.05); color: var(--text-muted); cursor: pointer; white-space: nowrap;">
              🔄 開放補考
            </button>
          `;
        }
      }

      tr.innerHTML = `
        <td style="font-weight: 700;">${numText}</td>
        <td style="font-weight: 600;">${getStudentDisplayName(s)}</td>
        <td>${groupBadge}</td>
        <td>
          <input type="number" step="any" min="0" max="${quiz.max_score}" class="score-quick-input ${scoreVal !== '' ? (scoreVal < quiz.passing_score ? 'failed' : 'passed') : ''}" value="${scoreVal}" placeholder="${s.allow_makeup ? '補考分' : '-'}" ${isInputDisabled ? 'disabled' : ''}>
          ${s.allow_makeup ? '<div style="font-size: 0.7rem; color: #10b981; font-weight: 700; margin-top: 2px;">(開放補考中)</div>' : ''}
        </td>
        <td style="text-align: center; vertical-align: middle;">
          <div style="display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 4px;">
            <div style="display: inline-flex; align-items: center; gap: 6px;">
              <input type="checkbox" class="quiz-absent-checkbox" ${s.is_absent ? 'checked' : ''}>
              ${leaveBadgeHtml}
            </div>
            ${makeupBtnHtml}
          </div>
        </td>
        <td style="text-align: center;">${photoColHtml}</td>
        <td>${sourceTagHtml}</td>
        <td>
          <input type="text" class="input-control quiz-note-input" value="${s.note || ''}" placeholder="備註..." style="width: 100%; font-size: 0.85rem; padding: 4px 8px;">
        </td>
      `;

      const scoreInput = tr.querySelector('.score-quick-input');
      const absentCheckbox = tr.querySelector('.quiz-absent-checkbox');
      const noteInput = tr.querySelector('.quiz-note-input');
      const photoBadge = tr.querySelector('.quiz-photo-badge');
      const makeupBtn = tr.querySelector('.btn-makeup-toggle');

      if (makeupBtn) {
        makeupBtn.addEventListener('click', async (e) => {
          e.preventDefault();
          triggerPaperQuizAutoSave(true);
          const stuId = Number(makeupBtn.dataset.studentId);
          const allowVal = makeupBtn.dataset.allow === '1';
          try {
            const res = await API.post(`/api/paper-quizzes/${quiz.id}/makeup/${stuId}`, { allow_makeup: allowVal });
            showToast(res.message || '補考設定已更新！', 'positive');
            await loadPaperQuizMatrix(quiz.id);
          } catch (err) {
            showToast(`操作失敗：${err.message}`, 'error');
          }
        });
      }

      scoreInput.addEventListener('input', () => {
        const val = parseFloat(scoreInput.value);
        scoreInput.classList.remove('failed', 'passed');
        if (!isNaN(val)) {
          if (val < quiz.passing_score) scoreInput.classList.add('failed');
          else scoreInput.classList.add('passed');
        }
        recalculatePaperQuizStatsRealtime();
        triggerPaperQuizAutoSave(false);
      });

      scoreInput.addEventListener('change', () => {
        recalculatePaperQuizStatsRealtime();
        triggerPaperQuizAutoSave(true);
      });

      scoreInput.addEventListener('blur', () => {
        triggerPaperQuizAutoSave(true);
      });

      absentCheckbox.addEventListener('change', () => {
        if (absentCheckbox.checked) {
          tr.classList.add('is-absent');
          if (tr.dataset.allowMakeup !== '1') {
            scoreInput.disabled = true;
            scoreInput.value = '';
            scoreInput.classList.remove('failed', 'passed');
          }
        } else {
          tr.classList.remove('is-absent');
          scoreInput.disabled = false;
          scoreInput.focus();
        }
        recalculatePaperQuizStatsRealtime();
        triggerPaperQuizAutoSave(true);
      });

      noteInput.addEventListener('input', () => {
        triggerPaperQuizAutoSave(false);
      });

      noteInput.addEventListener('change', () => {
        triggerPaperQuizAutoSave(true);
      });

      noteInput.addEventListener('blur', () => {
        triggerPaperQuizAutoSave(true);
      });

      scoreInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' || e.key === 'ArrowDown') {
          e.preventDefault();
          triggerPaperQuizAutoSave(true);
          const nextTr = e.shiftKey ? tr.previousElementSibling : tr.nextElementSibling;
          if (nextTr) {
            const targetInput = nextTr.querySelector('.score-quick-input');
            if (targetInput && !targetInput.disabled) targetInput.focus(), targetInput.select();
          }
        } else if (e.key === 'ArrowUp') {
          e.preventDefault();
          triggerPaperQuizAutoSave(true);
          const prevTr = tr.previousElementSibling;
          if (prevTr) {
            const targetInput = prevTr.querySelector('.score-quick-input');
            if (targetInput && !targetInput.disabled) targetInput.focus(), targetInput.select();
          }
        } else if (e.key === 'a' || e.key === 'A') {
          e.preventDefault();
          absentCheckbox.checked = true;
          absentCheckbox.dispatchEvent(new Event('change'));
          const nextTr = tr.nextElementSibling;
          if (nextTr) {
            const targetInput = nextTr.querySelector('.score-quick-input');
            if (targetInput) targetInput.focus(), targetInput.select();
          }
        } else if ((e.ctrlKey || e.metaKey) && (e.key === 's' || e.key === 'S')) {
          e.preventDefault();
          triggerPaperQuizAutoSave(true);
        }
      });

      if (photoBadge) {
        photoBadge.addEventListener('click', (e) => {
          e.preventDefault();
          openQuizPhotoVerifyModal({
            quizId: quiz.id,
            studentId: Number(photoBadge.dataset.studentId),
            studentName: photoBadge.dataset.studentName,
            studentNum: photoBadge.dataset.studentNum,
            score: photoBadge.dataset.score,
            photoUrl: photoBadge.dataset.photoUrl,
            isVerified: photoBadge.dataset.verified === '1',
          });
        });
      }

      tbody.appendChild(tr);
    });
  }
}

// --------------------------------------------------------------------------
// ⚡ 紙本測驗成績「自動儲存」核心引擎 (Debounced Auto-Save Engine)
// --------------------------------------------------------------------------
let gPaperQuizAutoSaveTimer = null;
let gPaperQuizIsSaving = false;
let gPaperQuizHasPendingSave = false;

function setPaperQuizAutoSaveStatus(status, text = '') {
  const indicator = document.getElementById('paper-quiz-autosave-indicator');
  const iconEl = document.getElementById('paper-quiz-autosave-icon');
  const textEl = document.getElementById('paper-quiz-autosave-text');
  if (!indicator || !textEl) return;

  if (status === 'saving') {
    indicator.style.color = '#3b82f6';
    indicator.style.background = 'rgba(59, 130, 246, 0.12)';
    indicator.style.borderColor = 'rgba(59, 130, 246, 0.3)';
    if (iconEl) iconEl.textContent = '⏳';
    textEl.textContent = text || '自動儲存中...';
  } else if (status === 'saved') {
    indicator.style.color = '#10b981';
    indicator.style.background = 'rgba(16, 185, 129, 0.12)';
    indicator.style.borderColor = 'rgba(16, 185, 129, 0.3)';
    if (iconEl) iconEl.textContent = '✓';
    textEl.textContent = text || '已自動儲存';
  } else if (status === 'error') {
    indicator.style.color = '#ef4444';
    indicator.style.background = 'rgba(239, 68, 68, 0.12)';
    indicator.style.borderColor = 'rgba(239, 68, 68, 0.3)';
    if (iconEl) iconEl.textContent = '⚠️';
    textEl.textContent = text || '儲存失敗';
  } else {
    indicator.style.color = '#10b981';
    indicator.style.background = 'rgba(16, 185, 129, 0.12)';
    indicator.style.borderColor = 'rgba(16, 185, 129, 0.3)';
    if (iconEl) iconEl.textContent = '⚡';
    textEl.textContent = text || '自動儲存已啟用';
  }
}

function triggerPaperQuizAutoSave(immediate = false) {
  if (!AppState.currentPaperQuizId) return;

  if (immediate) {
    if (gPaperQuizAutoSaveTimer) {
      clearTimeout(gPaperQuizAutoSaveTimer);
      gPaperQuizAutoSaveTimer = null;
    }
    doAutoSavePaperQuizRecords();
  } else {
    setPaperQuizAutoSaveStatus('saving', '變更中...');
    if (gPaperQuizAutoSaveTimer) clearTimeout(gPaperQuizAutoSaveTimer);
    gPaperQuizAutoSaveTimer = setTimeout(() => {
      gPaperQuizAutoSaveTimer = null;
      doAutoSavePaperQuizRecords();
    }, 450);
  }
}

async function doAutoSavePaperQuizRecords() {
  const quizId = AppState.currentPaperQuizId;
  if (!quizId) return;

  if (gPaperQuizIsSaving) {
    gPaperQuizHasPendingSave = true;
    return;
  }

  const tbody = document.getElementById('paper-quiz-matrix-tbody');
  if (!tbody) return;

  const { quiz, students } = AppState.currentPaperQuizData || {};
  if (!quiz || !Array.isArray(students)) return;

  const rows = tbody.querySelectorAll('tr[data-student-id]');
  const records = [];

  rows.forEach((tr) => {
    const studentId = Number(tr.dataset.studentId);
    const studentObj = students.find((s) => s.student_id === studentId);

    const scoreInput = tr.querySelector('.score-quick-input');
    const absentCheckbox = tr.querySelector('.quiz-absent-checkbox');
    const noteInput = tr.querySelector('.quiz-note-input');

    const allowMakeup = tr.dataset.allowMakeup === '1';
    const rawScore = scoreInput ? scoreInput.value.trim() : '';
    const hasScore = rawScore !== '' && !isNaN(Number(rawScore));
    const isAbsent = (absentCheckbox ? absentCheckbox.checked : false) && (!allowMakeup || !hasScore);
    const score = isAbsent ? null : (hasScore ? Math.min(Number(rawScore), quiz.max_score) : null);
    const note = noteInput ? noteInput.value.trim() : '';
    const leaveType = tr.dataset.leaveType || '';
    const isMakeup = tr.dataset.isMakeup === '1' || (allowMakeup && score !== null);

    if (studentObj) {
      studentObj.score = score;
      studentObj.is_absent = isAbsent;
      studentObj.note = note;
      studentObj.is_makeup = isMakeup;
    }

    records.push({
      student_id: studentId,
      score,
      is_absent: isAbsent,
      allow_makeup: allowMakeup,
      leave_type: leaveType,
      is_makeup: isMakeup,
      note,
    });
  });

  // 保留可能被快速過濾器隱藏的其他學生既有數據
  students.forEach((s) => {
    if (!records.some((r) => r.student_id === s.student_id)) {
      records.push({
        student_id: s.student_id,
        score: s.score,
        is_absent: s.is_absent,
        allow_makeup: s.allow_makeup,
        leave_type: s.leave_type || '',
        is_makeup: s.is_makeup,
        note: s.note || '',
      });
    }
  });

  gPaperQuizIsSaving = true;
  setPaperQuizAutoSaveStatus('saving', '自動儲存中...');

  try {
    await API.post(`/api/paper-quizzes/${quizId}/batch-save`, { records });
    const nowStr = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
    setPaperQuizAutoSaveStatus('saved', `已自動儲存 (${nowStr})`);
  } catch (err) {
    console.error('Paper quiz auto-save failed:', err);
    setPaperQuizAutoSaveStatus('error', '儲存失敗，請檢查連線');
  } finally {
    gPaperQuizIsSaving = false;
    if (gPaperQuizHasPendingSave) {
      gPaperQuizHasPendingSave = false;
      doAutoSavePaperQuizRecords();
    }
  }
}

function openPaperQuizModal(isEdit = false) {
  const modal = document.getElementById('modal-paper-quiz-editor');
  if (!modal) return;

  const titleEl = document.getElementById('modal-paper-quiz-title');
  const idInput = document.getElementById('quiz-edit-id');
  const titleInput = document.getElementById('quiz-edit-title');
  const subjectInput = document.getElementById('quiz-edit-subject');
  const dateInput = document.getElementById('quiz-edit-date');
  const maxInput = document.getElementById('quiz-edit-max-score');
  const passInput = document.getElementById('quiz-edit-pass-score');
  const subUnitSelect = document.getElementById('quiz-edit-subunit-select');
  const allowSelfCheck = document.getElementById('quiz-edit-allow-self');
  const allowLeaderCheck = document.getElementById('quiz-edit-allow-leader');

  if (subUnitSelect) {
    subUnitSelect.innerHTML = '<option value="">無關聯單元</option>';
    if (Array.isArray(AppState.units)) {
      AppState.units.forEach(u => {
        if (Array.isArray(u.sub_units)) {
          u.sub_units.forEach(su => {
            const opt = document.createElement('option');
            opt.value = su.id;
            opt.textContent = `${u.title} - ${su.title}`;
            subUnitSelect.appendChild(opt);
          });
        }
      });
    }
  }

  if (isEdit && AppState.currentPaperQuizData && AppState.currentPaperQuizData.quiz) {
    const q = AppState.currentPaperQuizData.quiz;
    if (titleEl) titleEl.textContent = (window.I18n && window.I18n.t('paper_quiz_modal_edit_title')) || '⚙️ 編輯紙本測驗設定';
    if (idInput) idInput.value = q.id;
    if (titleInput) titleInput.value = q.title;
    if (subjectInput) subjectInput.value = q.subject || '';
    if (dateInput) dateInput.value = q.quiz_date;
    if (maxInput) maxInput.value = q.max_score;
    if (passInput) passInput.value = q.passing_score;
    if (subUnitSelect) subUnitSelect.value = q.sub_unit_id || '';
    if (allowSelfCheck) allowSelfCheck.checked = !!q.allow_self_entry;
    if (allowLeaderCheck) allowLeaderCheck.checked = !!q.allow_leader_entry;
  } else {
    if (titleEl) titleEl.textContent = (window.I18n && window.I18n.t('paper_quiz_modal_create_title')) || '📝 建立新紙本測驗';
    if (idInput) idInput.value = '';
    if (titleInput) titleInput.value = '';
    const currentFilteredSubject = document.getElementById('paper-quiz-filter-subject')?.value || '';
    if (subjectInput) subjectInput.value = currentFilteredSubject;
    if (dateInput) dateInput.value = getTaiwanTodayDateStr();
    if (maxInput) maxInput.value = '100';
    if (passInput) passInput.value = '60';
    if (subUnitSelect) subUnitSelect.value = '';
    if (allowSelfCheck) allowSelfCheck.checked = true;
    if (allowLeaderCheck) allowLeaderCheck.checked = true;
  }

  openModal('modal-paper-quiz-editor');
}

async function submitPaperQuizForm(e) {
  e.preventDefault();
  const idInput = document.getElementById('quiz-edit-id');
  const titleInput = document.getElementById('quiz-edit-title');
  const subjectInput = document.getElementById('quiz-edit-subject');
  const dateInput = document.getElementById('quiz-edit-date');
  const maxInput = document.getElementById('quiz-edit-max-score');
  const passInput = document.getElementById('quiz-edit-pass-score');
  const subUnitSelect = document.getElementById('quiz-edit-subunit-select');
  const allowSelfCheck = document.getElementById('quiz-edit-allow-self');
  const allowLeaderCheck = document.getElementById('quiz-edit-allow-leader');

  const title = titleInput.value.trim();
  const subject = subjectInput ? subjectInput.value.trim() : '';
  const quiz_date = dateInput.value;
  if (!title) {
    alert('請輸入測驗名稱');
    return;
  }
  if (!quiz_date) {
    alert('請選擇測驗日期');
    return;
  }

  const payload = {
    title,
    subject,
    quiz_date,
    max_score: Number(maxInput.value) || 100,
    passing_score: Number(passInput.value) || 60,
    sub_unit_id: subUnitSelect.value ? Number(subUnitSelect.value) : null,
    allow_self_entry: allowSelfCheck.checked ? 1 : 0,
    allow_leader_entry: allowLeaderCheck.checked ? 1 : 0,
  };

  const editId = idInput.value;
  try {
    if (editId) {
      await API.put(`/api/paper-quizzes/${editId}`, payload);
      showToast('紙本測驗更新成功！', 'positive');
      closeModal('modal-paper-quiz-editor');
      await loadPaperQuizData(false, Number(editId));
    } else {
      const res = await API.post(`/api/paper-quizzes/${AppState.currentCourseId}`, payload);
      showToast('紙本測驗建立成功！', 'positive');
      closeModal('modal-paper-quiz-editor');
      AppState.currentPaperQuizId = res.quiz.id;
      await loadPaperQuizData(false, res.quiz.id);
    }
  } catch (err) {
    alert(`儲存測驗失敗：${err.message}`);
  }
}

async function confirmDeleteCurrentPaperQuiz() {
  if (!AppState.currentPaperQuizId) return;
  const q = AppState.paperQuizzes.find(item => item.id === AppState.currentPaperQuizId);
  const quizName = q ? q.title : '本測驗';

  if (!await showConfirmModal({
    icon: '🗑️',
    title: '刪除紙本測驗',
    desc: `確定要刪除「${quizName}」嗎？此測驗內所有學生的登記成績與照片紀錄將一併清除！`,
    confirmText: '確定刪除',
    cancelText: '取消'
  })) return;

  try {
    await API.delete(`/api/paper-quizzes/${AppState.currentPaperQuizId}`);
    showToast('紙本測驗已刪除！', 'positive');
    AppState.currentPaperQuizId = null;
    await loadPaperQuizData();
  } catch (err) {
    alert(`刪除失敗：${err.message}`);
  }
}

let gCurrentVerifyCtx = null;
function openQuizPhotoVerifyModal(ctx) {
  gCurrentVerifyCtx = ctx;
  const modal = document.getElementById('modal-quiz-photo-verify');
  const titleEl = document.getElementById('quiz-photo-verify-title');
  const imgEl = document.getElementById('quiz-photo-verify-img');
  if (!modal || !imgEl) return;

  if (titleEl) {
    const scoreText = ctx.score ? ` (得分: ${ctx.score})` : '';
    const statusText = ctx.isVerified ? ' [已核准]' : ' [待審核]';
    titleEl.textContent = `📷 考卷佐證查驗 - ${ctx.studentNum}號 ${ctx.studentName}${scoreText}${statusText}`;
  }
  imgEl.src = ctx.photoUrl;

  openModal('modal-quiz-photo-verify');
}

async function setQuizPhotoVerifyStatus(isVerified) {
  if (!gCurrentVerifyCtx) return;
  const { quizId, studentId } = gCurrentVerifyCtx;
  try {
    const res = await API.post(`/api/paper-quizzes/${quizId}/verify/${studentId}`, { is_verified: isVerified ? 1 : 0 });
    showToast(res.message || (isVerified ? '已核准考卷照片！' : '已取消核准狀態'), 'positive');
    closeModal('modal-quiz-photo-verify');
    await loadPaperQuizMatrix(quizId);
  } catch (err) {
    alert(`審核操作失敗：${err.message}`);
  }
}

// ==========================================================================
// 📊 紙本測驗學生成績總覽 (在線即時預覽與篩選)
// ==========================================================================

let gPaperQuizOverviewData = null;

async function openPaperQuizOverviewModal() {
  if (!ensureCourseSelected()) return;

  // 1. 同步現有科目分類至總覽科目下拉選單
  const subjectSelect = document.getElementById('paper-quiz-overview-subject');
  if (subjectSelect) {
    const currentFilterVal = document.getElementById('paper-quiz-filter-subject')?.value || '';
    const subjects = Array.from(new Set(AppState.paperQuizzes.map(q => q.subject).filter(Boolean))).sort();
    
    const allSubjectsText = (window.I18n && window.I18n.t('paper_quiz_filter_all_subjects')) || '全部科目';
    subjectSelect.innerHTML = `<option value="">${allSubjectsText}</option>`;
    subjects.forEach(subj => {
      const opt = document.createElement('option');
      opt.value = subj;
      opt.textContent = `📚 ${subj}`;
      subjectSelect.appendChild(opt);
    });
    if (subjects.includes(currentFilterVal)) {
      subjectSelect.value = currentFilterVal;
    } else {
      subjectSelect.value = '';
    }
  }

  // 2. 開啟彈窗並立即載入總覽資料
  openModal('modal-paper-quiz-overview');
  await loadPaperQuizOverviewData();
}

async function loadPaperQuizOverviewData() {
  if (!AppState.currentCourseId) return;

  const subject = document.getElementById('paper-quiz-overview-subject')?.value || '';
  const startDate = document.getElementById('paper-quiz-overview-start-date')?.value || '';
  const endDate = document.getElementById('paper-quiz-overview-end-date')?.value || '';

  const thead = document.getElementById('paper-quiz-overview-thead');
  const tbody = document.getElementById('paper-quiz-overview-tbody');
  const badge = document.getElementById('paper-quiz-overview-count-badge');
  const summaryBar = document.getElementById('paper-quiz-overview-summary-bar');

  if (tbody) {
    tbody.innerHTML = `<tr><td colspan="10" style="text-align:center; padding: 40px; color: var(--text-muted);">⏳ 正在載入學生成績總覽，請稍候...</td></tr>`;
  }

  try {
    let url = `/api/paper-quizzes/${AppState.currentCourseId}/overview?`;
    if (subject) url += `subject=${encodeURIComponent(subject)}&`;
    if (startDate) url += `start_date=${encodeURIComponent(startDate)}&`;
    if (endDate) url += `end_date=${encodeURIComponent(endDate)}&`;

    const data = await API.get(url);
    gPaperQuizOverviewData = data;

    renderPaperQuizOverviewTable(data);
  } catch (err) {
    console.error('Failed to load quiz overview:', err);
    if (tbody) {
      tbody.innerHTML = `<tr><td colspan="10" style="text-align:center; padding: 30px; color: var(--accent-negative);">❌ 載入失敗：${err.message}</td></tr>`;
    }
    showToast(`載入成績總覽失敗：${err.message}`, 'error');
  }
}

function renderPaperQuizOverviewTable(data) {
  const thead = document.getElementById('paper-quiz-overview-thead');
  const tbody = document.getElementById('paper-quiz-overview-tbody');
  const badge = document.getElementById('paper-quiz-overview-count-badge');
  const summaryBar = document.getElementById('paper-quiz-overview-summary-bar');

  if (!data || !thead || !tbody) return;

  const quizzes = data.quizzes || [];
  const students = data.students || [];

  if (badge) {
    badge.textContent = `共 ${quizzes.length} 次測驗 / ${students.length} 位學生`;
  }

  // 1. 計算頂部摘要統計
  let allScoresTotal = 0;
  let allScoresCount = 0;
  let allPassCount = 0;
  let allAbsentCount = 0;

  quizzes.forEach(q => {
    allAbsentCount += q.stats.absent_count || 0;
    allPassCount += q.stats.pass_count || 0;
    allScoresCount += q.stats.scored_count || 0;
    if (q.stats.average_score !== null && q.stats.scored_count > 0) {
      allScoresTotal += (q.stats.average_score * q.stats.scored_count);
    }
  });

  const overallAvg = allScoresCount > 0 ? (Math.round((allScoresTotal / allScoresCount) * 10) / 10).toFixed(1) : '-';
  const overallPassRate = allScoresCount > 0 ? `${(Math.round((allPassCount / allScoresCount) * 1000) / 10).toFixed(1)}%` : '-';

  if (summaryBar) {
    summaryBar.innerHTML = `
      <div class="paper-quiz-stat-card" style="padding: 10px 14px; background: rgba(59, 130, 246, 0.08); border: 1px solid rgba(59, 130, 246, 0.2); border-radius: 8px; text-align: center;">
        <div style="font-size: 1.3rem; font-weight: 800; color: var(--primary);">${quizzes.length}</div>
        <div style="font-size: 0.78rem; color: var(--text-muted); font-weight: 600;">納入測驗數</div>
      </div>
      <div class="paper-quiz-stat-card" style="padding: 10px 14px; background: rgba(16, 185, 129, 0.08); border: 1px solid rgba(16, 185, 129, 0.2); border-radius: 8px; text-align: center;">
        <div style="font-size: 1.3rem; font-weight: 800; color: #10b981;">${overallAvg}</div>
        <div style="font-size: 0.78rem; color: var(--text-muted); font-weight: 600;">全體平均分</div>
      </div>
      <div class="paper-quiz-stat-card" style="padding: 10px 14px; background: rgba(99, 102, 241, 0.08); border: 1px solid rgba(99, 102, 241, 0.2); border-radius: 8px; text-align: center;">
        <div style="font-size: 1.3rem; font-weight: 800; color: #6366f1;">${overallPassRate}</div>
        <div style="font-size: 0.78rem; color: var(--text-muted); font-weight: 600;">全體及格率</div>
      </div>
      <div class="paper-quiz-stat-card" style="padding: 10px 14px; background: rgba(239, 68, 68, 0.08); border: 1px solid rgba(239, 68, 68, 0.2); border-radius: 8px; text-align: center;">
        <div style="font-size: 1.3rem; font-weight: 800; color: #ef4444;">${allAbsentCount}</div>
        <div style="font-size: 0.78rem; color: var(--text-muted); font-weight: 600;">累計缺考人次</div>
      </div>
    `;
  }

  // 若無測驗
  if (quizzes.length === 0) {
    thead.innerHTML = `
      <tr>
        <th class="sticky-col-no" style="padding: 12px 14px;">座號</th>
        <th class="sticky-col-name" style="padding: 12px 14px;">姓名</th>
        <th style="padding: 12px 14px;">測驗成績</th>
      </tr>
    `;
    tbody.innerHTML = `<tr><td colspan="3" style="text-align:center; padding: 40px; color: var(--text-muted);">該篩選條件下查無任何紙本測驗紀錄，請調整科目或日期區間。</td></tr>`;
    tfoot.innerHTML = '';
    return;
  }

  // 2. 表頭：凍結左側座號、姓名，中間橫向展開各次測驗（含日期、科目、名稱、滿分/及格線），右側橫向個人統計（平均分、及格率）
  let headHtml = `
    <tr>
      <th class="sticky-col-no" style="padding: 10px 6px;">座號</th>
      <th class="sticky-col-name" style="padding: 10px 12px;">姓名</th>
  `;

  quizzes.forEach(q => {
    const subjBadge = q.subject ? `<span style="display:inline-block; font-size: 0.72rem; font-weight: 700; padding: 1px 6px; border-radius: 4px; background: rgba(91,124,214,0.18); color: var(--primary); margin-bottom: 2px;">${q.subject}</span><br>` : '';
    headHtml += `
      <th style="padding: 8px 10px; min-width: 115px; max-width: 160px; font-size: 0.82rem; vertical-align: top;">
        <div style="font-size: 0.74rem; color: var(--text-muted); font-family: monospace;">${q.quiz_date}</div>
        ${subjBadge}
        <div style="font-weight: 700; color: var(--text-main); white-space: nowrap; overflow: hidden; text-overflow: ellipsis;" title="${q.title}">${q.title}</div>
        <div style="font-size: 0.72rem; color: var(--text-muted); font-weight: 500;">滿分:${q.max_score} / 及格:${q.passing_score}</div>
      </th>
    `;
  });

  headHtml += `
      <th style="padding: 10px 10px; width: 85px; min-width: 85px; background: #e0f2fe; color: #0284c7; font-size: 0.85rem; font-weight: 800;">個人平均</th>
      <th style="padding: 10px 10px; width: 80px; min-width: 80px; background: #ede9fe; color: #7c3aed; font-size: 0.85rem; font-weight: 800;">及格率</th>
    </tr>
  `;
  thead.innerHTML = headHtml;

  // 3. 表身：每位學生的純成績列
  let bodyHtml = '';
  students.forEach((s) => {
    bodyHtml += `<tr>`;

    // 凍結座號
    bodyHtml += `
      <td class="sticky-col-no" style="font-weight: 700; color: var(--text-muted);">
        ${s.student_number}
      </td>
    `;

    // 凍結姓名
    bodyHtml += `
      <td class="sticky-col-name" style="color: var(--text-main);">
        ${s.name}
      </td>
    `;

    // 各次測驗得分
    quizzes.forEach(q => {
      const scoreObj = s.scores[q.id];
      if (!scoreObj) {
        bodyHtml += `<td style="color: var(--text-subtle);">-</td>`;
        return;
      }

      if (scoreObj.is_absent) {
        bodyHtml += `<td style="font-weight: 800; color: #dc2626; background: rgba(254, 226, 226, 0.5);" title="缺考">缺考</td>`;
      } else if (scoreObj.score !== null) {
        const sc = scoreObj.score;
        const isPass = sc >= q.passing_score;
        const color = isPass ? 'var(--text-main)' : '#dc2626';
        const weight = isPass ? '600' : '800';
        const makeupMark = scoreObj.is_makeup ? `<span style="font-size:0.7rem; color: #d97706; margin-left: 2px;">(補)</span>` : '';
        bodyHtml += `
          <td style="font-weight: ${weight}; color: ${color};">
            ${sc}${makeupMark}
          </td>
        `;
      } else {
        bodyHtml += `<td style="color: var(--text-subtle);">-</td>`;
      }
    });

    // 個人平均與及格率
    const avgStr = s.summary.average_score !== null ? s.summary.average_score.toFixed(1) : '-';
    const passRateStr = s.summary.pass_rate !== null ? `${s.summary.pass_rate.toFixed(0)}%` : '-';
    const avgColor = s.summary.average_score !== null && s.summary.average_score >= 60 ? 'var(--accent-positive, #059669)' : (s.summary.average_score !== null ? '#dc2626' : 'var(--text-subtle)');

    bodyHtml += `
      <td style="font-weight: 800; color: ${avgColor}; background: rgba(224, 242, 254, 0.35);">
        ${avgStr}
      </td>
      <td style="font-weight: 700; color: #7c3aed; background: rgba(237, 233, 254, 0.35);">
        ${passRateStr}
      </td>
    `;

    bodyHtml += `</tr>`;
  });
  tbody.innerHTML = bodyHtml;
}

// --- Global Event Listeners ---
function initEventListeners() {
  // Course change dropdown
  document.getElementById('course-select').addEventListener('change', async (e) => {
    if (window.TeachingToolkit?.bulletin && typeof window.TeachingToolkit.bulletin.flushActivePost === 'function') {
      window.TeachingToolkit.bulletin.flushActivePost();
    }
    if (AppState.quickScoringMode && AppState.pendingQuickScores) {
      const hasPending = Object.values(AppState.pendingQuickScores).some(s => Number(s) !== 0);
      if (hasPending) {
        await commitPendingQuickScores();
      }
    }
    AppState.currentCourseId = parseInt(e.target.value);
    AppState.selectedStudentIds.clear();
    syncAppRealtimeConnection();
    refreshActiveTab(getActiveTabName());
    if (window.PointCardsManager && typeof window.PointCardsManager.reload === 'function') {
      window.PointCardsManager.reload();
    }
  });

  // Header & Mode buttons
  document.getElementById('btn-add-course').addEventListener('click', () => openModal('modal-add-course'));
  document.getElementById('btn-delete-course')?.addEventListener('click', startDeleteCourseFlow);
  document.getElementById('btn-pane-delete-course')?.addEventListener('click', startDeleteCourseFlow);
  document.getElementById('btn-qr-modal')?.addEventListener('click', showQRModal);
  document.getElementById('btn-admin-show-mobile-scoring-qr')?.addEventListener('click', showQRModal);
  document.getElementById('btn-security-show-mobile-scoring-qr')?.addEventListener('click', showQRModal);
  document.querySelectorAll('.btn-show-mobile-qr-action').forEach((btn) => {
    btn.addEventListener('click', showQRModal);
  });

  const btnToggleLang = document.getElementById('btn-toggle-lang');
  if (btnToggleLang) {
    btnToggleLang.addEventListener('click', () => {
      if (window.I18n) window.I18n.toggleLanguage();
    });
  }

  const btnAuthToggleLang = document.getElementById('btn-auth-toggle-lang');
  if (btnAuthToggleLang) {
    btnAuthToggleLang.addEventListener('click', () => {
      if (window.I18n) window.I18n.toggleLanguage();
    });
  }

  const btnToggleNameMode = document.getElementById('btn-toggle-name-mode');
  if (btnToggleNameMode) {
    btnToggleNameMode.addEventListener('click', () => {
      if (window.I18n) window.I18n.toggleNameDisplayMode();
    });
  }
  
  const btnToggleQuick = document.getElementById('btn-toggle-quick-scoring');
  if (btnToggleQuick) {
    btnToggleQuick.addEventListener('click', toggleQuickScoringMode);
    updateQuickScoringToggleUI();
  }

  const btnImportModal = document.getElementById('btn-open-import-modal');
  if (btnImportModal) {
    btnImportModal.addEventListener('click', () => { if (ensureCourseSelected()) openModal('modal-import-students'); });
  }

  // Import Modal Tabs
  const tabFileBtn = document.getElementById('tab-import-file-btn');
  const tabTextBtn = document.getElementById('tab-import-text-btn');
  const modeFile = document.getElementById('import-mode-file');
  const modeText = document.getElementById('import-mode-text');

  if (tabFileBtn && tabTextBtn) {
    tabFileBtn.addEventListener('click', () => {
      tabFileBtn.classList.add('active');
      tabTextBtn.classList.remove('active');
      modeFile.style.display = 'flex';
      modeText.style.display = 'none';
    });

    tabTextBtn.addEventListener('click', () => {
      tabTextBtn.classList.add('active');
      tabFileBtn.classList.remove('active');
      modeText.style.display = 'flex';
      modeFile.style.display = 'none';
    });
  }

  // Modal Upload File
  document.getElementById('btn-modal-upload-file').addEventListener('click', async () => {
    const fileInput = document.getElementById('modal-file-input');
    if (!fileInput.files || fileInput.files.length === 0) {
      alert('請先選擇要匯入的 Excel 或 CSV 檔案！');
      return;
    }
    try {
      const res = await API.uploadFile(`/api/courses/${AppState.currentCourseId}/students/upload`, fileInput.files[0]);
      alert(`匯入成功！已新增 ${res.imported_count} 位學生`);
      resetCustomFileInput(fileInput);
      document.querySelectorAll('.modal-overlay').forEach(m => m.classList.remove('open'));
      await loadCourses();
    } catch (err) {
      alert(`匯入檔案失敗：${err.message}`);
    }
  });

  // Modal Submit Text Paste
  document.getElementById('btn-modal-submit-text').addEventListener('click', async () => {
    const textVal = document.getElementById('modal-text-input').value.trim();
    if (!textVal) {
      alert('請輸入或貼上學生名單！');
      return;
    }
    try {
      const res = await API.post(`/api/courses/${AppState.currentCourseId}/students/text_import`, { text_content: textVal });
      alert(`匯入成功！已新增 ${res.imported_count} 位學生`);
      document.getElementById('modal-text-input').value = '';
      document.querySelectorAll('.modal-overlay').forEach(m => m.classList.remove('open'));
      await loadCourses();
    } catch (err) {
      alert(`匯入學生失敗：${err.message}`);
    }
  });

  // Modal Confirm: Add Course
  document.getElementById('btn-confirm-add-course').addEventListener('click', async () => {
    const name = document.getElementById('new-course-name').value.trim();
    const type = document.getElementById('new-course-type').value;
    if (!name) {
      alert('請輸入課程名稱！');
      return;
    }
    try {
      const res = await API.post('/api/courses', { name: name, teacher_type: type });
      AppState.currentCourseId = res.id;
      document.getElementById('new-course-name').value = '';
      document.querySelectorAll('.modal-overlay').forEach(m => m.classList.remove('open'));
      await loadCourses();
      openModal('modal-import-students');
    } catch (err) {
      alert(`新增課程失敗：${err.message}`);
    }
  });

  // --- Delete Course Double Confirmation Flow ---
  function startDeleteCourseFlow() {
    const currentCourse = (AppState.courses || []).find(c => c.id === AppState.currentCourseId);
    if (!currentCourse) {
      alert(window.I18n ? window.I18n.t('delete_course_no_selection') : '目前沒有選中的班級可刪除！');
      return;
    }
    const targetNameEl = document.getElementById('delete-course-target-name');
    if (targetNameEl) {
      const icon = currentCourse.teacher_type === 'homeroom' ? '🏫' : '🎨';
      const count = currentCourse.student_count || 0;
      targetNameEl.textContent = `${icon} ${currentCourse.name} (${count} 人 / students)`;
    }
    openModal('modal-delete-course-step1');
  }

  document.getElementById('btn-delete-course-next')?.addEventListener('click', () => {
    closeModal('modal-delete-course-step1');
    const pwdInput = document.getElementById('delete-course-password-input');
    const errEl = document.getElementById('delete-course-error-msg');
    if (pwdInput) pwdInput.value = '';
    if (errEl) {
      errEl.style.display = 'none';
      errEl.textContent = '';
    }
    openModal('modal-delete-course-step2');
    setTimeout(() => {
      if (pwdInput) pwdInput.focus();
    }, 120);
  });

  async function executeDeleteCourse() {
    const pwdInput = document.getElementById('delete-course-password-input');
    const errEl = document.getElementById('delete-course-error-msg');
    const password = pwdInput ? pwdInput.value.trim() : '';

    if (!password) {
      if (errEl) {
        errEl.textContent = window.I18n ? window.I18n.t('delete_course_pwd_required') : '請輸入系統管理密碼！';
        errEl.style.display = 'block';
      }
      if (pwdInput) pwdInput.focus();
      return;
    }

    const btn = document.getElementById('btn-confirm-delete-course');
    const originalText = btn ? btn.innerHTML : '';
    if (btn) {
      btn.disabled = true;
      btn.textContent = window.I18n ? window.I18n.t('delete_course_deleting') : '正在刪除...';
    }

    try {
      const res = await API.delete(`/api/courses/${AppState.currentCourseId}`, { password });
      closeModal('modal-delete-course-step2');
      const succMsg = res?.message || (window.I18n ? window.I18n.t('delete_course_success') : '班級已成功刪除！');
      alert(succMsg);
      AppState.currentCourseId = null;
      await loadCourses();
    } catch (err) {
      if (errEl) {
        errEl.textContent = err.message || '刪除失敗';
        errEl.style.display = 'block';
      }
      if (pwdInput) pwdInput.focus();
    } finally {
      if (btn) {
        btn.disabled = false;
        btn.innerHTML = originalText;
      }
    }
  }

  document.getElementById('btn-confirm-delete-course')?.addEventListener('click', executeDeleteCourse);
  document.getElementById('delete-course-password-input')?.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      executeDeleteCourse();
    }
  });

  // Scoring tab selection helpers
  document.getElementById('btn-select-all').addEventListener('click', () => {
    selectStudentsSkippingAbsent(AppState.students.map(s => s.id));
  });

  document.getElementById('btn-clear-select').addEventListener('click', () => {
    AppState.selectedStudentIds.clear();
    renderScoringStudentGrid();
  });

  // Attendance tab buttons
  document.getElementById('btn-save-attendance').addEventListener('click', saveAttendance);
  const btnAllPresent = document.getElementById('btn-att-all-present');
  if (btnAllPresent) {
    btnAllPresent.addEventListener('click', setAllAttendancePresent);
  }
  document.getElementById('attendance-date').addEventListener('change', loadAttendanceData);

  // Seating tab buttons
  document.getElementById('btn-save-seat-config').addEventListener('click', saveSeatConfig);
  document.getElementById('btn-arrange-number-seats').addEventListener('click', () => autoArrangeSeats('by_number'));
  document.getElementById('btn-arrange-gender-seats').addEventListener('click', () => autoArrangeSeats('gender_balanced'));
  document.getElementById('btn-arrange-random-seats').addEventListener('click', () => autoArrangeSeats('random'));

  // Grouping tab buttons & Grouping Plan Toolbar
  const groupPlanSelect = document.getElementById('group-plan-select');
  if (groupPlanSelect) {
    groupPlanSelect.addEventListener('change', (e) => {
      const planId = parseInt(e.target.value);
      if (planId) {
        AppState.currentGroupPlanId = planId;
        loadGroupingData(planId);
      }
    });
  }

  const btnSetActivePlan = document.getElementById('btn-set-active-group-plan');
  if (btnSetActivePlan) {
    btnSetActivePlan.addEventListener('click', setActiveGroupPlan);
  }

  const btnCreatePlan = document.getElementById('btn-create-group-plan');
  if (btnCreatePlan) {
    btnCreatePlan.addEventListener('click', () => openCreateGroupPlanModal(false));
  }

  const btnCopyPlan = document.getElementById('btn-copy-group-plan');
  if (btnCopyPlan) {
    btnCopyPlan.addEventListener('click', () => openCreateGroupPlanModal(true));
  }

  const btnRenamePlan = document.getElementById('btn-rename-group-plan');
  if (btnRenamePlan) {
    btnRenamePlan.addEventListener('click', openRenameGroupPlanModal);
  }

  const btnDeletePlan = document.getElementById('btn-delete-group-plan');
  if (btnDeletePlan) {
    btnDeletePlan.addEventListener('click', confirmDeleteGroupPlan);
  }

  const btnSubmitCreatePlan = document.getElementById('btn-submit-create-group-plan');
  if (btnSubmitCreatePlan) {
    btnSubmitCreatePlan.addEventListener('click', submitCreateGroupPlan);
  }

  const btnSubmitRenamePlan = document.getElementById('btn-submit-rename-group-plan');
  if (btnSubmitRenamePlan) {
    btnSubmitRenamePlan.addEventListener('click', submitRenameGroupPlan);
  }

  document.getElementById('btn-run-grouping').addEventListener('click', runAutoGrouping);
  const btnAddCustomGroup = document.getElementById('btn-add-custom-group');
  if (btnAddCustomGroup) {
    btnAddCustomGroup.addEventListener('click', openAddGroupModal);
  }

  const btnDelGroup = document.getElementById('btn-delete-group');
  if (btnDelGroup) {
    btnDelGroup.addEventListener('click', confirmDeleteGroup);
  }

  const btnTriggerUploadGroupIcon = document.getElementById('btn-trigger-upload-group-icon');
  const groupIconFileInput = document.getElementById('edit-group-icon-file');
  if (btnTriggerUploadGroupIcon && groupIconFileInput) {
    btnTriggerUploadGroupIcon.addEventListener('click', () => groupIconFileInput.click());
    groupIconFileInput.addEventListener('change', () => {
      if (groupIconFileInput.files && groupIconFileInput.files[0]) {
        const file = groupIconFileInput.files[0];
        currentPendingGroupIconFile = file;
        currentSelectedGroupIcon = null;
        const reader = new FileReader();
        reader.onload = (e) => {
          document.getElementById('edit-group-icon-preview').src = e.target.result;
          updatePresetIconSelection(null);
        };
        reader.readAsDataURL(file);
      }
    });
  }

  const btnResetGroupIcon = document.getElementById('btn-reset-group-icon');
  if (btnResetGroupIcon) {
    btnResetGroupIcon.addEventListener('click', () => {
      currentPendingGroupIconFile = null;
      currentSelectedGroupIcon = null;
      if (groupIconFileInput) groupIconFileInput.value = '';
      const fallbackSrc = currentEditingGroup ? getGroupAvatarSrc(currentEditingGroup) : '/static/pic/animals/penguin.png';
      document.getElementById('edit-group-icon-preview').src = fallbackSrc;
      updatePresetIconSelection(null);
    });
  }

  document.querySelectorAll('.group-preset-icon-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      currentPendingGroupIconFile = null;
      if (groupIconFileInput) groupIconFileInput.value = '';
      currentSelectedGroupIcon = btn.dataset.icon;
      document.getElementById('edit-group-icon-preview').src = currentSelectedGroupIcon;
      updatePresetIconSelection(currentSelectedGroupIcon);
    });
  });

  // Notes tab buttons
  document.getElementById('btn-save-note').addEventListener('click', saveNote);
  initNoteQuickForm();
  document.getElementById('btn-confirm-save-quick-note').addEventListener('click', confirmSaveQuickNote);

  // Dashboard period buttons & Big Screen Projection listeners
  document.querySelectorAll('.dashboard-period-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.dashboard-period-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      AppState.dashboardPeriod = btn.dataset.period;

      // Sync Big Screen Period Buttons
      document.querySelectorAll('.proj-period-btn').forEach(b => {
        if (b.dataset.period === AppState.dashboardPeriod) b.classList.add('active');
        else b.classList.remove('active');
      });

      const rangeInputs = document.getElementById('dashboard-range-inputs');
      const projRangeInputs = document.getElementById('proj-range-inputs');
      if (AppState.dashboardPeriod === 'range') {
        if (rangeInputs) rangeInputs.style.display = 'flex';
        if (projRangeInputs) projRangeInputs.style.display = 'flex';
        lastDashboardFingerprint = null;
        loadDashboardData(true);
      } else {
        if (rangeInputs) rangeInputs.style.display = 'none';
        if (projRangeInputs) projRangeInputs.style.display = 'none';
        lastDashboardFingerprint = null;
        loadDashboardData(true);
        refreshProjectionData();
      }
    });
  });

  // Big screen period buttons listeners (大螢幕投影內切換時段)
  document.querySelectorAll('.proj-period-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.proj-period-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      AppState.dashboardPeriod = btn.dataset.period;

      // Sync Dashboard Period Buttons
      document.querySelectorAll('.dashboard-period-btn').forEach(b => {
        if (b.dataset.period === AppState.dashboardPeriod) b.classList.add('active');
        else b.classList.remove('active');
      });

      const rangeInputs = document.getElementById('dashboard-range-inputs');
      const projRangeInputs = document.getElementById('proj-range-inputs');
      if (AppState.dashboardPeriod === 'range') {
        if (projRangeInputs) projRangeInputs.style.display = 'flex';
        if (rangeInputs) rangeInputs.style.display = 'flex';
        lastDashboardFingerprint = null;
        loadDashboardData(true);
      } else {
        if (projRangeInputs) projRangeInputs.style.display = 'none';
        if (rangeInputs) rangeInputs.style.display = 'none';
        refreshProjectionData();
        loadDashboardData();
      }
    });
  });

  ['dash-start-date', 'dash-end-date'].forEach(id => {
    const el = document.getElementById(id);
    if (el) {
      el.addEventListener('change', () => {
        const s = document.getElementById('dash-start-date')?.value;
        const e = document.getElementById('dash-end-date')?.value;
        if (s && e) {
          lastDashboardFingerprint = null;
          loadDashboardData(true);
        }
      });
    }
  });

  document.getElementById('btn-apply-dash-range').addEventListener('click', () => {
    const s = document.getElementById('dash-start-date').value;
    const e = document.getElementById('dash-end-date').value;
    const projS = document.getElementById('proj-start-date');
    const projE = document.getElementById('proj-end-date');
    if (projS) projS.value = s;
    if (projE) projE.value = e;
    loadDashboardData();
    refreshProjectionData();
  });

  const btnApplyProjRange = document.getElementById('btn-apply-proj-range');
  if (btnApplyProjRange) {
    btnApplyProjRange.addEventListener('click', () => {
      const s = document.getElementById('proj-start-date').value;
      const e = document.getElementById('proj-end-date').value;
      document.getElementById('dash-start-date').value = s;
      document.getElementById('dash-end-date').value = e;
      refreshProjectionData();
      loadDashboardData();
    });
  }

  // Scoring period buttons (即時評分時段切換：當天、當週、當月、指定期間)
  document.querySelectorAll('.scoring-period-btn').forEach(btn => {
    btn.addEventListener('click', async () => {
      const p = btn.dataset.period;
      AppState.scoringPeriod = p;
      localStorage.setItem('scoring_period', p);

      const rangeInputs = document.getElementById('scoring-range-inputs');
      if (p === 'range') {
        if (rangeInputs) rangeInputs.style.display = 'flex';
        const startInput = document.getElementById('scoring-start-date');
        const endInput = document.getElementById('scoring-end-date');
        if (startInput && endInput && (!startInput.value || !endInput.value)) {
          const now = new Date();
          const pad = n => String(n).padStart(2, '0');
          const toYMD = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
          const past = new Date();
          past.setDate(past.getDate() - 6);
          startInput.value = toYMD(past);
          endInput.value = toYMD(now);
          AppState.scoringStartDate = startInput.value;
          AppState.scoringEndDate = endInput.value;
        }
      } else {
        if (rangeInputs) rangeInputs.style.display = 'none';
      }

      updateScoringPeriodUI();
      await loadScoringData();
    });
  });

  ['scoring-start-date', 'scoring-end-date'].forEach(id => {
    const el = document.getElementById(id);
    if (el) {
      el.addEventListener('change', () => {
        const s = document.getElementById('scoring-start-date')?.value;
        const e = document.getElementById('scoring-end-date')?.value;
        if (s && e) {
          AppState.scoringStartDate = s;
          AppState.scoringEndDate = e;
          updateScoringPeriodUI();
          loadScoringData();
        }
      });
    }
  });

  document.getElementById('btn-apply-scoring-range')?.addEventListener('click', () => {
    const s = document.getElementById('scoring-start-date')?.value;
    const e = document.getElementById('scoring-end-date')?.value;
    if (!s || !e) {
      alert(window.I18n && window.I18n.getLanguage() === 'en' ? 'Please select both start and end dates!' : '請選擇開始與結束日期！');
      return;
    }
    AppState.scoringStartDate = s;
    AppState.scoringEndDate = e;
    updateScoringPeriodUI();
    loadScoringData();
  });

  // Handle date range preset pills (近 7 天, 近 30 天, 本月) for dashboard, projection & scoring
  document.querySelectorAll('.proj-range-preset-pill').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.preventDefault();
      const isScoring = btn.dataset.target === 'scoring' || btn.closest('#scoring-range-inputs');
      const isDash = btn.dataset.target === 'dash' || btn.closest('#dashboard-range-inputs');
      const startInput = document.getElementById(isScoring ? 'scoring-start-date' : (isDash ? 'dash-start-date' : 'proj-start-date'));
      const endInput = document.getElementById(isScoring ? 'scoring-end-date' : (isDash ? 'dash-end-date' : 'proj-end-date'));
      if (!startInput || !endInput) return;

      const now = new Date();
      const pad = n => String(n).padStart(2, '0');
      const toYMD = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

      let sDate;
      const eDate = new Date();
      if (btn.dataset.days) {
        const days = parseInt(btn.dataset.days, 10);
        sDate = new Date();
        sDate.setDate(sDate.getDate() - (days - 1));
      } else if (btn.dataset.preset === 'month') {
        sDate = new Date(now.getFullYear(), now.getMonth(), 1);
      }

      if (sDate) {
        startInput.value = toYMD(sDate);
        endInput.value = toYMD(eDate);

        if (isScoring) {
          AppState.scoringStartDate = startInput.value;
          AppState.scoringEndDate = endInput.value;
          const applyBtn = document.getElementById('btn-apply-scoring-range');
          if (applyBtn) applyBtn.click();
        } else {
          // Synchronize between dash and proj
          const otherStart = document.getElementById(isDash ? 'proj-start-date' : 'dash-start-date');
          const otherEnd = document.getElementById(isDash ? 'proj-end-date' : 'dash-end-date');
          if (otherStart) otherStart.value = startInput.value;
          if (otherEnd) otherEnd.value = endInput.value;

          startInput.dispatchEvent(new Event('change', { bubbles: true }));
          endInput.dispatchEvent(new Event('change', { bubbles: true }));

          const applyBtn = document.getElementById(isDash ? 'btn-apply-dash-range' : 'btn-apply-proj-range');
          if (applyBtn) applyBtn.click();
        }
      }
    });
  });

  document.getElementById('btn-open-big-screen').addEventListener('click', () => openBigScreenProjection());
  document.getElementById('btn-scoring-show-leaderboard')?.addEventListener('click', () => openBigScreenProjection({ fromScoring: true }));
  document.getElementById('btn-close-big-screen').addEventListener('click', closeBigScreenProjection);

  // Big screen projection view mode toggle (個人排行 vs 小組排行 vs 座號總覽)
  const btnProjInd = document.getElementById('btn-proj-mode-individual');
  const btnProjGrp = document.getElementById('btn-proj-mode-group');
  const btnProjAll = document.getElementById('btn-proj-mode-all');

  function updateProjModeButtons(activeBtn) {
    [btnProjInd, btnProjGrp, btnProjAll].forEach(b => {
      if (b) b.classList.remove('active');
    });
    if (activeBtn) activeBtn.classList.add('active');
  }

  if (btnProjInd) {
    btnProjInd.addEventListener('click', () => {
      AppState.projectionViewMode = 'individual';
      updateProjModeButtons(btnProjInd);
      refreshProjectionData(true);
    });
  }

  if (btnProjGrp) {
    btnProjGrp.addEventListener('click', () => {
      AppState.projectionViewMode = 'group';
      updateProjModeButtons(btnProjGrp);
      refreshProjectionData(true);
    });
  }

  if (btnProjAll) {
    btnProjAll.addEventListener('click', () => {
      AppState.projectionViewMode = 'all';
      updateProjModeButtons(btnProjAll);
      refreshProjectionData(true);
    });
  }

  // Dashboard view mode toggle (個人排行 vs 小組排行 vs 座號總覽)
  const btnDashInd = document.getElementById('btn-dash-mode-individual');
  const btnDashGrp = document.getElementById('btn-dash-mode-group');
  const btnDashAll = document.getElementById('btn-dash-mode-all');
  const secDashInd = document.getElementById('dash-section-individual');
  const secDashGrp = document.getElementById('dash-section-group');
  const secDashAll = document.getElementById('dash-section-all');

  function setDashboardMode(mode) {
    AppState.dashboardViewMode = mode;
    if (btnDashInd) btnDashInd.className = mode === 'individual' ? 'btn dash-mode-btn active' : 'btn btn-secondary dash-mode-btn';
    if (btnDashGrp) btnDashGrp.className = mode === 'group' ? 'btn dash-mode-btn active' : 'btn btn-secondary dash-mode-btn';
    if (btnDashAll) btnDashAll.className = mode === 'all' ? 'btn dash-mode-btn active' : 'btn btn-secondary dash-mode-btn';

    if (secDashInd) secDashInd.style.display = mode === 'individual' ? 'block' : 'none';
    if (secDashGrp) secDashGrp.style.display = mode === 'group' ? 'block' : 'none';
    if (secDashAll) secDashAll.style.display = mode === 'all' ? 'block' : 'none';

    loadDashboardData(true);
  }

  if (btnDashInd) btnDashInd.addEventListener('click', () => setDashboardMode('individual'));
  if (btnDashGrp) btnDashGrp.addEventListener('click', () => setDashboardMode('group'));
  if (btnDashAll) btnDashAll.addEventListener('click', () => setDashboardMode('all'));

  // Security & Auth Listeners
  document.getElementById('btn-submit-auth-password').addEventListener('click', submitAuthPassword);
  document.getElementById('auth-password-input').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') submitAuthPassword();
  });
  document.getElementById('btn-open-forgot-password-modal').addEventListener('click', openForgotConfirmModal);
  document.getElementById('student-login-form').addEventListener('submit', submitStudentLogin);
  const btnShowStudentQr = document.getElementById('btn-show-student-qr');
  if (btnShowStudentQr) btnShowStudentQr.addEventListener('click', showStudentQrModal);

  const btnAdminShowStudentQr = document.getElementById('btn-admin-show-student-qr');
  if (btnAdminShowStudentQr) btnAdminShowStudentQr.addEventListener('click', showStudentQrModal);

  const btnSecurityShowStudentQr = document.getElementById('btn-security-show-student-qr');
  if (btnSecurityShowStudentQr) btnSecurityShowStudentQr.addEventListener('click', showStudentQrModal);

  document.querySelectorAll('.btn-show-student-qr-action').forEach((btn) => {
    btn.addEventListener('click', showStudentQrModal);
  });
  document.getElementById('qr-student-image').addEventListener('click', () => {
    openQrFullscreenTab(
      document.getElementById('qr-student-image').src,
      document.getElementById('qr-student-url-text').textContent
    );
  });
  document.getElementById('btn-confirm-forgot-reset').addEventListener('click', confirmForgotReset);
  document.getElementById('btn-save-password-prefix').addEventListener('click', savePasswordPrefix);

  const btnLogout = document.getElementById('btn-logout');
  if (btnLogout) btnLogout.addEventListener('click', logout);
  const btnAdminLogout = document.getElementById('btn-admin-logout');
  if (btnAdminLogout) btnAdminLogout.addEventListener('click', logout);

  // Admin tab buttons
  document.getElementById('btn-open-add-student-modal').addEventListener('click', openAddStudentModal);
  const photoInput = document.getElementById('edit-student-photo-input');
  document.getElementById('btn-edit-student-photo-pick').addEventListener('click', () => {
    const s = editingPhotoStudent;
    if (s && !s.student_code) {
      alert(window.I18n && window.I18n.getLanguage() === 'en' ? 'Set and save a student ID first.' : '請先為這位學生設定並儲存學號。');
      return;
    }
    photoInput.click();
  });
  photoInput.addEventListener('change', () => { const f = photoInput.files[0]; photoInput.value = ''; changeEditingStudentPhoto(f); });
  document.getElementById('btn-edit-student-photo-remove').addEventListener('click', removeEditingStudentPhoto);
  document.getElementById('btn-edit-student-photo-restore').addEventListener('click', restoreEditingStudentPhoto);
  const batchInput = document.getElementById('batch-photo-input');
  document.getElementById('btn-batch-photo-import').addEventListener('click', () => batchInput.click());
  batchInput.addEventListener('change', () => { const arr = Array.from(batchInput.files); batchInput.value = ''; batchImportStudentPhotos(arr); });
  document.getElementById('btn-confirm-save-student').addEventListener('click', confirmSaveStudent);
  document.getElementById('btn-upload-file').addEventListener('click', uploadStudentFile);
  document.getElementById('btn-export-excel').addEventListener('click', exportExcel);
  const exportStartInput = document.getElementById('export-start-date');
  const exportEndInput = document.getElementById('export-end-date');
  if (exportStartInput) {
    exportStartInput.addEventListener('change', updateExportExcelButtonState);
    exportStartInput.addEventListener('input', updateExportExcelButtonState);
  }
  if (exportEndInput) {
    exportEndInput.addEventListener('change', updateExportExcelButtonState);
    exportEndInput.addEventListener('input', updateExportExcelButtonState);
  }
  updateExportExcelButtonState();
  document.getElementById('btn-add-rule-modal').addEventListener('click', openAddRuleModal);
  document.getElementById('btn-reset-rules-default').addEventListener('click', resetRulesDefault);

  // Modal Confirm: Add / Edit Rule
  document.getElementById('btn-confirm-add-rule').addEventListener('click', confirmSaveRule);

  // Logo & Favicon Customization Listeners
  const btnUploadLogo = document.getElementById('btn-upload-logo');
  if (btnUploadLogo) btnUploadLogo.addEventListener('click', uploadCustomLogo);
  const btnResetLogo = document.getElementById('btn-reset-logo');
  if (btnResetLogo) btnResetLogo.addEventListener('click', resetCustomLogo);

  // Admin Sub-Navigation Mode Switcher (後台分類切換按鈕)
  document.querySelectorAll('.admin-subtab-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.admin-subtab-btn').forEach(b => {
        b.classList.remove('active');
        b.className = 'btn btn-secondary admin-subtab-btn';
      });
      btn.classList.add('active');
      btn.className = 'btn admin-subtab-btn active';

      const targetSubtab = btn.dataset.subtab;
      document.querySelectorAll('.admin-subpane').forEach(pane => {
        pane.style.display = 'none';
        pane.classList.remove('active');
      });

      const targetPane = document.getElementById(`admin-subpane-${targetSubtab}`);
      if (targetPane) {
        targetPane.style.display = 'block';
        targetPane.classList.add('active');
      }
      if (targetSubtab === 'pointcards' && window.PointCardsManager && typeof window.PointCardsManager.reload === 'function') {
        window.PointCardsManager.reload();
      }
      if (targetSubtab === 'rewards' && window.RewardsManager && typeof window.RewardsManager.reload === 'function') {
        window.RewardsManager.reload();
      }
    });
  });

  // Filter Student Score Logs Modal Listeners
  const btnFilterLogs = document.getElementById('btn-filter-score-logs');
  if (btnFilterLogs) btnFilterLogs.addEventListener('click', loadStudentScoreLogs);

  const btnResetLogs = document.getElementById('btn-reset-filter-score-logs');
  if (btnResetLogs) {
    btnResetLogs.addEventListener('click', () => {
      const s = document.getElementById('score-logs-start-date');
      const e = document.getElementById('score-logs-end-date');
      if (s) s.value = '';
      if (e) e.value = '';
      loadStudentScoreLogs();
    });
  }

  // Paper Quiz Listeners
  const quizSelect = document.getElementById('paper-quiz-select');
  if (quizSelect) {
    quizSelect.addEventListener('change', (e) => {
      AppState.currentPaperQuizId = Number(e.target.value);
      loadPaperQuizMatrix(AppState.currentPaperQuizId);
    });
  }

  const filterSubject = document.getElementById('paper-quiz-filter-subject');
  if (filterSubject) {
    filterSubject.addEventListener('change', () => filterAndRenderPaperQuizSelect());
  }

  const searchKeyword = document.getElementById('paper-quiz-search-keyword');
  if (searchKeyword) {
    searchKeyword.addEventListener('input', () => filterAndRenderPaperQuizSelect());
  }

  const btnClearSearch = document.getElementById('btn-clear-quiz-search');
  if (btnClearSearch) {
    btnClearSearch.addEventListener('click', () => {
      if (searchKeyword) {
        searchKeyword.value = '';
        filterAndRenderPaperQuizSelect();
      }
    });
  }

  const btnCreateQuiz = document.getElementById('btn-create-paper-quiz');
  if (btnCreateQuiz) btnCreateQuiz.addEventListener('click', () => openPaperQuizModal(false));

  const btnEditQuiz = document.getElementById('btn-edit-paper-quiz');
  if (btnEditQuiz) btnEditQuiz.addEventListener('click', () => openPaperQuizModal(true));

  const btnDeleteQuiz = document.getElementById('btn-delete-paper-quiz');
  if (btnDeleteQuiz) btnDeleteQuiz.addEventListener('click', confirmDeleteCurrentPaperQuiz);

  // 紙本測驗成績已改為即時自動儲存 (Auto-Save)，移除手動儲存按鈕綁定

  const formPaperQuiz = document.getElementById('form-paper-quiz');
  if (formPaperQuiz) formPaperQuiz.addEventListener('submit', submitPaperQuizForm);

  const filterUnrecorded = document.getElementById('paper-quiz-filter-unrecorded');
  if (filterUnrecorded) {
    filterUnrecorded.addEventListener('change', () => renderPaperQuizMatrix(AppState.currentPaperQuizData));
  }

  const filterPending = document.getElementById('paper-quiz-filter-pending-photos');
  if (filterPending) {
    filterPending.addEventListener('change', () => renderPaperQuizMatrix(AppState.currentPaperQuizData));
  }

  const filterAbsent = document.getElementById('paper-quiz-filter-absent');
  if (filterAbsent) {
    filterAbsent.addEventListener('change', () => renderPaperQuizMatrix(AppState.currentPaperQuizData));
  }

  const filterMakeup = document.getElementById('paper-quiz-filter-makeup');
  if (filterMakeup) {
    filterMakeup.addEventListener('change', () => renderPaperQuizMatrix(AppState.currentPaperQuizData));
  }

  const btnApprovePhoto = document.getElementById('btn-quiz-verify-approve');
  if (btnApprovePhoto) btnApprovePhoto.addEventListener('click', () => setQuizPhotoVerifyStatus(true));

  const btnRejectPhoto = document.getElementById('btn-quiz-verify-reject');
  if (btnRejectPhoto) btnRejectPhoto.addEventListener('click', () => setQuizPhotoVerifyStatus(false));

  // --- 紙本測驗學生成績總覽事件綁定 ---
  const btnOpenOverview = document.getElementById('btn-open-paper-quiz-overview');
  if (btnOpenOverview) {
    btnOpenOverview.addEventListener('click', openPaperQuizOverviewModal);
  }

  const btnQueryOverview = document.getElementById('btn-paper-quiz-overview-query');
  if (btnQueryOverview) {
    btnQueryOverview.addEventListener('click', loadPaperQuizOverviewData);
  }

  const overviewSubject = document.getElementById('paper-quiz-overview-subject');
  if (overviewSubject) {
    overviewSubject.addEventListener('change', loadPaperQuizOverviewData);
  }

  const btnResetOverview = document.getElementById('btn-paper-quiz-overview-reset');
  if (btnResetOverview) {
    btnResetOverview.addEventListener('click', () => {
      const subjEl = document.getElementById('paper-quiz-overview-subject');
      const startEl = document.getElementById('paper-quiz-overview-start-date');
      const endEl = document.getElementById('paper-quiz-overview-end-date');
      if (subjEl) subjEl.value = '';
      if (startEl) startEl.value = '';
      if (endEl) endEl.value = '';
      loadPaperQuizOverviewData();
    });
  }
}

// --- Logo & Favicon Customization Functions ---
async function uploadCustomLogo() {
  const fileInput = document.getElementById('logo-file-input');
  if (!fileInput || !fileInput.files || fileInput.files.length === 0) {
    showAlertModal('請先選擇要上傳的圖片檔案 (PNG, JPG 或 SVG)！');
    return;
  }

  const formData = new FormData();
  formData.append('file', fileInput.files[0]);

  try {
    const data = await API.postFormData('/api/system/logo', formData);
    showToast(data.message || 'Logo 與 Favicon 已成功替換！', 'positive');
    resetCustomFileInput(fileInput);
    refreshSystemLogoImages();
  } catch (err) {
    showAlertModal(`Logo 上傳失敗：${err.message}`);
  }
}

async function resetCustomLogo() {
  if (!await showConfirmModal({
    icon: '🔄',
    title: '恢復預設 Logo',
    desc: '確定要將系統標誌恢復為系統預設 Logo 嗎？',
    confirmText: '確定恢復',
    cancelText: '取消'
  })) return;

  try {
    const data = await API.post('/api/system/logo/reset', {});
    showToast(data.message || '已恢復為系統預設 Logo！', 'positive');
    refreshSystemLogoImages();
  } catch (err) {
    showAlertModal(`恢復預設 Logo 失敗：${err.message}`);
  }
}

function refreshSystemLogoImages() {
  const cacheBuster = `?t=${Date.now()}`;
  const logoUrl = `/api/system/logo${cacheBuster}`;

  const appLogo = document.getElementById('app-logo-img');
  if (appLogo) appLogo.src = logoUrl;

  const authLogo = document.getElementById('auth-logo-img');
  if (authLogo) authLogo.src = logoUrl;

  const previewLogo = document.getElementById('admin-logo-preview');
  if (previewLogo) previewLogo.src = logoUrl;

  const favicon = document.getElementById('app-favicon');
  if (favicon) favicon.href = logoUrl;

  const shortcutFavicon = document.getElementById('app-shortcut-favicon');
  if (shortcutFavicon) shortcutFavicon.href = logoUrl;
}
