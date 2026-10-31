// MyClass 學生端：分頁切換與通知
// 由 static/js/student.js 拆出（2026-10-31，原第 984–1189 行），程式內容未變更；縮排保留原樣。
// student.js 與 static/js/student/*.js 共用頁面的全域範圍（一般 <script>），載入順序見 static/student.html。


  // --- Tab Bar ---
  const TAB_PANES = {
    materials: { btn: btnContentTabMaterials, pane: materialsTabPane },
    fileCollect: { btn: btnContentTabFileCollect, pane: fileCollectTabPane },
    quizzes: { btn: btnContentTabQuizzes, pane: quizzesTabPane },
    scores: { btn: btnContentTabScores, pane: scoresTabPane },
    liveWall: { btn: btnContentTabLiveWall, pane: liveWallTabPane },
    wordCloud: { btn: btnContentTabWordCloud, pane: wordCloudTabPane },
    kahoot: { btn: btnContentTabKahoot, pane: kahootTabPane },
    leader: { btn: btnContentTabLeader, pane: leaderTabPane },
  };

  function switchTab(key) {
    const target = TAB_PANES[key];
    if (!target || target.btn.classList.contains('active')) return;
    Object.values(TAB_PANES).forEach(({ btn }) => btn?.classList.remove('active'));
    target.btn.classList.add('active');

    const currentPane = Object.values(TAB_PANES).find(({ pane }) => pane && !pane.hidden)?.pane;
    const showTarget = () => {
      if (currentPane && currentPane !== target.pane) currentPane.hidden = true;
      if (target.pane) {
        target.pane.hidden = false;
        target.pane.classList.add('fading');
        requestAnimationFrame(() => target.pane.classList.remove('fading'));
      }
    };
    if (currentPane && currentPane !== target.pane) {
      currentPane.classList.add('fading');
      setTimeout(showTarget, 120);
    } else {
      showTarget();
    }
  }

  btnContentTabMaterials.addEventListener('click', () => switchTab('materials'));

  if (btnContentTabFileCollect) {
    btnContentTabFileCollect.addEventListener('click', () => {
      switchTab('fileCollect');
      loadStudentFileCollections();
    });
  }

  if (btnContentTabQuizzes) {
    btnContentTabQuizzes.addEventListener('click', () => {
      switchTab('quizzes');
      loadStudentQuizzes();
    });
  }

  btnContentTabScores.addEventListener('click', async () => {
    switchTab('scores');
    try {
      await loadScores();
    } catch (e) {
      showToast(e.message, 'error');
    }
  });

  btnContentTabLiveWall.addEventListener('click', () => {
    switchTab('liveWall');
    LiveWall.refresh();
  });

  if (btnContentTabWordCloud) {
    btnContentTabWordCloud.addEventListener('click', () => {
      switchTab('wordCloud');
      if (window.StudentApp) window.StudentApp.syncWordCloudTab();
    });
  }

  if (btnContentTabKahoot) {
    btnContentTabKahoot.addEventListener('click', () => {
      switchTab('kahoot');
      if (window.StudentApp) window.StudentApp.syncKahootTab();
    });
  }

  if (btnContentTabLeader) {
    btnContentTabLeader.addEventListener('click', () => {
      switchTab('leader');
      loadLeaderSection();
    });
  }

  // --- 🔔 通知：老師批改、退回、回覆提問、獎品審核、新內容等事件（後端見 utils/notifications.ts）---
  const Notifications = {
    items: [],
    unread: 0,
    pollTimer: null,

    isLoggedIn() {
      return Boolean(localStorage.getItem(TOKEN_KEY));
    },

    async refresh() {
      if (!this.isLoggedIn()) return;
      try {
        const data = await api('/api/student/notifications');
        this.items = data.items || [];
        this.unread = data.unread_count || 0;
        this.render();
      } catch (e) {
        /* 通知是附帶功能：取得失敗時靜默略過，不打擾學生 */
      }
    },

    formatTime(createdAt) {
      if (!createdAt) return '';
      const d = new Date();
      const today = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
      const [date, time = ''] = createdAt.split(' ');
      const hm = time.slice(0, 5);
      return date === today ? `今天 ${hm}` : `${date.slice(5)} ${hm}`;
    },

    render() {
      const list = document.getElementById('notifList');
      const empty = document.getElementById('notifEmpty');
      const markAll = document.getElementById('notifMarkAllBtn');
      const badge = document.getElementById('notifBadge');
      if (!list) return;

      badge.hidden = this.unread <= 0;
      badge.textContent = this.unread > 99 ? '99+' : String(this.unread);
      empty.hidden = this.items.length > 0;
      markAll.hidden = this.unread <= 0;

      list.innerHTML = this.items
        .map((n) => `
          <button type="button" class="notif-item ${n.is_read ? 'read' : 'unread'}" data-id="${n.id}" data-tab="${escapeHtml(n.tab || '')}">
            <div class="notif-item-title">${escapeHtml(n.title)}</div>
            ${n.body ? `<div class="notif-item-body">${escapeHtml(n.body)}</div>` : ''}
            <div class="notif-item-time">${escapeHtml(this.formatTime(n.created_at))}</div>
          </button>`)
        .join('');
    },

    async markRead(payload) {
      try {
        const data = await api('/api/student/notifications/read', { method: 'POST', body: JSON.stringify(payload) });
        this.unread = data.unread_count || 0;
      } catch (e) {
        /* 靜默略過 */
      }
    },

    async markAllRead() {
      this.items.forEach((n) => { n.is_read = true; });
      this.unread = 0;
      this.render();
      await this.markRead({ all: true });
    },

    // 點一則通知：標為已讀並切換到對應分頁（讓學生直接看到老師的批改、新內容…）
    async open(id, tab) {
      const item = this.items.find((n) => n.id === id);
      if (item && !item.is_read) {
        item.is_read = true;
        this.unread = Math.max(0, this.unread - 1);
        this.render();
        this.markRead({ ids: [id] });
      }
      notifDropdown.classList.remove('open');
      const tabButtons = {
        materials: btnContentTabMaterials,
        fileCollect: btnContentTabFileCollect,
        quizzes: btnContentTabQuizzes,
        scores: btnContentTabScores,
      };
      tabButtons[tab]?.click();
    },

    // 沒有即時連線（或連線中斷）時的備援：頁面可見時每 60 秒更新一次未讀數。
    startPolling() {
      if (this.pollTimer) return;
      this.pollTimer = setInterval(() => {
        if (document.visibilityState === 'visible') this.refresh();
      }, 60000);
      document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'visible') this.refresh();
      });
    },
  };

  notifBellBtn.addEventListener('click', (evt) => {
    evt.stopPropagation();
    const willOpen = !notifDropdown.classList.contains('open');
    notifDropdown.classList.toggle('open');
    if (willOpen) Notifications.refresh();
  });
  document.addEventListener('click', (evt) => {
    if (!notifDropdown.contains(evt.target) && evt.target !== notifBellBtn) {
      notifDropdown.classList.remove('open');
    }
  });
  document.getElementById('notifList').addEventListener('click', (evt) => {
    const btn = evt.target.closest('.notif-item');
    if (btn) Notifications.open(Number(btn.dataset.id), btn.dataset.tab);
  });
  document.getElementById('notifMarkAllBtn').addEventListener('click', (evt) => {
    evt.stopPropagation();
    Notifications.markAllRead();
  });
