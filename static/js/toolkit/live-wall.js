// 課堂工具箱：即時互動牆
// 由 static/js/toolkit.js 拆出（2026-10-30），程式內容未變更。載入順序見 static/index.html；
// 模組之間透過 window.ToolkitModules 取用彼此（toolkit/common.js 建立）。
(function (window) {
  'use strict';
  const TK = window.ToolkitModules;

  // =========================================================================
  // 4.5 即時互動牆 (Live Wall)：開一個限時場次，學生每人限交一則文字/手繪/拍照貼文，
  // 教師端這裡與大螢幕投影（static/js/projection.js）即時同步呈現。
  // =========================================================================
  function livewallEscapeHtml(s) {
    const d = document.createElement('div');
    d.textContent = s == null ? '' : String(s);
    return d.innerHTML;
  }

  function livewallT(key, params) {
    return window.I18n ? window.I18n.t(key, params) : key;
  }

  function livewallModeLabel(mode) {
    const keyMap = { text: 'livewall_mode_text', drawing: 'livewall_mode_drawing', photo: 'livewall_mode_photo' };
    return keyMap[mode] ? livewallT(keyMap[mode]) : mode;
  }

  function livewallSeatLine(studentNumber, studentName) {
    return `${livewallT('livewall_seat_number', { num: studentNumber })} ${livewallEscapeHtml(studentName)}`;
  }

  const LiveWall = {
    currentSession: null,
    heartbeatTimer: null,

    init() {
      document.getElementById('btn-livewall-start')?.addEventListener('click', () => this.start());
      document.getElementById('btn-livewall-clear')?.addEventListener('click', () => this.clear());
      document.getElementById('btn-livewall-end')?.addEventListener('click', () => this.end());
      document.getElementById('btn-livewall-history')?.addEventListener('click', () => this.openHistory());
    },

    onEnterLiveWallTab() {
      this.refresh();
    },

    // 教師離開互動牆分頁或關閉視窗時自動結束進行中的場次
    async onLeaveLiveWallTab(options = {}) {
      this.stopHeartbeat();
      if (!this.currentSession || !this.currentSession.id) return;
      const sessionId = this.currentSession.id;
      this.currentSession = null;

      const token = localStorage.getItem('auth_token') || '';
      const closeUrl = `/api/live-wall/sessions/${sessionId}/close?token=${encodeURIComponent(token)}`;

      if (options.isUnload) {
        try {
          if (navigator.sendBeacon) {
            const blob = new Blob([JSON.stringify({})], { type: 'application/json' });
            navigator.sendBeacon(closeUrl, blob);
          } else {
            fetch(closeUrl, {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
                ...(token ? { 'Authorization': `Bearer ${token}` } : {})
              },
              body: JSON.stringify({}),
              keepalive: true,
              credentials: 'same-origin'
            }).catch(() => {});
          }
        } catch (e) {
          console.warn('[LiveWall] Unload close failed:', e);
        }
      } else {
        try {
          await API.post(closeUrl, {});
          window.showToast && window.showToast(livewallT('livewall_toast_auto_ended') || '已離開互動牆，場次已自動結束', 'info');
          await this.refresh();
        } catch (err) {
          console.warn('[LiveWall] Auto close on leave failed:', err);
        }
      }
    },

    startHeartbeat() {
      this.stopHeartbeat();
      if (!this.currentSession?.id) return;
      const sendPing = () => {
        if (!this.currentSession?.id) {
          this.stopHeartbeat();
          return;
        }
        API.post(`/api/live-wall/sessions/${this.currentSession.id}/heartbeat`, {}).catch(() => {});
      };
      this.heartbeatTimer = setInterval(sendPing, 15000);
    },

    stopHeartbeat() {
      if (this.heartbeatTimer) {
        clearInterval(this.heartbeatTimer);
        this.heartbeatTimer = null;
      }
    },

    async refresh() {
      const courseId = window.AppState && window.AppState.currentCourseId;
      if (!courseId) return;
      try {
        const data = await API.get(`/api/live-wall/courses/${courseId}/active`);
        this.currentSession = data.session;
        this.render(data.session, data.posts || []);
      } catch (err) {
        console.error('LiveWall.refresh error:', err);
      }
    },

    render(session, posts) {
      const startForm = document.getElementById('livewall-start-form');
      const activeView = document.getElementById('livewall-active-view');
      if (startForm) startForm.style.display = session ? 'none' : 'block';
      if (activeView) activeView.style.display = session ? 'block' : 'none';
      if (!session) {
        this.stopHeartbeat();
        return;
      }
      this.startHeartbeat();

      const statusMeta = document.getElementById('livewall-status-meta');
      if (statusMeta) {
        statusMeta.textContent =
          livewallT('livewall_status_meta_base', {
            mode: livewallModeLabel(session.mode),
            visibility: livewallT(session.show_names ? 'livewall_named' : 'livewall_anonymous'),
            count: posts.length
          }) +
          (session.title ? livewallT('livewall_status_meta_prompt_suffix', { title: session.title }) : '');
      }

      const grid = document.getElementById('livewall-posts-grid');
      const empty = document.getElementById('livewall-posts-empty');
      if (!grid) return;
      grid.innerHTML = '';
      if (empty) empty.style.display = posts.length ? 'none' : 'block';
      const postAlt = livewallT('livewall_post_alt');
      posts.forEach((p) => {
        const card = document.createElement('div');
        card.className = 'glass-card';
        card.style.cssText = 'padding:12px; display:flex; flex-direction:column; gap:8px;';
        const nameLine = livewallSeatLine(p.student_number, p.student_name);
        if (p.image_url) {
          card.innerHTML = `
            <img src="${p.image_url}" style="width:100%; border-radius:var(--radius-md); object-fit:cover; max-height:200px; cursor:zoom-in;" alt="${postAlt}">
            <div style="font-size:0.82rem; color:var(--text-muted); font-weight:700;">${nameLine}</div>
          `;
          // 改為彈出視窗放大檢視（可縮放/平移），取代原本開新分頁的做法，見 static/js/image-lightbox.js。
          card.querySelector('img').addEventListener('click', () => {
            window.ImageLightbox && window.ImageLightbox.open(p.image_url);
          });
        } else {
          card.innerHTML = `
            <div style="white-space:pre-wrap; font-size:0.92rem;">${livewallEscapeHtml(p.text_content || '')}</div>
            <div style="font-size:0.82rem; color:var(--text-muted); font-weight:700;">${nameLine}</div>
          `;
        }
        // 進行中場次的即時看板一律唯讀——刪除紀錄的功能移到「📜 歷史紀錄」彈窗管理，不放在這裡。
        grid.appendChild(card);
      });
    },

    async start() {
      const courseId = window.AppState && window.AppState.currentCourseId;
      if (!courseId) { window.ensureCourseSelected && window.ensureCourseSelected(); return; }
      const mode = document.querySelector('input[name="livewall-mode"]:checked').value;
      const title = document.getElementById('livewall-title-input').value.trim();
      const showNames = document.getElementById('livewall-show-names').checked;
      try {
        await API.post(`/api/live-wall/courses/${courseId}/start`, { mode, title, show_names: showNames });
        document.getElementById('livewall-title-input').value = '';
        window.showToast && window.showToast(livewallT('livewall_toast_started'), 'success');
        await this.refresh();
      } catch (err) {
        window.showToast && window.showToast(err.message, 'error');
      }
    },

    async clear() {
      if (!this.currentSession) return;
      if (!(await window.showConfirmModal(livewallT('livewall_clear_confirm')))) return;
      try {
        await API.post(`/api/live-wall/sessions/${this.currentSession.id}/clear`);
        window.showToast && window.showToast(livewallT('livewall_toast_cleared'), 'success');
        await this.refresh();
      } catch (err) {
        window.showToast && window.showToast(err.message, 'error');
      }
    },

    async end() {
      if (!this.currentSession) return;
      if (!(await window.showConfirmModal(livewallT('livewall_end_confirm')))) return;
      const sessionId = this.currentSession.id;
      this.stopHeartbeat();
      this.currentSession = null;
      try {
        await API.post(`/api/live-wall/sessions/${sessionId}/close`);
        window.showToast && window.showToast(livewallT('livewall_toast_ended'), 'success');
        await this.refresh();
      } catch (err) {
        window.showToast && window.showToast(err.message, 'error');
      }
    },

    // --- 歷史紀錄（教師端）：該課程所有場次、所有學生的完整上傳紀錄，與「進行中場次」的
    // 即時看板分開——刪除紀錄的管理動作只在這裡進行，不影響/不出現在進行中場次的唯讀看板。

    async openHistory() {
      const courseId = window.AppState && window.AppState.currentCourseId;
      if (!courseId) { window.ensureCourseSelected && window.ensureCourseSelected(); return; }
      await this.loadHistory();
      window.openModal && window.openModal('modal-livewall-history');
    },

    async loadHistory() {
      const courseId = window.AppState && window.AppState.currentCourseId;
      if (!courseId) return;
      try {
        const posts = await API.get(`/api/live-wall/courses/${courseId}/history`);
        this.renderHistory(posts);
      } catch (err) {
        window.showToast && window.showToast(err.message, 'error');
      }
    },

    // 依場次分組呈現為「日期－活動名稱（N 則）」的可展開分類，點開才顯示該場次所有學生的
    // 送出內容——避免全部紀錄攤平成一長串列表不好找。groups 為後端回傳的 [{session, posts}]。
    renderHistory(groups) {
      const list = document.getElementById('livewall-history-list');
      const empty = document.getElementById('livewall-history-empty');
      if (!list) return;
      list.innerHTML = '';
      if (empty) empty.style.display = groups.length ? 'none' : 'block';

      groups.forEach((group) => {
        const { session, posts } = group;
        const dateLabel = (session.created_at || '').split(' ')[0];
        const activityName = session.title || livewallModeLabel(session.mode);
        const countSuffix = livewallT('livewall_history_count_suffix', { count: posts.length });

        const wrap = document.createElement('div');
        wrap.style.cssText = 'border:1px solid var(--card-border); border-radius:var(--radius-md); overflow:hidden;';

        const header = document.createElement('button');
        header.type = 'button';
        header.style.cssText = 'width:100%; display:flex; align-items:center; justify-content:space-between; gap:8px; padding:12px 14px; background:var(--nav-bg); border:none; cursor:pointer; text-align:left; font-weight:700; font-size:0.92rem; color:var(--text-main);';
        header.innerHTML = `
          <span>📅 ${livewallEscapeHtml(dateLabel)}－${livewallEscapeHtml(activityName)}<span style="font-weight:400; color:var(--text-muted); margin-left:6px;">${livewallEscapeHtml(countSuffix)}</span></span>
          <span class="livewall-history-toggle-icon">▶</span>
        `;

        const body = document.createElement('div');
        body.style.cssText = 'padding:10px; display:flex; flex-direction:column; gap:8px;';
        body.hidden = true;
        posts.forEach((p) => body.appendChild(this.renderHistoryPostRow(p)));

        header.addEventListener('click', () => {
          body.hidden = !body.hidden;
          header.querySelector('.livewall-history-toggle-icon').textContent = body.hidden ? '▶' : '▼';
        });

        wrap.appendChild(header);
        wrap.appendChild(body);
        list.appendChild(wrap);
      });
    },

    renderHistoryPostRow(p) {
      const row = document.createElement('div');
      row.className = 'glass-card';
      row.style.cssText = 'padding:10px 12px; display:flex; align-items:center; gap:12px;';
      const postAlt = livewallT('livewall_post_alt');
      const thumb = p.image_url
        ? `<img src="${p.image_url}" style="width:56px; height:56px; object-fit:cover; border-radius:var(--radius-sm); cursor:zoom-in; flex-shrink:0;" alt="${postAlt}">`
        : `<div style="width:56px; height:56px; border-radius:var(--radius-sm); background:var(--nav-bg); display:flex; align-items:center; justify-content:center; font-size:1.3rem; flex-shrink:0;">✏️</div>`;
      row.innerHTML = `
        ${thumb}
        <div style="flex:1; min-width:0;">
          <div style="font-weight:700; font-size:0.9rem;">${livewallSeatLine(p.student_number, p.student_name)}</div>
          <div style="font-size:0.78rem; color:var(--text-muted);">${livewallEscapeHtml(p.created_at || '')}</div>
          ${p.text_content ? `<div style="font-size:0.85rem; margin-top:4px; white-space:pre-wrap;">${livewallEscapeHtml(p.text_content)}</div>` : ''}
        </div>
      `;
      if (p.image_url) {
        row.querySelector('img').addEventListener('click', () => {
          window.ImageLightbox && window.ImageLightbox.open(p.image_url);
        });
      }
      const delBtn = document.createElement('button');
      delBtn.type = 'button';
      delBtn.className = 'btn-icon';
      delBtn.title = livewallT('livewall_delete_title');
      delBtn.style.cssText = 'flex-shrink:0;';
      delBtn.textContent = '🗑️';
      delBtn.addEventListener('click', () => this.deletePost(p.id));
      row.appendChild(delBtn);
      return row;
    },

    // 刪除單筆上傳紀錄（教師端專用，從「歷史紀錄」彈窗操作）：後端會連同伺服器上的手繪/拍照
    // 檔案一併刪除，此動作無法復原。若該筆同時也還在進行中場次的看板上，一併重新整理看板。
    async deletePost(postId) {
      if (!(await window.showConfirmModal(livewallT('livewall_delete_confirm')))) return;
      try {
        await API.delete(`/api/live-wall/posts/${postId}`);
        window.showToast && window.showToast(livewallT('livewall_toast_deleted'), 'success');
        await Promise.all([this.loadHistory(), this.refresh()]);
      } catch (err) {
        window.showToast && window.showToast(err.message, 'error');
      }
    },
  };

  TK.LiveWall = LiveWall;
})(window);
