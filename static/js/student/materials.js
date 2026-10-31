// MyClass 學生端：課程素材、留言、作業繳交、線上測驗
// 由 static/js/student.js 拆出（2026-10-31，原第 292–850 行），程式內容未變更；縮排保留原樣。
// student.js 與 static/js/student/*.js 共用頁面的全域範圍（一般 <script>），載入順序見 static/student.html。


  function renderMaterial(m) {
    if (m.type === 'youtube') {
      const embed = youtubeEmbedUrl(m.url);
      if (embed) {
        const wrap = document.createElement('div');
        wrap.className = 'yt-embed';
        wrap.innerHTML = `<iframe src="${embed}" title="${escapeHtml(m.title)}" allowfullscreen></iframe>`;
        return wrap;
      }
    }
    const a = document.createElement('a');
    a.className = 'material-link';
    // 上傳檔案走 /uploads/* 這個受保護的路由，需要帶學生 JWT 才能讀取（見 src/index.ts 的
    // app.get("/uploads/*", ...)）；純外部連結不需要，直接開原始網址即可。
    a.href = m.type === 'file' ? fileUrlWithToken(m.url, m.title) : m.url;
    a.target = '_blank';
    a.rel = 'noopener';
    const icon = m.type === 'file' ? '📄' : m.type === 'youtube' ? '▶️' : '🔗';
    a.innerHTML = `<span>${icon}</span><span>${escapeHtml(m.title)}</span>`;
    return a;
  }

  function escapeHtml(s) {
    const d = document.createElement('div');
    d.textContent = s == null ? '' : String(s);
    return d.innerHTML;
  }

  async function markViewed(subUnitId) {
    try {
      await api(`/api/student/subunits/${subUnitId}/view`, { method: 'POST' });
    } catch (e) {
      // Non-critical — don't block the reading experience if this fails.
    }
  }

  // --- 提問串（Submission Comments）：作業/測驗下方的師生一對一（或對小組）留言 ---

  function renderCommentBubble(c) {
    const bubble = document.createElement('div');
    bubble.className = `comment-bubble ${c.author_role}`;
    const roleEmoji = c.author_role === 'teacher' ? '👩‍🏫' : '🧑‍🎓';
    bubble.innerHTML = `
      <div class="comment-bubble-meta">${roleEmoji} ${escapeHtml(c.author_name)} · ${escapeHtml(c.created_at)}</div>
      <div class="comment-bubble-text">${escapeHtml(c.message)}</div>
    `;
    return bubble;
  }

  function renderCommentsList(container, comments) {
    container.innerHTML = '';
    if (!comments.length) {
      const empty = document.createElement('div');
      empty.className = 'comment-thread-empty';
      empty.textContent = '目前還沒有留言，歡迎在下方向老師發問！';
      container.appendChild(empty);
      return;
    }
    comments.forEach((c) => container.appendChild(renderCommentBubble(c)));
    container.scrollTop = container.scrollHeight;
  }

  function renderCommentThread(subUnitId, initialCount) {
    const wrap = document.createElement('div');
    wrap.className = 'comment-thread';

    const toggleBtn = document.createElement('button');
    toggleBtn.type = 'button';
    toggleBtn.className = 'comment-thread-toggle';
    toggleBtn.textContent = initialCount > 0 ? `💬 提問老師（${initialCount} 則）` : '💬 提問老師';
    wrap.appendChild(toggleBtn);

    const panel = document.createElement('div');
    panel.className = 'comment-thread-panel';
    panel.hidden = true;
    const messages = document.createElement('div');
    messages.className = 'comment-thread-messages';
    panel.appendChild(messages);

    const composer = document.createElement('div');
    composer.className = 'comment-thread-composer';
    const textarea = document.createElement('textarea');
    textarea.placeholder = '輸入想問老師的問題...';
    const sendBtn = document.createElement('button');
    sendBtn.type = 'button';
    sendBtn.className = 'btn';
    sendBtn.textContent = '📤 送出';
    composer.appendChild(textarea);
    composer.appendChild(sendBtn);
    panel.appendChild(composer);
    wrap.appendChild(panel);

    let loaded = false;
    toggleBtn.addEventListener('click', async () => {
      panel.hidden = !panel.hidden;
      if (!panel.hidden && !loaded) {
        loaded = true;
        try {
          const comments = await api(`/api/student/subunits/${subUnitId}/comments`);
          renderCommentsList(messages, comments);
        } catch (e) {
          showToast(e.message, 'error');
        }
      }
    });

    async function send() {
      const message = textarea.value.trim();
      if (!message) return;
      sendBtn.disabled = true;
      try {
        const comments = await api(`/api/student/subunits/${subUnitId}/comments`, {
          method: 'POST',
          body: JSON.stringify({ message }),
        });
        textarea.value = '';
        loaded = true;
        renderCommentsList(messages, comments);
        toggleBtn.textContent = `💬 提問老師（${comments.length} 則）`;
      } catch (e) {
        showToast(e.message, 'error');
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

    return wrap;
  }

  function assignmentStatusText(su) {
    const sub = su.submission;
    if (!sub || !sub.turned_in) return { text: '尚未繳交', cls: 'muted' };
    if (sub.score !== null && sub.score !== undefined) {
      return { text: `🎯 已評分：${sub.score} 分${sub.feedback ? '　💬 ' + sub.feedback : ''}`, cls: 'positive' };
    }
    if (sub.resubmit_requested) return { text: '⏳ 已申請重新繳交，請等待老師同意', cls: 'warning' };
    if (sub.locked) return { text: '🔒 已鎖定，等待老師批改', cls: 'negative' };
    if (sub.is_late) return { text: '✅ 已繳交（遲交）', cls: 'warning' };
    return { text: '✅ 已繳交', cls: 'positive' };
  }

  function renderAssignmentPanel(su) {
    const wrap = document.createElement('div');
    wrap.className = 'assignment-panel';
    wrap.addEventListener('click', (evt) => evt.stopPropagation());

    const typeLabels = { file: '📄 檔案', text: '✏️ 文字', link: '🔗 連結' };
    const meta = document.createElement('div');
    meta.className = 'assignment-meta';
    meta.textContent =
      `${su.assignment_type === 'group' ? '👥 小組作業' : '👤 個人作業'}　可繳交：${(su.submission_types || []).map((t) => typeLabels[t] || t).join('、')}` +
      (su.due_date ? `　📅 期限：${su.due_date}` : '');
    wrap.appendChild(meta);

    if (su.assignment_type === 'group' && !su.my_group_id) {
      const warn = document.createElement('div');
      warn.className = 'assignment-status warning';
      warn.textContent = '你尚未被分配到小組，請聯絡老師';
      wrap.appendChild(warn);
      return wrap;
    }

    const status = assignmentStatusText(su);
    const statusEl = document.createElement('div');
    statusEl.className = `assignment-status ${status.cls}`;
    statusEl.textContent = status.text;
    wrap.appendChild(statusEl);

    const sub = su.submission;
    if (sub && sub.files && sub.files.length) {
      const list = document.createElement('div');
      list.className = 'assignment-files';
      sub.files.forEach((f, idx) => {
        const row = document.createElement('div');
        row.className = 'assignment-file-row';
        const a = document.createElement('a');
        a.href = fileUrlWithToken(f.url, f.file_name);
        a.target = '_blank';
        a.rel = 'noopener';
        a.textContent = `📄 ${f.file_name}`;
        row.appendChild(a);
        if (!sub.locked) {
          const del = document.createElement('button');
          del.type = 'button';
          del.className = 'assignment-file-del';
          del.textContent = '✕';
          del.addEventListener('click', async () => {
            try {
              await api(`/api/student/subunits/${su.id}/files/${idx}`, { method: 'DELETE' });
              await loadContent();
            } catch (e) {
              showToast(e.message, 'error');
            }
          });
          row.appendChild(del);
        }
        list.appendChild(row);
      });
      wrap.appendChild(list);
    }

    const canEdit = !sub || !sub.locked;
    if (canEdit) {
      const form = document.createElement('div');
      form.className = 'assignment-form';
      const types = su.submission_types || [];
      let fileInput, textArea, linkInput;
      if (types.includes('file')) {
        fileInput = document.createElement('input');
        fileInput.type = 'file';
        fileInput.multiple = true;
        form.appendChild(fileInput);
      }
      if (types.includes('text')) {
        textArea = document.createElement('textarea');
        textArea.className = 'assignment-textarea';
        textArea.placeholder = '在此輸入作答內容';
        textArea.value = (sub && sub.text_content) || '';
        form.appendChild(textArea);
      }
      if (types.includes('link')) {
        linkInput = document.createElement('input');
        linkInput.type = 'text';
        linkInput.className = 'assignment-link-input';
        linkInput.placeholder = 'https://...';
        linkInput.value = (sub && sub.link) || '';
        form.appendChild(linkInput);
      }
      const submitBtn = document.createElement('button');
      submitBtn.type = 'button';
      submitBtn.className = 'btn';
      submitBtn.textContent = sub && sub.turned_in ? '🔄 更新繳交' : '📤 送出繳交';
      submitBtn.addEventListener('click', async () => {
        const formData = new FormData();
        if (fileInput && fileInput.files.length) {
          Array.from(fileInput.files).forEach((f) => formData.append('files', f));
        }
        if (linkInput) formData.append('link', linkInput.value.trim());
        if (textArea) formData.append('text_content', textArea.value);
        try {
          await apiUpload(`/api/student/subunits/${su.id}/submit`, formData);
          showToast('作業已送出！', 'success');
          await loadContent();
        } catch (e) {
          showToast(e.message, 'error');
        }
      });
      form.appendChild(submitBtn);
      wrap.appendChild(form);
    } else if (sub.locked && !sub.resubmit_requested) {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'btn btn-secondary';
      btn.textContent = '申請重新繳交';
      btn.addEventListener('click', async () => {
        try {
          await api(`/api/student/subunits/${su.id}/request_resubmit`, { method: 'POST' });
          showToast('已送出重新繳交申請', 'success');
          await loadContent();
        } catch (e) {
          showToast(e.message, 'error');
        }
      });
      wrap.appendChild(btn);
    }

    wrap.appendChild(renderCommentThread(su.id, su.comment_count || 0));
    return wrap;
  }

  function shuffleArray(arr) {
    const result = arr.slice();
    for (let i = result.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      const tmp = result[i];
      result[i] = result[j];
      result[j] = tmp;
    }
    return result;
  }

  function formatQuizAnswerDisplay(q, rawValue) {
    if (rawValue === undefined || rawValue === null || rawValue === '') return '';
    if (q.type === 'multiple_choice') {
      const opt = q.options && q.options[Number(rawValue)];
      return opt !== undefined ? opt : rawValue;
    }
    if (q.type === 'true_false') return rawValue === 'true' ? '⭕ 正確' : '❌ 錯誤';
    return rawValue;
  }

  function isQuizAnswerCorrect(q, studentAnswer) {
    const a = String(studentAnswer ?? '').trim();
    const correct = String(q.correct_answer ?? '').trim();
    return q.type === 'short_answer' ? a.toLowerCase() === correct.toLowerCase() : a === correct;
  }

  function renderQuizPanel(su) {
    const wrap = document.createElement('div');
    wrap.className = 'assignment-panel';
    wrap.addEventListener('click', (evt) => evt.stopPropagation());

    const meta = document.createElement('div');
    meta.className = 'assignment-meta';
    meta.textContent = `✅ 線上測驗　共 ${(su.quiz_questions || []).length} 題` + (su.due_date ? `　📅 期限：${su.due_date}` : '');
    wrap.appendChild(meta);

    const sub = su.submission;

    // 已作答：顯示成績，若老師允許則逐題顯示對錯與正解
    if (sub && sub.turned_in) {
      const scoreBanner = document.createElement('div');
      scoreBanner.className = 'assignment-status positive';
      scoreBanner.textContent = `🏆 得分：${sub.score} / ${sub.max_score}`;
      wrap.appendChild(scoreBanner);

      if (su.reveal_answers_after_submit && sub.answers) {
        (su.quiz_questions || []).forEach((q, idx) => {
          const studentAnswer = sub.answers[q.id];
          const correct = isQuizAnswerCorrect(q, studentAnswer);
          const item = document.createElement('div');
          item.className = 'score-log-item';
          item.style.flexDirection = 'column';
          item.style.alignItems = 'flex-start';
          item.innerHTML = `
            <div style="display:flex; justify-content:space-between; width:100%; gap:8px;">
              <span class="score-log-title">第 ${idx + 1} 題（${q.points} 分）</span>
              <span class="score-log-value ${correct ? 'positive' : 'negative'}">${correct ? '✅ 答對' : '❌ 答錯'}</span>
            </div>
            <div class="score-log-meta">${escapeHtml(q.question_text)}</div>
            <div class="score-log-meta">你的答案：${escapeHtml(formatQuizAnswerDisplay(q, studentAnswer) || '（未作答）')}</div>
            ${!correct ? `<div class="score-log-meta">正確答案：${escapeHtml(formatQuizAnswerDisplay(q, q.correct_answer))}</div>` : ''}
          `;
          wrap.appendChild(item);
        });
      } else {
        const note = document.createElement('div');
        note.className = 'assignment-status muted';
        note.textContent = '老師已設定不公開詳解，僅顯示總分。';
        wrap.appendChild(note);
      }
      wrap.appendChild(renderCommentThread(su.id, su.comment_count || 0));
      return wrap;
    }

    // 尚未作答：題目與選擇題選項順序皆隨機顯示，避免學生互相對答案
    const shuffledQuestions = shuffleArray(su.quiz_questions || []).map((q) => {
      if (q.type === 'multiple_choice' && Array.isArray(q.options)) {
        return { ...q, shuffledOptions: shuffleArray(q.options.map((text, originalIndex) => ({ text, originalIndex }))) };
      }
      return q;
    });

    const draftAnswers = {};
    const form = document.createElement('div');
    form.className = 'assignment-form';

    shuffledQuestions.forEach((q, idx) => {
      const qWrap = document.createElement('div');
      qWrap.style.cssText = 'border:1px solid var(--card-border); border-radius:var(--radius-sm); padding:10px 12px;';
      const title = document.createElement('p');
      title.style.cssText = 'font-weight:700; font-size:0.9rem; margin:0 0 8px;';
      title.textContent = `第 ${idx + 1} 題（${q.points} 分）：${q.question_text}`;
      qWrap.appendChild(title);

      if (q.type === 'multiple_choice') {
        (q.shuffledOptions || []).forEach((opt) => {
          const label = document.createElement('label');
          label.style.cssText = 'display:flex; align-items:center; gap:8px; margin-bottom:6px; font-size:0.88rem;';
          const radio = document.createElement('input');
          radio.type = 'radio';
          radio.name = `quiz-ans-${q.id}`;
          radio.value = String(opt.originalIndex);
          radio.addEventListener('change', () => { draftAnswers[q.id] = radio.value; });
          label.appendChild(radio);
          label.appendChild(document.createTextNode(opt.text));
          qWrap.appendChild(label);
        });
      } else if (q.type === 'true_false') {
        [['true', '⭕ 正確'], ['false', '❌ 錯誤']].forEach(([val, text]) => {
          const label = document.createElement('label');
          label.style.cssText = 'display:inline-flex; align-items:center; gap:6px; margin-right:16px; font-size:0.88rem;';
          const radio = document.createElement('input');
          radio.type = 'radio';
          radio.name = `quiz-ans-${q.id}`;
          radio.value = val;
          radio.addEventListener('change', () => { draftAnswers[q.id] = val; });
          label.appendChild(radio);
          label.appendChild(document.createTextNode(' ' + text));
          qWrap.appendChild(label);
        });
      } else {
        const input = document.createElement('input');
        input.type = 'text';
        input.className = 'assignment-link-input';
        input.placeholder = '請輸入你的答案';
        input.addEventListener('input', () => { draftAnswers[q.id] = input.value; });
        qWrap.appendChild(input);
      }

      form.appendChild(qWrap);
    });

    const submitBtn = document.createElement('button');
    submitBtn.type = 'button';
    submitBtn.className = 'btn';
    submitBtn.textContent = '📤 送出測驗';
    submitBtn.addEventListener('click', async () => {
      const unanswered = shuffledQuestions.some((q) => !draftAnswers[q.id] || String(draftAnswers[q.id]).trim() === '');
      if (unanswered) {
        showToast('請完成所有題目後再送出喔！', 'error');
        return;
      }
      submitBtn.disabled = true;
      submitBtn.textContent = '⏳ 送出中...';
      try {
        await api(`/api/student/subunits/${su.id}/submit_quiz`, {
          method: 'POST',
          body: JSON.stringify({ answers: draftAnswers }),
        });
        showToast('🎉 測驗已送出，系統已自動完成批改！', 'success');
        await loadContent();
      } catch (e) {
        showToast(e.message, 'error');
        submitBtn.disabled = false;
        submitBtn.textContent = '📤 送出測驗';
      }
    });
    form.appendChild(submitBtn);
    wrap.appendChild(form);

    wrap.appendChild(renderCommentThread(su.id, su.comment_count || 0));
    return wrap;
  }

  // 同時間只能有一個小單元展開（手風琴），比照下方章節的單開行為：記錄目前展開中的
  // { head, body } 供下一次展開時收合。跨章節也共用同一個狀態，因為展開新章節時
  // loadContent() 的章節手風琴邏輯已經會把舊章節（連同其小單元）整個隱藏。
  let openSubUnit = null;

  function renderSubUnit(su) {
    const card = document.createElement('div');
    card.className = 'subunit-card';

    const head = document.createElement('div');
    head.className = 'subunit-head';
    const headLeft = document.createElement('div');
    headLeft.style.cssText = 'display:flex; align-items:center; gap:8px; flex-wrap:wrap;';
    headLeft.innerHTML = `<span class="subunit-title">${escapeHtml(su.title)}</span>`;
    head.appendChild(headLeft);
    const toggleIcon = document.createElement('span');
    toggleIcon.className = 'subunit-toggle-icon';
    toggleIcon.textContent = '▶';
    head.appendChild(toggleIcon);
    if (su.viewed) {
      const badge = document.createElement('span');
      badge.className = 'viewed-badge';
      badge.textContent = '✓ 已閱讀';
      headLeft.appendChild(badge);
    }
    card.appendChild(head);

    // 預設摺疊：內容（說明/教材/作業測驗面板/提問串）都包在 body 裡，點 head 才展開。
    const body = document.createElement('div');
    body.className = 'subunit-body';
    body.hidden = true;

    if (su.description) {
      const desc = document.createElement('p');
      desc.className = 'subunit-desc';
      desc.textContent = su.description;
      body.appendChild(desc);
    }

    if (su.materials && su.materials.length) {
      const list = document.createElement('div');
      list.className = 'material-list';
      su.materials.forEach((m) => list.appendChild(renderMaterial(m)));
      body.appendChild(list);
    }

    if (su.category === 'assignment') {
      body.appendChild(renderAssignmentPanel(su));
    } else if (su.category === 'quiz') {
      body.appendChild(renderQuizPanel(su));
    }

    card.appendChild(body);

    head.addEventListener('click', () => {
      const opening = body.hidden;
      if (openSubUnit && openSubUnit.body !== body) {
        openSubUnit.body.hidden = true;
        openSubUnit.head.classList.remove('expanded');
      }
      body.hidden = !body.hidden;
      head.classList.toggle('expanded', !body.hidden);
      openSubUnit = body.hidden ? null : { head, body };

      if (opening && !su.viewed) {
        su.viewed = true;
        markViewed(su.id);
        const badge = document.createElement('span');
        badge.className = 'viewed-badge';
        badge.textContent = '✓ 已閱讀';
        headLeft.appendChild(badge);
      }
    });

    return card;
  }

  async function loadContent() {
    const units = await api('/api/student/units');
    unitsContainer.innerHTML = '';
    const withContent = units.filter((u) => u.sub_units.length > 0);
    emptyState.hidden = withContent.length > 0;

    // 同時間只能有一個章節展開（手風琴）：展開新章節時，把先前展開的章節收合。
    openSubUnit = null;
    let openUnit = null;

    withContent.forEach((u) => {
      const block = document.createElement('div');
      block.className = 'unit-block';

      const title = document.createElement('div');
      title.className = 'unit-title';
      title.innerHTML = `<span>${escapeHtml(u.title)}</span><span class="unit-toggle-icon">▶</span>`;

      // 預設摺疊：避免多章節/多影片同時展開時版面過於混雜，點章節標題展開/收合。
      const body = document.createElement('div');
      body.className = 'unit-body';
      body.hidden = true;
      u.sub_units.forEach((su) => body.appendChild(renderSubUnit(su)));

      title.addEventListener('click', () => {
        if (openUnit && openUnit.body !== body) {
          openUnit.body.hidden = true;
          openUnit.title.classList.remove('expanded');
        }
        body.hidden = !body.hidden;
        title.classList.toggle('expanded', !body.hidden);
        openUnit = body.hidden ? null : { title, body };
      });

      block.appendChild(title);
      block.appendChild(body);
      unitsContainer.appendChild(block);
    });
  }
