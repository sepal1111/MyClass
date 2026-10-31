// MyClass 學生端：StudentApp（文字雲、搶答等即時活動）與啟動流程
// 由 static/js/student.js 拆出（2026-10-31，原第 3788–4156 行），程式內容未變更；縮排保留原樣。
// student.js 與 static/js/student/*.js 共用頁面的全域範圍（一般 <script>），載入順序見 static/student.html。


  // =========================================================================
  // StudentApp: 學生端課堂文字雲與 Kahoot 答題即時互動 (支援獨立分頁與即時彈窗)
  // =========================================================================
  const StudentApp = {
    activeWordCloud: null,
    activeKahoot: null,
    kahootTimer: null,
    kahootTimeLeft: 0,
    myChoice: null,
    myWords: [],

    init() {
      // 1. 文字雲事件綁定 (彈窗與獨立分頁)
      const bindWc = (inputId, btnId) => {
        const input = document.getElementById(inputId);
        const btn = document.getElementById(btnId);
        if (btn) btn.addEventListener('click', () => this.submitWordCloud(inputId));
        if (input) {
          input.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') this.submitWordCloud(inputId);
          });
        }
      };
      bindWc('studentWordCloudInput', 'btnStudentWordCloudSubmit');
      bindWc('studentTabWordCloudInput', 'btnStudentTabWordCloudSubmit');

      document.getElementById('btnStudentWordCloudClose')?.addEventListener('click', () => {
        document.getElementById('modalStudentWordCloud').style.display = 'none';
      });

      // 2. Kahoot 選項按鈕綁定 (彈窗與分頁內的所有四色按鈕)
      document.querySelectorAll('.student-kahoot-opt-btn').forEach(btn => {
        btn.addEventListener('click', (e) => {
          const optIdx = Number(e.currentTarget.dataset.opt);
          this.submitKahootAnswer(optIdx);
        });
      });

      document.getElementById('btnStudentKahootClose')?.addEventListener('click', () => {
        document.getElementById('modalStudentKahoot').style.display = 'none';
      });
    },

    syncWordCloudTab() {
      const emptyEl = document.getElementById('studentWordCloudEmpty');
      const activeEl = document.getElementById('studentWordCloudActive');
      if (!this.activeWordCloud) {
        if (emptyEl) emptyEl.hidden = false;
        if (activeEl) activeEl.hidden = true;
      } else {
        if (emptyEl) emptyEl.hidden = true;
        if (activeEl) activeEl.hidden = false;
        const titleEl = document.getElementById('studentTabWordCloudTitle');
        if (titleEl) titleEl.textContent = this.activeWordCloud.title || '請用一個詞分享你的想法';
        this.renderMyWords();
      }
    },

    syncKahootTab() {
      const emptyEl = document.getElementById('studentKahootEmpty');
      const activeEl = document.getElementById('studentKahootActive');
      if (!this.activeKahoot) {
        if (emptyEl) emptyEl.hidden = false;
        if (activeEl) activeEl.hidden = true;
      } else {
        if (emptyEl) emptyEl.hidden = true;
        if (activeEl) activeEl.hidden = false;
      }
    },

    renderMyWords() {
      const html = this.myWords.length === 0
        ? '<span style="font-size: 0.85rem; color: var(--text-muted);">尚未送出任何詞彙</span>'
        : this.myWords.map(w => `
            <span style="font-size: 0.88rem; font-weight: 800; background: rgba(2, 132, 199, 0.12); color: var(--student-primary-dark); padding: 4px 12px; border-radius: 9999px; border: 1.5px solid var(--student-primary-border); display: inline-flex; align-items: center; gap: 4px;">
              <span>💬</span> ${escapeHtml(w)}
            </span>
          `).join('');

      const el1 = document.getElementById('studentWordCloudMyWords');
      const el2 = document.getElementById('studentTabWordCloudMyWords');
      if (el1) el1.innerHTML = html;
      if (el2) el2.innerHTML = html;
    },

    onWordCloudStart(payload) {
      this.activeWordCloud = payload;
      this.myWords = [];

      // 自動切換到文字雲分頁
      switchTab('wordCloud');
      this.syncWordCloudTab();

      // 彈窗同步更新
      const modal = document.getElementById('modalStudentWordCloud');
      const titleEl = document.getElementById('studentWordCloudTitle');
      const inputEl = document.getElementById('studentWordCloudInput');
      const tabInput = document.getElementById('studentTabWordCloudInput');

      if (titleEl) titleEl.textContent = payload.title || '請用一個詞分享你的想法';
      const placeholder = `請輸入一個詞（最多 20 字，上限 ${payload.maxWordsPerUser || 3} 個詞）`;
      if (inputEl) {
        inputEl.value = '';
        inputEl.disabled = false;
        inputEl.placeholder = placeholder;
      }
      if (tabInput) {
        tabInput.value = '';
        tabInput.disabled = false;
        tabInput.placeholder = placeholder;
      }

      this.renderMyWords();
      showToast('☁️ 老師已開啟課堂即時文字雲！', 'info');
    },

    onWordCloudEnd() {
      this.activeWordCloud = null;
      this.syncWordCloudTab();
      const modal = document.getElementById('modalStudentWordCloud');
      if (modal) modal.style.display = 'none';
      showToast('☁️ 本次文字雲收集已結束。', 'info');
    },

    submitWordCloud(inputId = 'studentTabWordCloudInput') {
      if (!this.activeWordCloud) {
        showToast('目前沒有進行中的文字雲活動', 'warning');
        return;
      }
      const inputEl = document.getElementById(inputId) || document.getElementById('studentTabWordCloudInput') || document.getElementById('studentWordCloudInput');
      const word = (inputEl?.value || '').trim();
      if (!word) {
        showToast('請輸入詞彙！', 'warning');
        inputEl?.focus();
        return;
      }

      const maxWords = this.activeWordCloud.maxWordsPerUser || 3;
      if (this.myWords.length >= maxWords) {
        showToast(`已達提交上限（最多 ${maxWords} 個詞）！`, 'warning');
        return;
      }

      if (this.activeWordCloud.allowDuplicate === 0 && this.myWords.includes(word)) {
        showToast('你已經提交過這個詞囉！', 'warning');
        return;
      }

      if (window.activeSocket) {
        window.activeSocket.emit('wordcloud:submit', {
          sessionId: this.activeWordCloud.sessionId,
          word
        });
      }

      this.myWords.push(word);
      const in1 = document.getElementById('studentWordCloudInput');
      const in2 = document.getElementById('studentTabWordCloudInput');
      if (in1) in1.value = '';
      if (in2) in2.value = '';

      this.renderMyWords();
      showToast(`已成功送出：${word}`, 'success');

      if (this.myWords.length >= maxWords) {
        if (in1) { in1.disabled = true; in1.placeholder = '已達提交上限，謝謝參與！'; }
        if (in2) { in2.disabled = true; in2.placeholder = '已達提交上限，謝謝參與！'; }
      }
    },

    onKahootQuestion(payload) {
      this.activeKahoot = payload;
      this.myChoice = null;
      this.kahootTimeLeft = payload.timeLimitSec || 20;

      // 自動切換到答題競賽分頁
      switchTab('kahoot');
      this.syncKahootTab();

      // 同步分頁卡片資訊
      const qText = `第 ${payload.questionIndex} / ${payload.totalQuestions} 題`;
      const modeText = payload.mode === 'group' ? '🚩 小組模式' : '🧑 個人模式';
      const promptText = payload.prompt || '請看大螢幕題目，點擊下方選項作答';

      const qb1 = document.getElementById('studentKahootQBadge');
      const qb2 = document.getElementById('studentTabKahootQBadge');
      if (qb1) qb1.textContent = qText;
      if (qb2) qb2.textContent = qText;

      const mb1 = document.getElementById('studentKahootModeBadge');
      const mb2 = document.getElementById('studentTabKahootModeBadge');
      if (mb1) mb1.textContent = modeText;
      if (mb2) mb2.textContent = modeText;

      const pr1 = document.getElementById('studentKahootPrompt');
      const pr2 = document.getElementById('studentTabKahootPrompt');
      if (pr1) pr1.textContent = promptText;
      if (pr2) pr2.textContent = promptText;

      const t1 = document.getElementById('studentKahootTimer');
      const t2 = document.getElementById('studentTabKahootTimer');
      if (t1) t1.textContent = this.kahootTimeLeft;
      if (t2) t2.textContent = this.kahootTimeLeft;

      // 顯示選項網格，隱藏揭曉提示
      const setDisplay = (id, val) => { const el = document.getElementById(id); if (el) el.style.display = val; };
      setDisplay('studentKahootBtnGrid', 'grid');
      setDisplay('studentTabKahootOptionsGrid', 'grid');
      setDisplay('studentKahootSubmittedNotice', 'none');
      setDisplay('studentTabKahootSubmittedNotice', 'none');
      setDisplay('studentKahootResultNotice', 'none');
      setDisplay('studentTabKahootResultNotice', 'none');
      setDisplay('studentKahootFinalSummary', 'none');
      setDisplay('studentTabKahootFinalSummary', 'none');

      // 更新按鈕文字與狀態
      const options = payload.options || [];
      document.querySelectorAll('.student-kahoot-opt-btn').forEach(btn => {
        const idx = Number(btn.dataset.opt);
        btn.disabled = false;
        btn.style.opacity = '1';
        btn.style.transform = 'none';
        btn.style.border = 'none';

        const optData = options[idx];
        if (optData) {
          btn.style.display = 'flex';
          const txt = optData.text || ['A','B','C','D'][idx];
          const t1 = document.getElementById(`student-kahoot-text-${idx}`);
          const t2 = document.getElementById(`student-tab-kahoot-text-${idx}`);
          if (t1) t1.textContent = txt;
          if (t2) t2.textContent = txt;
        } else {
          btn.style.display = 'none';
        }
      });

      if (this.kahootTimer) clearInterval(this.kahootTimer);
      this.kahootTimer = setInterval(() => {
        this.kahootTimeLeft--;
        const curSec = Math.max(0, this.kahootTimeLeft);
        if (t1) t1.textContent = curSec;
        if (t2) t2.textContent = curSec;
        if (this.kahootTimeLeft <= 0) {
          clearInterval(this.kahootTimer);
          this.kahootTimer = null;
          if (this.myChoice === null) {
            document.querySelectorAll('.student-kahoot-opt-btn').forEach(btn => btn.disabled = true);
          }
        }
      }, 1000);

      showToast(`🎮 答題競賽：第 ${payload.questionIndex} 題開始！`, 'info');
    },

    submitKahootAnswer(optionIndex) {
      if (this.myChoice !== null || !this.activeKahoot) return;
      this.myChoice = optionIndex;

      const timeMsRemaining = Math.max(0, this.kahootTimeLeft * 1000);

      if (window.activeSocket) {
        window.activeSocket.emit('kahoot:answer', {
          questionId: this.activeKahoot.questionId,
          optionIndex,
          timeMsRemaining
        });
      }

      // 隱藏選項，顯示等待揭曉
      const setDisplay = (id, val) => { const el = document.getElementById(id); if (el) el.style.display = val; };
      setDisplay('studentKahootBtnGrid', 'none');
      setDisplay('studentTabKahootOptionsGrid', 'none');
      setDisplay('studentKahootSubmittedNotice', 'block');
      setDisplay('studentTabKahootSubmittedNotice', 'block');

      showToast(`已送出答案：選項 ${['A','B','C','D'][optionIndex]}`, 'success');
    },

    onKahootAnswerRevealed(payload) {
      if (this.kahootTimer) {
        clearInterval(this.kahootTimer);
        this.kahootTimer = null;
      }

      const setDisplay = (id, val) => { const el = document.getElementById(id); if (el) el.style.display = val; };
      setDisplay('studentKahootSubmittedNotice', 'none');
      setDisplay('studentTabKahootSubmittedNotice', 'none');
      setDisplay('studentKahootResultNotice', 'block');
      setDisplay('studentTabKahootResultNotice', 'block');

      const isCorrect = this.myChoice !== null && this.myChoice === payload.correctOptionIndex;

      const updateResultUI = (prefix) => {
        const notice = document.getElementById(`${prefix}ResultNotice`);
        const iconEl = document.getElementById(`${prefix}ResultIcon`);
        const titleEl = document.getElementById(`${prefix}ResultTitle`);
        const scoreEl = document.getElementById(`${prefix}ResultScore`);
        const expEl = document.getElementById(`${prefix}ResultExplanation`);
        if (!notice) return;

        if (isCorrect) {
          notice.style.background = 'linear-gradient(135deg, rgba(22, 163, 74, 0.3), rgba(15, 23, 42, 0.9))';
          notice.style.border = '2px solid #22c55e';
          if (iconEl) iconEl.textContent = '🎉';
          if (titleEl) { titleEl.textContent = '太棒了！答對了！'; titleEl.style.color = '#4ade80'; }
          if (scoreEl) {
            scoreEl.style.display = 'block';
            scoreEl.textContent = `+${this.activeKahoot?.points || 1000} 分 (含競速加成)`;
          }
        } else {
          notice.style.background = 'linear-gradient(135deg, rgba(220, 38, 38, 0.25), rgba(15, 23, 42, 0.9))';
          notice.style.border = '2px solid #ef4444';
          if (iconEl) iconEl.textContent = this.myChoice === null ? '⏰' : '❌';
          if (titleEl) {
            titleEl.textContent = this.myChoice === null ? '時間到！未送出答案' : '答錯囉！繼續加油！';
            titleEl.style.color = '#f87171';
          }
          if (scoreEl) scoreEl.style.display = 'none';
        }

        if (expEl) {
          if (payload.explanation) {
            expEl.textContent = `💡 解析：${payload.explanation}`;
            expEl.style.display = 'block';
          } else {
            expEl.style.display = 'none';
          }
        }
      };

      updateResultUI('studentKahoot');
      updateResultUI('studentTabKahoot');
    },

    onNotification(payload) {
      Notifications.refresh();
      if (payload && payload.title) showToast(`🔔 ${payload.title}`, 'info');
    },

    onKahootFinished(payload) {
      if (this.kahootTimer) {
        clearInterval(this.kahootTimer);
        this.kahootTimer = null;
      }

      const setDisplay = (id, val) => { const el = document.getElementById(id); if (el) el.style.display = val; };
      setDisplay('studentKahootBtnGrid', 'none');
      setDisplay('studentTabKahootOptionsGrid', 'none');
      setDisplay('studentKahootSubmittedNotice', 'none');
      setDisplay('studentTabKahootSubmittedNotice', 'none');
      setDisplay('studentKahootResultNotice', 'none');
      setDisplay('studentTabKahootResultNotice', 'none');
      setDisplay('studentKahootFinalSummary', 'block');
      setDisplay('studentTabKahootFinalSummary', 'block');

      showToast('🏆 答題競賽圓滿結束！請觀看大螢幕排行榜。', 'info');
    }
  };

  window.StudentApp = StudentApp;

  (async function init() {
    StudentApp.init();
    if (await tryResumeSession()) {
      showContent();
    }
  })();
