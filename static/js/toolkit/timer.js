// 課堂工具箱：倒數計時器與碼錶
// 由 static/js/toolkit.js 拆出（2026-10-30），程式內容未變更。載入順序見 static/index.html；
// 模組之間透過 window.ToolkitModules 取用彼此（toolkit/common.js 建立）。
(function (window) {
  'use strict';
  const TK = window.ToolkitModules;
  const AudioEngine = window.AudioEngine;

  // =========================================================================
  // 4. TimerEngine (倒數計時器與碼錶)
  // =========================================================================
  const TimerEngine = {
    // Countdown State
    timerMode: 'countdown', // 'countdown' | 'stopwatch'
    countdownTotalSeconds: 180,
    countdownRemainingSeconds: 180,
    countdownInterval: null,
    isCountdownRunning: false,

    // Background Music (BGM) State
    bgmAudio: new Audio(),
    bgmMusicList: [
      { title: 'BGM_01', filename: 'BGM_01.mp3', url: '/static/music/BGM_01.mp3' },
      { title: 'BGM_02', filename: 'BGM_02.mp3', url: '/static/music/BGM_02.mp3' },
      { title: 'BGM_03', filename: 'BGM_03.mp3', url: '/static/music/BGM_03.mp3' },
      { title: 'BGM_04', filename: 'BGM_04.mp3', url: '/static/music/BGM_04.mp3' },
      { title: 'BGM_05', filename: 'BGM_05.mp3', url: '/static/music/BGM_05.mp3' },
      { title: 'BGM_06', filename: 'BGM_06.mp3', url: '/static/music/BGM_06.mp3' }
    ],
    currentBgmIndex: -1,
    isBgmPlaying: false,
    isBgmUserMuted: localStorage.getItem('toolkit_timer_bgm_muted') === 'true',
    bgmVolume: parseFloat(localStorage.getItem('toolkit_timer_bgm_vol') || '0.5'),

    // Stopwatch State
    stopwatchStartTime: 0,
    stopwatchElapsedMs: 0,
    stopwatchInterval: null,
    isStopwatchRunning: false,
    stopwatchLaps: [],

    init() {
      // Mode switcher (countdown vs stopwatch)
      document.querySelectorAll('.btn-timer-mode').forEach(btn => {
        btn.addEventListener('click', (e) => {
          const mode = e.currentTarget.dataset.mode;
          this.switchTimerMode(mode);
        });
      });

      // Countdown presets
      document.querySelectorAll('.btn-timer-preset').forEach(btn => {
        btn.addEventListener('click', (e) => {
          const secs = parseInt(e.currentTarget.dataset.seconds, 10) || 180;
          this.setCountdownSeconds(secs);
        });
      });

      // Countdown controls
      const btnToggleCountdown = document.getElementById('btn-timer-toggle');
      if (btnToggleCountdown) {
        btnToggleCountdown.addEventListener('click', () => {
          this.toggleCountdown();
        });
      }

      // Background Music (BGM) Controls Initialization
      this.loadBgmList();

      const btnBgmToggle = document.getElementById('btn-timer-bgm-toggle');
      if (btnBgmToggle) btnBgmToggle.addEventListener('click', () => this.toggleBgm());

      const btnFsBgmToggle = document.getElementById('btn-fs-timer-bgm-toggle');
      if (btnFsBgmToggle) btnFsBgmToggle.addEventListener('click', () => this.toggleBgm());

      const btnBgmNext = document.getElementById('btn-timer-bgm-next');
      if (btnBgmNext) btnBgmNext.addEventListener('click', () => this.nextBgm());

      const btnFsBgmNext = document.getElementById('btn-fs-timer-bgm-next');
      if (btnFsBgmNext) btnFsBgmNext.addEventListener('click', () => this.nextBgm());

      const bgmSlider = document.getElementById('timer-bgm-vol-slider');
      if (bgmSlider) {
        bgmSlider.value = this.bgmVolume;
        bgmSlider.addEventListener('input', (e) => this.setBgmVolume(e.target.value));
      }

      const fsBgmSlider = document.getElementById('fs-timer-bgm-vol-slider');
      if (fsBgmSlider) {
        fsBgmSlider.value = this.bgmVolume;
        fsBgmSlider.addEventListener('input', (e) => this.setBgmVolume(e.target.value));
      }

      this.updateBgmUi();

      const btnResetCountdown = document.getElementById('btn-timer-reset');
      if (btnResetCountdown) {
        btnResetCountdown.addEventListener('click', () => {
          this.resetCountdown();
        });
      }

      const setupCustomInputPair = (btnId, minId, secId) => {
        const btn = document.getElementById(btnId);
        const minInput = document.getElementById(minId);
        const secInput = document.getElementById(secId);

        const applyTime = () => {
          const m = parseInt(minInput ? minInput.value : 0, 10) || 0;
          const s = parseInt(secInput ? secInput.value : 0, 10) || 0;
          const total = m * 60 + s;
          if (total > 0) {
            this.setCountdownSeconds(total);
            if (window.showToast) {
              window.showToast(`已設定倒數時間為 ${m} 分 ${s} 秒`, 'info');
            }
          }
        };

        if (btn) {
          btn.addEventListener('click', applyTime);
        }
        [minInput, secInput].forEach(inp => {
          if (inp) {
            inp.addEventListener('keydown', (e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                applyTime();
              }
            });
          }
        });
      };

      setupCustomInputPair('btn-timer-set-custom', 'timer-custom-minutes', 'timer-custom-seconds');
      setupCustomInputPair('btn-fs-timer-set-custom', 'fs-timer-custom-minutes', 'fs-timer-custom-seconds');
      setupCustomInputPair('btn-dock-timer-set-custom', 'dock-timer-custom-minutes', 'dock-timer-custom-seconds');

      // Stopwatch controls
      const btnToggleSw = document.getElementById('btn-sw-toggle');
      if (btnToggleSw) {
        btnToggleSw.addEventListener('click', () => {
          this.toggleStopwatch();
        });
      }

      const btnResetSw = document.getElementById('btn-sw-reset');
      if (btnResetSw) {
        btnResetSw.addEventListener('click', () => {
          this.resetStopwatch();
        });
      }

      const btnLapSw = document.getElementById('btn-sw-lap');
      if (btnLapSw) {
        btnLapSw.addEventListener('click', () => {
          this.recordStopwatchLap();
        });
      }

      // Floating mini widget toggle
      const btnMini = document.getElementById('btn-timer-mini-toggle');
      if (btnMini) {
        btnMini.addEventListener('click', () => {
          this.toggleFloatingMiniWidget();
        });
      }

      const btnCloseMini = document.getElementById('btn-close-floating-timer');
      if (btnCloseMini) {
        btnCloseMini.addEventListener('click', (e) => {
          e.stopPropagation();
          const widget = document.getElementById('floating-mini-timer-widget');
          if (widget) widget.style.display = 'none';
        });
      }

      // Fullscreen Timer modal openers & controls
      const btnFullscreen = document.getElementById('btn-timer-fullscreen');
      if (btnFullscreen) {
        btnFullscreen.addEventListener('click', () => {
          this.openFullscreen();
        });
      }

      // Mode switch in Fullscreen
      document.querySelectorAll('.btn-fs-timer-mode').forEach(btn => {
        btn.addEventListener('click', (e) => {
          const mode = e.currentTarget.dataset.mode;
          this.switchTimerMode(mode);
        });
      });

      // Browser fullscreen toggle in modal
      const btnFsBrowserToggle = document.getElementById('btn-timer-fs-browser-toggle');
      if (btnFsBrowserToggle) {
        btnFsBrowserToggle.addEventListener('click', () => {
          if (!document.fullscreenElement) {
            document.documentElement.requestFullscreen().catch(() => {});
          } else {
            document.exitFullscreen().catch(() => {});
          }
        });
      }

      // Fullscreen presets
      document.querySelectorAll('.btn-fs-timer-preset').forEach(btn => {
        btn.addEventListener('click', (e) => {
          const secs = parseInt(e.currentTarget.dataset.seconds, 10) || 180;
          this.setCountdownSeconds(secs);
        });
      });

      // Quick add buttons (+30s, +1m)
      const btnAdd30s = document.getElementById('btn-fs-add-30s');
      if (btnAdd30s) {
        btnAdd30s.addEventListener('click', () => this.quickAddSeconds(30));
      }
      const btnAdd1m = document.getElementById('btn-fs-add-1m');
      if (btnAdd1m) {
        btnAdd1m.addEventListener('click', () => this.quickAddSeconds(60));
      }

      // Fullscreen Action buttons
      const btnFsToggleCountdown = document.getElementById('btn-fs-timer-toggle');
      if (btnFsToggleCountdown) {
        btnFsToggleCountdown.addEventListener('click', () => this.toggleCountdown());
      }
      const btnFsResetCountdown = document.getElementById('btn-fs-timer-reset');
      if (btnFsResetCountdown) {
        btnFsResetCountdown.addEventListener('click', () => this.resetCountdown());
      }

      const btnFsToggleSw = document.getElementById('btn-fs-sw-toggle');
      if (btnFsToggleSw) {
        btnFsToggleSw.addEventListener('click', () => this.toggleStopwatch());
      }
      const btnFsLapSw = document.getElementById('btn-fs-sw-lap');
      if (btnFsLapSw) {
        btnFsLapSw.addEventListener('click', () => this.recordStopwatchLap());
      }
      const btnFsResetSw = document.getElementById('btn-fs-sw-reset');
      if (btnFsResetSw) {
        btnFsResetSw.addEventListener('click', () => this.resetStopwatch());
      }

      // Floating widget click & drag support
      const widget = document.getElementById('floating-mini-timer-widget');
      if (widget) {
        let hasMoved = false;
        let isDragging = false;
        let startX, startY, initialLeft, initialTop;

        widget.addEventListener('mousedown', (e) => {
          if (e.target.closest('#btn-close-floating-timer')) return;
          isDragging = true;
          hasMoved = false;
          startX = e.clientX;
          startY = e.clientY;
          const rect = widget.getBoundingClientRect();
          initialLeft = rect.left;
          initialTop = rect.top;
          widget.style.bottom = 'auto';
          widget.style.right = 'auto';
          widget.style.left = `${initialLeft}px`;
          widget.style.top = `${initialTop}px`;
          widget.style.userSelect = 'none';
        });

        window.addEventListener('mousemove', (e) => {
          if (!isDragging) return;
          const dx = e.clientX - startX;
          const dy = e.clientY - startY;
          if (Math.abs(dx) > 3 || Math.abs(dy) > 3) {
            hasMoved = true;
          }
          widget.style.left = `${Math.max(10, Math.min(window.innerWidth - widget.offsetWidth - 10, initialLeft + dx))}px`;
          widget.style.top = `${Math.max(10, Math.min(window.innerHeight - widget.offsetHeight - 10, initialTop + dy))}px`;
        });

        window.addEventListener('mouseup', () => {
          isDragging = false;
          widget.style.userSelect = '';
        });

        widget.addEventListener('click', (e) => {
          if (hasMoved || e.target.closest('#btn-close-floating-timer')) return;
          const tabBtn = document.querySelector('.nav-tab[data-tab="toolkit"]');
          if (tabBtn) tabBtn.click();
          if (window.TeachingToolkit) {
            window.TeachingToolkit.switchSubtab('timer');
          }
        });
      }

      this.updateCountdownDisplay();
    },

    openFullscreen() {
      const modal = document.getElementById('modal-timer-fullscreen');
      if (!modal) return;
      modal.classList.add('open');

      this.updateCountdownDisplay();
      this.updateStopwatchDisplay();
      this.renderStopwatchLaps();
      this.updateCountdownControls();
      this.updateStopwatchControls();
      this.updatePresetButtons();
      this.syncCustomTimeInputs(Math.floor(this.countdownTotalSeconds / 60), this.countdownTotalSeconds % 60);

      // Keyboard Shortcuts Handler in Fullscreen
      this._fsKeyHandler = (e) => {
        if (!modal.classList.contains('open')) return;
        if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;

        if (e.code === 'Space') {
          e.preventDefault();
          if (this.timerMode === 'stopwatch') this.toggleStopwatch();
          else this.toggleCountdown();
        } else if (e.key === 'r' || e.key === 'R') {
          e.preventDefault();
          if (this.timerMode === 'stopwatch') this.resetStopwatch();
          else this.resetCountdown();
        } else if (e.key === 'l' || e.key === 'L') {
          if (this.timerMode === 'stopwatch') {
            e.preventDefault();
            this.recordStopwatchLap();
          }
        } else if (e.key === 'Escape') {
          this.closeFullscreen();
        }
      };
      window.addEventListener('keydown', this._fsKeyHandler);
    },

    closeFullscreen() {
      const modal = document.getElementById('modal-timer-fullscreen');
      if (modal) modal.classList.remove('open');
      if (this._fsKeyHandler) {
        window.removeEventListener('keydown', this._fsKeyHandler);
        this._fsKeyHandler = null;
      }
      if (document.fullscreenElement) {
        document.exitFullscreen().catch(() => {});
      }
    },

    quickAddSeconds(secs) {
      this.countdownRemainingSeconds += secs;
      if (this.countdownRemainingSeconds > this.countdownTotalSeconds) {
        this.countdownTotalSeconds = this.countdownRemainingSeconds;
      }
      this.updateCountdownDisplay();
    },

    switchTimerMode(mode) {
      this.timerMode = mode;
      document.querySelectorAll('.btn-timer-mode, .btn-fs-timer-mode').forEach(btn => {
        const isActive = btn.dataset.mode === mode;
        btn.classList.toggle('active', isActive);
        btn.classList.toggle('btn-secondary', !isActive);
      });

      const countdownBlock = document.getElementById('timer-countdown-container');
      const stopwatchBlock = document.getElementById('timer-stopwatch-container');
      if (countdownBlock) countdownBlock.style.display = mode === 'countdown' ? 'block' : 'none';
      if (stopwatchBlock) stopwatchBlock.style.display = mode === 'stopwatch' ? 'block' : 'none';

      const fsCountdown = document.getElementById('fs-countdown-container');
      const fsStopwatch = document.getElementById('fs-stopwatch-container');
      if (fsCountdown) fsCountdown.style.display = mode === 'countdown' ? 'flex' : 'none';
      if (fsStopwatch) fsStopwatch.style.display = mode === 'stopwatch' ? 'flex' : 'none';

      this.syncFloatingMiniWidget();
    },

    toggleFloatingMiniWidget() {
      const widget = document.getElementById('floating-mini-timer-widget');
      if (!widget) return;
      const isVisible = widget.style.display === 'flex' || widget.style.display === 'block';
      widget.style.display = isVisible ? 'none' : 'flex';
      if (!isVisible) {
        this.syncFloatingMiniWidget();
      }
    },

    syncFloatingMiniWidget() {
      const miniDigits = document.getElementById('floating-timer-digits');
      const dockDigits = document.getElementById('dock-timer-digits');
      const dockIcon = document.getElementById('dock-timer-state-icon');

      let timeText = '03:00';
      if (this.timerMode === 'stopwatch') {
        const totalMs = this.stopwatchElapsedMs;
        const mins = Math.floor(totalMs / 60000);
        const secs = Math.floor((totalMs % 60000) / 1000);
        const ms = Math.floor((totalMs % 1000) / 10);
        timeText = `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}.${String(ms).padStart(2, '0')}`;
        if (dockIcon) dockIcon.textContent = this.isStopwatchRunning ? '⏱️' : '⏹️';
      } else {
        const mins = Math.floor(this.countdownRemainingSeconds / 60);
        const secs = this.countdownRemainingSeconds % 60;
        timeText = `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
        if (dockIcon) dockIcon.textContent = this.isCountdownRunning ? '⏳' : '⏱️';
      }

      if (miniDigits) miniDigits.textContent = timeText;
      if (dockDigits) dockDigits.textContent = timeText;
    },

    syncCustomTimeInputs(m, s) {
      const pairs = [
        ['timer-custom-minutes', 'timer-custom-seconds'],
        ['fs-timer-custom-minutes', 'fs-timer-custom-seconds'],
        ['dock-timer-custom-minutes', 'dock-timer-custom-seconds']
      ];
      pairs.forEach(([minId, secId]) => {
        const minEl = document.getElementById(minId);
        const secEl = document.getElementById(secId);
        if (minEl && document.activeElement !== minEl) minEl.value = m;
        if (secEl && document.activeElement !== secEl) secEl.value = s;
      });
    },

    setCountdownSeconds(secs) {
      this.pauseCountdown();
      this.countdownTotalSeconds = secs;
      this.countdownRemainingSeconds = secs;
      this.updateCountdownDisplay();
      this.syncCustomTimeInputs(Math.floor(secs / 60), secs % 60);

      // Sync active state on preset pills
      document.querySelectorAll('.btn-timer-preset, .btn-fs-timer-preset').forEach(btn => {
        const btnSecs = parseInt(btn.dataset.seconds, 10);
        btn.classList.toggle('active', btnSecs === secs);
      });
    },

    toggleCountdown() {
      if (this.isCountdownRunning) {
        this.pauseCountdown();
      } else {
        this.startCountdown();
      }
    },

    startCountdown() {
      if (this.countdownRemainingSeconds <= 0) {
        this.countdownRemainingSeconds = this.countdownTotalSeconds;
      }
      this.isCountdownRunning = true;
      this.updateCountdownControls();

      AudioEngine.init();

      this.countdownInterval = setInterval(() => {
        this.countdownRemainingSeconds--;

        if (this.countdownRemainingSeconds <= 0) {
          this.countdownRemainingSeconds = 0;
          this.pauseCountdown();
          this.pauseBgm(false);
          AudioEngine.playTimerAlarm(3);
          this.triggerCountdownFinishAnimation();
        }

        this.updateCountdownDisplay();
      }, 1000);
    },

    pauseCountdown() {
      this.isCountdownRunning = false;
      if (this.countdownInterval) {
        clearInterval(this.countdownInterval);
        this.countdownInterval = null;
      }
      this.updateCountdownControls();
    },

    resetCountdown() {
      this.pauseCountdown();
      this.countdownRemainingSeconds = this.countdownTotalSeconds;
      this.updateCountdownDisplay();
    },

    updateCountdownDisplay() {
      const mins = Math.floor(this.countdownRemainingSeconds / 60);
      const secs = this.countdownRemainingSeconds % 60;
      const formatted = `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;

      const numDisplay = document.getElementById('timer-countdown-digits');
      if (numDisplay) {
        numDisplay.textContent = formatted;
        numDisplay.classList.toggle('urgent', this.countdownRemainingSeconds <= 5 && this.countdownRemainingSeconds > 0);
        numDisplay.classList.toggle('finished', this.countdownRemainingSeconds === 0);
      }

      const fsNumDisplay = document.getElementById('fs-countdown-digits');
      if (fsNumDisplay) {
        fsNumDisplay.textContent = formatted;
        fsNumDisplay.classList.toggle('urgent', this.countdownRemainingSeconds <= 5 && this.countdownRemainingSeconds > 0);
        fsNumDisplay.classList.toggle('finished', this.countdownRemainingSeconds === 0);
      }

      // Progress bars
      const percent = this.countdownTotalSeconds > 0 ? (this.countdownRemainingSeconds / this.countdownTotalSeconds) * 100 : 0;
      const progressBar = document.getElementById('timer-progress-fill');
      if (progressBar) {
        progressBar.style.width = `${percent}%`;
      }
      const fsProgressBar = document.getElementById('fs-timer-progress-fill');
      if (fsProgressBar) {
        fsProgressBar.style.width = `${percent}%`;
      }

      // Sync with floating mini widget & dock
      if (this.timerMode !== 'stopwatch') {
        const miniDigits = document.getElementById('floating-timer-digits');
        const dockDigits = document.getElementById('dock-timer-digits');
        if (miniDigits) miniDigits.textContent = formatted;
        if (dockDigits) dockDigits.textContent = formatted;
      }
    },

    updateCountdownControls() {
      const lang = window.I18n ? window.I18n.getLanguage() : 'zh-TW';
      const label = this.isCountdownRunning ? (lang === 'en' ? '⏸️ Pause' : '⏸️ 暫停計時') : (lang === 'en' ? '▶️ Start' : '▶️ 開始計時');
      const bg = this.isCountdownRunning ? 'linear-gradient(135deg, #d3a24c, #d97706)' : 'linear-gradient(135deg, #4fae82, #059669)';

      const dockIcon = document.getElementById('dock-timer-state-icon');
      if (dockIcon) {
        dockIcon.textContent = this.isCountdownRunning ? '⏳' : '⏱️';
      }

      const btn = document.getElementById('btn-timer-toggle');
      if (btn) {
        btn.innerHTML = label;
        btn.style.background = bg;
      }
      const fsBtn = document.getElementById('btn-fs-timer-toggle');
      if (fsBtn) {
        fsBtn.innerHTML = label;
        fsBtn.style.background = bg;
      }
    },

    triggerCountdownFinishAnimation() {
      const display = document.getElementById('timer-countdown-digits');
      if (display) {
        display.classList.add('alarm-pulse');
        setTimeout(() => display.classList.remove('alarm-pulse'), 3500);
      }
      const fsDisplay = document.getElementById('fs-countdown-digits');
      if (fsDisplay) {
        fsDisplay.classList.add('alarm-pulse');
        setTimeout(() => fsDisplay.classList.remove('alarm-pulse'), 3500);
      }
    },

    // Stopwatch Methods
    toggleStopwatch() {
      if (this.isStopwatchRunning) {
        this.pauseStopwatch();
      } else {
        this.startStopwatch();
      }
    },

    startStopwatch() {
      this.isStopwatchRunning = true;
      this.stopwatchStartTime = Date.now() - this.stopwatchElapsedMs;
      this.updateStopwatchControls();

      this.stopwatchInterval = setInterval(() => {
        this.stopwatchElapsedMs = Date.now() - this.stopwatchStartTime;
        this.updateStopwatchDisplay();
      }, 30);
    },

    pauseStopwatch() {
      this.isStopwatchRunning = false;
      if (this.stopwatchInterval) {
        clearInterval(this.stopwatchInterval);
        this.stopwatchInterval = null;
      }
      this.updateStopwatchControls();
    },

    resetStopwatch() {
      this.pauseStopwatch();
      this.stopwatchElapsedMs = 0;
      this.stopwatchLaps = [];
      this.updateStopwatchDisplay();
      this.renderStopwatchLaps();
    },

    recordStopwatchLap() {
      if (this.stopwatchElapsedMs === 0) return;
      this.stopwatchLaps.unshift(this.stopwatchElapsedMs);
      this.renderStopwatchLaps();
    },

    updateStopwatchDisplay() {
      const totalMs = this.stopwatchElapsedMs;
      const mins = Math.floor(totalMs / 60000);
      const secs = Math.floor((totalMs % 60000) / 1000);
      const ms = Math.floor((totalMs % 1000) / 10);

      const formatted = `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}.${String(ms).padStart(2, '0')}`;
      const display = document.getElementById('stopwatch-digits');
      if (display) {
        display.textContent = formatted;
      }
      const fsDisplay = document.getElementById('fs-stopwatch-digits');
      if (fsDisplay) {
        fsDisplay.textContent = formatted;
      }

      // Sync with floating mini widget if in stopwatch mode
      if (this.timerMode === 'stopwatch') {
        const miniDigits = document.getElementById('floating-timer-digits');
        if (miniDigits) {
          miniDigits.textContent = formatted;
        }
      }
    },

    renderStopwatchLaps() {
      const container = document.getElementById('stopwatch-laps-list');
      const fsContainer = document.getElementById('fs-stopwatch-laps-list');
      if (container) container.innerHTML = '';
      if (fsContainer) fsContainer.innerHTML = '';

      const isEn = window.I18n && window.I18n.getLanguage() === 'en';
      const lapPrefix = isEn ? 'Lap' : '圈數';

      this.stopwatchLaps.forEach((lapMs, idx) => {
        const mins = Math.floor(lapMs / 60000);
        const secs = Math.floor((lapMs % 60000) / 1000);
        const ms = Math.floor((lapMs % 1000) / 10);
        const formatted = `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}.${String(ms).padStart(2, '0')}`;

        if (container) {
          const lapItem = document.createElement('div');
          lapItem.className = 'stopwatch-lap-item';
          lapItem.innerHTML = `
            <span>${lapPrefix} ${this.stopwatchLaps.length - idx}</span>
            <b>${formatted}</b>
          `;
          container.appendChild(lapItem);
        }

        if (fsContainer) {
          const fsLapItem = document.createElement('div');
          fsLapItem.className = 'btn btn-secondary btn-sm';
          fsLapItem.style.cursor = 'default';
          fsLapItem.style.background = 'rgba(255,255,255,0.08)';
          fsLapItem.style.border = '1px solid rgba(255,255,255,0.15)';
          fsLapItem.innerHTML = `
            <span style="color: var(--text-muted); margin-right: 6px;">${lapPrefix} ${this.stopwatchLaps.length - idx}</span>
            <b style="color: #60a5fa;">${formatted}</b>
          `;
          fsContainer.appendChild(fsLapItem);
        }
      });
    },

    updateStopwatchControls() {
      const lang = window.I18n ? window.I18n.getLanguage() : 'zh-TW';
      const label = this.isStopwatchRunning ? (lang === 'en' ? '⏸️ Pause' : '⏸️ 暫停') : (lang === 'en' ? '▶️ Start' : '▶️ 開始');
      const bg = this.isStopwatchRunning ? 'linear-gradient(135deg, #d3a24c, #d97706)' : 'linear-gradient(135deg, #4fae82, #059669)';

      const btn = document.getElementById('btn-sw-toggle');
      if (btn) {
        btn.innerHTML = label;
        btn.style.background = bg;
      }
      const fsBtn = document.getElementById('btn-fs-sw-toggle');
      if (fsBtn) {
        fsBtn.innerHTML = label;
        fsBtn.style.background = bg;
      }
    },

    // =======================================================================
    // BGM Methods
    // =======================================================================
    async loadBgmList() {
      try {
        const resp = await fetch('/api/system/bgm_list');
        if (resp.ok) {
          const data = await resp.json();
          if (data.music && data.music.length > 0) {
            this.bgmMusicList = data.music;
          }
        }
      } catch (e) {
        console.warn('Failed to load bgm list, using fallback', e);
      }
    },

    playRandomBgm(force = false) {
      if (!this.bgmMusicList || this.bgmMusicList.length === 0) return;
      if (this.isBgmUserMuted && !force) {
        this.updateBgmUi();
        return;
      }

      let nextIndex = Math.floor(Math.random() * this.bgmMusicList.length);
      if (this.bgmMusicList.length > 1 && nextIndex === this.currentBgmIndex) {
        nextIndex = (nextIndex + 1) % this.bgmMusicList.length;
      }
      this.currentBgmIndex = nextIndex;
      const track = this.bgmMusicList[this.currentBgmIndex];

      this.bgmAudio.src = track.url;
      this.bgmAudio.loop = true;
      this.bgmAudio.volume = this.bgmVolume;

      const playPromise = this.bgmAudio.play();
      if (playPromise !== undefined) {
        playPromise.then(() => {
          this.isBgmPlaying = true;
          this.updateBgmUi();
        }).catch(err => {
          console.log('BGM waiting for user interaction:', err);
          this.isBgmPlaying = false;
          this.updateBgmUi();
        });
      }
    },

    toggleBgm() {
      if (this.isBgmPlaying) {
        this.pauseBgm(true);
      } else {
        this.isBgmUserMuted = false;
        localStorage.setItem('toolkit_timer_bgm_muted', 'false');
        if (this.currentBgmIndex >= 0 && this.bgmAudio.src) {
          this.bgmAudio.volume = this.bgmVolume;
          this.bgmAudio.play().then(() => {
            this.isBgmPlaying = true;
            this.updateBgmUi();
          }).catch(e => {
            this.playRandomBgm(true);
          });
        } else {
          this.playRandomBgm(true);
        }
      }
    },

    pauseBgm(setUserMuted = false) {
      if (this.bgmAudio) {
        this.bgmAudio.pause();
      }
      this.isBgmPlaying = false;
      if (setUserMuted) {
        this.isBgmUserMuted = true;
        localStorage.setItem('toolkit_timer_bgm_muted', 'true');
      }
      this.updateBgmUi();
    },

    nextBgm() {
      this.isBgmUserMuted = false;
      localStorage.setItem('toolkit_timer_bgm_muted', 'false');
      this.playRandomBgm(true);
    },

    setBgmVolume(val) {
      this.bgmVolume = Math.max(0, Math.min(1, parseFloat(val) || 0.5));
      localStorage.setItem('toolkit_timer_bgm_vol', String(this.bgmVolume));
      if (this.bgmAudio) {
        this.bgmAudio.volume = this.bgmVolume;
      }
      const s1 = document.getElementById('timer-bgm-vol-slider');
      const s2 = document.getElementById('fs-timer-bgm-vol-slider');
      if (s1) s1.value = this.bgmVolume;
      if (s2) s2.value = this.bgmVolume;
    },

    updateBgmUi() {
      const isEn = (localStorage.getItem('app_lang') === 'en');
      const track = (this.currentBgmIndex >= 0 && this.bgmMusicList[this.currentBgmIndex]) 
        ? this.bgmMusicList[this.currentBgmIndex] 
        : (this.bgmMusicList[0] || { filename: 'BGM_01.mp3' });

      // Track titles
      const nameEl = document.getElementById('timer-bgm-name');
      const fsNameEl = document.getElementById('fs-timer-bgm-name');
      if (nameEl) nameEl.textContent = track.filename || track.title;
      if (fsNameEl) fsNameEl.textContent = track.filename || track.title;

      // Icons & Text
      const iconEl = document.getElementById('timer-bgm-icon');
      const fsIconEl = document.getElementById('fs-timer-bgm-icon');
      const textEl = document.getElementById('timer-bgm-btn-text');
      const fsTextEl = document.getElementById('fs-timer-bgm-btn-text');

      const btn1 = document.getElementById('btn-timer-bgm-toggle');
      const btn2 = document.getElementById('btn-fs-timer-bgm-toggle');

      if (this.isBgmPlaying) {
        if (iconEl) iconEl.textContent = '⏸️';
        if (fsIconEl) fsIconEl.textContent = '⏸️';
        if (textEl) textEl.textContent = isEn ? 'Pause Music' : '暫停音樂';
        if (fsTextEl) fsTextEl.textContent = isEn ? 'Pause Music' : '暫停音樂';
        if (btn1) { btn1.style.background = 'linear-gradient(135deg, #4fae82, #059669)'; }
        if (btn2) { btn2.style.background = 'linear-gradient(135deg, #4fae82, #059669)'; }
      } else {
        if (iconEl) iconEl.textContent = '▶️';
        if (fsIconEl) fsIconEl.textContent = '▶️';
        if (textEl) textEl.textContent = isEn ? 'Play Music' : '播放音樂';
        if (fsTextEl) fsTextEl.textContent = isEn ? 'Play Music' : '播放音樂';
        if (btn1) { btn1.style.background = 'linear-gradient(135deg, #7b98e0, #4a67ba)'; }
        if (btn2) { btn2.style.background = 'linear-gradient(135deg, #7b98e0, #4a67ba)'; }
      }

      // Slider sync
      const s1 = document.getElementById('timer-bgm-vol-slider');
      const s2 = document.getElementById('fs-timer-bgm-vol-slider');
      if (s1) s1.value = this.bgmVolume;
      if (s2) s2.value = this.bgmVolume;
    },

    onEnterTimerTab() {
      if (!this.isBgmPlaying && !this.isBgmUserMuted) {
        this.playRandomBgm(false);
      }
    },

    onLeaveTimerTab() {
      if (this.isBgmPlaying) {
        this.bgmAudio.pause();
        this.isBgmPlaying = false;
        this.updateBgmUi();
      }
    },

    updatePresetButtons() {
      const isEn = window.I18n && window.I18n.getLanguage() === 'en';
      document.querySelectorAll('.btn-timer-preset, .btn-fs-timer-preset').forEach(btn => {
        const secs = parseInt(btn.dataset.seconds, 10);
        if (secs === 30) btn.textContent = isEn ? '30s' : '30 秒';
        else if (secs === 60) btn.textContent = isEn ? '1 min' : '1 分鐘';
        else if (secs === 120) btn.textContent = isEn ? '2 min' : '2 分鐘';
        else if (secs === 180) btn.textContent = isEn ? '3 min' : '3 分鐘';
        else if (secs === 300) btn.textContent = isEn ? '5 min' : '5 分鐘';
        else if (secs === 600) btn.textContent = isEn ? '10 min' : '10 分鐘';
        else if (secs === 900) btn.textContent = isEn ? '15 min' : '15 分鐘';
      });
    }
  };

  TK.TimerEngine = TimerEngine;
})(window);
