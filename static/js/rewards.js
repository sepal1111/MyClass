// static/js/rewards.js - 獎勵兌換管理系統 (教師端)
(function () {
  let activeRewardsTab = 'items'; // 'items' | 'redemptions'
  let currentFilterType = 'all'; // 'all' | 'badge' | 'collectible_card' | 'physical'
  let currentFilterStatus = 'all'; // 'all' | 'requested' | 'approved_held' | 'completed' | 'rejected'

  let cachedItems = [];
  let cachedRedemptions = [];

  function getActiveCourseId() {
    if (window.currentCourseId) return window.currentCourseId;
    if (window.activeCourse && window.activeCourse.id) return window.activeCourse.id;
    return null;
  }

  function escapeHtml(str) {
    if (!str) return '';
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }

  function t(key, fallback, params) {
    if (window.I18n && typeof window.I18n.t === 'function') {
      return window.I18n.t(key, params);
    }
    return fallback;
  }

  function getTypeBadge(type) {
    switch (type) {
      case 'badge':
        return `<span class="badge" style="background:rgba(234, 179, 8, 0.15); color:#ca8a04; font-weight:700; font-size:0.75rem; padding:2px 8px; border-radius:6px;">${t('reward_filter_badge', '🏅 榮譽徽章')}</span>`;
      case 'collectible_card':
        return `<span class="badge" style="background:rgba(168, 85, 247, 0.15); color:#9333ea; font-weight:700; font-size:0.75rem; padding:2px 8px; border-radius:6px;">${t('reward_filter_collectible_card', '🎴 特殊圖卡')}</span>`;
      case 'physical':
        return `<span class="badge" style="background:rgba(59, 130, 246, 0.15); color:#2563eb; font-weight:700; font-size:0.75rem; padding:2px 8px; border-radius:6px;">${t('reward_filter_physical', '🎁 實體獎品')}</span>`;
      default:
        return `<span class="badge">${t('reward_tab_items', '獎勵品項')}</span>`;
    }
  }

  function getStatusBadge(status) {
    switch (status) {
      case 'requested':
        return `<span class="badge" style="background:rgba(249, 115, 22, 0.15); color:#ea580c; font-weight:800; font-size:0.78rem; padding:3px 10px; border-radius:8px;">${t('reward_status_requested', '📌 待教師審核')}</span>`;
      case 'approved_held':
        return `<span class="badge" style="background:rgba(59, 130, 246, 0.15); color:#2563eb; font-weight:800; font-size:0.78rem; padding:3px 10px; border-radius:8px;">${t('reward_status_approved_held', '⏳ 待領取 (點數已預扣)')}</span>`;
      case 'completed':
        return `<span class="badge" style="background:rgba(34, 197, 94, 0.15); color:#16a34a; font-weight:800; font-size:0.78rem; padding:3px 10px; border-radius:8px;">${t('reward_status_completed', '✅ 已完成 (真實扣點)')}</span>`;
      case 'rejected':
        return `<span class="badge" style="background:rgba(239, 68, 68, 0.15); color:#dc2626; font-weight:800; font-size:0.78rem; padding:3px 10px; border-radius:8px;">${t('reward_status_rejected', '❌ 已駁回')}</span>`;
      case 'cancelled':
        return `<span class="badge" style="background:rgba(100, 116, 139, 0.15); color:#475569; font-weight:800; font-size:0.78rem; padding:3px 10px; border-radius:8px;">${t('reward_status_cancelled', '↩️ 已取消 (預扣已釋放)')}</span>`;
      default:
        return `<span class="badge">${escapeHtml(status)}</span>`;
    }
  }

  // 載入並刷新獎勵資料
  async function reload() {
    const courseId = getActiveCourseId();
    if (!courseId) return;

    try {
      // 1. 取得品項
      const resItems = await API.get(`/api/rewards/${courseId}`);
      cachedItems = resItems.items || [];

      // 2. 取得兌換紀錄
      const resRedemptions = await API.get(`/api/rewards/${courseId}/redemptions`);
      cachedRedemptions = resRedemptions.redemptions || [];

      updateStats();
      renderItems();
      renderRedemptions();
    } catch (err) {
      console.error('Reload rewards failed:', err);
    }
  }

  function updateStats() {
    const totalItemsEl = document.getElementById('reward-stat-total-items');
    const pendingEl = document.getElementById('reward-stat-pending');
    const completedEl = document.getElementById('reward-stat-completed');
    const badgePendingCount = document.getElementById('badge-redemption-pending-count');

    const activeItems = cachedItems.filter((i) => i.isActive === 1).length;
    const requestedCount = cachedRedemptions.filter((r) => r.status === 'requested').length;
    const approvedHeldCount = cachedRedemptions.filter((r) => r.status === 'approved_held').length;
    const completedCount = cachedRedemptions.filter((r) => r.status === 'completed').length;

    if (totalItemsEl) totalItemsEl.textContent = activeItems;
    if (pendingEl) pendingEl.textContent = requestedCount + approvedHeldCount;
    if (completedEl) completedEl.textContent = completedCount;

    if (badgePendingCount) {
      if (requestedCount > 0) {
        badgePendingCount.textContent = requestedCount;
        badgePendingCount.style.display = 'inline-block';
      } else {
        badgePendingCount.style.display = 'none';
      }
    }
  }

  function renderItems() {
    const grid = document.getElementById('reward-items-grid');
    const empty = document.getElementById('reward-items-empty');
    if (!grid) return;

    let list = cachedItems;
    if (currentFilterType !== 'all') {
      list = list.filter((i) => i.rewardType === currentFilterType);
    }

    if (list.length === 0) {
      grid.innerHTML = '';
      if (empty) empty.style.display = 'block';
      return;
    }

    if (empty) empty.style.display = 'none';

    grid.innerHTML = list
      .map((item) => {
        const stockText = item.stock < 0 ? t('reward_stock_unlimited', '無限量') : t('reward_stock_remaining', `剩餘 ${item.stock} 件`, { count: item.stock });
        const stockColor = item.stock === 0 ? 'color:var(--accent-negative); font-weight:800;' : 'color:var(--text-muted);';
        const cardSeriesBadge = item.cardSeries
          ? `<span style="font-size:0.75rem; color:var(--primary); background:rgba(91, 124, 214, 0.12); padding:2px 6px; border-radius:4px; margin-left:4px;">${t('reward_series_prefix', '系列: ')}${escapeHtml(item.cardSeries)}</span>`
          : '';

        const activeStatusBadge =
          item.isActive === 1
            ? `<span style="font-size:0.75rem; color:var(--accent-positive); font-weight:700;">${t('reward_status_active', '🟢 上架中')}</span>`
            : `<span style="font-size:0.75rem; color:var(--text-muted); font-weight:700;">${t('reward_status_inactive', '⚪ 已下架')}</span>`;

        // 圖片樣式：徽章使用圓形，其餘使用微圓角直式/橫式
        const imgStyle = item.rewardType === 'badge' ? 'border-radius:50%; object-fit:contain;' : 'border-radius:10px; object-fit:contain;';

        return `
          <div class="glass-card" style="margin-bottom:0; padding:14px; display:flex; flex-direction:column; justify-content:space-between; border:1.5px solid var(--card-border); transition:transform 0.15s ease, box-shadow 0.15s ease;">
            <div>
              <div style="width:100%; aspect-ratio:1; background:var(--input-bg); border-radius:12px; overflow:hidden; display:flex; align-items:center; justify-content:center; margin-bottom:10px; position:relative;">
                <img src="${item.imageUrl || DEFAULT_REWARD_SVG}" alt="${escapeHtml(item.name)}" style="width:85%; height:85%; ${imgStyle}" onerror="this.onerror=null; this.src='${DEFAULT_REWARD_SVG}'">
                <div style="position:absolute; top:8px; right:8px;">
                  ${activeStatusBadge}
                </div>
              </div>
              <div style="display:flex; align-items:center; justify-content:space-between; margin-bottom:4px;">
                ${getTypeBadge(item.rewardType)}
                ${cardSeriesBadge}
              </div>
              <div style="font-size:1.05rem; font-weight:800; color:var(--text-main); margin-bottom:4px; white-space:nowrap; overflow:hidden; text-overflow:ellipsis;" title="${escapeHtml(item.name)}">
                ${escapeHtml(item.name)}
              </div>
              <div style="font-size:0.82rem; color:var(--text-muted); line-height:1.4; height:38px; overflow:hidden; text-overflow:ellipsis; display:-webkit-box; -webkit-line-clamp:2; -webkit-box-orient:vertical; margin-bottom:8px;">
                ${escapeHtml(item.description || '無詳細說明')}
              </div>
            </div>

            <div style="border-top:1px solid var(--card-border); padding-top:10px;">
              <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:10px;">
                <span style="font-size:1.15rem; font-weight:900; color:var(--primary);">⭐ ${item.pointsCost} <span style="font-size:0.8rem; font-weight:600;">${t('pts', '點')}</span></span>
                <span style="font-size:0.82rem; ${stockColor}">${stockText}</span>
              </div>
              <div style="display:flex; gap:8px;">
                <button type="button" class="btn btn-secondary btn-edit-reward-item" data-id="${item.id}" style="flex:1; font-size:0.82rem; padding:6px 10px;">${t('reward_btn_edit', '✏️ 編輯')}</button>
                <button type="button" class="btn btn-secondary btn-delete-reward-item" data-id="${item.id}" style="font-size:0.82rem; padding:6px 10px; color:var(--accent-negative); border-color:var(--accent-negative-border);">${t('reward_btn_delete', '🗑️')}</button>
              </div>
            </div>
          </div>
        `;
      })
      .join('');
  }

  function renderRedemptions() {
    const container = document.getElementById('redemptions-list-container');
    const empty = document.getElementById('redemptions-empty');
    if (!container) return;

    let list = cachedRedemptions;
    if (currentFilterStatus !== 'all') {
      list = list.filter((r) => r.status === currentFilterStatus);
    }

    if (list.length === 0) {
      container.innerHTML = '';
      if (empty) empty.style.display = 'block';
      return;
    }

    if (empty) empty.style.display = 'none';

    container.innerHTML = `
      <div style="display: flex; flex-direction: column; gap: 12px;">
        ${list
          .map((r) => {
            const studentName = r.student ? `${r.student.studentNumber}號 ${escapeHtml(r.student.name)}` : '未知學生';
            const rewardName = r.reward ? escapeHtml(r.reward.name) : '未知獎勵品項';
            const rewardImg = (r.reward && r.reward.imageUrl) ? r.reward.imageUrl : DEFAULT_REWARD_SVG;
            const cost = r.pointsSpent || 0;
            const noteText = r.requestNote ? `<div style="font-size:0.82rem; color:var(--text-muted); margin-top:4px;">${t('reward_student_note_prefix', '💬 學生備註：')}${escapeHtml(r.requestNote)}</div>` : '';
            const teacherNoteText = r.teacherNote ? `<div style="font-size:0.82rem; color:var(--primary); margin-top:2px;">${t('reward_teacher_note_prefix', '📝 教師備註：')}${escapeHtml(r.teacherNote)}</div>` : '';

            // 依狀態提供動作按鈕
            let actionButtons = '';
            if (r.status === 'requested') {
              actionButtons = `
                <div style="display:flex; gap:8px; align-items:center;">
                  <button type="button" class="btn btn-sm btn-approve-redemption" data-id="${r.id}" style="font-size:0.82rem; padding:6px 14px; background:var(--primary); color:#fff;">
                    ${t('reward_badge_btn_approve', '✅ 核准並預扣點數')}
                  </button>
                  <button type="button" class="btn btn-secondary btn-sm btn-reject-redemption" data-id="${r.id}" style="font-size:0.82rem; padding:6px 12px; color:var(--accent-negative);">
                    ${t('reward_badge_btn_reject', '❌ 駁回')}
                  </button>
                </div>
              `;
            } else if (r.status === 'approved_held') {
              actionButtons = `
                <div style="display:flex; gap:8px; align-items:center;">
                  <button type="button" class="btn btn-sm btn-fulfill-redemption" data-id="${r.id}" style="font-size:0.82rem; padding:6px 14px; background:var(--accent-positive); color:#fff; font-weight:800;">
                    ${t('reward_badge_btn_fulfill', '🎉 確認交件 (真實扣點)')}
                  </button>
                  <button type="button" class="btn btn-secondary btn-sm btn-cancel-redemption" data-id="${r.id}" style="font-size:0.82rem; padding:6px 12px; color:var(--text-muted);">
                    ${t('reward_badge_btn_cancel', '↩️ 取消/退回')}
                  </button>
                </div>
              `;
            } else if (r.status === 'completed') {
              const timeStr = r.fulfilledAt || r.createdAt;
              actionButtons = `<div style="font-size:0.82rem; color:var(--accent-positive); font-weight:700;">${t('reward_fulfilled_at', `已於 ${escapeHtml(timeStr)} 完成發放`, { time: escapeHtml(timeStr) })}</div>`;
            } else {
              actionButtons = `<div style="font-size:0.82rem; color:var(--text-muted);">${escapeHtml(r.teacherNote || '已結案')}</div>`;
            }

            return `
              <div class="glass-card" style="margin-bottom:0; padding:14px 18px; display:flex; justify-content:space-between; align-items:center; flex-wrap:wrap; gap:12px; border-left:4px solid ${
                r.status === 'requested' ? '#ea580c' : r.status === 'approved_held' ? '#2563eb' : r.status === 'completed' ? '#16a34a' : '#94a3b8'
              };">
                <div style="display:flex; align-items:center; gap:14px; min-width:240px; flex:1;">
                  <div style="width:52px; height:52px; border-radius:10px; background:var(--input-bg); overflow:hidden; display:flex; align-items:center; justify-content:center; flex-shrink:0;">
                    <img src="${rewardImg}" alt="${rewardName}" style="width:100%; height:100%; object-fit:contain;" onerror="this.onerror=null; this.src='${DEFAULT_REWARD_SVG}'">
                  </div>
                  <div>
                    <div style="display:flex; align-items:center; gap:8px; margin-bottom:3px;">
                      <span style="font-size:1.02rem; font-weight:800; color:var(--text-main);">${studentName}</span>
                      ${getStatusBadge(r.status)}
                    </div>
                    <div style="font-size:0.9rem; font-weight:700; color:var(--text-main);">
                      申請獎項：${rewardName}
                      <span style="color:var(--primary); margin-left:6px; font-weight:800;">(-${cost} 點)</span>
                    </div>
                    ${noteText}
                    ${teacherNoteText}
                    <div style="font-size:0.75rem; color:var(--text-muted); margin-top:4px;">
                      提出時間：${escapeHtml(r.createdAt)}
                    </div>
                  </div>
                </div>

                <div style="margin-left:auto;">
                  ${actionButtons}
                </div>
              </div>
            `;
          })
          .join('')}
      </div>
    `;
  }

  // --- 彈窗操作：新增 / 編輯獎勵品項 ---
  function openAddRewardModal() {
    const modal = document.getElementById('modal-reward-item-editor');
    const form = document.getElementById('form-reward-item');
    const titleEl = document.getElementById('reward-editor-title');
    if (!modal || !form) return;

    form.reset();
    document.getElementById('reward-item-id').value = '';
    if (titleEl) titleEl.textContent = t('reward_modal_title_add', '🎁 新增獎勵品項');

    document.getElementById('reward-item-unlimited-stock').checked = true;
    document.getElementById('reward-item-stock').disabled = true;
    document.getElementById('reward-item-is-active').checked = true;
    
    // 清空檔案選擇與預覽圖，強制顯示請選擇圖檔提示
    const fileInput = document.getElementById('reward-item-file');
    if (fileInput) fileInput.value = '';
    const imgEl = document.getElementById('reward-item-preview-img');
    const placeholderEl = document.getElementById('reward-img-placeholder');
    if (imgEl) {
      imgEl.src = '';
      imgEl.style.display = 'none';
    }
    if (placeholderEl) placeholderEl.style.display = 'block';

    const hintEl = document.getElementById('reward-file-hint');
    if (hintEl) {
      hintEl.textContent = t('reward_modal_file_hint_add', '⚠️ 新增品項必須上傳自訂圖檔或照片（支援 JPG、PNG、SVG、WebP）。');
      hintEl.style.color = 'var(--accent-negative)';
    }

    document.getElementById('group-reward-card-series').style.display = 'none';

    if (typeof window.openModal === 'function') {
      window.openModal('modal-reward-item-editor');
    } else {
      modal.classList.add('open');
      modal.style.display = 'flex';
    }
  }

  function openEditRewardModal(item) {
    const modal = document.getElementById('modal-reward-item-editor');
    const titleEl = document.getElementById('reward-editor-title');
    if (!modal) return;

    document.getElementById('reward-item-id').value = item.id;
    if (titleEl) titleEl.textContent = t('reward_modal_title_edit', '✏️ 編輯獎勵品項');

    document.getElementById('reward-item-name').value = item.name || '';
    document.getElementById('reward-item-type').value = item.rewardType || 'badge';
    document.getElementById('reward-item-points').value = item.pointsCost || 10;
    document.getElementById('reward-item-desc').value = item.description || '';
    document.getElementById('reward-item-card-series').value = item.cardSeries || '';
    document.getElementById('reward-item-is-active').checked = item.isActive === 1;

    if (item.stock < 0) {
      document.getElementById('reward-item-unlimited-stock').checked = true;
      document.getElementById('reward-item-stock').value = '';
      document.getElementById('reward-item-stock').disabled = true;
    } else {
      document.getElementById('reward-item-unlimited-stock').checked = false;
      document.getElementById('reward-item-stock').value = item.stock;
      document.getElementById('reward-item-stock').disabled = false;
    }

    document.getElementById('group-reward-card-series').style.display = item.rewardType === 'collectible_card' ? 'block' : 'none';

    // 編輯現有品項時顯示現有圖檔
    const fileInput = document.getElementById('reward-item-file');
    if (fileInput) fileInput.value = '';
    const imgEl = document.getElementById('reward-item-preview-img');
    const placeholderEl = document.getElementById('reward-img-placeholder');
    if (imgEl) {
      imgEl.src = item.imageUrl || '';
      imgEl.style.display = 'block';
    }
    if (placeholderEl) placeholderEl.style.display = 'none';

    const hintEl = document.getElementById('reward-file-hint');
    if (hintEl) {
      hintEl.textContent = t('reward_modal_file_hint_edit', '若無需更換圖片，可保留現有圖檔不重新選擇。');
      hintEl.style.color = 'var(--text-muted)';
    }

    if (typeof window.openModal === 'function') {
      window.openModal('modal-reward-item-editor');
    } else {
      modal.classList.add('open');
      modal.style.display = 'flex';
    }
  }

  function closeRewardModal() {
    if (typeof window.closeModal === 'function') {
      window.closeModal('modal-reward-item-editor');
    } else {
      const modal = document.getElementById('modal-reward-item-editor');
      if (modal) {
        modal.classList.remove('open');
        modal.style.display = 'none';
      }
    }
  }

  // --- 提交品項表單 ---
  async function submitRewardItem(e) {
    e.preventDefault();
    const courseId = getActiveCourseId();
    if (!courseId) {
      alert('請先選擇班級課程');
      return;
    }

    const id = document.getElementById('reward-item-id').value;
    const name = document.getElementById('reward-item-name').value.trim();
    const rewardType = document.getElementById('reward-item-type').value;
    const pointsCost = document.getElementById('reward-item-points').value;
    const isUnlimited = document.getElementById('reward-item-unlimited-stock').checked;
    const stockVal = isUnlimited ? '-1' : document.getElementById('reward-item-stock').value;
    const description = document.getElementById('reward-item-desc').value.trim();
    const cardSeries = document.getElementById('reward-item-card-series').value.trim();
    const isActive = document.getElementById('reward-item-is-active').checked ? 1 : 0;
    const fileInput = document.getElementById('reward-item-file');

    if (!name) {
      alert('請輸入獎勵品項名稱');
      return;
    }

    // 強制驗證：新增品項必須上傳自訂圖檔，不可使用預設圖
    if (!id && (!fileInput.files || !fileInput.files[0])) {
      alert('【請注意】新增獎勵品項必須上傳自訂圖檔或照片，不可使用預設圖！');
      fileInput.focus();
      return;
    }

    const formData = new FormData();
    formData.append('name', name);
    formData.append('rewardType', rewardType);
    formData.append('pointsCost', pointsCost);
    formData.append('stock', stockVal);
    formData.append('description', description);
    formData.append('cardSeries', cardSeries);
    formData.append('isActive', isActive);

    if (fileInput.files && fileInput.files[0]) {
      formData.append('image', fileInput.files[0]);
    }

    const url = id ? `/api/rewards/${courseId}/${id}` : `/api/rewards/${courseId}`;

    try {
      if (id) {
        await API.putFormData(url, formData);
      } else {
        await API.postFormData(url, formData);
      }

      closeRewardModal();
      await reload();
      alert(id ? '品項更新成功！' : '品項新增成功！');
    } catch (err) {
      alert(err.message || '儲存獎勵品項失敗');
    }
  }

  // --- 刪除品項 ---
  async function deleteRewardItem(id) {
    const courseId = getActiveCourseId();
    if (!courseId) return;

    if (!(await window.showConfirmModal({ icon: '🗑️', title: '確定要刪除或下架此獎勵品項嗎？', danger: true }))) return;

    try {
      const res = await API.delete(`/api/rewards/${courseId}/${id}`);
      alert(res.message || '已處理完成');
      await reload();
    } catch (err) {
      alert(err.message || '刪除失敗');
    }
  }

  // --- 審核實體獎品申請 (核准預扣) ---
  async function approveRedemption(redemptionId) {
    const courseId = getActiveCourseId();
    if (!courseId) return;

    if (!(await window.showConfirmModal({ icon: '✅', title: '確定要「核准」此學生的實體獎品兌換申請嗎？', desc: '核准後將會暫時預扣學生相應點數，並保留 1 個庫存。' }))) return;

    try {
      const res = await API.post(`/api/rewards/${courseId}/redemptions/${redemptionId}/approve`, {});
      alert(res.message || '申請已核准！點數已暫時預扣。');
      await reload();
    } catch (err) {
      alert(err.message || '核准失敗');
    }
  }

  // --- 確認實體獎品交件完成 (真實扣點) ---
  async function fulfillRedemption(redemptionId) {
    const courseId = getActiveCourseId();
    if (!courseId) return;

    if (!(await window.showConfirmModal({ icon: '🎁', title: '確認發放完成：學生是否已經順利拿到實體獎品？', desc: '按下確定後，系統將正式在學生成績日誌中「真實扣除點數」並結案！' }))) return;

    try {
      const res = await API.post(`/api/rewards/${courseId}/redemptions/${redemptionId}/fulfill`, {});
      alert(res.message || '實體獎品已確認交件，點數已正式扣除！');
      await reload();
    } catch (err) {
      alert(err.message || '發放交件失敗');
    }
  }

  // --- 駁回申請 ---
  async function rejectRedemption(redemptionId) {
    const courseId = getActiveCourseId();
    if (!courseId) return;

    const reason = await window.showPromptModal({ icon: '✏️', title: '請輸入駁回此申請的原因（選填）：', defaultValue: '暫時無庫存或無法兌換', multiline: true });
    if (reason === null) return;

    try {
      const res = await API.post(`/api/rewards/${courseId}/redemptions/${redemptionId}/reject`, {
        teacherNote: reason,
      });
      alert(res.message || '已駁回申請。');
      await reload();
    } catch (err) {
      alert(err.message || '操作失敗');
    }
  }

  // --- 取消預扣並退回 ---
  async function cancelRedemption(redemptionId) {
    const courseId = getActiveCourseId();
    if (!courseId) return;

    if (!(await window.showConfirmModal({ icon: '↩️', title: '確定要取消此筆發放嗎？', desc: '取消後，預扣的點數將會即時釋放歸還給學生，庫存也會自動還原。' }))) return;

    try {
      const res = await API.post(`/api/rewards/${courseId}/redemptions/${redemptionId}/cancel`, {});
      alert(res.message || '已取消發放，預扣點數已退還。');
      await reload();
    } catch (err) {
      alert(err.message || '操作失敗');
    }
  }

  // --- 事件監聽綁定 ---
  function initEvents() {
    // 切換二級標籤
    document.getElementById('btn-rewards-tab-items')?.addEventListener('click', () => {
      activeRewardsTab = 'items';
      const bItems = document.getElementById('btn-rewards-tab-items');
      const bRedemp = document.getElementById('btn-rewards-tab-redemptions');
      if (bItems) bItems.className = 'btn active';
      if (bRedemp) bRedemp.className = 'btn btn-secondary';
      const pItems = document.getElementById('rewards-panel-items');
      const pRedemp = document.getElementById('rewards-panel-redemptions');
      if (pItems) pItems.style.display = 'block';
      if (pRedemp) pRedemp.style.display = 'none';
    });

    document.getElementById('btn-rewards-tab-redemptions')?.addEventListener('click', () => {
      activeRewardsTab = 'redemptions';
      const bItems = document.getElementById('btn-rewards-tab-items');
      const bRedemp = document.getElementById('btn-rewards-tab-redemptions');
      if (bItems) bItems.className = 'btn btn-secondary';
      if (bRedemp) bRedemp.className = 'btn active';
      const pItems = document.getElementById('rewards-panel-items');
      const pRedemp = document.getElementById('rewards-panel-redemptions');
      if (pItems) pItems.style.display = 'none';
      if (pRedemp) pRedemp.style.display = 'block';
    });

    // 品項類型篩選
    document.querySelectorAll('.btn-reward-filter-type').forEach((btn) => {
      btn.addEventListener('click', () => {
        document.querySelectorAll('.btn-reward-filter-type').forEach((b) => b.classList.remove('active'));
        btn.classList.add('active');
        currentFilterType = btn.dataset.type;
        renderItems();
      });
    });

    // 審核進度篩選
    document.querySelectorAll('.btn-redemption-filter').forEach((btn) => {
      btn.addEventListener('click', () => {
        document.querySelectorAll('.btn-redemption-filter').forEach((b) => b.classList.remove('active'));
        btn.classList.add('active');
        currentFilterStatus = btn.dataset.status;
        renderRedemptions();
      });
    });

    document.getElementById('btn-refresh-redemptions')?.addEventListener('click', reload);

    // 新增品項按鈕
    document.getElementById('btn-open-add-reward-modal')?.addEventListener('click', openAddRewardModal);
    document.getElementById('btn-close-reward-editor')?.addEventListener('click', closeRewardModal);
    document.getElementById('btn-cancel-reward-editor')?.addEventListener('click', closeRewardModal);

    // 庫存 checkbox 切換
    document.getElementById('reward-item-unlimited-stock')?.addEventListener('change', (e) => {
      const stockInput = document.getElementById('reward-item-stock');
      if (stockInput) {
        stockInput.disabled = e.target.checked;
        if (e.target.checked) stockInput.value = '';
      }
    });

    // 品項種類切換時顯示/隱藏圖卡系列欄位
    document.getElementById('reward-item-type')?.addEventListener('change', (e) => {
      const seriesGroup = document.getElementById('group-reward-card-series');
      if (seriesGroup) {
        seriesGroup.style.display = e.target.value === 'collectible_card' ? 'block' : 'none';
      }
    });

    // 圖片即時預覽
    document.getElementById('reward-item-file')?.addEventListener('change', (e) => {
      const file = e.target.files && e.target.files[0];
      const img = document.getElementById('reward-item-preview-img');
      const placeholder = document.getElementById('reward-img-placeholder');
      if (file) {
        const reader = new FileReader();
        reader.onload = (evt) => {
          if (img) {
            img.src = evt.target.result;
            img.style.display = 'block';
          }
          if (placeholder) placeholder.style.display = 'none';
        };
        reader.readAsDataURL(file);
      } else {
        const id = document.getElementById('reward-item-id').value;
        if (!id) {
          if (img) {
            img.src = '';
            img.style.display = 'none';
          }
          if (placeholder) placeholder.style.display = 'block';
        }
      }
    });

    // 表單提交
    document.getElementById('form-reward-item')?.addEventListener('submit', submitRewardItem);

    // 品項網格點擊事件代理 (編輯 / 刪除)
    document.getElementById('reward-items-grid')?.addEventListener('click', (e) => {
      const editBtn = e.target.closest('.btn-edit-reward-item');
      if (editBtn) {
        const id = Number(editBtn.dataset.id);
        const item = cachedItems.find((i) => i.id === id);
        if (item) openEditRewardModal(item);
        return;
      }
      const delBtn = e.target.closest('.btn-delete-reward-item');
      if (delBtn) {
        deleteRewardItem(Number(delBtn.dataset.id));
        return;
      }
    });

    // 審核台按鈕事件代理 (核准 / 發放交件 / 駁回 / 取消)
    document.getElementById('redemptions-list-container')?.addEventListener('click', (e) => {
      const approveBtn = e.target.closest('.btn-approve-redemption');
      if (approveBtn) {
        approveRedemption(Number(approveBtn.dataset.id));
        return;
      }
      const fulfillBtn = e.target.closest('.btn-fulfill-redemption');
      if (fulfillBtn) {
        fulfillRedemption(Number(fulfillBtn.dataset.id));
        return;
      }
      const rejectBtn = e.target.closest('.btn-reject-redemption');
      if (rejectBtn) {
        rejectRedemption(Number(rejectBtn.dataset.id));
        return;
      }
      const cancelBtn = e.target.closest('.btn-cancel-redemption');
      if (cancelBtn) {
        cancelRedemption(Number(cancelBtn.dataset.id));
        return;
      }
    });
  }

  // 對外公開
  window.RewardsManager = {
    reload,
    openAddRewardModal,
  };

  // 初始化：確保無論何時載入都能正確綁定事件
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initEvents);
  } else {
    initEvents();
  }
})();
