// 課堂工具箱：課堂即時文字雲
// 由 static/js/toolkit.js 拆出（2026-10-30），程式內容未變更。載入順序見 static/index.html；
// 模組之間透過 window.ToolkitModules 取用彼此（toolkit/common.js 建立）。
(function (window) {
  'use strict';
  const TK = window.ToolkitModules;
  const AudioEngine = window.AudioEngine;
  const { escapeHtml } = TK;

  // =========================================================================
  // 6. WordCloud (課堂即時文字雲 - 螺旋防重疊算法、詞頻統計與多色彩主題)
  // =========================================================================
  const WordCloud = {
    currentCourseId: null,
    currentSession: null,
    words: new Map(),
    totalWordsCount: 0,
    wordsList: [],
    spiralWords: [],
    colors: [
      '#38bdf8', '#818cf8', '#c084fc', '#f472b6', '#fb7185',
      '#34d399', '#fbbf24', '#f97316', '#a78bfa', '#22d3ee',
      '#4ade80', '#e879f9'
    ],

    getCourseId() {
      if (window.AppState && window.AppState.currentCourseId) {
        return Number(window.AppState.currentCourseId);
      }
      return this.currentCourseId;
    },

    init() {
      const btnStart = document.getElementById('btn-wordcloud-start');
      const btnStop = document.getElementById('btn-wordcloud-stop');
      const btnClear = document.getElementById('btn-wordcloud-clear');
      const btnExport = document.getElementById('btn-wordcloud-export');
      const btnFullscreen = document.getElementById('btn-wordcloud-fullscreen');
      const btnHistory = document.getElementById('btn-wordcloud-history');
      const btnCloseHistory = document.getElementById('btn-close-wordcloud-history');

      if (btnStart) btnStart.addEventListener('click', () => this.startSession());
      if (btnStop) btnStop.addEventListener('click', () => this.stopSession());
      if (btnClear) btnClear.addEventListener('click', () => this.clearWords());
      if (btnExport) btnExport.addEventListener('click', () => this.exportImage());
      if (btnFullscreen) btnFullscreen.addEventListener('click', () => this.toggleFullscreen());
      if (btnHistory) btnHistory.addEventListener('click', () => this.openHistory());
      if (btnCloseHistory) btnCloseHistory.addEventListener('click', () => {
        document.getElementById('modal-wordcloud-history')?.classList.remove('open');
      });

      window.addEventListener('resize', () => {
        if (this.words.size > 0) this.renderCloud();
      });
    },

    async loadCourse(courseId) {
      this.currentCourseId = Number(courseId);
      if (!this.currentCourseId) return;

      try {
        const res = await fetch(`/api/wordclouds/${this.currentCourseId}`);
        if (!res.ok) return;
        const sessions = await res.json();
        const active = sessions.find(s => s.status === 'active');
        if (active) {
          this.setSession(active);
        } else {
          this.resetUI();
        }
      } catch (err) {
        console.error('[WordCloud] loadCourse error:', err);
      }
    },

    setSession(session) {
      this.currentSession = session;
      const titleInput = document.getElementById('wordcloud-title-input');
      const badge = document.getElementById('wordcloud-status-badge');
      const btnStart = document.getElementById('btn-wordcloud-start');
      const btnStop = document.getElementById('btn-wordcloud-stop');
      const btnClear = document.getElementById('btn-wordcloud-clear');

      if (titleInput) titleInput.value = session.title || '';
      if (badge) {
        badge.textContent = session.status === 'active' ? '🟢 收集進行中' : '⚪ 已停止收集';
        badge.style.background = session.status === 'active' ? 'rgba(16, 185, 129, 0.2)' : 'rgba(148, 163, 184, 0.2)';
        badge.style.color = session.status === 'active' ? '#34d399' : '#cbd5e1';
      }

      if (btnStart) btnStart.style.display = session.status === 'active' ? 'none' : 'inline-flex';
      if (btnStop) btnStop.style.display = session.status === 'active' ? 'inline-flex' : 'none';
      if (btnClear) btnClear.style.display = 'inline-flex';

      this.words.clear();
      this.wordsList = Array.isArray(session.words) ? session.words : [];
      this.totalWordsCount = this.wordsList.length;

      this.wordsList.forEach(w => {
        const text = w.word;
        this.words.set(text, (this.words.get(text) || 0) + 1);
      });

      this.renderCloud();
      this.renderRanking();
    },

    resetUI() {
      this.currentSession = null;
      this.words.clear();
      this.wordsList = [];
      this.totalWordsCount = 0;

      const badge = document.getElementById('wordcloud-status-badge');
      const btnStart = document.getElementById('btn-wordcloud-start');
      const btnStop = document.getElementById('btn-wordcloud-stop');
      const btnClear = document.getElementById('btn-wordcloud-clear');

      if (badge) {
        badge.textContent = '未開始';
        badge.style.background = 'rgba(148, 163, 184, 0.2)';
        badge.style.color = '#cbd5e1';
      }
      if (btnStart) btnStart.style.display = 'inline-flex';
      if (btnStop) btnStop.style.display = 'none';
      if (btnClear) btnClear.style.display = 'none';

      const stage = document.getElementById('wordcloud-stage');
      const emptyHint = document.getElementById('wordcloud-empty-hint');
      const rankingList = document.getElementById('wordcloud-ranking-list');
      const statsCount = document.getElementById('wordcloud-stats-count');

      if (stage) stage.innerHTML = '';
      if (emptyHint) emptyHint.style.display = 'block';
      if (rankingList) rankingList.innerHTML = '<div style="color: #64748b; font-size: 0.85rem; text-align: center; padding: 20px 0;">暫無數據</div>';
      if (statsCount) statsCount.textContent = '共 0 詞';
    },

    async startSession() {
      const courseId = this.getCourseId();
      if (!courseId) {
        alert('請先選擇或載入班級！');
        return;
      }
      const titleInput = document.getElementById('wordcloud-title-input');
      const title = (titleInput?.value || '').trim();
      if (!title) {
        alert('請先輸入提示主題！');
        titleInput?.focus();
        return;
      }

      const allowDuplicate = document.getElementById('wordcloud-allow-duplicate')?.checked ? 1 : 0;
      const maxWords = Number(document.getElementById('wordcloud-max-words')?.value) || 3;

      try {
        const res = await fetch(`/api/wordclouds/${courseId}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            title,
            allow_duplicate: allowDuplicate,
            max_words_per_user: maxWords
          })
        });
        if (!res.ok) {
          const err = await res.json().catch(() => ({}));
          throw new Error(err.detail || '啟動文字雲失敗');
        }
        const session = await res.json();
        this.setSession(session);

        if (window.activeSocket) {
          window.activeSocket.emit('wordcloud:start', {
            sessionId: session.id,
            title: session.title,
            allowDuplicate: session.allow_duplicate,
            maxWordsPerUser: session.max_words_per_user
          });
        }
      } catch (err) {
        alert(err.message);
      }
    },

    async stopSession() {
      if (!this.currentSession) return;
      const courseId = this.getCourseId();
      try {
        const res = await fetch(`/api/wordclouds/${courseId}/${this.currentSession.id}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ status: 'closed' })
        });
        if (res.ok) {
          this.currentSession.status = 'closed';
          const badge = document.getElementById('wordcloud-status-badge');
          const btnStart = document.getElementById('btn-wordcloud-start');
          const btnStop = document.getElementById('btn-wordcloud-stop');
          if (badge) {
            badge.textContent = '⚪ 已停止收集';
            badge.style.background = 'rgba(148, 163, 184, 0.2)';
            badge.style.color = '#cbd5e1';
          }
          if (btnStart) btnStart.style.display = 'inline-flex';
          if (btnStop) btnStop.style.display = 'none';

          if (window.activeSocket) {
            window.activeSocket.emit('wordcloud:end', { sessionId: this.currentSession.id });
          }
        }
      } catch (err) {
        console.error('[WordCloud] stop error:', err);
      }
    },

    async clearWords() {
      if (!this.currentSession) return;
      if (!(await window.showConfirmModal({
        title: '確定要清空當前文字雲的所有詞彙嗎？',
        desc: '此動作無法復原。',
        icon: '🧹',
        danger: true,
        confirmText: '清空',
      }))) return;

      const courseId = this.getCourseId();
      try {
        const res = await fetch(`/api/wordclouds/${courseId}/${this.currentSession.id}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ clear_words: true })
        });
        if (res.ok) {
          this.words.clear();
          this.wordsList = [];
          this.totalWordsCount = 0;
          this.renderCloud();
          this.renderRanking();
        }
      } catch (err) {
        alert('清空失敗：' + err.message);
      }
    },

    onNewWord(payload) {
      if (!this.currentSession || this.currentSession.id !== payload.sessionId) {
        return;
      }
      const word = payload.word;
      this.words.set(word, (this.words.get(word) || 0) + 1);
      this.totalWordsCount++;

      AudioEngine?.playChime?.();

      this.renderCloud();
      this.renderRanking();
    },

    renderCloud() {
      const stage = document.getElementById('wordcloud-stage');
      const emptyHint = document.getElementById('wordcloud-empty-hint');
      const container = document.getElementById('wordcloud-canvas-container');
      if (!stage || !container) return;

      if (this.words.size === 0) {
        stage.innerHTML = '';
        if (emptyHint) emptyHint.style.display = 'block';
        return;
      }
      if (emptyHint) emptyHint.style.display = 'none';

      const width = container.clientWidth || 650;
      const height = container.clientHeight || 480;

      const entries = Array.from(this.words.entries()).sort((a, b) => b[1] - a[1]);
      const maxCount = entries[0]?.[1] || 1;

      const placedRects = [];
      const placedWords = [];

      entries.forEach(([word, count], idx) => {
        const rel = count / maxCount;
        const fontSize = Math.round(18 + rel * 46);
        const color = this.colors[Math.abs(word.charCodeAt(0) * 13 + (word.charCodeAt(1) || 7)) % this.colors.length];

        const estWidth = word.length * (fontSize * 0.95) + 16;
        const estHeight = fontSize * 1.3;

        let found = false;
        let x = 0, y = 0;

        if (idx === 0) {
          x = (width - estWidth) / 2;
          y = (height - estHeight) / 2;
          found = true;
        } else {
          let radius = Math.min(estWidth, estHeight) * 0.4 + 20;
          const maxRadius = Math.max(width, height);
          const angleOffset = (word.charCodeAt(0) * 23) % 360;

          while (!found && radius < maxRadius) {
            for (let a = 0; a < 360; a += 20) {
              const rad = ((angleOffset + a) * Math.PI) / 180;
              x = width / 2 + radius * Math.cos(rad) - estWidth / 2;
              y = height / 2 + radius * Math.sin(rad) - estHeight / 2;

              const pad = 6;
              const rect = {
                left: x - pad,
                top: y - pad,
                right: x + estWidth + pad,
                bottom: y + estHeight + pad,
              };

              if (rect.left > 10 && rect.top > 10 && rect.right < width - 10 && rect.bottom < height - 10) {
                const overlaps = placedRects.some(p => !(
                  rect.right < p.left ||
                  rect.left > p.right ||
                  rect.bottom < p.top ||
                  rect.top > p.bottom
                ));
                if (!overlaps) {
                  found = true;
                  break;
                }
              }
            }
            radius += 10;
          }
        }

        if (found) {
          placedRects.push({
            left: x,
            top: y,
            right: x + estWidth,
            bottom: y + estHeight,
          });
          placedWords.push({ word, count, x, y, fontSize, color, isTop: idx === 0 });
        }
      });

      this.spiralWords = placedWords;

      stage.innerHTML = placedWords.map(w => `
        <div class="wordcloud-item" style="
          position: absolute;
          left: ${Math.round(w.x)}px;
          top: ${Math.round(w.y)}px;
          font-size: ${w.fontSize}px;
          color: ${w.color};
          font-weight: 800;
          line-height: 1.2;
          text-shadow: 0 2px 10px rgba(0,0,0,0.6)${w.isTop ? ', 0 0 20px ' + w.color : ''};
          transition: all 0.3s cubic-bezier(0.16, 1, 0.3, 1);
          user-select: none;
          display: flex;
          align-items: center;
          gap: 6px;
        ">
          <span>${escapeHtml(w.word)}</span>
        </div>
      `).join('');
    },

    renderRanking() {
      const listEl = document.getElementById('wordcloud-ranking-list');
      const countEl = document.getElementById('wordcloud-stats-count');
      if (!listEl) return;

      const entries = Array.from(this.words.entries()).sort((a, b) => b[1] - a[1]);
      if (countEl) countEl.textContent = `共 ${entries.length} 詞（${this.totalWordsCount} 次提交）`;

      if (entries.length === 0) {
        listEl.innerHTML = '<div style="color: var(--text-muted, #64748b); font-size: 0.85rem; text-align: center; padding: 20px 0;">暫無數據</div>';
        return;
      }

      const maxCount = entries[0]?.[1] || 1;

      listEl.innerHTML = entries.map(([word, count], i) => {
        const rankBg = i === 0 ? '#f59e0b' : i === 1 ? '#94a3b8' : i === 2 ? '#b45309' : '#e2e8f0';
        const rankColor = i < 3 ? '#ffffff' : '#475569';
        // 語詞次數越多，大小越大（基礎 0.95rem 至最高 1.45rem）
        const ratio = maxCount > 1 ? (count - 1) / (maxCount - 1) : 0;
        const fontSize = (0.95 + ratio * 0.5).toFixed(2) + 'rem';

        return `
          <div title="${escapeHtml(word)}（${count} 次）" style="
            display: flex;
            align-items: center;
            gap: 10px;
            padding: 8px 12px;
            background: var(--bg-main, #f8fafc);
            border-radius: var(--radius-sm, 8px);
            border: 1px solid var(--card-border, #e2e8f0);
            box-shadow: 0 1px 2px rgba(0,0,0,0.03);
            transition: all 0.2s ease;
          ">
            <span style="
              flex-shrink: 0;
              font-weight: 800;
              font-size: 0.85rem;
              width: 22px;
              height: 22px;
              border-radius: 50%;
              display: flex;
              align-items: center;
              justify-content: center;
              background: ${rankBg};
              color: ${rankColor};
            ">
              ${i + 1}
            </span>
            <span style="
              font-weight: ${count > 1 ? 800 : 700};
              font-size: ${fontSize};
              color: var(--text-main, #1e293b);
              line-height: 1.25;
              word-break: break-word;
            ">
              ${escapeHtml(word)}
            </span>
          </div>
        `;
      }).join('');
    },

    exportImage() {
      const container = document.getElementById('wordcloud-canvas-container');
      if (!container || this.spiralWords.length === 0) {
        alert('目前無文字雲內容可匯出');
        return;
      }

      const canvas = document.createElement('canvas');
      const width = container.clientWidth || 800;
      const height = container.clientHeight || 600;
      canvas.width = width * 2;
      canvas.height = height * 2;
      const ctx = canvas.getContext('2d');
      if (!ctx) return;

      ctx.scale(2, 2);

      const bgGrad = ctx.createRadialGradient(width / 2, height / 2, 20, width / 2, height / 2, width / 2);
      bgGrad.addColorStop(0, '#1e293b');
      bgGrad.addColorStop(1, '#0f172a');
      ctx.fillStyle = bgGrad;
      ctx.fillRect(0, 0, width, height);

      ctx.fillStyle = '#94a3b8';
      ctx.font = 'bold 16px sans-serif';
      ctx.fillText(this.currentSession?.title || '課堂文字雲', 20, 32);

      this.spiralWords.forEach(w => {
        ctx.fillStyle = w.color;
        ctx.font = `800 ${w.fontSize}px "Segoe UI", "PingFang TC", "Microsoft JhengHei", sans-serif`;
        ctx.fillText(w.word, w.x, w.y + w.fontSize);
      });

      const link = document.createElement('a');
      link.download = `文字雲_${this.currentSession?.title || '紀錄'}_${Date.now()}.png`;
      link.href = canvas.toDataURL('image/png');
      link.click();
    },

    toggleFullscreen() {
      const elem = document.getElementById('wordcloud-canvas-container');
      if (!elem) return;
      if (!document.fullscreenElement) {
        elem.requestFullscreen().catch(() => {});
      } else {
        document.exitFullscreen().catch(() => {});
      }
    },

    async openHistory() {
      const courseId = this.getCourseId();
      if (!courseId) return;

      const modal = document.getElementById('modal-wordcloud-history');
      const listEl = document.getElementById('wordcloud-history-list');
      if (!modal || !listEl) return;

      modal.classList.add('open');
      listEl.innerHTML = '<div style="text-align: center; color: #94a3b8; padding: 20px 0;">載入中...</div>';

      try {
        const res = await fetch(`/api/wordclouds/${courseId}`);
        const sessions = await res.json();
        if (sessions.length === 0) {
          listEl.innerHTML = '<div style="text-align: center; color: #64748b; padding: 30px 0;">尚無歷史文字雲紀錄</div>';
          return;
        }

        listEl.innerHTML = sessions.map(s => `
          <div style="display: flex; align-items: center; justify-content: space-between; padding: 12px 16px; background: var(--bg-main, #f8fafc); border-radius: var(--radius-md); border: 1px solid var(--card-border);">
            <div>
              <div style="font-weight: 800; font-size: 1rem; color: var(--text-main, #1e293b);">${s.title}</div>
              <div style="font-size: 0.82rem; color: var(--text-muted, #64748b); margin-top: 4px;">
                狀態：${s.status === 'active' ? '🟢 進行中' : '⚪ 已關閉'} ｜ 總收集：${(s.words || []).length} 個詞 ｜ 時間：${s.created_at || ''}
              </div>
            </div>
            <div style="display: flex; gap: 8px;">
              <button type="button" class="btn btn-sm btn-primary" onclick="TeachingToolkit.wordCloud.loadSpecificSession(${s.id})">載入查看</button>
              <button type="button" class="btn btn-sm btn-secondary" style="color: #f87171;" onclick="TeachingToolkit.wordCloud.deleteSession(${s.id})">刪除</button>
            </div>
          </div>
        `).join('');
      } catch (err) {
        listEl.innerHTML = `<div style="color: #f87171; padding: 20px 0;">載入失敗：${err.message}</div>`;
      }
    },

    async loadSpecificSession(sessionId) {
      const courseId = this.getCourseId();
      try {
        const res = await fetch(`/api/wordclouds/${courseId}/${sessionId}`);
        if (res.ok) {
          const s = await res.json();
          this.setSession(s);
          document.getElementById('modal-wordcloud-history')?.classList.remove('open');
        }
      } catch (err) {
        alert(err.message);
      }
    },

    async deleteSession(sessionId) {
      if (!(await window.showConfirmModal({ title: '確定要刪除此歷史文字雲嗎？', danger: true, confirmText: '刪除' }))) return;
      const courseId = this.getCourseId();
      try {
        const res = await fetch(`/api/wordclouds/${courseId}/${sessionId}`, { method: 'DELETE' });
        if (res.ok) {
          if (this.currentSession?.id === sessionId) {
            this.resetUI();
          }
          this.openHistory();
        }
      } catch (err) {
        alert(err.message);
      }
    }
  };

  TK.WordCloud = WordCloud;
})(window);
