// MyClass 卡片模式（功能選擇器）
// 頁首「模式」按鈕在兩種顯示方式之間切換：
//   分頁模式：原本的「情境膠囊 → 子分頁」導覽列。
//   卡片模式：隱藏導覽列，改顯示「我的功能」首頁，只放老師自己挑選的功能卡片；
//             點卡片進入功能，上方的「我的功能」按鈕可回首頁。
// 功能名稱直接讀取現有分頁按鈕的文字（已由 i18n.js 翻譯），所以語系切換會自動同步。
// 顯示模式與已選功能記在這台電腦的瀏覽器（localStorage）。
(function () {
  'use strict';

  const MODE_KEY = 'myclass_view_mode'; // 'tabs' | 'cards'
  const FEATURES_KEY = 'myclass_launcher_features'; // JSON 陣列，內容為功能 id

  const CONTEXTS = ['inclass', 'routine', 'teaching', 'assessment', 'settings'];

  // 功能清單：tab 對應 app/navigation.js 的 switchTab()；sub 是「教學互動工具」面板裡的子分頁
  const FEATURES = [
    { id: 'scoring', tab: 'scoring', ctx: 'inclass' },
    { id: 'dashboard', tab: 'dashboard', ctx: 'inclass' },
    { id: 'notes', tab: 'notes', ctx: 'inclass' },
    { id: 'toolkit', tab: 'toolkit', ctx: 'inclass' },
    { id: 'tk-bulletin', tab: 'toolkit', sub: 'bulletin', ctx: 'inclass' },
    { id: 'tk-draw', tab: 'toolkit', sub: 'draw', ctx: 'inclass' },
    { id: 'tk-timer', tab: 'toolkit', sub: 'timer', ctx: 'inclass' },
    { id: 'tk-liveWall', tab: 'toolkit', sub: 'liveWall', ctx: 'inclass' },
    { id: 'tk-wordCloud', tab: 'toolkit', sub: 'wordCloud', ctx: 'inclass' },
    { id: 'tk-kahoot', tab: 'toolkit', sub: 'kahoot', ctx: 'inclass' },
    { id: 'attendance', tab: 'attendance', ctx: 'routine' },
    { id: 'whereabouts', tab: 'whereabouts', ctx: 'routine' },
    { id: 'journal', tab: 'journal', ctx: 'routine' },
    { id: 'materials', tab: 'materials', ctx: 'teaching' },
    { id: 'filecollect', tab: 'filecollect', ctx: 'teaching' },
    { id: 'hwscan', tab: 'hwscan', ctx: 'teaching' },
    { id: 'paperQuiz', tab: 'paperQuiz', ctx: 'teaching' },
    { id: 'rewards', tab: 'rewards', ctx: 'assessment' },
    { id: 'pointcards', tab: 'pointcards', ctx: 'assessment' },
    { id: 'reports', tab: 'reports', ctx: 'assessment' },
    { id: 'timetable', tab: 'timetable', ctx: 'settings' },
    { id: 'students', tab: 'students', ctx: 'settings' },
    { id: 'seating', tab: 'seating', ctx: 'settings' },
    { id: 'grouping', tab: 'grouping', ctx: 'settings' },
    { id: 'rules', tab: 'rules', ctx: 'settings' },
    { id: 'appearance', tab: 'appearance', ctx: 'settings' },
    { id: 'security', tab: 'security', ctx: 'settings' },
    { id: 'manual', tab: 'manual', ctx: 'settings' },
  ];

  // 第一次使用卡片模式時預先勾選的常用功能
  const RECOMMENDED = ['scoring', 'attendance', 'dashboard', 'notes', 'tk-draw', 'tk-timer', 'materials', 'journal'];

  const TEXT = {
    'zh-TW': {
      mode_btn: '模式',
      mode_tabs: '分頁',
      mode_cards: '卡片',
      mode_title: '切換顯示模式：分頁／卡片',
      home_title: '🗂️ 我的功能',
      home_sub: '點卡片開啟功能；按「選擇功能」決定這裡要放哪些。',
      pick: '⚙️ 選擇功能',
      back: '⬅ 我的功能',
      empty_title: '還沒有選擇功能',
      empty_desc: '先挑出常用的功能，它們會以卡片排在這裡。',
      picker_title: '⚙️ 選擇要放在首頁的功能',
      picker_hint: '勾選常用的功能，之後隨時可以再調整。選擇只記在這台電腦的瀏覽器。',
      recommended: '⭐ 推薦組合',
      all: '全選',
      none: '全部取消',
      done: '完成',
      count: '已選 {n} 項',
      qr_mobile: '📱 手機評分 QR Code',
      qr_student: '🎓 學生連線 QR Code',
      to_tabs: '📑 改回分頁模式',
      local_only: '僅限本機',
    },
    en: {
      mode_btn: 'View',
      mode_tabs: 'Tabs',
      mode_cards: 'Cards',
      mode_title: 'Switch view: tabs / cards',
      home_title: '🗂️ My Features',
      home_sub: 'Click a card to open it. Use "Choose Features" to decide what shows here.',
      pick: '⚙️ Choose Features',
      back: '⬅ My Features',
      empty_title: 'No features chosen yet',
      empty_desc: 'Pick the features you use most and they will appear here as cards.',
      picker_title: '⚙️ Choose features for your home page',
      picker_hint: 'Check the features you use often. You can change this any time. Saved in this browser only.',
      recommended: '⭐ Recommended',
      all: 'Select all',
      none: 'Clear all',
      done: 'Done',
      count: '{n} selected',
      qr_mobile: '📱 Mobile Scoring QR',
      qr_student: '🎓 Student Login QR',
      to_tabs: '📑 Back to tab view',
      local_only: 'This PC only',
    },
  };

  const DESC = {
    'zh-TW': {
      scoring: '點學生頭像即時加減分，可多選或整組加分',
      dashboard: '今日、區間與學期累計分數排行',
      notes: '記錄學生的特殊表現，可附照片與影音',
      toolkit: '公布欄、抽籤、計時器、互動牆等工具集中在一頁',
      'tk-bulletin': '在大螢幕顯示課堂公告與提醒',
      'tk-draw': '隨機抽出學生或小組，抽完一鍵加分',
      'tk-timer': '倒數計時與碼錶，附提醒鈴聲與背景音樂',
      'tk-liveWall': '學生用手機投稿文字或圖片，即時上牆',
      'tk-wordCloud': '學生送出詞彙，即時組成文字雲',
      'tk-kahoot': '全班即時搶答，自動統計答對情形',
      attendance: '登記出席、請假與遲到',
      whereabouts: '掌握學生離開教室的去向與時間',
      journal: '寫下每天的教學紀錄',
      materials: '單元教材、作業繳交與線上測驗',
      filecollect: '開放學生上傳檔案，收齊後打包下載',
      hwscan: '掃描條碼登記作業繳交狀況',
      paperQuiz: '登記紙本小考成績與補考',
      rewards: '上架獎品，審核學生的兌換申請',
      pointcards: '設計與管理實體點數卡',
      reports: '匯出出缺席、分數與紀錄的 Excel',
      timetable: '設定自己的課表與上課提醒',
      students: '新增、匯入學生與管理照片、密碼',
      seating: '排座位，支援隨機與性別平衡',
      grouping: '建立分組方案，可自動分組',
      rules: '自訂加減分項目與分數',
      appearance: '更換學校標誌',
      security: '修改密碼字頭、連線與軟體更新設定',
      manual: '系統使用說明',
    },
    en: {
      scoring: 'Award or deduct points by tapping students, groups or several at once',
      dashboard: 'Leaderboards for today, a date range or the semester',
      notes: 'Record notable behavior with photos or video',
      toolkit: 'Bulletin, lucky draw, timer, live wall and more in one page',
      'tk-bulletin': 'Show class notices on the big screen',
      'tk-draw': 'Randomly pick students or groups, then award points',
      'tk-timer': 'Countdown timer and stopwatch with alerts and music',
      'tk-liveWall': 'Students post text or images from their devices',
      'tk-wordCloud': 'Students submit words that form a live word cloud',
      'tk-kahoot': 'Live class quiz game with automatic results',
      attendance: 'Mark attendance, leave and late arrivals',
      whereabouts: 'Track where students go when out of class',
      journal: 'Write daily teaching notes',
      materials: 'Unit materials, assignments and online quizzes',
      filecollect: 'Collect student file uploads and download as a zip',
      hwscan: 'Scan barcodes to log homework submissions',
      paperQuiz: 'Record paper quiz scores and make-ups',
      rewards: 'List rewards and review redemption requests',
      pointcards: 'Design and manage physical point cards',
      reports: 'Export attendance, scores and notes to Excel',
      timetable: 'Set up your timetable and class reminders',
      students: 'Add or import students, manage photos and passwords',
      seating: 'Arrange seats, randomly or gender-balanced',
      grouping: 'Create group plans with automatic grouping',
      rules: 'Customize point rules and values',
      appearance: 'Change the school logo',
      security: 'Password prefix, connection and update settings',
      manual: 'How to use the system',
    },
  };

  const S = {
    mode: 'tabs',
    selected: [],
    hasSavedSelection: false,
    pickerDraft: null,
  };

  const $ = (id) => document.getElementById(id);

  function lang() {
    return window.I18n && window.I18n.getLanguage() === 'en' ? 'en' : 'zh-TW';
  }

  function tx(key, params) {
    let s = (TEXT[lang()] && TEXT[lang()][key]) || TEXT['zh-TW'][key] || key;
    if (params) Object.keys(params).forEach(k => { s = s.replace(`{${k}}`, params[k]); });
    return s;
  }

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }

  // --- 儲存 ---------------------------------------------------------------
  function loadState() {
    try {
      S.mode = localStorage.getItem(MODE_KEY) === 'cards' ? 'cards' : 'tabs';
    } catch (_) { S.mode = 'tabs'; }
    S.selected = RECOMMENDED.slice();
    S.hasSavedSelection = false;
    try {
      const raw = localStorage.getItem(FEATURES_KEY);
      if (raw) {
        const arr = JSON.parse(raw);
        if (Array.isArray(arr)) {
          S.selected = arr.filter(id => FEATURES.some(f => f.id === id));
          S.hasSavedSelection = true;
        }
      }
    } catch (_) { /* 用推薦組合 */ }
  }

  function saveMode() {
    try { localStorage.setItem(MODE_KEY, S.mode); } catch (_) { /* 無法儲存時只影響下次開啟 */ }
  }

  function saveSelection() {
    S.hasSavedSelection = true;
    try { localStorage.setItem(FEATURES_KEY, JSON.stringify(S.selected)); } catch (_) { /* 同上 */ }
  }

  // --- 功能資訊（從現有按鈕讀取翻譯後的名稱） ----------------------------
  function sourceButton(f) {
    if (f.sub) return document.querySelector(`.toolkit-subtab-btn[data-toolkit-tab="${f.sub}"]`);
    return document.querySelector(`.desktop-nav-tabs .nav-tab[data-tab="${f.tab}"]`);
  }

  // 作業掃描只在教師本機顯示（homework-scan.js 會在確認後打開按鈕）
  function isAvailable(f) {
    const btn = sourceButton(f);
    if (!btn) return false;
    return !btn.hidden && btn.style.display !== 'none';
  }

  function splitLabel(text) {
    const t = String(text || '').trim();
    const m = t.match(/^(\S+)\s+(.+)$/);
    if (m && /\p{Extended_Pictographic}/u.test(m[1])) return { icon: m[1], name: m[2] };
    return { icon: '•', name: t };
  }

  function featureInfo(f) {
    const btn = sourceButton(f);
    const { icon, name } = splitLabel(btn ? btn.textContent : f.id);
    const desc = (DESC[lang()] && DESC[lang()][f.id]) || DESC['zh-TW'][f.id] || '';
    return { icon, name, desc };
  }

  function contextLabel(ctx) {
    const el = document.querySelector(`.scenario-pill[data-context="${ctx}"] .scenario-text`);
    return el ? el.textContent.trim() : ctx;
  }

  function selectedFeatures() {
    return FEATURES.filter(f => S.selected.includes(f.id) && isAvailable(f));
  }

  function activeToolkitSub() {
    const b = document.querySelector('.toolkit-subtab-btn.active');
    return b ? b.dataset.toolkitTab : null;
  }

  // --- 進出功能 -------------------------------------------------------------
  function isHome() {
    return document.body.classList.contains('launcher-home');
  }

  function showHome() {
    if (S.mode !== 'cards') return;
    if (!isHome()) {
      if (typeof window.suspendActiveTab === 'function') window.suspendActiveTab();
      document.body.classList.add('launcher-home');
    }
    renderHome();
    syncVisibility();
    window.scrollTo(0, 0);
  }

  function openFeature(f) {
    if (typeof window.switchTab !== 'function') return;
    const wasHome = isHome();
    window.switchTab(f.tab);
    if (f.tab === 'toolkit' && window.TeachingToolkit && typeof window.TeachingToolkit.switchSubtab === 'function') {
      // 從首頁回到工具箱時，也重新進入目前的子分頁（例如互動牆要重新開啟）
      const sub = f.sub || (wasHome ? activeToolkitSub() : null);
      if (sub) window.TeachingToolkit.switchSubtab(sub);
    }
    renderBackbar();
    window.scrollTo(0, 0);
  }

  function setMode(mode) {
    if (mode === S.mode) return;
    S.mode = mode;
    saveMode();
    if (mode === 'cards') {
      document.body.classList.add('launcher-mode');
      showHome();
      if (!S.hasSavedSelection) openPicker();
    } else {
      document.body.classList.remove('launcher-mode');
      if (isHome() && typeof window.switchTab === 'function') {
        // 首頁時目前的分頁是暫停的，回到分頁模式要重新進入它
        const tab = window.getActiveTabName ? window.getActiveTabName() : 'scoring';
        const sub = activeToolkitSub();
        window.switchTab(tab);
        if (tab === 'toolkit' && sub && window.TeachingToolkit) window.TeachingToolkit.switchSubtab(sub);
      }
      document.body.classList.remove('launcher-home');
      syncVisibility();
    }
    updateToggleButton();
  }

  function syncVisibility() {
    const cards = S.mode === 'cards';
    const home = cards && isHome();
    const view = $('launcher-view');
    const bar = $('launcher-backbar');
    if (view) view.hidden = !home;
    if (bar) bar.hidden = !cards || home;
  }

  // --- 繪製 -----------------------------------------------------------------
  function updateToggleButton() {
    const btn = $('btn-toggle-view-mode');
    if (!btn) return;
    const isCards = S.mode === 'cards';
    btn.innerHTML = `${isCards ? '🗂️' : '📑'} <span class="view-mode-label">${esc(tx('mode_btn'))}: ${esc(tx(isCards ? 'mode_cards' : 'mode_tabs'))}</span>`;
    btn.title = tx('mode_title');
    btn.setAttribute('aria-pressed', isCards ? 'true' : 'false');
  }

  function cardHtml(f) {
    const info = featureInfo(f);
    const localTag = f.id === 'hwscan' ? `<span class="launcher-card-flag">${esc(tx('local_only'))}</span>` : '';
    return `
      <button type="button" class="launcher-card" data-ctx="${f.ctx}" data-feature="${f.id}">
        <span class="launcher-card-icon" aria-hidden="true">${esc(info.icon)}</span>
        <span class="launcher-card-name">${esc(info.name)}${localTag}</span>
        <span class="launcher-card-desc">${esc(info.desc)}</span>
        <span class="launcher-card-tag">${esc(contextLabel(f.ctx))}</span>
      </button>`;
  }

  function renderHome() {
    const view = $('launcher-view');
    if (!view) return;
    const list = selectedFeatures();
    const grid = list.length
      ? `<div class="launcher-grid">${list.map(cardHtml).join('')}</div>`
      : `<div class="launcher-empty">
           <div class="launcher-empty-icon" aria-hidden="true">🗂️</div>
           <div class="launcher-empty-title">${esc(tx('empty_title'))}</div>
           <p>${esc(tx('empty_desc'))}</p>
           <button type="button" class="btn" data-launcher-action="pick">${esc(tx('pick'))}</button>
         </div>`;
    view.innerHTML = `
      <div class="launcher-inner">
        <div class="launcher-hero">
          <div>
            <h2 class="launcher-title">${esc(tx('home_title'))}</h2>
            <p class="launcher-sub">${esc(tx('home_sub'))}</p>
          </div>
          <div class="launcher-hero-actions">
            <button type="button" class="btn" data-launcher-action="pick">${esc(tx('pick'))}</button>
            <button type="button" class="btn btn-secondary" data-launcher-action="qr-mobile">${esc(tx('qr_mobile'))}</button>
            <button type="button" class="btn btn-secondary" data-launcher-action="qr-student">${esc(tx('qr_student'))}</button>
          </div>
        </div>
        ${grid}
        <div class="launcher-foot">
          <button type="button" class="launcher-link" data-launcher-action="to-tabs">${esc(tx('to_tabs'))}</button>
        </div>
      </div>`;
  }

  function renderBackbar() {
    const bar = $('launcher-backbar');
    if (!bar || S.mode !== 'cards') return;
    bar.innerHTML = `
      <div class="launcher-backbar-inner">
        <button type="button" class="btn btn-secondary launcher-back" data-launcher-action="home">${esc(tx('back'))}</button>
      </div>`;
  }

  // --- 功能選擇器 -------------------------------------------------------------
  function ensurePicker() {
    let modal = $('modal-launcher-picker');
    if (modal) return modal;
    modal = document.createElement('div');
    modal.id = 'modal-launcher-picker';
    modal.className = 'modal-overlay';
    modal.innerHTML = '<div class="modal-content launcher-picker"></div>';
    document.body.appendChild(modal);
    modal.addEventListener('click', (e) => {
      if (e.target === modal) { closePicker(true); return; }
      const actionEl = e.target.closest('[data-picker-action]');
      if (actionEl) {
        const a = actionEl.dataset.pickerAction;
        if (a === 'close' || a === 'done') closePicker(true);
        else if (a === 'recommended') { S.pickerDraft = RECOMMENDED.slice(); renderPicker(); }
        else if (a === 'all') { S.pickerDraft = FEATURES.filter(isAvailable).map(f => f.id); renderPicker(); }
        else if (a === 'none') { S.pickerDraft = []; renderPicker(); }
      }
    });
    modal.addEventListener('change', (e) => {
      const cb = e.target.closest('input[type="checkbox"][data-feature]');
      if (!cb) return;
      const id = cb.dataset.feature;
      S.pickerDraft = S.pickerDraft.filter(x => x !== id);
      if (cb.checked) S.pickerDraft.push(id);
      const tile = cb.closest('.launcher-pick');
      if (tile) tile.classList.toggle('checked', cb.checked);
      updatePickerCount();
    });
    return modal;
  }

  function updatePickerCount() {
    const el = $('launcher-picker-count');
    if (!el) return;
    const n = FEATURES.filter(f => S.pickerDraft.includes(f.id) && isAvailable(f)).length;
    el.textContent = tx('count', { n });
  }

  function renderPicker() {
    const modal = ensurePicker();
    const box = modal.querySelector('.launcher-picker');
    const groups = CONTEXTS.map(ctx => {
      const items = FEATURES.filter(f => f.ctx === ctx && isAvailable(f));
      if (!items.length) return '';
      const tiles = items.map(f => {
        const info = featureInfo(f);
        const checked = S.pickerDraft.includes(f.id);
        return `
          <label class="launcher-pick${checked ? ' checked' : ''}" data-ctx="${ctx}">
            <input type="checkbox" data-feature="${f.id}"${checked ? ' checked' : ''}>
            <span class="launcher-pick-icon" aria-hidden="true">${esc(info.icon)}</span>
            <span class="launcher-pick-text">
              <span class="launcher-pick-name">${esc(info.name)}</span>
              <span class="launcher-pick-desc">${esc(info.desc)}</span>
            </span>
          </label>`;
      }).join('');
      return `<div class="launcher-pick-group"><div class="launcher-pick-group-title">${esc(contextLabel(ctx))}</div><div class="launcher-pick-grid">${tiles}</div></div>`;
    }).join('');
    box.innerHTML = `
      <div class="modal-header">
        <div class="modal-title">${esc(tx('picker_title'))}</div>
        <button type="button" class="btn-icon" data-picker-action="close" aria-label="✕">✕</button>
      </div>
      <p class="launcher-picker-hint">${esc(tx('picker_hint'))}</p>
      <div class="launcher-picker-tools">
        <button type="button" class="btn btn-secondary" data-picker-action="recommended">${esc(tx('recommended'))}</button>
        <button type="button" class="btn btn-secondary" data-picker-action="all">${esc(tx('all'))}</button>
        <button type="button" class="btn btn-secondary" data-picker-action="none">${esc(tx('none'))}</button>
      </div>
      <div class="launcher-picker-body">${groups}</div>
      <div class="launcher-picker-foot">
        <span id="launcher-picker-count" class="launcher-picker-count"></span>
        <button type="button" class="btn" data-picker-action="done">${esc(tx('done'))}</button>
      </div>`;
    updatePickerCount();
  }

  function openPicker() {
    S.pickerDraft = S.selected.slice();
    renderPicker();
    ensurePicker().classList.add('open');
  }

  function isPickerOpen() {
    const m = $('modal-launcher-picker');
    return !!(m && m.classList.contains('open'));
  }

  // 關閉即儲存（勾選本身就是編輯動作，不另外設「取消」）
  function closePicker(save) {
    const modal = $('modal-launcher-picker');
    if (!modal) return;
    modal.classList.remove('open');
    if (save && S.pickerDraft) {
      S.selected = FEATURES.map(f => f.id).filter(id => S.pickerDraft.includes(id));
      saveSelection();
    }
    S.pickerDraft = null;
    if (S.mode === 'cards') {
      if (isHome()) renderHome();
      else renderBackbar();
    }
  }

  // --- 事件 -----------------------------------------------------------------
  function handleClick(e) {
    const card = e.target.closest('.launcher-card[data-feature]');
    if (card) {
      const f = FEATURES.find(x => x.id === card.dataset.feature);
      if (f) openFeature(f);
      return;
    }
    const actionEl = e.target.closest('[data-launcher-action]');
    if (!actionEl) return;
    const a = actionEl.dataset.launcherAction;
    if (a === 'pick') openPicker();
    else if (a === 'home') showHome();
    else if (a === 'to-tabs') setMode('tabs');
    else if (a === 'qr-mobile' && typeof window.showQRModal === 'function') window.showQRModal();
    else if (a === 'qr-student' && typeof window.showStudentQrModal === 'function') window.showStudentQrModal();
  }

  function init() {
    const toggle = $('btn-toggle-view-mode');
    // 教師手機評分專用畫面（?mobile=1）維持原樣，不提供卡片模式
    if (document.body.classList.contains('mobile-scoring-only')) {
      if (toggle) toggle.style.display = 'none';
      return;
    }

    loadState();
    if (S.mode === 'cards') {
      document.body.classList.add('launcher-mode', 'launcher-home');
      renderHome();
    }
    syncVisibility();
    updateToggleButton();

    if (toggle) toggle.addEventListener('click', () => setMode(S.mode === 'cards' ? 'tabs' : 'cards'));
    $('launcher-view')?.addEventListener('click', handleClick);
    $('launcher-backbar')?.addEventListener('click', handleClick);

    // 任何地方呼叫 switchTab()（例如課表提醒、教師手機遙控）都會離開首頁
    window.addEventListener('myclass:tabswitch', () => {
      if (S.mode !== 'cards') return;
      document.body.classList.remove('launcher-home');
      syncVisibility();
      renderBackbar();
    });

    window.addEventListener('languageChanged', () => {
      updateToggleButton();
      if (S.mode === 'cards') {
        if (isHome()) renderHome();
        else renderBackbar();
      }
      if (isPickerOpen()) renderPicker();
    });

    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && isPickerOpen()) closePicker(true);
    });

    // 作業掃描按鈕在確認是教師本機後才出現，出現時重繪卡片
    const hw = document.querySelector('.desktop-nav-tabs .nav-tab[data-tab="hwscan"]');
    if (hw && typeof MutationObserver !== 'undefined') {
      new MutationObserver(() => {
        if (S.mode !== 'cards') return;
        if (isHome()) renderHome();
        else renderBackbar();
        if (isPickerOpen()) renderPicker();
      }).observe(hw, { attributes: true, attributeFilter: ['hidden', 'style'] });
    }
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();

  window.MyClassLauncher = { setMode, showHome, openPicker };
})();
