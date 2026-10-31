// MyClass 教師端：通用對話框（提示、確認、輸入）、檔案選擇欄位、QR Code
// 由 static/js/app.js 拆出（2026-10-31，原第 5164–5589 行），程式內容未變更。
// 所有 static/js/app.js 與 static/js/app/*.js 共用同一個全域範圍（一般 <script>，不是模組），載入順序見 static/index.html。


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
    titleEl.style.marginBottom = '10px';
  } else {
    descEl.style.display = 'none';
    // 沒有說明文字時，標題和按鈕之間留出與說明相同的空間，避免擠在一起
    titleEl.style.marginBottom = '24px';
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
    titleEl.style.marginBottom = '10px';
  } else {
    descEl.style.display = 'none';
    // 沒有說明文字時，標題和按鈕之間留出與說明相同的空間，避免擠在一起
    titleEl.style.marginBottom = '24px';
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
