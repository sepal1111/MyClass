// MyClass 教師端：儀表板、排行榜與大螢幕投影
// 由 static/js/app.js 拆出（2026-10-31，原第 3685–4318 行），程式內容未變更。
// 所有 static/js/app.js 與 static/js/app/*.js 共用同一個全域範圍（一般 <script>，不是模組），載入順序見 static/index.html。


// --- Dashboard & Leaderboard Pane ---
let projectionTimerId = null;
let prevStudentScoresMap = {};
let prevGroupScoresMap = {};
let prevDashStudentScoresMap = {};
let prevDashGroupScoresMap = {};
let lastRosterDisplaySignature = '';
let lastDashboardFingerprint = null;
let lastProjectionFingerprint = null;

function computeDataFingerprint(data, context) {
  if (!data) return '';
  const students = (data.students || []).map(s => `${s.id}:${s.score}:${s.is_absent ? 1 : 0}:${s.group_name || ''}`).join('|');
  const groups = (data.group_leaderboard || []).map(g => `${g.group_name}:${g.total_score}:${g.member_count}`).join('|');
  const indRanks = (data.individual_leaderboard || []).map(s => `${s.id}:${s.score}`).join('|');
  return `${context.courseId}_${context.period}_${context.range || ''}_${context.mode || ''}_S[${students}]_G[${groups}]_R[${indRanks}]`;
}

function notifyScoreUpdates() {
  lastDashboardFingerprint = null;
  // If Dashboard tab is active, reload immediately
  if (getActiveTabName() === 'dashboard') {
    loadDashboardData(true);
  }
  // If Big Screen Overlay is open, reload immediately
  const overlay = document.getElementById('big-screen-projection-overlay');
  if (overlay && overlay.classList.contains('open')) {
    refreshProjectionData(true);
  }
}

async function loadDashboardData(force = false) {
  if (!AppState.currentCourseId || (AppState.courses && AppState.courses.length === 0)) {
    renderEmptyCourseNotice(document.getElementById('all-students-score-grid'));
    renderEmptyCourseNotice(document.getElementById('individual-leaderboard'));
    return;
  }
  try {
    let url = `/api/reports/${AppState.currentCourseId}/dashboard?period=${AppState.dashboardPeriod}`;
    let rangeStr = '';
    if (AppState.dashboardPeriod === 'range') {
      const s = document.getElementById('dash-start-date')?.value;
      const e = document.getElementById('dash-end-date')?.value;
      if (!s || !e) {
        const indContainer = document.getElementById('individual-leaderboard');
        const grpContainer = document.getElementById('group-leaderboard');
        const allGrid = document.getElementById('all-students-score-grid');
        const t = (k, p) => window.I18n ? window.I18n.t(k, p) : k;
        if (indContainer) {
          indContainer.innerHTML = `
            <div class="proj-range-waiting-card" style="padding: 36px 20px;">
              <div class="proj-range-waiting-icon" style="font-size: 2.6rem;">🏆</div>
              <div class="proj-range-waiting-title" style="color: var(--text-main); font-size: 1.1rem;">${t('dash_range_prompt_ind')}</div>
              <div class="proj-range-waiting-desc">可直接選擇日期或點擊快捷標籤（近 7 天、近 30 天、本月）</div>
            </div>
          `;
        }
        if (grpContainer) {
          grpContainer.innerHTML = `
            <div class="proj-range-waiting-card" style="padding: 36px 20px;">
              <div class="proj-range-waiting-icon" style="font-size: 2.6rem;">🚩</div>
              <div class="proj-range-waiting-title" style="color: var(--text-main); font-size: 1.1rem;">${t('dash_range_prompt_grp')}</div>
              <div class="proj-range-waiting-desc">可直接選擇日期或點擊快捷標籤（近 7 天、近 30 天、本月）</div>
            </div>
          `;
        }
        if (allGrid) {
          allGrid.innerHTML = `
            <div class="proj-range-waiting-card" style="padding: 36px 20px; grid-column: 1 / -1;">
              <div class="proj-range-waiting-icon" style="font-size: 2.6rem;">📋</div>
              <div class="proj-range-waiting-title" style="color: var(--text-main); font-size: 1.1rem;">${t('dash_range_prompt_all')}</div>
              <div class="proj-range-waiting-desc">可直接選擇日期或點擊快捷標籤（近 7 天、近 30 天、本月）</div>
            </div>
          `;
        }
        return;
      }
      url += `&start_date=${s}&end_date=${e}`;
      rangeStr = `${s}_${e}`;
    }

    const data = await API.get(url);

    // Compute fingerprint to detect if data has truly changed
    const fingerprint = computeDataFingerprint(data, {
      courseId: AppState.currentCourseId,
      period: AppState.dashboardPeriod,
      range: rangeStr,
      mode: AppState.dashboardViewMode
    });

    // If data didn't change and not forced, skip DOM re-render completely!
    if (!force && fingerprint === lastDashboardFingerprint) {
      return;
    }

    lastDashboardFingerprint = fingerprint;
    renderLeaderboards(data);
  } catch (err) {
    console.error('Dashboard load error:', err);
  }
}

function renderLeaderboards(data) {
  const isEn = window.I18n && window.I18n.getLanguage() === 'en';
  const t = (k, p) => window.I18n ? window.I18n.t(k, p) : k;

  // 1. 個人榮譽排行榜 (Top 10, 0 分不列入排名, 同分並列)
  const indContainer = document.getElementById('individual-leaderboard');
  if (indContainer) {
    indContainer.innerHTML = '';
    const indList = (data.individual_leaderboard || []).filter(s => s.score > 0);
    if (indList.length === 0) {
      indContainer.innerHTML = `<div style="text-align: center; color: var(--text-muted); padding: 30px; font-weight: 600;">${t('dash_no_individual_scores')}</div>`;
    } else {
      let currentRank = 1;
      indList.forEach((s, idx) => {
        if (idx > 0 && s.score < indList[idx - 1].score) {
          currentRank = idx + 1;
        }
        s.rank = currentRank;
        const item = document.createElement('div');
        item.className = 'leader-item';
        const rankClass = s.rank === 1 ? 'rank-1' : s.rank === 2 ? 'rank-2' : s.rank === 3 ? 'rank-3' : '';
        const badgeEmoji = s.rank === 1 ? '🥇' : s.rank === 2 ? '🥈' : s.rank === 3 ? '🥉' : `${s.rank}`;

        const prev = prevDashStudentScoresMap[s.id];
        let animClass = '';
        if (prev !== undefined && prev !== null) {
          if (s.score > prev) animClass = 'score-animate-up';
          else if (s.score < prev) animClass = 'score-animate-down';
        }

        const numPrefix = isEn ? `No. ${s.student_number}` : `${s.student_number}號`;
        const groupText = s.group_name || (isEn ? 'Unassigned' : '未分組');
        const detailBtnText = t('dash_log_detail_btn');

        item.style.cursor = 'pointer';
        item.innerHTML = `
          <div style="display: flex; align-items: center; gap: 12px;">
            <div class="leader-rank ${rankClass}">${badgeEmoji}</div>
            <div style="width: 34px; height: 34px; border-radius: 50%; overflow: hidden; flex-shrink: 0;">
              ${getStudentAvatarImgHtml(s)}
            </div>
            <div>
              <div style="font-weight: 800; font-size: 1rem;">${numPrefix} ${getStudentDisplayName(s)}</div>
              <div style="font-size: 0.76rem; color: var(--text-muted); font-weight: 600;">${groupText}</div>
            </div>
          </div>
          <div style="display: flex; align-items: center; gap: 8px;">
            <div class="${animClass}" style="font-weight: 900; font-size: 1.15rem; color: #d3a24c; display: inline-block;">${s.score} ${t('pts')}</div>
            <button class="btn btn-secondary btn-log-detail" style="font-size: 0.75rem; padding: 3px 9px; border-radius: var(--radius-full);" title="${detailBtnText}">${detailBtnText}</button>
          </div>
        `;
        item.querySelector('.btn-log-detail').onclick = (e) => {
          e.stopPropagation();
          openStudentScoreLogsModal(s.id);
        };
        item.onclick = () => openStudentScoreLogsModal(s.id);
        indContainer.appendChild(item);
      });
    }
  }

  // 2. 小組榮譽排行榜 (0 分不列入排名, 同分並列)
  const grpContainer = document.getElementById('group-leaderboard');
  if (grpContainer) {
    grpContainer.innerHTML = '';
    const grpList = (data.group_leaderboard || []).filter(g => g.total_score > 0);
    if (grpList.length === 0) {
      grpContainer.innerHTML = `<div style="text-align: center; color: var(--text-muted); padding: 30px; font-weight: 600;">${t('dash_no_group_scores')}</div>`;
    } else {
      let currentRank = 1;
      grpList.forEach((g, idx) => {
        if (idx > 0 && g.total_score < grpList[idx - 1].total_score) {
          currentRank = idx + 1;
        }
        g.rank = currentRank;
        const item = document.createElement('div');
        item.className = 'leader-item';
        const rankClass = g.rank === 1 ? 'rank-1' : g.rank === 2 ? 'rank-2' : g.rank === 3 ? 'rank-3' : '';
        const badgeEmoji = g.rank === 1 ? '🥇' : g.rank === 2 ? '🥈' : g.rank === 3 ? '🥉' : `${g.rank}`;

        const prevGrp = prevDashGroupScoresMap[g.group_name];
        let animClass = '';
        if (prevGrp !== undefined && prevGrp !== null) {
          if (g.total_score > prevGrp) animClass = 'score-animate-up';
          else if (g.total_score < prevGrp) animClass = 'score-animate-down';
        }

        const memberText = isEn ? `(${g.member_count} students)` : `(${g.member_count}人)`;
        const totalText = isEn ? `${g.total_score} pts` : `${g.total_score} 分`;

        item.innerHTML = `
          <div style="display: flex; align-items: center; gap: 12px;">
            <div class="leader-rank ${rankClass}">${badgeEmoji}</div>
            <div style="width: 38px; height: 38px; border-radius: 8px; background: rgba(255,255,255,0.06); display: flex; align-items: center; justify-content: center; flex-shrink: 0; padding: 2px;">
              <img src="${getGroupAvatarSrc(g, idx)}" alt="${g.group_name}" style="width: 32px; height: 32px; object-fit: contain;">
            </div>
            <div>
              <div style="font-weight: 800; font-size: 1rem;">${g.group_name} <span style="font-size: 0.8rem; color: var(--text-muted); font-weight: normal;">${memberText}</span></div>
            </div>
          </div>
          <div class="${animClass}" style="font-weight: 900; font-size: 1.18rem; color: #d3a24c; display: inline-block;">${totalText}</div>
        `;
        grpContainer.appendChild(item);
      });
    }
  }

  // 3. 全班座號得分一覽表 (依座號 1 ~ N 排序，原地差量更新防抖動與零重繪)
  const allGrid = document.getElementById('all-students-score-grid');
  if (allGrid) {
    const students = data.students || [];
    if (students.length === 0) {
      allGrid.innerHTML = `<div style="text-align: center; color: var(--text-muted); padding: 30px; grid-column: 1 / -1; font-weight: 600;">${t('dash_no_students')}</div>`;
    } else {
      // Check if existing cards match current student list, or the language /
      // name-display-mode changed since the last render — either invalidates the
      // in-place score-only update path below, since student names must re-render too.
      const displaySignature = `${isEn ? 'en' : 'zh'}_${window.I18n ? window.I18n.getNameDisplayMode() : ''}`;
      const existingCards = allGrid.querySelectorAll('.student-score-card');
      const needFullRebuild = existingCards.length !== students.length ||
                              !document.getElementById(`dash-student-card-${students[0].id}`) ||
                              displaySignature !== lastRosterDisplaySignature;
      lastRosterDisplaySignature = displaySignature;

      if (needFullRebuild) {
        allGrid.innerHTML = '';
        students.forEach(s => {
          const card = document.createElement('div');
          const scoreVal = s.score ?? 0;
          const scoreType = scoreVal > 0 ? 'positive' : scoreVal < 0 ? 'negative' : 'neutral';
          const absentClass = s.is_absent ? 'absent' : '';
          const leaveLabel = isEn ? '(Leave)' : '(請假)';
          const absentBadge = s.is_absent ? `<span style="color:#d9807e; font-size:0.72rem; margin-left:4px;">${leaveLabel}</span>` : '';
          const detailBtnText = t('dash_log_detail_btn');

          card.id = `dash-student-card-${s.id}`;
          card.className = `student-score-card ${absentClass}`;
          card.style.cursor = 'pointer';
          card.innerHTML = `
            <div class="student-score-num-badge">${s.student_number}</div>
            <div class="student-score-center-content">
              <div class="student-score-avatar-sec">
                <div class="student-score-avatar">
                  ${getStudentAvatarImgHtml(s)}
                </div>
              </div>
              <div class="student-score-name-sec">
                <div class="student-score-name" title="${getStudentDisplayName(s)}">${getStudentDisplayName(s)}${absentBadge}</div>
              </div>
              <div class="student-score-val-sec">
                <div id="dash-student-score-${s.id}" class="student-score-badge ${scoreType}">
                  ${scoreVal}
                </div>
              </div>
            </div>
            <button class="btn btn-secondary btn-log-detail" style="position: absolute; top: 6px; right: 6px; font-size: 0.65rem; padding: 1px 6px; border-radius: var(--radius-full); opacity: 0.8; z-index: 5;" title="${detailBtnText}">${detailBtnText}</button>
          `;
          card.querySelector('.btn-log-detail').onclick = (e) => {
            e.stopPropagation();
            openStudentScoreLogsModal(s.id);
          };
          card.onclick = () => openStudentScoreLogsModal(s.id);
          allGrid.appendChild(card);
        });
      } else {
        // In-Place Update: 原地更新學生分數與請假狀態，避免整頁重繪
        students.forEach(s => {
          const scoreEl = document.getElementById(`dash-student-score-${s.id}`);
          const cardEl = document.getElementById(`dash-student-card-${s.id}`);
          const scoreVal = s.score ?? 0;
          const prev = prevDashStudentScoresMap[s.id];
          const scoreType = scoreVal > 0 ? 'positive' : scoreVal < 0 ? 'negative' : 'neutral';

          if (cardEl) {
            cardEl.classList.toggle('absent', Boolean(s.is_absent));
          }

          if (scoreEl) {
            const currentText = scoreEl.textContent.trim();
            // 當 DOM 數值與當前時段分數不一致，或分數有變動時，即刻同步更新
            if (currentText !== String(scoreVal) || (prev !== undefined && prev !== null && scoreVal !== prev)) {
              const hasPrev = prev !== undefined && prev !== null;
              const animClass = hasPrev && scoreVal > prev ? 'score-animate-up' : (hasPrev && scoreVal < prev ? 'score-animate-down' : '');
              
              scoreEl.textContent = `${scoreVal}`;
              scoreEl.className = `student-score-badge ${scoreType} ${animClass}`.trim();
              
              if (animClass) {
                setTimeout(() => {
                  if (scoreEl) {
                    scoreEl.className = `student-score-badge ${scoreType}`;
                  }
                }, 850);
              }
            }
          }
        });
      }
    }
  }

  // Update previous dashboard scores map
  (data.students || []).forEach(s => {
    prevDashStudentScoresMap[s.id] = s.score ?? 0;
  });
  (data.group_leaderboard || []).forEach(g => {
    prevDashGroupScoresMap[g.group_name] = g.total_score ?? 0;
  });
}

// --- Big Screen Projection View (📺 大螢幕即時看板 - 獨立純淨 App 應用程式新視窗) ---
function openBigScreenProjection(opts = {}) {
  if (!ensureCourseSelected()) return;
  // 從即時評分頁開啟時，沿用評分頁目前的統計時段（當天／當週／當月）；指定期間則改用儀表板的設定
  const scoringPeriod = AppState.scoringPeriod;
  const period = opts.fromScoring && ['today', 'week', 'month'].includes(scoringPeriod)
    ? scoringPeriod
    : AppState.dashboardPeriod;
  const url = `/projection?course_id=${AppState.currentCourseId}&period=${period}&mode=${AppState.dashboardViewMode}`;
  const width = screen.availWidth || 1920;
  const height = screen.availHeight || 1080;
  // 透過 popup=yes 與各項 menubar/toolbar/location=no 參數開啟隱藏網址列與功能選單的純淨獨立視窗
  const windowFeatures = `popup=yes,width=${width},height=${height},left=0,top=0,menubar=no,toolbar=no,location=no,status=no,personalbar=no,directories=no,resizable=yes,scrollbars=no`;
  
  const projWin = window.open(url, 'KYPS_Classroom_Projection_Window', windowFeatures);
  if (projWin) {
    projWin.focus();
  }
}

function closeBigScreenProjection() {
  const overlay = document.getElementById('big-screen-projection-overlay');
  overlay.classList.remove('open');

  if (document.exitFullscreen && document.fullscreenElement) {
    try { document.exitFullscreen(); } catch (e) {}
  }

  if (projectionTimerId) {
    clearInterval(projectionTimerId);
    projectionTimerId = null;
  }
}

// Helper function to render Olympic Podium (頒獎台) Stage and Rank 4+ list in Big Screen
function renderPodiumStageAndList(list, isGroup = false) {
  const stage = document.getElementById('proj-podium-stage');
  const runnerList = document.getElementById('proj-runners-up-list');
  if (!stage || !runnerList) return;

  stage.innerHTML = '';
  runnerList.innerHTML = '';

  // 1. Filter out items with score <= 0 (0 分不列入排名)
  const activeList = (list || []).filter(item => {
    const scoreVal = isGroup ? item.total_score : item.score;
    return typeof scoreVal === 'number' && scoreVal > 0;
  });

  // 2. Assign tied rankings (同分並列排名)
  let currentRank = 1;
  const rankedList = activeList.map((item, idx) => {
    const currScore = isGroup ? item.total_score : item.score;
    if (idx > 0) {
      const prevScore = isGroup ? activeList[idx - 1].total_score : activeList[idx - 1].score;
      if (currScore < prevScore) {
        currentRank = idx + 1; // Standard competition ranking: e.g. 1, 1, 3
      }
    }
    return {
      ...item,
      rank: currentRank
    };
  });

  const rank1 = rankedList[0] || null;
  const rank2 = rankedList[1] || null;
  const rank3 = rankedList[2] || null;
  const runners = rankedList.slice(3);

  // Helper to build Podium Step HTML
  function getStepHtml(pedestalIndex, item, pedestalClass, defaultMedalEmoji) {
    if (!item) {
      return `
        <div class="podium-step ${pedestalClass}" style="opacity: 0.35;">
          <div class="podium-winner-info">
            <div class="podium-avatar-wrapper">
              <div class="podium-avatar">👤</div>
            </div>
            <div class="podium-name">虛位以待</div>
            <div class="podium-subtitle">-</div>
            <div class="podium-score">- 分</div>
          </div>
          <div class="podium-block">
            <div class="podium-rank-label">${pedestalIndex}</div>
            <div class="podium-rank-text">${defaultMedalEmoji}</div>
          </div>
        </div>
      `;
    }

    const rankNum = item.rank;
    const crown = (rankNum === 1);
    const rankTitle = rankNum === 1 ? '🥇 冠軍' : rankNum === 2 ? '🥈 亞軍' : rankNum === 3 ? '🥉 季軍' : `第 ${rankNum} 名`;
    const title = isGroup ? item.group_name : `${item.student_number}號 ${item.name}`;
    const subtitle = isGroup ? `${item.member_count} 位組員 (平均: ${item.avg_score}分)` : (item.group_name || '未分組');
    const scoreVal = isGroup ? item.total_score : item.score;
    const avatarHtml = isGroup 
      ? `<div style="width: 100%; height: 100%; display: flex; align-items: center; justify-content: center; padding: 6px;"><img src="${getGroupAvatarSrc(item)}" alt="${item.group_name}" style="width: 100%; height: 100%; object-fit: contain;"></div>`
      : getStudentAvatarImgHtml(item);

    const prevScore = isGroup ? prevGroupScoresMap[item.group_name] : prevStudentScoresMap[item.id];
    let animClass = '';
    if (prevScore !== undefined && prevScore !== null) {
      if (scoreVal > prevScore) animClass = 'score-animate-up';
      else if (scoreVal < prevScore) animClass = 'score-animate-down';
    }

    return `
      <div class="podium-step ${pedestalClass}">
        <div class="podium-winner-info">
          <div class="podium-avatar-wrapper">
            ${crown ? '<div class="podium-crown">👑</div>' : ''}
            <div class="podium-avatar">
              ${avatarHtml}
            </div>
          </div>
          <div class="podium-name" title="${title}">${title}</div>
          <div class="podium-subtitle">${subtitle}</div>
          <div class="podium-score ${animClass}">${scoreVal} 分</div>
        </div>
        <div class="podium-block">
          <div class="podium-rank-label">${rankNum}</div>
          <div class="podium-rank-text">${rankTitle}</div>
        </div>
      </div>
    `;
  }

  // Build stage with Olympic layout: 2nd (Left), 1st (Center), 3rd (Right)
  stage.innerHTML = `
    ${getStepHtml(2, rank2, 'podium-step-2', '🥈 亞軍')}
    ${getStepHtml(1, rank1, 'podium-step-1', '🥇 冠軍')}
    ${getStepHtml(3, rank3, 'podium-step-3', '🥉 季軍')}
  `;

  // Build runner-ups list (Rank 4+)
  if (runners.length === 0) {
    const emptyNotice = rankedList.length === 0 
      ? '目前尚無得分紀錄，虛位以待！' 
      : '無其他名次紀錄';
    runnerList.innerHTML = `<div style="color: #64748b; text-align: center; padding: 20px; grid-column: 1 / -1; font-weight: 600;">${emptyNotice}</div>`;
  } else {
    runners.forEach((item) => {
      const rankNum = item.rank;
      const medalEmoji = rankNum === 1 ? '🥇' : rankNum === 2 ? '🥈' : rankNum === 3 ? '🥉' : `${rankNum}`;
      const title = isGroup ? item.group_name : `${item.student_number}號 ${item.name}`;
      const subtitle = isGroup ? `${item.member_count} 位組員 (組平均: ${item.avg_score}分)` : (item.group_name || '未分組');
      const scoreVal = isGroup ? item.total_score : item.score;
      const avatarHtml = isGroup 
        ? `<div style="width: 38px; height: 38px; display: flex; align-items: center; justify-content: center; flex-shrink: 0;"><img src="${getGroupAvatarSrc(item, rankNum - 1)}" alt="${item.group_name}" style="width: 34px; height: 34px; object-fit: contain;"></div>`
        : `<div style="width: 38px; height: 38px; border-radius: 50%; overflow: hidden; flex-shrink: 0;">${getStudentAvatarImgHtml(item)}</div>`;

      const prevScore = isGroup ? prevGroupScoresMap[item.group_name] : prevStudentScoresMap[item.id];
      let animClass = '';
      let flashClass = '';
      if (prevScore !== undefined && prevScore !== null) {
        if (scoreVal > prevScore) {
          animClass = 'score-animate-up';
          flashClass = 'card-flash-up';
        } else if (scoreVal < prevScore) {
          animClass = 'score-animate-down';
          flashClass = 'card-flash-down';
        }
      }

      const div = document.createElement('div');
      div.className = `proj-item ${flashClass}`;
      div.innerHTML = `
        <div style="display: flex; align-items: center; gap: 14px;">
          <div class="proj-rank">${medalEmoji}</div>
          ${avatarHtml}
          <div>
            <div style="font-weight: 800;">${title}</div>
            <div style="font-size: 0.82rem; color: #94a3b8;">${subtitle}</div>
          </div>
        </div>
        <div class="proj-score ${animClass}">${scoreVal} 分</div>
      `;
      runnerList.appendChild(div);
    });
  }
}

// Render All Students Score Grid for Big Screen View
function renderProjAllStudentsGrid(students) {
  const container = document.getElementById('proj-all-students-grid');
  if (!container) return;
  container.innerHTML = '';

  if (students.length === 0) {
    container.innerHTML = '<div style="color: #94a3b8; text-align: center; padding: 30px; grid-column: 1 / -1; font-size: 1.2rem; font-weight: 700;">目前無學生資料</div>';
    return;
  }

  students.forEach(s => {
    const card = document.createElement('div');
    const prev = prevStudentScoresMap[s.id];
    let animClass = '';
    let flashClass = '';
    if (prev !== undefined && prev !== null) {
      if (s.score > prev) {
        animClass = 'score-animate-up';
        flashClass = 'card-flash-up';
      } else if (s.score < prev) {
        animClass = 'score-animate-down';
        flashClass = 'card-flash-down';
      }
    }

    const scoreType = s.score > 0 ? 'positive' : s.score < 0 ? 'negative' : 'neutral';
    const scorePrefix = s.score > 0 ? '+' : '';
    const absentClass = s.is_absent ? 'absent' : '';
    const absentBadge = s.is_absent ? '<span style="color:#f87171; font-size:0.8rem; margin-left:4px;">(請假)</span>' : '';

    card.className = `proj-score-card ${absentClass} ${flashClass}`;
    card.innerHTML = `
      <div style="display: flex; align-items: center; gap: 12px; min-width: 0;">
        <div class="proj-score-num-badge">${String(s.student_number).padStart(2, '0')}</div>
        <div class="proj-score-avatar">
          ${getStudentAvatarImgHtml(s)}
        </div>
        <div style="min-width: 0;">
          <div class="proj-score-name" title="${s.name}">${s.name}${absentBadge}</div>
          <div class="proj-score-sub">${s.group_name || '未分組'}</div>
        </div>
      </div>
      <div class="proj-score-badge ${scoreType} ${animClass}">
        ${scorePrefix}${s.score}
      </div>
    `;
    container.appendChild(card);
  });
}

async function refreshProjectionData(force = false) {
  if (!AppState.currentCourseId) return;
  try {
    let url = `/api/reports/${AppState.currentCourseId}/dashboard?period=${AppState.dashboardPeriod}`;
    let rangeStr = '';
    if (AppState.dashboardPeriod === 'range') {
      const s = document.getElementById('dash-start-date').value;
      const e = document.getElementById('dash-end-date').value;
      if (s) url += `&start_date=${s}`;
      if (e) url += `&end_date=${e}`;
      rangeStr = `${s}_${e}`;
    }

    const data = await API.get(url);

    // Update course title if changed
    const currentCourse = AppState.courses.find(c => c.id === AppState.currentCourseId);
    if (currentCourse) {
      const titleEl = document.getElementById('proj-course-title');
      const expectedTitle = `${currentCourse.name} - 即時看板`;
      if (titleEl && titleEl.textContent !== expectedTitle) {
        titleEl.textContent = expectedTitle;
      }
    }

    // Update Period Tag label if changed
    const t = (k, p) => window.I18n ? window.I18n.t(k, p) : k;
    const labels = {
      today: t('proj_period_today'),
      week: t('proj_period_week'),
      month: t('proj_period_month'),
      range: t('proj_period_range'),
      semester: t('proj_period_semester')
    };
    const periodLabelEl = document.getElementById('proj-period-label');
    const expectedLabel = labels[AppState.dashboardPeriod] || t('proj_period_today');
    if (periodLabelEl && periodLabelEl.textContent !== expectedLabel) {
      periodLabelEl.textContent = expectedLabel;
    }

    // Compute fingerprint to detect if data has truly changed in big screen view
    const fingerprint = computeDataFingerprint(data, {
      courseId: AppState.currentCourseId,
      period: AppState.dashboardPeriod,
      range: rangeStr,
      mode: AppState.projectionViewMode
    });

    // If data didn't change and not forced, skip DOM re-render completely!
    if (!force && fingerprint === lastProjectionFingerprint) {
      return;
    }

    lastProjectionFingerprint = fingerprint;

    // Toggle container views based on projectionViewMode
    const podiumContainer = document.getElementById('proj-podium-view-container');
    const allStudentsContainer = document.getElementById('proj-all-students-container');

    if (AppState.projectionViewMode === 'all') {
      if (podiumContainer) podiumContainer.style.display = 'none';
      if (allStudentsContainer) allStudentsContainer.style.display = 'block';
      renderProjAllStudentsGrid(data.students || []);
    } else {
      if (podiumContainer) podiumContainer.style.display = 'flex';
      if (allStudentsContainer) allStudentsContainer.style.display = 'none';

      if (AppState.projectionViewMode === 'group') {
        renderPodiumStageAndList(data.group_leaderboard || [], true);
      } else {
        renderPodiumStageAndList(data.individual_leaderboard || [], false);
      }
    }

    // Update scores snapshot
    (data.students || []).forEach(s => {
      prevStudentScoresMap[s.id] = s.score;
    });
    (data.group_leaderboard || []).forEach(g => {
      prevGroupScoresMap[g.group_name] = g.total_score;
    });
  } catch (err) {
    console.error('Projection refresh error:', err);
  }
}
