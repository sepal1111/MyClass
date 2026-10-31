// 課堂工具箱：課堂答題競賽
// 由 static/js/toolkit.js 拆出（2026-10-30），程式內容未變更。載入順序見 static/index.html；
// 模組之間透過 window.ToolkitModules 取用彼此（toolkit/common.js 建立）。
(function (window) {
  'use strict';
  const TK = window.ToolkitModules;
  const AudioEngine = window.AudioEngine;

  // =========================================================================
  // 7. KahootGame (課堂答題競賽 - 個人與小組模式、實時競速計分與頒獎台)
  // =========================================================================
  const KahootGame = {
    currentCourseId: null,
    sets: [],
    selectedSet: null,
    questions: [],
    mode: 'individual',
    currentQIndex: 0,
    currentQuestion: null,
    phase: 'lobby',
    timeLeft: 20,
    timerHandle: null,
    answers: new Map(),
    scores: new Map(),
    groupScores: new Map(),
    importLmsQuizzes: [],
    importQuestionsDraft: [],
    importCsvQuestionsDraft: [],
    importTab: 'lms',
    importTargetMode: 'new',

    getCourseId() {
      if (window.AppState && window.AppState.currentCourseId) {
        return Number(window.AppState.currentCourseId);
      }
      return this.currentCourseId;
    },

    init() {
      document.getElementById('btn-kahoot-manage-sets')?.addEventListener('click', () => this.openManageModal());
      document.getElementById('btn-close-kahoot-manage')?.addEventListener('click', () => {
        document.getElementById('modal-kahoot-manage-sets')?.classList.remove('open');
      });
      document.getElementById('btn-close-kahoot-q-edit')?.addEventListener('click', () => {
        document.getElementById('modal-kahoot-edit-question')?.classList.remove('open');
      });

      document.getElementById('kahoot-set-select')?.addEventListener('change', (e) => {
        const setId = Number(e.target.value);
        this.selectSet(setId);
      });

      document.querySelectorAll('input[name="kahoot-mode"]').forEach(r => {
        r.addEventListener('change', (e) => {
          this.mode = e.target.value;
        });
      });

      document.getElementById('btn-kahoot-start-game')?.addEventListener('click', () => this.startGame());
      document.getElementById('btn-kahoot-reveal-answer')?.addEventListener('click', () => this.revealAnswer());
      document.getElementById('btn-kahoot-next-question')?.addEventListener('click', () => this.nextQuestion());
      document.getElementById('btn-kahoot-end-game')?.addEventListener('click', () => this.endGame());
      document.getElementById('btn-kahoot-award-points')?.addEventListener('click', () => this.awardPointsToBoard());
      document.getElementById('btn-kahoot-restart-lobby')?.addEventListener('click', () => this.returnToLobby());
      document.getElementById('btn-kahoot-fullscreen')?.addEventListener('click', () => {
        const elem = document.getElementById('kahoot-stage-container');
        if (!elem) return;
        if (!document.fullscreenElement) elem.requestFullscreen().catch(() => {});
        else document.exitFullscreen().catch(() => {});
      });

      document.getElementById('btn-kahoot-create-set')?.addEventListener('click', () => this.promptCreateSet());
      document.getElementById('btn-kahoot-add-question')?.addEventListener('click', () => this.openEditQuestionModal());
      document.getElementById('btn-kahoot-delete-set')?.addEventListener('click', () => this.deleteCurrentSet());
      document.getElementById('form-kahoot-question')?.addEventListener('submit', (e) => this.handleSaveQuestion(e));

      // 題庫匯入（LMS 線上測驗 / CSV 檔案）
      document.getElementById('btn-close-kahoot-import')?.addEventListener('click', () => {
        document.getElementById('modal-kahoot-import-quiz')?.classList.remove('open');
      });
      document.getElementById('btn-cancel-kahoot-import')?.addEventListener('click', () => {
        document.getElementById('modal-kahoot-import-quiz')?.classList.remove('open');
      });
      document.getElementById('btn-kahoot-import-set')?.addEventListener('click', () => this.openImportModal('new'));
      document.getElementById('btn-kahoot-import-to-current')?.addEventListener('click', () => this.openImportModal('append'));
      document.getElementById('tab-kahoot-import-lms')?.addEventListener('click', () => this.switchImportTab('lms'));
      document.getElementById('tab-kahoot-import-csv')?.addEventListener('click', () => this.switchImportTab('csv'));
      document.getElementById('select-kahoot-import-lms-quiz')?.addEventListener('change', (e) => this.onSelectImportLmsQuiz(e.target.value));
      document.getElementById('chk-kahoot-import-select-all')?.addEventListener('change', (e) => this.toggleSelectAllImportQuestions(e.target.checked));
      document.getElementById('input-kahoot-import-csv-file')?.addEventListener('change', (e) => this.handleImportCsvFile(e.target.files?.[0]));
      document.getElementById('btn-kahoot-download-csv-template')?.addEventListener('click', () => this.downloadImportCsvTemplate());
      document.getElementById('btn-confirm-kahoot-import')?.addEventListener('click', () => this.handleConfirmImport());
      document.querySelectorAll('input[name="kahoot-import-target-mode"]').forEach(r => {
        r.addEventListener('change', (e) => this.onImportTargetModeChange(e.target.value));
      });
    },

    async loadCourse(courseId) {
      this.currentCourseId = Number(courseId);
      if (!this.currentCourseId) return;

      try {
        const res = await fetch(`/api/quiz-sets/${this.currentCourseId}`);
        if (!res.ok) return;
        this.sets = await res.json();
        this.renderSetDropdown();
      } catch (err) {
        console.error('[KahootGame] loadCourse error:', err);
      }
    },

    renderSetDropdown() {
      const select = document.getElementById('kahoot-set-select');
      if (!select) return;
      if (this.sets.length === 0) {
        select.innerHTML = '<option value="">(尚未建立題庫)</option>';
        this.selectedSet = null;
        this.questions = [];
        return;
      }

      select.innerHTML = this.sets.map(s => `
        <option value="${s.id}">${s.title} (${s.question_count} 題)</option>
      `).join('');

      const firstId = this.sets[0].id;
      select.value = firstId;
      this.selectSet(firstId);
    },

    async selectSet(setId) {
      const idNum = Number(setId);
      this.selectedSet = this.sets.find(s => s.id === idNum) || null;
      if (!this.selectedSet) return;

      try {
        const res = await fetch(`/api/quiz-sets/${this.currentCourseId}/${setId}/questions`);
        if (res.ok) {
          this.questions = await res.json();
          const lobbyTitle = document.getElementById('kahoot-lobby-title');
          const lobbyDesc = document.getElementById('kahoot-lobby-desc');
          if (lobbyTitle) lobbyTitle.textContent = `準備開始：${this.selectedSet.title}`;
          if (lobbyDesc) lobbyDesc.textContent = `共 ${this.questions.length} 道題目。請選擇個人或小組競賽模式，點擊下方按鈕啟動！`;
        }
      } catch (err) {
        console.error('[KahootGame] selectSet error:', err);
      }
    },

    startGame() {
      if (!this.selectedSet || this.questions.length === 0) {
        alert('請先選擇包含題目的題庫，或至題庫管理中新增題目！');
        return;
      }

      this.currentQIndex = 0;
      this.scores.clear();
      this.groupScores.clear();
      this.startQuestion(0);
    },

    startQuestion(index) {
      if (index >= this.questions.length) {
        this.showPodium();
        return;
      }

      this.currentQIndex = index;
      this.currentQuestion = this.questions[index];
      this.phase = 'running';
      this.answers.clear();
      this.timeLeft = this.currentQuestion.time_limit_sec || 20;

      document.getElementById('kahoot-lobby-view').style.display = 'none';
      document.getElementById('kahoot-podium-view').style.display = 'none';
      const runningView = document.getElementById('kahoot-running-view');
      runningView.style.display = 'flex';

      document.getElementById('kahoot-q-badge').textContent = `第 ${index + 1} / ${this.questions.length} 題`;
      document.getElementById('kahoot-mode-badge').textContent = this.mode === 'group' ? '🚩 小組競賽模式' : '🧑 個人競賽模式';
      document.getElementById('kahoot-question-text').textContent = this.currentQuestion.prompt;
      document.getElementById('kahoot-timer-text').textContent = this.timeLeft;
      document.getElementById('kahoot-answered-count').textContent = '0';

      const totalStudentsCount = window.AppState?.students?.length || 0;
      document.getElementById('kahoot-total-students').textContent = `/ ${totalStudentsCount}`;

      const imgWrap = document.getElementById('kahoot-question-img-wrap');
      const imgEl = document.getElementById('kahoot-question-img');
      if (this.currentQuestion.image_url) {
        imgEl.src = this.currentQuestion.image_url;
        imgWrap.style.display = 'block';
      } else {
        imgWrap.style.display = 'none';
      }

      const options = this.currentQuestion.options || [];
      for (let i = 0; i < 4; i++) {
        const card = document.getElementById(`kahoot-opt-card-${i}`);
        const textEl = document.getElementById(`kahoot-opt-text-${i}`);
        const statEl = document.getElementById(`kahoot-opt-stat-${i}`);
        if (!card) continue;

        if (i < options.length) {
          card.style.display = 'flex';
          card.style.opacity = '1';
          card.style.border = 'none';
          card.style.boxShadow = 'none';
          textEl.textContent = options[i].text || `選項 ${['A','B','C','D'][i]}`;
          statEl.style.display = 'none';
          statEl.textContent = '0 票';
        } else {
          card.style.display = 'none';
        }
      }

      document.getElementById('kahoot-explanation-box').style.display = 'none';
      document.getElementById('btn-kahoot-reveal-answer').style.display = 'inline-flex';
      document.getElementById('btn-kahoot-next-question').style.display = 'none';

      if (window.activeSocket) {
        window.activeSocket.emit('kahoot:start_question', {
          quizSetId: this.selectedSet.id,
          questionId: this.currentQuestion.id,
          questionIndex: index + 1,
          totalQuestions: this.questions.length,
          mode: this.mode
        });
      }

      if (this.timerHandle) clearInterval(this.timerHandle);
      this.timerHandle = setInterval(() => {
        this.timeLeft--;
        const timerText = document.getElementById('kahoot-timer-text');
        if (timerText) timerText.textContent = Math.max(0, this.timeLeft);

        if (this.timeLeft <= 5 && this.timeLeft > 0) {
          AudioEngine?.playTick?.(false);
        }

        if (this.timeLeft <= 0) {
          clearInterval(this.timerHandle);
          this.timerHandle = null;
          this.revealAnswer();
        }
      }, 1000);
    },

    onStudentAnswered(payload) {
      if (this.phase !== 'running') return;
      this.answers.set(payload.studentId, payload);
      const countEl = document.getElementById('kahoot-answered-count');
      if (countEl) countEl.textContent = this.answers.size;

      AudioEngine?.playTick?.(true);

      const totalStudents = window.AppState?.students?.length || 0;
      if (totalStudents > 0 && this.answers.size >= totalStudents) {
        clearInterval(this.timerHandle);
        this.timerHandle = null;
        this.revealAnswer();
      }
    },

    revealAnswer() {
      if (this.phase === 'revealed') return;
      this.phase = 'revealed';
      if (this.timerHandle) {
        clearInterval(this.timerHandle);
        this.timerHandle = null;
      }

      const options = this.currentQuestion.options || [];
      const correctIdx = options.findIndex(o => o.isCorrect === true);

      if (window.activeSocket) {
        window.activeSocket.emit('kahoot:reveal_answer', {
          questionId: this.currentQuestion.id
        });
      }

      const counts = [0, 0, 0, 0];
      this.answers.forEach(ans => {
        if (ans.optionIndex >= 0 && ans.optionIndex < 4) {
          counts[ans.optionIndex]++;
        }

        const isCorrect = ans.optionIndex === correctIdx;
        if (isCorrect) {
          const ratio = Math.max(0, Math.min(1, (ans.timeMsRemaining || 0) / (this.currentQuestion.time_limit_sec * 1000)));
          const pts = Math.round((this.currentQuestion.points || 1000) * (0.5 + 0.5 * ratio));

          const currentStu = this.scores.get(ans.studentId) || {
            studentId: ans.studentId,
            studentName: ans.studentName,
            studentNumber: ans.studentNumber,
            groupId: ans.groupId,
            groupName: ans.groupName,
            totalScore: 0,
            correctCount: 0
          };
          currentStu.totalScore += pts;
          currentStu.correctCount++;
          this.scores.set(ans.studentId, currentStu);

          if (ans.groupId) {
            const currentGrp = this.groupScores.get(ans.groupId) || {
              groupId: ans.groupId,
              groupName: ans.groupName || `第 ${ans.groupId} 組`,
              totalScore: 0,
              memberCount: 0
            };
            currentGrp.totalScore += pts;
            this.groupScores.set(ans.groupId, currentGrp);
          }
        }
      });

      for (let i = 0; i < 4; i++) {
        const card = document.getElementById(`kahoot-opt-card-${i}`);
        const statEl = document.getElementById(`kahoot-opt-stat-${i}`);
        if (!card) continue;

        if (statEl) {
          statEl.textContent = `${counts[i]} 人選`;
          statEl.style.display = 'inline-block';
        }

        if (i === correctIdx) {
          card.style.opacity = '1';
          card.style.border = '4px solid #facc15';
          card.style.boxShadow = '0 0 25px rgba(250, 204, 21, 0.6)';
        } else {
          card.style.opacity = '0.35';
        }
      }

      AudioEngine?.playVictory?.();

      const explanation = this.currentQuestion.explanation;
      const expBox = document.getElementById('kahoot-explanation-box');
      const expText = document.getElementById('kahoot-explanation-text');
      if (expBox && expText) {
        if (explanation) {
          expText.textContent = explanation;
          expBox.style.display = 'block';
        } else {
          expBox.style.display = 'none';
        }
      }

      document.getElementById('btn-kahoot-reveal-answer').style.display = 'none';
      const nextBtn = document.getElementById('btn-kahoot-next-question');
      if (nextBtn) {
        nextBtn.style.display = 'inline-flex';
        nextBtn.textContent = (this.currentQIndex + 1 < this.questions.length) ? '➡️ 下一題' : '🏆 查看頒獎台';
      }
    },

    nextQuestion() {
      if (this.currentQIndex + 1 < this.questions.length) {
        this.startQuestion(this.currentQIndex + 1);
      } else {
        this.showPodium();
      }
    },

    showPodium() {
      this.phase = 'podium';
      document.getElementById('kahoot-running-view').style.display = 'none';
      const podiumView = document.getElementById('kahoot-podium-view');
      podiumView.style.display = 'flex';

      AudioEngine?.playApplause?.();

      let leaderboard = [];
      if (this.mode === 'group') {
        leaderboard = Array.from(this.groupScores.values())
          .sort((a, b) => b.totalScore - a.totalScore)
          .map(g => ({
            id: g.groupId,
            name: g.groupName,
            score: g.totalScore,
            isGroup: true
          }));
      } else {
        leaderboard = Array.from(this.scores.values())
          .sort((a, b) => b.totalScore - a.totalScore)
          .map(s => ({
            id: s.studentId,
            name: `${s.studentNumber ? s.studentNumber + '號 ' : ''}${s.studentName}`,
            score: s.totalScore,
            groupId: s.groupId,
            isGroup: false
          }));
      }

      const p1 = leaderboard[0];
      const p2 = leaderboard[1];
      const p3 = leaderboard[2];

      document.getElementById('podium-name-1').textContent = p1 ? p1.name : '（從缺）';
      document.getElementById('podium-score-1').textContent = p1 ? `${p1.score} 分` : '0 分';

      document.getElementById('podium-name-2').textContent = p2 ? p2.name : '（從缺）';
      document.getElementById('podium-score-2').textContent = p2 ? `${p2.score} 分` : '0 分';

      document.getElementById('podium-name-3').textContent = p3 ? p3.name : '（從缺）';
      document.getElementById('podium-score-3').textContent = p3 ? `${p3.score} 分` : '0 分';

      const moreList = document.getElementById('podium-more-list');
      if (moreList) {
        const others = leaderboard.slice(3, 10);
        if (others.length === 0) {
          moreList.innerHTML = '';
        } else {
          moreList.innerHTML = others.map((item, idx) => `
            <div style="display: flex; align-items: center; justify-content: space-between; padding: 6px 14px; background: rgba(255,255,255,0.06); border-radius: 6px; font-size: 0.95rem;">
              <span style="font-weight: 700; color: #cbd5e1;">第 ${idx + 4} 名：${item.name}</span>
              <span style="font-weight: 800; color: #93c5fd;">${item.score} 分</span>
            </div>
          `).join('');
        }
      }

      if (window.activeSocket) {
        window.activeSocket.emit('kahoot:finished', {
          quizSetId: this.selectedSet?.id,
          leaderboard
        });
      }
    },

    async awardPointsToBoard() {
      const courseId = this.getCourseId();
      if (!courseId) return;

      const rewards = [];
      if (this.mode === 'group') {
        const grpList = Array.from(this.groupScores.values()).sort((a, b) => b.totalScore - a.totalScore);
        const topBonuses = [3, 2, 1];

        grpList.slice(0, 3).forEach((g, idx) => {
          const bonus = topBonuses[idx] || 1;
          const members = (window.AppState?.students || []).filter(s => s.groupId === g.groupId);
          members.forEach(m => {
            rewards.push({
              studentId: m.id,
              score: bonus,
              reason: `答題競賽小組優勝【${g.groupName}】第 ${idx + 1} 名`,
              groupId: g.groupId
            });
          });
        });
      } else {
        const stuList = Array.from(this.scores.values()).sort((a, b) => b.totalScore - a.totalScore);
        const topBonuses = [3, 2, 1];

        stuList.slice(0, 3).forEach((s, idx) => {
          rewards.push({
            studentId: s.studentId,
            score: topBonuses[idx] || 1,
            reason: `答題競賽個人優勝第 ${idx + 1} 名`,
            groupId: s.groupId
          });
        });
      }

      if (rewards.length === 0) {
        alert('尚無可發放獎勵的名單！');
        return;
      }

      if (!(await window.showConfirmModal({
        title: '確定要發放優勝獎勵加分嗎？',
        desc: `將為優勝名單共 ${rewards.length} 人次加分。`,
        icon: '🏆',
        confirmText: '發放加分',
      }))) {
        return;
      }

      try {
        const res = await fetch(`/api/quiz-sets/${courseId}/award-scores`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ rewards })
        });
        if (!res.ok) throw new Error('發放加分失敗');
        const data = await res.json();
        alert(`🎉 ${data.message}！`);

        if (window.renderScoringView) window.renderScoringView();
        if (window.notifyScoreUpdates) window.notifyScoreUpdates();
      } catch (err) {
        alert('加分失敗：' + err.message);
      }
    },

    returnToLobby() {
      this.phase = 'lobby';
      document.getElementById('kahoot-podium-view').style.display = 'none';
      document.getElementById('kahoot-running-view').style.display = 'none';
      document.getElementById('kahoot-lobby-view').style.display = 'block';
    },

    async endGame() {
      if (await window.showConfirmModal({
        title: '確定要提前結束本次測驗嗎？',
        desc: '會直接顯示目前的頒獎台。',
        icon: '🏁',
        danger: true,
        confirmText: '結束測驗',
      })) {
        this.showPodium();
      }
    },

    openManageModal() {
      const modal = document.getElementById('modal-kahoot-manage-sets');
      if (!modal) return;
      modal.classList.add('open');
      this.renderManageModal();
    },

    renderManageModal() {
      const setsListEl = document.getElementById('kahoot-sets-list');
      if (!setsListEl) return;

      if (this.sets.length === 0) {
        setsListEl.innerHTML = '<div style="color: var(--text-muted, #64748b); font-size: 0.85rem; padding: 12px 0;">暫無題庫</div>';
        this.renderManageQuestions(null);
        return;
      }

      setsListEl.innerHTML = this.sets.map(s => {
        const isSelected = this.selectedSet?.id === s.id;
        return `
          <div class="kahoot-manage-set-item ${isSelected ? 'active' : ''}" onclick="TeachingToolkit.kahoot.manageSelectSet(${s.id})" style="
            padding: 10px 12px;
            border-radius: var(--radius-sm);
            cursor: pointer;
            background: ${isSelected ? 'rgba(59, 130, 246, 0.12)' : 'var(--bg-main, #f8fafc)'};
            border: 1px solid ${isSelected ? 'rgba(59, 130, 246, 0.45)' : 'var(--card-border, #e2e8f0)'};
            transition: all 0.15s ease;
          ">
            <div style="font-weight: 800; font-size: 0.95rem; color: ${isSelected ? 'var(--primary-dark, #1d4ed8)' : 'var(--text-main, #1e293b)'};">${s.title}</div>
            <div style="font-size: 0.8rem; color: ${isSelected ? 'var(--primary, #2563eb)' : 'var(--text-muted, #64748b)'}; margin-top: 3px; font-weight: 600;">共 ${s.question_count} 題</div>
          </div>
        `;
      }).join('');

      this.renderManageQuestions(this.selectedSet || this.sets[0]);
    },

    manageSelectSet(setId) {
      this.selectSet(setId).then(() => {
        this.renderManageModal();
      });
    },

    renderManageQuestions(set) {
      const titleEl = document.getElementById('kahoot-selected-set-title');
      const countEl = document.getElementById('kahoot-selected-set-count');
      const addQBtn = document.getElementById('btn-kahoot-add-question');
      const delSetBtn = document.getElementById('btn-kahoot-delete-set');
      const qListEl = document.getElementById('kahoot-questions-list');

      const importToCurrentBtn = document.getElementById('btn-kahoot-import-to-current');
      if (!set) {
        if (titleEl) titleEl.textContent = '請先選擇題庫';
        if (countEl) countEl.textContent = '';
        if (addQBtn) addQBtn.style.display = 'none';
        if (delSetBtn) delSetBtn.style.display = 'none';
        if (importToCurrentBtn) importToCurrentBtn.style.display = 'none';
        if (qListEl) qListEl.innerHTML = '<div style="color: var(--text-muted, #64748b); font-size: 0.9rem; text-align: center; padding: 40px 0;">請由左側點選或新增題庫</div>';
        return;
      }

      if (titleEl) titleEl.textContent = set.title;
      if (countEl) countEl.textContent = `(共 ${this.questions.length} 題)`;
      if (addQBtn) addQBtn.style.display = 'inline-flex';
      if (delSetBtn) delSetBtn.style.display = 'inline-flex';
      if (importToCurrentBtn) importToCurrentBtn.style.display = 'inline-flex';

      if (this.questions.length === 0) {
        qListEl.innerHTML = '<div style="color: var(--text-muted, #64748b); font-size: 0.9rem; text-align: center; padding: 40px 0;">題庫內尚無題目，請點擊「➕ 新增題目」</div>';
        return;
      }

      qListEl.innerHTML = this.questions.map((q, idx) => {
        const opts = q.options || [];
        return `
          <div style="padding: 14px 16px; background: var(--bg-main, #f8fafc); border-radius: var(--radius-md); border: 1px solid var(--card-border, #e2e8f0); box-shadow: 0 1px 3px rgba(0,0,0,0.03);">
            <div style="display: flex; align-items: flex-start; justify-content: space-between; gap: 10px;">
              <div style="font-weight: 800; font-size: 1rem; color: var(--text-main, #1e293b); line-height: 1.4;">
                <span style="color: var(--primary, #2563eb); font-weight: 900; margin-right: 6px;">Q${idx + 1}.</span>${q.prompt}
              </div>
              <div style="display: flex; gap: 6px; flex-shrink: 0;">
                <button type="button" class="btn btn-sm btn-secondary" onclick="TeachingToolkit.kahoot.openEditQuestionModal(${q.id})" title="編輯題目">✏️</button>
                <button type="button" class="btn btn-sm btn-secondary" style="color: #ef4444;" onclick="TeachingToolkit.kahoot.deleteQuestion(${q.id})" title="刪除題目">🗑️</button>
              </div>
            </div>
            <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 8px; margin-top: 10px; font-size: 0.88rem;">
              ${opts.map((o, oi) => `
                <div style="
                  color: ${o.isCorrect ? '#15803d' : 'var(--text-main, #334155)'};
                  font-weight: ${o.isCorrect ? '800' : '600'};
                  background: ${o.isCorrect ? '#ecfdf5' : 'rgba(0,0,0,0.02)'};
                  border: 1px solid ${o.isCorrect ? '#a7f3d0' : 'transparent'};
                  padding: 4px 8px;
                  border-radius: 6px;
                ">
                  <span style="font-weight: 800; color: ${o.isCorrect ? '#16a34a' : 'var(--text-muted, #64748b)'}; margin-right: 4px;">${['A','B','C','D'][oi]}.</span>
                  <span>${o.text}</span>
                  ${o.isCorrect ? '<span style="margin-left: 4px; font-size: 0.82rem;">✓ (正解)</span>' : ''}
                </div>
              `).join('')}
            </div>
            <div style="font-size: 0.8rem; color: var(--text-muted, #64748b); margin-top: 8px; font-weight: 600; display: flex; align-items: center; gap: 6px;">
              <span>⏱️ ${q.time_limit_sec} 秒</span>
              <span>｜</span>
              <span>🌟 ${q.points} 分</span>
              ${q.explanation ? `<span>｜</span><span style="color: #d97706;">💡 解析：${q.explanation}</span>` : ''}
            </div>
          </div>
        `;
      }).join('');
    },

    async promptCreateSet() {
      const title = await window.showPromptModal({
        title: '建立新題庫',
        desc: '請輸入題庫名稱',
        placeholder: '例如：第四單元自然科學競賽',
        icon: '📚',
        confirmText: '建立',
      });
      if (!title || !title.trim()) return;

      const courseId = this.getCourseId();
      try {
        const res = await fetch(`/api/quiz-sets/${courseId}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ title: title.trim() })
        });
        if (res.ok) {
          const newSet = await res.json();
          this.sets.unshift(newSet);
          this.renderSetDropdown();
          this.selectSet(newSet.id).then(() => {
            this.renderManageModal();
          });
        }
      } catch (err) {
        alert(err.message);
      }
    },

    async deleteCurrentSet() {
      if (!this.selectedSet) return;
      if (!(await window.showConfirmModal({
        title: `確定要刪除題庫【${this.selectedSet.title}】嗎？`,
        desc: '題庫裡的所有題目會一併刪除，此動作無法復原。',
        danger: true,
        confirmText: '刪除題庫',
      }))) return;

      const courseId = this.getCourseId();
      try {
        const res = await fetch(`/api/quiz-sets/${courseId}/${this.selectedSet.id}`, { method: 'DELETE' });
        if (res.ok) {
          this.sets = this.sets.filter(s => s.id !== this.selectedSet.id);
          this.selectedSet = this.sets[0] || null;
          this.renderSetDropdown();
          this.renderManageModal();
        }
      } catch (err) {
        alert(err.message);
      }
    },

    openEditQuestionModal(qId = null) {
      const modal = document.getElementById('modal-kahoot-edit-question');
      if (!modal) return;

      const idInput = document.getElementById('kahoot-edit-q-id');
      const promptInput = document.getElementById('kahoot-edit-q-prompt');
      const timeInput = document.getElementById('kahoot-edit-q-timelimit');
      const pointsInput = document.getElementById('kahoot-edit-q-points');
      const expInput = document.getElementById('kahoot-edit-q-explanation');

      if (qId) {
        const q = this.questions.find(item => item.id === qId);
        if (!q) return;
        document.getElementById('modal-kahoot-q-title').textContent = '✏️ 編輯測驗題目';
        idInput.value = q.id;
        promptInput.value = q.prompt;
        timeInput.value = q.time_limit_sec;
        pointsInput.value = q.points;
        expInput.value = q.explanation || '';

        const opts = q.options || [];
        opts.forEach((o, i) => {
          const optInput = document.getElementById(`kahoot-opt-input-${i}`);
          if (optInput) optInput.value = o.text || '';
          if (o.isCorrect) {
            const rad = document.querySelector(`input[name="kahoot-correct-opt"][value="${i}"]`);
            if (rad) rad.checked = true;
          }
        });
      } else {
        document.getElementById('modal-kahoot-q-title').textContent = '➕ 新增測驗題目';
        idInput.value = '';
        promptInput.value = '';
        timeInput.value = '20';
        pointsInput.value = '1000';
        expInput.value = '';
        for (let i = 0; i < 4; i++) {
          const optInput = document.getElementById(`kahoot-opt-input-${i}`);
          if (optInput) optInput.value = '';
        }
        const rad0 = document.querySelector('input[name="kahoot-correct-opt"][value="0"]');
        if (rad0) rad0.checked = true;
      }

      modal.classList.add('open');
    },

    async handleSaveQuestion(e) {
      e.preventDefault();
      if (!this.selectedSet) return;

      const courseId = this.getCourseId();
      const qId = document.getElementById('kahoot-edit-q-id').value;
      const prompt = document.getElementById('kahoot-edit-q-prompt').value.trim();
      const timeLimitSec = Number(document.getElementById('kahoot-edit-q-timelimit').value) || 20;
      const points = Number(document.getElementById('kahoot-edit-q-points').value) || 1000;
      const explanation = document.getElementById('kahoot-edit-q-explanation').value.trim();
      const correctIdx = Number(document.querySelector('input[name="kahoot-correct-opt"]:checked')?.value || 0);

      const options = [];
      for (let i = 0; i < 4; i++) {
        const text = (document.getElementById(`kahoot-opt-input-${i}`)?.value || '').trim();
        if (text) {
          options.push({
            id: ['A', 'B', 'C', 'D'][i],
            text,
            isCorrect: i === correctIdx
          });
        }
      }

      if (options.length < 2) {
        alert('請至少填寫 2 個選項！');
        return;
      }

      const body = {
        prompt,
        options,
        time_limit_sec: timeLimitSec,
        points,
        explanation
      };

      try {
        let res;
        if (qId) {
          res = await fetch(`/api/quiz-sets/${courseId}/${this.selectedSet.id}/questions/${qId}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body)
          });
        } else {
          res = await fetch(`/api/quiz-sets/${courseId}/${this.selectedSet.id}/questions`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body)
          });
        }

        if (res.ok) {
          document.getElementById('modal-kahoot-edit-question')?.classList.remove('open');
          await this.selectSet(this.selectedSet.id);
          this.renderManageQuestions(this.selectedSet);
        }
      } catch (err) {
        alert('儲存失敗：' + err.message);
      }
    },

    async deleteQuestion(qId) {
      if (!(await window.showConfirmModal({ title: '確定要刪除這道題目嗎？', danger: true, confirmText: '刪除' }))) return;
      const courseId = this.getCourseId();
      try {
        const res = await fetch(`/api/quiz-sets/${courseId}/${this.selectedSet.id}/questions/${qId}`, { method: 'DELETE' });
        if (res.ok) {
          await this.selectSet(this.selectedSet.id);
          this.renderManageQuestions(this.selectedSet);
        }
      } catch (err) {
        alert(err.message);
      }
    },

    // --- 題庫匯入相關方法（調用 LMS 線上測驗是非題/選擇題、CSV 檔案） ---
    async openImportModal(defaultMode = 'new') {
      const modal = document.getElementById('modal-kahoot-import-quiz');
      if (!modal) return;

      this.importTab = 'lms';
      this.switchImportTab('lms');

      const appendRadio = document.querySelector('input[name="kahoot-import-target-mode"][value="append"]');
      const newRadio = document.querySelector('input[name="kahoot-import-target-mode"][value="new"]');
      const appendLabel = document.getElementById('kahoot-import-target-append-label');
      const appendText = document.getElementById('kahoot-import-target-append-text');
      const titleInput = document.getElementById('input-kahoot-import-set-title');
      const titleWrap = document.getElementById('kahoot-import-new-title-wrap');

      if (this.selectedSet) {
        if (appendLabel) appendLabel.style.display = 'inline-flex';
        if (appendText) appendText.textContent = `匯入至當前題庫「${this.selectedSet.title}」`;
        if (defaultMode === 'append') {
          if (appendRadio) appendRadio.checked = true;
          this.importTargetMode = 'append';
          if (titleWrap) titleWrap.style.display = 'none';
        } else {
          if (newRadio) newRadio.checked = true;
          this.importTargetMode = 'new';
          if (titleWrap) titleWrap.style.display = 'flex';
        }
      } else {
        if (appendLabel) appendLabel.style.display = 'none';
        if (newRadio) newRadio.checked = true;
        this.importTargetMode = 'new';
        if (titleWrap) titleWrap.style.display = 'flex';
      }

      modal.classList.add('open');
      await this.loadLmsQuizzesForImport();
    },

    onImportTargetModeChange(mode) {
      this.importTargetMode = mode;
      const titleWrap = document.getElementById('kahoot-import-new-title-wrap');
      if (titleWrap) {
        titleWrap.style.display = mode === 'new' ? 'flex' : 'none';
      }
    },

    switchImportTab(tab) {
      this.importTab = tab;
      const tabLms = document.getElementById('tab-kahoot-import-lms');
      const tabCsv = document.getElementById('tab-kahoot-import-csv');
      const paneLms = document.getElementById('pane-kahoot-import-lms');
      const paneCsv = document.getElementById('pane-kahoot-import-csv');

      if (tab === 'lms') {
        tabLms?.classList.replace('btn-secondary', 'btn-primary');
        tabCsv?.classList.replace('btn-primary', 'btn-secondary');
        if (paneLms) paneLms.style.display = 'flex';
        if (paneCsv) paneCsv.style.display = 'none';
      } else {
        tabCsv?.classList.replace('btn-secondary', 'btn-primary');
        tabLms?.classList.replace('btn-primary', 'btn-secondary');
        if (paneCsv) paneCsv.style.display = 'flex';
        if (paneLms) paneLms.style.display = 'none';
      }
      this.updateImportCounts();
    },

    async loadLmsQuizzesForImport() {
      const select = document.getElementById('select-kahoot-import-lms-quiz');
      const preview = document.getElementById('kahoot-import-questions-preview');
      if (!select) return;

      select.innerHTML = '<option value="">載入 LMS 線上測驗中...</option>';
      const courseId = this.getCourseId();
      if (!courseId) return;

      try {
        const res = await fetch(`/api/quiz-sets/${courseId}/lms-quizzes`);
        if (!res.ok) throw new Error('讀取 LMS 測驗失敗');
        this.importLmsQuizzes = await res.json();

        if (this.importLmsQuizzes.length === 0) {
          select.innerHTML = '<option value="">此課程尚未建立任何 LMS 線上測驗</option>';
          if (preview) preview.innerHTML = '<div style="color: var(--text-muted, #64748b); text-align: center; padding: 30px 0;">此課程尚未建立任何 LMS 線上測驗，請至「學習內容 (LMS)」建立測驗或由 CSV 檔案匯入。</div>';
          this.importQuestionsDraft = [];
          this.updateImportCounts();
          return;
        }

        select.innerHTML = this.importLmsQuizzes.map((q, idx) => `
          <option value="${idx}">【${q.unit_title}】${q.quiz_title} (${q.question_count} 題)</option>
        `).join('');

        const firstWithQ = this.importLmsQuizzes.findIndex(q => q.question_count > 0);
        const selIdx = firstWithQ >= 0 ? firstWithQ : 0;
        select.value = String(selIdx);
        this.onSelectImportLmsQuiz(selIdx);
      } catch (err) {
        select.innerHTML = `<option value="">載入失敗：${err.message}</option>`;
        if (preview) preview.innerHTML = `<div style="color: #ef4444; text-align: center; padding: 20px 0;">載入失敗：${err.message}</div>`;
      }
    },

    onSelectImportLmsQuiz(idxStr) {
      const idx = Number(idxStr);
      const quiz = this.importLmsQuizzes[idx];
      const titleInput = document.getElementById('input-kahoot-import-set-title');
      if (titleInput && quiz && !titleInput.value) {
        titleInput.value = `${quiz.quiz_title}（競賽題庫）`;
      }

      if (!quiz || !quiz.questions || quiz.questions.length === 0) {
        this.importQuestionsDraft = [];
        this.renderImportPreview([], 'lms');
        return;
      }

      this.importQuestionsDraft = quiz.questions.map((q, qi) => {
        const isTrueFalse = q.type === 'true_false';
        let options = [];
        if (isTrueFalse) {
          const ca = String(q.correct_answer || '').toLowerCase();
          const isTrue = ca === 'true' || ca === '1' || ca === 'o' || ca === '正確' || ca === '是';
          options = [
            { id: 'A', text: '⭕ 正確', isCorrect: isTrue },
            { id: 'B', text: '❌ 錯誤', isCorrect: !isTrue },
          ];
        } else {
          const rawOpts = Array.isArray(q.options) ? q.options : [];
          const correctAns = String(q.correct_answer ?? '').trim();
          options = rawOpts.map((optText, oi) => {
            const str = String(optText).trim();
            const isMatch = correctAns === String(oi) || correctAns === str;
            return {
              id: ['A', 'B', 'C', 'D'][oi] || String(oi + 1),
              text: str,
              isCorrect: isMatch,
            };
          });
          if (!options.some(o => o.isCorrect)) {
            const num = parseInt(correctAns, 10);
            if (!isNaN(num) && num >= 1 && num <= options.length) {
              options[num - 1].isCorrect = true;
            } else if (options.length > 0) {
              options[0].isCorrect = true;
            }
          }
        }

        return {
          _selected: true,
          type: isTrueFalse ? 'true_false' : 'single',
          typeLabel: isTrueFalse ? '是非題' : '選擇題',
          prompt: q.question_text || q.prompt || `第 ${qi + 1} 題`,
          options,
          time_limit_sec: 20,
          points: 1000,
          explanation: q.explanation || '',
        };
      });

      this.renderImportPreview(this.importQuestionsDraft, 'lms');
    },

    renderImportPreview(questions, source = 'lms') {
      const containerId = source === 'lms' ? 'kahoot-import-questions-preview' : 'kahoot-import-csv-preview';
      const container = document.getElementById(containerId);
      if (!container) return;

      if (!questions || questions.length === 0) {
        container.innerHTML = '<div style="color: var(--text-muted, #64748b); text-align: center; padding: 30px 0;">此測驗內無題目</div>';
        this.updateImportCounts();
        return;
      }

      container.innerHTML = questions.map((q, idx) => `
        <div style="padding: 10px 12px; background: var(--bg-main, #f8fafc); border-radius: var(--radius-sm); border: 1px solid var(--card-border, #e2e8f0); display: flex; align-items: flex-start; gap: 10px;">
          <input type="checkbox" class="kahoot-import-q-chk" data-idx="${idx}" ${q._selected ? 'checked' : ''} style="cursor: pointer; margin-top: 4px; width: 16px; height: 16px;">
          <div style="flex: 1;">
            <div style="display: flex; align-items: center; gap: 8px; margin-bottom: 4px; flex-wrap: wrap;">
              <span style="font-weight: 800; font-size: 0.8rem; background: ${q.type === 'true_false' ? 'rgba(168, 85, 247, 0.15)' : 'rgba(59, 130, 246, 0.15)'}; color: ${q.type === 'true_false' ? '#9333ea' : '#2563eb'}; padding: 1px 8px; border-radius: 4px;">
                ${q.typeLabel || (q.type === 'true_false' ? '是非題' : '選擇題')}
              </span>
              <span style="font-weight: 800; font-size: 0.92rem; color: var(--text-main, #1e293b);">
                Q${idx + 1}. ${q.prompt}
              </span>
            </div>
            <div style="display: flex; flex-wrap: wrap; gap: 6px; font-size: 0.82rem; margin-top: 6px;">
              ${(q.options || []).map(o => `
                <span style="
                  padding: 2px 8px;
                  border-radius: 4px;
                  background: ${o.isCorrect ? '#ecfdf5' : 'rgba(0,0,0,0.03)'};
                  color: ${o.isCorrect ? '#15803d' : 'var(--text-main, #475569)'};
                  font-weight: ${o.isCorrect ? '800' : '500'};
                  border: 1px solid ${o.isCorrect ? '#a7f3d0' : 'transparent'};
                ">
                  ${o.id}. ${o.text} ${o.isCorrect ? '✓' : ''}
                </span>
              `).join('')}
            </div>
          </div>
        </div>
      `).join('');

      container.querySelectorAll('.kahoot-import-q-chk').forEach(chk => {
        chk.addEventListener('change', (e) => {
          const i = Number(e.target.dataset.idx);
          if (questions[i]) questions[i]._selected = e.target.checked;
          this.updateImportCounts();
        });
      });

      this.updateImportCounts();
    },

    toggleSelectAllImportQuestions(checked) {
      const questions = this.importTab === 'lms' ? this.importQuestionsDraft : this.importCsvQuestionsDraft;
      (questions || []).forEach(q => { q._selected = checked; });
      const containerId = this.importTab === 'lms' ? 'kahoot-import-questions-preview' : 'kahoot-import-csv-preview';
      document.querySelectorAll(`#${containerId} .kahoot-import-q-chk`).forEach(chk => {
        chk.checked = checked;
      });
      this.updateImportCounts();
    },

    updateImportCounts() {
      const questions = this.importTab === 'lms' ? this.importQuestionsDraft : this.importCsvQuestionsDraft;
      const total = (questions || []).length;
      const selected = (questions || []).filter(q => q._selected).length;

      const selCountEl = document.getElementById('kahoot-import-selected-count');
      const totalCountEl = document.getElementById('kahoot-import-total-count');
      const confirmBtn = document.getElementById('btn-confirm-kahoot-import');
      const selectAllChk = document.getElementById('chk-kahoot-import-select-all');

      if (selCountEl) selCountEl.textContent = selected;
      if (totalCountEl) totalCountEl.textContent = total;
      if (selectAllChk) selectAllChk.checked = total > 0 && selected === total;

      if (confirmBtn) {
        confirmBtn.disabled = selected === 0;
        confirmBtn.textContent = `📥 確認匯入 (${selected} 題)`;
      }
    },

    handleImportCsvFile(file) {
      if (!file) return;
      const filenameEl = document.getElementById('kahoot-import-csv-filename');
      if (filenameEl) filenameEl.textContent = file.name;

      const reader = new FileReader();
      reader.onload = (e) => {
        const text = e.target.result || '';
        const cleaned = text.replace(/^\uFEFF/, '');
        const lines = cleaned.split(/\r\n|\r|\n/).filter(l => l.trim());
        const dataLines = lines.slice(1);
        const parsed = [];

        for (const line of dataLines) {
          const row = this.parseCsvLine(line);
          const [typeLabel, questionText, opt1, opt2, opt3, opt4, correctAnswerRaw, pointsRaw] = row;
          if (!questionText || !questionText.trim()) continue;

          const isTf = String(typeLabel || '').includes('是非');
          const correctText = String(correctAnswerRaw || '').trim();
          let options = [];

          if (isTf) {
            const isTrue = correctText === '正確' || correctText === 'true' || correctText === '1' || correctText === 'O' || correctText === '是';
            options = [
              { id: 'A', text: '⭕ 正確', isCorrect: isTrue },
              { id: 'B', text: '❌ 錯誤', isCorrect: !isTrue }
            ];
          } else {
            const rawOpts = [opt1, opt2, opt3, opt4].map(o => String(o || '').trim()).filter(Boolean);
            if (rawOpts.length < 2) continue;
            options = rawOpts.map((text, oi) => {
              const isMatch = correctText === text || correctText === String(oi) || correctText === ['A', 'B', 'C', 'D'][oi];
              return {
                id: ['A', 'B', 'C', 'D'][oi] || String(oi + 1),
                text,
                isCorrect: isMatch
              };
            });
            if (!options.some(o => o.isCorrect)) {
              options[0].isCorrect = true;
            }
          }

          parsed.push({
            _selected: true,
            type: isTf ? 'true_false' : 'single',
            typeLabel: isTf ? '是非題' : '選擇題',
            prompt: questionText.trim(),
            options,
            time_limit_sec: 20,
            points: Number(pointsRaw) || 1000,
            explanation: '',
          });
        }

        this.importCsvQuestionsDraft = parsed;
        const titleInput = document.getElementById('input-kahoot-import-set-title');
        if (titleInput && !titleInput.value) {
          titleInput.value = file.name.replace(/\.[^/.]+$/, '') + '（競賽題庫）';
        }
        this.renderImportPreview(this.importCsvQuestionsDraft, 'csv');
      };
      reader.readAsText(file);
    },

    downloadImportCsvTemplate() {
      const headers = ['題型', '題目內容', '選項1', '選項2', '選項3', '選項4', '正確答案', '配分'];
      const sampleRows = [
        ['選擇題', '正三角形的三個內角度數均為多少度？', '60 度', '90 度', '45 度', '180 度', '60 度', '1000'],
        ['是非題', '光合作用產生的主要氣體產物為氧氣。', '', '', '', '', '正確', '1000'],
        ['選擇題', '太陽系中體積最大的行星是哪一顆？', '木星', '土星', '地球', '火星', '木星', '1000'],
        ['是非題', '地球繞太陽公轉一週約為一個月。', '', '', '', '', '錯誤', '1000']
      ];
      const csv = [headers, ...sampleRows].map(r => r.map(c => `"${String(c).replace(/"/g, '""')}"`).join(',')).join('\r\n');
      const blob = new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8;' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = '答題競賽題目匯入範本.csv';
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    },

    parseCsvLine(line) {
      const cells = [];
      let cur = '';
      let inQuotes = false;
      for (let i = 0; i < line.length; i++) {
        const ch = line[i];
        if (inQuotes) {
          if (ch === '"') {
            if (line[i + 1] === '"') { cur += '"'; i++; } else { inQuotes = false; }
          } else {
            cur += ch;
          }
        } else if (ch === '"') {
          inQuotes = true;
        } else if (ch === ',') {
          cells.push(cur.trim());
          cur = '';
        } else {
          cur += ch;
        }
      }
      cells.push(cur.trim());
      return cells;
    },

    async handleConfirmImport() {
      const questions = this.importTab === 'lms' ? this.importQuestionsDraft : this.importCsvQuestionsDraft;
      const selectedQuestions = (questions || []).filter(q => q._selected);

      if (selectedQuestions.length === 0) {
        alert('請至少勾選一道要匯入的題目');
        return;
      }

      const courseId = this.getCourseId();
      if (!courseId) return;

      const isAppend = this.importTargetMode === 'append' && this.selectedSet;
      const targetSetId = isAppend ? this.selectedSet.id : null;
      let title = document.getElementById('input-kahoot-import-set-title')?.value.trim();
      if (!isAppend && !title) {
        title = '匯入競賽題庫';
      }

      const confirmBtn = document.getElementById('btn-confirm-kahoot-import');
      if (confirmBtn) {
        confirmBtn.disabled = true;
        confirmBtn.textContent = '匯入處理中...';
      }

      try {
        const res = await fetch(`/api/quiz-sets/${courseId}/import`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            target_set_id: targetSetId,
            title,
            questions: selectedQuestions
          })
        });

        const data = await res.json();
        if (!res.ok) throw new Error(data.detail || '匯入失敗');

        document.getElementById('modal-kahoot-import-quiz')?.classList.remove('open');
        alert(data.message || '匯入成功！');

        await this.loadCourse(courseId);
        if (data.quiz_set_id) {
          await this.selectSet(data.quiz_set_id);
        }
        this.renderManageModal();
      } catch (err) {
        alert('匯入失敗：' + err.message);
      } finally {
        if (confirmBtn) {
          confirmBtn.disabled = false;
          confirmBtn.textContent = `📥 確認匯入 (${selectedQuestions.length} 題)`;
        }
      }
    }
  };

  TK.KahootGame = KahootGame;
})(window);
