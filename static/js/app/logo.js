// MyClass 教師端：自訂系統 Logo
// 由 static/js/app.js 拆出（2026-10-31，原第 7512–7571 行），程式內容未變更。
// 所有 static/js/app.js 與 static/js/app/*.js 共用同一個全域範圍（一般 <script>，不是模組），載入順序見 static/index.html。


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
