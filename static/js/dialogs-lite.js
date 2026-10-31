/* ==========================================================================
   MyClass 獨立對話框（給沒有載入教師主頁面 app/dialogs.js 的小頁面使用：
   教師手機頁 mobile.html、作業掃描小視窗 homework-scan.html）。
   外觀比照教師主頁面的確認框；自帶樣式與畫面元素，不依賴其他檔案。
   提供與 app/dialogs.js 相同的介面：
     showConfirmModal(文字或 { title, desc, icon, danger, confirmText, cancelText }) → Promise<boolean>
     showAlertModal(文字或 { title, desc, icon, type: 'success'|'error'|'warning'|'info', confirmText }) → Promise<void>
     showPromptModal(文字或 { title, desc, icon, placeholder, defaultValue, confirmText, cancelText, hideCancel }) → Promise<string|null>
     （hideCancel: true 只留一顆按鈕，用於只顯示內容、讓人手動複製的情況）
   並把原生 window.alert() 換成 showAlertModal（不擋住程式執行）。
   ========================================================================== */
(function (window, document) {
  'use strict';
  if (window.__myclassDialogsLite) return;
  window.__myclassDialogsLite = true;

  const CSS = `
.mcd-overlay { position: fixed; inset: 0; z-index: 2147483000; display: flex; align-items: center; justify-content: center;
  padding: 16px; background: rgba(15, 23, 42, 0.45); -webkit-backdrop-filter: blur(4px); backdrop-filter: blur(4px);
  opacity: 0; transition: opacity .18s ease; font-family: inherit; }
.mcd-overlay.mcd-open { opacity: 1; }
.mcd-card { width: 100%; max-width: 420px; box-sizing: border-box; text-align: center; padding: 30px 24px 24px;
  background: #ffffff; color: #1e293b; border-radius: 20px; box-shadow: 0 20px 50px rgba(15, 23, 42, 0.35);
  transform: translateY(8px) scale(.97); transition: transform .18s ease; }
.mcd-overlay.mcd-open .mcd-card { transform: none; }
.mcd-icon { width: 64px; height: 64px; margin: 0 auto 14px; border-radius: 50%; display: flex; align-items: center;
  justify-content: center; font-size: 1.9rem; line-height: 1; }
.mcd-title { margin: 0 0 22px; font-size: 1.2rem; font-weight: 800; line-height: 1.45; word-break: break-word; }
.mcd-title.mcd-has-desc { margin-bottom: 8px; }
.mcd-desc { margin: 0 0 22px; color: #64748b; font-size: .93rem; line-height: 1.6; white-space: pre-line; word-break: break-word; }
.mcd-input { display: block; width: 100%; box-sizing: border-box; margin: 0 0 20px; padding: 11px 14px; font: inherit; font-size: 1rem;
  text-align: center; color: inherit; background: #ffffff; border: 1.5px solid #cbd5e1; border-radius: 10px; outline: none; }
.mcd-input:focus { border-color: #7b98e0; box-shadow: 0 0 0 3px rgba(123, 152, 224, .25); }
.mcd-actions { display: flex; gap: 12px; }
.mcd-btn { flex: 1; min-height: 46px; padding: 0 12px; font: inherit; font-size: 1rem; font-weight: 800; border-radius: 12px;
  cursor: pointer; border: 1.5px solid transparent; transition: filter .15s ease, transform .1s ease; }
.mcd-btn:active { transform: scale(.98); }
.mcd-btn:focus-visible { outline: 3px solid rgba(123, 152, 224, .5); outline-offset: 2px; }
.mcd-cancel { background: #ffffff; color: #475569; border-color: #e2e8f0; font-weight: 700; }
.mcd-cancel:hover { background: #f8fafc; }
.mcd-ok { color: #ffffff; }
.mcd-ok:hover { filter: brightness(1.06); }
@media (prefers-color-scheme: dark) {
  .mcd-card { background: #1e293b; color: #e2e8f0; box-shadow: 0 20px 50px rgba(0, 0, 0, .6); }
  .mcd-desc { color: #94a3b8; }
  .mcd-input { background: #0f172a; border-color: #334155; }
  .mcd-cancel { background: #0f172a; color: #cbd5e1; border-color: #334155; }
  .mcd-cancel:hover { background: #172033; }
}
@media (prefers-reduced-motion: reduce) { .mcd-overlay, .mcd-card { transition: none; } }`;

  // 與教師主頁面相同的配色：一般（藍）、危險（紅）、成功（綠）、提醒（橘）
  const THEMES = {
    info: { icon: '❓', bg: 'rgba(123, 152, 224, 0.15)', border: 'rgba(123, 152, 224, 0.4)', btn: 'linear-gradient(135deg, #7b98e0, #4a67ba)' },
    danger: { icon: '🗑️', bg: 'rgba(217, 128, 126, 0.15)', border: 'rgba(217, 128, 126, 0.4)', btn: 'linear-gradient(135deg, #d9807e, #dc2626)' },
    success: { icon: '✅', bg: 'rgba(79, 174, 130, 0.15)', border: 'rgba(79, 174, 130, 0.4)', btn: 'linear-gradient(135deg, #4fae82, #059669)' },
    warning: { icon: '⚠️', bg: 'rgba(211, 162, 76, 0.15)', border: 'rgba(211, 162, 76, 0.4)', btn: 'linear-gradient(135deg, #d3a24c, #d97706)' },
  };

  function injectStyle() {
    if (document.getElementById('mcd-style')) return;
    const style = document.createElement('style');
    style.id = 'mcd-style';
    style.textContent = CSS;
    (document.head || document.documentElement).appendChild(style);
  }

  function normalize(options) {
    if (options == null) return { title: '' };
    if (typeof options === 'string' || typeof options === 'number') {
      const lines = String(options).split('\n');
      return { title: lines[0] || '', desc: lines.slice(1).join('\n').trim() };
    }
    return Object.assign({}, options);
  }

  // 一次只顯示一個對話框，其他的依序排隊
  let queue = Promise.resolve();

  function open(kind, options) {
    const run = () => new Promise((resolve) => {
      injectStyle();
      const opts = normalize(options);
      const text = (opts.title || '') + ' ' + (opts.desc || '');
      let themeName = 'info';
      if (kind === 'alert') {
        themeName = { error: 'danger', success: 'success', warning: 'warning' }[opts.type] || 'info';
      } else if (opts.danger || /刪除|移除|清空|撤銷|delete|remove/i.test(text)) {
        themeName = 'danger';
      }
      const theme = THEMES[themeName];
      const defaultIcon = kind === 'prompt' ? '✏️' : kind === 'alert' && themeName === 'info' ? '💬' : theme.icon;

      const overlay = document.createElement('div');
      overlay.className = 'mcd-overlay';
      overlay.setAttribute('role', kind === 'alert' ? 'alertdialog' : 'dialog');
      overlay.setAttribute('aria-modal', 'true');
      const card = document.createElement('div');
      card.className = 'mcd-card';
      overlay.appendChild(card);

      const icon = document.createElement('div');
      icon.className = 'mcd-icon';
      icon.style.background = theme.bg;
      icon.style.border = `2px solid ${theme.border}`;
      icon.textContent = opts.icon || defaultIcon;
      card.appendChild(icon);

      const title = document.createElement('h3');
      title.className = 'mcd-title';
      title.textContent = opts.title || '';
      title.id = 'mcd-title-' + Date.now();
      overlay.setAttribute('aria-labelledby', title.id);
      card.appendChild(title);
      if (opts.desc) {
        title.classList.add('mcd-has-desc');
        const desc = document.createElement('p');
        desc.className = 'mcd-desc';
        desc.textContent = opts.desc;
        card.appendChild(desc);
      }

      let input = null;
      if (kind === 'prompt') {
        input = document.createElement('input');
        input.className = 'mcd-input';
        input.type = 'text';
        input.placeholder = opts.placeholder || '';
        input.value = opts.defaultValue != null ? String(opts.defaultValue) : '';
        card.appendChild(input);
      }

      const actions = document.createElement('div');
      actions.className = 'mcd-actions';
      let cancelBtn = null;
      if (kind !== 'alert' && !opts.hideCancel) {
        cancelBtn = document.createElement('button');
        cancelBtn.type = 'button';
        cancelBtn.className = 'mcd-btn mcd-cancel';
        cancelBtn.textContent = opts.cancelText || '取消';
        actions.appendChild(cancelBtn);
      }
      const okBtn = document.createElement('button');
      okBtn.type = 'button';
      okBtn.className = 'mcd-btn mcd-ok';
      okBtn.style.background = theme.btn;
      okBtn.textContent = opts.confirmText || (kind === 'alert' ? '知道了' : '確定');
      actions.appendChild(okBtn);
      card.appendChild(actions);

      const previousFocus = document.activeElement;
      let done = false;
      function finish(ok) {
        if (done) return;
        done = true;
        document.removeEventListener('keydown', onKey, true);
        overlay.classList.remove('mcd-open');
        setTimeout(() => overlay.remove(), 180);
        if (previousFocus && typeof previousFocus.focus === 'function') {
          try { previousFocus.focus(); } catch (_) { /* 忽略 */ }
        }
        if (kind === 'confirm') resolve(ok);
        else if (kind === 'prompt') resolve(ok ? input.value : null);
        else resolve();
      }
      function onKey(e) {
        if (e.key === 'Escape') { e.preventDefault(); finish(false); }
        else if (e.key === 'Enter' && (kind !== 'prompt' || e.target === input)) { e.preventDefault(); finish(true); }
        else if (e.key === 'Tab') {
          // 讓 Tab 只在對話框裡循環
          const items = [input, cancelBtn, okBtn].filter(Boolean);
          const i = items.indexOf(document.activeElement);
          e.preventDefault();
          items[(i + (e.shiftKey ? -1 : 1) + items.length) % items.length].focus();
        }
      }
      okBtn.addEventListener('click', () => finish(true));
      if (cancelBtn) cancelBtn.addEventListener('click', () => finish(false));
      overlay.addEventListener('click', (e) => { if (e.target === overlay) finish(false); });
      document.addEventListener('keydown', onKey, true);

      (document.body || document.documentElement).appendChild(overlay);
      requestAnimationFrame(() => overlay.classList.add('mcd-open'));
      setTimeout(() => {
        if (input) { input.focus(); input.select(); } else okBtn.focus();
      }, 30);
    });
    const result = queue.then(run, run);
    queue = result.catch(() => undefined);
    return result;
  }

  if (typeof window.showConfirmModal !== 'function') window.showConfirmModal = (o) => open('confirm', o);
  if (typeof window.showAlertModal !== 'function') window.showAlertModal = (o) => open('alert', o);
  if (typeof window.showPromptModal !== 'function') window.showPromptModal = (o) => open('prompt', o);
  // 原生 alert 換成美化版：只用來顯示訊息，回傳值本來就沒有人用
  window.alert = (message) => { window.showAlertModal(message == null ? '' : String(message)); };
})(window, document);
