/* ==========================================================================
   國小課堂即時記錄系統 - Main Frontend Controller App
   ==========================================================================
   教師端主程式（2026-10-31 拆分）：這個檔案是核心，必須最先載入；
   各功能在 static/js/app/ 底下（auth、scoring、attendance…）。
   所有 static/js/app.js 與 static/js/app/*.js 共用同一個全域範圍（一般 <script>，不是模組），載入順序見 static/index.html。
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
