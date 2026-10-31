// MyClass 學生端：紙本小考、組長功能（小組成績、討論紀錄）
// 由 static/js/student.js 拆出（2026-10-31，原第 2626–3139 行），程式內容未變更；縮排保留原樣。
// student.js 與 static/js/student/*.js 共用頁面的全域範圍（一般 <script>），載入順序見 static/student.html。


  // ==========================================================================
  // 紙本小考與小組長模組 (Paper Quizzes & Group Leader)
  // ==========================================================================

  async function checkStudentLeadership() {
    try {
      const data = await api('/api/student/group-leadership');
      if (data && data.is_leader) {
        if (btnContentTabLeader) btnContentTabLeader.style.display = 'inline-flex';
        const titleEl = myGroupCard.querySelector('.my-group-title');
        if (titleEl && !titleEl.querySelector('.leader-badge-pill')) {
          const badge = document.createElement('span');
          badge.className = 'leader-badge-pill';
          badge.style.marginLeft = '8px';
          badge.textContent = '👑 小組長';
          titleEl.appendChild(badge);
        }
      } else {
        if (btnContentTabLeader) btnContentTabLeader.style.display = 'none';
      }
    } catch (e) {
      // ignore
    }
  }

  async function loadStudentQuizzes() {
    const listEl = document.getElementById('studentQuizzesList');
    const emptyEl = document.getElementById('studentQuizzesEmpty');
    if (!listEl) return;

    try {
      const data = await api('/api/student/paper-quizzes');
      const quizzes = data.quizzes || [];

      listEl.innerHTML = '';
      if (quizzes.length === 0) {
        if (emptyEl) emptyEl.style.display = 'block';
        return;
      }
      if (emptyEl) emptyEl.style.display = 'none';

      quizzes.forEach((q) => {
        const card = document.createElement('div');
        card.className = 'student-card';
        card.style.display = 'flex';
        card.style.flexDirection = 'column';
        card.style.gap = '12px';

        const myRec = q.my_record;
        const hasSubmitted = !!myRec;

        function getLeaveName(type) {
          switch (type) {
            case 'sick_leave': case 'absent': return '🤒 病假';
            case 'personal_leave': return '🏠 事假';
            case 'official_leave': return '🏛️ 公假';
            case 'bereavement_leave': return '🖤 喪假';
            default: return '未出席';
          }
        }

        let statusBadgeHtml = '';
        if (hasSubmitted) {
          if (myRec.is_absent) {
            const leaveText = myRec.leave_type ? ` (${getLeaveName(myRec.leave_type)})` : '';
            if (myRec.allow_makeup) {
              statusBadgeHtml = `<span style="font-size:0.8rem; font-weight:700; color:#10b981; background:rgba(16,185,129,0.15); padding:3px 8px; border-radius:12px; border:1px solid rgba(16,185,129,0.3);">🔄 允許補考${leaveText}</span>`;
            } else {
              statusBadgeHtml = `<span style="font-size:0.8rem; font-weight:700; color:var(--accent-negative); background:rgba(239,68,68,0.1); padding:3px 8px; border-radius:12px; border:1px solid rgba(239,68,68,0.25);">❌ 缺考${leaveText}</span>`;
            }
          } else if (myRec.is_verified) {
            const makeupTag = myRec.is_makeup ? ' [補考]' : '';
            statusBadgeHtml = `<span style="font-size:0.8rem; font-weight:700; color:var(--accent-positive); background:rgba(79,174,130,0.15); padding:3px 8px; border-radius:12px; border:1px solid rgba(79,174,130,0.3);">✅ 教師已核准${makeupTag}</span>`;
          } else {
            const makeupTag = myRec.is_makeup ? ' [補考]' : '';
            statusBadgeHtml = `<span style="font-size:0.8rem; font-weight:700; color:#f59e0b; background:rgba(245,158,11,0.15); padding:3px 8px; border-radius:12px; border:1px solid rgba(245,158,11,0.3);">⏳ 待教師查驗${makeupTag}</span>`;
          }
        } else {
          statusBadgeHtml = `<span style="font-size:0.8rem; font-weight:700; color:var(--text-muted); background:rgba(255,255,255,0.05); padding:3px 8px; border-radius:12px;">⚪ 尚未登記</span>`;
        }

        let myScoreDisplayHtml = '';
        if (hasSubmitted && !myRec.is_absent && myRec.score !== null) {
          const isPass = myRec.score >= q.passing_score;
          myScoreDisplayHtml = `
            <div style="display: flex; align-items: baseline; gap: 6px;">
              <span style="font-size: 1.8rem; font-weight: 900; color: ${isPass ? 'var(--accent-positive)' : 'var(--accent-negative)'};">${myRec.score}</span>
              <span style="font-size: 0.9rem; color: var(--text-muted);">/ ${q.max_score} 分</span>
              ${myRec.is_makeup ? '<span style="font-size: 0.8rem; font-weight: 700; color: #10b981; background: rgba(16,185,129,0.12); padding: 2px 6px; border-radius: 4px; margin-left: 6px;">補考成績</span>' : ''}
            </div>
          `;
        }

        let photoPreviewHtml = '';
        if (hasSubmitted && myRec.photo_url) {
          photoPreviewHtml = `
            <div style="display: flex; align-items: center; gap: 8px; margin-top: 6px;">
              <span style="font-size: 0.85rem; color: var(--text-muted);">📷 佐證照片：</span>
              <button type="button" class="btn btn-secondary btn-view-my-photo" data-photo-url="${myRec.photo_url}" data-quiz-title="${escapeHtml(q.title)}" style="font-size: 0.8rem; padding: 4px 10px; border-radius: var(--radius-sm);">
                🔍 查看照片
              </button>
            </div>
          `;
        }

        let entryFormHtml = '';
        if (q.allow_self_entry) {
          if (myRec && myRec.is_absent && !myRec.allow_makeup) {
            const leaveDesc = myRec.leave_type ? `（假別：${getLeaveName(myRec.leave_type)}）` : '';
            entryFormHtml = `
              <div style="margin-top: 8px; padding: 10px 14px; background: rgba(239, 68, 68, 0.05); border: 1px dashed rgba(239, 68, 68, 0.25); border-radius: var(--radius-md); font-size: 0.85rem; color: var(--text-muted);">
                ⚠️ <b>本場測驗您登記為缺考${leaveDesc}</b>，目前未開放自登。若需補考請洽詢任課教師開啟補考權限。
              </div>
            `;
          } else {
            const isMakeupSelf = myRec && myRec.is_absent && myRec.allow_makeup;
            const summaryTitle = isMakeupSelf
              ? '📸 立即拍照登記補考成績與佐證'
              : (hasSubmitted ? '✏️ 重新拍照登記／修改成績' : '📸 立即拍照登記小考成績');

            entryFormHtml = `
              <div style="margin-top: 8px; padding-top: 12px; border-top: 1px dashed var(--card-border);">
                <details ${(!hasSubmitted || isMakeupSelf) ? 'open' : ''} style="cursor: pointer;">
                  <summary style="font-size: 0.92rem; font-weight: 700; color: var(--student-primary-dark); outline: none;">
                    ${summaryTitle}
                  </summary>
                  <form class="quiz-self-entry-form" data-quiz-id="${q.id}" style="display: flex; flex-direction: column; gap: 12px; margin-top: 12px; cursor: default;">
                    <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 10px;">
                      <div>
                        <label style="font-size: 0.85rem; font-weight: 700; display: block; margin-bottom: 4px;">測驗得分：*</label>
                        <input type="number" step="any" min="0" max="${q.max_score}" class="input-control score-input" placeholder="0 ~ ${q.max_score}" value="${myRec && myRec.score !== null ? myRec.score : ''}" required style="font-size: 1rem; font-weight: 800;">
                      </div>
                      <div>
                        <label style="font-size: 0.85rem; font-weight: 700; display: block; margin-bottom: 4px;">備註說明：</label>
                        <input type="text" class="input-control note-input" placeholder="選填..." value="${myRec && myRec.note ? escapeHtml(myRec.note) : ''}" style="font-size: 0.9rem;">
                      </div>
                    </div>

                    <!-- 拍照佐證檔案上傳區塊（強制要求） -->
                    <div style="padding: 12px; background: rgba(2, 132, 199, 0.04); border: 1.5px dashed var(--student-primary-border); border-radius: var(--radius-md);">
                      <label style="font-size: 0.88rem; font-weight: 800; color: var(--student-primary-dark); display: flex; align-items: center; gap: 6px; margin-bottom: 6px;">
                        <span>📷 拍攝上傳考卷照片佐證：* (必填)</span>
                      </label>
                      <div style="font-size: 0.8rem; color: var(--text-muted); margin-bottom: 8px;">
                        ⚠️ 請拍攝清楚顯示您的姓名、座號與批改分數之考卷，以供老師查驗核准。
                      </div>
                      <input type="file" accept="image/*" capture="environment" class="quiz-photo-file" required style="font-size: 0.88rem; width: 100%;">
                      <div class="photo-preview-box" style="display: none; margin-top: 10px; text-align: center;">
                        <img class="preview-img" src="" alt="預覽" style="max-height: 140px; border-radius: 8px; border: 1px solid var(--card-border); box-shadow: var(--shadow-sm);">
                      </div>
                    </div>

                    <div style="display: flex; justify-content: flex-end;">
                      <button type="submit" class="btn btn-primary btn-submit-quiz-entry" style="font-weight: 800; padding: 10px 22px;">
                        📤 送出小考成績與考卷佐證
                      </button>
                    </div>
                  </form>
                </details>
              </div>
            `;
          }
        }

        card.innerHTML = `
          <div style="display: flex; align-items: center; justify-content: space-between; flex-wrap: wrap; gap: 8px;">
            <div>
              <div style="display: flex; align-items: center; gap: 8px; flex-wrap: wrap;">
                <span style="font-size: 1.15rem; font-weight: 800; color: var(--text-main);">${escapeHtml(q.title)}</span>
                ${q.subject ? `<span style="font-size: 0.78rem; font-weight: 700; color: var(--student-primary-dark); background: rgba(2, 132, 199, 0.12); padding: 2px 8px; border-radius: 999px; border: 1px solid rgba(2, 132, 199, 0.25);">📚 ${escapeHtml(q.subject)}</span>` : ''}
              </div>
              <div style="font-size: 0.82rem; color: var(--text-muted); margin-top: 2px;">
                📅 測驗日期：${q.quiz_date} | 及格：${q.passing_score} 分 | 滿分：${q.max_score} 分
              </div>
            </div>
            <div>${statusBadgeHtml}</div>
          </div>

          ${myScoreDisplayHtml}
          ${photoPreviewHtml}
          ${entryFormHtml}
        `;

        const viewPhotoBtn = card.querySelector('.btn-view-my-photo');
        if (viewPhotoBtn) {
          viewPhotoBtn.addEventListener('click', () => {
            const url = viewPhotoBtn.dataset.photoUrl;
            const title = viewPhotoBtn.dataset.quizTitle;
            const modal = document.getElementById('modalStudentPhotoViewer');
            const img = document.getElementById('studentPhotoViewerImg');
            const titleEl = document.getElementById('studentPhotoViewerTitle');
            if (modal && img) {
              img.src = url;
              if (titleEl) titleEl.textContent = `📷 ${title} - 考卷佐證照片`;
              modal.style.display = 'flex';
            }
          });
        }

        const form = card.querySelector('.quiz-self-entry-form');
        if (form) {
          const fileInput = form.querySelector('.quiz-photo-file');
          const previewBox = form.querySelector('.photo-preview-box');
          const previewImg = form.querySelector('.preview-img');

          fileInput.addEventListener('change', () => {
            if (fileInput.files && fileInput.files[0]) {
              const file = fileInput.files[0];
              const reader = new FileReader();
              reader.onload = (e) => {
                previewImg.src = e.target.result;
                previewBox.style.display = 'block';
              };
              reader.readAsDataURL(file);
            } else {
              previewBox.style.display = 'none';
            }
          });

          form.addEventListener('submit', async (e) => {
            e.preventDefault();
            const scoreInput = form.querySelector('.score-input');
            const noteInput = form.querySelector('.note-input');
            const submitBtn = form.querySelector('.btn-submit-quiz-entry');

            if (!fileInput.files || fileInput.files.length === 0) {
              showToast('登記成績必須拍攝並上傳考卷照片作為佐證！', 'error');
              return;
            }

            const formData = new FormData();
            formData.append('score', scoreInput.value);
            formData.append('note', noteInput.value.trim());
            formData.append('photo', fileInput.files[0]);

            submitBtn.disabled = true;
            submitBtn.textContent = '⏳ 上傳登記中...';

            try {
              const res = await apiUpload(`/api/student/paper-quizzes/${q.id}/self-entry`, formData);
              showToast(res.message || '小考成績已成功登錄，等待教師查驗！', 'positive');
              await loadStudentQuizzes();
            } catch (err) {
              showToast(`登錄失敗：${err.message}`, 'error');
            } finally {
              submitBtn.disabled = false;
              submitBtn.textContent = '📤 送出小考成績與考卷佐證';
            }
          });
        }

        listEl.appendChild(card);
      });
    } catch (err) {
      console.error('Failed to load student quizzes:', err);
      showToast('載入紙本測驗失敗', 'error');
    }
  }

  let gLeaderQuizzes = [];

  async function loadLeaderSection() {
    try {
      const data = await api('/api/student/group-leadership');
      if (!data || !data.is_leader) {
        showToast('您目前不是小組長', 'warning');
        return;
      }

      const leaderGroupName = document.getElementById('leaderGroupName');
      const leaderMemberCount = document.getElementById('leaderGroupMemberCount');
      if (leaderGroupName) leaderGroupName.textContent = data.group.group_name;
      if (leaderMemberCount) leaderMemberCount.textContent = `組員共 ${data.members.length} 人`;

      const quizzesData = await api('/api/student/paper-quizzes');
      gLeaderQuizzes = (quizzesData.quizzes || []).filter(q => q.allow_leader_entry);

      const quizSelect = document.getElementById('leaderQuizSelect');
      if (quizSelect) {
        quizSelect.innerHTML = '';
        if (gLeaderQuizzes.length === 0) {
          quizSelect.innerHTML = '<option value="">目前無開放代登的測驗</option>';
          renderLeaderQuizMembers([]);
        } else {
          gLeaderQuizzes.forEach(q => {
            const opt = document.createElement('option');
            opt.value = q.id;
            const subj = q.subject ? `[${q.subject}] ` : '';
            opt.textContent = `${subj}${q.quiz_date} ${q.title}`;
            quizSelect.appendChild(opt);
          });
          quizSelect.onchange = () => loadLeaderQuizMembers(Number(quizSelect.value));
          await loadLeaderQuizMembers(gLeaderQuizzes[0].id);
        }
      }

      renderLeaderDiscussions(data.recent_discussions || []);
    } catch (err) {
      console.error('Leader section error:', err);
    }
  }

  async function loadLeaderQuizMembers(quizId) {
    if (!quizId) return;
    try {
      const res = await api(`/api/student/leader/group-quizzes/${quizId}`);
      renderLeaderQuizMembers(res.members || [], res.quiz);
    } catch (err) {
      showToast(`載入組員名單失敗：${err.message}`, 'error');
    }
  }

  function renderLeaderQuizMembers(members, quiz) {
    const tbody = document.getElementById('leaderQuizMembersTbody');
    if (!tbody) return;
    tbody.innerHTML = '';

    if (members.length === 0) {
      tbody.innerHTML = `<tr><td colspan="6" style="text-align: center; padding: 20px; color: var(--text-muted);">無組員資料</td></tr>`;
      return;
    }

    const maxScore = quiz ? quiz.max_score : 100;

    members.forEach(m => {
      const tr = document.createElement('tr');
      tr.dataset.studentId = m.student_id;
      tr.style.borderBottom = '1px solid var(--card-border)';
      if (m.is_absent) tr.style.opacity = '0.6';

      const photoText = m.photo_url ? '📷 已附' : '<span style="color:var(--text-muted);">-</span>';

      tr.innerHTML = `
        <td style="padding: 8px 6px; font-weight: 700;">${m.student_number}號</td>
        <td style="padding: 8px 6px; font-weight: 600;">
          ${escapeHtml(m.name)}${m.is_leader ? ' <span class="leader-badge-pill" style="font-size:0.68rem; padding:1px 4px;">👑組長</span>' : ''}
        </td>
        <td style="padding: 8px 6px;">
          <input type="number" step="any" min="0" max="${maxScore}" class="input-control leader-score-input" value="${m.score !== null ? m.score : ''}" placeholder="-" style="width: 70px; padding: 4px 6px; font-weight: 700;" ${m.is_absent ? 'disabled' : ''}>
        </td>
        <td style="padding: 8px 6px; text-align: center;">
          <input type="checkbox" class="leader-absent-check" ${m.is_absent ? 'checked' : ''}>
        </td>
        <td style="padding: 8px 6px; font-size: 0.82rem;">${photoText}</td>
        <td style="padding: 8px 6px;">
          <input type="text" class="input-control leader-note-input" value="${escapeHtml(m.note || '')}" placeholder="備註..." style="font-size: 0.82rem; padding: 4px 6px; width: 100%;">
        </td>
      `;

      const scoreInput = tr.querySelector('.leader-score-input');
      const absentCheck = tr.querySelector('.leader-absent-check');

      absentCheck.addEventListener('change', () => {
        if (absentCheck.checked) {
          tr.style.opacity = '0.6';
          scoreInput.disabled = true;
          scoreInput.value = '';
        } else {
          tr.style.opacity = '1';
          scoreInput.disabled = false;
          scoreInput.focus();
        }
      });

      tbody.appendChild(tr);
    });
  }

  async function saveLeaderGroupQuizScores() {
    const quizSelect = document.getElementById('leaderQuizSelect');
    const quizId = quizSelect ? Number(quizSelect.value) : null;
    if (!quizId) {
      showToast('請選擇測驗', 'warning');
      return;
    }

    const tbody = document.getElementById('leaderQuizMembersTbody');
    const rows = tbody.querySelectorAll('tr[data-student-id]');
    const records = [];

    rows.forEach(tr => {
      const studentId = Number(tr.dataset.studentId);
      const scoreInput = tr.querySelector('.leader-score-input');
      const absentCheck = tr.querySelector('.leader-absent-check');
      const noteInput = tr.querySelector('.leader-note-input');

      const isAbsent = absentCheck ? absentCheck.checked : false;
      const rawScore = scoreInput ? scoreInput.value.trim() : '';
      const score = isAbsent || rawScore === '' ? null : Number(rawScore);
      const note = noteInput ? noteInput.value.trim() : '';

      records.push({
        student_id: studentId,
        score,
        is_absent: isAbsent,
        note,
      });
    });

    try {
      const res = await api(`/api/student/leader/group-quizzes/${quizId}`, {
        method: 'POST',
        body: JSON.stringify({ records }),
      });
      showToast(res.message || '組員成績代登成功！', 'positive');
      await loadLeaderQuizMembers(quizId);
    } catch (err) {
      showToast(`儲存失敗：${err.message}`, 'error');
    }
  }

  function renderLeaderDiscussions(discussions) {
    const list = document.getElementById('leaderDiscussionsList');
    const empty = document.getElementById('leaderDiscussionsEmpty');
    if (!list) return;

    list.innerHTML = '';
    if (!discussions || discussions.length === 0) {
      if (empty) empty.style.display = 'block';
      return;
    }
    if (empty) empty.style.display = 'none';

    discussions.forEach(d => {
      const card = document.createElement('div');
      card.style.padding = '12px 14px';
      card.style.background = 'var(--input-bg)';
      card.style.borderRadius = 'var(--radius-md)';
      card.style.border = '1px solid var(--card-border)';
      card.style.display = 'flex';
      card.style.flexDirection = 'column';
      card.style.gap = '6px';

      card.innerHTML = `
        <div style="display: flex; align-items: center; justify-content: space-between;">
          <span style="font-weight: 800; font-size: 0.95rem; color: var(--text-main);">${escapeHtml(d.title)}</span>
          <div style="display: flex; align-items: center; gap: 8px;">
            <span style="font-size: 0.78rem; color: var(--text-muted);">${d.date}</span>
            <button type="button" class="btn-del-disc" data-id="${d.id}" style="border: none; background: none; color: var(--accent-negative); cursor: pointer; font-size: 0.85rem; padding: 2px 4px;" title="刪除此筆紀錄">🗑️</button>
          </div>
        </div>
        <div style="font-size: 0.88rem; color: var(--text-main); white-space: pre-wrap; line-height: 1.4;">${escapeHtml(d.content)}</div>
      `;

      card.querySelector('.btn-del-disc').addEventListener('click', async () => {
        if (!(await showConfirmModal({ icon: '🗑️', title: '確定要刪除這筆小組討論紀錄嗎？', danger: true }))) return;
        try {
          await api(`/api/student/leader/discussions/${d.id}`, { method: 'DELETE' });
          showToast('討論紀錄已刪除', 'positive');
          loadLeaderSection();
        } catch (err) {
          showToast(`刪除失敗：${err.message}`, 'error');
        }
      });

      list.appendChild(card);
    });
  }

  // 小組長儲存與發布事件綁定
  const btnLeaderSaveScores = document.getElementById('btnLeaderSaveQuizScores');
  if (btnLeaderSaveScores) {
    btnLeaderSaveScores.addEventListener('click', saveLeaderGroupQuizScores);
  }

  const formLeaderDisc = document.getElementById('formLeaderDiscussion');
  if (formLeaderDisc) {
    const discDate = document.getElementById('leaderDiscDate');
    if (discDate) {
      discDate.value = new Date().toISOString().split('T')[0];
    }
    formLeaderDisc.addEventListener('submit', async (e) => {
      e.preventDefault();
      const titleInput = document.getElementById('leaderDiscTitle');
      const contentInput = document.getElementById('leaderDiscContent');
      const dateInput = document.getElementById('leaderDiscDate');

      try {
        const res = await api('/api/student/leader/discussions', {
          method: 'POST',
          body: JSON.stringify({
            title: titleInput.value.trim(),
            content: contentInput.value.trim(),
            date: dateInput.value,
          }),
        });
        showToast(res.message || '小組討論紀錄發布成功！', 'positive');
        titleInput.value = '';
        contentInput.value = '';
        loadLeaderSection();
      } catch (err) {
        showToast(`發布失敗：${err.message}`, 'error');
      }
    });
  }

  const btnClosePhotoViewer = document.getElementById('btnCloseStudentPhotoViewer');
  if (btnClosePhotoViewer) {
    btnClosePhotoViewer.addEventListener('click', () => {
      const modal = document.getElementById('modalStudentPhotoViewer');
      if (modal) modal.style.display = 'none';
    });
  }

  const btnRefreshQuizzes = document.getElementById('btnRefreshQuizzes');
  if (btnRefreshQuizzes) {
    btnRefreshQuizzes.addEventListener('click', loadStudentQuizzes);
  }

  const btnRefreshLeaderHub = document.getElementById('btnRefreshLeaderHub');
  if (btnRefreshLeaderHub) {
    btnRefreshLeaderHub.addEventListener('click', loadLeaderSection);
  }
