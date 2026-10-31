// MyClass 學生端：我的成績與加減分紀錄
// 由 static/js/student.js 拆出（2026-10-31，原第 851–983 行），程式內容未變更；縮排保留原樣。
// student.js 與 static/js/student/*.js 共用頁面的全域範圍（一般 <script>），載入順序見 static/student.html。


  function formatScoreValue(n) {
    return n > 0 ? `+${n}` : String(n);
  }

  // --- 得分紀錄清單分頁與篩選狀態（預設折疊，展開顯示最近五筆，支援下一頁/指定日期/顯示全部） ---
  let allScoreLogs = [];
  let scoreLogsPage = 1;
  const SCORE_LOGS_PAGE_SIZE = 5;
  let scoreLogsDateFilter = '';
  let scoreLogsShowAllMode = false;
  let isScoreLogsExpanded = false; // 預設折疊

  function toggleScoreLogsSection() {
    isScoreLogsExpanded = !isScoreLogsExpanded;
    const body = document.getElementById('scoreLogsBody');
    const hint = document.getElementById('scoreLogsToggleHint');
    const icon = document.getElementById('scoreLogsToggleIcon');
    if (!body) return;

    body.style.display = isScoreLogsExpanded ? 'block' : 'none';
    if (hint) hint.textContent = isScoreLogsExpanded ? '收起清單' : '點擊展開';
    if (icon) icon.style.transform = isScoreLogsExpanded ? 'rotate(180deg)' : 'rotate(0deg)';
  }

  function renderScoreLogs() {
    const listEl = document.getElementById('scoreLogsList');
    const emptyEl = document.getElementById('scoreEmptyState');
    const countBadge = document.getElementById('scoreLogsCountBadge');
    const pageInfo = document.getElementById('textScoreLogsPageInfo');
    const prevBtn = document.getElementById('btnScoreLogsPrevPage');
    const nextBtn = document.getElementById('btnScoreLogsNextPage');

    if (!listEl) return;

    // 依據日期篩選
    let filtered = allScoreLogs;
    if (scoreLogsDateFilter) {
      filtered = allScoreLogs.filter((l) => l.date === scoreLogsDateFilter);
    }

    if (countBadge) {
      countBadge.textContent = `共 ${filtered.length} 筆`;
    }

    if (filtered.length === 0) {
      listEl.innerHTML = '';
      if (emptyEl) emptyEl.style.display = 'block';
      if (pageInfo) pageInfo.textContent = '第 0 / 0 頁';
      if (prevBtn) prevBtn.disabled = true;
      if (nextBtn) nextBtn.disabled = true;
      return;
    }

    if (emptyEl) emptyEl.style.display = 'none';

    // 處理分頁（預設一頁 5 筆）
    const totalPages = Math.ceil(filtered.length / SCORE_LOGS_PAGE_SIZE) || 1;
    if (scoreLogsPage > totalPages) scoreLogsPage = totalPages;
    if (scoreLogsPage < 1) scoreLogsPage = 1;

    let itemsToDisplay = filtered;
    if (!scoreLogsShowAllMode) {
      const startIdx = (scoreLogsPage - 1) * SCORE_LOGS_PAGE_SIZE;
      itemsToDisplay = filtered.slice(startIdx, startIdx + SCORE_LOGS_PAGE_SIZE);
      if (pageInfo) pageInfo.textContent = `第 ${scoreLogsPage} / ${totalPages} 頁`;
      if (prevBtn) prevBtn.disabled = scoreLogsPage <= 1;
      if (nextBtn) nextBtn.disabled = scoreLogsPage >= totalPages;
    } else {
      // 顯示全部模式
      if (pageInfo) pageInfo.textContent = `全部 (${filtered.length} 筆)`;
      if (prevBtn) prevBtn.disabled = true;
      if (nextBtn) nextBtn.disabled = true;
    }

    listEl.innerHTML = '';
    itemsToDisplay.forEach((l) => {
      const item = document.createElement('div');
      item.className = 'score-log-item';
      const groupSuffix = l.group_name ? `（小組：${escapeHtml(l.group_name)}）` : '';

      // 檢查是否為實體點數卡：若是實體卡，顯式標示卡號
      let cardBadgeHtml = '';
      let displayRuleTitle = l.rule_title || '點數異動';
      if (l.card_no) {
        if (!displayRuleTitle.includes(l.card_no)) {
          cardBadgeHtml = `<span class="badge" style="font-size: 0.76rem; font-weight: 800; color: var(--primary); background: rgba(91, 124, 214, 0.12); padding: 2px 7px; border-radius: 6px; margin-left: 6px;">卡號：${escapeHtml(l.card_no)}</span>`;
        }
      }

      const timeStr = l.timestamp ? l.timestamp.slice(11, 16) : '';
      const dateDisplay = timeStr ? `${escapeHtml(l.date)} ${timeStr}` : escapeHtml(l.date);

      item.innerHTML = `
        <div>
          <div class="score-log-title" style="display:flex; align-items:center; flex-wrap:wrap; gap:4px;">
            <span>${escapeHtml(displayRuleTitle)}</span>
            ${cardBadgeHtml}
            ${groupSuffix}
          </div>
          <div class="score-log-meta">${dateDisplay}</div>
        </div>
        <div class="score-log-value ${l.score >= 0 ? 'positive' : 'negative'}">${formatScoreValue(l.score)}</div>
      `;
      listEl.appendChild(item);
    });
  }

  async function loadScores() {
    const data = await api('/api/student/me/scores');
    document.getElementById('scoreTotalValue').textContent = formatScoreValue(data.total_score);
    document.getElementById('scoreTodayValue').textContent = formatScoreValue(data.today_score);
    document.getElementById('scorePositiveValue').textContent = formatScoreValue(data.positive_score);
    document.getElementById('scoreNegativeValue').textContent = formatScoreValue(data.negative_score);

    const availablePoints = typeof data.available_points === 'number' ? data.available_points : data.total_score;
    const heldPoints = typeof data.held_points === 'number' ? data.held_points : 0;
    const availEl = document.getElementById('scoreAvailableValue');
    const heldEl = document.getElementById('scoreHeldValue');
    const storeBadge = document.getElementById('storeUserPointsBadge');
    if (availEl) availEl.textContent = availablePoints;
    if (heldEl) heldEl.textContent = heldPoints;
    if (storeBadge) storeBadge.textContent = availablePoints;

    allScoreLogs = data.logs || [];
    renderScoreLogs();

    // 同步載入點數卡收集冊與獎勵兌換商城/收藏館
    await Promise.allSettled([
      loadMyPointCards(),
      loadRewardsStoreAndCollection(),
    ]);
  }
