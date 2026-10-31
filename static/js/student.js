/* ==========================================================================
   學生課程入口 (Phase 2 LMS) — 帳號密碼登入 + 課程素材瀏覽
   ==========================================================================
   2026-10-31 拆分：原本整個檔案包在一個 (function () { ... })() 裡，
   現在拿掉外層包裝、依功能拆成 static/js/student/ 底下的檔案；這個檔案是核心，必須最先載入。
   student.js 與 static/js/student/*.js 共用頁面的全域範圍（一般 <script>），載入順序見 static/student.html。
   程式內容未變更（縮排保留原本包在函式裡的兩格，避免動到模板字串內容）。
   ========================================================================== */
  const TOKEN_KEY = 'student_token';
  // 剛用密碼登入時暫存在記憶體（不寫入儲存空間），強制改密碼時就不用再問一次目前的密碼
  let knownPassword = '';
  // 由「修改密碼」視窗的程式指定；forced=true 是第一次登入或被老師重設後的強制修改
  let openPasswordModal = () => {};
  const STUDENT_KEY = 'student_info';

  const loginView = document.getElementById('loginView');
  const contentView = document.getElementById('contentView');
  const loginError = document.getElementById('loginError');
  const accountLoginForm = document.getElementById('accountLoginForm');
  const unitsContainer = document.getElementById('unitsContainer');
  const emptyState = document.getElementById('emptyState');
  const btnContentTabMaterials = document.getElementById('btnContentTabMaterials');
  const btnContentTabFileCollect = document.getElementById('btnContentTabFileCollect');
  const btnContentTabQuizzes = document.getElementById('btnContentTabQuizzes');
  const btnContentTabScores = document.getElementById('btnContentTabScores');
  const btnContentTabLiveWall = document.getElementById('btnContentTabLiveWall');
  const btnContentTabWordCloud = document.getElementById('btnContentTabWordCloud');
  const btnContentTabKahoot = document.getElementById('btnContentTabKahoot');
  const btnContentTabLeader = document.getElementById('btnContentTabLeader');
  const materialsTabPane = document.getElementById('materialsTabPane');
  const fileCollectTabPane = document.getElementById('fileCollectTabPane');
  const quizzesTabPane = document.getElementById('quizzesTabPane');
  const scoresTabPane = document.getElementById('scoresTabPane');
  const liveWallTabPane = document.getElementById('liveWallTabPane');
  const wordCloudTabPane = document.getElementById('wordCloudTabPane');
  const kahootTabPane = document.getElementById('kahootTabPane');
  const leaderTabPane = document.getElementById('leaderTabPane');
  const scoreLogsList = document.getElementById('scoreLogsList');
  const scoreEmptyState = document.getElementById('scoreEmptyState');
  const topNavCourseBadge = document.getElementById('topNavCourseBadge');
  const studentChipAvatar = document.getElementById('studentChipAvatar');
  const studentChipName = document.getElementById('studentChipName');
  const heroGreeting = document.getElementById('heroGreeting');
  const myGroupCard = document.getElementById('myGroupCard');
  const notifBellBtn = document.getElementById('notifBellBtn');
  const notifDropdown = document.getElementById('notifDropdown');

  function showError(msg) {
    loginError.textContent = msg;
    loginError.style.display = 'block';
  }
  function clearError() {
    loginError.style.display = 'none';
  }

  // 密碼多次輸入錯誤後，伺服器會附上這個帳號的「密碼提醒」
  function showLoginHint(hint) {
    const box = document.getElementById('loginHintBox');
    if (!box) return;
    document.getElementById('loginHintText').textContent = hint || '';
    box.hidden = !hint;
  }

  async function api(path, opts) {
    opts = opts || {};
    const headers = Object.assign({ 'Content-Type': 'application/json' }, opts.headers || {});
    const token = localStorage.getItem(TOKEN_KEY);
    if (token) headers['Authorization'] = 'Bearer ' + token;
    const res = await fetch(path, Object.assign({}, opts, { headers }));
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      if (res.status === 403 && data.code === 'PASSWORD_CHANGE_REQUIRED') openPasswordModal(true);
      const err = new Error(data.detail || '發生錯誤，請稍後再試');
      err.data = data;
      throw err;
    }
    return data;
  }

  async function apiUpload(path, formData) {
    const headers = {};
    const token = localStorage.getItem(TOKEN_KEY);
    if (token) headers['Authorization'] = 'Bearer ' + token;
    const res = await fetch(path, { method: 'POST', headers, body: formData });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.detail || '發生錯誤，請稍後再試');
    return data;
  }

  /** 美化版 window.confirm() 取代方案：回傳 Promise<boolean>，語意與原生 confirm() 一致 */
  function showConfirmModal(options) {
    let opts = {};
    if (typeof options === 'string' || typeof options === 'number') {
      const lines = String(options).split('\n');
      opts = { title: lines[0] || '', desc: lines.slice(1).join('\n') };
    } else {
      opts = Object.assign({}, options);
    }

    let icon = opts.icon || '❓';
    let iconBg = 'rgba(123, 152, 224, 0.15)';
    let iconBorder = 'rgba(123, 152, 224, 0.4)';
    let okGradient = 'linear-gradient(135deg, #7b98e0, #4a67ba)';
    const textToCheck = (opts.title + ' ' + (opts.desc || '')).toLowerCase();
    if (opts.danger || textToCheck.includes('刪除') || textToCheck.includes('delete')) {
      icon = opts.icon || '🗑️';
      iconBg = 'rgba(217, 128, 126, 0.15)';
      iconBorder = 'rgba(217, 128, 126, 0.4)';
      okGradient = 'linear-gradient(135deg, #d9807e, #dc2626)';
    }

    const overlay = document.getElementById('modalStudentGenericConfirm');
    if (!overlay) return Promise.resolve(window.confirm(opts.title + (opts.desc ? '\n' + opts.desc : '')));

    const iconWrap = document.getElementById('studentGenericConfirmIconWrap');
    const iconEl = document.getElementById('studentGenericConfirmIcon');
    const titleEl = document.getElementById('studentGenericConfirmTitle');
    const descEl = document.getElementById('studentGenericConfirmDesc');
    const btnCancel = document.getElementById('btnStudentGenericConfirmCancel');
    const btnOk = document.getElementById('btnStudentGenericConfirmOk');

    iconWrap.style.background = iconBg;
    iconWrap.style.border = `2px solid ${iconBorder}`;
    iconEl.textContent = icon;
    titleEl.textContent = opts.title || '';
    if (opts.desc) {
      descEl.textContent = opts.desc;
      descEl.style.display = 'block';
    } else {
      descEl.style.display = 'none';
    }
    btnCancel.textContent = opts.cancelText || '取消';
    btnOk.textContent = opts.confirmText || '確定';
    btnOk.style.background = okGradient;

    return new Promise((resolve) => {
      let settled = false;
      function cleanup(result) {
        if (settled) return;
        settled = true;
        overlay.style.display = 'none';
        btnCancel.removeEventListener('click', onCancel);
        btnOk.removeEventListener('click', onOk);
        resolve(result);
      }
      function onCancel() { cleanup(false); }
      function onOk() { cleanup(true); }
      btnCancel.addEventListener('click', onCancel);
      btnOk.addEventListener('click', onOk);
      overlay.style.display = 'flex';
    });
  }

  /** 美化版 window.prompt() 取代方案：回傳 Promise<string|null>，語意與原生 prompt() 一致 */
  function showPromptModal(options) {
    let opts = typeof options === 'string' ? { title: options } : Object.assign({}, options);
    opts.defaultValue = opts.defaultValue !== undefined ? String(opts.defaultValue) : '';

    const overlay = document.getElementById('modalStudentGenericPrompt');
    if (!overlay) return Promise.resolve(window.prompt(opts.title || '', opts.defaultValue));

    const iconEl = document.getElementById('studentGenericPromptIcon');
    const titleEl = document.getElementById('studentGenericPromptTitle');
    const descEl = document.getElementById('studentGenericPromptDesc');
    const inputEl = document.getElementById('studentGenericPromptInput');
    const btnCancel = document.getElementById('btnStudentGenericPromptCancel');
    const btnOk = document.getElementById('btnStudentGenericPromptOk');

    iconEl.textContent = opts.icon || '✏️';
    titleEl.textContent = opts.title || '';
    if (opts.desc) {
      descEl.textContent = opts.desc;
      descEl.style.display = 'block';
    } else {
      descEl.style.display = 'none';
    }
    inputEl.value = opts.defaultValue;
    inputEl.placeholder = opts.placeholder || '';
    btnCancel.textContent = opts.cancelText || '取消';
    btnOk.textContent = opts.confirmText || '確定';

    return new Promise((resolve) => {
      let settled = false;
      function cleanup(result) {
        if (settled) return;
        settled = true;
        overlay.style.display = 'none';
        btnCancel.removeEventListener('click', onCancel);
        btnOk.removeEventListener('click', onOk);
        inputEl.removeEventListener('keydown', onKeydown);
        resolve(result);
      }
      function onCancel() { cleanup(null); }
      function onOk() { cleanup(inputEl.value); }
      function onKeydown(e) {
        if (e.key === 'Enter') { e.preventDefault(); onOk(); }
        else if (e.key === 'Escape') { onCancel(); }
      }
      btnCancel.addEventListener('click', onCancel);
      btnOk.addEventListener('click', onOk);
      inputEl.addEventListener('keydown', onKeydown);
      overlay.style.display = 'flex';
      setTimeout(() => { inputEl.focus(); inputEl.select(); }, 50);
    });
  }

  function showToast(message, type) {
    const stack = document.getElementById('toastStack');
    if (!stack) return;
    const item = document.createElement('div');
    item.className = 'toast-item' + (type ? ' ' + type : '');
    item.textContent = message;
    stack.appendChild(item);
    requestAnimationFrame(() => item.classList.add('show'));
    setTimeout(() => {
      item.classList.remove('show');
      setTimeout(() => item.remove(), 300);
    }, 3000);
  }

  // filename（選填）：另存/下載時要用的檔名（例如素材標題、作業繳交時的原始檔名），
  // 對應 /uploads/* 路由的 ?name= 支援（見 src/index.ts），磁碟上存的是防碰撞用的亂數檔名，
  // 不帶這個參數的話下載出來的檔案名稱會是那串亂碼。
  function fileUrlWithToken(url, filename) {
    if (!url || typeof url !== 'string' || url.startsWith('data:')) return url || '';
    const token = localStorage.getItem(TOKEN_KEY);
    let result = url;
    if (token) result += (result.includes('?') ? '&' : '?') + 'token=' + encodeURIComponent(token);
    if (filename) result += (result.includes('?') ? '&' : '?') + 'name=' + encodeURIComponent(filename);
    return result;
  }

  function getCardPlaceholderSvg(score, label) {
    const s = Number(score || 0);
    const isPos = s >= 0;
    const bgGrad1 = isPos ? '#3b82f6' : '#e11d48';
    const bgGrad2 = isPos ? '#1d4ed8' : '#9f1239';
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 400 560" width="400" height="560">
      <defs>
        <linearGradient id="cardBg" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stop-color="${bgGrad1}" />
          <stop offset="100%" stop-color="${bgGrad2}" />
        </linearGradient>
      </defs>
      <rect width="400" height="560" rx="28" fill="url(#cardBg)" />
      <rect x="16" y="16" width="368" height="528" rx="20" fill="none" stroke="rgba(255,255,255,0.3)" stroke-width="2" stroke-dasharray="6 4" />
      <circle cx="200" cy="220" r="72" fill="rgba(255,255,255,0.18)" />
      <text x="200" y="242" font-family="system-ui, -apple-system, sans-serif" font-size="64" font-weight="900" fill="#ffffff" text-anchor="middle">${isPos ? '+' : ''}${s}</text>
      <text x="200" y="340" font-family="system-ui, -apple-system, sans-serif" font-size="28" font-weight="800" fill="#ffffff" text-anchor="middle">${(label || '點數卡').substring(0, 12)}</text>
      <text x="200" y="380" font-family="system-ui, -apple-system, sans-serif" font-size="16" font-weight="600" fill="rgba(255,255,255,0.8)" text-anchor="middle">✨ 點數卡</text>
    </svg>`;
    return 'data:image/svg+xml;utf8,' + encodeURIComponent(svg);
  }

  function getGiftPlaceholderSvg(emoji = '🎁') {
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100" width="100" height="100">
      <rect width="100" height="100" rx="16" fill="#f1f5f9" />
      <text x="50" y="62" font-size="44" text-anchor="middle">${emoji}</text>
    </svg>`;
    return 'data:image/svg+xml;utf8,' + encodeURIComponent(svg);
  }

  function saveSession(token, student) {
    localStorage.setItem(TOKEN_KEY, token);
    localStorage.setItem(STUDENT_KEY, JSON.stringify(student));
  }
  function clearSession() {
    localStorage.removeItem(TOKEN_KEY);
    localStorage.removeItem(STUDENT_KEY);
  }

  // 登出／session 失效時的共用出口：這個頁面現在一律是被 index.html 用同源 iframe 嵌入顯示
  // （見 static/js/app/auth.js 的 enterStudentMode()），所以清完 session 後要請「外層」頁面把 iframe
  // 收起來、回到登入畫面，而不是自己 reload（reload 只會讓 iframe 裡面重新顯示這支檔案自帶的
  // 登入表單，使用者會卡在一個「巢狀」畫面裡出不去）。同源 iframe 可以直接呼叫 parent 上的函式。
  // 保留 location.reload() 這條路是為了「萬一」此檔案未來又被直接開啟（不在 iframe 裡）時還能動作。
  function exitToLogin() {
    clearSession();
    if (window.parent && window.parent !== window && typeof window.parent.exitStudentMode === 'function') {
      window.parent.exitStudentMode();
    } else {
      location.reload();
    }
  }

  function youtubeEmbedUrl(url) {
    const patterns = [
      /(?:youtube\.com\/watch\?v=|youtu\.be\/|youtube\.com\/embed\/)([\w-]{6,})/
    ];
    for (const p of patterns) {
      const m = url.match(p);
      if (m) return `https://www.youtube.com/embed/${m[1]}`;
    }
    return null;
  }
