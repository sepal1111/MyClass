// 伺服器回報「仍在使用預設密碼字頭（Admin）」時，所有教師端 API 都會回 403 + PREFIX_CHANGE_REQUIRED。
// 主頁面彈出強制修改視窗；其他頁面（投影、手冊…）回主頁處理。
(function () {
  if (window.__prefixGuardInstalled) return;
  window.__prefixGuardInstalled = true;
  const rawFetch = window.fetch.bind(window);
  window.fetch = async function (...args) {
    const res = await rawFetch(...args);
    if (res.status === 403) {
      try {
        const body = await res.clone().json();
        if (body && body.code === 'PREFIX_CHANGE_REQUIRED') {
          if (typeof window.showForcePrefixModal === 'function') window.showForcePrefixModal();
          else if (window.location.pathname !== '/') window.location.href = '/';
        }
      } catch (e) { /* 非 JSON 回應，忽略 */ }
    }
    return res;
  };
})();

/* ==========================================================================
   國小課堂即時記錄系統 - API Client Module
   ========================================================================== */

// ---------------------------------------------------------------------------
// 帶驗證的檔案下載
//
// 原生的 <a href download> 只靠 cookie 驗證，而且是由瀏覽器的下載管理員另外發出請求：
// 自簽憑證（區網用 https://IP）或 cookie 失效時，會出現「失敗 - 網路錯誤」，檔名也變成網址最後一段
// （例如 students_excel）。改由頁面自己用 fetch（帶教師 token）取檔，再以 blob 觸發下載，
// 與報表匯出同一種做法。用法：在連結上加 data-auth-download="預設檔名.xlsx"，href 照常指向 API。
// ---------------------------------------------------------------------------
async function downloadAuthFile(url, fallbackName) {
  const headers = {};
  const token = localStorage.getItem('auth_token');
  if (token) headers['Authorization'] = `Bearer ${token}`;
  const res = await fetch(url, { headers, credentials: 'same-origin' });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ detail: res.statusText }));
    throw new Error(err.detail || '下載失敗');
  }
  // 優先使用伺服器給的檔名（Content-Disposition 的 filename*=UTF-8''…），沒有才用預設檔名
  let filename = fallbackName || 'download';
  const cd = res.headers.get('Content-Disposition') || '';
  const star = cd.match(/filename\*\s*=\s*UTF-8''([^;]+)/i);
  const plain = cd.match(/filename\s*=\s*"?([^";]+)"?/i);
  try {
    if (star) filename = decodeURIComponent(star[1].trim());
    else if (plain) filename = plain[1].trim();
  } catch (e) { /* 解碼失敗就用預設檔名 */ }

  const blob = await res.blob();
  const blobUrl = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.style.display = 'none';
  a.href = blobUrl;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  // 延遲清理，讓瀏覽器的下載執行緒有時間讀到檔名與副檔名
  setTimeout(() => {
    a.remove();
    URL.revokeObjectURL(blobUrl);
  }, 5000);
}
window.downloadAuthFile = downloadAuthFile;

document.addEventListener('click', (evt) => {
  const link = evt.target.closest && evt.target.closest('a[data-auth-download]');
  if (!link) return;
  evt.preventDefault();
  downloadAuthFile(link.getAttribute('href'), link.dataset.authDownload).catch((err) => {
    const msg = '下載失敗：' + (err && err.message ? err.message : err);
    if (typeof window.showToast === 'function') window.showToast(msg, 'error');
    else alert(msg);
  });
});

const API = {
  getHeaders(extraHeaders = {}) {
    const headers = { ...extraHeaders };
    const token = localStorage.getItem('auth_token');
    if (token) {
      headers['Authorization'] = `Bearer ${token}`;
    }
    return headers;
  },

  handleUnauthorized() {
    localStorage.removeItem('auth_token');
    localStorage.removeItem('auth_date');
    
    // If on standalone pages (projection, guide, or homework-scan), redirect to login
    const path = window.location.pathname;
    if (path.includes('/projection') || path.includes('/guide') || path.includes('/homework-scan')) {
      const target = window.location.pathname + window.location.search;
      window.location.href = `/?redirect=${encodeURIComponent(target)}`;
      return;
    }

    // If on main page, open auth overlay
    const authOverlay = document.getElementById('auth-overlay');
    if (authOverlay) {
      authOverlay.classList.add('open');
    }
  },

  async get(url) {
    const res = await fetch(url, {
      headers: this.getHeaders(),
      credentials: 'same-origin'
    });
    if (res.status === 401) {
      this.handleUnauthorized();
      const err = await res.json().catch(() => ({ detail: '未登入或身分驗證已逾期' }));
      throw new Error(err.detail || '未登入或身分驗證已逾期');
    }
    if (!res.ok) {
      const err = await res.json().catch(() => ({ detail: res.statusText }));
      throw new Error(err.detail || '請求失敗');
    }
    return res.json();
  },

  async post(url, data) {
    const res = await fetch(url, {
      method: 'POST',
      headers: this.getHeaders({ 'Content-Type': 'application/json' }),
      body: JSON.stringify(data),
      credentials: 'same-origin'
    });
    if (res.status === 401) {
      this.handleUnauthorized();
      const err = await res.json().catch(() => ({ detail: '未登入或身分驗證已逾期' }));
      throw new Error(err.detail || '未登入或身分驗證已逾期');
    }
    if (!res.ok) {
      const err = await res.json().catch(() => ({ detail: res.statusText }));
      throw new Error(err.detail || '請求失敗');
    }
    return res.json();
  },

  async postFormData(url, formData) {
    const res = await fetch(url, {
      method: 'POST',
      headers: this.getHeaders(),
      body: formData,
      credentials: 'same-origin'
    });
    if (res.status === 401) {
      this.handleUnauthorized();
      const err = await res.json().catch(() => ({ detail: '未登入或身分驗證已逾期' }));
      throw new Error(err.detail || '未登入或身分驗證已逾期');
    }
    if (!res.ok) {
      const err = await res.json().catch(() => ({ detail: res.statusText }));
      throw new Error(err.detail || '請求失敗');
    }
    return res.json();
  },

  async putFormData(url, formData) {
    const res = await fetch(url, {
      method: 'PUT',
      headers: this.getHeaders(),
      body: formData,
      credentials: 'same-origin'
    });
    if (res.status === 401) {
      this.handleUnauthorized();
      const err = await res.json().catch(() => ({ detail: '未登入或身分驗證已逾期' }));
      throw new Error(err.detail || '未登入或身分驗證已逾期');
    }
    if (!res.ok) {
      const err = await res.json().catch(() => ({ detail: res.statusText }));
      throw new Error(err.detail || '請求失敗');
    }
    return res.json();
  },

  async put(url, data) {
    const res = await fetch(url, {
      method: 'PUT',
      headers: this.getHeaders({ 'Content-Type': 'application/json' }),
      body: JSON.stringify(data),
      credentials: 'same-origin'
    });
    if (res.status === 401) {
      this.handleUnauthorized();
      const err = await res.json().catch(() => ({ detail: '未登入或身分驗證已逾期' }));
      throw new Error(err.detail || '未登入或身分驗證已逾期');
    }
    if (!res.ok) {
      const err = await res.json().catch(() => ({ detail: res.statusText }));
      throw new Error(err.detail || '請求失敗');
    }
    return res.json();
  },

  async delete(url, data = null) {
    const headers = this.getHeaders(data ? { 'Content-Type': 'application/json' } : {});
    const res = await fetch(url, {
      method: 'DELETE',
      headers,
      body: data ? JSON.stringify(data) : undefined,
      credentials: 'same-origin'
    });
    if (res.status === 401) {
      this.handleUnauthorized();
      const err = await res.json().catch(() => ({ detail: '未登入或身分驗證已逾期' }));
      throw new Error(err.detail || '未登入或身分驗證已逾期');
    }
    if (!res.ok) {
      const err = await res.json().catch(() => ({ detail: res.statusText }));
      throw new Error(err.detail || '刪除失敗');
    }
    return res.json();
  },

  async uploadFile(url, file) {
    const formData = new FormData();
    formData.append('file', file);
    const res = await fetch(url, {
      method: 'POST',
      headers: this.getHeaders(),
      body: formData,
      credentials: 'same-origin'
    });
    if (res.status === 401) {
      this.handleUnauthorized();
      const err = await res.json().catch(() => ({ detail: '未登入或身分驗證已逾期' }));
      throw new Error(err.detail || '未登入或身分驗證已逾期');
    }
    if (!res.ok) {
      const err = await res.json().catch(() => ({ detail: res.statusText }));
      throw new Error(err.detail || '檔案上傳失敗');
    }
    return res.json();
  }
};

