// MyClass 教師端：紙本測驗成績管理
// 由 static/js/app.js 拆出（2026-10-31，原第 5590–6667 行），程式內容未變更。
// 所有 static/js/app.js 與 static/js/app/*.js 共用同一個全域範圍（一般 <script>，不是模組），載入順序見 static/index.html。


// ==========================================================================
// 📝 紙本測驗成績管理模組 (Paper Quiz Management)
// ==========================================================================

AppState.paperQuizzes = [];
AppState.currentPaperQuizId = null;
AppState.currentPaperQuizData = null;

// 動態更新科目篩選下拉選項
function updatePaperQuizSubjectFilter() {
  const subjectSelect = document.getElementById('paper-quiz-filter-subject');
  if (!subjectSelect) return;
  const currentVal = subjectSelect.value;
  const subjects = Array.from(new Set(AppState.paperQuizzes.map(q => q.subject).filter(Boolean))).sort();
  
  const allSubjectsText = (window.I18n && window.I18n.t('paper_quiz_filter_all_subjects')) || '全部科目';
  subjectSelect.innerHTML = `<option value="">${allSubjectsText}</option>`;
  subjects.forEach(subj => {
    const opt = document.createElement('option');
    opt.value = subj;
    opt.textContent = `📚 ${subj}`;
    subjectSelect.appendChild(opt);
  });

  if (subjects.includes(currentVal)) {
    subjectSelect.value = currentVal;
  } else {
    subjectSelect.value = '';
  }
}

// 根據科目與關鍵字篩選並渲染測驗下拉選單
async function filterAndRenderPaperQuizSelect(preferredQuizId = null) {
  const select = document.getElementById('paper-quiz-select');
  const countBadge = document.getElementById('paper-quiz-count-badge');
  const subjectSelect = document.getElementById('paper-quiz-filter-subject');
  const searchInput = document.getElementById('paper-quiz-search-keyword');
  const clearBtn = document.getElementById('btn-clear-quiz-search');

  if (!select) return;

  const selectedSubject = subjectSelect ? subjectSelect.value.trim() : '';
  const keyword = searchInput ? searchInput.value.trim().toLowerCase() : '';

  if (clearBtn) {
    clearBtn.style.display = keyword ? 'block' : 'none';
  }

  const filtered = AppState.paperQuizzes.filter((q) => {
    if (selectedSubject && (q.subject || '') !== selectedSubject) return false;
    if (keyword) {
      const matchTitle = (q.title || '').toLowerCase().includes(keyword);
      const matchSubject = (q.subject || '').toLowerCase().includes(keyword);
      const matchUnit = (q.sub_unit_title || '').toLowerCase().includes(keyword);
      const matchDate = (q.quiz_date || '').toLowerCase().includes(keyword);
      if (!matchTitle && !matchSubject && !matchUnit && !matchDate) return false;
    }
    return true;
  });

  const total = AppState.paperQuizzes.length;
  if (countBadge) {
    const template = (window.I18n && window.I18n.t('paper_quiz_count_badge_text')) || '顯示 {filtered} / {total} 個測驗';
    countBadge.textContent = template.replace('{filtered}', filtered.length).replace('{total}', total);
  }

  select.innerHTML = '';
  if (AppState.paperQuizzes.length === 0) {
    select.innerHTML = '<option value="">尚無紙本測驗，請點擊「➕ 建立新測驗」</option>';
    AppState.currentPaperQuizId = null;
    AppState.currentPaperQuizData = null;
    renderPaperQuizMatrix(null);
    return;
  }

  if (filtered.length === 0) {
    const noMatchText = (window.I18n && window.I18n.t('paper_quiz_no_match')) || '查無符合科目或關鍵字的測驗';
    select.innerHTML = `<option value="">${noMatchText}</option>`;
    AppState.currentPaperQuizId = null;
    AppState.currentPaperQuizData = null;
    renderPaperQuizMatrix(null);
    return;
  }

  filtered.forEach((q) => {
    const opt = document.createElement('option');
    opt.value = q.id;
    const subjStr = q.subject ? `[${q.subject}] ` : '';
    const subTitle = q.sub_unit_title ? ` (${q.sub_unit_title})` : '';
    const pendingStr = q.stats.pending_verify_count > 0 ? ` ⚠️(${q.stats.pending_verify_count}待審)` : '';
    opt.textContent = `${subjStr}${q.quiz_date} ${q.title}${subTitle}${pendingStr}`;
    select.appendChild(opt);
  });

  let chosenId = null;
  if (preferredQuizId && filtered.some(q => q.id === preferredQuizId)) {
    chosenId = preferredQuizId;
  } else if (AppState.currentPaperQuizId && filtered.some(q => q.id === AppState.currentPaperQuizId)) {
    chosenId = AppState.currentPaperQuizId;
  } else {
    chosenId = filtered[0].id;
  }

  select.value = chosenId;
  AppState.currentPaperQuizId = chosenId;
  await loadPaperQuizMatrix(chosenId);
}

async function loadPaperQuizData(force = false, preferredQuizId = null) {
  if (!AppState.currentCourseId) {
    const tbody = document.getElementById('paper-quiz-matrix-tbody');
    if (tbody) tbody.innerHTML = `<tr><td colspan="8" style="text-align: center; padding: 30px; color: var(--text-muted);">尚未選擇班級/課程</td></tr>`;
    return;
  }

  try {
    const data = await API.get(`/api/paper-quizzes/${AppState.currentCourseId}`);
    AppState.paperQuizzes = data.quizzes || [];

    updatePaperQuizSubjectFilter();
    await filterAndRenderPaperQuizSelect(preferredQuizId || AppState.currentPaperQuizId);
  } catch (err) {
    console.error('Failed to load paper quizzes:', err);
    showToast(`載入紙本測驗失敗：${err.message}`, 'error');
  }
}

async function loadPaperQuizMatrix(quizId) {
  if (!quizId) {
    renderPaperQuizMatrix(null);
    return;
  }
  try {
    const matrixData = await API.get(`/api/paper-quizzes/${quizId}/matrix`);
    AppState.currentPaperQuizData = matrixData;
    renderPaperQuizMatrix(matrixData);
  } catch (err) {
    console.error('Failed to load quiz matrix:', err);
    showToast(`載入測驗成績失敗：${err.message}`, 'error');
  }
}

function renderPaperQuizStatsCards(stats, quiz) {
  const statsContainer = document.getElementById('paper-quiz-stats-container');
  if (!statsContainer) return;
  if (!stats || !quiz) {
    statsContainer.innerHTML = '';
    return;
  }

  const avgScoreStr = stats.average_score !== null && stats.average_score !== undefined ? `${stats.average_score}` : '-';
  const passRateStr = stats.scored_count > 0 ? `${stats.pass_rate}%` : '-';
  const highestStr = stats.max_score_actual !== null && stats.max_score_actual !== undefined ? `${stats.max_score_actual}` : '-';
  const lowestStr = stats.min_score_actual !== null && stats.min_score_actual !== undefined ? `${stats.min_score_actual}` : '-';
  const recordedStr = `${(stats.scored_count || 0) + (stats.absent_count || 0)} / ${stats.total_students || 0}`;
  const pendingClass = (stats.pending_verify_count || 0) > 0 ? 'warning' : '';
  const makeupInfo = (stats.makeup_count || 0) > 0 ? ` (${stats.makeup_count}人補考中)` : '';

  statsContainer.innerHTML = `
    <div class="paper-quiz-stat-card">
      <div class="paper-quiz-stat-val ${stats.average_score !== null && stats.average_score >= quiz.passing_score ? 'positive' : ''}">${avgScoreStr}</div>
      <div class="paper-quiz-stat-label">全班平均分</div>
    </div>
    <div class="paper-quiz-stat-card">
      <div class="paper-quiz-stat-val ${stats.pass_rate >= 80 ? 'positive' : ''}">${passRateStr}</div>
      <div class="paper-quiz-stat-label">及格率 (${stats.pass_count || 0}/${stats.scored_count || 0})</div>
    </div>
    <div class="paper-quiz-stat-card">
      <div class="paper-quiz-stat-val">${highestStr} / ${lowestStr}</div>
      <div class="paper-quiz-stat-label">最高分 / 最低分</div>
    </div>
    <div class="paper-quiz-stat-card">
      <div class="paper-quiz-stat-val">${recordedStr}</div>
      <div class="paper-quiz-stat-label">已登記 (${stats.absent_count || 0} 缺考${makeupInfo})</div>
    </div>
    <div class="paper-quiz-stat-card">
      <div class="paper-quiz-stat-val ${pendingClass}">${stats.pending_verify_count || 0}</div>
      <div class="paper-quiz-stat-label">待審核考卷照片</div>
    </div>
  `;
}

function recalculatePaperQuizStatsRealtime() {
  if (!AppState.currentPaperQuizData || !AppState.currentPaperQuizData.quiz) return;
  const { quiz, students } = AppState.currentPaperQuizData;
  if (!Array.isArray(students)) return;

  const tbody = document.getElementById('paper-quiz-matrix-tbody');
  if (tbody) {
    const rows = tbody.querySelectorAll('tr[data-student-id]');
    rows.forEach((tr) => {
      const studentId = Number(tr.dataset.studentId);
      const studentObj = students.find((s) => s.student_id === studentId);
      if (!studentObj) return;

      const scoreInput = tr.querySelector('.score-quick-input');
      const absentCheckbox = tr.querySelector('.quiz-absent-checkbox');

      const isAbsent = absentCheckbox ? absentCheckbox.checked : false;
      const rawVal = scoreInput ? scoreInput.value.trim() : '';
      const allowMakeup = tr.dataset.allowMakeup === '1';

      studentObj.is_absent = isAbsent;
      if (isAbsent && !allowMakeup) {
        studentObj.score = null;
      } else {
        if (rawVal !== '' && !isNaN(parseFloat(rawVal))) {
          studentObj.score = Math.min(parseFloat(rawVal), quiz.max_score);
          if (allowMakeup && isAbsent) {
            studentObj.is_makeup = true;
          }
        } else {
          studentObj.score = null;
        }
      }
    });
  }

  const scoredList = [];
  let absentCount = 0;
  let makeupCount = 0;
  let pendingVerifyCount = 0;

  students.forEach((s) => {
    if (s.photo_url && !s.is_verified) {
      pendingVerifyCount++;
    }
    if (s.allow_makeup) {
      makeupCount++;
    }
    if (s.is_absent && (!s.allow_makeup || s.score === null)) {
      absentCount++;
    } else if (s.score !== null && s.score !== undefined && !isNaN(s.score)) {
      scoredList.push(Number(s.score));
    }
  });

  scoredList.sort((a, b) => a - b);
  const scoredCount = scoredList.length;
  const passCount = scoredList.filter((v) => v >= quiz.passing_score).length;
  const failCount = scoredList.filter((v) => v < quiz.passing_score).length;
  const passRate = scoredCount > 0 ? Math.round((passCount / scoredCount) * 1000) / 10 : 0;

  let avgScore = null;
  let highest = null;
  let lowest = null;

  if (scoredCount > 0) {
    const sum = scoredList.reduce((acc, v) => acc + v, 0);
    avgScore = Math.round((sum / scoredCount) * 10) / 10;
    highest = scoredList[scoredCount - 1];
    lowest = scoredList[0];
  }

  const updatedStats = {
    total_students: students.length,
    recorded_count: scoredCount + absentCount,
    scored_count: scoredCount,
    absent_count: absentCount,
    makeup_count: makeupCount,
    pass_count: passCount,
    fail_count: failCount,
    pass_rate: passRate,
    average_score: avgScore,
    max_score_actual: highest,
    min_score_actual: lowest,
    pending_verify_count: pendingVerifyCount,
  };

  AppState.currentPaperQuizData.stats = updatedStats;
  renderPaperQuizStatsCards(updatedStats, quiz);

  // 同步更新已載入測驗列表的快取統計
  const cachedQuiz = AppState.paperQuizzes.find((q) => q.id === quiz.id);
  if (cachedQuiz && cachedQuiz.stats) {
    cachedQuiz.stats.recorded_count = updatedStats.recorded_count;
    cachedQuiz.stats.scored_count = updatedStats.scored_count;
    cachedQuiz.stats.absent_count = updatedStats.absent_count;
    cachedQuiz.stats.makeup_count = updatedStats.makeup_count;
    cachedQuiz.stats.pass_count = updatedStats.pass_count;
    cachedQuiz.stats.fail_count = updatedStats.fail_count;
    cachedQuiz.stats.average_score = updatedStats.average_score;
    cachedQuiz.stats.pending_verify_count = updatedStats.pending_verify_count;
  }
}

function renderPaperQuizMatrix(matrixData) {
  const statsContainer = document.getElementById('paper-quiz-stats-container');
  const tbody = document.getElementById('paper-quiz-matrix-tbody');
  const thMaxScore = document.getElementById('th-quiz-max-score');
  const filterUnrecorded = document.getElementById('paper-quiz-filter-unrecorded')?.checked;
  const filterPending = document.getElementById('paper-quiz-filter-pending-photos')?.checked;
  const filterAbsent = document.getElementById('paper-quiz-filter-absent')?.checked;
  const filterMakeup = document.getElementById('paper-quiz-filter-makeup')?.checked;

  if (!matrixData || !matrixData.quiz) {
    if (statsContainer) statsContainer.innerHTML = '';
    if (tbody) {
      tbody.innerHTML = `<tr><td colspan="8" style="text-align: center; padding: 40px; color: var(--text-muted); font-size: 0.95rem;">
        📝 目前尚無測驗或未選擇測驗。<br>請點擊右上角「➕ 建立新測驗」以開始登記成績！
      </td></tr>`;
    }
    return;
  }

  const { quiz, stats, students } = matrixData;
  if (thMaxScore) thMaxScore.textContent = quiz.max_score;

  // 1. 渲染統計儀表卡片
  renderPaperQuizStatsCards(stats, quiz);
  setPaperQuizAutoSaveStatus('ready', '自動儲存已啟用');

  // 2. 渲染全班學生登錄矩陣
  if (tbody) {
    tbody.innerHTML = '';
    const isEn = window.I18n && window.I18n.getLanguage() === 'en';

    students.forEach((s, rowIndex) => {
      const hasRecord = s.score !== null || s.is_absent;
      const isPendingPhoto = !!(s.photo_url && !s.is_verified);

      if (filterUnrecorded && hasRecord) return;
      if (filterPending && !isPendingPhoto) return;
      if (filterAbsent && !s.is_absent) return;
      if (filterMakeup && !s.allow_makeup) return;

      const tr = document.createElement('tr');
      tr.dataset.studentId = s.student_id;
      tr.dataset.rowIndex = rowIndex;
      tr.dataset.leaveType = s.leave_type || '';
      tr.dataset.allowMakeup = s.allow_makeup ? '1' : '0';
      tr.dataset.isMakeup = s.is_makeup ? '1' : '0';

      if (s.is_absent) tr.classList.add('is-absent');

      const numText = isEn ? `No. ${s.student_number}` : `${s.student_number}號`;
      const groupBadge = s.group_id 
        ? `<span style="font-weight: 600; color: var(--text-main); font-size: 0.85rem;">${s.group_name}</span>${s.is_leader ? ' <span class="leader-badge-pill" style="font-size:0.7rem; padding:1px 5px;">👑組長</span>' : ''}` 
        : '<span style="color: var(--text-muted); font-size: 0.82rem;">未分組</span>';

      let photoColHtml = '<span style="color: var(--text-muted); font-size: 0.82rem;">無佐證</span>';
      if (s.photo_url) {
        const isVerified = s.is_verified;
        photoColHtml = `
          <a href="javascript:void(0)" class="quiz-photo-badge ${isVerified ? 'verified' : 'pending'}" data-photo-url="${s.photo_url}" data-student-id="${s.student_id}" data-student-name="${getStudentDisplayName(s)}" data-student-num="${s.student_number}" data-score="${s.score ?? ''}" data-verified="${isVerified ? '1' : '0'}" title="點擊查驗放大考卷照片">
            <span>📷</span>
            <span>${isVerified ? '已核准' : '待查驗'}</span>
          </a>
        `;
      }

      let sourceTagHtml = '-';
      if (s.is_makeup) {
        sourceTagHtml = `<span class="quiz-source-tag" style="background: rgba(16, 185, 129, 0.15); color: #10b981; border: 1px solid rgba(16, 185, 129, 0.3);">補考成績</span>`;
      } else if (s.submitted_by === 'student') {
        sourceTagHtml = `<span class="quiz-source-tag student">學生自登</span>`;
      } else if (s.submitted_by === 'leader') {
        sourceTagHtml = `<span class="quiz-source-tag leader">組長代登</span>`;
      } else if (s.submitted_by === 'teacher' || (s.score !== null || s.is_absent)) {
        sourceTagHtml = `<span class="quiz-source-tag teacher">教師登記</span>`;
      }

      const scoreVal = s.score !== null ? s.score : '';
      const isInputDisabled = s.is_absent && !s.allow_makeup;

      // 假別標示
      let leaveBadgeHtml = '';
      if (s.leave_label) {
        leaveBadgeHtml = `<span class="badge" style="font-size: 0.72rem; padding: 2px 6px; background: rgba(239, 68, 68, 0.12); color: #ef4444; border-radius: 4px; border: 1px solid rgba(239, 68, 68, 0.25); white-space: nowrap;">${s.leave_label}</span>`;
      }

      // 補考切換按鈕
      let makeupBtnHtml = '';
      if (s.is_absent) {
        if (s.allow_makeup) {
          makeupBtnHtml = `
            <button type="button" class="btn-makeup-toggle" data-student-id="${s.student_id}" data-allow="0" title="點擊關閉該生補考" style="font-size: 0.72rem; font-weight: 700; padding: 2px 6px; border-radius: 4px; border: 1px solid rgba(16, 185, 129, 0.35); background: rgba(16, 185, 129, 0.15); color: #10b981; cursor: pointer; white-space: nowrap;">
              ✅ 補考中 (點擊關閉)
            </button>
          `;
        } else {
          makeupBtnHtml = `
            <button type="button" class="btn-makeup-toggle" data-student-id="${s.student_id}" data-allow="1" title="點擊開啟該生補考" style="font-size: 0.72rem; font-weight: 600; padding: 2px 6px; border-radius: 4px; border: 1px solid var(--card-border); background: rgba(255, 255, 255, 0.05); color: var(--text-muted); cursor: pointer; white-space: nowrap;">
              🔄 開放補考
            </button>
          `;
        }
      }

      tr.innerHTML = `
        <td style="font-weight: 700;">${numText}</td>
        <td style="font-weight: 600;">${getStudentDisplayName(s)}</td>
        <td>${groupBadge}</td>
        <td>
          <input type="number" step="any" min="0" max="${quiz.max_score}" class="score-quick-input ${scoreVal !== '' ? (scoreVal < quiz.passing_score ? 'failed' : 'passed') : ''}" value="${scoreVal}" placeholder="${s.allow_makeup ? '補考分' : '-'}" ${isInputDisabled ? 'disabled' : ''}>
          ${s.allow_makeup ? '<div style="font-size: 0.7rem; color: #10b981; font-weight: 700; margin-top: 2px;">(開放補考中)</div>' : ''}
        </td>
        <td style="text-align: center; vertical-align: middle;">
          <div style="display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 4px;">
            <div style="display: inline-flex; align-items: center; gap: 6px;">
              <input type="checkbox" class="quiz-absent-checkbox" ${s.is_absent ? 'checked' : ''}>
              ${leaveBadgeHtml}
            </div>
            ${makeupBtnHtml}
          </div>
        </td>
        <td style="text-align: center;">${photoColHtml}</td>
        <td>${sourceTagHtml}</td>
        <td>
          <input type="text" class="input-control quiz-note-input" value="${s.note || ''}" placeholder="備註..." style="width: 100%; font-size: 0.85rem; padding: 4px 8px;">
        </td>
      `;

      const scoreInput = tr.querySelector('.score-quick-input');
      const absentCheckbox = tr.querySelector('.quiz-absent-checkbox');
      const noteInput = tr.querySelector('.quiz-note-input');
      const photoBadge = tr.querySelector('.quiz-photo-badge');
      const makeupBtn = tr.querySelector('.btn-makeup-toggle');

      if (makeupBtn) {
        makeupBtn.addEventListener('click', async (e) => {
          e.preventDefault();
          triggerPaperQuizAutoSave(true);
          const stuId = Number(makeupBtn.dataset.studentId);
          const allowVal = makeupBtn.dataset.allow === '1';
          try {
            const res = await API.post(`/api/paper-quizzes/${quiz.id}/makeup/${stuId}`, { allow_makeup: allowVal });
            showToast(res.message || '補考設定已更新！', 'positive');
            await loadPaperQuizMatrix(quiz.id);
          } catch (err) {
            showToast(`操作失敗：${err.message}`, 'error');
          }
        });
      }

      scoreInput.addEventListener('input', () => {
        const val = parseFloat(scoreInput.value);
        scoreInput.classList.remove('failed', 'passed');
        if (!isNaN(val)) {
          if (val < quiz.passing_score) scoreInput.classList.add('failed');
          else scoreInput.classList.add('passed');
        }
        recalculatePaperQuizStatsRealtime();
        triggerPaperQuizAutoSave(false);
      });

      scoreInput.addEventListener('change', () => {
        recalculatePaperQuizStatsRealtime();
        triggerPaperQuizAutoSave(true);
      });

      scoreInput.addEventListener('blur', () => {
        triggerPaperQuizAutoSave(true);
      });

      absentCheckbox.addEventListener('change', () => {
        if (absentCheckbox.checked) {
          tr.classList.add('is-absent');
          if (tr.dataset.allowMakeup !== '1') {
            scoreInput.disabled = true;
            scoreInput.value = '';
            scoreInput.classList.remove('failed', 'passed');
          }
        } else {
          tr.classList.remove('is-absent');
          scoreInput.disabled = false;
          scoreInput.focus();
        }
        recalculatePaperQuizStatsRealtime();
        triggerPaperQuizAutoSave(true);
      });

      noteInput.addEventListener('input', () => {
        triggerPaperQuizAutoSave(false);
      });

      noteInput.addEventListener('change', () => {
        triggerPaperQuizAutoSave(true);
      });

      noteInput.addEventListener('blur', () => {
        triggerPaperQuizAutoSave(true);
      });

      scoreInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' || e.key === 'ArrowDown') {
          e.preventDefault();
          triggerPaperQuizAutoSave(true);
          const nextTr = e.shiftKey ? tr.previousElementSibling : tr.nextElementSibling;
          if (nextTr) {
            const targetInput = nextTr.querySelector('.score-quick-input');
            if (targetInput && !targetInput.disabled) targetInput.focus(), targetInput.select();
          }
        } else if (e.key === 'ArrowUp') {
          e.preventDefault();
          triggerPaperQuizAutoSave(true);
          const prevTr = tr.previousElementSibling;
          if (prevTr) {
            const targetInput = prevTr.querySelector('.score-quick-input');
            if (targetInput && !targetInput.disabled) targetInput.focus(), targetInput.select();
          }
        } else if (e.key === 'a' || e.key === 'A') {
          e.preventDefault();
          absentCheckbox.checked = true;
          absentCheckbox.dispatchEvent(new Event('change'));
          const nextTr = tr.nextElementSibling;
          if (nextTr) {
            const targetInput = nextTr.querySelector('.score-quick-input');
            if (targetInput) targetInput.focus(), targetInput.select();
          }
        } else if ((e.ctrlKey || e.metaKey) && (e.key === 's' || e.key === 'S')) {
          e.preventDefault();
          triggerPaperQuizAutoSave(true);
        }
      });

      if (photoBadge) {
        photoBadge.addEventListener('click', (e) => {
          e.preventDefault();
          openQuizPhotoVerifyModal({
            quizId: quiz.id,
            studentId: Number(photoBadge.dataset.studentId),
            studentName: photoBadge.dataset.studentName,
            studentNum: photoBadge.dataset.studentNum,
            score: photoBadge.dataset.score,
            photoUrl: photoBadge.dataset.photoUrl,
            isVerified: photoBadge.dataset.verified === '1',
          });
        });
      }

      tbody.appendChild(tr);
    });
  }
}

// --------------------------------------------------------------------------
// ⚡ 紙本測驗成績「自動儲存」核心引擎 (Debounced Auto-Save Engine)
// --------------------------------------------------------------------------
let gPaperQuizAutoSaveTimer = null;
let gPaperQuizIsSaving = false;
let gPaperQuizHasPendingSave = false;

function setPaperQuizAutoSaveStatus(status, text = '') {
  const indicator = document.getElementById('paper-quiz-autosave-indicator');
  const iconEl = document.getElementById('paper-quiz-autosave-icon');
  const textEl = document.getElementById('paper-quiz-autosave-text');
  if (!indicator || !textEl) return;

  if (status === 'saving') {
    indicator.style.color = '#3b82f6';
    indicator.style.background = 'rgba(59, 130, 246, 0.12)';
    indicator.style.borderColor = 'rgba(59, 130, 246, 0.3)';
    if (iconEl) iconEl.textContent = '⏳';
    textEl.textContent = text || '自動儲存中...';
  } else if (status === 'saved') {
    indicator.style.color = '#10b981';
    indicator.style.background = 'rgba(16, 185, 129, 0.12)';
    indicator.style.borderColor = 'rgba(16, 185, 129, 0.3)';
    if (iconEl) iconEl.textContent = '✓';
    textEl.textContent = text || '已自動儲存';
  } else if (status === 'error') {
    indicator.style.color = '#ef4444';
    indicator.style.background = 'rgba(239, 68, 68, 0.12)';
    indicator.style.borderColor = 'rgba(239, 68, 68, 0.3)';
    if (iconEl) iconEl.textContent = '⚠️';
    textEl.textContent = text || '儲存失敗';
  } else {
    indicator.style.color = '#10b981';
    indicator.style.background = 'rgba(16, 185, 129, 0.12)';
    indicator.style.borderColor = 'rgba(16, 185, 129, 0.3)';
    if (iconEl) iconEl.textContent = '⚡';
    textEl.textContent = text || '自動儲存已啟用';
  }
}

function triggerPaperQuizAutoSave(immediate = false) {
  if (!AppState.currentPaperQuizId) return;

  if (immediate) {
    if (gPaperQuizAutoSaveTimer) {
      clearTimeout(gPaperQuizAutoSaveTimer);
      gPaperQuizAutoSaveTimer = null;
    }
    doAutoSavePaperQuizRecords();
  } else {
    setPaperQuizAutoSaveStatus('saving', '變更中...');
    if (gPaperQuizAutoSaveTimer) clearTimeout(gPaperQuizAutoSaveTimer);
    gPaperQuizAutoSaveTimer = setTimeout(() => {
      gPaperQuizAutoSaveTimer = null;
      doAutoSavePaperQuizRecords();
    }, 450);
  }
}

async function doAutoSavePaperQuizRecords() {
  const quizId = AppState.currentPaperQuizId;
  if (!quizId) return;

  if (gPaperQuizIsSaving) {
    gPaperQuizHasPendingSave = true;
    return;
  }

  const tbody = document.getElementById('paper-quiz-matrix-tbody');
  if (!tbody) return;

  const { quiz, students } = AppState.currentPaperQuizData || {};
  if (!quiz || !Array.isArray(students)) return;

  const rows = tbody.querySelectorAll('tr[data-student-id]');
  const records = [];

  rows.forEach((tr) => {
    const studentId = Number(tr.dataset.studentId);
    const studentObj = students.find((s) => s.student_id === studentId);

    const scoreInput = tr.querySelector('.score-quick-input');
    const absentCheckbox = tr.querySelector('.quiz-absent-checkbox');
    const noteInput = tr.querySelector('.quiz-note-input');

    const allowMakeup = tr.dataset.allowMakeup === '1';
    const rawScore = scoreInput ? scoreInput.value.trim() : '';
    const hasScore = rawScore !== '' && !isNaN(Number(rawScore));
    const isAbsent = (absentCheckbox ? absentCheckbox.checked : false) && (!allowMakeup || !hasScore);
    const score = isAbsent ? null : (hasScore ? Math.min(Number(rawScore), quiz.max_score) : null);
    const note = noteInput ? noteInput.value.trim() : '';
    const leaveType = tr.dataset.leaveType || '';
    const isMakeup = tr.dataset.isMakeup === '1' || (allowMakeup && score !== null);

    if (studentObj) {
      studentObj.score = score;
      studentObj.is_absent = isAbsent;
      studentObj.note = note;
      studentObj.is_makeup = isMakeup;
    }

    records.push({
      student_id: studentId,
      score,
      is_absent: isAbsent,
      allow_makeup: allowMakeup,
      leave_type: leaveType,
      is_makeup: isMakeup,
      note,
    });
  });

  // 保留可能被快速過濾器隱藏的其他學生既有數據
  students.forEach((s) => {
    if (!records.some((r) => r.student_id === s.student_id)) {
      records.push({
        student_id: s.student_id,
        score: s.score,
        is_absent: s.is_absent,
        allow_makeup: s.allow_makeup,
        leave_type: s.leave_type || '',
        is_makeup: s.is_makeup,
        note: s.note || '',
      });
    }
  });

  gPaperQuizIsSaving = true;
  setPaperQuizAutoSaveStatus('saving', '自動儲存中...');

  try {
    await API.post(`/api/paper-quizzes/${quizId}/batch-save`, { records });
    const nowStr = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
    setPaperQuizAutoSaveStatus('saved', `已自動儲存 (${nowStr})`);
  } catch (err) {
    console.error('Paper quiz auto-save failed:', err);
    setPaperQuizAutoSaveStatus('error', '儲存失敗，請檢查連線');
  } finally {
    gPaperQuizIsSaving = false;
    if (gPaperQuizHasPendingSave) {
      gPaperQuizHasPendingSave = false;
      doAutoSavePaperQuizRecords();
    }
  }
}

function openPaperQuizModal(isEdit = false) {
  const modal = document.getElementById('modal-paper-quiz-editor');
  if (!modal) return;

  const titleEl = document.getElementById('modal-paper-quiz-title');
  const idInput = document.getElementById('quiz-edit-id');
  const titleInput = document.getElementById('quiz-edit-title');
  const subjectInput = document.getElementById('quiz-edit-subject');
  const dateInput = document.getElementById('quiz-edit-date');
  const maxInput = document.getElementById('quiz-edit-max-score');
  const passInput = document.getElementById('quiz-edit-pass-score');
  const subUnitSelect = document.getElementById('quiz-edit-subunit-select');
  const allowSelfCheck = document.getElementById('quiz-edit-allow-self');
  const allowLeaderCheck = document.getElementById('quiz-edit-allow-leader');

  if (subUnitSelect) {
    subUnitSelect.innerHTML = '<option value="">無關聯單元</option>';
    if (Array.isArray(AppState.units)) {
      AppState.units.forEach(u => {
        if (Array.isArray(u.sub_units)) {
          u.sub_units.forEach(su => {
            const opt = document.createElement('option');
            opt.value = su.id;
            opt.textContent = `${u.title} - ${su.title}`;
            subUnitSelect.appendChild(opt);
          });
        }
      });
    }
  }

  if (isEdit && AppState.currentPaperQuizData && AppState.currentPaperQuizData.quiz) {
    const q = AppState.currentPaperQuizData.quiz;
    if (titleEl) titleEl.textContent = (window.I18n && window.I18n.t('paper_quiz_modal_edit_title')) || '⚙️ 編輯紙本測驗設定';
    if (idInput) idInput.value = q.id;
    if (titleInput) titleInput.value = q.title;
    if (subjectInput) subjectInput.value = q.subject || '';
    if (dateInput) dateInput.value = q.quiz_date;
    if (maxInput) maxInput.value = q.max_score;
    if (passInput) passInput.value = q.passing_score;
    if (subUnitSelect) subUnitSelect.value = q.sub_unit_id || '';
    if (allowSelfCheck) allowSelfCheck.checked = !!q.allow_self_entry;
    if (allowLeaderCheck) allowLeaderCheck.checked = !!q.allow_leader_entry;
  } else {
    if (titleEl) titleEl.textContent = (window.I18n && window.I18n.t('paper_quiz_modal_create_title')) || '📝 建立新紙本測驗';
    if (idInput) idInput.value = '';
    if (titleInput) titleInput.value = '';
    const currentFilteredSubject = document.getElementById('paper-quiz-filter-subject')?.value || '';
    if (subjectInput) subjectInput.value = currentFilteredSubject;
    if (dateInput) dateInput.value = getTaiwanTodayDateStr();
    if (maxInput) maxInput.value = '100';
    if (passInput) passInput.value = '60';
    if (subUnitSelect) subUnitSelect.value = '';
    if (allowSelfCheck) allowSelfCheck.checked = true;
    if (allowLeaderCheck) allowLeaderCheck.checked = true;
  }

  openModal('modal-paper-quiz-editor');
}

async function submitPaperQuizForm(e) {
  e.preventDefault();
  const idInput = document.getElementById('quiz-edit-id');
  const titleInput = document.getElementById('quiz-edit-title');
  const subjectInput = document.getElementById('quiz-edit-subject');
  const dateInput = document.getElementById('quiz-edit-date');
  const maxInput = document.getElementById('quiz-edit-max-score');
  const passInput = document.getElementById('quiz-edit-pass-score');
  const subUnitSelect = document.getElementById('quiz-edit-subunit-select');
  const allowSelfCheck = document.getElementById('quiz-edit-allow-self');
  const allowLeaderCheck = document.getElementById('quiz-edit-allow-leader');

  const title = titleInput.value.trim();
  const subject = subjectInput ? subjectInput.value.trim() : '';
  const quiz_date = dateInput.value;
  if (!title) {
    alert('請輸入測驗名稱');
    return;
  }
  if (!quiz_date) {
    alert('請選擇測驗日期');
    return;
  }

  const payload = {
    title,
    subject,
    quiz_date,
    max_score: Number(maxInput.value) || 100,
    passing_score: Number(passInput.value) || 60,
    sub_unit_id: subUnitSelect.value ? Number(subUnitSelect.value) : null,
    allow_self_entry: allowSelfCheck.checked ? 1 : 0,
    allow_leader_entry: allowLeaderCheck.checked ? 1 : 0,
  };

  const editId = idInput.value;
  try {
    if (editId) {
      await API.put(`/api/paper-quizzes/${editId}`, payload);
      showToast('紙本測驗更新成功！', 'positive');
      closeModal('modal-paper-quiz-editor');
      await loadPaperQuizData(false, Number(editId));
    } else {
      const res = await API.post(`/api/paper-quizzes/${AppState.currentCourseId}`, payload);
      showToast('紙本測驗建立成功！', 'positive');
      closeModal('modal-paper-quiz-editor');
      AppState.currentPaperQuizId = res.quiz.id;
      await loadPaperQuizData(false, res.quiz.id);
    }
  } catch (err) {
    alert(`儲存測驗失敗：${err.message}`);
  }
}

async function confirmDeleteCurrentPaperQuiz() {
  if (!AppState.currentPaperQuizId) return;
  const q = AppState.paperQuizzes.find(item => item.id === AppState.currentPaperQuizId);
  const quizName = q ? q.title : '本測驗';

  if (!await showConfirmModal({
    icon: '🗑️',
    title: '刪除紙本測驗',
    desc: `確定要刪除「${quizName}」嗎？此測驗內所有學生的登記成績與照片紀錄將一併清除！`,
    confirmText: '確定刪除',
    cancelText: '取消'
  })) return;

  try {
    await API.delete(`/api/paper-quizzes/${AppState.currentPaperQuizId}`);
    showToast('紙本測驗已刪除！', 'positive');
    AppState.currentPaperQuizId = null;
    await loadPaperQuizData();
  } catch (err) {
    alert(`刪除失敗：${err.message}`);
  }
}

let gCurrentVerifyCtx = null;
function openQuizPhotoVerifyModal(ctx) {
  gCurrentVerifyCtx = ctx;
  const modal = document.getElementById('modal-quiz-photo-verify');
  const titleEl = document.getElementById('quiz-photo-verify-title');
  const imgEl = document.getElementById('quiz-photo-verify-img');
  if (!modal || !imgEl) return;

  if (titleEl) {
    const scoreText = ctx.score ? ` (得分: ${ctx.score})` : '';
    const statusText = ctx.isVerified ? ' [已核准]' : ' [待審核]';
    titleEl.textContent = `📷 考卷佐證查驗 - ${ctx.studentNum}號 ${ctx.studentName}${scoreText}${statusText}`;
  }
  imgEl.src = ctx.photoUrl;

  openModal('modal-quiz-photo-verify');
}

async function setQuizPhotoVerifyStatus(isVerified) {
  if (!gCurrentVerifyCtx) return;
  const { quizId, studentId } = gCurrentVerifyCtx;
  try {
    const res = await API.post(`/api/paper-quizzes/${quizId}/verify/${studentId}`, { is_verified: isVerified ? 1 : 0 });
    showToast(res.message || (isVerified ? '已核准考卷照片！' : '已取消核准狀態'), 'positive');
    closeModal('modal-quiz-photo-verify');
    await loadPaperQuizMatrix(quizId);
  } catch (err) {
    alert(`審核操作失敗：${err.message}`);
  }
}

// ==========================================================================
// 📊 紙本測驗學生成績總覽 (在線即時預覽與篩選)
// ==========================================================================

let gPaperQuizOverviewData = null;

async function openPaperQuizOverviewModal() {
  if (!ensureCourseSelected()) return;

  // 1. 同步現有科目分類至總覽科目下拉選單
  const subjectSelect = document.getElementById('paper-quiz-overview-subject');
  if (subjectSelect) {
    const currentFilterVal = document.getElementById('paper-quiz-filter-subject')?.value || '';
    const subjects = Array.from(new Set(AppState.paperQuizzes.map(q => q.subject).filter(Boolean))).sort();
    
    const allSubjectsText = (window.I18n && window.I18n.t('paper_quiz_filter_all_subjects')) || '全部科目';
    subjectSelect.innerHTML = `<option value="">${allSubjectsText}</option>`;
    subjects.forEach(subj => {
      const opt = document.createElement('option');
      opt.value = subj;
      opt.textContent = `📚 ${subj}`;
      subjectSelect.appendChild(opt);
    });
    if (subjects.includes(currentFilterVal)) {
      subjectSelect.value = currentFilterVal;
    } else {
      subjectSelect.value = '';
    }
  }

  // 2. 開啟彈窗並立即載入總覽資料
  openModal('modal-paper-quiz-overview');
  await loadPaperQuizOverviewData();
}

async function loadPaperQuizOverviewData() {
  if (!AppState.currentCourseId) return;

  const subject = document.getElementById('paper-quiz-overview-subject')?.value || '';
  const startDate = document.getElementById('paper-quiz-overview-start-date')?.value || '';
  const endDate = document.getElementById('paper-quiz-overview-end-date')?.value || '';

  const thead = document.getElementById('paper-quiz-overview-thead');
  const tbody = document.getElementById('paper-quiz-overview-tbody');
  const badge = document.getElementById('paper-quiz-overview-count-badge');
  const summaryBar = document.getElementById('paper-quiz-overview-summary-bar');

  if (tbody) {
    tbody.innerHTML = `<tr><td colspan="10" style="text-align:center; padding: 40px; color: var(--text-muted);">⏳ 正在載入學生成績總覽，請稍候...</td></tr>`;
  }

  try {
    let url = `/api/paper-quizzes/${AppState.currentCourseId}/overview?`;
    if (subject) url += `subject=${encodeURIComponent(subject)}&`;
    if (startDate) url += `start_date=${encodeURIComponent(startDate)}&`;
    if (endDate) url += `end_date=${encodeURIComponent(endDate)}&`;

    const data = await API.get(url);
    gPaperQuizOverviewData = data;

    renderPaperQuizOverviewTable(data);
  } catch (err) {
    console.error('Failed to load quiz overview:', err);
    if (tbody) {
      tbody.innerHTML = `<tr><td colspan="10" style="text-align:center; padding: 30px; color: var(--accent-negative);">❌ 載入失敗：${err.message}</td></tr>`;
    }
    showToast(`載入成績總覽失敗：${err.message}`, 'error');
  }
}

function renderPaperQuizOverviewTable(data) {
  const thead = document.getElementById('paper-quiz-overview-thead');
  const tbody = document.getElementById('paper-quiz-overview-tbody');
  const badge = document.getElementById('paper-quiz-overview-count-badge');
  const summaryBar = document.getElementById('paper-quiz-overview-summary-bar');

  if (!data || !thead || !tbody) return;

  const quizzes = data.quizzes || [];
  const students = data.students || [];

  if (badge) {
    badge.textContent = `共 ${quizzes.length} 次測驗 / ${students.length} 位學生`;
  }

  // 1. 計算頂部摘要統計
  let allScoresTotal = 0;
  let allScoresCount = 0;
  let allPassCount = 0;
  let allAbsentCount = 0;

  quizzes.forEach(q => {
    allAbsentCount += q.stats.absent_count || 0;
    allPassCount += q.stats.pass_count || 0;
    allScoresCount += q.stats.scored_count || 0;
    if (q.stats.average_score !== null && q.stats.scored_count > 0) {
      allScoresTotal += (q.stats.average_score * q.stats.scored_count);
    }
  });

  const overallAvg = allScoresCount > 0 ? (Math.round((allScoresTotal / allScoresCount) * 10) / 10).toFixed(1) : '-';
  const overallPassRate = allScoresCount > 0 ? `${(Math.round((allPassCount / allScoresCount) * 1000) / 10).toFixed(1)}%` : '-';

  if (summaryBar) {
    summaryBar.innerHTML = `
      <div class="paper-quiz-stat-card" style="padding: 10px 14px; background: rgba(59, 130, 246, 0.08); border: 1px solid rgba(59, 130, 246, 0.2); border-radius: 8px; text-align: center;">
        <div style="font-size: 1.3rem; font-weight: 800; color: var(--primary);">${quizzes.length}</div>
        <div style="font-size: 0.78rem; color: var(--text-muted); font-weight: 600;">納入測驗數</div>
      </div>
      <div class="paper-quiz-stat-card" style="padding: 10px 14px; background: rgba(16, 185, 129, 0.08); border: 1px solid rgba(16, 185, 129, 0.2); border-radius: 8px; text-align: center;">
        <div style="font-size: 1.3rem; font-weight: 800; color: #10b981;">${overallAvg}</div>
        <div style="font-size: 0.78rem; color: var(--text-muted); font-weight: 600;">全體平均分</div>
      </div>
      <div class="paper-quiz-stat-card" style="padding: 10px 14px; background: rgba(99, 102, 241, 0.08); border: 1px solid rgba(99, 102, 241, 0.2); border-radius: 8px; text-align: center;">
        <div style="font-size: 1.3rem; font-weight: 800; color: #6366f1;">${overallPassRate}</div>
        <div style="font-size: 0.78rem; color: var(--text-muted); font-weight: 600;">全體及格率</div>
      </div>
      <div class="paper-quiz-stat-card" style="padding: 10px 14px; background: rgba(239, 68, 68, 0.08); border: 1px solid rgba(239, 68, 68, 0.2); border-radius: 8px; text-align: center;">
        <div style="font-size: 1.3rem; font-weight: 800; color: #ef4444;">${allAbsentCount}</div>
        <div style="font-size: 0.78rem; color: var(--text-muted); font-weight: 600;">累計缺考人次</div>
      </div>
    `;
  }

  // 若無測驗
  if (quizzes.length === 0) {
    thead.innerHTML = `
      <tr>
        <th class="sticky-col-no" style="padding: 12px 14px;">座號</th>
        <th class="sticky-col-name" style="padding: 12px 14px;">姓名</th>
        <th style="padding: 12px 14px;">測驗成績</th>
      </tr>
    `;
    tbody.innerHTML = `<tr><td colspan="3" style="text-align:center; padding: 40px; color: var(--text-muted);">該篩選條件下查無任何紙本測驗紀錄，請調整科目或日期區間。</td></tr>`;
    tfoot.innerHTML = '';
    return;
  }

  // 2. 表頭：凍結左側座號、姓名，中間橫向展開各次測驗（含日期、科目、名稱、滿分/及格線），右側橫向個人統計（平均分、及格率）
  let headHtml = `
    <tr>
      <th class="sticky-col-no" style="padding: 10px 6px;">座號</th>
      <th class="sticky-col-name" style="padding: 10px 12px;">姓名</th>
  `;

  quizzes.forEach(q => {
    const subjBadge = q.subject ? `<span style="display:inline-block; font-size: 0.72rem; font-weight: 700; padding: 1px 6px; border-radius: 4px; background: rgba(91,124,214,0.18); color: var(--primary); margin-bottom: 2px;">${q.subject}</span><br>` : '';
    headHtml += `
      <th style="padding: 8px 10px; min-width: 115px; max-width: 160px; font-size: 0.82rem; vertical-align: top;">
        <div style="font-size: 0.74rem; color: var(--text-muted); font-family: monospace;">${q.quiz_date}</div>
        ${subjBadge}
        <div style="font-weight: 700; color: var(--text-main); white-space: nowrap; overflow: hidden; text-overflow: ellipsis;" title="${q.title}">${q.title}</div>
        <div style="font-size: 0.72rem; color: var(--text-muted); font-weight: 500;">滿分:${q.max_score} / 及格:${q.passing_score}</div>
      </th>
    `;
  });

  headHtml += `
      <th style="padding: 10px 10px; width: 85px; min-width: 85px; background: #e0f2fe; color: #0284c7; font-size: 0.85rem; font-weight: 800;">個人平均</th>
      <th style="padding: 10px 10px; width: 80px; min-width: 80px; background: #ede9fe; color: #7c3aed; font-size: 0.85rem; font-weight: 800;">及格率</th>
    </tr>
  `;
  thead.innerHTML = headHtml;

  // 3. 表身：每位學生的純成績列
  let bodyHtml = '';
  students.forEach((s) => {
    bodyHtml += `<tr>`;

    // 凍結座號
    bodyHtml += `
      <td class="sticky-col-no" style="font-weight: 700; color: var(--text-muted);">
        ${s.student_number}
      </td>
    `;

    // 凍結姓名
    bodyHtml += `
      <td class="sticky-col-name" style="color: var(--text-main);">
        ${s.name}
      </td>
    `;

    // 各次測驗得分
    quizzes.forEach(q => {
      const scoreObj = s.scores[q.id];
      if (!scoreObj) {
        bodyHtml += `<td style="color: var(--text-subtle);">-</td>`;
        return;
      }

      if (scoreObj.is_absent) {
        bodyHtml += `<td style="font-weight: 800; color: #dc2626; background: rgba(254, 226, 226, 0.5);" title="缺考">缺考</td>`;
      } else if (scoreObj.score !== null) {
        const sc = scoreObj.score;
        const isPass = sc >= q.passing_score;
        const color = isPass ? 'var(--text-main)' : '#dc2626';
        const weight = isPass ? '600' : '800';
        const makeupMark = scoreObj.is_makeup ? `<span style="font-size:0.7rem; color: #d97706; margin-left: 2px;">(補)</span>` : '';
        bodyHtml += `
          <td style="font-weight: ${weight}; color: ${color};">
            ${sc}${makeupMark}
          </td>
        `;
      } else {
        bodyHtml += `<td style="color: var(--text-subtle);">-</td>`;
      }
    });

    // 個人平均與及格率
    const avgStr = s.summary.average_score !== null ? s.summary.average_score.toFixed(1) : '-';
    const passRateStr = s.summary.pass_rate !== null ? `${s.summary.pass_rate.toFixed(0)}%` : '-';
    const avgColor = s.summary.average_score !== null && s.summary.average_score >= 60 ? 'var(--accent-positive, #059669)' : (s.summary.average_score !== null ? '#dc2626' : 'var(--text-subtle)');

    bodyHtml += `
      <td style="font-weight: 800; color: ${avgColor}; background: rgba(224, 242, 254, 0.35);">
        ${avgStr}
      </td>
      <td style="font-weight: 700; color: #7c3aed; background: rgba(237, 233, 254, 0.35);">
        ${passRateStr}
      </td>
    `;

    bodyHtml += `</tr>`;
  });
  tbody.innerHTML = bodyHtml;
}
