// MyClass 教師端：分組方案與組別
// 由 static/js/app.js 拆出（2026-10-31，原第 2731–3222 行），程式內容未變更。
// 所有 static/js/app.js 與 static/js/app/*.js 共用同一個全域範圍（一般 <script>，不是模組），載入順序見 static/index.html。


// --- Grouping Pane & Drag & Drop ---
async function loadGroupingData(targetPlanId) {
  if (!AppState.currentCourseId) {
    renderEmptyCourseNotice(document.getElementById('group-columns-container'));
    return;
  }
  try {
    const planParam = targetPlanId || AppState.currentGroupPlanId;
    const url = `/api/groups/${AppState.currentCourseId}` + (planParam ? `?plan_id=${planParam}` : '');
    const data = await API.get(url);
    renderGroupColumns(data);
  } catch (err) {
    console.error('Grouping load error:', err);
  }
}

function renderGroupColumns(data) {
  const container = document.getElementById('group-columns-container');
  if (!container) return;
  container.innerHTML = '';

  const plans = data.plans || [];
  const currentPlan = data.current_plan || null;
  AppState.groupPlans = plans;
  AppState.currentGroupPlanId = currentPlan ? currentPlan.id : null;
  const activePlan = plans.find(p => p.is_active);
  AppState.activeGroupPlanId = activePlan ? activePlan.id : AppState.currentGroupPlanId;

  // Render Plan Selector Dropdown & Active Indicator
  const planSelect = document.getElementById('group-plan-select');
  if (planSelect) {
    planSelect.innerHTML = '';
    plans.forEach(p => {
      const opt = document.createElement('option');
      opt.value = p.id;
      opt.textContent = (p.is_active ? '⭐ ' : '') + p.name;
      if (currentPlan && p.id === currentPlan.id) opt.selected = true;
      planSelect.appendChild(opt);
    });
  }

  const activeBadge = document.getElementById('group-plan-active-badge');
  const btnSetActive = document.getElementById('btn-set-active-group-plan');
  if (activeBadge && btnSetActive) {
    const isCurrentActive = currentPlan && currentPlan.is_active;
    activeBadge.style.display = isCurrentActive ? 'inline-block' : 'none';
    btnSetActive.style.display = isCurrentActive ? 'none' : 'inline-block';
  }

  const groups = data.groups || [];
  const unassigned = data.unassigned || [];
  const realGroups = groups.filter(g => g && g.id);
  AppState.groups = realGroups;
  if (window.TeachingToolkit) {
    window.TeachingToolkit.luckyDraw.setGroups(realGroups);
  }

  const isEn = window.I18n && window.I18n.getLanguage() === 'en';
  const t = (k, p) => window.I18n ? window.I18n.t(k, p) : k;

  // Render unassigned group if exists
  if (unassigned.length > 0) {
    groups.unshift({
      id: null,
      group_name: t('grouping_unassigned_name'),
      students: unassigned
    });
  }

  groups.forEach((g, idx) => {
    const col = document.createElement('div');
    col.className = 'group-column';
    col.dataset.groupId = g.id || '';

    const isUnassigned = !g.id;
    const headerIcon = isUnassigned 
      ? '<span>👥</span>' 
      : `<img src="${getGroupAvatarSrc(g, idx)}" alt="${g.group_name}" style="width: 26px; height: 26px; object-fit: contain;">`;

    const countText = isEn ? `${(g.students || []).length} students` : `${(g.students || []).length} 人`;

    col.innerHTML = `
      <div class="group-header" style="display: flex; align-items: center; justify-content: space-between; padding: 10px 12px;">
        <div class="group-header-info" style="display: flex; align-items: center; gap: 8px; flex: 1; min-width: 0; cursor: ${isUnassigned ? 'default' : 'pointer'};" title="${isUnassigned ? '' : '點擊自訂小組名稱與圖示'}">
          <div style="width: 28px; height: 28px; display: flex; align-items: center; justify-content: center; flex-shrink: 0;">
            ${headerIcon}
          </div>
          <span style="font-weight: 700; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 0.95rem;">${g.group_name}</span>
        </div>
        <div style="display: flex; align-items: center; gap: 6px; flex-shrink: 0;">
          <span style="font-size: 0.8rem; color: var(--text-muted);">${countText}</span>
          ${!isUnassigned ? `<button class="btn-icon btn-edit-group" title="自訂小組名稱與圖示" style="font-size: 0.85rem; padding: 3px 6px; background: rgba(255,255,255,0.08); border-radius: 6px; border: 1px solid var(--card-border);">⚙️</button>` : ''}
        </div>
      </div>
      <div class="group-students-list" style="display: flex; flex-direction: column; gap: 8px; flex: 1; padding: 8px;"></div>
    `;

    if (!isUnassigned) {
      const editBtn = col.querySelector('.btn-edit-group');
      const headerInfo = col.querySelector('.group-header-info');
      if (editBtn) editBtn.addEventListener('click', (e) => { e.stopPropagation(); openEditGroupModal(g); });
      if (headerInfo) headerInfo.addEventListener('click', () => openEditGroupModal(g));
    }

    const listEl = col.querySelector('.group-students-list');

    (g.students || []).forEach(s => {
      const card = document.createElement('div');
      card.className = 'student-card';
      card.style.flexDirection = 'row';
      card.style.justifyContent = 'space-between';
      card.style.padding = '8px 12px';
      card.draggable = true;
      card.dataset.studentId = s.id;
      const numText = isEn ? `No. ${s.student_number}` : `${s.student_number}號`;
      const isLeader = !!s.is_leader;
      const leaderTitle = isLeader ? t('group_unset_leader_title') : t('group_set_leader_title');
      const leaderBtnHtml = !isUnassigned ? `
        <button type="button" class="btn-group-leader-toggle ${isLeader ? 'is-leader' : 'not-leader'}" title="${leaderTitle}" style="margin-left: 6px;">
          👑${isLeader ? `<span class="leader-badge-pill" style="margin-left: 2px;">${t('group_leader_badge')}</span>` : ''}
        </button>
      ` : '';

      card.innerHTML = `
        <div style="display: flex; align-items: center; gap: 8px; flex: 1; min-width: 0;">
          <div style="width: 24px; height: 24px; border-radius: 50%; overflow: hidden; flex-shrink: 0;">
            ${getStudentAvatarImgHtml(s)}
          </div>
          <span style="font-weight: bold; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">${numText} ${getStudentDisplayName(s)}</span>
          ${leaderBtnHtml}
        </div>
        <span style="cursor: grab; color: var(--text-muted); margin-left: 8px;">≡</span>
      `;

      if (!isUnassigned) {
        const leaderBtn = card.querySelector('.btn-group-leader-toggle');
        if (leaderBtn) {
          leaderBtn.addEventListener('click', async (e) => {
            e.stopPropagation();
            try {
              const newLeaderStudentId = isLeader ? null : s.id;
              await api(`/api/groups/${AppState.currentCourseId}/set-leader`, 'POST', {
                plan_id: currentPlan ? currentPlan.id : undefined,
                group_id: g.id,
                student_id: newLeaderStudentId
              });
              showToast(isLeader ? '已取消小組長' : `已指派 ${getStudentDisplayName(s)} 為小組長！`, 'success');
              loadGroupingData();
            } catch (err) {
              showToast(err.message, 'error');
            }
          });
        }
      }

      card.addEventListener('dragstart', (e) => {
        e.dataTransfer.setData('text/plain', s.id);
        card.style.opacity = '0.5';
      });

      card.addEventListener('dragend', () => {
        card.style.opacity = '1';
      });

      listEl.appendChild(card);
    });

    // Drag Over & Drop Events on Column
    col.addEventListener('dragover', (e) => {
      e.preventDefault();
      col.classList.add('drag-over');
    });

    col.addEventListener('dragleave', () => {
      col.classList.remove('drag-over');
    });

    col.addEventListener('drop', async (e) => {
      e.preventDefault();
      col.classList.remove('drag-over');
      const studentId = e.dataTransfer.getData('text/plain');
      if (!studentId) return;

      const targetGroupId = g.id ? parseInt(g.id) : null;
      try {
        await API.put(`/api/groups/${AppState.currentCourseId}/drag`, {
          plan_id: AppState.currentGroupPlanId,
          student_id: parseInt(studentId),
          group_id: targetGroupId
        });
        loadGroupingData(AppState.currentGroupPlanId);
      } catch (err) {
        alert(`拖曳調整組別失敗：${err.message}`);
      }
    });

    container.appendChild(col);
  });
}

// --- Group Plans Management Functions ---
function openCreateGroupPlanModal(copyCurrent = false) {
  if (!ensureCourseSelected()) return;
  const selectCopy = document.getElementById('select-copy-from-plan');
  const nameInput = document.getElementById('input-create-plan-name');
  if (selectCopy) {
    const isEn = window.I18n && window.I18n.getLanguage() === 'en';
    selectCopy.innerHTML = `<option value="">${isEn ? 'Do not copy (blank mode)' : '不複製 (建立空白模式)'}</option>`;
    (AppState.groupPlans || []).forEach(p => {
      const opt = document.createElement('option');
      opt.value = p.id;
      opt.textContent = `${p.is_active ? '⭐ ' : ''}${p.name}`;
      if (copyCurrent && p.id === AppState.currentGroupPlanId) {
        opt.selected = true;
      }
      selectCopy.appendChild(opt);
    });
  }

  const currentPlan = (AppState.groupPlans || []).find(p => p.id === AppState.currentGroupPlanId);
  if (nameInput) {
    if (copyCurrent && currentPlan) {
      nameInput.value = `${currentPlan.name} (複製)`;
    } else {
      nameInput.value = '';
    }
  }

  openModal('modal-create-group-plan');
}

async function submitCreateGroupPlan() {
  const nameInput = document.getElementById('input-create-plan-name');
  const selectCopy = document.getElementById('select-copy-from-plan');
  const name = nameInput ? nameInput.value.trim() : '';
  if (!name) {
    alert(window.I18n && window.I18n.getLanguage() === 'en' ? 'Please enter a mode name!' : '請輸入分組模式名稱！');
    return;
  }
  const copyFromId = selectCopy && selectCopy.value ? parseInt(selectCopy.value) : null;

  try {
    const res = await API.post(`/api/groups/${AppState.currentCourseId}/plans`, {
      name: name,
      copy_from_plan_id: copyFromId
    });
    closeModal('modal-create-group-plan');
    showToast(res.message || '分組模式建立成功！', 'positive');
    await loadGroupingData(res.id);
  } catch (err) {
    alert(`建立分組模式失敗：${err.message}`);
  }
}

function openRenameGroupPlanModal() {
  const currentPlan = (AppState.groupPlans || []).find(p => p.id === AppState.currentGroupPlanId);
  if (!currentPlan) return;
  const nameInput = document.getElementById('input-rename-plan-name');
  if (nameInput) nameInput.value = currentPlan.name;
  openModal('modal-rename-group-plan');
}

async function submitRenameGroupPlan() {
  const nameInput = document.getElementById('input-rename-plan-name');
  const name = nameInput ? nameInput.value.trim() : '';
  if (!name) {
    alert(window.I18n && window.I18n.getLanguage() === 'en' ? 'Please enter a mode name!' : '請輸入分組模式名稱！');
    return;
  }

  try {
    await API.put(`/api/groups/${AppState.currentCourseId}/plans/${AppState.currentGroupPlanId}`, {
      name: name
    });
    closeModal('modal-rename-group-plan');
    showToast('分組模式名稱已更新！', 'positive');
    await loadGroupingData(AppState.currentGroupPlanId);
  } catch (err) {
    alert(`更新分組模式名稱失敗：${err.message}`);
  }
}

async function setActiveGroupPlan() {
  if (!AppState.currentGroupPlanId) return;
  const currentPlan = (AppState.groupPlans || []).find(p => p.id === AppState.currentGroupPlanId);
  const planName = currentPlan ? currentPlan.name : '';

  try {
    await API.put(`/api/groups/${AppState.currentCourseId}/plans/${AppState.currentGroupPlanId}`, {
      is_active: true
    });
    const t = (k, p) => window.I18n ? window.I18n.t(k, p) : k;
    showToast(t('group_plan_activated_toast', { name: planName }), 'positive');
    await loadGroupingData(AppState.currentGroupPlanId);
    loadDashboardData(true);
    refreshProjectionData(true);
  } catch (err) {
    alert(`設為生效模式失敗：${err.message}`);
  }
}

async function confirmDeleteGroupPlan() {
  if (!AppState.currentGroupPlanId) return;
  if ((AppState.groupPlans || []).length <= 1) {
    const t = (k) => window.I18n ? window.I18n.t(k) : k;
    alert(t('group_plan_delete_min_alert'));
    return;
  }

  const currentPlan = (AppState.groupPlans || []).find(p => p.id === AppState.currentGroupPlanId);
  const planName = currentPlan ? currentPlan.name : '';
  const t = (k, p) => window.I18n ? window.I18n.t(k, p) : k;

  if (!await showConfirmModal({
    icon: '🗑️',
    danger: true,
    title: isEn ? 'Delete Grouping Plan' : '刪除分組模式確認',
    desc: t('group_plan_delete_confirm', { name: planName }),
    confirmText: isEn ? 'Delete' : '確定刪除',
    cancelText: isEn ? 'Cancel' : '取消'
  })) return;

  try {
    const res = await API.delete(`/api/groups/${AppState.currentCourseId}/plans/${AppState.currentGroupPlanId}`);
    showToast(res.message || '分組模式已刪除！', 'positive');
    AppState.currentGroupPlanId = null;
    await loadGroupingData();
    loadDashboardData(true);
    refreshProjectionData(true);
  } catch (err) {
    alert(`刪除分組模式失敗：${err.message}`);
  }
}

// --- Group Customization / Modal Functions ---
let currentEditingGroup = null;
let currentSelectedGroupIcon = null;
let currentPendingGroupIconFile = null;

function openAddGroupModal() {
  if (!ensureCourseSelected()) return;
  currentEditingGroup = null;
  currentPendingGroupIconFile = null;

  // 1. Gather all currently used icons in this course
  const usedIcons = new Set(
    (AppState.groups || [])
      .map(g => g.icon_url || getGroupAvatarSrc(g))
      .filter(Boolean)
  );

  // 2. Filter available unused animal icons
  const availableAnimals = ANIMAL_ICONS_LIST
    .map(name => `/static/pic/animals/${name}.png`)
    .filter(url => !usedIcons.has(url));

  let pickedIconUrl;
  if (availableAnimals.length > 0) {
    const rIdx = Math.floor(Math.random() * availableAnimals.length);
    pickedIconUrl = availableAnimals[rIdx];
  } else {
    const rIdx = Math.floor(Math.random() * ANIMAL_ICONS_LIST.length);
    pickedIconUrl = `/static/pic/animals/${ANIMAL_ICONS_LIST[rIdx]}.png`;
  }

  currentSelectedGroupIcon = pickedIconUrl;
  const nextNum = (AppState.groups || []).length + 1;
  const isEn = window.I18n && window.I18n.getLanguage() === 'en';

  document.getElementById('modal-group-title').textContent = window.I18n ? window.I18n.t('group_modal_title') : '➕ 新增自訂小組';
  document.getElementById('edit-group-id').value = '';
  document.getElementById('edit-group-name').value = isEn ? `Group ${nextNum}` : `第 ${nextNum} 組`;
  document.getElementById('edit-group-icon-preview').src = currentSelectedGroupIcon;
  document.getElementById('edit-group-icon-file').value = '';
  document.getElementById('btn-delete-group').style.display = 'none';

  updatePresetIconSelection(currentSelectedGroupIcon);
  openModal('modal-edit-group');
}

function openEditGroupModal(group) {
  currentEditingGroup = group;
  currentPendingGroupIconFile = null;
  currentSelectedGroupIcon = group.icon_url || getGroupAvatarSrc(group);

  const prefix = window.I18n ? window.I18n.t('group_modal_title') : '🎨 自訂小組設定';
  document.getElementById('modal-group-title').textContent = `${prefix} - ${group.group_name}`;
  document.getElementById('edit-group-id').value = group.id;
  document.getElementById('edit-group-name').value = group.group_name;
  document.getElementById('edit-group-icon-preview').src = currentSelectedGroupIcon;
  document.getElementById('edit-group-icon-file').value = '';
  document.getElementById('btn-delete-group').style.display = 'inline-block';

  updatePresetIconSelection(currentSelectedGroupIcon);
  openModal('modal-edit-group');
}

function updatePresetIconSelection(activeSrc) {
  document.querySelectorAll('.group-preset-icon-btn').forEach(btn => {
    if (activeSrc && btn.dataset.icon === activeSrc) {
      btn.style.borderColor = 'var(--primary-light)';
      btn.style.background = 'rgba(154, 134, 196, 0.25)';
      btn.style.boxShadow = '0 0 8px rgba(154, 134, 196, 0.4)';
    } else {
      btn.style.borderColor = 'var(--card-border)';
      btn.style.background = 'rgba(255,255,255,0.05)';
      btn.style.boxShadow = 'none';
    }
  });
}

async function confirmSaveGroup() {
  const groupId = document.getElementById('edit-group-id').value;
  const name = document.getElementById('edit-group-name').value.trim();
  if (!name) {
    alert('請輸入小組名稱！');
    return;
  }

  const submitBtn = document.getElementById('btn-save-group-submit');
  submitBtn.disabled = true;
  submitBtn.textContent = '儲存中...';

  try {
    if (!groupId) {
      // 1. Create new group
      const res = await API.post(`/api/groups/${AppState.currentCourseId}`, {
        plan_id: AppState.currentGroupPlanId,
        group_name: name,
        icon_url: currentPendingGroupIconFile ? null : currentSelectedGroupIcon
      });
      const newGroupId = res.id;

      if (currentPendingGroupIconFile && newGroupId) {
        const formData = new FormData();
        formData.append('file', currentPendingGroupIconFile);
        await API.postFormData(`/api/groups/${AppState.currentCourseId}/${newGroupId}/upload_icon`, formData);
      }
      showToast(`小組「${name}」新增成功！`, 'positive');
    } else {
      // 2. Update existing group
      if (currentPendingGroupIconFile) {
        const formData = new FormData();
        formData.append('file', currentPendingGroupIconFile);
        const upData = await API.postFormData(`/api/groups/${AppState.currentCourseId}/${groupId}/upload_icon`, formData);
        currentSelectedGroupIcon = upData.icon_url;
      }

      await API.put(`/api/groups/${AppState.currentCourseId}/${groupId}`, {
        group_name: name,
        icon_url: currentSelectedGroupIcon
      });
      showToast(`小組「${name}」設定已更新！`, 'positive');
    }

    closeModal('modal-edit-group');
    loadGroupingData(AppState.currentGroupPlanId);
    loadDashboardData(true);
    refreshProjectionData(true);
  } catch (err) {
    alert(`儲存小組失敗：${err.message}`);
  } finally {
    submitBtn.disabled = false;
    submitBtn.textContent = '💾 儲存設定';
  }
}

async function confirmDeleteGroup() {
  const groupId = document.getElementById('edit-group-id').value;
  if (!groupId) return;
  const isEn = window.I18n && window.I18n.getLanguage() === 'en';
  if (!await showConfirmModal({
    icon: '🗑️',
    danger: true,
    title: isEn ? 'Delete Group' : '刪除小組確認',
    desc: isEn ? 'Are you sure you want to delete this group? Members will be moved to Unassigned.' : '確定要刪除此小組嗎？組內成員將會移至「未分組」區。',
    confirmText: isEn ? 'Delete' : '確定刪除',
    cancelText: isEn ? 'Cancel' : '取消'
  })) return;

  try {
    await API.delete(`/api/groups/${AppState.currentCourseId}/${groupId}`);
    showToast('小組已成功刪除！', 'positive');
    closeModal('modal-edit-group');
    loadGroupingData(AppState.currentGroupPlanId);
    loadDashboardData(true);
    refreshProjectionData(true);
  } catch (err) {
    alert(`刪除小組失敗：${err.message}`);
  }
}
