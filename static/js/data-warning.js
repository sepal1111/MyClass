/* ==========================================================================
   資料外洩風險警語（教師首頁橫幅）
   登入後在首頁顯示；按「今天不再顯示」只隱藏到當天結束，隔天會再出現。
   完整說明在 設定 ➔ 密碼與連線 的「資料安全提醒」卡片。
   ========================================================================== */
(function () {
  const KEY = 'data_risk_notice_dismissed_on';

  function today() {
    const d = new Date();
    const p = (n) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
  }

  function dismissedToday() {
    try {
      return localStorage.getItem(KEY) === today();
    } catch (e) {
      return false; // 無痕視窗等取不到儲存空間時，每次都顯示
    }
  }

  function update() {
    const box = document.getElementById('data-risk-notice');
    if (!box) return;
    // 登入畫面（auth-overlay）還開著時不顯示橫幅，登入畫面本身已有警語
    const overlay = document.getElementById('auth-overlay');
    const loggedIn = !(overlay && overlay.classList.contains('open'));
    const show = loggedIn && !dismissedToday();
    box.hidden = !show;
    box.style.display = show ? 'block' : 'none';
  }

  document.addEventListener('DOMContentLoaded', () => {
    const dismiss = document.getElementById('btn-data-risk-dismiss');
    if (dismiss) {
      dismiss.addEventListener('click', () => {
        try { localStorage.setItem(KEY, today()); } catch (e) { /* 忽略 */ }
        update();
      });
    }
    const detail = document.getElementById('btn-data-risk-detail');
    if (detail) {
      detail.addEventListener('click', () => {
        if (typeof window.switchTab === 'function') window.switchTab('security');
        const card = document.getElementById('data-risk-card');
        if (card) setTimeout(() => card.scrollIntoView({ behavior: 'smooth', block: 'start' }), 150);
      });
    }
    update();
    // 登入完成／登出時 auth-overlay 的 class 會改變，跟著更新橫幅
    const overlay = document.getElementById('auth-overlay');
    if (overlay && window.MutationObserver) {
      new MutationObserver(update).observe(overlay, { attributes: true, attributeFilter: ['class'] });
    }
  });
})();
