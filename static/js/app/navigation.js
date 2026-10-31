// MyClass 教師端：分頁切換與重新整理、教學工具資料、抽籤快速加分
// 由 static/js/app.js 拆出（2026-10-31，原第 801–1204 行），程式內容未變更。
// 所有 static/js/app.js 與 static/js/app/*.js 共用同一個全域範圍（一般 <script>，不是模組），載入順序見 static/index.html。


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
  // visible flicker. Mirrors the equivalent guard in student/navigation.js's switchTab().
  const targetTab = document.querySelector(`.nav-tab[data-tab="${tabName}"]`);
  // 卡片模式的「我的功能」首頁顯示中，目前的分頁是被暫停的（見 suspendActiveTab），
  // 這時即使點的是同一個分頁也要完整重新進入。
  const fromLauncherHome = document.body.classList.contains('launcher-home');
  if (targetTab && targetTab.classList.contains('active') && !fromLauncherHome) return;

  // 通知卡片模式（launcher.js）離開首頁、更新上方的返回列
  window.dispatchEvent(new CustomEvent('myclass:tabswitch', { detail: { tab: tabName } }));

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

// 卡片模式回到「我的功能」首頁時呼叫：做和離開分頁時一樣的收尾
// （自動儲存、送出暫存分數、暫停計時器背景音樂、關閉互動牆），但不切換分頁。
function suspendActiveTab() {
  if (getActiveTabName() === 'paperQuiz' && typeof triggerPaperQuizAutoSave === 'function') {
    triggerPaperQuizAutoSave(true);
  }
  if (window.TeachingToolkit?.bulletin && typeof window.TeachingToolkit.bulletin.flushActivePost === 'function') {
    window.TeachingToolkit.bulletin.flushActivePost();
  }
  if (AppState.quickScoringMode && AppState.pendingQuickScores) {
    const hasPending = Object.values(AppState.pendingQuickScores).some(s => Number(s) !== 0);
    if (hasPending) commitPendingQuickScores();
  }
  const popover = document.getElementById('cursor-score-popover');
  if (popover) popover.style.display = 'none';
  if (window.TeachingToolkit?.timer) window.TeachingToolkit.timer.onLeaveTimerTab();
  if (window.TeachingToolkit?.liveWall) window.TeachingToolkit.liveWall.onLeaveLiveWallTab();
}
window.suspendActiveTab = suspendActiveTab;

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
