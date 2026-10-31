// MyClass 學生端：獎勵商店、徽章與兌換
// 由 static/js/student.js 拆出（2026-10-31，原第 2263–2625 行），程式內容未變更；縮排保留原樣。
// student.js 與 static/js/student/*.js 共用頁面的全域範圍（一般 <script>），載入順序見 static/student.html。


  // ==========================================================================
  // 獎勵兌換商城、榮譽徽章館、特殊圖卡圖鑑冊、實體進度追蹤模組
  // ==========================================================================
  let storeItemsCache = [];
  let storeFilterType = 'all';
  let myBadgesCache = [];
  let myCardsCache = [];
  let myPhysicalCache = [];
  let currentRedeemingItem = null;
  let currentUserAvailablePoints = 0;

  async function loadRewardsStoreAndCollection() {
    try {
      const [storeRes, colRes] = await Promise.all([
        api('/api/student/rewards/items'),
        api('/api/student/rewards/my-collection'),
      ]);

      storeItemsCache = storeRes.items || [];
      currentUserAvailablePoints = storeRes.available_points || 0;

      const availEl = document.getElementById('scoreAvailableValue');
      const heldEl = document.getElementById('scoreHeldValue');
      const storeBadge = document.getElementById('storeUserPointsBadge');
      if (availEl) availEl.textContent = storeRes.available_points;
      if (heldEl) heldEl.textContent = storeRes.held_points || 0;
      if (storeBadge) storeBadge.textContent = storeRes.available_points;

      myBadgesCache = colRes.badges || [];
      myCardsCache = colRes.cards || [];
      myPhysicalCache = colRes.physical || [];

      renderStoreGrid();
      renderBadgesShowcase();
      renderCollectibleCards();
      renderPhysicalTracking();
    } catch (err) {
      console.warn('loadRewardsStoreAndCollection error:', err);
    }
  }

  function renderStoreGrid() {
    const grid = document.getElementById('studentStoreGrid');
    const empty = document.getElementById('studentStoreEmpty');
    if (!grid) return;

    let items = storeItemsCache;
    if (storeFilterType !== 'all') {
      items = items.filter((i) => i.reward_type === storeFilterType);
    }

    if (items.length === 0) {
      grid.innerHTML = '';
      if (empty) empty.style.display = 'block';
      return;
    }

    if (empty) empty.style.display = 'none';

    grid.innerHTML = items
      .map((item) => {
        let tagHtml = '';
        let imgStyle = 'border-radius:10px;';
        if (item.reward_type === 'badge') {
          tagHtml = '<span style="font-size:0.7rem; color:#ca8a04; background:rgba(234, 179, 8, 0.15); padding:2px 6px; border-radius:4px; font-weight:700;">🏅 徽章</span>';
          imgStyle = 'border-radius:50%; box-shadow:0 2px 8px rgba(234, 179, 8, 0.25);';
        } else if (item.reward_type === 'collectible_card') {
          tagHtml = '<span style="font-size:0.7rem; color:#9333ea; background:rgba(168, 85, 247, 0.15); padding:2px 6px; border-radius:4px; font-weight:700;">🎴 圖卡</span>';
          imgStyle = 'border-radius:8px;';
        } else {
          tagHtml = '<span style="font-size:0.7rem; color:#2563eb; background:rgba(59, 130, 246, 0.15); padding:2px 6px; border-radius:4px; font-weight:700;">🎁 實體</span>';
        }

        // 按鈕邏輯
        let btnHtml = '';
        if (item.already_owned) {
          btnHtml = `<button type="button" class="btn btn-secondary" disabled style="width:100%; font-size:0.8rem; padding:6px; background:#f1f5f9; color:var(--text-muted); cursor:not-allowed;">✓ 已獲得</button>`;
        } else if (item.is_out_of_stock) {
          btnHtml = `<button type="button" class="btn btn-secondary" disabled style="width:100%; font-size:0.8rem; padding:6px; background:#f1f5f9; color:var(--text-muted); cursor:not-allowed;">已換完</button>`;
        } else if (!item.can_afford) {
          const diff = item.points_cost - currentUserAvailablePoints;
          btnHtml = `<button type="button" class="btn btn-secondary" disabled style="width:100%; font-size:0.75rem; padding:6px; background:#f1f5f9; color:var(--text-muted); cursor:not-allowed;">差 ${diff} 點</button>`;
        } else {
          const btnText = item.reward_type === 'physical' ? '申請兌換' : '立即兌換';
          btnHtml = `<button type="button" class="btn btn-store-redeem" data-item-id="${item.id}" style="width:100%; font-size:0.82rem; padding:6px; background:var(--primary); color:#fff; font-weight:800; border-radius:var(--radius-md);">${btnText}</button>`;
        }

        return `
          <div class="student-card store-item-card" style="margin-bottom:0; padding:10px; display:flex; flex-direction:column; justify-content:space-between; text-align:center; border:1px solid var(--card-border);">
            <div>
              <div style="width:100%; aspect-ratio:1; background:#f8fafc; border-radius:10px; overflow:hidden; display:flex; align-items:center; justify-content:center; margin-bottom:8px;">
                <img src="${item.image_url || getGiftPlaceholderSvg('🎁')}" alt="${escapeHtml(item.name)}" style="width:85%; height:85%; object-fit:contain; ${imgStyle}" onerror="this.onerror=null; this.src=getGiftPlaceholderSvg('🎁')">
              </div>
              <div style="display:flex; justify-content:center; margin-bottom:4px;">
                ${tagHtml}
              </div>
              <div style="font-weight:800; font-size:0.86rem; color:var(--text-main); white-space:nowrap; overflow:hidden; text-overflow:ellipsis; margin-bottom:2px;" title="${escapeHtml(item.name)}">
                ${escapeHtml(item.name)}
              </div>
              <div style="font-weight:900; font-size:0.95rem; color:var(--primary); margin-bottom:8px;">
                ⭐ ${item.points_cost} <span style="font-size:0.75rem; font-weight:600;">點</span>
              </div>
            </div>
            <div>
              ${btnHtml}
            </div>
          </div>
        `;
      })
      .join('');
  }

  function renderBadgesShowcase() {
    const grid = document.getElementById('studentBadgesGrid');
    const empty = document.getElementById('studentBadgesEmpty');
    const total = document.getElementById('badgeOwnedTotal');
    if (!grid) return;

    if (total) total.textContent = `共 ${myBadgesCache.length} 枚`;

    if (myBadgesCache.length === 0) {
      grid.innerHTML = '';
      if (empty) empty.style.display = 'block';
      return;
    }

    if (empty) empty.style.display = 'none';

    grid.innerHTML = myBadgesCache
      .map((b) => {
        return `
          <div class="my-badge-item" data-badge-id="${b.id}" style="cursor:pointer; display:flex; flex-direction:column; align-items:center;" title="點擊放大徽章">
            <div style="width:68px; height:68px; border-radius:50%; background:linear-gradient(135deg, #fef08a 0%, #facc15 50%, #ca8a04 100%); padding:3px; box-shadow:0 4px 14px rgba(202, 138, 4, 0.3); margin-bottom:6px; transition:transform 0.15s ease;">
              <div style="width:100%; height:100%; border-radius:50%; background:#fff; overflow:hidden; display:flex; align-items:center; justify-content:center;">
                <img src="${b.image_url || getGiftPlaceholderSvg('🎖️')}" alt="${escapeHtml(b.name)}" style="width:85%; height:85%; object-fit:contain;" onerror="this.onerror=null; this.src=getGiftPlaceholderSvg('🎖️')">
              </div>
            </div>
            <div style="font-weight:800; font-size:0.78rem; color:var(--text-main); white-space:nowrap; overflow:hidden; text-overflow:ellipsis; max-width:85px;">
              ${escapeHtml(b.name)}
            </div>
          </div>
        `;
      })
      .join('');
  }

  function renderCollectibleCards() {
    const grid = document.getElementById('studentCardsGrid');
    const empty = document.getElementById('studentCardsEmpty');
    const total = document.getElementById('cardsOwnedTotal');
    if (!grid) return;

    if (total) total.textContent = `共 ${myCardsCache.length} 張`;

    if (myCardsCache.length === 0) {
      grid.innerHTML = '';
      if (empty) empty.style.display = 'block';
      return;
    }

    if (empty) empty.style.display = 'none';

    grid.innerHTML = myCardsCache
      .map((c) => {
        return `
          <div class="my-collectible-card-item" data-card-id="${c.id}" style="background:var(--card-bg); border:1px solid var(--card-border); border-radius:var(--radius-md); padding:8px; text-align:center; cursor:pointer; box-shadow:var(--shadow-xs); transition:transform 0.15s ease;" title="點擊放大觀看圖卡">
            <div style="width:100%; aspect-ratio:1; background:#f8fafc; border-radius:6px; overflow:hidden; display:flex; align-items:center; justify-content:center; margin-bottom:6px;">
              <img src="${c.image_url || getGiftPlaceholderSvg('🃏')}" alt="${escapeHtml(c.name)}" style="width:90%; height:90%; object-fit:contain;" onerror="this.onerror=null; this.src=getGiftPlaceholderSvg('🃏')">
            </div>
            <div style="font-size:0.7rem; color:var(--primary); background:rgba(91, 124, 214, 0.1); padding:1px 4px; border-radius:4px; margin-bottom:3px; white-space:nowrap; overflow:hidden; text-overflow:ellipsis;">
              ${escapeHtml(c.card_series)}
            </div>
            <div style="font-weight:800; font-size:0.8rem; color:var(--text-main); white-space:nowrap; overflow:hidden; text-overflow:ellipsis;">
              ${escapeHtml(c.name)}
            </div>
          </div>
        `;
      })
      .join('');
  }

  function renderPhysicalTracking() {
    const container = document.getElementById('studentPhysicalGrid');
    const empty = document.getElementById('studentPhysicalEmpty');
    const total = document.getElementById('physicalRedeemedTotal');
    if (!container) return;

    if (total) total.textContent = `共 ${myPhysicalCache.length} 筆`;

    if (myPhysicalCache.length === 0) {
      container.innerHTML = '';
      if (empty) empty.style.display = 'block';
      return;
    }

    if (empty) empty.style.display = 'none';

    container.innerHTML = myPhysicalCache
      .map((p) => {
        let statusBadge = '';
        let stepHint = '';
        if (p.status === 'requested') {
          statusBadge = '<span style="font-size:0.75rem; color:#ea580c; background:rgba(249, 115, 22, 0.12); padding:2px 8px; border-radius:6px; font-weight:800;">1️⃣ 待老師審核</span>';
          stepHint = '<div style="font-size:0.76rem; color:#ea580c; margin-top:2px;">⏳ 已送出申請，請等候老師審核核准</div>';
        } else if (p.status === 'approved_held') {
          statusBadge = '<span style="font-size:0.75rem; color:#2563eb; background:rgba(59, 130, 246, 0.15); padding:2px 8px; border-radius:6px; font-weight:800;">2️⃣ 審核通過 (點數預扣中)</span>';
          stepHint = '<div style="font-size:0.76rem; color:#2563eb; font-weight:700; margin-top:2px;">🎉 老師已核准！請於下課時至講台向老師領取獎勵。</div>';
        } else if (p.status === 'completed') {
          statusBadge = '<span style="font-size:0.75rem; color:#16a34a; background:rgba(34, 197, 94, 0.12); padding:2px 8px; border-radius:6px; font-weight:800;">3️⃣ 已領取完成 (真實扣點)</span>';
          stepHint = `<div style="font-size:0.76rem; color:var(--text-muted); margin-top:2px;">✅ 於 ${escapeHtml(p.fulfilled_at || p.created_at)} 完成領取</div>`;
        } else if (p.status === 'rejected') {
          statusBadge = '<span style="font-size:0.75rem; color:#dc2626; background:rgba(239, 68, 68, 0.12); padding:2px 8px; border-radius:6px; font-weight:800;">❌ 老師已駁回</span>';
          stepHint = `<div style="font-size:0.76rem; color:#dc2626; margin-top:2px;">原因：${escapeHtml(p.teacher_note || '無法兌換')}</div>`;
        } else {
          statusBadge = '<span style="font-size:0.75rem; color:var(--text-muted); background:var(--input-bg); padding:2px 8px; border-radius:6px; font-weight:800;">↩️ 已取消發放</span>';
          stepHint = '<div style="font-size:0.76rem; color:var(--text-muted); margin-top:2px;">預扣點數已退還</div>';
        }

        return `
          <div style="background:var(--nav-bg); border:1px solid var(--card-border); border-radius:var(--radius-lg); padding:10px 14px; display:flex; align-items:center; gap:12px;">
            <div style="width:48px; height:48px; border-radius:8px; overflow:hidden; background:#fff; display:flex; align-items:center; justify-content:center; flex-shrink:0; border:1px solid var(--card-border);">
              <img src="${p.image_url || getGiftPlaceholderSvg('🎁')}" alt="${escapeHtml(p.name)}" style="width:90%; height:90%; object-fit:contain;" onerror="this.onerror=null; this.src=getGiftPlaceholderSvg('🎁')">
            </div>
            <div style="flex:1;">
              <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:2px;">
                <div style="font-weight:800; font-size:0.9rem; color:var(--text-main);">${escapeHtml(p.name)}</div>
                ${statusBadge}
              </div>
              <div style="font-size:0.8rem; font-weight:700; color:var(--primary);">
                扣除點數：${p.points_spent} 點
              </div>
              ${stepHint}
            </div>
          </div>
        `;
      })
      .join('');
  }

  // 開啟兌換確認對話框
  function openRedeemConfirmModal(item) {
    currentRedeemingItem = item;
    const modal = document.getElementById('modalStudentRedeemConfirm');
    if (!modal) return;

    document.getElementById('confirmRewardName').textContent = item.name;
    document.getElementById('confirmRewardCost').textContent = `-${item.points_cost} 點`;
    document.getElementById('confirmUserAvailable').textContent = `${currentUserAvailablePoints} 點`;
    document.getElementById('confirmRemainingPoints').textContent = `${currentUserAvailablePoints - item.points_cost} 點`;
    document.getElementById('confirmRewardImg').src = item.image_url;

    const noteWrap = document.getElementById('confirmPhysicalNoteWrap');
    const noteInput = document.getElementById('inputConfirmRedeemNote');
    const flowTip = document.getElementById('confirmFlowTip');
    const submitBtn = document.getElementById('btnSubmitRedeemConfirm');

    if (noteInput) noteInput.value = '';

    if (item.reward_type === 'physical') {
      if (noteWrap) noteWrap.style.display = 'block';
      if (flowTip) flowTip.innerHTML = '💡 實體獎品將進入<b>三階段審核</b>：送出申請後由老師審核，審核通過後點數暫時預扣，拿到獎品時正式扣點。';
      if (submitBtn) submitBtn.textContent = '送出申請';
    } else {
      if (noteWrap) noteWrap.style.display = 'none';
      if (flowTip) flowTip.innerHTML = '✨ 虛擬榮譽項目確認後將<b>立即扣除點數</b>，並即時收錄至您的個人收藏館！';
      if (submitBtn) submitBtn.textContent = '確認立即兌換';
    }

    modal.style.display = 'flex';
  }

  function closeRedeemConfirmModal() {
    const modal = document.getElementById('modalStudentRedeemConfirm');
    if (modal) modal.style.display = 'none';
    currentRedeemingItem = null;
  }

  async function submitRedeem() {
    if (!currentRedeemingItem) return;
    const noteInput = document.getElementById('inputConfirmRedeemNote');
    const request_note = noteInput ? noteInput.value.trim() : '';

    try {
      const res = await api('/api/student/rewards/redeem', {
        method: 'POST',
        body: {
          reward_id: currentRedeemingItem.id,
          request_note,
        },
      });

      closeRedeemConfirmModal();
      showToast(res.message || '兌換成功！', 'success');
      await loadScores();
    } catch (err) {
      showToast(err.message || '兌換失敗', 'error');
    }
  }

  // --- 學生端獎勵事件綁定 ---
  // 商城藥丸分類
  document.querySelectorAll('.btn-store-filter').forEach((btn) => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.btn-store-filter').forEach((b) => {
        b.classList.remove('active');
        b.className = 'btn btn-secondary btn-sm btn-store-filter';
      });
      btn.classList.add('active');
      btn.className = 'btn btn-sm btn-store-filter active';
      storeFilterType = btn.dataset.type;
      renderStoreGrid();
    });
  });

  // 商城點擊兌換按鈕
  document.getElementById('studentStoreGrid')?.addEventListener('click', (e) => {
    const btn = e.target.closest('.btn-store-redeem');
    if (btn && btn.dataset.itemId) {
      const id = Number(btn.dataset.itemId);
      const item = storeItemsCache.find((i) => i.id === id);
      if (item) openRedeemConfirmModal(item);
    }
  });

  // 兌換確認對話框事件
  document.getElementById('btnCancelRedeemConfirm')?.addEventListener('click', closeRedeemConfirmModal);
  document.getElementById('btnSubmitRedeemConfirm')?.addEventListener('click', submitRedeem);

  // 點選個人徽章放大
  document.getElementById('studentBadgesGrid')?.addEventListener('click', (e) => {
    const itemEl = e.target.closest('.my-badge-item');
    if (itemEl && itemEl.dataset.badgeId) {
      const b = myBadgesCache.find((x) => x.id === Number(itemEl.dataset.badgeId));
      if (b) {
        openCardZoom({
          is_reward: true,
          name: `🏅 ${b.name}`,
          image_url: b.image_url,
          description: b.description || '個人專屬榮譽徽章',
          points_spent: b.points_spent,
        });
      }
    }
  });

  // 點選特殊圖卡放大
  document.getElementById('studentCardsGrid')?.addEventListener('click', (e) => {
    const itemEl = e.target.closest('.my-collectible-card-item');
    if (itemEl && itemEl.dataset.cardId) {
      const c = myCardsCache.find((x) => x.id === Number(itemEl.dataset.cardId));
      if (c) {
        openCardZoom({
          is_reward: true,
          name: `🎴 ${c.name}`,
          image_url: c.image_url,
          series_name: c.card_series,
          description: c.description,
          points_spent: c.points_spent,
        });
      }
    }
  });
