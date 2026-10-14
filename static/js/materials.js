/* ==========================================================================
   國小課堂即時記錄系統 - 課程素材與單元模組 (LMS Phase 2, Teacher side)
   Course -> Unit -> SubUnit -> Material CRUD, 課堂 QR Code 登入, 學生密碼管理
   ========================================================================== */
(function () {
  let unitsData = [];
  let currentProgressMap = {};
  let currentSubmissionProgressMap = {};
  let currentCourseStudents = [];
  // 編輯模式：僅由「✏️ 編輯課程內容」按鈕切換，load() 重新整理時刻意不重置，
  // 讓老師新增章節/素材後仍停留在編輯模式，可以連續操作不必每次重新進入。
  let editMode = false;

  function courseId() {
    return window.AppState && window.AppState.currentCourseId;
  }

  function escapeHtml(s) {
    const d = document.createElement('div');
    d.textContent = s == null ? '' : String(s);
    return d.innerHTML;
  }

  function t(key, fallback, params) {
    if (window.I18n && typeof window.I18n.t === 'function') {
      return window.I18n.t(key, params);
    }
    return fallback;
  }

  function findUnitIdForSubUnit(subUnitId) {
    for (const u of unitsData) {
      if (u.subUnits.some((su) => su.id === subUnitId)) return u.id;
    }
    return null;
  }

  function updateCourseTitle(cid) {
    const titleEl = document.getElementById('materials-course-title');
    if (!titleEl) return;
    const course = ((window.AppState && window.AppState.courses) || []).find((c) => c.id === cid);
    const suffix = t('materials_title', '📚 課程與教材').replace('📚 ', '');
    titleEl.textContent = course ? `📚 ${course.name} ${suffix}` : t('materials_title', '📚 課程與教材');
  }

  async function load() {
    const cid = courseId();
    const container = document.getElementById('materials-units-list');
    if (!container) return;
    if (!cid) {
      if (window.renderEmptyCourseNotice) window.renderEmptyCourseNotice(container);
      return;
    }
    updateCourseTitle(cid);
    try {
      const [units, progress, submissionProgress, students] = await Promise.all([
        API.get(`/api/units/${cid}`),
        API.get(`/api/units/${cid}/reading_progress`),
        API.get(`/api/units/${cid}/submission_progress`),
        API.get(`/api/courses/${cid}/students`),
      ]);
      unitsData = units;
      const progressMap = {};
      progress.forEach((p) => {
        progressMap[p.sub_unit_id] = p;
      });
      currentProgressMap = progressMap;
      const submissionProgressMap = {};
      submissionProgress.forEach((p) => {
        submissionProgressMap[p.sub_unit_id] = p;
      });
      currentSubmissionProgressMap = submissionProgressMap;
      currentCourseStudents = students;
      render(units, progressMap);
    } catch (err) {
      console.error('LmsMaterials.load error', err);
      container.innerHTML = `<div style="padding: 24px; color: var(--accent-negative);">課程素材載入失敗：${escapeHtml(err.message)}</div>`;
    }
  }

  function setEditMode(on) {
    editMode = on;
    const toggleBtn = document.getElementById('btn-materials-toggle-edit');
    if (toggleBtn) {
      toggleBtn.className = on ? 'btn btn-success' : 'btn';
      toggleBtn.textContent = on ? t('materials_btn_finish_edit', '✅ 完成編輯') : t('materials_btn_toggle_edit', '✏️ 編輯課程內容');
      toggleBtn.style.fontSize = '0.85rem';
    }
    const addUnitBtn = document.getElementById('btn-materials-add-unit');
    if (addUnitBtn) addUnitBtn.style.display = on ? '' : 'none';
    if (!on) {
      const inlineForm = document.getElementById('materials-new-unit-inline-form');
      if (inlineForm) inlineForm.style.display = 'none';
    }
    render(unitsData, currentProgressMap);
  }

  function render(units, progressMap) {
    const container = document.getElementById('materials-units-list');
    if (!container) return;
    if (!units.length) {
      container.innerHTML = `<div style="padding: 40px 20px; text-align:center; color: var(--text-muted);">${t('materials_empty_notice', '🎓 目前還沒有課程內容，請點選上方「✏️ 編輯課程內容」新增第一個主題。')}</div>`;
      return;
    }
    container.innerHTML = '';
    units.forEach((u, index) => container.appendChild(renderUnit(u, progressMap, index)));
  }

  function iconBtn(label, onClick) {
    const btn = document.createElement('button');
    btn.className = 'btn btn-secondary';
    btn.style.cssText = 'font-size: 0.78rem; padding: 5px 10px;';
    btn.textContent = label;
    btn.addEventListener('click', onClick);
    return btn;
  }

  /** 「⋮」更多選項選單：點外部關閉的技法比照 static/student.html 的 .notif-dropdown，
   *  但用 inline style.display 切換（這個檔案從不新增共用 CSS class，維持既有慣例），
   *  搭配 bindStaticUi() 註冊的「唯一一次」document 點擊監聽即時查詢目前開啟的選單。 */
  function buildUnitMenu(u) {
    const wrap = document.createElement('span');
    wrap.style.cssText = 'position:relative; display:inline-block;';

    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'btn-icon';
    btn.title = '更多選項';
    btn.textContent = '⋮';

    const dropdown = document.createElement('div');
    dropdown.className = 'unit-menu-dropdown';
    dropdown.style.cssText = 'display:none; position:absolute; top:calc(100% + 4px); right:0; min-width:140px; background:var(--card-bg); border:1px solid var(--card-border); border-radius:var(--radius-sm); box-shadow:var(--shadow-lg); z-index:20; overflow:hidden;';

    const renameItem = document.createElement('button');
    renameItem.type = 'button';
    renameItem.style.cssText = 'display:block; width:100%; text-align:left; padding:8px 12px; border:none; background:none; cursor:pointer; font-size:0.85rem; color:var(--text-main);';
    renameItem.textContent = '✏️ 重新命名';
    renameItem.addEventListener('click', async (e) => {
      e.stopPropagation();
      dropdown.style.display = 'none';
      const cid = courseId();
      if (!cid) { window.ensureCourseSelected && window.ensureCourseSelected(); return; }
      const newTitle = await window.showPromptModal({ icon: '✏️', title: '請輸入新的章節名稱：', defaultValue: u.title });
      if (!newTitle || !newTitle.trim() || newTitle.trim() === u.title) return;
      try {
        await API.put(`/api/units/${cid}/${u.id}`, { title: newTitle.trim() });
        showToast('章節已重新命名', 'success');
        load();
      } catch (err) {
        showToast(err.message, 'error');
      }
    });

    const deleteItem = document.createElement('button');
    deleteItem.type = 'button';
    deleteItem.style.cssText = 'display:block; width:100%; text-align:left; padding:8px 12px; border:none; background:none; cursor:pointer; font-size:0.85rem; color:var(--accent-negative);';
    deleteItem.textContent = '🗑️ 刪除';
    deleteItem.addEventListener('click', (e) => {
      e.stopPropagation();
      dropdown.style.display = 'none';
      deleteUnit(u);
    });

    dropdown.appendChild(renameItem);
    dropdown.appendChild(deleteItem);

    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const willShow = dropdown.style.display === 'none';
      document.querySelectorAll('.unit-menu-dropdown').forEach((d) => { d.style.display = 'none'; });
      dropdown.style.display = willShow ? 'block' : 'none';
    });

    wrap.appendChild(btn);
    wrap.appendChild(dropdown);
    return wrap;
  }

  function renderUnit(u, progressMap, index) {
    const wrap = document.createElement('div');
    wrap.style.cssText = 'border:1px solid var(--card-border); border-left: 4px solid #6366f1; border-radius: var(--radius-md); margin: 14px 0; overflow:hidden;';

    const head = document.createElement('div');
    head.style.cssText = 'display:flex; align-items:center; gap:10px; padding: 12px 16px; background: var(--nav-bg); flex-wrap: wrap;';

    if (editMode) {
      const moveWrap = document.createElement('div');
      moveWrap.style.cssText = 'display:flex; flex-direction:column; line-height:1;';
      const upBtn = document.createElement('button');
      upBtn.type = 'button';
      upBtn.className = 'btn-icon';
      upBtn.title = '上移';
      upBtn.textContent = '▲';
      upBtn.disabled = index === 0;
      upBtn.style.opacity = index === 0 ? '0.3' : '1';
      upBtn.addEventListener('click', () => moveUnit(u, -1));
      const downBtn = document.createElement('button');
      downBtn.type = 'button';
      downBtn.className = 'btn-icon';
      downBtn.title = '下移';
      downBtn.textContent = '▼';
      downBtn.disabled = index === unitsData.length - 1;
      downBtn.style.opacity = index === unitsData.length - 1 ? '0.3' : '1';
      downBtn.addEventListener('click', () => moveUnit(u, 1));
      moveWrap.appendChild(upBtn);
      moveWrap.appendChild(downBtn);
      head.appendChild(moveWrap);
    }

    const chip = document.createElement('span');
    chip.style.cssText = 'display:inline-flex; align-items:center; gap:4px; background:var(--card-bg); border-radius:var(--radius-full); padding:2px 10px; font-size:0.75rem; color:var(--text-muted); flex-shrink:0;';
    chip.textContent = '📁 章節';
    head.appendChild(chip);

    const titleSpan = document.createElement('span');
    titleSpan.style.cssText = 'font-weight:800; flex:1; min-width:80px;';
    titleSpan.innerHTML = `${escapeHtml(u.title)} ${u.isHidden ? '<span style="font-size:0.75rem; color:var(--text-subtle); font-weight:600;">(隱藏)</span>' : ''}`;
    head.appendChild(titleSpan);

    const badge = document.createElement('span');
    badge.style.cssText = 'font-size:0.75rem; font-weight:700; background:rgba(99,102,241,0.12); color:#6366f1; border-radius:var(--radius-full); padding:2px 10px; flex-shrink:0;';
    badge.textContent = `第${index + 1}課`;
    head.appendChild(badge);

    const rightCluster = document.createElement('div');
    rightCluster.style.cssText = 'display:flex; align-items:center; gap:6px; margin-left:auto;';

    if (editMode) {
      const visBtn = document.createElement('button');
      visBtn.type = 'button';
      visBtn.className = 'btn btn-secondary';
      visBtn.style.cssText = 'font-size:0.75rem; padding:4px 10px;';
      visBtn.textContent = u.isHidden ? '🙈 隱藏中' : '👁 顯示中';
      visBtn.addEventListener('click', () => toggleUnitHidden(u));
      rightCluster.appendChild(visBtn);
      rightCluster.appendChild(buildUnitMenu(u));
    }

    const collapseBtn = document.createElement('button');
    collapseBtn.type = 'button';
    collapseBtn.className = 'btn-icon';
    collapseBtn.title = '展開／收合';
    rightCluster.appendChild(collapseBtn);
    head.appendChild(rightCluster);

    const body = document.createElement('div');
    body.style.cssText = 'padding: 10px 16px 16px;';
    if (u.subUnits.length) {
      u.subUnits.forEach((su) => body.appendChild(renderSubUnit(su, progressMap[su.id])));
    } else {
      const empty = document.createElement('div');
      empty.style.cssText = 'color:var(--text-muted); font-size:0.85rem; padding: 16px 0; text-align:center;';
      empty.textContent = '這個主題還沒有內容喔。';
      body.appendChild(empty);
    }
    if (editMode) {
      const addContentBtn = document.createElement('button');
      addContentBtn.type = 'button';
      addContentBtn.textContent = '➕ 新增素材';
      addContentBtn.style.cssText = 'width:100%; margin-top:10px; padding:10px; border:1.5px dashed var(--accent-positive); border-radius:var(--radius-sm); background:transparent; color:var(--accent-positive); font-weight:700; cursor:pointer; font-size:0.9rem;';
      addContentBtn.addEventListener('click', () => openAddContentModal(u.id));
      body.appendChild(addContentBtn);
    }

    // 預設展開（比照截圖），▲=展開中點我收合、▼=已收合點我展開。
    let expanded = true;
    collapseBtn.textContent = '▲';
    collapseBtn.addEventListener('click', () => {
      expanded = !expanded;
      body.style.display = expanded ? 'block' : 'none';
      collapseBtn.textContent = expanded ? '▲' : '▼';
    });

    wrap.appendChild(head);
    wrap.appendChild(body);
    return wrap;
  }

  function renderSubUnit(su, progress) {
    const card = document.createElement('div');
    card.style.cssText = 'border:1px solid var(--card-border); border-radius: var(--radius-sm); padding: 12px; margin: 8px 0; background: var(--card-bg);';

    const isAssignment = su.category === 'assignment';
    const isQuiz = su.category === 'quiz';
    const typeLabels = { file: '📄 檔案', text: '✏️ 文字', link: '🔗 連結' };
    const assignmentBadges = isAssignment
      ? `<div style="font-size:0.78rem; color:var(--text-muted); margin-top:6px; display:flex; gap:10px; flex-wrap:wrap;">
          <span>${su.assignmentType === 'group' ? '👥 小組作業' : '👤 個人作業'}</span>
          <span>${(su.submissionTypes || []).map((t) => typeLabels[t] || t).join('　')}</span>
          ${su.dueDate ? `<span>📅 期限：${escapeHtml(su.dueDate)}${su.autoLockOverdue ? '（逾期自動鎖定）' : ''}</span>` : ''}
        </div>`
      : isQuiz
      ? `<div style="font-size:0.78rem; color:var(--text-muted); margin-top:6px; display:flex; gap:10px; flex-wrap:wrap;">
          <span>✅ 線上測驗　共 ${(su.quizQuestions || []).length} 題</span>
          <span>${su.revealAnswersAfterSubmit ? '送出後公布詳解' : '送出後僅顯示總分'}</span>
          ${su.dueDate ? `<span>📅 期限：${escapeHtml(su.dueDate)}${su.autoLockOverdue ? '（逾期自動鎖定）' : ''}</span>` : ''}
        </div>`
      : '';

    const publishAtLabel = su.publishAt ? `<div style="font-size:0.78rem; color:var(--accent-warning, #d97706); margin-top:4px;">⏰ 定時開放：${escapeHtml(su.publishAt.replace('T', ' '))}</div>` : '';

    card.innerHTML = `
      <div style="display:flex; align-items:center; justify-content:space-between; gap:8px; flex-wrap:wrap;">
        <div style="font-weight:700;">${escapeHtml(su.title)} ${su.isHidden ? '<span style="font-size:0.75rem;color:var(--text-subtle);">(隱藏)</span>' : ''}</div>
        <div class="subunit-progress-badge"></div>
      </div>
      ${su.description ? `<div style="font-size:0.85rem; color:var(--text-muted); margin-top:6px; white-space:pre-wrap;">${escapeHtml(su.description)}</div>` : ''}
      ${publishAtLabel}
      ${assignmentBadges}
      <div class="material-items" style="margin-top:8px; display:flex; flex-direction:column; gap:6px;"></div>
      <div class="subunit-actions" style="display:flex; gap:8px; margin-top:10px; flex-wrap: wrap;"></div>
    `;

    // 進度徽章：material 顯示已閱讀／未閱讀人數，assignment/quiz 顯示已完成／未完成人數（小組作業以組數計），
    // 點擊皆可展開查看詳細名單（material -> 已讀/未讀學生清單；assignment/quiz -> 沿用既有繳交評分彈窗）。
    const badgeWrap = card.querySelector('.subunit-progress-badge');
    const progressBadge = document.createElement('button');
    progressBadge.type = 'button';
    progressBadge.style.cssText = 'font-size:0.78rem; color:var(--text-muted); background:var(--nav-bg); border:1px solid var(--card-border); border-radius:var(--radius-full); padding:3px 10px; cursor:pointer;';
    if (su.category === 'material') {
      const viewedCount = progress ? progress.viewed_count : 0;
      const total = progress ? progress.total_students : 0;
      const notViewed = Math.max(total - viewedCount, 0);
      progressBadge.textContent = `📊 已閱讀 ${viewedCount}／未閱讀 ${notViewed}`;
      progressBadge.addEventListener('click', () => openReadingListModal(su, progress));
      badgeWrap.appendChild(progressBadge);
    } else if (isAssignment || isQuiz) {
      const sp = currentSubmissionProgressMap[su.id];
      const total = sp ? sp.total : 0;
      const done = sp ? sp.turned_in_count : 0;
      const notDone = Math.max(total - done, 0);
      progressBadge.textContent = `✅ 已完成 ${done}／未完成 ${notDone}`;
      progressBadge.addEventListener('click', () => openGradingModal(su));
      badgeWrap.appendChild(progressBadge);
    }

    const itemsWrap = card.querySelector('.material-items');
    su.materials.forEach((m) => itemsWrap.appendChild(renderMaterialItem(su, m)));

    const actionsWrap = card.querySelector('.subunit-actions');
    actionsWrap.appendChild(iconBtn('✏️ 編輯', () => openEditContentModal(su)));
    if (isAssignment || isQuiz) {
      actionsWrap.appendChild(iconBtn(isQuiz ? '📋 查看成績' : '📋 查看繳交', () => openGradingModal(su)));
    }
    actionsWrap.appendChild(iconBtn(su.isHidden ? '👁️ 顯示' : '🙈 隱藏', () => toggleSubUnitHidden(su)));
    actionsWrap.appendChild(iconBtn('🗑️ 刪除', () => deleteSubUnit(su)));

    return card;
  }

  function renderMaterialItem(su, m) {
    const row = document.createElement('div');
    row.style.cssText = 'display:flex; align-items:center; justify-content:space-between; gap:8px; font-size:0.85rem; padding:6px 10px; border:1px solid var(--card-border); border-radius:8px;';
    const icon = m.type === 'file' ? '📄' : m.type === 'youtube' ? '▶️' : '🔗';
    const link = document.createElement('a');
    // 磁碟上的檔名是防碰撞用的亂數字串，帶 ?name= 讓下載/另存時用回素材標題顯示（見 src/index.ts
    // 的 /uploads/* 路由）；外部連結不需要。
    link.href = m.type === 'file' ? `${m.url}${m.url.includes('?') ? '&' : '?'}name=${encodeURIComponent(m.title)}` : m.url;
    link.target = '_blank';
    link.rel = 'noopener';
    link.style.cssText = 'color:var(--text-main); text-decoration:none; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; flex: 1;';
    link.textContent = `${icon} ${m.title}`;
    const delBtn = document.createElement('button');
    delBtn.className = 'btn-icon';
    delBtn.textContent = '✕';
    delBtn.title = '刪除教材';
    delBtn.addEventListener('click', () => deleteMaterial(su, m));
    row.appendChild(link);
    row.appendChild(delBtn);
    return row;
  }

  // 已讀／未讀學生名單彈窗（material 類型小單元的進度徽章點擊後開啟）。
  // reading_progress API 早就有回傳逐筆 details（student_id/last_viewed_at/view_count），
  // 只是先前完全沒被用到；未讀名單 = 全班學生名冊扣掉已讀清單。
  function openReadingListModal(su, progress) {
    document.getElementById('text-lms-reading-list-title').textContent = `📊 ${su.title} — 閱讀狀態`;
    const details = (progress && progress.details) || [];
    const detailMap = new Map(details.map((d) => [d.student_id, d]));
    const students = [...currentCourseStudents].sort((a, b) => a.student_number - b.student_number);
    const viewed = students.filter((s) => detailMap.has(s.id));
    const unviewed = students.filter((s) => !detailMap.has(s.id));

    document.getElementById('text-lms-reading-list-meta').textContent =
      `全班 ${students.length} 人｜已閱讀 ${viewed.length} 人｜未閱讀 ${unviewed.length} 人`;

    const viewedWrap = document.getElementById('list-lms-reading-viewed');
    viewedWrap.innerHTML = `<div style="font-weight:700; font-size:0.9rem; margin-bottom:8px; color:var(--accent-positive);">✅ 已閱讀（${viewed.length}）</div>`;
    if (!viewed.length) {
      viewedWrap.innerHTML += `<div style="color:var(--text-muted); font-size:0.85rem;">目前還沒有人閱讀。</div>`;
    } else {
      viewed.forEach((s) => {
        const d = detailMap.get(s.id);
        const row = document.createElement('div');
        row.style.cssText = 'display:flex; justify-content:space-between; gap:8px; padding:6px 0; border-bottom:1px solid var(--card-border); font-size:0.85rem;';
        row.innerHTML = `<span>${s.student_number} 號　${escapeHtml(s.name)}</span><span style="color:var(--text-muted); font-size:0.78rem;">最後閱讀：${escapeHtml(d.last_viewed_at)}（${d.view_count} 次）</span>`;
        viewedWrap.appendChild(row);
      });
    }

    const unviewedWrap = document.getElementById('list-lms-reading-unviewed');
    unviewedWrap.innerHTML = `<div style="font-weight:700; font-size:0.9rem; margin-bottom:8px; color:var(--accent-negative);">❌ 未閱讀（${unviewed.length}）</div>`;
    if (!unviewed.length) {
      unviewedWrap.innerHTML += `<div style="color:var(--text-muted); font-size:0.85rem;">全班都已經閱讀囉！</div>`;
    } else {
      unviewed.forEach((s) => {
        const row = document.createElement('div');
        row.style.cssText = 'padding:6px 0; border-bottom:1px solid var(--card-border); font-size:0.85rem;';
        row.textContent = `${s.student_number} 號　${s.name}`;
        unviewedWrap.appendChild(row);
      });
    }

    window.openModal('modal-lms-reading-list');
  }

  // --- Unit CRUD ---

  // 「➕ 新增章節」改成行內展開表單（比照截圖），取代原本的彈窗流程。
  function toggleNewUnitInlineForm() {
    const form = document.getElementById('materials-new-unit-inline-form');
    if (!form) return;
    const willShow = form.style.display === 'none';
    form.style.display = willShow ? 'block' : 'none';
    if (willShow) {
      const input = document.getElementById('input-lms-unit-title-inline');
      input.value = '';
      input.focus();
    }
  }

  async function submitNewUnitInline() {
    const cid = courseId();
    if (!cid) { window.ensureCourseSelected && window.ensureCourseSelected(); return; }
    const input = document.getElementById('input-lms-unit-title-inline');
    const title = input.value.trim();
    if (!title) return;
    try {
      await API.post(`/api/units/${cid}`, { title });
      input.value = '';
      document.getElementById('materials-new-unit-inline-form').style.display = 'none';
      showToast('章節建立成功！', 'success');
      load();
    } catch (err) {
      showToast(err.message, 'error');
    }
  }

  async function moveUnit(u, delta) {
    const cid = courseId();
    if (!cid) { window.ensureCourseSelected && window.ensureCourseSelected(); return; }
    const ids = unitsData.map((x) => x.id);
    const idx = ids.indexOf(u.id);
    const newIdx = idx + delta;
    if (newIdx < 0 || newIdx >= ids.length) return;
    [ids[idx], ids[newIdx]] = [ids[newIdx], ids[idx]];
    try {
      await API.put(`/api/units/${cid}/reorder`, { unit_ids: ids });
      load();
    } catch (err) {
      showToast(err.message, 'error');
    }
  }

  // --- 標頭工具列：開啟本機教材資料夾／匯出課程成績 ---

  async function openMaterialsFolder() {
    const cid = courseId();
    if (!cid) { window.ensureCourseSelected && window.ensureCourseSelected(); return; }
    try {
      await API.post(`/api/units/${cid}/open_materials_folder`, {});
      showToast('已在「伺服器主機」開啟課程資料夾（若您正透過手機/平板遠端連線，資料夾將顯示在伺服器電腦上，而非您手上的裝置）', 'info');
    } catch (err) {
      showToast(err.message, 'error');
    }
  }

  async function toggleUnitHidden(u) {
    const cid = courseId();
    if (!cid) { window.ensureCourseSelected && window.ensureCourseSelected(); return; }
    try {
      await API.put(`/api/units/${cid}/${u.id}`, { is_hidden: !u.isHidden });
      load();
    } catch (err) {
      showToast(err.message, 'error');
    }
  }

  async function deleteUnit(u) {
    if (!(await window.showConfirmModal({ icon: '🗑️', title: `確定要刪除單元「${u.title}」嗎？`, desc: '其下所有小單元與教材將一併刪除，此動作無法復原！', danger: true }))) return;
    const cid = courseId();
    if (!cid) { window.ensureCourseSelected && window.ensureCourseSelected(); return; }
    try {
      await API.delete(`/api/units/${cid}/${u.id}`);
      showToast('單元已刪除', 'success');
      load();
    } catch (err) {
      showToast(err.message, 'error');
    }
  }

  // --- SubUnit CRUD ---

  function getCheckedCategory() {
    return document.getElementById('select-lms-content-category').value;
  }
  function isYoutubeUrl(url) {
    return /(?:youtube\.com\/watch\?v=|youtu\.be\/|youtube\.com\/embed\/)([\w-]{6,})/.test(url);
  }
  function getCheckedAssignmentType() {
    return document.querySelector('input[name="lms-assignment-type"]:checked').value;
  }
  function updateSubUnitFormVisibility() {
    const category = getCheckedCategory();
    const isAssignment = category === 'assignment';
    const isQuiz = category === 'quiz';
    document.getElementById('wrap-lms-subunit-assignment').style.display = isAssignment ? 'block' : 'none';
    document.getElementById('wrap-lms-assignment-group-plan').style.display = isAssignment && getCheckedAssignmentType() === 'group' ? 'block' : 'none';
    document.getElementById('wrap-lms-subunit-duedate').style.display = (isAssignment || isQuiz) ? 'flex' : 'none';
    document.getElementById('wrap-lms-subunit-quiz').style.display = isQuiz ? 'block' : 'none';
  }

  // --- 測驗題目編輯器（新增小單元時使用） ---

  let quizQuestionsDraft = [];

  // --- 新增/編輯內容彈窗的附件暫存區：多個檔案＋多個連結（新增內容/作業） ---
  // 檔案 input 本身雖然有 multiple，但每次重新開檔案選擇視窗都會整組換掉，
  // 無法「先選一批、再補選幾個」，所以改用陣列自行暫存，累加而非取代。
  let stagedFiles = [];
  let linkRowsDraft = [];

  function renderStagedFilesList() {
    const wrap = document.getElementById('list-lms-content-files-staged');
    wrap.innerHTML = '';
    if (!stagedFiles.length) {
      wrap.innerHTML = '<div style="color:var(--text-muted); font-size:0.82rem;">尚未選擇檔案</div>';
      return;
    }
    stagedFiles.forEach((file, idx) => {
      const row = document.createElement('div');
      row.style.cssText = 'display:flex; align-items:center; justify-content:space-between; gap:8px; font-size:0.85rem; padding:6px 10px; border:1px solid var(--card-border); border-radius:8px;';
      const label = document.createElement('span');
      label.style.cssText = 'overflow:hidden; text-overflow:ellipsis; white-space:nowrap; flex:1;';
      label.textContent = `📄 ${file.name}`;
      const delBtn = document.createElement('button');
      delBtn.type = 'button';
      delBtn.className = 'btn-icon';
      delBtn.textContent = '✕';
      delBtn.title = '移除';
      delBtn.addEventListener('click', () => {
        stagedFiles.splice(idx, 1);
        renderStagedFilesList();
      });
      row.appendChild(label);
      row.appendChild(delBtn);
      wrap.appendChild(row);
    });
  }

  function generateLinkRowId() {
    return `link_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  }

  function addLinkRow() {
    linkRowsDraft.push({ id: generateLinkRowId(), title: '', url: '' });
    renderLinkRowsList();
  }

  function renderLinkRowsList() {
    const wrap = document.getElementById('list-lms-content-links');
    wrap.innerHTML = '';
    if (!linkRowsDraft.length) {
      wrap.innerHTML = '<div style="color:var(--text-muted); font-size:0.82rem;">尚未新增任何連結，點下方「➕ 新增連結」開始加入。</div>';
      return;
    }
    linkRowsDraft.forEach((row) => {
      const rowWrap = document.createElement('div');
      rowWrap.style.cssText = 'display:flex; gap:10px; flex-wrap:wrap; align-items:flex-end; border:1px solid var(--card-border); border-radius:8px; padding:10px;';
      rowWrap.innerHTML = `
        <div style="flex:1; min-width:140px;">
          <label style="display:block; font-size:0.78rem; color:var(--text-muted); margin-bottom:4px;">連結名稱（選填）</label>
          <input type="text" class="input-control link-title-input" style="width:100%; box-sizing:border-box;" placeholder="例如：教學說明影片">
        </div>
        <div style="flex:1; min-width:160px;">
          <label style="display:block; font-size:0.78rem; color:var(--text-muted); margin-bottom:4px;">網址 (https://...)</label>
          <input type="text" class="input-control link-url-input" style="width:100%; box-sizing:border-box;" placeholder="https://...">
        </div>
      `;
      // 用 .value 屬性指定初始值而非塞進 HTML 字串的 value="..." 屬性，避免標題/網址裡若含雙引號會截斷屬性。
      const titleInput = rowWrap.querySelector('.link-title-input');
      const urlInput = rowWrap.querySelector('.link-url-input');
      titleInput.value = row.title;
      urlInput.value = row.url;
      titleInput.addEventListener('input', (e) => { row.title = e.target.value; });
      urlInput.addEventListener('input', (e) => { row.url = e.target.value; });
      const delBtn = document.createElement('button');
      delBtn.type = 'button';
      delBtn.className = 'btn-icon';
      delBtn.textContent = '✕';
      delBtn.title = '移除連結';
      delBtn.addEventListener('click', () => {
        linkRowsDraft = linkRowsDraft.filter((r) => r.id !== row.id);
        renderLinkRowsList();
      });
      rowWrap.appendChild(delBtn);
      wrap.appendChild(rowWrap);
    });
  }

  function generateQuestionId() {
    return `q_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  }

  function renderQuizQuestionsList() {
    const container = document.getElementById('list-lms-quiz-questions');
    container.innerHTML = '';
    if (!quizQuestionsDraft.length) {
      const empty = document.createElement('div');
      empty.style.cssText = 'color:var(--text-muted); font-size:0.85rem;';
      empty.textContent = '尚未新增任何題目，請點選下方「➕ 新增題目」開始編輯，或使用上方「📤 匯入題目」一次匯入多道題目。';
      container.appendChild(empty);
      return;
    }
    quizQuestionsDraft.forEach((q, idx) => container.appendChild(renderQuizQuestionCard(q, idx)));
  }

  function renderQuizAnswerSection(wrap, q, idx) {
    wrap.innerHTML = '';
    if (q.type === 'multiple_choice') {
      if (!q.options || !q.options.length) q.options = ['', ''];
      const label = document.createElement('label');
      label.style.cssText = 'display:block; font-size:0.8rem; color:var(--text-muted); margin-bottom:4px;';
      label.textContent = '選項（點選圈選正確答案）';
      wrap.appendChild(label);
      q.options.forEach((opt, oi) => {
        const row = document.createElement('div');
        row.style.cssText = 'display:flex; align-items:center; gap:8px; margin-bottom:6px;';
        const radio = document.createElement('input');
        radio.type = 'radio';
        radio.name = `quiz-correct-${idx}-${q.id}`;
        radio.checked = String(oi) === q.correct_answer;
        radio.addEventListener('change', () => { q.correct_answer = String(oi); });
        const textInput = document.createElement('input');
        textInput.type = 'text';
        textInput.className = 'input-control';
        textInput.style.flex = '1';
        textInput.placeholder = `選項 ${oi + 1}`;
        textInput.value = opt;
        textInput.addEventListener('input', (e) => { q.options[oi] = e.target.value; });
        row.appendChild(radio);
        row.appendChild(textInput);
        if (q.options.length > 2) {
          const delBtn = document.createElement('button');
          delBtn.type = 'button';
          delBtn.className = 'btn-icon';
          delBtn.textContent = '✕';
          delBtn.addEventListener('click', () => {
            q.options.splice(oi, 1);
            const correctIdx = Number(q.correct_answer);
            if (String(correctIdx) === q.correct_answer) {
              if (correctIdx === oi) q.correct_answer = '';
              else if (correctIdx > oi) q.correct_answer = String(correctIdx - 1);
            }
            renderQuizAnswerSection(wrap, q, idx);
          });
          row.appendChild(delBtn);
        }
        wrap.appendChild(row);
      });
      const addOptBtn = document.createElement('button');
      addOptBtn.type = 'button';
      addOptBtn.className = 'btn btn-secondary';
      addOptBtn.style.cssText = 'font-size:0.78rem; padding:4px 10px;';
      addOptBtn.textContent = '➕ 新增選項';
      addOptBtn.addEventListener('click', () => { q.options.push(''); renderQuizAnswerSection(wrap, q, idx); });
      wrap.appendChild(addOptBtn);
    } else if (q.type === 'true_false') {
      const label = document.createElement('label');
      label.style.cssText = 'display:block; font-size:0.8rem; color:var(--text-muted); margin-bottom:4px;';
      label.textContent = '正確答案';
      wrap.appendChild(label);
      const optsRow = document.createElement('div');
      optsRow.style.cssText = 'display:flex; gap:14px;';
      [['true', '⭕ 正確'], ['false', '❌ 錯誤']].forEach(([val, text]) => {
        const lbl = document.createElement('label');
        lbl.style.fontSize = '0.85rem';
        const radio = document.createElement('input');
        radio.type = 'radio';
        radio.name = `quiz-tf-${idx}-${q.id}`;
        radio.value = val;
        radio.checked = q.correct_answer === val;
        radio.addEventListener('change', () => { q.correct_answer = val; });
        lbl.appendChild(radio);
        lbl.appendChild(document.createTextNode(' ' + text));
        optsRow.appendChild(lbl);
      });
      wrap.appendChild(optsRow);
    } else {
      const label = document.createElement('label');
      label.style.cssText = 'display:block; font-size:0.8rem; color:var(--text-muted); margin-bottom:4px;';
      label.textContent = '正確答案（送出後系統忽略大小寫與頭尾空白進行完全比對）';
      wrap.appendChild(label);
      const input = document.createElement('input');
      input.type = 'text';
      input.className = 'input-control';
      input.style.width = '100%';
      input.value = q.correct_answer || '';
      input.addEventListener('input', (e) => { q.correct_answer = e.target.value; });
      wrap.appendChild(input);
    }
  }

  function renderQuizQuestionCard(q, idx) {
    const card = document.createElement('div');
    card.style.cssText = 'border:1px solid var(--card-border); border-radius: var(--radius-sm); padding: 12px; background: var(--card-bg);';

    const header = document.createElement('div');
    header.style.cssText = 'display:flex; justify-content:space-between; align-items:center; margin-bottom:8px;';
    const titleSpan = document.createElement('span');
    titleSpan.style.cssText = 'font-weight:700; font-size:0.9rem;';
    titleSpan.textContent = `第 ${idx + 1} 題`;
    const delBtn = document.createElement('button');
    delBtn.type = 'button';
    delBtn.className = 'btn-icon';
    delBtn.textContent = '🗑️';
    delBtn.title = '刪除題目';
    delBtn.addEventListener('click', () => {
      quizQuestionsDraft.splice(idx, 1);
      renderQuizQuestionsList();
    });
    header.appendChild(titleSpan);
    header.appendChild(delBtn);
    card.appendChild(header);

    const row1 = document.createElement('div');
    row1.style.cssText = 'display:flex; gap:10px; margin-bottom:8px; flex-wrap:wrap;';
    row1.innerHTML = `
      <div style="flex:1; min-width:140px;">
        <label style="display:block; font-size:0.8rem; color:var(--text-muted); margin-bottom:4px;">題型</label>
        <select class="input-control quiz-type-select" style="width:100%;">
          <option value="multiple_choice">🔘 選擇題</option>
          <option value="true_false">⭕ 是非題</option>
          <option value="short_answer">✍️ 簡答題</option>
        </select>
      </div>
      <div style="width:100px;">
        <label style="display:block; font-size:0.8rem; color:var(--text-muted); margin-bottom:4px;">配分</label>
        <input type="number" min="1" class="input-control quiz-points-input" style="width:100%;">
      </div>
    `;
    card.appendChild(row1);
    const typeSelect = row1.querySelector('.quiz-type-select');
    const pointsInput = row1.querySelector('.quiz-points-input');
    typeSelect.value = q.type;
    pointsInput.value = q.points;

    const textWrap = document.createElement('div');
    textWrap.style.cssText = 'margin-bottom:8px;';
    textWrap.innerHTML = `
      <label style="display:block; font-size:0.8rem; color:var(--text-muted); margin-bottom:4px;">題目內容</label>
      <textarea class="input-control quiz-text-input" style="width:100%; min-height:50px; resize:vertical;"></textarea>
    `;
    card.appendChild(textWrap);
    const textInput = textWrap.querySelector('.quiz-text-input');
    textInput.value = q.question_text;

    const answerWrap = document.createElement('div');
    card.appendChild(answerWrap);
    renderQuizAnswerSection(answerWrap, q, idx);

    pointsInput.addEventListener('input', (e) => { q.points = Number(e.target.value) || 1; });
    typeSelect.addEventListener('change', (e) => {
      q.type = e.target.value;
      if (q.type === 'multiple_choice') {
        q.options = q.options && q.options.length ? q.options : ['', ''];
        q.correct_answer = '';
      } else if (q.type === 'true_false') {
        q.options = [];
        q.correct_answer = 'true';
      } else {
        q.options = [];
        q.correct_answer = '';
      }
      renderQuizAnswerSection(answerWrap, q, idx);
    });
    textInput.addEventListener('input', (e) => { q.question_text = e.target.value; });

    return card;
  }

  function addQuizQuestion() {
    quizQuestionsDraft.push({ id: generateQuestionId(), type: 'multiple_choice', question_text: '', options: ['', ''], correct_answer: '', points: 10 });
    renderQuizQuestionsList();
  }

  function csvEscape(v) {
    const s = String(v == null ? '' : v);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  }

  function downloadQuizTemplate() {
    const headers = ['題型', '題目內容', '選項1', '選項2', '選項3', '選項4', '正確答案', '配分'];
    const rows = [
      ['選擇題', '台灣的首都是？', '台北', '台中', '高雄', '台南', '台北', '10'],
      ['是非題', '地球是圓的。', '', '', '', '', '正確', '10'],
      ['簡答題', '請問 1 + 1 等於多少？', '', '', '', '', '2', '10'],
    ];
    const csv = [headers, ...rows].map((r) => r.map(csvEscape).join(',')).join('\r\n');
    const blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = '測驗題目範本.csv';
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  }

  function parseQuizCsvLine(line) {
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
        cells.push(cur);
        cur = '';
      } else {
        cur += ch;
      }
    }
    cells.push(cur);
    return cells;
  }

  function quizTypeLabelToType(label) {
    const l = String(label || '').trim();
    if (l.includes('是非')) return 'true_false';
    if (l.includes('簡答')) return 'short_answer';
    return 'multiple_choice';
  }

  async function handleQuizCsvImport(file) {
    const text = await file.text();
    const cleaned = text.replace(/^﻿/, '');
    const lines = cleaned.split(/\r\n|\r|\n/).filter((l) => l.trim());
    const dataLines = lines.slice(1);
    const imported = [];
    for (const line of dataLines) {
      const row = parseQuizCsvLine(line);
      const [typeLabel, questionText, opt1, opt2, opt3, opt4, correctAnswerRaw, pointsRaw] = row;
      if (!questionText || !questionText.trim()) continue;
      const type = quizTypeLabelToType(typeLabel);
      const correctAnswerText = String(correctAnswerRaw || '').trim();
      let options = [];
      let correctAnswer = '';
      if (type === 'multiple_choice') {
        options = [opt1, opt2, opt3, opt4].map((o) => String(o || '').trim()).filter(Boolean);
        const matchedIdx = options.findIndex((o) => o === correctAnswerText);
        correctAnswer = matchedIdx >= 0 ? String(matchedIdx) : '';
      } else if (type === 'true_false') {
        correctAnswer = correctAnswerText === '正確' ? 'true' : 'false';
      } else {
        correctAnswer = correctAnswerText;
      }
      imported.push({ id: generateQuestionId(), type, question_text: questionText.trim(), options, correct_answer: correctAnswer, points: Number(pointsRaw) || 10 });
    }
    if (!imported.length) {
      showToast('找不到可匯入的題目，請確認檔案格式是否符合範本', 'error');
      return;
    }
    if (quizQuestionsDraft.length && !(await window.showConfirmModal({ icon: '⚠️', title: `匯入將會覆蓋目前已編輯的 ${quizQuestionsDraft.length} 道題目，確定要繼續嗎？` }))) return;
    quizQuestionsDraft = imported;
    renderQuizQuestionsList();
    showToast(`已成功匯入 ${imported.length} 道題目，請檢查每一題內容與正確答案是否正確無誤！`, 'success');
  }

  /** 匯出目前編輯中的題目清單（手動新增或匯入後再調整過的皆可），與 downloadQuizTemplate
   *  共用同一份欄位格式，方便老師之間互相分享題庫或跨課程重複使用。 */
  function downloadQuizQuestionsAsCsv() {
    if (!quizQuestionsDraft.length) {
      showToast('目前尚未新增任何題目可供匯出', 'error');
      return;
    }
    const typeLabels = { multiple_choice: '選擇題', true_false: '是非題', short_answer: '簡答題' };
    const headers = ['題型', '題目內容', '選項1', '選項2', '選項3', '選項4', '正確答案', '配分'];
    const rows = quizQuestionsDraft.map((q) => {
      const opts = q.type === 'multiple_choice' ? (q.options || []) : [];
      const correctAnswerText =
        q.type === 'multiple_choice'
          ? opts[Number(q.correct_answer)] ?? ''
          : q.type === 'true_false'
          ? (q.correct_answer === 'true' ? '正確' : '錯誤')
          : (q.correct_answer || '');
      return [typeLabels[q.type] || '選擇題', q.question_text, opts[0] || '', opts[1] || '', opts[2] || '', opts[3] || '', correctAnswerText, q.points];
    });
    const csv = [headers, ...rows].map((r) => r.map(csvEscape).join(',')).join('\r\n');
    const blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = '測驗題目匯出.csv';
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  }

  async function populateGroupPlanSelect() {
    const cid = courseId();
    const select = document.getElementById('select-lms-assignment-group-plan');
    select.innerHTML = '';
    if (!cid) { window.ensureCourseSelected && window.ensureCourseSelected(); return; }
    try {
      const data = await API.get(`/api/groups/${cid}`);
      (data.plans || []).forEach((p) => {
        const opt = document.createElement('option');
        opt.value = p.id;
        opt.textContent = p.name;
        select.appendChild(opt);
      });
    } catch (err) {
      // Non-critical — the select just stays empty and creation will be blocked server-side.
    }
  }

  // 「➕ 新增素材」彈窗（合併原本各自獨立的「新增小單元」與「新增教材」流程）：
  // 一次送出同時建立小單元，並視需要（有上傳檔案／填連結）接著建立教材附件。
  function openAddContentModal(unitId) {
    const unit = unitsData.find((u) => u.id === unitId);
    document.getElementById('text-lms-add-content-title').textContent = `➕ 在「${unit ? unit.title : ''}」新增內容／作業`;
    document.getElementById('btn-submit-lms-add-content').textContent = '確定新增';
    document.getElementById('input-lms-subunit-unit-id').value = unitId;
    document.getElementById('input-lms-subunit-id').value = '';
    document.getElementById('input-lms-subunit-title').value = '';
    document.getElementById('input-lms-subunit-desc').value = '';
    document.getElementById('select-lms-content-category').value = 'material';
    document.getElementById('select-lms-content-category').disabled = false;
    document.getElementById('text-lms-content-category-locked-hint').style.display = 'none';
    document.querySelectorAll('input[name="lms-submission-type"]').forEach((el) => { el.checked = el.value === 'file'; });
    document.querySelector('input[name="lms-assignment-type"][value="individual"]').checked = true;
    document.getElementById('input-lms-subunit-duedate').value = '';
    document.getElementById('input-lms-subunit-autolock').checked = false;
    document.getElementById('input-lms-subunit-publishat').value = '';
    document.getElementById('input-lms-quiz-reveal').checked = true;
    quizQuestionsDraft = [];
    renderQuizQuestionsList();
    updateSubUnitFormVisibility();
    populateGroupPlanSelect();
    document.getElementById('input-lms-content-files').value = '';
    stagedFiles = [];
    renderStagedFilesList();
    linkRowsDraft = [];
    renderLinkRowsList();
    document.getElementById('wrap-lms-edit-existing-materials').style.display = 'none';
    window.openModal('modal-lms-add-content');
  }

  function findSubUnitById(subUnitId) {
    for (const u of unitsData) {
      const su = u.subUnits.find((x) => x.id === subUnitId);
      if (su) return su;
    }
    return null;
  }

  /** 既有教材/檔案清單（編輯彈窗內用）：可個別刪除，刪除後重新整理主畫面資料並就地重繪這份清單，
   *  不需要關閉彈窗——比照既有 deleteMaterial() 的刪除邏輯，但刪除後留在彈窗內方便繼續編輯。 */
  function renderEditMaterialsList(subUnitId) {
    const wrap = document.getElementById('list-lms-edit-existing-materials');
    const su = findSubUnitById(subUnitId);
    const materials = su ? su.materials : [];
    wrap.innerHTML = '';
    if (!materials.length) {
      wrap.innerHTML = '<div style="color:var(--text-muted); font-size:0.85rem;">目前沒有附加的教材/檔案。</div>';
      return;
    }
    materials.forEach((m) => {
      const row = document.createElement('div');
      row.style.cssText = 'display:flex; align-items:center; justify-content:space-between; gap:8px; font-size:0.85rem; padding:6px 10px; border:1px solid var(--card-border); border-radius:8px;';
      const icon = m.type === 'file' ? '📄' : m.type === 'youtube' ? '▶️' : '🔗';
      const link = document.createElement('a');
      link.href = m.url;
      link.target = '_blank';
      link.rel = 'noopener';
      link.style.cssText = 'color:var(--text-main); text-decoration:none; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; flex:1;';
      link.textContent = `${icon} ${m.title}`;
      const delBtn = document.createElement('button');
      delBtn.type = 'button';
      delBtn.className = 'btn-icon';
      delBtn.textContent = '✕';
      delBtn.title = '刪除教材';
      delBtn.addEventListener('click', async () => {
        if (!(await window.showConfirmModal({ icon: '🗑️', title: `確定要刪除教材「${m.title}」嗎？`, danger: true }))) return;
        const cid = courseId();
        if (!cid) { window.ensureCourseSelected && window.ensureCourseSelected(); return; }
        try {
          await API.delete(`/api/units/${cid}/${su.unitId}/subunits/${su.id}/materials/${m.id}`);
          await load();
          renderEditMaterialsList(subUnitId);
          showToast('教材已刪除', 'success');
        } catch (err) {
          showToast(err.message, 'error');
        }
      });
      row.appendChild(link);
      row.appendChild(delBtn);
      wrap.appendChild(row);
    });
  }

  // 「✏️ 編輯」小單元：與新增共用同一個彈窗，但鎖定「這是什麼內容？」類別不可更改
  // （建立後切換類別牽涉既有繳交/測驗資料如何處理，超出本次範圍），並補上既有教材的管理清單。
  function openEditContentModal(su) {
    document.getElementById('text-lms-add-content-title').textContent = `✏️ 編輯「${su.title}」`;
    document.getElementById('btn-submit-lms-add-content').textContent = '儲存變更';
    document.getElementById('input-lms-subunit-unit-id').value = su.unitId;
    document.getElementById('input-lms-subunit-id').value = su.id;
    document.getElementById('input-lms-subunit-title').value = su.title;
    document.getElementById('input-lms-subunit-desc').value = su.description || '';
    document.getElementById('select-lms-content-category').value = su.category;
    document.getElementById('select-lms-content-category').disabled = true;
    document.getElementById('text-lms-content-category-locked-hint').style.display = 'block';
    document.querySelectorAll('input[name="lms-submission-type"]').forEach((el) => {
      el.checked = (su.submissionTypes || []).includes(el.value);
    });
    document.querySelector(`input[name="lms-assignment-type"][value="${su.assignmentType === 'group' ? 'group' : 'individual'}"]`).checked = true;
    document.getElementById('input-lms-subunit-duedate').value = su.dueDate || '';
    document.getElementById('input-lms-subunit-autolock').checked = !!su.autoLockOverdue;
    // 自訂日期時間選擇器（datepicker.js）直接吃／存 "YYYY-MM-DD HH:MM"，跟後端格式一致，不需轉換。
    document.getElementById('input-lms-subunit-publishat').value = su.publishAt || '';
    document.getElementById('input-lms-quiz-reveal').checked = su.revealAnswersAfterSubmit !== false;
    quizQuestionsDraft = su.category === 'quiz' ? JSON.parse(JSON.stringify(su.quizQuestions || [])) : [];
    renderQuizQuestionsList();
    updateSubUnitFormVisibility();
    populateGroupPlanSelect().then(() => {
      if (su.groupPlanId) document.getElementById('select-lms-assignment-group-plan').value = su.groupPlanId;
    });
    document.getElementById('input-lms-content-files').value = '';
    stagedFiles = [];
    renderStagedFilesList();
    linkRowsDraft = [];
    renderLinkRowsList();
    document.getElementById('wrap-lms-edit-existing-materials').style.display = 'block';
    renderEditMaterialsList(su.id);
    window.openModal('modal-lms-add-content');
  }

  async function submitAddContent() {
    const cid = courseId();
    if (!cid) { window.ensureCourseSelected && window.ensureCourseSelected(); return; }
    const unitId = document.getElementById('input-lms-subunit-unit-id').value;
    const editingSubUnitId = document.getElementById('input-lms-subunit-id').value;
    const isEdit = !!editingSubUnitId;
    const title = document.getElementById('input-lms-subunit-title').value.trim();
    const description = document.getElementById('input-lms-subunit-desc').value.trim();
    if (!title) {
      showToast('請輸入內容標題', 'error');
      return;
    }
    const category = getCheckedCategory();
    const payload = { title, description, publish_at: document.getElementById('input-lms-subunit-publishat').value || '' };
    if (!isEdit) payload.category = category; // 編輯時類別鎖定不可變更，不送這個欄位
    if (category === 'assignment') {
      payload.submission_types = Array.from(document.querySelectorAll('input[name="lms-submission-type"]:checked')).map((el) => el.value);
      payload.assignment_type = getCheckedAssignmentType();
      if (payload.assignment_type === 'group') {
        payload.group_plan_id = Number(document.getElementById('select-lms-assignment-group-plan').value) || null;
      }
      payload.due_date = document.getElementById('input-lms-subunit-duedate').value || '';
      payload.auto_lock_overdue = document.getElementById('input-lms-subunit-autolock').checked;
    } else if (category === 'quiz') {
      if (!quizQuestionsDraft.length) {
        showToast('請至少新增一道測驗題目', 'error');
        return;
      }
      payload.quiz_questions = quizQuestionsDraft;
      payload.reveal_answers_after_submit = document.getElementById('input-lms-quiz-reveal').checked;
      payload.due_date = document.getElementById('input-lms-subunit-duedate').value || '';
      payload.auto_lock_overdue = document.getElementById('input-lms-subunit-autolock').checked;
    }

    let subUnitId = editingSubUnitId ? Number(editingSubUnitId) : undefined;
    try {
      if (isEdit) {
        await API.put(`/api/units/${cid}/${unitId}/subunits/${subUnitId}`, payload);
      } else {
        const res = await API.post(`/api/units/${cid}/${unitId}/subunits`, payload);
        subUnitId = res.id;
      }
    } catch (err) {
      showToast(err.message, 'error');
      return;
    }

    // 小單元已建立/更新成功；接下來的附件上傳即使個別失敗也不回滾小單元本身
    // （比照全案「無跨步驟回滾」慣例），最後用 toast 匯總告知哪些附件沒上傳成功。
    const materialsUrl = `/api/units/${cid}/${unitId}/subunits/${subUnitId}/materials`;
    const failures = [];

    for (const file of stagedFiles) {
      try {
        const formData = new FormData();
        formData.append('file', file);
        formData.append('type', 'file');
        await API.postFormData(materialsUrl, formData);
      } catch (err) {
        failures.push(file.name);
      }
    }

    for (const linkRow of linkRowsDraft) {
      const linkUrl = linkRow.url.trim();
      if (!linkUrl) continue; // 略過還沒填網址的空白列，不當成失敗
      const linkTitle = linkRow.title.trim();
      try {
        await API.post(materialsUrl, { type: isYoutubeUrl(linkUrl) ? 'youtube' : 'link', url: linkUrl, title: linkTitle });
      } catch (err) {
        failures.push(linkTitle || linkUrl);
      }
    }

    window.closeModal('modal-lms-add-content');
    if (failures.length) {
      showToast(`內容已${isEdit ? '更新' : '建立'}，但有 ${failures.length} 個附件上傳失敗：${failures.join('、')}`, 'error');
    } else {
      showToast(isEdit ? '內容已更新！' : '內容新增成功！', 'success');
    }
    load();
  }

  async function toggleSubUnitHidden(su) {
    const cid = courseId();
    if (!cid) { window.ensureCourseSelected && window.ensureCourseSelected(); return; }
    try {
      await API.put(`/api/units/${cid}/${su.unitId}/subunits/${su.id}`, { is_hidden: !su.isHidden });
      load();
    } catch (err) {
      showToast(err.message, 'error');
    }
  }

  async function deleteSubUnit(su) {
    if (!(await window.showConfirmModal({ icon: '🗑️', title: `確定要刪除小單元「${su.title}」嗎？`, desc: '其下所有教材將一併刪除，此動作無法復原！', danger: true }))) return;
    const cid = courseId();
    if (!cid) { window.ensureCourseSelected && window.ensureCourseSelected(); return; }
    try {
      await API.delete(`/api/units/${cid}/${su.unitId}/subunits/${su.id}`);
      showToast('小單元已刪除', 'success');
      load();
    } catch (err) {
      showToast(err.message, 'error');
    }
  }

  // --- Material CRUD ---
  // 新增教材已併入上方 submitAddContent()（新增內容時可同時附加檔案／連結），
  // 這裡只留刪除既有教材項目的功能。

  async function deleteMaterial(su, m) {
    if (!(await window.showConfirmModal({ icon: '🗑️', title: `確定要刪除教材「${m.title}」嗎？`, danger: true }))) return;
    const cid = courseId();
    if (!cid) { window.ensureCourseSelected && window.ensureCourseSelected(); return; }
    try {
      await API.delete(`/api/units/${cid}/${su.unitId}/subunits/${su.id}/materials/${m.id}`);
      showToast('教材已刪除', 'success');
      load();
    } catch (err) {
      showToast(err.message, 'error');
    }
  }

  // --- 作業繳交與評分（教師端） ---

  let gradingSubUnit = null;

  function submissionStatusBadge(sub) {
    if (!sub || !sub.turned_in) return '<span style="color:var(--text-muted);">未繳交</span>';
    if (sub.score !== null && sub.score !== undefined) {
      const maxSuffix = sub.max_score != null ? ` / ${sub.max_score}` : '';
      return `<span style="color:var(--accent-positive);">已評分：${sub.score}${maxSuffix} 分</span>`;
    }
    if (sub.resubmit_requested) return '<span style="color:var(--accent-warning);">學生申請重新繳交中</span>';
    if (sub.locked) return '<span style="color:var(--accent-negative);">已鎖定</span>';
    if (sub.is_late) return '<span style="color:var(--accent-warning);">已繳交（遲交）</span>';
    return '<span style="color:var(--accent-info);">已繳交</span>';
  }

  function submissionContentHtml(sub) {
    if (!sub) return '';
    const parts = [];
    (sub.files || []).forEach((f) => parts.push(`<a href="${f.url}" target="_blank" rel="noopener">📄 ${escapeHtml(f.file_name)}</a>`));
    if (sub.link) parts.push(`<a href="${sub.link}" target="_blank" rel="noopener">🔗 ${escapeHtml(sub.link)}</a>`);
    if (sub.text_content) {
      parts.push(`<div style="white-space:pre-wrap; max-height:80px; overflow-y:auto; font-size:0.82rem; background:var(--nav-bg); padding:6px 8px; border-radius:6px;">${escapeHtml(sub.text_content)}</div>`);
    }
    return parts.length ? `<div style="display:flex; flex-direction:column; gap:4px; margin-top:6px; font-size:0.82rem;">${parts.join('')}</div>` : '';
  }

  // --- 提問串（Submission Comments，教師端）：師生一對一（或對小組）留言，展開後才載入 ---

  function renderCommentBubble(c) {
    const bubble = document.createElement('div');
    const isTeacher = c.author_role === 'teacher';
    bubble.style.cssText = `max-width:82%; padding:6px 10px; border-radius:var(--radius-md); font-size:0.82rem; word-break:break-word; align-self:${isTeacher ? 'flex-end' : 'flex-start'}; background:${isTeacher ? '#eef2ff' : 'var(--card-bg)'}; border:1px solid ${isTeacher ? '#c7d2fe' : 'var(--card-border)'};`;
    const roleEmoji = isTeacher ? '👩‍🏫' : '🧑‍🎓';
    bubble.innerHTML = `
      <div style="font-size:0.7rem; color:var(--text-muted); font-weight:700; margin-bottom:2px;">${roleEmoji} ${escapeHtml(c.author_name)} · ${escapeHtml(c.created_at)}</div>
      <div style="white-space:pre-wrap;">${escapeHtml(c.message)}</div>
    `;
    return bubble;
  }

  function renderCommentThreadPanel(commentsUrl, initialCount) {
    const toggleBtn = document.createElement('button');
    toggleBtn.type = 'button';
    toggleBtn.className = 'btn btn-secondary grading-comments-btn';
    toggleBtn.style.cssText = 'font-size:0.78rem; padding:5px 10px;';
    toggleBtn.textContent = initialCount > 0 ? `💬 提問串（${initialCount}）` : '💬 提問串';

    const panel = document.createElement('div');
    panel.style.cssText = 'margin-top:8px; padding-top:8px; border-top:1px dashed var(--card-border); display:none;';
    const messages = document.createElement('div');
    // 280px 比照 kyps-class SubmissionCommentThread.vue；背景沿用 --nav-bg（而非 kyps 的固定淺灰）
    // 是刻意選擇，因為教師端支援深色模式，寫死淺色會在深色模式下看起來突兀。
    messages.style.cssText = 'max-height:280px; overflow-y:auto; background:var(--nav-bg); border-radius:var(--radius-sm); padding:8px; display:flex; flex-direction:column; gap:6px;';
    panel.appendChild(messages);

    const composer = document.createElement('div');
    composer.style.cssText = 'display:flex; gap:6px; margin-top:8px;';
    const textarea = document.createElement('textarea');
    textarea.placeholder = '回覆學生...';
    textarea.style.cssText = 'flex:1; min-height:36px; max-height:80px; padding:6px 10px; border-radius:var(--radius-sm); border:1.5px solid var(--input-border); background:var(--input-bg); color:var(--input-text); font-size:0.82rem; resize:vertical; box-sizing:border-box; font-family:inherit;';
    const sendBtn = document.createElement('button');
    sendBtn.type = 'button';
    sendBtn.className = 'btn';
    sendBtn.style.cssText = 'font-size:0.78rem; padding:5px 10px;';
    sendBtn.textContent = '📤 送出';
    composer.appendChild(textarea);
    composer.appendChild(sendBtn);
    panel.appendChild(composer);

    function renderList(comments) {
      messages.innerHTML = '';
      if (!comments.length) {
        const empty = document.createElement('div');
        empty.style.cssText = 'font-size:0.8rem; color:var(--text-muted); text-align:center; padding:10px 0;';
        empty.textContent = '目前還沒有留言。';
        messages.appendChild(empty);
        return;
      }
      comments.forEach((c) => messages.appendChild(renderCommentBubble(c)));
      messages.scrollTop = messages.scrollHeight;
    }

    let loaded = false;
    toggleBtn.addEventListener('click', async () => {
      const willShow = panel.style.display === 'none';
      panel.style.display = willShow ? 'block' : 'none';
      if (willShow && !loaded) {
        loaded = true;
        try {
          renderList(await API.get(commentsUrl));
        } catch (err) {
          showToast(err.message, 'error');
        }
      }
    });

    async function send() {
      const message = textarea.value.trim();
      if (!message) return;
      sendBtn.disabled = true;
      try {
        const comments = await API.post(commentsUrl, { message });
        textarea.value = '';
        loaded = true;
        renderList(comments);
        toggleBtn.textContent = `💬 提問串（${comments.length}）`;
      } catch (err) {
        showToast(err.message, 'error');
      } finally {
        sendBtn.disabled = false;
      }
    }
    sendBtn.addEventListener('click', send);
    textarea.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        send();
      }
    });

    return { toggleBtn, panel };
  }

  function renderGradingRow(entry, isGroup) {
    const row = document.createElement('div');
    row.style.cssText = 'border:1px solid var(--card-border); border-radius: var(--radius-sm); padding: 10px 12px;';
    const sub = entry.submission;
    const label = isGroup
      ? `👥 ${escapeHtml(entry.group_name)}（${entry.member_names.map(escapeHtml).join('、')}）`
      : `${entry.student_number} 號　${escapeHtml(entry.name)}`;

    row.innerHTML = `
      <div style="display:flex; justify-content:space-between; align-items:center; gap:8px; flex-wrap:wrap;">
        <div style="font-weight:700; font-size:0.9rem;">${label}</div>
        <div style="font-size:0.82rem;">${submissionStatusBadge(sub)}</div>
      </div>
      ${submissionContentHtml(sub)}
      <div class="grading-controls" style="display:flex; gap:6px; margin-top:8px; align-items:center; flex-wrap:wrap;">
        <input type="number" class="input-control grading-score" placeholder="分數" style="width:80px;" value="${sub && sub.score !== null && sub.score !== undefined ? sub.score : ''}">
        <input type="text" class="input-control grading-feedback" placeholder="評語(可選)" style="flex:1; min-width:120px;" value="${sub && sub.feedback ? escapeHtml(sub.feedback) : ''}">
        <button type="button" class="btn grading-grade-btn" style="font-size:0.78rem; padding:5px 10px;">💾 評分</button>
        <button type="button" class="btn btn-secondary grading-lock-btn" style="font-size:0.78rem; padding:5px 10px;">${sub && sub.locked ? '🔓 解鎖' : '🔒 鎖定'}</button>
      </div>
    `;

    const idPath = isGroup ? `group/${entry.group_id}` : `${entry.student_id}`;

    const commentsUrl = `/api/units/${courseId()}/${gradingSubUnit.unitId}/subunits/${gradingSubUnit.id}/submissions/${idPath}/comments`;
    const { toggleBtn: commentsToggleBtn, panel: commentsPanel } = renderCommentThreadPanel(commentsUrl, entry.comment_count || 0);
    row.querySelector('.grading-controls').appendChild(commentsToggleBtn);
    row.appendChild(commentsPanel);

    row.querySelector('.grading-grade-btn').addEventListener('click', async () => {
      const cid = courseId();
      const scoreVal = row.querySelector('.grading-score').value;
      const feedbackVal = row.querySelector('.grading-feedback').value.trim();
      try {
        await API.post(`/api/units/${cid}/${gradingSubUnit.unitId}/subunits/${gradingSubUnit.id}/submissions/${idPath}/grade`, {
          score: scoreVal === '' ? null : Number(scoreVal),
          feedback: feedbackVal,
        });
        showToast('評分已送出', 'success');
        openGradingModal(gradingSubUnit);
      } catch (err) {
        showToast(err.message, 'error');
      }
    });

    row.querySelector('.grading-lock-btn').addEventListener('click', async () => {
      const cid = courseId();
      const nextLocked = !(sub && sub.locked);
      try {
        await API.put(`/api/units/${cid}/${gradingSubUnit.unitId}/subunits/${gradingSubUnit.id}/submissions/${idPath}/lock`, { locked: nextLocked });
        showToast(nextLocked ? '已鎖定' : '已解鎖，學生可重新繳交', 'success');
        openGradingModal(gradingSubUnit);
      } catch (err) {
        showToast(err.message, 'error');
      }
    });

    return row;
  }

  function renderGradingList(data) {
    const container = document.getElementById('list-lms-grading');
    container.innerHTML = '';
    const typeLabels = { file: '📄 檔案', text: '✏️ 文字', link: '🔗 連結' };
    const metaText = data.category === 'quiz'
      ? `✅ 線上測驗｜共 ${(data.quiz_questions || []).length} 題（自動批改）` +
        (data.due_date ? `｜期限：${data.due_date}${data.auto_lock_overdue ? '（逾期自動鎖定）' : ''}` : '')
      : `${data.assignment_type === 'group' ? '👥 小組作業' : '👤 個人作業'}｜可繳交：${(data.submission_types || []).map((t) => typeLabels[t] || t).join('、')}` +
        (data.due_date ? `｜期限：${data.due_date}${data.auto_lock_overdue ? '（逾期自動鎖定）' : ''}` : '');
    document.getElementById('text-lms-grading-meta').textContent = metaText;

    const isGroup = data.assignment_type === 'group';
    const entries = isGroup ? data.groups : data.students;
    if (!entries || !entries.length) {
      const empty = document.createElement('div');
      empty.style.cssText = 'color:var(--text-muted); font-size:0.85rem; padding: 12px 0;';
      empty.textContent = isGroup ? '此分組方案尚無小組' : '此課程尚無學生';
      container.appendChild(empty);
      return;
    }
    entries.forEach((entry) => container.appendChild(renderGradingRow(entry, isGroup)));
  }

  async function openGradingModal(su) {
    const cid = courseId();
    if (!cid) { window.ensureCourseSelected && window.ensureCourseSelected(); return; }
    const unitId = findUnitIdForSubUnit(su.id) || su.unitId;
    gradingSubUnit = { id: su.id, unitId, title: su.title };
    document.getElementById('text-lms-grading-title').textContent = `📋 ${su.title} — 作業繳交與評分`;
    try {
      const data = await API.get(`/api/units/${cid}/${unitId}/subunits/${su.id}/submissions`);
      renderGradingList(data);
      window.openModal('modal-lms-grading');
    } catch (err) {
      showToast(err.message, 'error');
    }
  }

  async function batchRequestResubmit() {
    if (!gradingSubUnit) return;
    const cid = courseId();
    if (!cid) { window.ensureCourseSelected && window.ensureCourseSelected(); return; }
    try {
      const data = await API.get(`/api/units/${cid}/${gradingSubUnit.unitId}/subunits/${gradingSubUnit.id}/submissions`);
      if (data.assignment_type === 'group') {
        showToast('小組作業請在各組列個別操作退回', 'error');
        return;
      }
      const studentIds = (data.students || []).filter((s) => s.submission && s.submission.turned_in).map((s) => s.student_id);
      if (!studentIds.length) {
        showToast('目前沒有已繳交的作業', 'error');
        return;
      }
      if (!(await window.showConfirmModal({ icon: '↩️', title: `確定要將 ${studentIds.length} 份已繳交的作業退回，要求學生重新繳交嗎？` }))) return;
      await API.post(`/api/units/${cid}/${gradingSubUnit.unitId}/subunits/${gradingSubUnit.id}/submissions/batch_request_resubmit`, {
        student_ids: studentIds,
      });
      showToast(`已退回 ${studentIds.length} 份作業`, 'success');
      openGradingModal(gradingSubUnit);
    } catch (err) {
      showToast(err.message, 'error');
    }
  }

  function bindStaticUi() {
    document.getElementById('btn-materials-toggle-edit')?.addEventListener('click', () => setEditMode(!editMode));
    document.getElementById('btn-materials-add-unit')?.addEventListener('click', toggleNewUnitInlineForm);
    document.getElementById('btn-submit-lms-unit-inline')?.addEventListener('click', submitNewUnitInline);
    document.getElementById('btn-materials-open-folder')?.addEventListener('click', openMaterialsFolder);
    document.getElementById('btn-submit-lms-add-content')?.addEventListener('click', submitAddContent);
    document.getElementById('select-lms-content-category')?.addEventListener('change', updateSubUnitFormVisibility);
    document.querySelectorAll('input[name="lms-assignment-type"]').forEach((el) => el.addEventListener('change', updateSubUnitFormVisibility));
    document.getElementById('input-lms-content-files')?.addEventListener('change', (e) => {
      // 累加而非取代：允許老師分次選檔（選一批、關掉視窗、再選另一批），配合 stagedFiles 陣列與
      // list-lms-content-files-staged 清單逐一顯示、可個別移除。
      stagedFiles = stagedFiles.concat(Array.from(e.target.files || []));
      e.target.value = '';
      renderStagedFilesList();
    });
    document.getElementById('btn-lms-content-add-link')?.addEventListener('click', addLinkRow);
    document.getElementById('btn-lms-grading-batch-resubmit')?.addEventListener('click', batchRequestResubmit);
    document.getElementById('btn-lms-quiz-add-question')?.addEventListener('click', addQuizQuestion);
    document.getElementById('btn-lms-quiz-download-template')?.addEventListener('click', downloadQuizTemplate);
    document.getElementById('btn-lms-quiz-import')?.addEventListener('click', () => document.getElementById('input-lms-quiz-import-file').click());
    document.getElementById('btn-lms-quiz-export')?.addEventListener('click', downloadQuizQuestionsAsCsv);
    document.getElementById('input-lms-quiz-import-file')?.addEventListener('change', (e) => {
      const file = e.target.files[0];
      e.target.value = '';
      if (file) handleQuizCsvImport(file);
    });
    document.getElementById('btn-lms-subunit-publishat-clear')?.addEventListener('click', () => {
      document.getElementById('input-lms-subunit-publishat').value = '';
    });
    // 「⋮」更多選項選單的點外部關閉：唯一一次註冊，每次觸發即時查詢目前開啟的選單，
    // 不會因為 materials.js 每次 render() 都重新產生 DOM 元素而重複掛監聽。
    document.addEventListener('click', () => {
      document.querySelectorAll('.unit-menu-dropdown').forEach((d) => { d.style.display = 'none'; });
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', bindStaticUi);
  } else {
    bindStaticUi();
  }

  window.LmsMaterials = {
    load,
    renderCurrent: () => {
      updateCourseTitle(courseId());
      render(unitsData, currentProgressMap);
    }
  };
})();
