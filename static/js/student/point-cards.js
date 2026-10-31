// MyClass 學生端：點數卡掃描與卡片收藏
// 由 static/js/student.js 拆出（2026-10-31，原第 1632–2262 行），程式內容未變更；縮排保留原樣。
// student.js 與 static/js/student/*.js 共用頁面的全域範圍（一般 <script>），載入順序見 static/student.html。


  // ==========================================================================
  // 實體點數卡掃描與收集冊模組 (移植自 kyps-scoreboard)
  // ==========================================================================
  let html5Scanner = null;
  let isScannerActive = false;
  let isSubmittingCard = false;
  let userCardsCache = {};

  function sanitizeCardLabel(label, seriesName) {
    const l = (label || '').trim();
    // 嚴格過濾：若為空、或為 6~16 位之英數字代碼（如十六進位哈希），一律隱藏並替換為系列名稱
    if (!l || /^[a-z0-9]{6,16}$/i.test(l)) {
      return (seriesName && seriesName.trim()) ? seriesName.trim() : '榮譽點數卡';
    }
    return l;
  }

  // 1. 載入個人點數卡收集冊
  async function loadMyPointCards() {
    const albumContainer = document.getElementById('myCardsAlbumContainer');
    const emptyState = document.getElementById('myCardsEmptyState');
    const totalBadge = document.getElementById('myCardsTotalBadge');
    if (!albumContainer) return;

    try {
      const res = await api('/api/student/point-cards/my-cards');
      const totalCards = res.total_cards || 0;
      if (totalBadge) totalBadge.textContent = `共 ${totalCards} 張`;

      if (!res.groups || res.groups.length === 0) {
        albumContainer.innerHTML = '';
        if (emptyState) emptyState.style.display = 'block';
        return;
      }

      if (emptyState) emptyState.style.display = 'none';
      userCardsCache = {};

      albumContainer.innerHTML = res.groups
        .map((group) => {
          const cardsHtml = group.cards
            .map((card) => {
              userCardsCache[card.id] = card;
              const scoreColor = card.score >= 0 ? 'var(--accent-positive)' : 'var(--accent-negative)';
              const scorePrefix = card.score >= 0 ? '+' : '';
              const timeStr = card.timestamp ? card.timestamp.slice(11, 16) : '';
              const cardNoStr = card.card_no ? escapeHtml(card.card_no) : '';
              const cardNoBadge = cardNoStr
                ? `<div style="display:inline-block; font-size:0.76rem; font-weight:800; color:var(--primary); background:rgba(91, 124, 214, 0.12); padding:2px 8px; border-radius:6px; margin-bottom:4px;">卡號：${cardNoStr}</div>`
                : '';
              const displayTitle = sanitizeCardLabel(card.label, card.series_name);
              const cardSvg = getCardPlaceholderSvg(card.score, displayTitle);
              const cardImageSrc = card.image ? fileUrlWithToken(card.image) : cardSvg;

              return `
                <div class="my-card-tile" data-card-id="${card.id}" style="background:var(--card-bg); border:1.5px solid var(--card-border); border-radius:var(--radius-lg); padding:10px; text-align:center; box-shadow:var(--shadow-xs); transition:transform 0.15s ease, box-shadow 0.15s ease; cursor:pointer;" title="點擊放大卡片">
                  <div style="width:100%; aspect-ratio:1; border-radius:10px; overflow:hidden; background:#f1f5f9; margin-bottom:8px; display:flex; align-items:center; justify-content:center;">
                    <img src="${cardImageSrc}" alt="${escapeHtml(displayTitle)}" style="width:100%; height:100%; object-fit:contain;" onerror="this.onerror=null; this.src='${cardSvg}'">
                  </div>
                  ${cardNoBadge}
                  <div style="font-weight:800; font-size:0.88rem; color:var(--text-main); white-space:nowrap; overflow:hidden; text-overflow:ellipsis; margin-bottom:2px;" title="${escapeHtml(displayTitle)}">
                    ${escapeHtml(displayTitle)}
                  </div>
                  <div style="font-weight:900; font-size:0.95rem; color:${scoreColor}; margin-bottom:2px;">
                    ${scorePrefix}${card.score} 分
                  </div>
                  <div style="font-size:0.72rem; color:var(--text-muted); margin-top:2px;">
                    ${timeStr}
                  </div>
                </div>
              `;
            })
            .join('');

          return `
            <div class="my-cards-date-group" style="margin-bottom:18px; border:1px solid var(--card-border); border-radius:var(--radius-lg); overflow:hidden;">
              <div style="display:flex; justify-content:space-between; align-items:center; padding:8px 14px; background:var(--nav-bg); border-bottom:1px solid var(--card-border);">
                <span style="font-weight:700; font-size:0.88rem; color:var(--text-main);">📅 ${group.date}</span>
                <span class="badge" style="font-size:0.8rem; font-weight:800; color:var(--primary); background:rgba(91, 124, 214, 0.12); padding:2px 10px; border-radius:12px;">
                  當日獲得 +${group.total_score} 分
                </span>
              </div>
              <div style="display:grid; grid-template-columns:repeat(auto-fill, minmax(110px, 1fr)); gap:10px; padding:12px;">
                ${cardsHtml}
              </div>
            </div>
          `;
        })
        .join('');
    } catch (err) {
      console.error('Failed to load my cards:', err);
    }
  }

  // 2. 處理點數卡代碼送出（相機掃描到或手動輸入）
  async function processPointCardCode(code) {
    if (!code || !code.trim()) return;
    if (isSubmittingCard) return;

    isSubmittingCard = true;
    const cleanCode = code.trim();
    const statusMsg = document.getElementById('scannerStatusMsg');
    if (statusMsg) {
      statusMsg.textContent = '⏳ 正在驗證點數卡...';
      statusMsg.style.color = 'var(--primary)';
    }

    try {
      const res = await api('/api/student/point-cards/scan', {
        method: 'POST',
        body: JSON.stringify({ code: cleanCode }),
      });

      // 成功獲得卡片！
      closeCardScannerModal();
      showCardRewardModal(res);

      // 重新載入最新分數與收集冊
      await loadScores();
      await loadMyPointCards();
    } catch (err) {
      if (statusMsg) {
        statusMsg.textContent = `❌ ${err.message}`;
        statusMsg.style.color = 'var(--accent-negative)';
      }
      showToast(err.message, 'error');

      // 1.5 秒後恢復掃描提示
      setTimeout(() => {
        if (isScannerActive && statusMsg) {
          statusMsg.textContent = '請將卡片上的 QR Code 對準上方鏡頭方框';
          statusMsg.style.color = 'var(--text-muted)';
        }
      }, 2500);
    } finally {
      isSubmittingCard = false;
    }
  }

  // 3. 相機掃描鏡頭控制（智慧裝置判斷 + 自動選用主鏡頭）
  let cachedCameras = [];
  let currentCameraConfig = null;
  let currentFacingMode = 'environment';

  // 裝置類型智慧判斷
  function getDeviceInfo() {
    const ua = navigator.userAgent || '';
    const isIOS = /iPhone|iPad|iPod/i.test(ua) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
    const isAndroid = /Android/i.test(ua);
    const isMobile = isIOS || isAndroid || /Mobi|Tablet|Touch/i.test(ua);
    return {
      isIOS,
      isAndroid,
      isMobile,
      isDesktop: !isMobile,
      platformName: isIOS ? 'iPhone / iPad (iOS)' : (isAndroid ? 'Android 手機' : '電腦 / 筆電')
    };
  }

  // 依據裝置類型與鏡頭特徵自動選用「主相機」
  function pickPrimaryCamera(cameras, dev) {
    if (!cameras || cameras.length === 0) {
      // 無法枚舉或無鏡頭清單：手機預設 environment (後置)，電腦預設 user (前置)
      return dev.isMobile ? { facingMode: 'environment' } : { facingMode: 'user' };
    }

    if (dev.isMobile) {
      // 行動裝置端：尋找後置/主鏡頭（排除前鏡頭）
      const backCams = cameras.filter((c) => {
        const l = (c.label || '').toLowerCase();
        const isFront = l.includes('front') || l.includes('user') || l.includes('前') || l.includes('selfie') || l.includes('facing front');
        const isBack = l.includes('back') || l.includes('rear') || l.includes('environment') || l.includes('後') || l.includes('主') || l.includes('wide') || l.includes('facing back');
        return isBack && !isFront;
      });

      if (backCams.length > 0) {
        // 優先找標準主鏡頭（非超廣角、非望遠鏡頭）
        const primaryBack = backCams.find((c) => {
          const l = (c.label || '').toLowerCase();
          return !l.includes('ultra') && !l.includes('tele');
        }) || backCams[0];
        return primaryBack.id;
      }

      // 若相機有標籤但沒 match 到 back，檢查是否所有相機都沒有 label（iOS 尚未授權時 label 為空字串）
      const hasLabels = cameras.some((c) => !!c.label);
      if (!hasLabels) {
        // iOS Safari 在未授權前 label 為空，此時使用 facingMode: 'environment' 是最穩定的後置鏡頭指令
        return { facingMode: 'environment' };
      }

      // 如果有標籤但找不到後鏡頭，最後一個相機在大多數多鏡頭手機上為後相機
      return cameras[cameras.length - 1].id;
    } else {
      // 電腦端：主相機通常為第一個網路攝影機
      return cameras[0].id;
    }
  }

  async function startCameraScanner(cameraConfig) {
    const loadingOverlay = document.getElementById('scannerLoadingOverlay');
    const statusMsg = document.getElementById('scannerStatusMsg');

    if (loadingOverlay) loadingOverlay.style.display = 'flex';
    if (statusMsg) {
      statusMsg.textContent = '正在啟動相機鏡頭...';
      statusMsg.style.color = 'var(--text-muted)';
    }

    if (!html5Scanner) {
      html5Scanner = new Html5Qrcode('ptcard-qr-reader');
    }

    if (isScannerActive) {
      try {
        await html5Scanner.stop();
      } catch (_) {}
      isScannerActive = false;
    }

    const config = {
      fps: 15,
      qrbox: (viewfinderWidth, viewfinderHeight) => {
        // 取視窗寬高最小值的 70%，保證長寬嚴格相等的正方形
        const edge = Math.floor(Math.min(viewfinderWidth, viewfinderHeight) * 0.70);
        const squareSize = Math.max(160, Math.min(edge, 300));
        return { width: squareSize, height: squareSize };
      },
      aspectRatio: 1.0,
    };

    const tryStart = async (camConf) => {
      await html5Scanner.start(
        camConf,
        config,
        async (decodedText) => {
          if (!isScannerActive || isSubmittingCard) return;
          try { await html5Scanner.pause(); } catch (_) {}
          await processPointCardCode(decodedText);
          setTimeout(() => {
            if (isScannerActive && html5Scanner) {
              try { html5Scanner.resume(); } catch (_) {}
            }
          }, 1500);
        },
        () => {}
      );
    };

    try {
      await tryStart(cameraConfig);
      isScannerActive = true;
      currentCameraConfig = cameraConfig;
      if (loadingOverlay) loadingOverlay.style.display = 'none';
      if (statusMsg) {
        statusMsg.textContent = '請將卡片上的 QR Code 對準上方鏡頭方框';
        statusMsg.style.color = 'var(--text-muted)';
      }
    } catch (camErr) {
      console.warn('Camera start error with config:', cameraConfig, camErr);

      // 若指定相機失敗，自動嘗試降級候選模式
      let fallbackSuccess = false;
      const dev = getDeviceInfo();
      const fallbacks = dev.isMobile
        ? [{ facingMode: 'environment' }, { facingMode: 'user' }]
        : [{ facingMode: 'user' }, { facingMode: 'environment' }];

      if (cachedCameras && cachedCameras.length > 0) {
        cachedCameras.forEach((c) => {
          if (c.id !== cameraConfig) fallbacks.push(c.id);
        });
      }

      for (const fb of fallbacks) {
        try {
          await tryStart(fb);
          isScannerActive = true;
          currentCameraConfig = fb;
          fallbackSuccess = true;
          console.log('Fallback camera started successfully:', fb);
          break;
        } catch (_) {}
      }

      if (loadingOverlay) loadingOverlay.style.display = 'none';
      if (fallbackSuccess) {
        if (statusMsg) {
          statusMsg.textContent = '請將卡片上的 QR Code 對準上方鏡頭方框';
          statusMsg.style.color = 'var(--text-muted)';
        }
      } else {
        if (statusMsg) {
          const isNotHttps = location.protocol !== 'https:' && location.hostname !== 'localhost' && location.hostname !== '127.0.0.1';
          if (isNotHttps) {
            statusMsg.innerHTML = `⚠️ 瀏覽器相機必須在 <b>HTTPS</b> 連線下使用。<br>請改用 <code>https://${location.host}</code> 連線！`;
          } else {
            statusMsg.textContent = '無法取得相機權限或無相機可用，請直接手動輸入卡號';
          }
          statusMsg.style.color = 'var(--accent-negative)';
        }
      }
    }
  }

  function updateCameraDropdownUI(activeConfig) {
    const cameraSelectWrap = document.getElementById('scannerCameraSelectWrap');
    const cameraSelect = document.getElementById('scannerCameraSelect');
    if (!cameraSelect) return;

    const dev = getDeviceInfo();
    let opts = `
      <option value="facing_back">📷 後置主鏡頭 (${dev.isMobile ? '手機推薦' : '環境鏡頭'})</option>
      <option value="facing_front">🤳 前置鏡頭 (自拍/視訊鏡頭)</option>
    `;

    if (cachedCameras && cachedCameras.length > 0) {
      cachedCameras.forEach((cam, idx) => {
        const labelLower = (cam.label || '').toLowerCase();
        const isBack = labelLower.includes('back') || labelLower.includes('rear') || labelLower.includes('environment') || labelLower.includes('後') || labelLower.includes('主');
        const isFront = labelLower.includes('front') || labelLower.includes('user') || labelLower.includes('前');
        let tag = '';
        if (isBack) tag = ' (後置主相機)';
        else if (isFront) tag = ' (前鏡頭)';
        const displayName = cam.label ? `${cam.label}${tag}` : `相機鏡頭 ${idx + 1}`;
        opts += `<option value="${cam.id}">${escapeHtml(displayName)}</option>`;
      });
    }

    cameraSelect.innerHTML = opts;

    if (typeof activeConfig === 'string') {
      cameraSelect.value = activeConfig;
    } else if (activeConfig && activeConfig.facingMode === 'user') {
      cameraSelect.value = 'facing_front';
    } else {
      cameraSelect.value = 'facing_back';
    }

    if (cameraSelectWrap) cameraSelectWrap.style.display = 'flex';
  }

  async function toggleCameraFacing() {
    currentFacingMode = currentFacingMode === 'environment' ? 'user' : 'environment';
    const targetConf = { facingMode: currentFacingMode };
    await startCameraScanner(targetConf);
    updateCameraDropdownUI(targetConf);
  }

  // 4. 開啟相機掃描對話框
  async function openCardScannerModal() {
    const modal = document.getElementById('modalStudentScanner');
    const loadingOverlay = document.getElementById('scannerLoadingOverlay');
    const statusMsg = document.getElementById('scannerStatusMsg');
    const manualInput = document.getElementById('inputManualCardCode');

    if (!modal) return;
    modal.style.display = 'flex';
    if (manualInput) manualInput.value = '';
    if (loadingOverlay) loadingOverlay.style.display = 'flex';

    // 檢查 HTTPS 安全連線環境
    const isNotHttps = location.protocol !== 'https:' && location.hostname !== 'localhost' && location.hostname !== '127.0.0.1';
    if (isNotHttps) {
      if (loadingOverlay) loadingOverlay.style.display = 'none';
      if (statusMsg) {
        statusMsg.innerHTML = `⚠️ 瀏覽器規定相機必須在 <b>HTTPS</b> 安全連線下使用。<br>請改以 <code>https://${location.host}</code> 連線！`;
        statusMsg.style.color = 'var(--accent-negative)';
      }
      return;
    }

    if (!window.Html5Qrcode) {
      if (loadingOverlay) loadingOverlay.style.display = 'none';
      if (statusMsg) statusMsg.textContent = '⚠️ 無法載入相機模組，請使用手動輸入卡號';
      return;
    }

    const dev = getDeviceInfo();
    if (statusMsg) {
      statusMsg.textContent = `正在啟動 ${dev.platformName} 主相機...`;
      statusMsg.style.color = 'var(--text-muted)';
    }

    // 1. 於啟動相機前取得鏡頭清單（避免串流啟動後造成 Safari getUserMedia 衝突）
    try {
      cachedCameras = await Html5Qrcode.getCameras().catch(() => []);
    } catch (_) {
      cachedCameras = [];
    }

    // 2. 智慧挑選最佳主相機
    const primaryCamConfig = pickPrimaryCamera(cachedCameras, dev);
    currentFacingMode = (typeof primaryCamConfig === 'object' && primaryCamConfig.facingMode === 'user') ? 'user' : 'environment';

    // 3. 啟動相機掃描
    await startCameraScanner(primaryCamConfig);

    // 4. 更新鏡頭選單 UI
    updateCameraDropdownUI(primaryCamConfig);
  }

  // 5. 關閉相機掃描對話框
  async function closeCardScannerModal() {
    const modal = document.getElementById('modalStudentScanner');
    if (modal) modal.style.display = 'none';
    isScannerActive = false;

    if (html5Scanner) {
      try {
        await html5Scanner.stop();
      } catch (_) {}
    }
  }

  // 6. 獲得卡片獎勵彈窗
  let currentRevealedCard = null;

  function showCardRewardModal(cardData) {
    const modal = document.getElementById('modalCardRewardReveal');
    const labelEl = document.getElementById('revealCardLabel');
    const imgEl = document.getElementById('revealCardImg');
    const badgeEl = document.getElementById('revealScoreBadge');

    if (!modal) return;
    currentRevealedCard = cardData;
    const displayTitle = sanitizeCardLabel(cardData.label, cardData.series_name);
    if (labelEl) labelEl.textContent = displayTitle;

    const cardNoEl = document.getElementById('revealCardNo');
    if (cardNoEl) {
      if (cardData.card_no) {
        cardNoEl.textContent = `卡號：${cardData.card_no}`;
        cardNoEl.style.display = 'block';
      } else {
        cardNoEl.style.display = 'none';
      }
    }

    let imgSrc = cardData.card_image || cardData.image || '';
    const scoreVal = typeof cardData.card_value === 'number' ? cardData.card_value : (cardData.score || 0);
    const cardSvg = getCardPlaceholderSvg(scoreVal, displayTitle);

    if (imgSrc && !imgSrc.startsWith('/') && !imgSrc.startsWith('http')) {
      imgSrc = '';
    }
    if (!imgSrc) {
      imgSrc = cardSvg;
    }

    if (imgEl) {
      imgEl.src = fileUrlWithToken(imgSrc);
      imgEl.onerror = function () {
        this.onerror = null;
        this.src = cardSvg;
      };
    }

    if (badgeEl) {
      const isPos = cardData.card_value >= 0;
      badgeEl.textContent = `${isPos ? '+' : ''}${cardData.card_value} 分`;
      badgeEl.style.color = isPos ? 'var(--accent-positive)' : 'var(--accent-negative)';
      badgeEl.style.background = isPos ? 'rgba(79, 174, 130, 0.15)' : 'rgba(217, 128, 126, 0.15)';
    }

    modal.style.display = 'flex';
  }

  function closeCardRewardModal() {
    const modal = document.getElementById('modalCardRewardReveal');
    if (modal) modal.style.display = 'none';
  }

  // 7. 卡片大圖檢視 (點選卡片放大檢視)

  function openCardZoom(cardData) {
    if (!cardData) return;
    const modal = document.getElementById('modalCardZoom');
    const labelEl = document.getElementById('zoomCardLabel');
    const imgEl = document.getElementById('zoomCardImg');
    const seriesEl = document.getElementById('zoomCardSeries');
    const scoreEl = document.getElementById('zoomCardScore');

    if (!modal) return;

    if (cardData.is_reward) {
      if (labelEl) labelEl.textContent = cardData.name || '獎勵展示';
      if (imgEl) imgEl.src = cardData.image_url || cardData.image || '';
      if (seriesEl) {
        seriesEl.textContent = cardData.series_name ? `系列：${cardData.series_name}` : (cardData.description || '');
      }
      const cardNoEl = document.getElementById('zoomCardNo');
      if (cardNoEl) cardNoEl.style.display = 'none';
      if (scoreEl) {
        scoreEl.textContent = cardData.points_spent ? `消耗 ${cardData.points_spent} 點` : '';
        scoreEl.style.color = 'var(--primary)';
      }
      modal.style.display = 'flex';
      return;
    }

    const cardNoEl = document.getElementById('zoomCardNo');
    if (cardNoEl) cardNoEl.style.display = 'inline-block';

    const displayTitle = sanitizeCardLabel(cardData.label, cardData.series_name);
    if (labelEl) labelEl.textContent = displayTitle;

    let imgSrc = cardData.card_image || cardData.image || '';
    const scoreVal = typeof cardData.card_value === 'number' ? cardData.card_value : (cardData.score || 0);
    const cardSvg = getCardPlaceholderSvg(scoreVal, displayTitle);

    if (imgSrc && !imgSrc.startsWith('/') && !imgSrc.startsWith('http') && !imgSrc.startsWith('data:')) {
      imgSrc = '';
    }
    if (!imgSrc) {
      imgSrc = cardSvg;
    }

    if (imgEl) {
      imgEl.src = fileUrlWithToken(imgSrc);
      imgEl.onerror = function () {
        this.onerror = null;
        this.src = cardSvg;
      };
    }

    if (seriesEl) {
      const serName = cardData.series_name ? `系列：${cardData.series_name}` : '系列：-';
      seriesEl.textContent = serName;
    }

    if (cardNoEl) {
      cardNoEl.textContent = cardData.card_no ? `卡號：${cardData.card_no}` : '卡號：-';
    }

    if (scoreEl) {
      const score = typeof cardData.card_value === 'number' ? cardData.card_value : (cardData.score || 0);
      const isPos = score >= 0;
      scoreEl.textContent = `${isPos ? '+' : ''}${score} 分`;
      scoreEl.style.color = isPos ? 'var(--accent-positive)' : 'var(--accent-negative)';
    }

    modal.style.display = 'flex';
  }

  function closeCardZoom() {
    const modal = document.getElementById('modalCardZoom');
    if (modal) modal.style.display = 'none';
  }

  // 事件綁定
  // 得分紀錄清單事件綁定（折疊、分頁、指定日期、顯示全部）
  document.getElementById('btnToggleScoreLogs')?.addEventListener('click', toggleScoreLogsSection);

  document.getElementById('inputScoreLogDate')?.addEventListener('change', (e) => {
    scoreLogsDateFilter = e.target.value;
    scoreLogsShowAllMode = false;
    scoreLogsPage = 1;
    const showAllBtn = document.getElementById('btnScoreLogsShowAll');
    if (showAllBtn) showAllBtn.textContent = '顯示全部';
    renderScoreLogs();
  });

  document.getElementById('btnScoreLogsShowAll')?.addEventListener('click', () => {
    const dateInput = document.getElementById('inputScoreLogDate');
    if (dateInput) dateInput.value = '';
    scoreLogsDateFilter = '';
    scoreLogsShowAllMode = !scoreLogsShowAllMode;
    const showAllBtn = document.getElementById('btnScoreLogsShowAll');
    if (showAllBtn) {
      showAllBtn.textContent = scoreLogsShowAllMode ? '分頁瀏覽' : '顯示全部';
    }
    scoreLogsPage = 1;
    renderScoreLogs();
  });

  document.getElementById('btnScoreLogsPrevPage')?.addEventListener('click', () => {
    if (scoreLogsPage > 1) {
      scoreLogsPage--;
      renderScoreLogs();
    }
  });

  document.getElementById('btnScoreLogsNextPage')?.addEventListener('click', () => {
    scoreLogsPage++;
    renderScoreLogs();
  });

  document.getElementById('btnOpenCardScanner')?.addEventListener('click', openCardScannerModal);
  document.getElementById('btnCloseScannerModal')?.addEventListener('click', closeCardScannerModal);
  document.getElementById('btnSwitchCamera')?.addEventListener('click', toggleCameraFacing);

  document.getElementById('btnZoomRevealedCard')?.addEventListener('click', () => {
    if (currentRevealedCard) openCardZoom(currentRevealedCard);
  });

  document.getElementById('btnCloseCardZoom')?.addEventListener('click', closeCardZoom);
  document.getElementById('modalCardZoom')?.addEventListener('click', closeCardZoom);

  document.getElementById('myCardsAlbumContainer')?.addEventListener('click', (e) => {
    const tile = e.target.closest('.my-card-tile');
    if (tile && tile.dataset.cardId) {
      const card = userCardsCache[tile.dataset.cardId];
      if (card) openCardZoom(card);
    }
  });

  document.getElementById('btnRevealClose')?.addEventListener('click', closeCardRewardModal);
  document.getElementById('btnRevealContinueScan')?.addEventListener('click', () => {
    closeCardRewardModal();
    openCardScannerModal();
  });

  document.getElementById('scannerCameraSelect')?.addEventListener('change', async (e) => {
    const val = e.target.value;
    let targetConf;
    if (val === 'facing_back') {
      currentFacingMode = 'environment';
      targetConf = { facingMode: 'environment' };
    } else if (val === 'facing_front') {
      currentFacingMode = 'user';
      targetConf = { facingMode: 'user' };
    } else if (val) {
      targetConf = val;
    }
    if (targetConf) {
      await startCameraScanner(targetConf);
      updateCameraDropdownUI(targetConf);
    }
  });
