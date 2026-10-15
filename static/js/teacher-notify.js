/* ==========================================================================
   教師端「🔔 通知」：學生繳交作業、申請重新繳交、在作業／測驗發問時提醒老師。
   後端見 src/utils/notifications.ts（notifyTeacher）與 src/routes/teacherNotifications.ts。
   - 頁首鈴鐺顯示未讀數；有即時連線時立即更新並跳出提示，否則每 60 秒更新一次。
   - 點一則通知：標為已讀、必要時切換到該班級，並直接開啟那份作業的「繳交與評分」視窗。
   ========================================================================== */
(function () {
  const isEn = () => Boolean(window.I18n && window.I18n.getLanguage() === 'en');
  const T = (zh, en) => (isEn() ? en : zh);
  const esc = (s) =>
    String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  const ICON = { submission: '📤', resubmit_request: '🔁', question: '💬' };

  let items = [];
  let unread = 0;
  let wrap = null;
  let pollTimer = null;

  function injectStyle() {
    if (document.getElementById('teacher-notify-style')) return;
    const st = document.createElement('style');
    st.id = 'teacher-notify-style';
    st.textContent = `
      .tn-wrap { position: relative; display: inline-flex; }
      .tn-bell { position: relative; width: 38px; height: 38px; border-radius: 50%; border: 1px solid var(--card-border, #e2e8f0);
        background: var(--card-bg, #fff); font-size: 1.05rem; cursor: pointer; display: inline-flex; align-items: center; justify-content: center; }
      .tn-badge { position: absolute; top: -3px; right: -3px; min-width: 17px; height: 17px; padding: 0 4px; border-radius: 999px;
        background: #ef4444; color: #fff; font-size: 0.66rem; font-weight: 800; display: flex; align-items: center; justify-content: center; }
      .tn-panel { position: absolute; top: calc(100% + 8px); right: 0; width: 360px; max-width: 86vw; z-index: 1200;
        background: var(--card-bg, #fff); color: var(--text-main, #1e293b); border: 1px solid var(--card-border, #e2e8f0);
        border-radius: 12px; box-shadow: 0 12px 30px rgba(0,0,0,0.22); overflow: hidden; display: none; }
      .tn-panel.open { display: block; }
      .tn-head { display: flex; align-items: center; justify-content: space-between; gap: 8px; padding: 12px 14px;
        font-size: 0.88rem; font-weight: 800; border-bottom: 1px solid var(--card-border, #e2e8f0); }
      .tn-markall { border: none; background: none; color: var(--primary-light, #0284c7); font-size: 0.78rem; font-weight: 700; cursor: pointer; }
      .tn-list { max-height: min(60vh, 440px); overflow-y: auto; }
      .tn-item { display: block; width: 100%; text-align: left; border: none; border-bottom: 1px solid var(--card-border, #e2e8f0);
        background: transparent; padding: 10px 14px 10px 28px; cursor: pointer; position: relative; font-family: inherit; color: inherit; }
      .tn-item:last-child { border-bottom: none; }
      .tn-item:hover { background: rgba(2,132,199,0.08); }
      .tn-item.unread { background: rgba(2,132,199,0.06); }
      .tn-item.unread::before { content: ''; position: absolute; left: 12px; top: 17px; width: 8px; height: 8px; border-radius: 50%; background: #ef4444; }
      .tn-title { font-size: 0.86rem; font-weight: 700; line-height: 1.4; word-break: break-word; }
      .tn-item.read .tn-title { font-weight: 500; color: var(--text-muted, #64748b); }
      .tn-body { font-size: 0.78rem; color: var(--text-muted, #64748b); margin-top: 2px; line-height: 1.4;
        display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; word-break: break-word; }
      .tn-meta { font-size: 0.72rem; color: var(--text-muted, #64748b); margin-top: 4px; opacity: 0.9; }
      .tn-empty { padding: 26px 14px; text-align: center; font-size: 0.85rem; color: var(--text-muted, #64748b); }
    `;
    document.head.appendChild(st);
  }

  function build() {
    if (wrap) return;
    const anchor = document.getElementById('btn-toggle-lang');
    if (!anchor || !anchor.parentNode) return;
    injectStyle();
    wrap = document.createElement('div');
    wrap.className = 'tn-wrap';
    wrap.innerHTML = `
      <button type="button" class="tn-bell" id="tn-bell" title="${esc(T('通知', 'Notifications'))}">🔔<span class="tn-badge" id="tn-badge" hidden>0</span></button>
      <div class="tn-panel" id="tn-panel">
        <div class="tn-head"><span>🔔 ${esc(T('學生動態通知', 'Student activity'))}</span>
          <button type="button" class="tn-markall" id="tn-markall" hidden>${esc(T('全部標為已讀', 'Mark all read'))}</button></div>
        <div class="tn-list" id="tn-list"></div>
        <div class="tn-empty" id="tn-empty">🔕 ${esc(T('目前沒有通知', 'No notifications'))}</div>
      </div>`;
    anchor.parentNode.insertBefore(wrap, anchor);

    const panel = wrap.querySelector('#tn-panel');
    wrap.querySelector('#tn-bell').addEventListener('click', (e) => {
      e.stopPropagation();
      const willOpen = !panel.classList.contains('open');
      panel.classList.toggle('open');
      if (willOpen) refresh();
    });
    document.addEventListener('click', (e) => {
      if (!wrap.contains(e.target)) panel.classList.remove('open');
    });
    wrap.querySelector('#tn-list').addEventListener('click', (e) => {
      const btn = e.target.closest('.tn-item');
      if (btn) openItem(Number(btn.dataset.id));
    });
    wrap.querySelector('#tn-markall').addEventListener('click', async (e) => {
      e.stopPropagation();
      items.forEach((n) => { n.is_read = true; });
      unread = 0;
      render();
      try { await API.post('/api/teacher-notifications/read', { all: true }); } catch (err) { /* 靜默 */ }
    });
  }

  function fmtTime(createdAt) {
    if (!createdAt) return '';
    const d = new Date();
    const p = (n) => String(n).padStart(2, '0');
    const today = `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
    const [date, time = ''] = createdAt.split(' ');
    return date === today ? `${T('今天', 'Today')} ${time.slice(0, 5)}` : `${date.slice(5)} ${time.slice(0, 5)}`;
  }

  function render() {
    if (!wrap) return;
    const badge = wrap.querySelector('#tn-badge');
    badge.hidden = unread <= 0;
    badge.textContent = unread > 99 ? '99+' : String(unread);
    wrap.querySelector('#tn-empty').hidden = items.length > 0;
    wrap.querySelector('#tn-markall').hidden = unread <= 0;
    wrap.querySelector('#tn-list').innerHTML = items
      .map(
        (n) => `
        <button type="button" class="tn-item ${n.is_read ? 'read' : 'unread'}" data-id="${n.id}">
          <div class="tn-title">${ICON[n.type] || '🔔'} ${esc(n.title)}</div>
          ${n.body ? `<div class="tn-body">${esc(n.body)}</div>` : ''}
          <div class="tn-meta">${esc(n.course_name)}　${esc(fmtTime(n.created_at))}</div>
        </button>`
      )
      .join('');
  }

  async function refresh() {
    if (!wrap) return;
    try {
      const data = await API.get('/api/teacher-notifications');
      items = data.items || [];
      unread = data.unread_count || 0;
      render();
    } catch (e) {
      /* 通知是附帶功能：失敗時靜默略過 */
    }
  }

  async function openItem(id) {
    const n = items.find((x) => x.id === id);
    if (!n) return;
    if (!n.is_read) {
      n.is_read = true;
      unread = Math.max(0, unread - 1);
      render();
      API.post('/api/teacher-notifications/read', { ids: [id] }).catch(() => {});
    }
    wrap.querySelector('#tn-panel').classList.remove('open');

    // 切換到該班級（沿用班級下拉選單的既有 change 流程）
    const select = document.getElementById('course-select');
    const state = window.AppState;
    if (select && state && state.currentCourseId !== n.course_id) {
      select.value = String(n.course_id);
      select.dispatchEvent(new Event('change'));
      await sleep(400);
    }
    if (typeof window.switchTab === 'function') window.switchTab('materials');
    await sleep(150);
    if (window.LmsMaterials && n.unit_id && n.sub_unit_id) {
      await window.LmsMaterials.openGradingById(n.unit_id, n.sub_unit_id);
    }
  }

  window.TeacherNotify = {
    onAppReady() {
      build();
      refresh();
      if (!pollTimer) {
        pollTimer = setInterval(() => {
          if (document.visibilityState === 'visible') refresh();
        }, 60000);
        document.addEventListener('visibilitychange', () => {
          if (document.visibilityState === 'visible') refresh();
        });
      }
    },
    // realtime.js 收到 teacher_notification:new 時呼叫
    onNew(payload) {
      refresh();
      if (payload && payload.title && typeof window.showToast === 'function') window.showToast(`🔔 ${payload.title}`, 'info');
    },
    refresh,
  };
})();
