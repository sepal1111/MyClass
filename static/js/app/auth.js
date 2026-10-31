// MyClass 教師端：教師登入、學生模式、修改／重設密碼字頭、登出
// 由 static/js/app.js 拆出（2026-10-31，原第 320–632 行），程式內容未變更。
// 所有 static/js/app.js 與 static/js/app/*.js 共用同一個全域範圍（一般 <script>，不是模組），載入順序見 static/index.html。


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
