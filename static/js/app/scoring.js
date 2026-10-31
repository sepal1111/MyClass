// MyClass 教師端：加減分（含快速模式、座位檢視、復原），以及共用的 showToast／ensureCourseSelected
// 由 static/js/app.js 拆出（2026-10-31，原第 1382–2595 行），程式內容未變更。
// 所有 static/js/app.js 與 static/js/app/*.js 共用同一個全域範圍（一般 <script>，不是模組），載入順序見 static/index.html。


// --- Scoring Pane ---
async function loadScoringData() {
  if (!AppState.currentCourseId || (AppState.courses && AppState.courses.length === 0)) {
    renderEmptyCourseNotice(document.getElementById('scoring-student-grid'));
    renderEmptyCourseNotice(document.getElementById('scoring-seating-grid'));
    return;
  }
  try {
    const period = AppState.scoringPeriod || 'today';
    let dashUrl = `/api/reports/${AppState.currentCourseId}/dashboard?period=${period}`;
    if (period === 'range') {
      const s = AppState.scoringStartDate || document.getElementById('scoring-start-date')?.value;
      const e = AppState.scoringEndDate || document.getElementById('scoring-end-date')?.value;
      if (s && e) {
        dashUrl += `&start_date=${encodeURIComponent(s)}&end_date=${encodeURIComponent(e)}`;
      }
    }

    const [rules, dashData, groupsData, seatingData] = await Promise.all([
      API.get(`/api/scores/${AppState.currentCourseId}/rules`),
      API.get(dashUrl),
      API.get(`/api/groups/${AppState.currentCourseId}`),
      API.get(`/api/seating/${AppState.currentCourseId}`).catch(err => {
        console.warn('Seating chart fetch failed:', err);
        return null;
      })
    ]);

    AppState.rules = rules;
    AppState.students = dashData.students;
    AppState.groups = groupsData.groups;
    if (seatingData) {
      AppState.seatingData = seatingData;
    }
    if (dashData.plan && dashData.plan.id) {
      AppState.activeGroupPlanId = dashData.plan.id;
    } else if (groupsData.current_plan && groupsData.current_plan.id) {
      AppState.activeGroupPlanId = groupsData.current_plan.id;
    }

    // Map real-time group scores from dashboard data
    AppState.groupScoresMap = {};
    (dashData.group_leaderboard || []).forEach(g => {
      if (g.id) AppState.groupScoresMap[g.id] = g.total_score;
      if (g.group_name) AppState.groupScoresMap[g.group_name] = g.total_score;
    });

    renderRulesBar();
    renderQuickGroupBar();
    renderScoringView();
    updateScoringPeriodUI();
    if (window.TeachingToolkit && window.TeachingToolkit.floatingDock) {
      window.TeachingToolkit.floatingDock.updatePoolBadge();
    }
  } catch (err) {
    console.error('Scoring data load error:', err);
  }
}

function updateScoringPeriodUI() {
  const period = AppState.scoringPeriod || 'today';
  document.querySelectorAll('.scoring-period-btn').forEach(b => {
    if (b.dataset.period === period) {
      b.classList.add('active');
      b.classList.remove('btn-secondary');
    } else {
      b.classList.remove('active');
      b.classList.add('btn-secondary');
    }
  });

  const rangeInputs = document.getElementById('scoring-range-inputs');
  if (rangeInputs) {
    rangeInputs.style.display = period === 'range' ? 'flex' : 'none';
  }

  const badge = document.getElementById('scoring-period-badge');
  if (badge) {
    const isEn = window.I18n && window.I18n.getLanguage() === 'en';
    const prefix = window.I18n ? window.I18n.t('scoring_period_badge_prefix', '分數統計：') : '分數統計：';
    let label = isEn ? 'Today' : '當天';
    if (period === 'week') {
      label = isEn ? 'This Week' : '當週';
    } else if (period === 'month') {
      label = isEn ? 'This Month' : '當月';
    } else if (period === 'range') {
      const s = document.getElementById('scoring-start-date')?.value || AppState.scoringStartDate;
      const e = document.getElementById('scoring-end-date')?.value || AppState.scoringEndDate;
      if (s && e) {
        label = `${s} ~ ${e}`;
      } else {
        label = isEn ? 'Custom Range (Select Dates)' : '指定期間 (請選擇日期)';
      }
    }
    badge.textContent = `📅 ${prefix}${label}`;
  }
}

function renderRulesBar() {
  const container = document.getElementById('rules-container');
  container.innerHTML = '';

  AppState.rules.forEach(rule => {
    const btn = document.createElement('button');
    btn.className = `rule-btn ${rule.category}`;
    const changeText = rule.score_value > 0 ? `+${rule.score_value}` : `${rule.score_value}`;
    const displayTitle = window.I18n ? window.I18n.getRuleDisplayTitle(rule.title) : rule.title;
    btn.innerHTML = `
      <span>${rule.icon} ${displayTitle}</span>
      <span class="score-badge-change">${changeText}</span>
    `;
    btn.addEventListener('click', () => applyScoreRule(rule));
    container.appendChild(btn);
  });

  // Append integrated Qualitative Text Note button inside scoring popover!
  const noteBtn = document.createElement('button');
  noteBtn.className = 'rule-btn';
  noteBtn.style.borderColor = 'rgba(167, 139, 250, 0.5)';
  noteBtn.style.background = 'rgba(167, 139, 250, 0.15)';
  const noteBtnText = window.I18n ? window.I18n.t('notes_card_title') : '📝 特殊表現紀錄';
  noteBtn.innerHTML = `<span>${noteBtnText}</span>`;
  noteBtn.addEventListener('click', openQuickNoteModal);
  container.appendChild(noteBtn);
}

function openQuickNoteModal() {
  if (AppState.selectedStudentIds.size === 0) {
    alert('請先點選至少一位學生！');
    return;
  }

  // Enforce Single Student Record: retain only the LAST selected student!
  const selectedArr = Array.from(AppState.selectedStudentIds);
  openQuickNoteForStudent(selectedArr[selectedArr.length - 1]);
}

// 直接替某位學生開啟快速紀錄視窗（學生卡片上的 📝 按鈕與評分彈窗共用）
function openQuickNoteForStudent(targetStudentId) {
  AppState.selectedStudentIds.clear();
  AppState.selectedStudentIds.add(targetStudentId);
  renderScoringStudentGrid();

  const student = AppState.students.find(s => s.id === targetStudentId);
  const studentName = student ? `${student.student_number}號 ${getStudentDisplayName(student)}` : '';
  const avatarHtml = student ? `<span style="width: 28px; height: 28px; border-radius: 50%; overflow: hidden; display: inline-block; vertical-align: middle; margin-right: 6px;">${getStudentAvatarImgHtml(student)}</span>` : '';

  const dateInput = document.getElementById('quick-note-date');
  dateInput.value = getTaiwanTodayDateStr();

  document.getElementById('quick-note-modal-title').innerHTML = `📝 ${avatarHtml}【${studentName}】特殊表現紀錄`;
  document.getElementById('quick-note-text').value = '';
  renderNotePhraseChips('quick-note-phrase-chips', 'quick-note-text');
  resetNoteMedia(QUICK_NOTE_MEDIA_INPUT_IDS);
  openModal('modal-quick-note');
}

// 學生卡片右上角的 📝 快速紀錄按鈕
function attachCardNoteButton(cardEl, student) {
  const t = (k, p) => window.I18n ? window.I18n.t(k, p) : k;
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'card-note-btn';
  btn.textContent = '📝';
  btn.title = t('notes_card_title');
  btn.setAttribute('aria-label', t('notes_card_title'));
  btn.addEventListener('click', (e) => {
    e.stopPropagation();
    openQuickNoteForStudent(student.id);
  });
  cardEl.appendChild(btn);
}

async function confirmSaveQuickNote() {
  const selectedArr = Array.from(AppState.selectedStudentIds);
  if (selectedArr.length === 0) return;
  const studentId = selectedArr[0];
  const dateStr = document.getElementById('quick-note-date').value || getTaiwanTodayDateStr();
  const noteText = document.getElementById('quick-note-text').value.trim();
  const mediaFile = getNoteMediaFile(QUICK_NOTE_MEDIA_INPUT_IDS);

  if (!noteText && !mediaFile) {
    alert('請輸入紀錄內容或選擇照片/影片檔案！');
    return;
  }

  try {
    const formData = new FormData();
    formData.append('student_id', studentId);
    formData.append('note_text', noteText);
    formData.append('date_str', dateStr);
    if (mediaFile) {
      formData.append('media_file', mediaFile);
    }

    await API.postFormData(`/api/notes/${AppState.currentCourseId}/with_media`, formData);
    document.querySelectorAll('.modal-overlay').forEach(m => m.classList.remove('open'));
    showUndoToast(null, `已為【${getStudentDisplayName(AppState.students.find(s => s.id === studentId))}】新增質性紀錄！`);
    if (getActiveTabName() === 'notes') {
      loadNotesData();
    }
  } catch (err) {
    alert(`儲存特殊表現紀錄失敗：${err.message}`);
  }
}

// --- Scoring Module ---

// Bulk-select helper for the "全班"/小組 quick buttons: today's absent
// students are skipped entirely rather than added to the scoring selection,
// so a class-wide or group-wide score never lands on someone who isn't here.
function selectStudentsSkippingAbsent(candidateIds) {
  if (AppState.quickScoringMode) return;
  AppState.selectedStudentIds.clear();
  const absentIds = new Set(AppState.students.filter(s => s.is_absent).map(s => s.id));
  let skipped = 0;
  candidateIds.forEach(id => {
    if (absentIds.has(id)) {
      skipped++;
    } else {
      AppState.selectedStudentIds.add(id);
    }
  });
  renderScoringStudentGrid();
  if (skipped > 0 && typeof showToast === 'function') {
    const t = (k, p) => window.I18n ? window.I18n.t(k, p) : k;
    showToast(t('quick_select_skipped_absent', { count: skipped }), 'info');
  }
}

function renderQuickGroupBar() {
  const container = document.getElementById('quick-group-bar');
  if (!container) return;
  container.innerHTML = '';

  const isEn = window.I18n && window.I18n.getLanguage() === 'en';
  const t = (k, p) => window.I18n ? window.I18n.t(k, p) : k;
  const isQuick = Boolean(AppState.quickScoringMode);
  const disabledHint = isQuick ? (t('quick_scoring_groups_disabled_hint') || '快速加減分模式下無法選擇小組') : '';

  // 1. All Class button
  const allBtn = document.createElement('button');
  allBtn.className = 'btn btn-secondary';
  allBtn.style.fontSize = '0.85rem';
  allBtn.style.padding = '6px 14px';
  allBtn.style.display = 'inline-flex';
  allBtn.style.flexDirection = 'column';
  allBtn.style.alignItems = 'center';
  allBtn.style.justifyContent = 'center';
  allBtn.style.gap = '2px';
  allBtn.style.minWidth = '75px';
  if (isQuick) {
    allBtn.disabled = true;
    allBtn.setAttribute('title', disabledHint);
  }
  allBtn.innerHTML = `
    <div style="font-weight: 700; display: flex; align-items: center; gap: 4px;">
      <span>🏫</span>
      <span>${isEn ? 'All Class' : '全班'}</span>
    </div>
    <span style="font-size: 0.72rem; color: var(--text-muted); font-weight: 600;">(${AppState.students.length}${isEn ? ' students' : '人'})</span>
  `;
  allBtn.onclick = () => {
    if (AppState.quickScoringMode) return;
    AppState.currentScoringGroupTarget = null;
    selectStudentsSkippingAbsent(AppState.students.map(s => s.id));
  };
  container.appendChild(allBtn);

  // 2. Group buttons with Real-Time Score Badge beneath group name!
  (AppState.groups || []).forEach((g, idx) => {
    const btn = document.createElement('button');
    btn.className = 'btn btn-secondary';
    btn.style.fontSize = '0.85rem';
    btn.style.padding = '6px 14px';
    btn.style.display = 'inline-flex';
    btn.style.flexDirection = 'column';
    btn.style.alignItems = 'center';
    btn.style.justifyContent = 'center';
    btn.style.gap = '2px';
    btn.style.minWidth = '85px';
    if (isQuick) {
      btn.disabled = true;
      btn.setAttribute('title', disabledHint);
    }

    const groupScore = (AppState.groupScoresMap && AppState.groupScoresMap[g.id] !== undefined)
      ? AppState.groupScoresMap[g.id]
      : ((AppState.groupScoresMap && AppState.groupScoresMap[g.group_name] !== undefined)
          ? AppState.groupScoresMap[g.group_name]
          : 0);

    btn.innerHTML = `
      <div style="display: flex; align-items: center; gap: 6px; font-weight: 700;">
        <img src="${getGroupAvatarSrc(g, idx)}" alt="${g.group_name}" style="width: 18px; height: 18px; object-fit: contain;">
        <span class="quick-group-name-label">${g.group_name}</span>
      </div>
      <div class="quick-group-score-badge" style="font-size: 0.75rem; font-weight: 800; color: #d3a24c; background: rgba(211, 162, 76, 0.15); padding: 1px 8px; border-radius: 9999px; border: 1px solid rgba(211, 162, 76, 0.35); display: inline-flex; align-items: center; justify-content: center; margin-top: 1px;">
        <span>${groupScore} ${t('pts')}</span>
      </div>
    `;
    btn.onclick = () => {
      if (AppState.quickScoringMode) return;
      AppState.currentScoringGroupTarget = {
        plan_id: g.plan_id || AppState.activeGroupPlanId,
        group_id: g.id,
        group_name: g.group_name
      };
      selectStudentsSkippingAbsent((g.students || []).map(s => s.id));
    };
    container.appendChild(btn);
  });
}

let lastClickCoords = { x: window.innerWidth / 2, y: window.innerHeight / 2 };

async function toggleQuickScoringMode() {
  if (AppState.quickScoringMode) {
    // Closing quick scoring -> commit any pending staged scores!
    await commitPendingQuickScores();
    AppState.quickScoringMode = false;
    localStorage.setItem('quick_scoring_mode', 'false');
    updateQuickScoringToggleUI();
    renderScoringView();
  } else {
    // Opening quick scoring -> enter staged mode
    AppState.quickScoringMode = true;
    AppState.pendingQuickScores = {};
    AppState.selectedStudentIds.clear();
    AppState.currentScoringGroupTarget = null;
    updateFloatingScoringDrawer();
    localStorage.setItem('quick_scoring_mode', 'true');
    const groupBar = document.getElementById('quick-group-bar');
    if (groupBar && document.activeElement && groupBar.contains(document.activeElement)) {
      document.activeElement.blur();
    }
    updateQuickScoringToggleUI();
    renderScoringView();
  }
}

async function commitPendingQuickScores() {
  const pending = AppState.pendingQuickScores || {};
  const updates = Object.entries(pending)
    .filter(([_, score]) => Number(score) !== 0)
    .map(([sid, score]) => ({ student_id: Number(sid), score: Number(score) }));

  if (updates.length === 0) {
    AppState.pendingQuickScores = {};
    return;
  }

  const btn = document.getElementById('btn-toggle-quick-scoring');
  if (btn) {
    btn.disabled = true;
  }

  try {
    const res = await API.post(`/api/scores/${AppState.currentCourseId}/batch`, {
      updates
    });

    AppState.pendingQuickScores = {};

    const t = (k, p) => window.I18n ? window.I18n.t(k, p) : k;
    const msg = window.I18n
      ? window.I18n.t('quick_scoring_saved_toast', { count: updates.length })
      : `已成功計入 ${updates.length} 位學生的快速加減分！`;

    if (res.undo_id) {
      showUndoToast(res.undo_id, msg);
    } else {
      showToast(msg);
    }

    // Refresh student scores from server & broadcast to big screen
    await loadScoringData();
    notifyScoreUpdates();
  } catch (err) {
    console.error('Failed to commit quick scores:', err);
    alert(`快速評分計入失敗：${err.message}`);
  } finally {
    if (btn) {
      btn.disabled = false;
    }
  }
}

function updateQuickScoringToggleUI() {
  const btn = document.getElementById('btn-toggle-quick-scoring');
  const icon = document.getElementById('quick-score-toggle-icon');
  const text = document.getElementById('quick-score-toggle-text');
  const hint = document.getElementById('scoring-mode-hint');
  if (!btn) return;

  const t = (key, p) => window.I18n ? window.I18n.t(key, p) : key;
  const isSeating = AppState.scoringViewMode === 'seating';

  if (AppState.quickScoringMode) {
    btn.classList.add('active');
    if (icon) icon.textContent = '⚡';

    const pendingMap = AppState.pendingQuickScores || {};
    const pendingCount = Object.values(pendingMap).filter(v => Number(v) !== 0).length;
    let label = t('quick_scoring_on');
    if (pendingCount > 0) {
      label += t('quick_scoring_pending_suffix', { count: pendingCount });
    }
    if (text) text.textContent = label;
    if (hint) hint.textContent = t('scoring_hint_quick');
  } else {
    btn.classList.remove('active');
    if (icon) icon.textContent = '⚡';
    if (text) text.textContent = t('quick_scoring_off');
    if (hint) hint.textContent = isSeating ? t('scoring_hint_seating_normal') : t('scoring_hint_normal');
  }

  // Synchronize quick group bar buttons disabled state
  const groupBar = document.getElementById('quick-group-bar');
  if (groupBar) {
    const isQuick = Boolean(AppState.quickScoringMode);
    const disabledHint = isQuick ? (t('quick_scoring_groups_disabled_hint') || '快速加減分模式下無法選擇小組') : '';
    const groupButtons = groupBar.querySelectorAll('button');
    groupButtons.forEach(b => {
      b.disabled = isQuick;
      if (isQuick) {
        b.setAttribute('title', disabledHint);
      } else {
        b.removeAttribute('title');
      }
    });
  }
}

function stageQuickScore(student, delta, cardElement) {
  if (!AppState.pendingQuickScores) {
    AppState.pendingQuickScores = {};
  }
  const current = Number(AppState.pendingQuickScores[student.id]) || 0;
  const next = current + delta;
  AppState.pendingQuickScores[student.id] = next;

  // Find badge in cardElement or document
  const badge = cardElement
    ? cardElement.querySelector(`#quick-pending-${student.id}`)
    : document.getElementById(`quick-pending-${student.id}`);

  if (badge) {
    if (next > 0) {
      badge.textContent = `+${next}`;
      badge.className = 'quick-score-pending-badge has-pending positive';
    } else if (next < 0) {
      badge.textContent = `${next}`;
      badge.className = 'quick-score-pending-badge has-pending negative';
    } else {
      badge.textContent = '';
      badge.className = 'quick-score-pending-badge';
    }

    badge.classList.remove('pop-animate');
    void badge.offsetWidth;
    badge.classList.add('pop-animate');
  }

  updateQuickScoringToggleUI();
}

// --- Scoring View Mode Controller (Grid vs Seating) ---
function initScoringViewToggle() {
  const btnGrid = document.getElementById('btn-scoring-view-grid');
  const btnSeating = document.getElementById('btn-scoring-view-seating');
  const btnConfig = document.getElementById('btn-jump-seating-config');

  if (btnGrid) {
    btnGrid.addEventListener('click', () => {
      setScoringViewMode('grid');
    });
  }
  if (btnSeating) {
    btnSeating.addEventListener('click', () => {
      setScoringViewMode('seating');
    });
  }
  if (btnConfig) {
    btnConfig.addEventListener('click', () => {
      switchTab('seating');
    });
  }
}

function setScoringViewMode(mode) {
  AppState.scoringViewMode = mode;
  localStorage.setItem('scoring_view_mode', mode);
  updateScoringViewModeUI();
  if (mode === 'seating' && (!AppState.seatingData || AppState.seatingData.course_id !== AppState.currentCourseId)) {
    loadScoringSeatingDataAndRender();
  } else {
    renderScoringView();
  }
}

async function loadScoringSeatingDataAndRender() {
  if (!AppState.currentCourseId) return;
  try {
    const data = await API.get(`/api/seating/${AppState.currentCourseId}`);
    AppState.seatingData = data;
    renderScoringView();
  } catch (err) {
    console.error('Failed to load seating chart for scoring:', err);
    renderScoringView();
  }
}

function updateScoringViewModeUI() {
  const isSeating = AppState.scoringViewMode === 'seating';
  const btnGrid = document.getElementById('btn-scoring-view-grid');
  const btnSeating = document.getElementById('btn-scoring-view-seating');
  const btnConfig = document.getElementById('btn-jump-seating-config');
  const gridEl = document.getElementById('scoring-student-grid');
  const seatingEl = document.getElementById('scoring-seating-container');
  const hint = document.getElementById('scoring-mode-hint');

  if (btnGrid) btnGrid.classList.toggle('active', !isSeating);
  if (btnSeating) btnSeating.classList.toggle('active', isSeating);
  if (btnConfig) btnConfig.style.display = isSeating ? 'inline-flex' : 'none';
  if (gridEl) gridEl.style.display = isSeating ? 'none' : 'grid';
  if (seatingEl) seatingEl.style.display = isSeating ? 'block' : 'none';

  if (hint) {
    const isQuick = AppState.quickScoringMode;
    const t = (k, p) => window.I18n ? window.I18n.t(k, p) : k;
    if (isSeating) {
      hint.textContent = isQuick ? t('scoring_hint_seating_quick') : t('scoring_hint_seating_normal');
    } else {
      hint.textContent = isQuick ? t('scoring_hint_quick') : t('scoring_hint_normal');
    }
  }
}

function renderScoringView() {
  updateScoringViewModeUI();
  if (AppState.scoringViewMode === 'seating') {
    renderScoringSeatingView();
  } else {
    renderScoringStudentGrid();
  }
}

function renderScoringStudentGrid() {
  if (AppState.scoringViewMode === 'seating') {
    return renderScoringSeatingView();
  }

  const container = document.getElementById('scoring-student-grid');
  container.innerHTML = '';
  updateQuickScoringToggleUI();

  const isEn = window.I18n && window.I18n.getLanguage() === 'en';
  const t = (k, p) => window.I18n ? window.I18n.t(k, p) : k;

  AppState.students.forEach(student => {
    const isSelected = AppState.selectedStudentIds.has(student.id);
    const isAbsent = student.is_absent;
    const attStatus = student.today_attendance || 'present';
    const attLabels = {
      present: t('att_present'),
      sick_leave: t('att_sick_leave'),
      personal_leave: t('att_personal_leave'),
      official_leave: t('att_official_leave'),
      bereavement_leave: t('att_bereavement_leave'),
      late: t('att_late')
    };

    const displayName = getStudentDisplayName(student);
    const numText = isEn ? `No. ${student.student_number}` : `${student.student_number} 號`;
    const scoreUnit = t('pts');

    // Flash the card/badge when this student's score changed since the last render
    // (covers both this device's own scoring and pushes from other devices).
    const prevScore = prevStudentScoresMap[student.id];
    let cardFlashClass = '';
    let scoreAnimClass = '';
    if (prevScore !== undefined && prevScore !== null && prevScore !== student.score) {
      cardFlashClass = student.score > prevScore ? 'card-flash-up' : 'card-flash-down';
      scoreAnimClass = student.score > prevScore ? 'score-animate-up' : 'score-animate-down';
    }

    const card = document.createElement('div');
    card.className = `student-card ${isSelected ? 'selected' : ''} ${isAbsent ? 'absent' : ''} ${isAbsent ? `att-${attStatus}` : ''} ${cardFlashClass}`;
    card.dataset.studentId = student.id;
    if (isAbsent) {
      card.setAttribute('data-att-label', attLabels[attStatus] || '未出席');
    }

    const grpScore = (student.group_id && AppState.groupScoresMap && AppState.groupScoresMap[student.group_id] !== undefined)
      ? AppState.groupScoresMap[student.group_id]
      : ((student.group_name && AppState.groupScoresMap && AppState.groupScoresMap[student.group_name] !== undefined)
          ? AppState.groupScoresMap[student.group_name]
          : 0);

    const groupTagHtml = student.group_name
      ? `<div class="student-card-group-tag" style="font-size: 0.72rem; color: #60a5fa; font-weight: 700; background: rgba(123, 152, 224, 0.12); border: 1px solid rgba(123, 152, 224, 0.25); padding: 1px 7px; border-radius: 4px; display: inline-flex; align-items: center; gap: 4px; max-width: 92%; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; margin-bottom: 3px;"><span>🏷️ ${student.group_name}</span> <span style="color: #d3a24c; font-weight: 800;">${grpScore} ${scoreUnit}</span></div>`
      : '';

    if (AppState.quickScoringMode) {
      const pendingVal = (AppState.pendingQuickScores && Number(AppState.pendingQuickScores[student.id])) || 0;
      card.className = `student-card quick-mode-card ${isAbsent ? 'absent' : ''} ${isAbsent ? `att-${attStatus}` : ''}`;
      card.innerHTML = `
        <div class="quick-score-pending-badge ${pendingVal !== 0 ? 'has-pending' : ''} ${pendingVal > 0 ? 'positive' : (pendingVal < 0 ? 'negative' : '')}" id="quick-pending-${student.id}">
          ${pendingVal > 0 ? `+${pendingVal}` : (pendingVal < 0 ? `${pendingVal}` : '')}
        </div>
        <div class="student-avatar gender-${student.gender}" style="overflow: hidden; padding: 0;">
          ${getStudentAvatarImgHtml(student)}
        </div>
        <div class="student-number">${numText}</div>
        <div class="student-name" title="${displayName}">${displayName}</div>
        <div class="quick-card-actions">
          <button class="btn-quick-staged minus" title="${t('btn_minus_score')}" data-student-id="${student.id}" type="button">
            <svg width="22" height="22" viewBox="0 0 22 22" fill="none">
              <rect x="3" y="9" width="16" height="4" rx="2" fill="#887bc4" />
            </svg>
          </button>
          <button class="btn-quick-staged plus" title="${t('btn_plus_score')}" data-student-id="${student.id}" type="button">
            <svg width="22" height="22" viewBox="0 0 22 22" fill="none">
              <rect x="3" y="9" width="16" height="4" rx="2" fill="#887bc4" />
              <rect x="9" y="3" width="4" height="16" rx="2" fill="#887bc4" />
            </svg>
          </button>
        </div>
      `;

      const btnMinus = card.querySelector('.btn-quick-staged.minus');
      if (btnMinus) {
        btnMinus.addEventListener('click', (e) => {
          e.stopPropagation();
          stageQuickScore(student, -1, card);
        });
      }

      const btnPlus = card.querySelector('.btn-quick-staged.plus');
      if (btnPlus) {
        btnPlus.addEventListener('click', (e) => {
          e.stopPropagation();
          stageQuickScore(student, 1, card);
        });
      }
    } else {
      // Normal Selection & Popover Mode Layout
      card.innerHTML = `
        <div class="student-avatar gender-${student.gender}" style="overflow: hidden; padding: 0;">
          ${getStudentAvatarImgHtml(student)}
        </div>
        <div class="student-number">${numText}</div>
        <div class="student-name" title="${displayName}">${displayName}</div>
        ${groupTagHtml}
        <div class="student-score-badge ${scoreAnimClass}" id="score-badge-${student.id}">⭐ ${student.score} ${scoreUnit}</div>
      `;
      attachCardNoteButton(card, student);
    }

    card.addEventListener('click', async (e) => {
      if (AppState.quickScoringMode) {
        // Do not trigger student selection or popup drawers in quick scoring mode
        return;
      }
      lastClickCoords = { x: e.clientX, y: e.clientY };
      AppState.currentScoringGroupTarget = null;
      if (isAbsent) {
        const leaveLabel = attLabels[attStatus] || '缺席/請假';
        if (!await showConfirmModal({
          icon: '⚠️',
          title: '出缺席狀態提醒',
          desc: `學生【${displayName}】今日登記為【${leaveLabel}】，確定仍要選取評分嗎？`,
          confirmText: '確定選取',
          cancelText: '取消'
        })) {
          return;
        }
      }
      if (AppState.selectedStudentIds.has(student.id)) {
        AppState.selectedStudentIds.delete(student.id);
      } else {
        AppState.selectedStudentIds.add(student.id);
      }
      renderScoringView();
    });

    container.appendChild(card);
  });

  AppState.students.forEach(s => { prevStudentScoresMap[s.id] = s.score; });
  updateFloatingScoringDrawer();
}

function renderScoringSeatingView() {
  const container = document.getElementById('scoring-seating-grid');
  if (!container) return;

  if (!AppState.seatingData) {
    container.innerHTML = `<div style="text-align: center; padding: 30px; color: var(--text-muted); grid-column: 1/-1;">載入座位表中...</div>`;
    return;
  }

  const data = AppState.seatingData;
  container.style.gridTemplateColumns = `repeat(${data.seat_cols}, minmax(110px, 1fr))`;
  container.innerHTML = '';
  updateQuickScoringToggleUI();

  const isEn = window.I18n && window.I18n.getLanguage() === 'en';
  const t = (k, p) => window.I18n ? window.I18n.t(k, p) : k;
  const scoreUnit = t('pts');

  const bbPos = data.blackboard_position || 'top';
  ['top', 'bottom', 'left', 'right'].forEach(p => {
    const el = document.getElementById(`scoring-podium-banner-${p}`);
    if (el) el.style.display = (p === bbPos) ? 'block' : 'none';
  });

  const attLabels = {
    present: t('att_present'),
    sick_leave: t('att_sick_leave'),
    personal_leave: t('att_personal_leave'),
    official_leave: t('att_official_leave'),
    bereavement_leave: t('att_bereavement_leave'),
    late: t('att_late')
  };

  const liveStudentMap = new Map();
  AppState.students.forEach(s => liveStudentMap.set(s.id, s));
  const seatedStudentIds = new Set();

  (data.grid || []).forEach(rowCells => {
    rowCells.forEach(cell => {
      const cellStudent = cell.student;
      const seatEl = document.createElement('div');
      seatEl.dataset.row = cell.row;
      seatEl.dataset.col = cell.col;

      if (cellStudent) {
        const student = liveStudentMap.get(cellStudent.id) || cellStudent;
        seatedStudentIds.add(student.id);

        const isSelected = AppState.selectedStudentIds.has(student.id);
        const isAbsent = student.is_absent;
        const attStatus = student.today_attendance || 'present';

        const prevScore = prevStudentScoresMap[student.id];
        let cardFlashClass = '';
        let scoreAnimClass = '';
        if (prevScore !== undefined && prevScore !== null && prevScore !== student.score) {
          cardFlashClass = student.score > prevScore ? 'card-flash-up' : 'card-flash-down';
          scoreAnimClass = student.score > prevScore ? 'score-animate-up' : 'score-animate-down';
        }

        seatEl.className = `seat-cell scoring-seat-cell occupied ${isSelected ? 'selected' : ''} ${isAbsent ? 'absent' : ''} ${isAbsent ? `att-${attStatus}` : ''} ${cardFlashClass}`;
        if (isAbsent) {
          seatEl.setAttribute('data-att-label', attLabels[attStatus] || '未出席');
        }
        seatEl.dataset.studentId = student.id;

        const displayName = getStudentDisplayName(student);
        const numText = isEn ? `No. ${student.student_number}` : `${student.student_number}號`;

        const grpScore = (student.group_id && AppState.groupScoresMap && AppState.groupScoresMap[student.group_id] !== undefined)
          ? AppState.groupScoresMap[student.group_id]
          : ((student.group_name && AppState.groupScoresMap && AppState.groupScoresMap[student.group_name] !== undefined)
              ? AppState.groupScoresMap[student.group_name]
              : 0);

        const groupTagHtml = student.group_name
          ? `<div class="student-card-group-tag" style="font-size: 0.65rem; color: #60a5fa; font-weight: 700; background: rgba(123, 152, 224, 0.12); border: 1px solid rgba(123, 152, 224, 0.25); padding: 1px 5px; border-radius: 4px; display: inline-flex; align-items: center; gap: 2px; max-width: 95%; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; margin-bottom: 2px;"><span>🏷️ ${student.group_name}</span></div>`
          : '';

        if (AppState.quickScoringMode) {
          const pendingVal = (AppState.pendingQuickScores && Number(AppState.pendingQuickScores[student.id])) || 0;
          seatEl.className = `seat-cell scoring-seat-cell occupied quick-mode-cell ${isAbsent ? 'absent' : ''} ${isAbsent ? `att-${attStatus}` : ''} ${cardFlashClass}`;
          seatEl.innerHTML = `
            <div class="quick-score-pending-badge ${pendingVal !== 0 ? 'has-pending' : ''} ${pendingVal > 0 ? 'positive' : (pendingVal < 0 ? 'negative' : '')}" id="quick-pending-${student.id}">
              ${pendingVal > 0 ? `+${pendingVal}` : (pendingVal < 0 ? `${pendingVal}` : '')}
            </div>
            <div class="seat-coord-badge">(${cell.row},${cell.col})</div>
            <div style="margin-top: 2px; display: flex; justify-content: center;">
              <div class="student-avatar gender-${student.gender}" style="width: 38px; height: 38px; margin-bottom: 2px; overflow: hidden; padding: 0;">
                ${getStudentAvatarImgHtml(student)}
              </div>
            </div>
            <div class="student-number" style="font-size: 0.74rem; font-weight: 700; padding: 1px 6px;">${numText}</div>
            <div class="student-name" style="font-size: 0.86rem; font-weight: 800; margin: 2px 0 6px 0; max-width: 96%; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;" title="${displayName}">${displayName}</div>
            <div class="quick-card-actions" style="gap: 4px;">
              <button class="btn-quick-staged minus" style="height: 38px; border-radius: 10px;" title="${t('btn_minus_score')}" data-student-id="${student.id}" type="button">
                <svg width="18" height="18" viewBox="0 0 22 22" fill="none">
                  <rect x="3" y="9" width="16" height="4" rx="2" fill="#887bc4" />
                </svg>
              </button>
              <button class="btn-quick-staged plus" style="height: 38px; border-radius: 10px;" title="${t('btn_plus_score')}" data-student-id="${student.id}" type="button">
                <svg width="18" height="18" viewBox="0 0 22 22" fill="none">
                  <rect x="3" y="9" width="16" height="4" rx="2" fill="#887bc4" />
                  <rect x="9" y="3" width="4" height="16" rx="2" fill="#887bc4" />
                </svg>
              </button>
            </div>
          `;

          const btnMinus = seatEl.querySelector('.btn-quick-staged.minus');
          if (btnMinus) {
            btnMinus.addEventListener('click', (e) => {
              e.stopPropagation();
              stageQuickScore(student, -1, seatEl);
            });
          }

          const btnPlus = seatEl.querySelector('.btn-quick-staged.plus');
          if (btnPlus) {
            btnPlus.addEventListener('click', (e) => {
              e.stopPropagation();
              stageQuickScore(student, 1, seatEl);
            });
          }
        } else {
          seatEl.innerHTML = `
            <div class="seat-coord-badge">(${cell.row},${cell.col})</div>
            <div style="margin-top: 2px; display: flex; justify-content: center;">
              <div class="student-avatar gender-${student.gender}" style="width: 40px; height: 40px; margin-bottom: 2px; overflow: hidden; padding: 0;">
                ${getStudentAvatarImgHtml(student)}
              </div>
            </div>
            <div style="font-size: 0.78rem; color: var(--text-muted); font-weight: 800;">${numText}</div>
            <div style="font-size: 0.88rem; font-weight: 800; max-width: 96%; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;" title="${displayName}">${displayName}</div>
            ${groupTagHtml}
            <div class="student-score-badge ${scoreAnimClass}" id="score-badge-${student.id}" style="margin-top: 3px;">⭐ ${student.score || 0} ${scoreUnit}</div>
          `;
          attachCardNoteButton(seatEl, student);
        }

        seatEl.addEventListener('click', async (e) => {
          if (AppState.quickScoringMode) {
            // Do not trigger student selection or popup drawers in quick scoring mode
            return;
          }
          lastClickCoords = { x: e.clientX, y: e.clientY };
          AppState.currentScoringGroupTarget = null;
          if (isAbsent) {
            const leaveLabel = attLabels[attStatus] || '缺席/請假';
            if (!await showConfirmModal({
              icon: '⚠️',
              title: '出缺席狀態提醒',
              desc: `學生【${displayName}】今日登記為【${leaveLabel}】，確定仍要選取評分嗎？`,
              confirmText: '確定選取',
              cancelText: '取消'
            })) {
              return;
            }
          }
          if (AppState.selectedStudentIds.has(student.id)) {
            AppState.selectedStudentIds.delete(student.id);
          } else {
            AppState.selectedStudentIds.add(student.id);
          }
          renderScoringView();
        });

      } else {
        // Empty seat
        seatEl.className = 'seat-cell scoring-seat-empty empty';
        seatEl.innerHTML = `
          <div class="seat-coord-badge">(${cell.row},${cell.col})</div>
          <div style="font-size: 0.78rem; margin-top: 14px; color: var(--text-subtle);">${t('seating_empty_slot')}</div>
        `;
      }

      container.appendChild(seatEl);
    });
  });

  // Render unassigned students
  renderScoringUnassignedStudents(seatedStudentIds);

  AppState.students.forEach(s => { prevStudentScoresMap[s.id] = s.score; });
  updateFloatingScoringDrawer();
}

function renderScoringUnassignedStudents(seatedStudentIds) {
  const section = document.getElementById('scoring-seating-unassigned-section');
  const grid = document.getElementById('scoring-seating-unassigned-grid');
  if (!section || !grid) return;

  const unassignedStudents = AppState.students.filter(s => !seatedStudentIds.has(s.id));

  if (unassignedStudents.length === 0) {
    section.style.display = 'none';
    grid.innerHTML = '';
    return;
  }

  section.style.display = 'block';
  grid.innerHTML = '';

  const isEn = window.I18n && window.I18n.getLanguage() === 'en';
  const t = (k, p) => window.I18n ? window.I18n.t(k, p) : k;
  const scoreUnit = t('pts');

  const attLabels = {
    present: t('att_present'),
    sick_leave: t('att_sick_leave'),
    personal_leave: t('att_personal_leave'),
    official_leave: t('att_official_leave'),
    bereavement_leave: t('att_bereavement_leave'),
    late: t('att_late')
  };

  unassignedStudents.forEach(student => {
    const isSelected = AppState.selectedStudentIds.has(student.id);
    const isAbsent = student.is_absent;
    const attStatus = student.today_attendance || 'present';
    const displayName = getStudentDisplayName(student);
    const numText = isEn ? `No. ${student.student_number}` : `${student.student_number} 號`;

    const prevScore = prevStudentScoresMap[student.id];
    let cardFlashClass = '';
    let scoreAnimClass = '';
    if (prevScore !== undefined && prevScore !== null && prevScore !== student.score) {
      cardFlashClass = student.score > prevScore ? 'card-flash-up' : 'card-flash-down';
      scoreAnimClass = student.score > prevScore ? 'score-animate-up' : 'score-animate-down';
    }

    const card = document.createElement('div');
    card.className = `student-card ${isSelected ? 'selected' : ''} ${isAbsent ? 'absent' : ''} ${isAbsent ? `att-${attStatus}` : ''} ${cardFlashClass}`;
    if (isAbsent) card.setAttribute('data-att-label', attLabels[attStatus] || '未出席');

    if (AppState.quickScoringMode) {
      const pendingVal = (AppState.pendingQuickScores && Number(AppState.pendingQuickScores[student.id])) || 0;
      card.className = `student-card quick-mode-card ${isAbsent ? 'absent' : ''} ${isAbsent ? `att-${attStatus}` : ''} ${cardFlashClass}`;
      card.innerHTML = `
        <div class="quick-score-pending-badge ${pendingVal !== 0 ? 'has-pending' : ''} ${pendingVal > 0 ? 'positive' : (pendingVal < 0 ? 'negative' : '')}" id="quick-pending-${student.id}">
          ${pendingVal > 0 ? `+${pendingVal}` : (pendingVal < 0 ? `${pendingVal}` : '')}
        </div>
        <div class="student-avatar gender-${student.gender}" style="overflow: hidden; padding: 0;">
          ${getStudentAvatarImgHtml(student)}
        </div>
        <div class="student-number">${numText}</div>
        <div class="student-name" title="${displayName}">${displayName}</div>
        <div class="quick-card-actions">
          <button class="btn-quick-staged minus" title="${t('btn_minus_score')}" data-student-id="${student.id}" type="button">
            <svg width="22" height="22" viewBox="0 0 22 22" fill="none">
              <rect x="3" y="9" width="16" height="4" rx="2" fill="#887bc4" />
            </svg>
          </button>
          <button class="btn-quick-staged plus" title="${t('btn_plus_score')}" data-student-id="${student.id}" type="button">
            <svg width="22" height="22" viewBox="0 0 22 22" fill="none">
              <rect x="3" y="9" width="16" height="4" rx="2" fill="#887bc4" />
              <rect x="9" y="3" width="4" height="16" rx="2" fill="#887bc4" />
            </svg>
          </button>
        </div>
      `;
      const btnMinus = card.querySelector('.btn-quick-staged.minus');
      if (btnMinus) {
        btnMinus.addEventListener('click', (e) => {
          e.stopPropagation();
          stageQuickScore(student, -1, card);
        });
      }
      const btnPlus = card.querySelector('.btn-quick-staged.plus');
      if (btnPlus) {
        btnPlus.addEventListener('click', (e) => {
          e.stopPropagation();
          stageQuickScore(student, 1, card);
        });
      }
    } else {
      card.innerHTML = `
        <div class="student-avatar gender-${student.gender}" style="overflow: hidden; padding: 0;">
          ${getStudentAvatarImgHtml(student)}
        </div>
        <div class="student-number">${numText}</div>
        <div class="student-name" title="${displayName}">${displayName}</div>
        <div class="student-score-badge ${scoreAnimClass}" id="score-badge-${student.id}">⭐ ${student.score || 0} ${scoreUnit}</div>
      `;
      attachCardNoteButton(card, student);
    }

    card.addEventListener('click', async (e) => {
      if (AppState.quickScoringMode) {
        return;
      }
      lastClickCoords = { x: e.clientX, y: e.clientY };
      AppState.currentScoringGroupTarget = null;
      if (isAbsent) {
        const leaveLabel = attLabels[attStatus] || '缺席/請假';
        if (!await showConfirmModal({
          icon: '⚠️',
          title: '出缺席狀態提醒',
          desc: `學生【${displayName}】今日登記為【${leaveLabel}】，確定仍要選取評分嗎？`,
          confirmText: '確定選取',
          cancelText: '取消'
        })) {
          return;
        }
      }
      if (AppState.selectedStudentIds.has(student.id)) {
        AppState.selectedStudentIds.delete(student.id);
      } else {
        AppState.selectedStudentIds.add(student.id);
      }
      renderScoringView();
    });

    grid.appendChild(card);
  });
}

function updateFloatingScoringDrawer() {
  const drawer = document.getElementById('floating-scoring-bar');
  const label = document.getElementById('selected-students-label');
  if (!drawer || !label) return;

  if (AppState.quickScoringMode) {
    drawer.classList.remove('visible');
    return;
  }

  const count = AppState.selectedStudentIds.size;
  const isEn = window.I18n && window.I18n.getLanguage() === 'en';
  const t = (k, p) => window.I18n ? window.I18n.t(k, p) : k;

  if (count > 0) {
    if (count === 1) {
      const selectedId = Array.from(AppState.selectedStudentIds)[0];
      const student = AppState.students.find(s => s.id === selectedId);
      const numPrefix = isEn ? `No. ${student.student_number}` : `${student.student_number}號`;
      const studentName = student ? `${numPrefix} ${getStudentDisplayName(student)}` : '';
      const logsBtnText = t('btn_view_logs');
      const selectedText = t('selected_single_student', { name: studentName });
      label.innerHTML = `${selectedText} <button id="btn-popover-score-logs" class="btn btn-secondary" style="font-size: 0.75rem; padding: 2px 8px; margin-left: 8px; border-radius: 9999px;" title="${logsBtnText}">${logsBtnText}</button>`;
      const btnLogs = document.getElementById('btn-popover-score-logs');
      if (btnLogs) {
        btnLogs.onclick = (e) => {
          e.stopPropagation();
          openStudentScoreLogsModal(selectedId);
        };
      }
    } else {
      label.textContent = t('selected_students_count', { count });
    }

    drawer.classList.add('visible');

    // Position Popover dynamically near cursor while preventing viewport overflow
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const popWidth = drawer.offsetWidth || 360;
    const popHeight = drawer.offsetHeight || 200;

    let left = lastClickCoords.x + 12;
    let top = lastClickCoords.y + 12;

    // Boundary clamping: if overflowing right edge, flip left of cursor
    if (left + popWidth > vw - 12) {
      left = lastClickCoords.x - popWidth - 12;
    }
    if (left < 12) {
      left = 12;
    }

    // Boundary clamping: if overflowing bottom edge, flip above cursor
    if (top + popHeight > vh - 12) {
      top = lastClickCoords.y - popHeight - 12;
    }
    if (top < 12) {
      top = 12;
    }

    drawer.style.left = `${left}px`;
    drawer.style.top = `${top}px`;
  } else {
    drawer.classList.remove('visible');
  }
}

async function applyScoreRule(rule) {
  if (AppState.selectedStudentIds.size === 0) {
    alert(window.I18n && window.I18n.getLanguage() === 'en' ? 'Please select at least one student!' : '請先點選至少一位學生！');
    return;
  }

  const studentIds = Array.from(AppState.selectedStudentIds);
  const displayRuleTitle = window.I18n ? window.I18n.getRuleDisplayTitle(rule.title) : rule.title;
  try {
    const payload = {
      student_ids: studentIds,
      rule_id: rule.id,
      rule_title: rule.title,
      score: rule.score_value,
      category: rule.category
    };
    if (AppState.currentScoringGroupTarget) {
      payload.plan_id = AppState.currentScoringGroupTarget.plan_id;
      payload.group_id = AppState.currentScoringGroupTarget.group_id;
    }
    const res = await API.post(`/api/scores/${AppState.currentCourseId}/add`, payload);
    AppState.currentScoringGroupTarget = null;

    // Trigger Toast Undo
    const toastMsg = studentIds.length === 1 && AppState.students.find(s => s.id === studentIds[0])
      ? (window.I18n ? window.I18n.t('undo_toast_single', {
          name: getStudentDisplayName(AppState.students.find(s => s.id === studentIds[0])),
          icon: rule.icon,
          rule: displayRuleTitle,
          score: rule.score_value > 0 ? `+${rule.score_value}` : rule.score_value
        }) : `已為【${getStudentDisplayName(AppState.students.find(s => s.id === studentIds[0]))}】套用【${rule.icon} ${displayRuleTitle} ${rule.score_value > 0 ? '+' : ''}${rule.score_value}分】`)
      : (window.I18n ? window.I18n.t('undo_toast', {
          count: studentIds.length,
          icon: rule.icon,
          rule: displayRuleTitle,
          score: rule.score_value > 0 ? `+${rule.score_value}` : rule.score_value
        }) : `已為 ${studentIds.length} 位學生套用【${rule.icon} ${displayRuleTitle} ${rule.score_value > 0 ? '+' : ''}${rule.score_value}分】`);

    showUndoToast(res.undo_id, toastMsg);

    // Auto clear selection & hide floating drawer
    AppState.selectedStudentIds.clear();

    // Refresh scoring data & immediately update Dashboard / Big Screen
    loadScoringData();
    notifyScoreUpdates();
  } catch (err) {
    alert(`評分失敗：${err.message}`);
  }
}

// --- Toast Undo Notification (2.5-Second Countdown) ---
function showUndoToast(undoId, message) {
  const container = document.getElementById('toast-container');
  const toast = document.createElement('div');
  toast.className = 'toast-undo';

  const t = (k) => window.I18n ? window.I18n.t(k) : k;

  toast.innerHTML = `
    <div style="flex: 1;">
      <div style="font-weight: 700; font-size: 0.95rem;">${message}</div>
      <div style="font-size: 0.75rem; color: #94a3b8;">${t('undo_hint')}</div>
    </div>
    <button class="btn-undo">${t('undo_btn')}</button>
  `;

  const btnUndo = toast.querySelector('.btn-undo');
  
  let timerId = setTimeout(() => {
    toast.remove();
  }, 2500);

  btnUndo.addEventListener('click', async () => {
    clearTimeout(timerId);
    try {
      await API.post('/api/scores/undo', { undo_id: undoId });
      toast.remove();
      loadScoringData();
      notifyScoreUpdates();
      if (getActiveTabName() === 'attendance') loadAttendanceData();
    } catch (err) {
      alert(`復原失敗：${err.message}`);
    }
  });

  container.appendChild(toast);
}

// --- Universal Toast Notification Helper ---
function showToast(message, type = 'info') {
  let container = document.getElementById('toast-container');
  if (!container) {
    container = document.createElement('div');
    container.id = 'toast-container';
    container.className = 'toast-container';
    document.body.appendChild(container);
  }
  const toast = document.createElement('div');
  toast.className = `toast-undo toast-${type}`;
  toast.style.cssText = 'background: rgba(15, 23, 42, 0.95); border: 1.5px solid rgba(123, 152, 224, 0.4); color: #fff; padding: 12px 20px; border-radius: 12px; font-weight: 700; font-size: 0.95rem; box-shadow: 0 10px 30px rgba(0,0,0,0.5); backdrop-filter: blur(12px); display: flex; align-items: center; gap: 10px; animation: slideInUp 0.25s ease;';
  
  if (type === 'positive' || type === 'success') {
    toast.style.borderColor = 'rgba(79, 174, 130, 0.6)';
    toast.style.boxShadow = '0 10px 30px rgba(79, 174, 130, 0.25)';
  } else if (type === 'error') {
    toast.style.borderColor = 'rgba(217, 128, 126, 0.6)';
    toast.style.boxShadow = '0 10px 30px rgba(217, 128, 126, 0.25)';
  }

  toast.innerHTML = `<div>${message}</div>`;
  container.appendChild(toast);

  setTimeout(() => {
    toast.style.opacity = '0';
    toast.style.transition = 'opacity 0.3s ease';
    setTimeout(() => toast.remove(), 300);
  }, 2500);
}
window.showToast = showToast;

// --- Shared guard for feature entry points that require an existing class ---
// Passive background data-loaders (loadScoringData, loadAttendanceData, ...) already
// render an inline "no class yet" card via renderEmptyCourseNotice()/renderActiveTabEmptyNotice()
// and should keep silently no-op'ing — this helper is only for direct user-triggered actions
// (button clicks, opening a creation modal, etc.) that would otherwise fail invisibly.
function ensureCourseSelected() {
  if (AppState.currentCourseId && AppState.courses && AppState.courses.length > 0) return true;
  const isEn = window.I18n && window.I18n.getLanguage() === 'en';
  showToast(isEn ? 'Please create a class first!' : '請先建立班級課程！', 'error');
  openModal('modal-add-course');
  return false;
}
window.ensureCourseSelected = ensureCourseSelected;
