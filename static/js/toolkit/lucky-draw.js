// 課堂工具箱：隨機抽籤
// 由 static/js/toolkit.js 拆出（2026-10-30），程式內容未變更。載入順序見 static/index.html；
// 模組之間透過 window.ToolkitModules 取用彼此（toolkit/common.js 建立）。
(function (window) {
  'use strict';
  const TK = window.ToolkitModules;
  const AudioEngine = window.AudioEngine;

  // =========================================================================
  // 3. LuckyDraw (隨機抽籤 - 單一焦點大卡片持續高速切換)
  // =========================================================================
  const LuckyDraw = {
    students: [],
    groups: [],
    drawnStudentIds: new Set(),
    isRolling: false,

    init() {
      const btnStart = document.getElementById('btn-start-lucky-draw');
      if (btnStart) {
        btnStart.addEventListener('click', () => this.startDraw());
      }

      const modeSelect = document.getElementById('lucky-draw-mode');
      if (modeSelect) {
        modeSelect.addEventListener('change', () => {
          this.updateUI();
          this.resetSpotlightCard();
        });
      }

      const btnResetPool = document.getElementById('btn-reset-draw-pool');
      if (btnResetPool) {
        btnResetPool.addEventListener('click', () => this.resetPool());
      }

      const excludeCheck = document.getElementById('lucky-draw-exclude-drawn');
      if (excludeCheck) {
        excludeCheck.addEventListener('change', () => {
          this.updatePoolCountBadge();
        });
      }

      this.updateUI();
      this.updatePoolCountBadge();
    },

    setStudents(studentList) {
      this.students = studentList || [];
      this.updatePoolCountBadge();
    },

    setGroups(groupList) {
      this.groups = groupList || [];
      this.updatePoolCountBadge();
    },

    resetPool() {
      this.drawnStudentIds.clear();
      this.updatePoolCountBadge();
      this.resetSpotlightCard();
      const toast = window.I18n ? window.I18n.t('draw_pool_reset_done') : '已重置抽籤池！全班學生皆可重新被抽取。';
      if (window.showToast) window.showToast(toast, 'info');
    },

    updatePoolCountBadge() {
      const badge = document.getElementById('lucky-draw-pool-badge');
      if (!badge) return;

      const mode = document.getElementById('lucky-draw-mode')?.value || 'student';
      const isEn = window.I18n && window.I18n.getLanguage() === 'en';

      if (mode === 'group') {
        const total = this.groups.length || 0;
        badge.textContent = isEn ? `Pool: ${total} teams total` : `抽籤池：共 ${total} 個小組`;
        return;
      }

      // Absent/on-leave students are never in the draw pool, so the "total"
      // shown here already excludes them — not just the "remaining" count.
      const eligible = this.students.filter(s => !s.is_absent);
      const total = eligible.length;
      const absentCount = this.students.length - total;
      const drawn = eligible.filter(s => this.drawnStudentIds.has(s.id)).length;
      const remaining = Math.max(0, total - drawn);

      if (isEn) {
        badge.textContent = `Pool: ${remaining} / ${total} students left` + (absentCount > 0 ? ` (${absentCount} absent)` : '');
      } else {
        badge.textContent = `抽籤池：剩餘 ${remaining} / 共 ${total} 人` + (absentCount > 0 ? `（未出席 ${absentCount} 人）` : '');
      }
    },

    updateUI() {
      const mode = document.getElementById('lucky-draw-mode')?.value || 'student';
      const excludeWrapper = document.getElementById('lucky-draw-exclude-wrapper');
      const countInput = document.getElementById('lucky-draw-count');

      if (excludeWrapper) {
        excludeWrapper.style.display = mode === 'student' ? 'inline-flex' : 'none';
      }

      if (countInput) {
        if (mode === 'group') {
          countInput.max = Math.max(1, this.groups.length || 1);
        } else {
          const eligibleCount = this.students.filter(s => !s.is_absent).length;
          countInput.max = Math.max(1, eligibleCount || 1);
        }
      }
      this.updatePoolCountBadge();
    },

    resetSpotlightCard() {
      const singleCard = document.getElementById('lucky-draw-single-card');
      const multiGrid = document.getElementById('lucky-draw-multi-grid');
      if (singleCard) {
        singleCard.style.display = 'flex';
        singleCard.classList.remove('rolling', 'winner');
      }
      if (multiGrid) {
        multiGrid.style.display = 'none';
        multiGrid.innerHTML = '';
      }

      const avatarWrap = document.getElementById('lucky-card-avatar-container');
      const avatarImg = document.getElementById('lucky-card-avatar-img');
      const seatBadge = document.getElementById('lucky-card-seat-badge');
      const nameLabel = document.getElementById('lucky-card-name-label');
      const subLabel = document.getElementById('lucky-card-sub-label');

      const mode = document.getElementById('lucky-draw-mode')?.value || 'student';
      const isEn = window.I18n && window.I18n.getLanguage() === 'en';

      if (avatarWrap) {
        avatarWrap.className = 'lucky-spotlight-avatar-wrap' + (mode === 'group' ? ' group' : '');
      }
      if (avatarImg) {
        avatarImg.src = mode === 'group' ? '/static/pic/animals/penguin.png' : '/static/avatars/boy.png';
      }
      if (seatBadge) {
        seatBadge.textContent = 'READY';
      }
      if (nameLabel) {
        nameLabel.textContent = isEn ? 'Ready to Draw' : '準備抽籤';
      }
      if (subLabel) {
        subLabel.textContent = isEn ? 'Click below to start' : '點擊下方按鈕開始';
      }
    },

    renderSpotlightCard(item, mode) {
      const avatarWrap = document.getElementById('lucky-card-avatar-container');
      const avatarImg = document.getElementById('lucky-card-avatar-img');
      const seatBadge = document.getElementById('lucky-card-seat-badge');
      const nameLabel = document.getElementById('lucky-card-name-label');
      const subLabel = document.getElementById('lucky-card-sub-label');

      if (!item) return;
      const isEn = window.I18n && window.I18n.getLanguage() === 'en';

      if (mode === 'student') {
        const displayName = window.I18n ? window.I18n.getStudentDisplayName(item) : (item.name || item.student_name || '');
        const gender = item.gender || 'M';
        const isFemale = gender === 'female' || gender === 'F' || gender === '女';
        const fallbackAvatar = isFemale ? '/static/avatars/girl.png' : '/static/avatars/boy.png';
        const code = item.student_code || item.student_id;
        const codeStr = code ? String(code).trim() : '';
        const num = item.student_number || item.seat_number;
        const hasNoPhoto = item.has_photo === false || (codeStr && window.StudentPhotoCache && window.StudentPhotoCache.missing.has(codeStr));
        const primaryPhoto = (codeStr && !hasNoPhoto) ? `/photo/${encodeURIComponent(codeStr)}.jpg` : fallbackAvatar;

        if (avatarWrap) avatarWrap.className = 'lucky-spotlight-avatar-wrap';
        if (avatarImg) {
          avatarImg.onerror = function() {
            if (codeStr && window.StudentPhotoCache) window.StudentPhotoCache.missing.add(codeStr);
            this.onerror = null;
            this.src = fallbackAvatar;
          };
          avatarImg.src = primaryPhoto;
          avatarImg.alt = displayName;
        }
        if (seatBadge) seatBadge.textContent = `#${num || ''}`;
        if (nameLabel) nameLabel.textContent = displayName;
        if (subLabel) subLabel.textContent = isEn ? 'Candidate' : '候選學生';
      } else {
        // Group mode
        const groupName = item.group_name || item.name || '小組';
        let icon = item.icon_url || item.group_icon_url || item.custom_icon_url;
        if (!icon && typeof window.getGroupAvatarSrc === 'function') {
          icon = window.getGroupAvatarSrc(item);
        }
        if (!icon) icon = '/static/pic/animals/penguin.png';

        if (avatarWrap) avatarWrap.className = 'lucky-spotlight-avatar-wrap group';
        if (avatarImg) {
          avatarImg.onerror = null;
          avatarImg.src = icon;
          avatarImg.alt = groupName;
        }
        if (seatBadge) seatBadge.textContent = 'TEAM';
        if (nameLabel) nameLabel.textContent = groupName;
        if (subLabel) subLabel.textContent = isEn ? 'Candidate Team' : '候選小組';
      }
    },

    renderMultiWinners(winners, mode) {
      const singleCard = document.getElementById('lucky-draw-single-card');
      const multiGrid = document.getElementById('lucky-draw-multi-grid');
      if (singleCard) singleCard.style.display = 'none';
      if (!multiGrid) return;

      multiGrid.innerHTML = '';
      multiGrid.style.display = 'flex';

      const isEn = window.I18n && window.I18n.getLanguage() === 'en';
      const badgeText = isEn ? '🎤 Presenter' : '🎤 請上台';

      winners.forEach((w, idx) => {
        const card = document.createElement('div');
        card.className = 'lucky-multi-card';
        card.style.animationDelay = `${idx * 0.08}s`;

        if (mode === 'student') {
          const displayName = window.I18n ? window.I18n.getStudentDisplayName(w) : (w.name || w.student_name || '');
          const gender = w.gender || 'M';
          const isFemale = gender === 'female' || gender === 'F' || gender === '女';
          const fallbackAvatar = isFemale ? '/static/avatars/girl.png' : '/static/avatars/boy.png';
          const code = w.student_code || w.student_id;
          const codeStr = code ? String(code).trim() : '';
          const num = w.student_number || w.seat_number;
          const hasNoPhoto = w.has_photo === false || (codeStr && window.StudentPhotoCache && window.StudentPhotoCache.missing.has(codeStr));
          const primaryPhoto = (codeStr && !hasNoPhoto) ? `/photo/${encodeURIComponent(codeStr)}.jpg` : fallbackAvatar;
          const onerrorChain = `if(window.StudentPhotoCache&&'${codeStr}')window.StudentPhotoCache.missing.add('${codeStr}');this.onerror=null;this.src='${fallbackAvatar}';`;

          card.innerHTML = `
            <div class="lucky-multi-badge">${badgeText} #${idx + 1}</div>
            <div class="lucky-multi-avatar-wrap">
              <img src="${primaryPhoto}" onerror="${onerrorChain}" class="lucky-multi-avatar" alt="${displayName}">
            </div>
            <div class="lucky-multi-seat">#${num || ''}</div>
            <div class="lucky-multi-name" title="${displayName}">${displayName}</div>
          `;
        } else {
          // Group
          const groupName = w.group_name || w.name || '小組';
          let icon = w.icon_url || w.group_icon_url || w.custom_icon_url;
          if (!icon && typeof window.getGroupAvatarSrc === 'function') {
            icon = window.getGroupAvatarSrc(w);
          }
          if (!icon) icon = '/static/pic/animals/penguin.png';

          card.innerHTML = `
            <div class="lucky-multi-badge">${badgeText} #${idx + 1}</div>
            <div class="lucky-multi-avatar-wrap group">
              <img src="${icon}" class="lucky-multi-avatar" alt="${groupName}">
            </div>
            <div class="lucky-multi-seat">小組</div>
            <div class="lucky-multi-name" title="${groupName}">${groupName}</div>
          `;
        }

        multiGrid.appendChild(card);
      });
    },

    async startDraw() {
      if (this.isRolling) return;
      const mode = document.getElementById('lucky-draw-mode')?.value || 'student';
      const count = parseInt(document.getElementById('lucky-draw-count')?.value, 10) || 1;
      const excludeDrawn = document.getElementById('lucky-draw-exclude-drawn')?.checked ?? true;

      const singleCard = document.getElementById('lucky-draw-single-card');
      const multiGrid = document.getElementById('lucky-draw-multi-grid');
      if (singleCard) {
        singleCard.style.display = 'flex';
        singleCard.classList.remove('winner', 'rolling');
      }
      if (multiGrid) {
        multiGrid.style.display = 'none';
        multiGrid.innerHTML = '';
      }

      if (mode === 'student') {
        // Today's absent/on-leave students are never eligible to be drawn.
        let pool = this.students.filter(s => !s.is_absent);
        if (excludeDrawn) {
          pool = pool.filter(s => !this.drawnStudentIds.has(s.id));
        }

        if (pool.length === 0) {
          const title = window.I18n ? window.I18n.t('draw_pool_empty_prompt') : '抽籤池已抽完';
          const desc = window.I18n ? window.I18n.t('draw_pool_empty_desc') : '所有符合條件的學生都已經抽過了，按「確定」重置抽籤池，即可讓所有學生重新回到抽籤名單。';
          const confirmed = window.showConfirmModal
            ? await window.showConfirmModal({ icon: '🔄', title, desc })
            : confirm(`${title}\n${desc}`);
          if (confirmed) {
            this.resetPool();
            this.startDraw();
          }
          return;
        }

        const pickCount = Math.min(count, pool.length);
        this.runSingleCardShuffleAnimation(pool, pickCount, 'student');
      } else {
        // Group mode
        if (this.groups.length === 0) {
          const noGrpMsg = window.I18n ? window.I18n.t('draw_no_groups') : '目前尚未建立任何小組！請先至彈性分組設定。';
          if (window.showAlertModal) {
            await window.showAlertModal({ icon: '⚠️', title: noGrpMsg });
          } else {
            alert(noGrpMsg);
          }
          return;
        }
        const pickCount = Math.min(count, this.groups.length);
        this.runSingleCardShuffleAnimation(this.groups, pickCount, 'group');
      }
    },

    runSingleCardShuffleAnimation(pool, pickCount, mode) {
      this.isRolling = true;
      AudioEngine.playAttention();

      const card = document.getElementById('lucky-draw-single-card');
      if (card) {
        card.style.display = 'flex';
        card.classList.add('rolling');
      }

      const isEn = window.I18n && window.I18n.getLanguage() === 'en';

      // Rapid shuffle sequence with gradual deceleration
      const delays = [
        40, 40, 40, 40, 45, 45, 45, 50, 50, 55, 60, 70, 80, 95, 115, 140, 175, 215, 265, 330, 420, 540
      ];

      let stepIndex = 0;

      const shuffleNext = () => {
        if (stepIndex < delays.length) {
          // Switch to a random candidate on the single card
          const randItem = pool[Math.floor(Math.random() * pool.length)];
          this.renderSpotlightCard(randItem, mode);

          const isFast = stepIndex < delays.length - 6;
          AudioEngine.playTick(isFast);

          const delay = delays[stepIndex];
          stepIndex++;
          setTimeout(shuffleNext, delay);
        } else {
          // Fisher-Yates shuffle to pick final winners
          const shuffled = [...pool].sort(() => 0.5 - Math.random());
          const winners = shuffled.slice(0, pickCount);

          if (winners.length > 1) {
            // Multiple winners: render showcase grid directly on stage!
            this.renderMultiWinners(winners, mode);
          } else {
            // Single winner: show spotlight card with victory glow
            if (card) {
              card.style.display = 'flex';
              card.classList.remove('rolling');
              card.classList.add('winner');
            }
            this.renderSpotlightCard(winners[0], mode);

            const subLabel = document.getElementById('lucky-card-sub-label');
            if (subLabel) {
              subLabel.textContent = isEn ? '🎯 Selected Presenter!' : '🎯 恭喜中籤！請上台發表';
            }
          }

          if (mode === 'student') {
            winners.forEach(w => this.drawnStudentIds.add(w.id));
          }

          // 由教師手機發起的抽籤：把結果回傳給手機與大螢幕（由電腦端抽，確保抽籤池只有一份）
          if (this._remoteDraw) {
            this._remoteDraw = false;
            if (typeof window.sendCourseToolkitAction === 'function') {
              window.sendCourseToolkitAction('draw', {
                mode,
                winners: winners.map(w => (mode === 'group'
                  ? { group_name: w.group_name, icon_url: w.icon_url }
                  : { id: w.id, student_number: w.student_number, name: w.name, english_name: w.english_name, gender: w.gender })),
              });
            }
          }

          this.updatePoolCountBadge();
          AudioEngine.playVictory();
          this.isRolling = false;

          // Open winner modal after 750ms for presentation display
          setTimeout(() => {
            this.showWinnerModal(winners, mode);
          }, 750);
        }
      };

      shuffleNext();
    },

    showWinnerModal(winners, mode) {
      const modal = document.getElementById('modal-lucky-draw-result');
      const listContainer = document.getElementById('lucky-draw-winners-list');
      if (!modal || !listContainer) return;

      listContainer.innerHTML = '';

      const t = (k, p) => window.I18n ? window.I18n.t(k, p) : k;

      winners.forEach(w => {
        const itemEl = document.createElement('div');
        itemEl.className = 'lucky-winner-item';

        if (mode === 'student') {
          const displayName = window.I18n ? window.I18n.getStudentDisplayName(w) : (w.name || w.student_name || '');
          const gender = w.gender || 'M';
          const isFemale = gender === 'female' || gender === 'F' || gender === '女';
          const fallbackAvatar = isFemale ? '/static/avatars/girl.png' : '/static/avatars/boy.png';
          const code = w.student_code || w.student_id;
          const num = w.student_number || w.seat_number;
          const primaryPhoto = code ? `/photo/${code}.jpg` : fallbackAvatar;
          const onerrorChain = `this.onerror=null;this.src='${fallbackAvatar}';`;

          itemEl.innerHTML = `
            <img src="${primaryPhoto}" onerror="${onerrorChain}" class="lucky-winner-avatar" alt="${displayName}">
            <div class="lucky-winner-info">
              <span class="lucky-winner-seat">#${num || ''}</span>
              <span class="lucky-winner-name">${displayName}</span>
            </div>
            <div class="lucky-winner-actions">
              <span class="badge" style="background: rgba(123, 152, 224, 0.2); color: #93c5fd; border: 1px solid rgba(123, 152, 224, 0.4); padding: 6px 14px; border-radius: 20px; font-weight: 800; font-size: 0.95rem;">
                ${t('draw_presenter_badge') || '🎤 請上台 / 發表'}
              </span>
            </div>
          `;
        } else {
          // Group
          const groupName = w.group_name || w.name || '小組';
          let icon = w.icon_url || w.group_icon_url || w.custom_icon_url;
          if (!icon && typeof window.getGroupAvatarSrc === 'function') {
            icon = window.getGroupAvatarSrc(w);
          }
          if (!icon) {
            icon = `/static/pic/animals/penguin.png`;
          }

          itemEl.innerHTML = `
            <img src="${icon}" class="lucky-winner-avatar group" alt="${groupName}">
            <div class="lucky-winner-info">
              <span class="lucky-winner-seat">小組</span>
              <span class="lucky-winner-name">${groupName}</span>
            </div>
            <div class="lucky-winner-actions">
              <span class="badge" style="background: rgba(79, 174, 130, 0.2); color: #6ee7b7; border: 1px solid rgba(79, 174, 130, 0.4); padding: 6px 14px; border-radius: 20px; font-weight: 800; font-size: 0.95rem;">
                ${t('draw_team_presenter_badge') || '🎤 小組代表發表'}
              </span>
            </div>
          `;
        }

        listContainer.appendChild(itemEl);
      });

      modal.classList.add('open');
    }
  };

  TK.LuckyDraw = LuckyDraw;
})(window);
