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

