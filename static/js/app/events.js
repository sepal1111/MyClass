// MyClass 教師端：頁面元素的事件綁定（initEventListeners）
// 由 static/js/app.js 拆出（2026-10-31，原第 6668–7511 行），程式內容未變更。
// 所有 static/js/app.js 與 static/js/app/*.js 共用同一個全域範圍（一般 <script>，不是模組），載入順序見 static/index.html。


// --- Global Event Listeners ---
function initEventListeners() {
  // Course change dropdown
  document.getElementById('course-select').addEventListener('change', async (e) => {
    if (window.TeachingToolkit?.bulletin && typeof window.TeachingToolkit.bulletin.flushActivePost === 'function') {
      window.TeachingToolkit.bulletin.flushActivePost();
    }
    if (AppState.quickScoringMode && AppState.pendingQuickScores) {
      const hasPending = Object.values(AppState.pendingQuickScores).some(s => Number(s) !== 0);
      if (hasPending) {
        await commitPendingQuickScores();
      }
    }
    AppState.currentCourseId = parseInt(e.target.value);
    AppState.selectedStudentIds.clear();
    syncAppRealtimeConnection();
    refreshActiveTab(getActiveTabName());
    if (window.PointCardsManager && typeof window.PointCardsManager.reload === 'function') {
      window.PointCardsManager.reload();
    }
  });

  // Header & Mode buttons
  document.getElementById('btn-add-course').addEventListener('click', () => openModal('modal-add-course'));
  document.getElementById('btn-delete-course')?.addEventListener('click', startDeleteCourseFlow);
  document.getElementById('btn-pane-delete-course')?.addEventListener('click', startDeleteCourseFlow);
  document.getElementById('btn-qr-modal')?.addEventListener('click', showQRModal);
  document.getElementById('btn-admin-show-mobile-scoring-qr')?.addEventListener('click', showQRModal);
  document.getElementById('btn-security-show-mobile-scoring-qr')?.addEventListener('click', showQRModal);
  document.querySelectorAll('.btn-show-mobile-qr-action').forEach((btn) => {
    btn.addEventListener('click', showQRModal);
  });

  const btnToggleLang = document.getElementById('btn-toggle-lang');
  if (btnToggleLang) {
    btnToggleLang.addEventListener('click', () => {
      if (window.I18n) window.I18n.toggleLanguage();
    });
  }

  const btnAuthToggleLang = document.getElementById('btn-auth-toggle-lang');
  if (btnAuthToggleLang) {
    btnAuthToggleLang.addEventListener('click', () => {
      if (window.I18n) window.I18n.toggleLanguage();
    });
  }

  const btnToggleNameMode = document.getElementById('btn-toggle-name-mode');
  if (btnToggleNameMode) {
    btnToggleNameMode.addEventListener('click', () => {
      if (window.I18n) window.I18n.toggleNameDisplayMode();
    });
  }
  
  const btnToggleQuick = document.getElementById('btn-toggle-quick-scoring');
  if (btnToggleQuick) {
    btnToggleQuick.addEventListener('click', toggleQuickScoringMode);
    updateQuickScoringToggleUI();
  }

  const btnImportModal = document.getElementById('btn-open-import-modal');
  if (btnImportModal) {
    btnImportModal.addEventListener('click', () => { if (ensureCourseSelected()) openModal('modal-import-students'); });
  }

  // Import Modal Tabs
  const tabFileBtn = document.getElementById('tab-import-file-btn');
  const tabTextBtn = document.getElementById('tab-import-text-btn');
  const modeFile = document.getElementById('import-mode-file');
  const modeText = document.getElementById('import-mode-text');

  if (tabFileBtn && tabTextBtn) {
    tabFileBtn.addEventListener('click', () => {
      tabFileBtn.classList.add('active');
      tabTextBtn.classList.remove('active');
      modeFile.style.display = 'flex';
      modeText.style.display = 'none';
    });

    tabTextBtn.addEventListener('click', () => {
      tabTextBtn.classList.add('active');
      tabFileBtn.classList.remove('active');
      modeText.style.display = 'flex';
      modeFile.style.display = 'none';
    });
  }

  // Modal Upload File
  document.getElementById('btn-modal-upload-file').addEventListener('click', async () => {
    const fileInput = document.getElementById('modal-file-input');
    if (!fileInput.files || fileInput.files.length === 0) {
      alert('請先選擇要匯入的 Excel 或 CSV 檔案！');
      return;
    }
    try {
      const res = await API.uploadFile(`/api/courses/${AppState.currentCourseId}/students/upload`, fileInput.files[0]);
      alert(`匯入成功！已新增 ${res.imported_count} 位學生`);
      resetCustomFileInput(fileInput);
      document.querySelectorAll('.modal-overlay').forEach(m => m.classList.remove('open'));
      await loadCourses();
    } catch (err) {
      alert(`匯入檔案失敗：${err.message}`);
    }
  });

  // Modal Submit Text Paste
  document.getElementById('btn-modal-submit-text').addEventListener('click', async () => {
    const textVal = document.getElementById('modal-text-input').value.trim();
    if (!textVal) {
      alert('請輸入或貼上學生名單！');
      return;
    }
    try {
      const res = await API.post(`/api/courses/${AppState.currentCourseId}/students/text_import`, { text_content: textVal });
      alert(`匯入成功！已新增 ${res.imported_count} 位學生`);
      document.getElementById('modal-text-input').value = '';
      document.querySelectorAll('.modal-overlay').forEach(m => m.classList.remove('open'));
      await loadCourses();
    } catch (err) {
      alert(`匯入學生失敗：${err.message}`);
    }
  });

  // Modal Confirm: Add Course
  document.getElementById('btn-confirm-add-course').addEventListener('click', async () => {
    const name = document.getElementById('new-course-name').value.trim();
    const type = document.getElementById('new-course-type').value;
    if (!name) {
      alert('請輸入課程名稱！');
      return;
    }
    try {
      const res = await API.post('/api/courses', { name: name, teacher_type: type });
      AppState.currentCourseId = res.id;
      document.getElementById('new-course-name').value = '';
      document.querySelectorAll('.modal-overlay').forEach(m => m.classList.remove('open'));
      await loadCourses();
      openModal('modal-import-students');
    } catch (err) {
      alert(`新增課程失敗：${err.message}`);
    }
  });

  // --- Delete Course Double Confirmation Flow ---
  function startDeleteCourseFlow() {
    const currentCourse = (AppState.courses || []).find(c => c.id === AppState.currentCourseId);
    if (!currentCourse) {
      alert(window.I18n ? window.I18n.t('delete_course_no_selection') : '目前沒有選中的班級可刪除！');
      return;
    }
    const targetNameEl = document.getElementById('delete-course-target-name');
    if (targetNameEl) {
      const icon = currentCourse.teacher_type === 'homeroom' ? '🏫' : '🎨';
      const count = currentCourse.student_count || 0;
      targetNameEl.textContent = `${icon} ${currentCourse.name} (${count} 人 / students)`;
    }
    openModal('modal-delete-course-step1');
  }

  document.getElementById('btn-delete-course-next')?.addEventListener('click', () => {
    closeModal('modal-delete-course-step1');
    const pwdInput = document.getElementById('delete-course-password-input');
    const errEl = document.getElementById('delete-course-error-msg');
    if (pwdInput) pwdInput.value = '';
    if (errEl) {
      errEl.style.display = 'none';
      errEl.textContent = '';
    }
    openModal('modal-delete-course-step2');
    setTimeout(() => {
      if (pwdInput) pwdInput.focus();
    }, 120);
  });

  async function executeDeleteCourse() {
    const pwdInput = document.getElementById('delete-course-password-input');
    const errEl = document.getElementById('delete-course-error-msg');
    const password = pwdInput ? pwdInput.value.trim() : '';

    if (!password) {
      if (errEl) {
        errEl.textContent = window.I18n ? window.I18n.t('delete_course_pwd_required') : '請輸入系統管理密碼！';
        errEl.style.display = 'block';
      }
      if (pwdInput) pwdInput.focus();
      return;
    }

    const btn = document.getElementById('btn-confirm-delete-course');
    const originalText = btn ? btn.innerHTML : '';
    if (btn) {
      btn.disabled = true;
      btn.textContent = window.I18n ? window.I18n.t('delete_course_deleting') : '正在刪除...';
    }

    try {
      const res = await API.delete(`/api/courses/${AppState.currentCourseId}`, { password });
      closeModal('modal-delete-course-step2');
      const succMsg = res?.message || (window.I18n ? window.I18n.t('delete_course_success') : '班級已成功刪除！');
      alert(succMsg);
      AppState.currentCourseId = null;
      await loadCourses();
    } catch (err) {
      if (errEl) {
        errEl.textContent = err.message || '刪除失敗';
        errEl.style.display = 'block';
      }
      if (pwdInput) pwdInput.focus();
    } finally {
      if (btn) {
        btn.disabled = false;
        btn.innerHTML = originalText;
      }
    }
  }

  document.getElementById('btn-confirm-delete-course')?.addEventListener('click', executeDeleteCourse);
  document.getElementById('delete-course-password-input')?.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      executeDeleteCourse();
    }
  });

  // Scoring tab selection helpers
  document.getElementById('btn-select-all').addEventListener('click', () => {
    selectStudentsSkippingAbsent(AppState.students.map(s => s.id));
  });

  document.getElementById('btn-clear-select').addEventListener('click', () => {
    AppState.selectedStudentIds.clear();
    renderScoringStudentGrid();
  });

  // Attendance tab buttons
  document.getElementById('btn-save-attendance').addEventListener('click', saveAttendance);
  const btnAllPresent = document.getElementById('btn-att-all-present');
  if (btnAllPresent) {
    btnAllPresent.addEventListener('click', setAllAttendancePresent);
  }
  document.getElementById('attendance-date').addEventListener('change', loadAttendanceData);

  // Seating tab buttons
  document.getElementById('btn-save-seat-config').addEventListener('click', saveSeatConfig);
  document.getElementById('btn-arrange-number-seats').addEventListener('click', () => autoArrangeSeats('by_number'));
  document.getElementById('btn-arrange-gender-seats').addEventListener('click', () => autoArrangeSeats('gender_balanced'));
  document.getElementById('btn-arrange-random-seats').addEventListener('click', () => autoArrangeSeats('random'));

  // Grouping tab buttons & Grouping Plan Toolbar
  const groupPlanSelect = document.getElementById('group-plan-select');
  if (groupPlanSelect) {
    groupPlanSelect.addEventListener('change', (e) => {
      const planId = parseInt(e.target.value);
      if (planId) {
        AppState.currentGroupPlanId = planId;
        loadGroupingData(planId);
      }
    });
  }

  const btnSetActivePlan = document.getElementById('btn-set-active-group-plan');
  if (btnSetActivePlan) {
    btnSetActivePlan.addEventListener('click', setActiveGroupPlan);
  }

  const btnCreatePlan = document.getElementById('btn-create-group-plan');
  if (btnCreatePlan) {
    btnCreatePlan.addEventListener('click', () => openCreateGroupPlanModal(false));
  }

  const btnCopyPlan = document.getElementById('btn-copy-group-plan');
  if (btnCopyPlan) {
    btnCopyPlan.addEventListener('click', () => openCreateGroupPlanModal(true));
  }

  const btnRenamePlan = document.getElementById('btn-rename-group-plan');
  if (btnRenamePlan) {
    btnRenamePlan.addEventListener('click', openRenameGroupPlanModal);
  }

  const btnDeletePlan = document.getElementById('btn-delete-group-plan');
  if (btnDeletePlan) {
    btnDeletePlan.addEventListener('click', confirmDeleteGroupPlan);
  }

  const btnSubmitCreatePlan = document.getElementById('btn-submit-create-group-plan');
  if (btnSubmitCreatePlan) {
    btnSubmitCreatePlan.addEventListener('click', submitCreateGroupPlan);
  }

  const btnSubmitRenamePlan = document.getElementById('btn-submit-rename-group-plan');
  if (btnSubmitRenamePlan) {
    btnSubmitRenamePlan.addEventListener('click', submitRenameGroupPlan);
  }

  document.getElementById('btn-run-grouping').addEventListener('click', runAutoGrouping);
  const btnAddCustomGroup = document.getElementById('btn-add-custom-group');
  if (btnAddCustomGroup) {
    btnAddCustomGroup.addEventListener('click', openAddGroupModal);
  }

  const btnDelGroup = document.getElementById('btn-delete-group');
  if (btnDelGroup) {
    btnDelGroup.addEventListener('click', confirmDeleteGroup);
  }

  const btnTriggerUploadGroupIcon = document.getElementById('btn-trigger-upload-group-icon');
  const groupIconFileInput = document.getElementById('edit-group-icon-file');
  if (btnTriggerUploadGroupIcon && groupIconFileInput) {
    btnTriggerUploadGroupIcon.addEventListener('click', () => groupIconFileInput.click());
    groupIconFileInput.addEventListener('change', () => {
      if (groupIconFileInput.files && groupIconFileInput.files[0]) {
        const file = groupIconFileInput.files[0];
        currentPendingGroupIconFile = file;
        currentSelectedGroupIcon = null;
        const reader = new FileReader();
        reader.onload = (e) => {
          document.getElementById('edit-group-icon-preview').src = e.target.result;
          updatePresetIconSelection(null);
        };
        reader.readAsDataURL(file);
      }
    });
  }

  const btnResetGroupIcon = document.getElementById('btn-reset-group-icon');
  if (btnResetGroupIcon) {
    btnResetGroupIcon.addEventListener('click', () => {
      currentPendingGroupIconFile = null;
      currentSelectedGroupIcon = null;
      if (groupIconFileInput) groupIconFileInput.value = '';
      const fallbackSrc = currentEditingGroup ? getGroupAvatarSrc(currentEditingGroup) : '/static/pic/animals/penguin.png';
      document.getElementById('edit-group-icon-preview').src = fallbackSrc;
      updatePresetIconSelection(null);
    });
  }

  document.querySelectorAll('.group-preset-icon-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      currentPendingGroupIconFile = null;
      if (groupIconFileInput) groupIconFileInput.value = '';
      currentSelectedGroupIcon = btn.dataset.icon;
      document.getElementById('edit-group-icon-preview').src = currentSelectedGroupIcon;
      updatePresetIconSelection(currentSelectedGroupIcon);
    });
  });

  // Notes tab buttons
  document.getElementById('btn-save-note').addEventListener('click', saveNote);
  initNoteQuickForm();
  document.getElementById('btn-confirm-save-quick-note').addEventListener('click', confirmSaveQuickNote);

  // Dashboard period buttons & Big Screen Projection listeners
  document.querySelectorAll('.dashboard-period-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.dashboard-period-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      AppState.dashboardPeriod = btn.dataset.period;

      // Sync Big Screen Period Buttons
      document.querySelectorAll('.proj-period-btn').forEach(b => {
        if (b.dataset.period === AppState.dashboardPeriod) b.classList.add('active');
        else b.classList.remove('active');
      });

      const rangeInputs = document.getElementById('dashboard-range-inputs');
      const projRangeInputs = document.getElementById('proj-range-inputs');
      if (AppState.dashboardPeriod === 'range') {
        if (rangeInputs) rangeInputs.style.display = 'flex';
        if (projRangeInputs) projRangeInputs.style.display = 'flex';
        lastDashboardFingerprint = null;
        loadDashboardData(true);
      } else {
        if (rangeInputs) rangeInputs.style.display = 'none';
        if (projRangeInputs) projRangeInputs.style.display = 'none';
        lastDashboardFingerprint = null;
        loadDashboardData(true);
        refreshProjectionData();
      }
    });
  });

  // Big screen period buttons listeners (大螢幕投影內切換時段)
  document.querySelectorAll('.proj-period-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.proj-period-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      AppState.dashboardPeriod = btn.dataset.period;

      // Sync Dashboard Period Buttons
      document.querySelectorAll('.dashboard-period-btn').forEach(b => {
        if (b.dataset.period === AppState.dashboardPeriod) b.classList.add('active');
        else b.classList.remove('active');
      });

      const rangeInputs = document.getElementById('dashboard-range-inputs');
      const projRangeInputs = document.getElementById('proj-range-inputs');
      if (AppState.dashboardPeriod === 'range') {
        if (projRangeInputs) projRangeInputs.style.display = 'flex';
        if (rangeInputs) rangeInputs.style.display = 'flex';
        lastDashboardFingerprint = null;
        loadDashboardData(true);
      } else {
        if (projRangeInputs) projRangeInputs.style.display = 'none';
        if (rangeInputs) rangeInputs.style.display = 'none';
        refreshProjectionData();
        loadDashboardData();
      }
    });
  });

  ['dash-start-date', 'dash-end-date'].forEach(id => {
    const el = document.getElementById(id);
    if (el) {
      el.addEventListener('change', () => {
        const s = document.getElementById('dash-start-date')?.value;
        const e = document.getElementById('dash-end-date')?.value;
        if (s && e) {
          lastDashboardFingerprint = null;
          loadDashboardData(true);
        }
      });
    }
  });

  document.getElementById('btn-apply-dash-range').addEventListener('click', () => {
    const s = document.getElementById('dash-start-date').value;
    const e = document.getElementById('dash-end-date').value;
    const projS = document.getElementById('proj-start-date');
    const projE = document.getElementById('proj-end-date');
    if (projS) projS.value = s;
    if (projE) projE.value = e;
    loadDashboardData();
    refreshProjectionData();
  });

  const btnApplyProjRange = document.getElementById('btn-apply-proj-range');
  if (btnApplyProjRange) {
    btnApplyProjRange.addEventListener('click', () => {
      const s = document.getElementById('proj-start-date').value;
      const e = document.getElementById('proj-end-date').value;
      document.getElementById('dash-start-date').value = s;
      document.getElementById('dash-end-date').value = e;
      refreshProjectionData();
      loadDashboardData();
    });
  }

  // Scoring period buttons (即時評分時段切換：當天、當週、當月、指定期間)
  document.querySelectorAll('.scoring-period-btn').forEach(btn => {
    btn.addEventListener('click', async () => {
      const p = btn.dataset.period;
      AppState.scoringPeriod = p;
      localStorage.setItem('scoring_period', p);

      const rangeInputs = document.getElementById('scoring-range-inputs');
      if (p === 'range') {
        if (rangeInputs) rangeInputs.style.display = 'flex';
        const startInput = document.getElementById('scoring-start-date');
        const endInput = document.getElementById('scoring-end-date');
        if (startInput && endInput && (!startInput.value || !endInput.value)) {
          const now = new Date();
          const pad = n => String(n).padStart(2, '0');
          const toYMD = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
          const past = new Date();
          past.setDate(past.getDate() - 6);
          startInput.value = toYMD(past);
          endInput.value = toYMD(now);
          AppState.scoringStartDate = startInput.value;
          AppState.scoringEndDate = endInput.value;
        }
      } else {
        if (rangeInputs) rangeInputs.style.display = 'none';
      }

      updateScoringPeriodUI();
      await loadScoringData();
    });
  });

  ['scoring-start-date', 'scoring-end-date'].forEach(id => {
    const el = document.getElementById(id);
    if (el) {
      el.addEventListener('change', () => {
        const s = document.getElementById('scoring-start-date')?.value;
        const e = document.getElementById('scoring-end-date')?.value;
        if (s && e) {
          AppState.scoringStartDate = s;
          AppState.scoringEndDate = e;
          updateScoringPeriodUI();
          loadScoringData();
        }
      });
    }
  });

  document.getElementById('btn-apply-scoring-range')?.addEventListener('click', () => {
    const s = document.getElementById('scoring-start-date')?.value;
    const e = document.getElementById('scoring-end-date')?.value;
    if (!s || !e) {
      alert(window.I18n && window.I18n.getLanguage() === 'en' ? 'Please select both start and end dates!' : '請選擇開始與結束日期！');
      return;
    }
    AppState.scoringStartDate = s;
    AppState.scoringEndDate = e;
    updateScoringPeriodUI();
    loadScoringData();
  });

  // Handle date range preset pills (近 7 天, 近 30 天, 本月) for dashboard, projection & scoring
  document.querySelectorAll('.proj-range-preset-pill').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.preventDefault();
      const isScoring = btn.dataset.target === 'scoring' || btn.closest('#scoring-range-inputs');
      const isDash = btn.dataset.target === 'dash' || btn.closest('#dashboard-range-inputs');
      const startInput = document.getElementById(isScoring ? 'scoring-start-date' : (isDash ? 'dash-start-date' : 'proj-start-date'));
      const endInput = document.getElementById(isScoring ? 'scoring-end-date' : (isDash ? 'dash-end-date' : 'proj-end-date'));
      if (!startInput || !endInput) return;

      const now = new Date();
      const pad = n => String(n).padStart(2, '0');
      const toYMD = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

      let sDate;
      const eDate = new Date();
      if (btn.dataset.days) {
        const days = parseInt(btn.dataset.days, 10);
        sDate = new Date();
        sDate.setDate(sDate.getDate() - (days - 1));
      } else if (btn.dataset.preset === 'month') {
        sDate = new Date(now.getFullYear(), now.getMonth(), 1);
      }

      if (sDate) {
        startInput.value = toYMD(sDate);
        endInput.value = toYMD(eDate);

        if (isScoring) {
          AppState.scoringStartDate = startInput.value;
          AppState.scoringEndDate = endInput.value;
          const applyBtn = document.getElementById('btn-apply-scoring-range');
          if (applyBtn) applyBtn.click();
        } else {
          // Synchronize between dash and proj
          const otherStart = document.getElementById(isDash ? 'proj-start-date' : 'dash-start-date');
          const otherEnd = document.getElementById(isDash ? 'proj-end-date' : 'dash-end-date');
          if (otherStart) otherStart.value = startInput.value;
          if (otherEnd) otherEnd.value = endInput.value;

          startInput.dispatchEvent(new Event('change', { bubbles: true }));
          endInput.dispatchEvent(new Event('change', { bubbles: true }));

          const applyBtn = document.getElementById(isDash ? 'btn-apply-dash-range' : 'btn-apply-proj-range');
          if (applyBtn) applyBtn.click();
        }
      }
    });
  });

  document.getElementById('btn-open-big-screen').addEventListener('click', () => openBigScreenProjection());
  document.getElementById('btn-scoring-show-leaderboard')?.addEventListener('click', () => openBigScreenProjection({ fromScoring: true }));
  document.getElementById('btn-close-big-screen').addEventListener('click', closeBigScreenProjection);

  // Big screen projection view mode toggle (個人排行 vs 小組排行 vs 座號總覽)
  const btnProjInd = document.getElementById('btn-proj-mode-individual');
  const btnProjGrp = document.getElementById('btn-proj-mode-group');
  const btnProjAll = document.getElementById('btn-proj-mode-all');

  function updateProjModeButtons(activeBtn) {
    [btnProjInd, btnProjGrp, btnProjAll].forEach(b => {
      if (b) b.classList.remove('active');
    });
    if (activeBtn) activeBtn.classList.add('active');
  }

  if (btnProjInd) {
    btnProjInd.addEventListener('click', () => {
      AppState.projectionViewMode = 'individual';
      updateProjModeButtons(btnProjInd);
      refreshProjectionData(true);
    });
  }

  if (btnProjGrp) {
    btnProjGrp.addEventListener('click', () => {
      AppState.projectionViewMode = 'group';
      updateProjModeButtons(btnProjGrp);
      refreshProjectionData(true);
    });
  }

  if (btnProjAll) {
    btnProjAll.addEventListener('click', () => {
      AppState.projectionViewMode = 'all';
      updateProjModeButtons(btnProjAll);
      refreshProjectionData(true);
    });
  }

  // Dashboard view mode toggle (個人排行 vs 小組排行 vs 座號總覽)
  const btnDashInd = document.getElementById('btn-dash-mode-individual');
  const btnDashGrp = document.getElementById('btn-dash-mode-group');
  const btnDashAll = document.getElementById('btn-dash-mode-all');
  const secDashInd = document.getElementById('dash-section-individual');
  const secDashGrp = document.getElementById('dash-section-group');
  const secDashAll = document.getElementById('dash-section-all');

  function setDashboardMode(mode) {
    AppState.dashboardViewMode = mode;
    if (btnDashInd) btnDashInd.className = mode === 'individual' ? 'btn dash-mode-btn active' : 'btn btn-secondary dash-mode-btn';
    if (btnDashGrp) btnDashGrp.className = mode === 'group' ? 'btn dash-mode-btn active' : 'btn btn-secondary dash-mode-btn';
    if (btnDashAll) btnDashAll.className = mode === 'all' ? 'btn dash-mode-btn active' : 'btn btn-secondary dash-mode-btn';

    if (secDashInd) secDashInd.style.display = mode === 'individual' ? 'block' : 'none';
    if (secDashGrp) secDashGrp.style.display = mode === 'group' ? 'block' : 'none';
    if (secDashAll) secDashAll.style.display = mode === 'all' ? 'block' : 'none';

    loadDashboardData(true);
  }

  if (btnDashInd) btnDashInd.addEventListener('click', () => setDashboardMode('individual'));
  if (btnDashGrp) btnDashGrp.addEventListener('click', () => setDashboardMode('group'));
  if (btnDashAll) btnDashAll.addEventListener('click', () => setDashboardMode('all'));

  // Security & Auth Listeners
  document.getElementById('btn-submit-auth-password').addEventListener('click', submitAuthPassword);
  document.getElementById('auth-password-input').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') submitAuthPassword();
  });
  document.getElementById('btn-open-forgot-password-modal').addEventListener('click', openForgotConfirmModal);
  document.getElementById('student-login-form').addEventListener('submit', submitStudentLogin);
  const btnShowStudentQr = document.getElementById('btn-show-student-qr');
  if (btnShowStudentQr) btnShowStudentQr.addEventListener('click', showStudentQrModal);

  const btnAdminShowStudentQr = document.getElementById('btn-admin-show-student-qr');
  if (btnAdminShowStudentQr) btnAdminShowStudentQr.addEventListener('click', showStudentQrModal);

  const btnSecurityShowStudentQr = document.getElementById('btn-security-show-student-qr');
  if (btnSecurityShowStudentQr) btnSecurityShowStudentQr.addEventListener('click', showStudentQrModal);

  document.querySelectorAll('.btn-show-student-qr-action').forEach((btn) => {
    btn.addEventListener('click', showStudentQrModal);
  });
  document.getElementById('qr-student-image').addEventListener('click', () => {
    openQrFullscreenTab(
      document.getElementById('qr-student-image').src,
      document.getElementById('qr-student-url-text').textContent
    );
  });
  document.getElementById('btn-confirm-forgot-reset').addEventListener('click', confirmForgotReset);
  document.getElementById('btn-save-password-prefix').addEventListener('click', savePasswordPrefix);

  const btnLogout = document.getElementById('btn-logout');
  if (btnLogout) btnLogout.addEventListener('click', logout);
  const btnAdminLogout = document.getElementById('btn-admin-logout');
  if (btnAdminLogout) btnAdminLogout.addEventListener('click', logout);

  // Admin tab buttons
  document.getElementById('btn-open-add-student-modal').addEventListener('click', openAddStudentModal);
  const photoInput = document.getElementById('edit-student-photo-input');
  document.getElementById('btn-edit-student-photo-pick').addEventListener('click', () => {
    const s = editingPhotoStudent;
    if (s && !s.student_code) {
      alert(window.I18n && window.I18n.getLanguage() === 'en' ? 'Set and save a student ID first.' : '請先為這位學生設定並儲存學號。');
      return;
    }
    photoInput.click();
  });
  photoInput.addEventListener('change', () => { const f = photoInput.files[0]; photoInput.value = ''; changeEditingStudentPhoto(f); });
  document.getElementById('btn-edit-student-photo-remove').addEventListener('click', removeEditingStudentPhoto);
  document.getElementById('btn-edit-student-photo-restore').addEventListener('click', restoreEditingStudentPhoto);
  const batchInput = document.getElementById('batch-photo-input');
  document.getElementById('btn-batch-photo-import').addEventListener('click', () => batchInput.click());
  batchInput.addEventListener('change', () => { const arr = Array.from(batchInput.files); batchInput.value = ''; batchImportStudentPhotos(arr); });
  document.getElementById('btn-confirm-save-student').addEventListener('click', confirmSaveStudent);
  document.getElementById('btn-upload-file').addEventListener('click', uploadStudentFile);
  document.getElementById('btn-export-excel').addEventListener('click', exportExcel);
  const exportStartInput = document.getElementById('export-start-date');
  const exportEndInput = document.getElementById('export-end-date');
  if (exportStartInput) {
    exportStartInput.addEventListener('change', updateExportExcelButtonState);
    exportStartInput.addEventListener('input', updateExportExcelButtonState);
  }
  if (exportEndInput) {
    exportEndInput.addEventListener('change', updateExportExcelButtonState);
    exportEndInput.addEventListener('input', updateExportExcelButtonState);
  }
  updateExportExcelButtonState();
  document.getElementById('btn-add-rule-modal').addEventListener('click', openAddRuleModal);
  document.getElementById('btn-reset-rules-default').addEventListener('click', resetRulesDefault);

  // Modal Confirm: Add / Edit Rule
  document.getElementById('btn-confirm-add-rule').addEventListener('click', confirmSaveRule);

  // Logo & Favicon Customization Listeners
  const btnUploadLogo = document.getElementById('btn-upload-logo');
  if (btnUploadLogo) btnUploadLogo.addEventListener('click', uploadCustomLogo);
  const btnResetLogo = document.getElementById('btn-reset-logo');
  if (btnResetLogo) btnResetLogo.addEventListener('click', resetCustomLogo);

  // Admin Sub-Navigation Mode Switcher (後台分類切換按鈕)
  document.querySelectorAll('.admin-subtab-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.admin-subtab-btn').forEach(b => {
        b.classList.remove('active');
        b.className = 'btn btn-secondary admin-subtab-btn';
      });
      btn.classList.add('active');
      btn.className = 'btn admin-subtab-btn active';

      const targetSubtab = btn.dataset.subtab;
      document.querySelectorAll('.admin-subpane').forEach(pane => {
        pane.style.display = 'none';
        pane.classList.remove('active');
      });

      const targetPane = document.getElementById(`admin-subpane-${targetSubtab}`);
      if (targetPane) {
        targetPane.style.display = 'block';
        targetPane.classList.add('active');
      }
      if (targetSubtab === 'pointcards' && window.PointCardsManager && typeof window.PointCardsManager.reload === 'function') {
        window.PointCardsManager.reload();
      }
      if (targetSubtab === 'rewards' && window.RewardsManager && typeof window.RewardsManager.reload === 'function') {
        window.RewardsManager.reload();
      }
    });
  });

  // Filter Student Score Logs Modal Listeners
  const btnFilterLogs = document.getElementById('btn-filter-score-logs');
  if (btnFilterLogs) btnFilterLogs.addEventListener('click', loadStudentScoreLogs);

  const btnResetLogs = document.getElementById('btn-reset-filter-score-logs');
  if (btnResetLogs) {
    btnResetLogs.addEventListener('click', () => {
      const s = document.getElementById('score-logs-start-date');
      const e = document.getElementById('score-logs-end-date');
      if (s) s.value = '';
      if (e) e.value = '';
      loadStudentScoreLogs();
    });
  }

  // Paper Quiz Listeners
  const quizSelect = document.getElementById('paper-quiz-select');
  if (quizSelect) {
    quizSelect.addEventListener('change', (e) => {
      AppState.currentPaperQuizId = Number(e.target.value);
      loadPaperQuizMatrix(AppState.currentPaperQuizId);
    });
  }

  const filterSubject = document.getElementById('paper-quiz-filter-subject');
  if (filterSubject) {
    filterSubject.addEventListener('change', () => filterAndRenderPaperQuizSelect());
  }

  const searchKeyword = document.getElementById('paper-quiz-search-keyword');
  if (searchKeyword) {
    searchKeyword.addEventListener('input', () => filterAndRenderPaperQuizSelect());
  }

  const btnClearSearch = document.getElementById('btn-clear-quiz-search');
  if (btnClearSearch) {
    btnClearSearch.addEventListener('click', () => {
      if (searchKeyword) {
        searchKeyword.value = '';
        filterAndRenderPaperQuizSelect();
      }
    });
  }

  const btnCreateQuiz = document.getElementById('btn-create-paper-quiz');
  if (btnCreateQuiz) btnCreateQuiz.addEventListener('click', () => openPaperQuizModal(false));

  const btnEditQuiz = document.getElementById('btn-edit-paper-quiz');
  if (btnEditQuiz) btnEditQuiz.addEventListener('click', () => openPaperQuizModal(true));

  const btnDeleteQuiz = document.getElementById('btn-delete-paper-quiz');
  if (btnDeleteQuiz) btnDeleteQuiz.addEventListener('click', confirmDeleteCurrentPaperQuiz);

  // 紙本測驗成績已改為即時自動儲存 (Auto-Save)，移除手動儲存按鈕綁定

  const formPaperQuiz = document.getElementById('form-paper-quiz');
  if (formPaperQuiz) formPaperQuiz.addEventListener('submit', submitPaperQuizForm);

  const filterUnrecorded = document.getElementById('paper-quiz-filter-unrecorded');
  if (filterUnrecorded) {
    filterUnrecorded.addEventListener('change', () => renderPaperQuizMatrix(AppState.currentPaperQuizData));
  }

  const filterPending = document.getElementById('paper-quiz-filter-pending-photos');
  if (filterPending) {
    filterPending.addEventListener('change', () => renderPaperQuizMatrix(AppState.currentPaperQuizData));
  }

  const filterAbsent = document.getElementById('paper-quiz-filter-absent');
  if (filterAbsent) {
    filterAbsent.addEventListener('change', () => renderPaperQuizMatrix(AppState.currentPaperQuizData));
  }

  const filterMakeup = document.getElementById('paper-quiz-filter-makeup');
  if (filterMakeup) {
    filterMakeup.addEventListener('change', () => renderPaperQuizMatrix(AppState.currentPaperQuizData));
  }

  const btnApprovePhoto = document.getElementById('btn-quiz-verify-approve');
  if (btnApprovePhoto) btnApprovePhoto.addEventListener('click', () => setQuizPhotoVerifyStatus(true));

  const btnRejectPhoto = document.getElementById('btn-quiz-verify-reject');
  if (btnRejectPhoto) btnRejectPhoto.addEventListener('click', () => setQuizPhotoVerifyStatus(false));

  // --- 紙本測驗學生成績總覽事件綁定 ---
  const btnOpenOverview = document.getElementById('btn-open-paper-quiz-overview');
  if (btnOpenOverview) {
    btnOpenOverview.addEventListener('click', openPaperQuizOverviewModal);
  }

  const btnQueryOverview = document.getElementById('btn-paper-quiz-overview-query');
  if (btnQueryOverview) {
    btnQueryOverview.addEventListener('click', loadPaperQuizOverviewData);
  }

  const overviewSubject = document.getElementById('paper-quiz-overview-subject');
  if (overviewSubject) {
    overviewSubject.addEventListener('change', loadPaperQuizOverviewData);
  }

  const btnResetOverview = document.getElementById('btn-paper-quiz-overview-reset');
  if (btnResetOverview) {
    btnResetOverview.addEventListener('click', () => {
      const subjEl = document.getElementById('paper-quiz-overview-subject');
      const startEl = document.getElementById('paper-quiz-overview-start-date');
      const endEl = document.getElementById('paper-quiz-overview-end-date');
      if (subjEl) subjEl.value = '';
      if (startEl) startEl.value = '';
      if (endEl) endEl.value = '';
      loadPaperQuizOverviewData();
    });
  }
}
