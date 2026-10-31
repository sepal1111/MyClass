// 課堂工具箱：全域課堂懸浮膠囊
// 由 static/js/toolkit.js 拆出（2026-10-30），程式內容未變更。載入順序見 static/index.html；
// 模組之間透過 window.ToolkitModules 取用彼此（toolkit/common.js 建立）。
(function (window) {
  'use strict';
  const TK = window.ToolkitModules;
  const AudioEngine = window.AudioEngine;
  const { TimerEngine } = TK;

  // =========================================================================
  // 5. FloatingClassroomDock (全域課堂懸浮動態膠囊與抽籤連動加分)
  // =========================================================================
  const FloatingClassroomDock = {
    currentWinner: null,
    currentWinnerMode: 'student',
    isRolling: false,
    drawnStudentIds: new Set(),

    init() {
      // 1. Collapse toggle
      const btnCollapse = document.getElementById('btn-dock-collapse');
      const dock = document.getElementById('classroom-floating-dock');
      const savedCollapsed = localStorage.getItem('classroom_dock_collapsed') === 'true';
      if (dock && savedCollapsed) {
        dock.classList.add('collapsed');
      }

      if (btnCollapse && dock) {
        btnCollapse.addEventListener('click', (e) => {
          e.stopPropagation();
          dock.classList.toggle('collapsed');
          localStorage.setItem('classroom_dock_collapsed', dock.classList.contains('collapsed'));
          if (dock.classList.contains('collapsed')) {
            this.closeAllPopovers();
          }
        });
      }

      // 2. Chime button
      const btnChime = document.getElementById('btn-dock-chime');
      if (btnChime) {
        btnChime.addEventListener('click', () => {
          if (AudioEngine && AudioEngine.playChime) {
            AudioEngine.playChime();
          }
          btnChime.classList.add('pulse');
          setTimeout(() => btnChime.classList.remove('pulse'), 400);
        });
      }

      // 3. Draw button
      const btnDraw = document.getElementById('btn-dock-draw');
      if (btnDraw) {
        btnDraw.addEventListener('click', (e) => {
          e.stopPropagation();
          this.toggleDrawPanel();
        });
      }

      // 4. Timer capsule button (start/pause)
      const btnTimerToggle = document.getElementById('btn-dock-timer-toggle');
      if (btnTimerToggle) {
        btnTimerToggle.addEventListener('click', (e) => {
          e.stopPropagation();
          TimerEngine.toggleCountdown();
        });
      }

      // 5. Timer menu button
      const btnTimerMenu = document.getElementById('btn-dock-timer-menu');
      if (btnTimerMenu) {
        btnTimerMenu.addEventListener('click', (e) => {
          e.stopPropagation();
          this.toggleTimerPanel();
        });
      }

      // 6. Close buttons for popovers
      const btnCloseDraw = document.getElementById('btn-close-floating-draw');
      if (btnCloseDraw) {
        btnCloseDraw.addEventListener('click', () => this.closeDrawPanel());
      }

      const btnCloseTimer = document.getElementById('btn-close-floating-timer');
      if (btnCloseTimer) {
        btnCloseTimer.addEventListener('click', () => this.closeTimerPanel());
      }

      // 7. Floating Draw Controls
      const modeSelect = document.getElementById('floating-draw-mode');
      if (modeSelect) {
        modeSelect.addEventListener('change', () => {
          this.updatePoolBadge();
          this.resetDrawCard();
        });
      }

      const excludeDrawn = document.getElementById('floating-draw-exclude-drawn');
      if (excludeDrawn) {
        excludeDrawn.addEventListener('change', () => this.updatePoolBadge());
      }

      const btnResetPool = document.getElementById('btn-floating-draw-reset-pool');
      if (btnResetPool) {
        btnResetPool.addEventListener('click', () => {
          this.drawnStudentIds.clear();
          this.updatePoolBadge();
          this.resetDrawCard();
          if (window.showToast) window.showToast('已重置抽籤池', 'info');
        });
      }

      const btnStartDraw = document.getElementById('btn-start-floating-draw');
      if (btnStartDraw) {
        btnStartDraw.addEventListener('click', () => this.startFloatingDraw());
      }

      // 8. Instant scoring buttons on winner reveal
      document.querySelectorAll('.btn-winner-score').forEach(btn => {
        btn.addEventListener('click', async (e) => {
          const delta = parseInt(e.currentTarget.dataset.delta, 10) || 1;
          await this.awardScoreToCurrentWinner(delta, e.currentTarget);
        });
      });

      const btnCustomScore = document.getElementById('btn-winner-custom-score');
      if (btnCustomScore) {
        btnCustomScore.addEventListener('click', () => {
          this.openCustomScoreForWinner();
        });
      }

      // 9. Floating Timer Presets and buttons
      document.querySelectorAll('.btn-dock-timer-preset').forEach(btn => {
        btn.addEventListener('click', (e) => {
          const secs = parseInt(e.currentTarget.dataset.seconds, 10) || 180;
          TimerEngine.setCountdownSeconds(secs);
          TimerEngine.startCountdown();
          this.closeTimerPanel();
        });
      });

      const btnAdd30s = document.getElementById('btn-dock-timer-add30s');
      if (btnAdd30s) {
        btnAdd30s.addEventListener('click', () => TimerEngine.quickAddSeconds(30));
      }

      const btnAdd1m = document.getElementById('btn-dock-timer-add1m');
      if (btnAdd1m) {
        btnAdd1m.addEventListener('click', () => TimerEngine.quickAddSeconds(60));
      }

      const btnResetTimer = document.getElementById('btn-dock-timer-reset');
      if (btnResetTimer) {
        btnResetTimer.addEventListener('click', () => TimerEngine.resetCountdown());
      }

      const btnFullscreen = document.getElementById('btn-dock-timer-fullscreen');
      if (btnFullscreen) {
        btnFullscreen.addEventListener('click', () => {
          this.closeTimerPanel();
          TimerEngine.openFullscreen();
        });
      }

      // Close popover when clicking outside
      document.addEventListener('click', (e) => {
        const drawPanel = document.getElementById('floating-draw-panel');
        const timerPanel = document.getElementById('floating-timer-panel');
        const dock = document.getElementById('classroom-floating-dock');
        if (drawPanel && !drawPanel.contains(e.target) && !dock?.contains(e.target)) {
          drawPanel.style.display = 'none';
        }
        if (timerPanel && !timerPanel.contains(e.target) && !dock?.contains(e.target)) {
          timerPanel.style.display = 'none';
        }
      });

      this.updatePoolBadge();
    },

    toggleDrawPanel() {
      const panel = document.getElementById('floating-draw-panel');
      const timerPanel = document.getElementById('floating-timer-panel');
      if (timerPanel) timerPanel.style.display = 'none';
      if (!panel) return;
      const isVisible = panel.style.display !== 'none';
      panel.style.display = isVisible ? 'none' : 'block';
      if (!isVisible) {
        this.updatePoolBadge();
        if (!this.isRolling && !this.currentWinner) {
          this.resetDrawCard();
        }
      }
    },

    closeDrawPanel() {
      const panel = document.getElementById('floating-draw-panel');
      if (panel) panel.style.display = 'none';
    },

    toggleTimerPanel() {
      const panel = document.getElementById('floating-timer-panel');
      const drawPanel = document.getElementById('floating-draw-panel');
      if (drawPanel) drawPanel.style.display = 'none';
      if (!panel) return;
      panel.style.display = panel.style.display !== 'none' ? 'none' : 'block';
    },

    closeTimerPanel() {
      const panel = document.getElementById('floating-timer-panel');
      if (panel) panel.style.display = 'none';
    },

    closeAllPopovers() {
      this.closeDrawPanel();
      this.closeTimerPanel();
    },

    updatePoolBadge() {
      const badge = document.getElementById('floating-draw-pool-badge');
      if (!badge) return;
      const mode = document.getElementById('floating-draw-mode')?.value || 'student';
      const excludeDrawn = document.getElementById('floating-draw-exclude-drawn')?.checked ?? true;
      const students = window.AppState ? (window.AppState.students || []) : [];
      const groups = window.AppState ? (window.AppState.groups || []) : [];
      const isEn = window.I18n && window.I18n.getLanguage() === 'en';

      if (mode === 'group') {
        const count = groups.length;
        badge.textContent = isEn ? `Pool: ${count} groups` : `抽籤池：共 ${count} 組`;
        return;
      }

      const eligible = students.filter(s => !s.is_absent);
      const remaining = excludeDrawn ? eligible.filter(s => !this.drawnStudentIds.has(s.id)).length : eligible.length;
      badge.textContent = isEn ? `Pool: ${remaining} left` : `抽籤池：剩餘 ${remaining} 人`;
    },

    resetDrawCard() {
      this.currentWinner = null;
      const card = document.getElementById('floating-draw-card');
      const img = document.getElementById('floating-draw-avatar-img');
      const badge = document.getElementById('floating-draw-seat-badge');
      const name = document.getElementById('floating-draw-name-label');
      const actions = document.getElementById('floating-draw-winner-actions');
      const mode = document.getElementById('floating-draw-mode')?.value || 'student';
      const isEn = window.I18n && window.I18n.getLanguage() === 'en';

      if (card) {
        card.classList.remove('rolling', 'winner');
      }
      if (img) {
        img.src = mode === 'group' ? '/static/pic/animals/penguin.png' : '/static/avatars/boy.png';
      }
      if (badge) {
        badge.textContent = 'READY';
      }
      if (name) {
        name.textContent = isEn ? 'Ready to Draw' : '點擊開始抽籤';
      }
      if (actions) {
        actions.style.display = 'none';
      }
    },

    async startFloatingDraw() {
      if (this.isRolling) return;
      const mode = document.getElementById('floating-draw-mode')?.value || 'student';
      const excludeDrawn = document.getElementById('floating-draw-exclude-drawn')?.checked ?? true;
      const students = window.AppState ? (window.AppState.students || []) : [];
      const groups = window.AppState ? (window.AppState.groups || []) : [];

      let pool = [];
      if (mode === 'student') {
        pool = students.filter(s => !s.is_absent);
        if (excludeDrawn) {
          pool = pool.filter(s => !this.drawnStudentIds.has(s.id));
        }
        if (pool.length === 0) {
          if (students.filter(s => !s.is_absent).length > 0) {
            this.drawnStudentIds.clear();
            this.updatePoolBadge();
            pool = students.filter(s => !s.is_absent);
          } else {
            alert('名冊內無符合條件的學生');
            return;
          }
        }
      } else {
        pool = groups;
        if (pool.length === 0) {
          alert('目前尚未建立分組');
          return;
        }
      }

      this.isRolling = true;
      const card = document.getElementById('floating-draw-card');
      const actions = document.getElementById('floating-draw-winner-actions');

      if (card) {
        card.classList.remove('winner');
        card.classList.add('rolling');
      }
      if (actions) actions.style.display = 'none';

      // Pick winner
      const winnerIndex = Math.floor(Math.random() * pool.length);
      const winner = pool[winnerIndex];

      const durationMs = 1800;
      const startTime = performance.now();
      let lastShuffleTime = 0;

      const shuffleFrame = (now) => {
        const elapsed = now - startTime;
        const progress = Math.min(1, elapsed / durationMs);
        const interval = 50 + Math.pow(progress, 2) * 160;

        if (now - lastShuffleTime > interval && progress < 1) {
          lastShuffleTime = now;
          const randomItem = pool[Math.floor(Math.random() * pool.length)];
          this.renderDrawItem(randomItem, mode);
          if (AudioEngine && AudioEngine.playTick) {
            AudioEngine.playTick(progress < 0.7);
          }
        }

        if (progress < 1) {
          requestAnimationFrame(shuffleFrame);
        } else {
          // Reveal winner!
          this.isRolling = false;
          this.currentWinner = winner;
          this.currentWinnerMode = mode;
          if (mode === 'student') {
            this.drawnStudentIds.add(winner.id);
          }
          this.updatePoolBadge();

          this.renderDrawItem(winner, mode);
          if (card) {
            card.classList.remove('rolling');
            card.classList.add('winner');
          }
          if (actions) {
            actions.style.display = 'block';
            actions.querySelectorAll('.btn-winner-score').forEach(b => {
              const d = b.dataset.delta;
              b.textContent = `➕ +${d} 分`;
              b.style.background = '';
              b.disabled = false;
            });
          }

          if (AudioEngine) {
            if (AudioEngine.playVictory) AudioEngine.playVictory();
            else if (AudioEngine.playChime) AudioEngine.playChime();
          }
        }
      };

      requestAnimationFrame(shuffleFrame);
    },

    renderDrawItem(item, mode) {
      if (!item) return;
      const img = document.getElementById('floating-draw-avatar-img');
      const badge = document.getElementById('floating-draw-seat-badge');
      const name = document.getElementById('floating-draw-name-label');
      const isEn = window.I18n && window.I18n.getLanguage() === 'en';

      if (mode === 'student') {
        const displayName = window.getStudentDisplayName ? window.getStudentDisplayName(item) : (item.name || '');
        const numText = isEn ? `No. ${item.student_number}` : `${item.student_number}號`;
        if (badge) badge.textContent = numText;
        if (name) name.textContent = displayName;
        if (img) {
          const gender = item.gender || 'M';
          const isFemale = gender === 'female' || gender === 'F' || gender === '女';
          const fallback = isFemale ? '/static/avatars/girl.png' : '/static/avatars/boy.png';
          img.src = item.custom_avatar_url || (item.student_code ? `/photo/${item.student_code}.jpg` : fallback);
          img.onerror = () => { img.onerror = null; img.src = fallback; };
        }
      } else {
        const groupName = item.group_name || item.name || '小組';
        if (badge) badge.textContent = isEn ? 'GROUP' : '小組';
        if (name) name.textContent = groupName;
        if (img) {
          let icon = item.icon_url || item.group_icon_url || item.custom_icon_url;
          if (!icon && typeof window.getGroupAvatarSrc === 'function') {
            icon = window.getGroupAvatarSrc(item);
          }
          img.src = icon || '/static/pic/animals/penguin.png';
        }
      }
    },

    async awardScoreToCurrentWinner(delta, btnElement) {
      if (!this.currentWinner || !window.AppState || !window.AppState.currentCourseId) return;
      const winner = this.currentWinner;
      const mode = this.currentWinnerMode;
      const courseId = window.AppState.currentCourseId;

      if (btnElement) {
        btnElement.disabled = true;
        btnElement.textContent = '⏳ 加分中...';
      }

      try {
        if (mode === 'student') {
          const res = await API.post(`/api/scores/${courseId}/add`, {
            student_ids: [winner.id],
            rule_title: '抽籤表現加分',
            score: delta,
            category: 'positive'
          });

          winner.score = (winner.score || 0) + delta;
          if (window.prevStudentScoresMap) {
            window.prevStudentScoresMap[winner.id] = winner.score;
          }

          const toastMsg = window.I18n ? window.I18n.t('undo_toast_single', {
            name: `${winner.student_number}號 ${window.getStudentDisplayName ? window.getStudentDisplayName(winner) : winner.name}`,
            icon: '🎲',
            rule: '抽籤表現加分',
            score: `+${delta}`
          }) : `已為【${winner.student_number}號 ${winner.name}】抽籤表現 +${delta} 分！`;

          if (window.showUndoToast) window.showUndoToast(res.undo_id, toastMsg);
        } else {
          // Group
          const studentIds = (winner.students || []).map(s => s.id);
          const payload = {
            plan_id: winner.plan_id || window.AppState.activeGroupPlanId,
            group_id: winner.id,
            student_ids: studentIds,
            rule_title: '小組抽籤加分',
            score: delta,
            category: 'positive'
          };
          const res = await API.post(`/api/scores/${courseId}/add`, payload);
          if (window.showUndoToast) {
            window.showUndoToast(res.undo_id, `已為【${winner.group_name}】全員 +${delta} 分！`);
          }
        }

        if (btnElement) {
          btnElement.textContent = `✅ +${delta}分成功`;
          btnElement.style.background = 'linear-gradient(135deg, #10b981, #047857)';
        }

        // Live refresh background views (both roster grid and seating view)
        if (window.renderScoringView) window.renderScoringView();
        if (window.notifyScoreUpdates) window.notifyScoreUpdates();
        if (window.loadScoringData) window.loadScoringData();

      } catch (err) {
        alert(`評分失敗：${err.message}`);
        if (btnElement) {
          btnElement.disabled = false;
          btnElement.textContent = `➕ +${delta} 分`;
        }
      }
    },

    openCustomScoreForWinner() {
      if (!this.currentWinner || this.currentWinnerMode !== 'student') return;
      const winner = this.currentWinner;
      this.closeDrawPanel();

      if (window.AppState) {
        window.AppState.selectedStudentIds.clear();
        window.AppState.selectedStudentIds.add(winner.id);
        if (window.renderScoringView) window.renderScoringView();
        if (window.updateFloatingScoringDrawer) {
          window.lastClickCoords = { x: window.innerWidth - 380, y: window.innerHeight - 300 };
          window.updateFloatingScoringDrawer();
        }
      }
    }
  };

  TK.FloatingClassroomDock = FloatingClassroomDock;
})(window);
