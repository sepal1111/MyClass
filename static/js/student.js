/* ==========================================================================
   學生課程入口 (Phase 2 LMS) — 帳號密碼登入 + 課程素材瀏覽
   ========================================================================== */
(function () {
  const TOKEN_KEY = 'student_token';
  const STUDENT_KEY = 'student_info';

  const loginView = document.getElementById('loginView');
  const contentView = document.getElementById('contentView');
  const loginError = document.getElementById('loginError');
  const accountLoginForm = document.getElementById('accountLoginForm');
  const unitsContainer = document.getElementById('unitsContainer');
  const emptyState = document.getElementById('emptyState');
  const btnContentTabMaterials = document.getElementById('btnContentTabMaterials');
  const btnContentTabFileCollect = document.getElementById('btnContentTabFileCollect');
  const btnContentTabQuizzes = document.getElementById('btnContentTabQuizzes');
  const btnContentTabScores = document.getElementById('btnContentTabScores');
  const btnContentTabLiveWall = document.getElementById('btnContentTabLiveWall');
  const btnContentTabWordCloud = document.getElementById('btnContentTabWordCloud');
  const btnContentTabKahoot = document.getElementById('btnContentTabKahoot');
  const btnContentTabLeader = document.getElementById('btnContentTabLeader');
  const materialsTabPane = document.getElementById('materialsTabPane');
  const fileCollectTabPane = document.getElementById('fileCollectTabPane');
  const quizzesTabPane = document.getElementById('quizzesTabPane');
  const scoresTabPane = document.getElementById('scoresTabPane');
  const liveWallTabPane = document.getElementById('liveWallTabPane');
  const wordCloudTabPane = document.getElementById('wordCloudTabPane');
  const kahootTabPane = document.getElementById('kahootTabPane');
  const leaderTabPane = document.getElementById('leaderTabPane');
  const scoreLogsList = document.getElementById('scoreLogsList');
  const scoreEmptyState = document.getElementById('scoreEmptyState');
  const topNavCourseBadge = document.getElementById('topNavCourseBadge');
  const studentChipAvatar = document.getElementById('studentChipAvatar');
  const studentChipName = document.getElementById('studentChipName');
  const heroGreeting = document.getElementById('heroGreeting');
  const myGroupCard = document.getElementById('myGroupCard');
  const notifBellBtn = document.getElementById('notifBellBtn');
  const notifDropdown = document.getElementById('notifDropdown');

  function showError(msg) {
    loginError.textContent = msg;
    loginError.style.display = 'block';
  }
  function clearError() {
    loginError.style.display = 'none';
  }

  async function api(path, opts) {
    opts = opts || {};
    const headers = Object.assign({ 'Content-Type': 'application/json' }, opts.headers || {});
    const token = localStorage.getItem(TOKEN_KEY);
    if (token) headers['Authorization'] = 'Bearer ' + token;
    const res = await fetch(path, Object.assign({}, opts, { headers }));
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.detail || '發生錯誤，請稍後再試');
    return data;
  }

  async function apiUpload(path, formData) {
    const headers = {};
    const token = localStorage.getItem(TOKEN_KEY);
    if (token) headers['Authorization'] = 'Bearer ' + token;
    const res = await fetch(path, { method: 'POST', headers, body: formData });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.detail || '發生錯誤，請稍後再試');
    return data;
  }

  /** 美化版 window.confirm() 取代方案：回傳 Promise<boolean>，語意與原生 confirm() 一致 */
  function showConfirmModal(options) {
    let opts = {};
    if (typeof options === 'string' || typeof options === 'number') {
      const lines = String(options).split('\n');
      opts = { title: lines[0] || '', desc: lines.slice(1).join('\n') };
    } else {
      opts = Object.assign({}, options);
    }

    let icon = opts.icon || '❓';
    let iconBg = 'rgba(123, 152, 224, 0.15)';
    let iconBorder = 'rgba(123, 152, 224, 0.4)';
    let okGradient = 'linear-gradient(135deg, #7b98e0, #4a67ba)';
    const textToCheck = (opts.title + ' ' + (opts.desc || '')).toLowerCase();
    if (opts.danger || textToCheck.includes('刪除') || textToCheck.includes('delete')) {
      icon = opts.icon || '🗑️';
      iconBg = 'rgba(217, 128, 126, 0.15)';
      iconBorder = 'rgba(217, 128, 126, 0.4)';
      okGradient = 'linear-gradient(135deg, #d9807e, #dc2626)';
    }

    const overlay = document.getElementById('modalStudentGenericConfirm');
    if (!overlay) return Promise.resolve(window.confirm(opts.title + (opts.desc ? '\n' + opts.desc : '')));

    const iconWrap = document.getElementById('studentGenericConfirmIconWrap');
    const iconEl = document.getElementById('studentGenericConfirmIcon');
    const titleEl = document.getElementById('studentGenericConfirmTitle');
    const descEl = document.getElementById('studentGenericConfirmDesc');
    const btnCancel = document.getElementById('btnStudentGenericConfirmCancel');
    const btnOk = document.getElementById('btnStudentGenericConfirmOk');

    iconWrap.style.background = iconBg;
    iconWrap.style.border = `2px solid ${iconBorder}`;
    iconEl.textContent = icon;
    titleEl.textContent = opts.title || '';
    if (opts.desc) {
      descEl.textContent = opts.desc;
      descEl.style.display = 'block';
    } else {
      descEl.style.display = 'none';
    }
    btnCancel.textContent = opts.cancelText || '取消';
    btnOk.textContent = opts.confirmText || '確定';
    btnOk.style.background = okGradient;

    return new Promise((resolve) => {
      let settled = false;
      function cleanup(result) {
        if (settled) return;
        settled = true;
        overlay.style.display = 'none';
        btnCancel.removeEventListener('click', onCancel);
        btnOk.removeEventListener('click', onOk);
        resolve(result);
      }
      function onCancel() { cleanup(false); }
      function onOk() { cleanup(true); }
      btnCancel.addEventListener('click', onCancel);
      btnOk.addEventListener('click', onOk);
      overlay.style.display = 'flex';
    });
  }

  /** 美化版 window.prompt() 取代方案：回傳 Promise<string|null>，語意與原生 prompt() 一致 */
  function showPromptModal(options) {
    let opts = typeof options === 'string' ? { title: options } : Object.assign({}, options);
    opts.defaultValue = opts.defaultValue !== undefined ? String(opts.defaultValue) : '';

    const overlay = document.getElementById('modalStudentGenericPrompt');
    if (!overlay) return Promise.resolve(window.prompt(opts.title || '', opts.defaultValue));

    const iconEl = document.getElementById('studentGenericPromptIcon');
    const titleEl = document.getElementById('studentGenericPromptTitle');
    const descEl = document.getElementById('studentGenericPromptDesc');
    const inputEl = document.getElementById('studentGenericPromptInput');
    const btnCancel = document.getElementById('btnStudentGenericPromptCancel');
    const btnOk = document.getElementById('btnStudentGenericPromptOk');

    iconEl.textContent = opts.icon || '✏️';
    titleEl.textContent = opts.title || '';
    if (opts.desc) {
      descEl.textContent = opts.desc;
      descEl.style.display = 'block';
    } else {
      descEl.style.display = 'none';
    }
    inputEl.value = opts.defaultValue;
    inputEl.placeholder = opts.placeholder || '';
    btnCancel.textContent = opts.cancelText || '取消';
    btnOk.textContent = opts.confirmText || '確定';

    return new Promise((resolve) => {
      let settled = false;
      function cleanup(result) {
        if (settled) return;
        settled = true;
        overlay.style.display = 'none';
        btnCancel.removeEventListener('click', onCancel);
        btnOk.removeEventListener('click', onOk);
        inputEl.removeEventListener('keydown', onKeydown);
        resolve(result);
      }
      function onCancel() { cleanup(null); }
      function onOk() { cleanup(inputEl.value); }
      function onKeydown(e) {
        if (e.key === 'Enter') { e.preventDefault(); onOk(); }
        else if (e.key === 'Escape') { onCancel(); }
      }
      btnCancel.addEventListener('click', onCancel);
      btnOk.addEventListener('click', onOk);
      inputEl.addEventListener('keydown', onKeydown);
      overlay.style.display = 'flex';
      setTimeout(() => { inputEl.focus(); inputEl.select(); }, 50);
    });
  }

  function showToast(message, type) {
    const stack = document.getElementById('toastStack');
    if (!stack) return;
    const item = document.createElement('div');
    item.className = 'toast-item' + (type ? ' ' + type : '');
    item.textContent = message;
    stack.appendChild(item);
    requestAnimationFrame(() => item.classList.add('show'));
    setTimeout(() => {
      item.classList.remove('show');
      setTimeout(() => item.remove(), 300);
    }, 3000);
  }

  // filename（選填）：另存/下載時要用的檔名（例如素材標題、作業繳交時的原始檔名），
  // 對應 /uploads/* 路由的 ?name= 支援（見 src/index.ts），磁碟上存的是防碰撞用的亂數檔名，
  // 不帶這個參數的話下載出來的檔案名稱會是那串亂碼。
  function fileUrlWithToken(url, filename) {
    if (!url || typeof url !== 'string' || url.startsWith('data:')) return url || '';
    const token = localStorage.getItem(TOKEN_KEY);
    let result = url;
    if (token) result += (result.includes('?') ? '&' : '?') + 'token=' + encodeURIComponent(token);
    if (filename) result += (result.includes('?') ? '&' : '?') + 'name=' + encodeURIComponent(filename);
    return result;
  }

  function getCardPlaceholderSvg(score, label) {
    const s = Number(score || 0);
    const isPos = s >= 0;
    const bgGrad1 = isPos ? '#3b82f6' : '#e11d48';
    const bgGrad2 = isPos ? '#1d4ed8' : '#9f1239';
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 400 560" width="400" height="560">
      <defs>
        <linearGradient id="cardBg" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stop-color="${bgGrad1}" />
          <stop offset="100%" stop-color="${bgGrad2}" />
        </linearGradient>
      </defs>
      <rect width="400" height="560" rx="28" fill="url(#cardBg)" />
      <rect x="16" y="16" width="368" height="528" rx="20" fill="none" stroke="rgba(255,255,255,0.3)" stroke-width="2" stroke-dasharray="6 4" />
      <circle cx="200" cy="220" r="72" fill="rgba(255,255,255,0.18)" />
      <text x="200" y="242" font-family="system-ui, -apple-system, sans-serif" font-size="64" font-weight="900" fill="#ffffff" text-anchor="middle">${isPos ? '+' : ''}${s}</text>
      <text x="200" y="340" font-family="system-ui, -apple-system, sans-serif" font-size="28" font-weight="800" fill="#ffffff" text-anchor="middle">${(label || '點數卡').substring(0, 12)}</text>
      <text x="200" y="380" font-family="system-ui, -apple-system, sans-serif" font-size="16" font-weight="600" fill="rgba(255,255,255,0.8)" text-anchor="middle">✨ 點數卡</text>
    </svg>`;
    return 'data:image/svg+xml;utf8,' + encodeURIComponent(svg);
  }

  function getGiftPlaceholderSvg(emoji = '🎁') {
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100" width="100" height="100">
      <rect width="100" height="100" rx="16" fill="#f1f5f9" />
      <text x="50" y="62" font-size="44" text-anchor="middle">${emoji}</text>
    </svg>`;
    return 'data:image/svg+xml;utf8,' + encodeURIComponent(svg);
  }

  function saveSession(token, student) {
    localStorage.setItem(TOKEN_KEY, token);
    localStorage.setItem(STUDENT_KEY, JSON.stringify(student));
  }
  function clearSession() {
    localStorage.removeItem(TOKEN_KEY);
    localStorage.removeItem(STUDENT_KEY);
  }

  // 登出／session 失效時的共用出口：這個頁面現在一律是被 index.html 用同源 iframe 嵌入顯示
  // （見 static/js/app.js 的 enterStudentMode()），所以清完 session 後要請「外層」頁面把 iframe
  // 收起來、回到登入畫面，而不是自己 reload（reload 只會讓 iframe 裡面重新顯示這支檔案自帶的
  // 登入表單，使用者會卡在一個「巢狀」畫面裡出不去）。同源 iframe 可以直接呼叫 parent 上的函式。
  // 保留 location.reload() 這條路是為了「萬一」此檔案未來又被直接開啟（不在 iframe 裡）時還能動作。
  function exitToLogin() {
    clearSession();
    if (window.parent && window.parent !== window && typeof window.parent.exitStudentMode === 'function') {
      window.parent.exitStudentMode();
    } else {
      location.reload();
    }
  }

  function youtubeEmbedUrl(url) {
    const patterns = [
      /(?:youtube\.com\/watch\?v=|youtu\.be\/|youtube\.com\/embed\/)([\w-]{6,})/
    ];
    for (const p of patterns) {
      const m = url.match(p);
      if (m) return `https://www.youtube.com/embed/${m[1]}`;
    }
    return null;
  }

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

  // --- Tab Bar ---
  const TAB_PANES = {
    materials: { btn: btnContentTabMaterials, pane: materialsTabPane },
    fileCollect: { btn: btnContentTabFileCollect, pane: fileCollectTabPane },
    quizzes: { btn: btnContentTabQuizzes, pane: quizzesTabPane },
    scores: { btn: btnContentTabScores, pane: scoresTabPane },
    liveWall: { btn: btnContentTabLiveWall, pane: liveWallTabPane },
    wordCloud: { btn: btnContentTabWordCloud, pane: wordCloudTabPane },
    kahoot: { btn: btnContentTabKahoot, pane: kahootTabPane },
    leader: { btn: btnContentTabLeader, pane: leaderTabPane },
  };

  function switchTab(key) {
    const target = TAB_PANES[key];
    if (!target || target.btn.classList.contains('active')) return;
    Object.values(TAB_PANES).forEach(({ btn }) => btn?.classList.remove('active'));
    target.btn.classList.add('active');

    const currentPane = Object.values(TAB_PANES).find(({ pane }) => pane && !pane.hidden)?.pane;
    const showTarget = () => {
      if (currentPane && currentPane !== target.pane) currentPane.hidden = true;
      if (target.pane) {
        target.pane.hidden = false;
        target.pane.classList.add('fading');
        requestAnimationFrame(() => target.pane.classList.remove('fading'));
      }
    };
    if (currentPane && currentPane !== target.pane) {
      currentPane.classList.add('fading');
      setTimeout(showTarget, 120);
    } else {
      showTarget();
    }
  }

  btnContentTabMaterials.addEventListener('click', () => switchTab('materials'));

  if (btnContentTabFileCollect) {
    btnContentTabFileCollect.addEventListener('click', () => {
      switchTab('fileCollect');
      loadStudentFileCollections();
    });
  }

  if (btnContentTabQuizzes) {
    btnContentTabQuizzes.addEventListener('click', () => {
      switchTab('quizzes');
      loadStudentQuizzes();
    });
  }

  btnContentTabScores.addEventListener('click', async () => {
    switchTab('scores');
    try {
      await loadScores();
    } catch (e) {
      showToast(e.message, 'error');
    }
  });

  btnContentTabLiveWall.addEventListener('click', () => {
    switchTab('liveWall');
    LiveWall.refresh();
  });

  if (btnContentTabWordCloud) {
    btnContentTabWordCloud.addEventListener('click', () => {
      switchTab('wordCloud');
      if (window.StudentApp) window.StudentApp.syncWordCloudTab();
    });
  }

  if (btnContentTabKahoot) {
    btnContentTabKahoot.addEventListener('click', () => {
      switchTab('kahoot');
      if (window.StudentApp) window.StudentApp.syncKahootTab();
    });
  }

  if (btnContentTabLeader) {
    btnContentTabLeader.addEventListener('click', () => {
      switchTab('leader');
      loadLeaderSection();
    });
  }

  // --- Notification Bell（UI 佔位，尚未串接後端通知系統）---
  notifBellBtn.addEventListener('click', (evt) => {
    evt.stopPropagation();
    notifDropdown.classList.toggle('open');
  });
  document.addEventListener('click', (evt) => {
    if (!notifDropdown.contains(evt.target) && evt.target !== notifBellBtn) {
      notifDropdown.classList.remove('open');
    }
  });

  // --- 頂部導覽列與歡迎橫幅 ---
  function renderTopNavAndHero(student, course) {
    topNavCourseBadge.textContent = course.name;
    studentChipAvatar.textContent = (student.name || '?').charAt(0);
    studentChipName.textContent = `${student.name}（座號 ${student.student_number}）`;
    heroGreeting.innerHTML = `👋 哈囉，<strong>${escapeHtml(student.name)}</strong>！歡迎來到 <span class="course-name">${escapeHtml(course.name)}</span> 課堂`;
  }

  async function loadMyGroup() {
    try {
      const data = await api('/api/student/me/group');
      if (!data.group) {
        myGroupCard.classList.add('empty');
        myGroupCard.innerHTML = `<p class="my-group-title">🧑‍🤝‍🧑 我的小組</p><p class="my-group-empty-text">目前尚未被編入分組。</p>`;
        return;
      }
      myGroupCard.classList.remove('empty');
      const pills = data.group.members
        .map((m) => `<span class="member-pill${m.is_me ? ' me' : ''}">${escapeHtml(m.name)}${m.is_me ? '（你）' : ''}</span>`)
        .join('');
      myGroupCard.innerHTML = `<p class="my-group-title">🧑‍🤝‍🧑 我的小組：${escapeHtml(data.group.name)}</p><div class="my-group-members">${pills}</div>`;
    } catch (e) {
      // 小組資訊非關鍵功能，載入失敗不阻擋其他內容顯示。
    }
  }

  async function showContent() {
    loginView.hidden = true;
    contentView.hidden = false;
    try {
      const me = await api('/api/auth/student/me');
      saveSession(localStorage.getItem(TOKEN_KEY), Object.assign({ course_id: me.course.id }, me.student));
      renderTopNavAndHero(me.student, me.course);
      await loadMyGroup();
      await checkStudentLeadership();
      await loadContent();
      connectStudentRealtime(me.course.id);
    } catch (e) {
      if (String(e.message).includes('登入')) {
        exitToLogin();
      }
    }
  }

  async function tryResumeSession() {
    return Boolean(localStorage.getItem(TOKEN_KEY));
  }

  accountLoginForm.addEventListener('submit', async (evt) => {
    evt.preventDefault();
    clearError();
    try {
      const res = await api('/api/auth/student/login_by_account', {
        method: 'POST',
        body: JSON.stringify({
          account: document.getElementById('accountInput').value.trim(),
          password: document.getElementById('accountPasswordInput').value,
        }),
      });
      saveSession(res.token, res.student);
      showContent();
    } catch (e) {
      showError(e.message);
    }
  });

  document.getElementById('logoutBtn').addEventListener('click', () => {
    exitToLogin();
  });

  // --- 即時互動牆（Live Wall）：老師開一個限時場次，每人限交一則文字/手繪/拍照貼文 ---

  let studentRealtimeHandle = null;
  function connectStudentRealtime(courseId) {
    if (studentRealtimeHandle) {
      studentRealtimeHandle.close();
      studentRealtimeHandle = null;
    }
    if (typeof connectCourseRealtime !== 'function') return; // realtime.js 未載入時安靜跳過
    const token = localStorage.getItem(TOKEN_KEY) || '';
    studentRealtimeHandle = connectCourseRealtime(courseId, (event) => {
      // 只有目前正顯示「即時互動牆」分頁時才需要刷新，避免學生在其他分頁時也一直打 API。
      if (event === 'live_wall_updated' && !liveWallTabPane.hidden) {
        LiveWall.refresh();
        // 歷史紀錄清單若已展開才刷新（例如老師在教師端刪除了某筆紀錄），未展開時不必多打一次 API。
        if (!document.getElementById('livewallHistoryList')?.hidden) LiveWall.loadHistory();
      }
      if (event === 'file_collection_updated' && !fileCollectTabPane.hidden) {
        loadStudentFileCollections();
      }
    }, null, token);
  }

  const LiveWall = {
    session: null,
    canvas: null,
    ctx: null,
    drawing: false,
    strokeColor: '#1e293b',
    strokeWidth: 4,
    hasDrawn: false,
    canvasInited: false,

    async refresh() {
      try {
        const data = await api('/api/student/live-wall/active');
        this.render(data.session, data.my_post);
      } catch (e) {
        showToast(e.message, 'error');
      }
    },

    render(session, myPost) {
      this.session = session;
      const emptyEl = document.getElementById('livewallEmptyState');
      const lockedEl = document.getElementById('livewallLockedState');
      const inputEl = document.getElementById('livewallInputState');

      emptyEl.hidden = !!session;
      lockedEl.hidden = !(session && myPost);
      inputEl.hidden = !(session && !myPost);
      if (!session) return;

      if (myPost) {
        const preview = document.getElementById('livewallMyPostPreview');
        preview.innerHTML = myPost.text_content
          ? `<p style="white-space:pre-wrap;">${escapeHtml(myPost.text_content)}</p>`
          : `<img src="${fileUrlWithToken(myPost.image_url)}" style="max-width:100%; border-radius:var(--radius-md);">`;
        return;
      }

      document.getElementById('livewallPromptTitle').textContent = session.title || '🎨 老師開啟了即時互動牆，快來參加吧！';
      ['Text', 'Photo', 'Drawing'].forEach((suffix) => {
        const modeKey = suffix.toLowerCase();
        document.getElementById(`livewallInput${suffix}`).hidden = session.mode !== modeKey;
      });
      if (session.mode === 'drawing') this.initCanvas();
    },

    // --- 手繪畫板：600x400 內部解析度，CSS aspect-ratio:3/2 響應式縮放，
    //     pointer events 驅動、座標依「CSS 顯示尺寸→canvas 內部解析度」換算。 ---
    initCanvas() {
      if (this.canvasInited) return;
      this.canvasInited = true;
      this.canvas = document.getElementById('livewallCanvas');
      this.ctx = this.canvas.getContext('2d');
      this.ctx.fillStyle = '#ffffff';
      this.ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);

      const getPoint = (evt) => {
        const rect = this.canvas.getBoundingClientRect();
        const scaleX = this.canvas.width / rect.width;
        const scaleY = this.canvas.height / rect.height;
        return { x: (evt.clientX - rect.left) * scaleX, y: (evt.clientY - rect.top) * scaleY };
      };

      this.canvas.addEventListener('pointerdown', (evt) => {
        this.drawing = true;
        this.hasDrawn = true;
        this.canvas.setPointerCapture(evt.pointerId);
        const p = getPoint(evt);
        this.ctx.beginPath();
        this.ctx.moveTo(p.x, p.y);
      });
      this.canvas.addEventListener('pointermove', (evt) => {
        if (!this.drawing) return;
        const p = getPoint(evt);
        this.ctx.lineCap = 'round';
        this.ctx.lineJoin = 'round';
        this.ctx.strokeStyle = this.strokeColor;
        this.ctx.lineWidth = this.strokeWidth;
        this.ctx.lineTo(p.x, p.y);
        this.ctx.stroke();
        this.ctx.beginPath();
        this.ctx.moveTo(p.x, p.y);
      });
      const stopDrawing = () => { this.drawing = false; };
      this.canvas.addEventListener('pointerup', stopDrawing);
      this.canvas.addEventListener('pointerleave', stopDrawing);

      document.querySelectorAll('.livewall-color-swatch').forEach((btn) => {
        btn.addEventListener('click', () => {
          document.querySelectorAll('.livewall-color-swatch').forEach((b) => b.classList.remove('active'));
          btn.classList.add('active');
          this.strokeColor = btn.dataset.color;
        });
      });
      document.getElementById('livewallStrokeWidth').addEventListener('input', (evt) => {
        this.strokeWidth = Number(evt.target.value);
      });
      document.getElementById('btnLivewallCanvasClear').addEventListener('click', () => {
        this.ctx.fillStyle = '#ffffff';
        this.ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);
        this.hasDrawn = false;
      });
    },

    exportCanvasPng() {
      return new Promise((resolve) => this.canvas.toBlob(resolve, 'image/png'));
    },

    async submit() {
      const session = this.session;
      if (!session) return;
      const submitBtn = document.getElementById('btnLivewallSubmit');
      const formData = new FormData();

      if (session.mode === 'text') {
        const text = document.getElementById('livewallTextarea').value.trim();
        if (!text) { showToast('請輸入想分享的內容', 'error'); return; }
        formData.append('text_content', text);
      } else if (session.mode === 'photo') {
        const file = document.getElementById('livewallPhotoInput').files[0];
        if (!file) { showToast('請先選擇或拍攝一張照片', 'error'); return; }
        formData.append('file', file);
      } else if (session.mode === 'drawing') {
        if (!this.hasDrawn) { showToast('請先畫點什麼再送出喔！', 'error'); return; }
        const blob = await this.exportCanvasPng();
        formData.append('file', blob, 'drawing.png');
      }

      submitBtn.disabled = true;
      try {
        await apiUpload('/api/student/live-wall/submit', formData);
        showToast('已送出，等待老師查看囉！', 'success');
        await Promise.all([this.refresh(), this.loadHistory()]);
      } catch (e) {
        showToast(e.message, 'error');
      } finally {
        submitBtn.disabled = false;
      }
    },

    // 我的歷史紀錄（唯讀）：這門課所有場次自己送出過的貼文，沒有刪除功能——
    // 學生不得刪除自己的紀錄，刪除只能由教師端管理。
    async loadHistory() {
      try {
        const posts = await api('/api/student/live-wall/history');
        this.renderHistory(posts);
      } catch (e) {
        console.error('LiveWall.loadHistory error', e);
      }
    },

    renderHistory(posts) {
      const modeLabels = { text: '✏️ 文字', drawing: '🎨 手繪', photo: '📷 拍照' };
      const list = document.getElementById('livewallHistoryList');
      if (!list) return;
      list.innerHTML = '';
      if (!posts.length) {
        list.innerHTML = '<p style="color:var(--text-muted); font-size:0.88rem; margin:0;">目前還沒有任何歷史紀錄。</p>';
        return;
      }
      posts.forEach((p) => {
        const item = document.createElement('div');
        item.style.cssText = 'border:1px solid var(--card-border); border-radius:var(--radius-md); padding:10px 12px;';
        const meta = `${modeLabels[p.session_mode] || p.session_mode}${p.session_title ? '｜' + escapeHtml(p.session_title) : ''}｜${escapeHtml(p.created_at || '')}`;
        const contentHtml = p.text_content
          ? `<p style="white-space:pre-wrap; margin:6px 0 0;">${escapeHtml(p.text_content)}</p>`
          : `<img src="${fileUrlWithToken(p.image_url)}" style="max-width:100%; margin-top:6px; border-radius:var(--radius-sm);">`;
        item.innerHTML = `<div style="font-size:0.78rem; color:var(--text-muted);">${meta}</div>${contentHtml}`;
        list.appendChild(item);
      });
    },
  };

  document.getElementById('livewallHistoryToggle')?.addEventListener('click', () => {
    const list = document.getElementById('livewallHistoryList');
    const icon = document.getElementById('livewallHistoryToggleIcon');
    const expanded = !list.hidden;
    list.hidden = expanded;
    icon.textContent = expanded ? '▶' : '▼';
    if (!expanded) LiveWall.loadHistory();
  });

  document.getElementById('livewallPhotoInput')?.addEventListener('change', (evt) => {
    const file = evt.target.files[0];
    const preview = document.getElementById('livewallPhotoPreview');
    if (!file) { preview.hidden = true; return; }
    preview.src = URL.createObjectURL(file);
    preview.hidden = false;
  });
  document.getElementById('btnLivewallSubmit')?.addEventListener('click', () => LiveWall.submit());

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
      alert(res.message || '兌換成功！');
      await loadScores();
    } catch (err) {
      alert(err.message || '兌換失敗');
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

  const btnRefreshFileCollect = document.getElementById('btnRefreshStudentFileCollect');
  if (btnRefreshFileCollect) {
    btnRefreshFileCollect.addEventListener('click', loadStudentFileCollections);
  }

  // 高畫質拍攝：以 getUserMedia 要求最高解析度 + MediaRecorder 高位元率，避開瀏覽器內建拍攝（<input capture>）的低畫質壓縮。
  // onDone(file) 於使用者確認後回傳 File（錄影或照片）。
  const FC_CAM_MAX_BYTES = 240 * 1024 * 1024; // 單檔上限 250MB，預留餘裕自動停止
  const FC_CAM_VIDEO_BPS = 12_000_000;

  function openFileCollectCamera(onDone) {
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      showToast('此瀏覽器或連線不支援網頁拍攝（需 HTTPS），請改用「選擇檔案上傳」。', 'error');
      return;
    }

    let stream = null;
    let facing = 'environment';
    let deviceId = null; // 使用者從下拉選單指定的相機（null 時以 facing 自動選擇）
    let quality = 'max';
    let devices = []; // 偵測到的視訊裝置
    let caps = null; // 目前相機的 getCapabilities()
    let recorder = null;
    let chunks = [];
    let recBytes = 0;
    let timer = null;
    let startedAt = 0;
    let result = null; // { blob, name, type, url }

    const overlay = document.createElement('div');
    overlay.style.cssText = 'position:fixed;inset:0;z-index:99999;background:#000;display:flex;flex-direction:column;';
    overlay.innerHTML = `
      <div style="flex:1;min-height:0;position:relative;display:flex;align-items:center;justify-content:center;">
        <video class="fc-cam-live" autoplay playsinline muted style="max-width:100%;max-height:100%;"></video>
        <video class="fc-cam-review" controls playsinline style="max-width:100%;max-height:100%;display:none;"></video>
        <img class="fc-cam-photo" alt="" style="max-width:100%;max-height:100%;display:none;">
        <div class="fc-cam-info" style="position:absolute;top:10px;left:10px;right:10px;color:#fff;font-size:0.85rem;font-weight:700;text-shadow:0 1px 3px #000;"></div>
      </div>
      <div class="fc-cam-bar" style="display:flex;gap:10px;justify-content:center;align-items:center;flex-wrap:wrap;padding:12px;background:#111;"></div>
    `;
    document.body.appendChild(overlay);

    const live = overlay.querySelector('.fc-cam-live');
    const review = overlay.querySelector('.fc-cam-review');
    const photoImg = overlay.querySelector('.fc-cam-photo');
    const info = overlay.querySelector('.fc-cam-info');
    const bar = overlay.querySelector('.fc-cam-bar');

    const btnHtml = (id, label, extra = '') =>
      `<button type="button" data-act="${id}" class="btn btn-secondary" style="padding:9px 16px;font-weight:800;${extra}">${label}</button>`;

    const stopStream = () => {
      if (stream) stream.getTracks().forEach((t) => t.stop());
      stream = null;
    };

    const close = () => {
      clearInterval(timer);
      if (recorder && recorder.state !== 'inactive') {
        recorder.onstop = null;
        try { recorder.stop(); } catch (_) { /* ignore */ }
      }
      stopStream();
      if (result && result.url) URL.revokeObjectURL(result.url);
      overlay.remove();
    };

    const fmtTime = (ms) => {
      const s = Math.floor(ms / 1000);
      return `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
    };

    const QUALITY_PRESETS = {
      max: { label: '最高（自動）', w: 7680, h: 4320 },
      '2160': { label: '4K (3840×2160)', w: 3840, h: 2160 },
      '1080': { label: '1080p (1920×1080)', w: 1920, h: 1080 },
      '720': { label: '720p (1280×720)', w: 1280, h: 720 },
    };

    const camLabel = (d, i) => d.label || `相機 ${i + 1}`;

    const showLive = () => {
      live.style.display = '';
      review.style.display = 'none';
      photoImg.style.display = 'none';
      if (result && result.url) URL.revokeObjectURL(result.url);
      result = null;
      const track = stream && stream.getVideoTracks()[0];
      const st = track ? track.getSettings() : {};
      const capMaxW = caps && caps.width ? Math.max(caps.width.max || 0, (caps.height && caps.height.max) || 0) : 0;
      const capMaxText = caps && caps.width && caps.height ? `｜此相機最高支援 ${caps.width.max}×${caps.height.max}${caps.frameRate ? ' @' + Math.round(caps.frameRate.max) + 'fps' : ''}` : '';
      info.textContent = st.width
        ? `偵測到 ${devices.length || 1} 個相機｜目前 ${st.width}×${st.height}${st.frameRate ? ' @' + Math.round(st.frameRate) + 'fps' : ''}${capMaxText}`
        : '';

      const curId = st.deviceId || deviceId || '';
      const camOpts = devices.map((d, i) =>
        `<option value="${escapeHtml(d.deviceId)}" ${d.deviceId === curId ? 'selected' : ''}>${escapeHtml(camLabel(d, i))}</option>`).join('');
      const qOpts = Object.entries(QUALITY_PRESETS).map(([k, v]) => {
        // 已知相機上限時，停用超出能力的畫質選項（最高選項永遠可用）
        const unsupported = k !== 'max' && capMaxW > 0 && Math.max(v.w, v.h) > capMaxW;
        return `<option value="${k}" ${k === quality ? 'selected' : ''} ${unsupported ? 'disabled' : ''}>${v.label}${unsupported ? '（不支援）' : ''}</option>`;
      }).join('');
      const selStyle = 'padding:7px 8px;border-radius:6px;font-size:0.85rem;max-width:46vw;';
      bar.innerHTML =
        `<div style="width:100%;display:flex;gap:8px;justify-content:center;flex-wrap:wrap;">
          ${devices.length > 1 ? `<select data-sel="camera" style="${selStyle}">${camOpts}</select>` : ''}
          <select data-sel="quality" style="${selStyle}">${qOpts}</select>
        </div>` +
        btnHtml('photo', '📸 拍照') +
        btnHtml('rec', '⏺ 開始錄影', 'background:#dc2626;color:#fff;border-color:#dc2626;') +
        btnHtml('flip', '🔄 切換鏡頭') +
        btnHtml('cancel', '✖ 關閉');
    };

    const startStream = async () => {
      stopStream();
      // ideal 向裝置要求目標解析度，由瀏覽器自動降到實際支援的最大值
      const q = QUALITY_PRESETS[quality];
      const video = { width: { ideal: q.w }, height: { ideal: q.h }, frameRate: { ideal: 30 } };
      if (deviceId) video.deviceId = { exact: deviceId };
      else video.facingMode = { ideal: facing };
      try {
        stream = await navigator.mediaDevices.getUserMedia({ video, audio: true });
      } catch (err) {
        try {
          stream = await navigator.mediaDevices.getUserMedia({ video, audio: false });
          showToast('未取得麥克風權限，僅能無聲錄影。', 'error');
        } catch (err2) {
          if (deviceId) {
            // 指定的相機無法使用時，回到自動選擇
            deviceId = null;
            showToast('指定的相機無法使用，已改為自動選擇。', 'error');
            return startStream();
          }
          showToast(`無法開啟相機：${err2.message || err2.name}`, 'error');
          close();
          return;
        }
      }
      live.srcObject = stream;
      const track = stream.getVideoTracks()[0];
      caps = track && track.getCapabilities ? track.getCapabilities() : null;
      // 取得權限後才能讀到相機名稱
      try {
        devices = (await navigator.mediaDevices.enumerateDevices()).filter((d) => d.kind === 'videoinput');
      } catch (_) {
        devices = [];
      }
      if (!stream) return; // 偵測期間使用者已關閉視窗
      showLive();
    };

    const showReview = () => {
      live.style.display = 'none';
      if (result.type.startsWith('video/')) {
        review.src = result.url;
        review.style.display = '';
        photoImg.style.display = 'none';
      } else {
        photoImg.src = result.url;
        photoImg.style.display = '';
        review.style.display = 'none';
      }
      info.textContent = `${result.name}（${formatBytes(result.blob.size)}）`;
      bar.innerHTML =
        btnHtml('upload', '✅ 上傳', 'background:#059669;color:#fff;border-color:#059669;') +
        btnHtml('retake', '↩ 重拍') +
        btnHtml('cancel', '✖ 取消');
    };

    const stamp = () => {
      const d = new Date();
      const p = (n) => String(n).padStart(2, '0');
      return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}_${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
    };

    const takePhoto = async () => {
      const track = stream.getVideoTracks()[0];
      let blob = null;
      // 支援 ImageCapture 的瀏覽器（Android Chrome）可取得感光元件全解析度照片
      if (window.ImageCapture && track) {
        try { blob = await new ImageCapture(track).takePhoto(); } catch (_) { blob = null; }
      }
      if (!blob) {
        const c = document.createElement('canvas');
        c.width = live.videoWidth;
        c.height = live.videoHeight;
        c.getContext('2d').drawImage(live, 0, 0);
        blob = await new Promise((resolve) => c.toBlob(resolve, 'image/jpeg', 0.95));
      }
      if (!blob) { showToast('拍照失敗，請重試。', 'error'); return; }
      const ext = blob.type === 'image/png' ? 'png' : 'jpg';
      result = { blob, type: blob.type || 'image/jpeg', name: `拍照_${stamp()}.${ext}`, url: URL.createObjectURL(blob) };
      stopStream();
      showReview();
    };

    const startRecording = () => {
      if (typeof MediaRecorder === 'undefined') {
        showToast('此瀏覽器不支援網頁錄影，請改用「選擇檔案上傳」。', 'error');
        return;
      }
      const candidates = [
        'video/mp4;codecs=avc1.640028,mp4a.40.2', 'video/mp4;codecs=avc1', 'video/mp4',
        'video/webm;codecs=vp9,opus', 'video/webm;codecs=vp8,opus', 'video/webm',
      ];
      const mimeType = candidates.find((m) => MediaRecorder.isTypeSupported(m)) || '';
      try {
        recorder = new MediaRecorder(stream, mimeType
          ? { mimeType, videoBitsPerSecond: FC_CAM_VIDEO_BPS, audioBitsPerSecond: 128_000 }
          : { videoBitsPerSecond: FC_CAM_VIDEO_BPS });
      } catch (err) {
        showToast(`無法開始錄影：${err.message}`, 'error');
        return;
      }
      chunks = [];
      recBytes = 0;
      recorder.ondataavailable = (e) => {
        if (e.data && e.data.size > 0) {
          chunks.push(e.data);
          recBytes += e.data.size;
        }
      };
      recorder.onstop = () => {
        clearInterval(timer);
        const type = (recorder.mimeType || mimeType || 'video/webm').split(';')[0];
        const blob = new Blob(chunks, { type });
        const ext = type.includes('mp4') ? 'mp4' : 'webm';
        result = { blob, type, name: `錄影_${stamp()}.${ext}`, url: URL.createObjectURL(blob) };
        stopStream();
        showReview();
      };
      recorder.start(1000);
      startedAt = Date.now();
      bar.innerHTML = btnHtml('stop', '⏹ 停止錄影', 'background:#dc2626;color:#fff;border-color:#dc2626;');
      timer = setInterval(() => {
        info.textContent = `🔴 錄影中 ${fmtTime(Date.now() - startedAt)}　${formatBytes(recBytes)}`;
        if (recBytes >= FC_CAM_MAX_BYTES && recorder.state === 'recording') {
          showToast('已接近單檔 250MB 上限，自動停止錄影。', 'error');
          recorder.stop();
        }
      }, 500);
    };

    bar.addEventListener('click', (e) => {
      const act = e.target.closest('button')?.dataset.act;
      if (!act) return;
      if (act === 'photo') takePhoto();
      else if (act === 'rec') startRecording();
      else if (act === 'stop') { if (recorder && recorder.state === 'recording') recorder.stop(); }
      else if (act === 'flip') { deviceId = null; facing = facing === 'environment' ? 'user' : 'environment'; startStream(); }
      else if (act === 'retake') startStream();
      else if (act === 'upload') {
        const file = new File([result.blob], result.name, { type: result.type });
        close();
        onDone(file);
      } else if (act === 'cancel') close();
    });

    bar.addEventListener('change', (e) => {
      const sel = e.target.dataset.sel;
      if (sel === 'camera') { deviceId = e.target.value || null; startStream(); }
      else if (sel === 'quality') { quality = e.target.value; startStream(); }
    });

    startStream();
  }

  // 以明確副檔名列表作為 accept（不使用 image/*、video/*），避免 iOS/Android 選取器出現「拍照或錄影」選項，強制先拍後上傳以保留原始畫質
  function fileCollectAcceptAttr(allowedExtensions) {
    const custom = String(allowedExtensions || '')
      .split(/[,\s;，、]+/)
      .map((e) => e.trim().toLowerCase().replace(/^\./, ''))
      .filter(Boolean)
      .map((e) => `.${e}`);
    if (custom.length > 0) return custom.join(',');
    return [
      '.jpg', '.jpeg', '.png', '.gif', '.webp', '.heic', '.heif',
      '.mp4', '.mov', '.m4v', '.webm', '.mp3', '.m4a', '.wav', '.aac', '.ogg',
      '.pdf', '.doc', '.docx', '.ppt', '.pptx', '.xls', '.xlsx', '.csv', '.txt', '.zip',
    ].join(',');
  }

  function formatBytes(bytes) {
    if (!bytes || bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
  }

  // ==========================================================================
  // 📁 課堂臨時檔案蒐集 (Student File Collections) - 支援卡片摺疊與展開
  // ==========================================================================
  const studentTopicFoldState = new Map(); // topicId -> boolean (true: 展開, false: 收合)

  async function loadStudentFileCollections() {
    const listEl = document.getElementById('studentFileCollectList');
    const emptyEl = document.getElementById('studentFileCollectEmpty');
    if (!listEl) return;

    try {
      const topics = await api('/api/student/file-collections');
      listEl.innerHTML = '';
      if (!topics || topics.length === 0) {
        if (emptyEl) emptyEl.style.display = 'block';
        return;
      }
      if (emptyEl) emptyEl.style.display = 'none';

      topics.forEach((topic) => {
        const isOpen = Boolean(topic.allow_upload);
        const myFiles = topic.my_files || [];

        // 摺疊預設值：
        // 1. 若學生手動切換過，維持學生設定；
        // 2. 若開放上傳中，預設展開供學生交件；
        // 3. 若已停止上傳，預設收合以避免版面雜亂；
        // 4. 若所有主題皆已停止上傳，則第一個主題預設展開。
        const hasUserToggled = studentTopicFoldState.has(topic.id);
        const isExpanded = hasUserToggled
          ? Boolean(studentTopicFoldState.get(topic.id))
          : isOpen || (topics.every((t) => !t.allow_upload) && topics[0]?.id === topic.id);

        const card = document.createElement('div');
        card.className = `filecollect-card ${isExpanded ? 'expanded' : ''}`;
        card.dataset.topicId = String(topic.id);

        const statusBadge = isOpen
          ? `<span class="badge" style="background: var(--accent-positive-bg, #ecfdf5); color: var(--accent-positive, #059669); border: 1px solid rgba(16, 185, 129, 0.3); font-size: 0.78rem; padding: 3px 10px; border-radius: 12px; font-weight: 800;">🟢 開放上傳中</span>`
          : `<span class="badge" style="background: var(--accent-negative-bg, #fef2f2); color: var(--accent-negative, #dc2626); border: 1px solid rgba(239, 68, 68, 0.3); font-size: 0.78rem; padding: 3px 10px; border-radius: 12px; font-weight: 800;">🔒 教師已停止上傳</span>`;

        const myFilesCountBadge = myFiles.length > 0
          ? `<span class="badge" style="background: #ecfdf5; color: #059669; border: 1px solid rgba(16, 185, 129, 0.3); font-size: 0.76rem; font-weight: 800; padding: 2px 8px; border-radius: 12px;">✅ 已繳交 ${myFiles.length} 檔</span>`
          : `<span class="badge" style="background: rgba(0,0,0,0.04); color: var(--text-muted); font-size: 0.76rem; font-weight: 600; padding: 2px 8px; border-radius: 12px;">未繳交</span>`;

        let uploadSectionHtml = '';
        if (isOpen) {
          uploadSectionHtml = `
            <div class="filecollect-upload-box" style="margin: 14px 0; padding: 16px; border: 2px dashed var(--student-primary-border, #0284c7); border-radius: 10px; background: rgba(2, 132, 199, 0.04); text-align: center;">
              <input type="file" multiple id="stu-file-input-${topic.id}" accept="${escapeHtml(fileCollectAcceptAttr(topic.allowed_extensions))}" style="display: none;">
              <button type="button" class="btn btn-primary btn-choose-files" style="font-weight: 800; padding: 9px 20px; font-size: 0.92rem;">
                📤 選擇檔案上傳
              </button>
              <button type="button" class="btn btn-secondary btn-camera-capture" style="font-weight: 800; padding: 9px 20px; font-size: 0.92rem; margin-left: 6px;">
                🎥 高畫質拍攝
              </button>
              <div style="font-size: 0.8rem; color: var(--text-muted); margin-top: 6px;">
                拍攝請使用「高畫質拍攝」（以裝置最高解析度錄製）；也可先用相機 App 拍好，再按「選擇檔案上傳」。
              </div>
              <div style="font-size: 0.82rem; color: var(--text-muted); margin-top: 8px;">
                ${topic.allowed_extensions ? `僅支援格式：<code>${escapeHtml(topic.allowed_extensions)}</code>` : '支援影片、錄音、照片或一般檔案 (可多選，單檔上限 250MB)'}
              </div>
              <div class="upload-progress-wrap" style="display: none; margin-top: 10px; font-size: 0.85rem; font-weight: 700; color: var(--student-primary);">
                ⏳ 正在上傳中，請稍候...
              </div>
            </div>
          `;
        } else {
          uploadSectionHtml = `
            <div style="margin: 14px 0; padding: 12px 16px; border-radius: 8px; background: #fef2f2; border: 1px solid rgba(239, 68, 68, 0.25); color: #b91c1c; font-size: 0.85rem; font-weight: 700; display: flex; align-items: center; gap: 8px;">
              <span>🔒</span>
              <span>教師已截止此項目的收件，目前無法上傳新檔案，亦不可重新命名或刪除已繳交檔案。</span>
            </div>
          `;
        }

        // 渲染已上傳檔案列表
        let filesHtml = '';
        if (myFiles.length === 0) {
          filesHtml = `<div style="font-size: 0.85rem; color: var(--text-muted); font-style: italic; padding: 8px 0;">你尚未在此主題上傳任何檔案。</div>`;
        } else {
          const fileItemsHtml = myFiles.map((f) => {
            const ext = (f.original_filename || '').split('.').pop()?.toLowerCase() || '';
            const mime = (f.mime_type || '').toLowerCase();
            const isVideo = ['mp4', 'webm', 'mov', 'm4v'].includes(ext) || mime.startsWith('video/');
            const isAudio = ['mp3', 'wav', 'm4a', 'ogg', 'aac'].includes(ext) || mime.startsWith('audio/');
            const isImage = ['jpg', 'jpeg', 'png', 'gif', 'webp'].includes(ext) || mime.startsWith('image/');

            let mediaPreview = '';
            if (isVideo) {
              mediaPreview = `
                <div style="margin-top: 8px; max-width: 320px;">
                  <video controls preload="metadata" playsinline style="width: 100%; max-height: 160px; border-radius: 6px; background: #000;">
                    <source src="${fileUrlWithToken(f.file_url)}">
                  </video>
                </div>
              `;
            } else if (isAudio) {
              mediaPreview = `
                <div style="margin-top: 8px; max-width: 340px;">
                  <audio controls preload="metadata" style="width: 100%; height: 36px;">
                    <source src="${fileUrlWithToken(f.file_url)}">
                  </audio>
                </div>
              `;
            } else if (isImage) {
              mediaPreview = `
                <div style="margin-top: 8px;">
                  <img src="${fileUrlWithToken(f.file_url)}" alt="${escapeHtml(f.display_name)}" style="max-height: 120px; border-radius: 6px; cursor: pointer; border: 1px solid var(--card-border);" onclick="window.open('${fileUrlWithToken(f.file_url)}', '_blank')">
                </div>
              `;
            }

            const downloadLink = fileUrlWithToken(f.file_url, f.display_name);

            // 當教師停止上傳時，不得重新命名或刪除！
            const renameBtnHtml = isOpen
              ? `<button type="button" class="btn btn-secondary btn-sm btn-rename-file" data-file-id="${f.id}" data-file-name="${escapeHtml(f.display_name)}" style="font-size: 0.78rem; padding: 3px 8px;">✏️ 重新命名</button>`
              : `<button type="button" class="btn btn-secondary btn-sm" disabled title="教師已停止上傳，不可修改檔名" style="font-size: 0.78rem; padding: 3px 8px; opacity: 0.5; cursor: not-allowed;">🔒 鎖定</button>`;

            const deleteBtnHtml = isOpen
              ? `<button type="button" class="btn btn-secondary btn-sm btn-delete-file" data-file-id="${f.id}" data-file-name="${escapeHtml(f.display_name)}" style="font-size: 0.78rem; padding: 3px 8px; color: var(--accent-negative); border-color: var(--accent-negative-border);">🗑️ 刪除</button>`
              : '';

            return `
              <div class="stu-file-row" style="background: var(--card-bg); border: 1px solid var(--card-border); border-radius: 8px; padding: 12px 14px; margin-bottom: 8px;">
                <div style="display: flex; justify-content: space-between; align-items: flex-start; gap: 8px; flex-wrap: wrap;">
                  <div>
                    <div style="font-weight: 800; font-size: 0.95rem; color: var(--text-main); word-break: break-all;">
                      ${escapeHtml(f.display_name)}
                    </div>
                    ${f.display_name !== f.original_filename ? `<div style="font-size: 0.76rem; color: var(--text-muted); margin-top: 2px;">原檔名: ${escapeHtml(f.original_filename)}</div>` : ''}
                    <div style="font-size: 0.78rem; color: var(--text-muted); margin-top: 4px;">
                      大小：${formatBytes(f.file_size)} ｜ 上傳時間：${f.uploaded_at ? f.uploaded_at.slice(5, 16) : ''}
                    </div>
                  </div>
                  <div style="display: flex; gap: 6px; align-items: center;">
                    <a href="${downloadLink}" download class="btn btn-secondary btn-sm" style="font-size: 0.78rem; padding: 3px 8px; text-decoration: none;">📥 下載</a>
                    ${renameBtnHtml}
                    ${deleteBtnHtml}
                  </div>
                </div>
                ${mediaPreview}
              </div>
            `;
          }).join('');

          filesHtml = `<div style="display: flex; flex-direction: column; gap: 6px; margin-top: 10px;">${fileItemsHtml}</div>`;
        }

        card.innerHTML = `
          <!-- 標題收合列 (點擊任意處可摺疊/展開) -->
          <div class="filecollect-card-header" role="button" tabindex="0" title="點擊收合或展開此主題">
            <div style="display: flex; align-items: center; gap: 10px; min-width: 0; flex: 1;">
              <span class="filecollect-chevron-icon">❯</span>
              <div style="min-width: 0; flex: 1;">
                <div style="display: flex; align-items: center; gap: 8px; flex-wrap: wrap;">
                  <h3 style="margin: 0; font-size: 1.12rem; font-weight: 800; color: var(--text-main); word-break: break-all;">${escapeHtml(topic.title)}</h3>
                  ${myFilesCountBadge}
                </div>
                ${topic.description ? `<div class="filecollect-desc-preview" style="font-size: 0.83rem; color: var(--text-muted); margin-top: 3px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; max-width: 520px;">${escapeHtml(topic.description)}</div>` : ''}
              </div>
            </div>
            <div style="display: flex; align-items: center; gap: 8px; flex-shrink: 0;">
              ${statusBadge}
              <span class="filecollect-toggle-hint" style="font-size: 0.8rem; font-weight: 700; color: var(--student-primary); padding: 4px 8px; border-radius: 6px; background: rgba(2, 132, 199, 0.08); white-space: nowrap;">
                ${isExpanded ? '收合 ▲' : '展開 ▼'}
              </span>
            </div>
          </div>

          <!-- 摺疊內容主體 -->
          <div class="filecollect-card-body">
            ${topic.description ? `<div style="font-size: 0.88rem; color: var(--text-muted); margin-bottom: 12px; white-space: pre-wrap; padding: 8px 12px; background: rgba(0,0,0,0.02); border-radius: 6px; border: 1px solid var(--card-border);">${escapeHtml(topic.description)}</div>` : ''}

            ${uploadSectionHtml}

            <div style="margin-top: 14px; border-top: 1px dashed var(--card-border); padding-top: 12px;">
              <div style="font-size: 0.92rem; font-weight: 800; color: var(--text-main); display: flex; align-items: center; justify-content: space-between;">
                <span>📁 我已繳交的檔案 (${myFiles.length})</span>
              </div>
              ${filesHtml}
            </div>
          </div>
        `;

        // 綁定收合/展開事件
        const header = card.querySelector('.filecollect-card-header');
        const toggleHint = card.querySelector('.filecollect-toggle-hint');

        const toggleFold = (forceState) => {
          const willExpand = typeof forceState === 'boolean' ? forceState : !card.classList.contains('expanded');
          if (willExpand) {
            card.classList.add('expanded');
            if (toggleHint) toggleHint.textContent = '收合 ▲';
          } else {
            card.classList.remove('expanded');
            if (toggleHint) toggleHint.textContent = '展開 ▼';
          }
          studentTopicFoldState.set(topic.id, willExpand);
        };

        if (header) {
          header.addEventListener('click', (e) => {
            if (e.target.closest('button') || e.target.closest('a') || e.target.closest('input')) return;
            toggleFold();
          });
          header.addEventListener('keydown', (e) => {
            if (e.key === 'Enter' || e.key === ' ') {
              e.preventDefault();
              toggleFold();
            }
          });
        }

        // 綁定檔案上傳按鈕事件
        if (isOpen) {
          const fileInput = card.querySelector(`#stu-file-input-${topic.id}`);
          const btnChoose = card.querySelector('.btn-choose-files');
          const progressWrap = card.querySelector('.upload-progress-wrap');

          const btnCamera = card.querySelector('.btn-camera-capture');

          const uploadFiles = async (files) => {
            if (!files || files.length === 0) return;

            btnChoose.disabled = true;
            if (btnCamera) btnCamera.disabled = true;
            if (progressWrap) progressWrap.style.display = 'block';

            const formData = new FormData();
            for (let i = 0; i < files.length; i++) {
              formData.append('files', files[i]);
            }

            try {
              const token = localStorage.getItem(TOKEN_KEY);
              const res = await fetch(`/api/student/file-collections/${topic.id}/upload`, {
                method: 'POST',
                headers: token ? { Authorization: `Bearer ${token}` } : {},
                body: formData,
              });
              const data = await res.json();
              if (!res.ok) throw new Error(data.detail || '上傳失敗');

              showToast(data.message || '檔案上傳成功！', 'positive');
              studentTopicFoldState.set(topic.id, true);
              loadStudentFileCollections();
            } catch (err) {
              showToast(`上傳失敗：${err.message}`, 'error');
            } finally {
              btnChoose.disabled = false;
              if (btnCamera) btnCamera.disabled = false;
              if (progressWrap) progressWrap.style.display = 'none';
            }
          };

          if (btnChoose && fileInput) {
            btnChoose.addEventListener('click', () => fileInput.click());
            fileInput.addEventListener('change', async () => {
              const files = Array.from(fileInput.files || []);
              fileInput.value = '';
              await uploadFiles(files);
            });
          }
          if (btnCamera) {
            btnCamera.addEventListener('click', () => openFileCollectCamera((file) => uploadFiles([file])));
          }
        }

        // 綁定重新命名與刪除事件
        if (isOpen) {
          card.querySelectorAll('.btn-rename-file').forEach((btn) => {
            btn.addEventListener('click', async () => {
              const fileId = btn.dataset.fileId;
              const currentName = btn.dataset.fileName;
              const newName = await showPromptModal({ icon: '✏️', title: '請輸入新的檔案名稱：', defaultValue: currentName });
              if (!newName || newName.trim() === '' || newName === currentName) return;

              try {
                const res = await api(`/api/student/file-collections/${topic.id}/items/${fileId}/rename`, {
                  method: 'PUT',
                  body: JSON.stringify({ display_name: newName.trim() }),
                });
                showToast(res.message || '檔案名稱已更新', 'positive');
                studentTopicFoldState.set(topic.id, true);
                loadStudentFileCollections();
              } catch (err) {
                showToast(`重新命名失敗：${err.message}`, 'error');
              }
            });
          });

          card.querySelectorAll('.btn-delete-file').forEach((btn) => {
            btn.addEventListener('click', async () => {
              const fileId = btn.dataset.fileId;
              const currentName = btn.dataset.fileName;
              if (!(await showConfirmModal({ icon: '🗑️', title: `確定要刪除檔案「${currentName}」嗎？`, danger: true }))) return;

              try {
                const res = await api(`/api/student/file-collections/${topic.id}/items/${fileId}`, {
                  method: 'DELETE',
                });
                showToast(res.message || '檔案已刪除', 'positive');
                studentTopicFoldState.set(topic.id, true);
                loadStudentFileCollections();
              } catch (err) {
                showToast(`刪除失敗：${err.message}`, 'error');
              }
            });
          });
        }

        listEl.appendChild(card);
      });

      // 綁定頂部工具列「全部展開」、「全部收合」、「重新整理」
      const btnExpandAll = document.getElementById('btnExpandAllStudentFileCollect');
      if (btnExpandAll && !btnExpandAll.dataset.bound) {
        btnExpandAll.dataset.bound = '1';
        btnExpandAll.addEventListener('click', () => {
          document.querySelectorAll('#studentFileCollectList .filecollect-card').forEach((c) => {
            c.classList.add('expanded');
            const hint = c.querySelector('.filecollect-toggle-hint');
            if (hint) hint.textContent = '收合 ▲';
            const tid = Number(c.dataset.topicId);
            if (tid) studentTopicFoldState.set(tid, true);
          });
        });
      }

      const btnCollapseAll = document.getElementById('btnCollapseAllStudentFileCollect');
      if (btnCollapseAll && !btnCollapseAll.dataset.bound) {
        btnCollapseAll.dataset.bound = '1';
        btnCollapseAll.addEventListener('click', () => {
          document.querySelectorAll('#studentFileCollectList .filecollect-card').forEach((c) => {
            c.classList.remove('expanded');
            const hint = c.querySelector('.filecollect-toggle-hint');
            if (hint) hint.textContent = '展開 ▼';
            const tid = Number(c.dataset.topicId);
            if (tid) studentTopicFoldState.set(tid, false);
          });
        });
      }

      const btnRefresh = document.getElementById('btnRefreshStudentFileCollect');
      if (btnRefresh && !btnRefresh.dataset.bound) {
        btnRefresh.dataset.bound = '1';
        btnRefresh.addEventListener('click', () => loadStudentFileCollections());
      }
    } catch (err) {
      console.error('[StudentFileCollect] error:', err);
      showToast(err.message, 'error');
    }
  }

  // =========================================================================
  // StudentApp: 學生端課堂文字雲與 Kahoot 答題即時互動 (支援獨立分頁與即時彈窗)
  // =========================================================================
  const StudentApp = {
    activeWordCloud: null,
    activeKahoot: null,
    kahootTimer: null,
    kahootTimeLeft: 0,
    myChoice: null,
    myWords: [],

    init() {
      // 1. 文字雲事件綁定 (彈窗與獨立分頁)
      const bindWc = (inputId, btnId) => {
        const input = document.getElementById(inputId);
        const btn = document.getElementById(btnId);
        if (btn) btn.addEventListener('click', () => this.submitWordCloud(inputId));
        if (input) {
          input.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') this.submitWordCloud(inputId);
          });
        }
      };
      bindWc('studentWordCloudInput', 'btnStudentWordCloudSubmit');
      bindWc('studentTabWordCloudInput', 'btnStudentTabWordCloudSubmit');

      document.getElementById('btnStudentWordCloudClose')?.addEventListener('click', () => {
        document.getElementById('modalStudentWordCloud').style.display = 'none';
      });

      // 2. Kahoot 選項按鈕綁定 (彈窗與分頁內的所有四色按鈕)
      document.querySelectorAll('.student-kahoot-opt-btn').forEach(btn => {
        btn.addEventListener('click', (e) => {
          const optIdx = Number(e.currentTarget.dataset.opt);
          this.submitKahootAnswer(optIdx);
        });
      });

      document.getElementById('btnStudentKahootClose')?.addEventListener('click', () => {
        document.getElementById('modalStudentKahoot').style.display = 'none';
      });
    },

    syncWordCloudTab() {
      const emptyEl = document.getElementById('studentWordCloudEmpty');
      const activeEl = document.getElementById('studentWordCloudActive');
      if (!this.activeWordCloud) {
        if (emptyEl) emptyEl.hidden = false;
        if (activeEl) activeEl.hidden = true;
      } else {
        if (emptyEl) emptyEl.hidden = true;
        if (activeEl) activeEl.hidden = false;
        const titleEl = document.getElementById('studentTabWordCloudTitle');
        if (titleEl) titleEl.textContent = this.activeWordCloud.title || '請用一個詞分享你的想法';
        this.renderMyWords();
      }
    },

    syncKahootTab() {
      const emptyEl = document.getElementById('studentKahootEmpty');
      const activeEl = document.getElementById('studentKahootActive');
      if (!this.activeKahoot) {
        if (emptyEl) emptyEl.hidden = false;
        if (activeEl) activeEl.hidden = true;
      } else {
        if (emptyEl) emptyEl.hidden = true;
        if (activeEl) activeEl.hidden = false;
      }
    },

    renderMyWords() {
      const html = this.myWords.length === 0
        ? '<span style="font-size: 0.85rem; color: var(--text-muted);">尚未送出任何詞彙</span>'
        : this.myWords.map(w => `
            <span style="font-size: 0.88rem; font-weight: 800; background: rgba(2, 132, 199, 0.12); color: var(--student-primary-dark); padding: 4px 12px; border-radius: 9999px; border: 1.5px solid var(--student-primary-border); display: inline-flex; align-items: center; gap: 4px;">
              <span>💬</span> ${escapeHtml(w)}
            </span>
          `).join('');

      const el1 = document.getElementById('studentWordCloudMyWords');
      const el2 = document.getElementById('studentTabWordCloudMyWords');
      if (el1) el1.innerHTML = html;
      if (el2) el2.innerHTML = html;
    },

    onWordCloudStart(payload) {
      this.activeWordCloud = payload;
      this.myWords = [];

      // 自動切換到文字雲分頁
      switchTab('wordCloud');
      this.syncWordCloudTab();

      // 彈窗同步更新
      const modal = document.getElementById('modalStudentWordCloud');
      const titleEl = document.getElementById('studentWordCloudTitle');
      const inputEl = document.getElementById('studentWordCloudInput');
      const tabInput = document.getElementById('studentTabWordCloudInput');

      if (titleEl) titleEl.textContent = payload.title || '請用一個詞分享你的想法';
      const placeholder = `請輸入一個詞（最多 20 字，上限 ${payload.maxWordsPerUser || 3} 個詞）`;
      if (inputEl) {
        inputEl.value = '';
        inputEl.disabled = false;
        inputEl.placeholder = placeholder;
      }
      if (tabInput) {
        tabInput.value = '';
        tabInput.disabled = false;
        tabInput.placeholder = placeholder;
      }

      this.renderMyWords();
      showToast('☁️ 老師已開啟課堂即時文字雲！', 'info');
    },

    onWordCloudEnd() {
      this.activeWordCloud = null;
      this.syncWordCloudTab();
      const modal = document.getElementById('modalStudentWordCloud');
      if (modal) modal.style.display = 'none';
      showToast('☁️ 本次文字雲收集已結束。', 'info');
    },

    submitWordCloud(inputId = 'studentTabWordCloudInput') {
      if (!this.activeWordCloud) {
        showToast('目前沒有進行中的文字雲活動', 'warning');
        return;
      }
      const inputEl = document.getElementById(inputId) || document.getElementById('studentTabWordCloudInput') || document.getElementById('studentWordCloudInput');
      const word = (inputEl?.value || '').trim();
      if (!word) {
        showToast('請輸入詞彙！', 'warning');
        inputEl?.focus();
        return;
      }

      const maxWords = this.activeWordCloud.maxWordsPerUser || 3;
      if (this.myWords.length >= maxWords) {
        showToast(`已達提交上限（最多 ${maxWords} 個詞）！`, 'warning');
        return;
      }

      if (this.activeWordCloud.allowDuplicate === 0 && this.myWords.includes(word)) {
        showToast('你已經提交過這個詞囉！', 'warning');
        return;
      }

      if (window.activeSocket) {
        window.activeSocket.emit('wordcloud:submit', {
          sessionId: this.activeWordCloud.sessionId,
          word
        });
      }

      this.myWords.push(word);
      const in1 = document.getElementById('studentWordCloudInput');
      const in2 = document.getElementById('studentTabWordCloudInput');
      if (in1) in1.value = '';
      if (in2) in2.value = '';

      this.renderMyWords();
      showToast(`已成功送出：${word}`, 'success');

      if (this.myWords.length >= maxWords) {
        if (in1) { in1.disabled = true; in1.placeholder = '已達提交上限，謝謝參與！'; }
        if (in2) { in2.disabled = true; in2.placeholder = '已達提交上限，謝謝參與！'; }
      }
    },

    onKahootQuestion(payload) {
      this.activeKahoot = payload;
      this.myChoice = null;
      this.kahootTimeLeft = payload.timeLimitSec || 20;

      // 自動切換到答題競賽分頁
      switchTab('kahoot');
      this.syncKahootTab();

      // 同步分頁卡片資訊
      const qText = `第 ${payload.questionIndex} / ${payload.totalQuestions} 題`;
      const modeText = payload.mode === 'group' ? '🚩 小組模式' : '🧑 個人模式';
      const promptText = payload.prompt || '請看大螢幕題目，點擊下方選項作答';

      const qb1 = document.getElementById('studentKahootQBadge');
      const qb2 = document.getElementById('studentTabKahootQBadge');
      if (qb1) qb1.textContent = qText;
      if (qb2) qb2.textContent = qText;

      const mb1 = document.getElementById('studentKahootModeBadge');
      const mb2 = document.getElementById('studentTabKahootModeBadge');
      if (mb1) mb1.textContent = modeText;
      if (mb2) mb2.textContent = modeText;

      const pr1 = document.getElementById('studentKahootPrompt');
      const pr2 = document.getElementById('studentTabKahootPrompt');
      if (pr1) pr1.textContent = promptText;
      if (pr2) pr2.textContent = promptText;

      const t1 = document.getElementById('studentKahootTimer');
      const t2 = document.getElementById('studentTabKahootTimer');
      if (t1) t1.textContent = this.kahootTimeLeft;
      if (t2) t2.textContent = this.kahootTimeLeft;

      // 顯示選項網格，隱藏揭曉提示
      const setDisplay = (id, val) => { const el = document.getElementById(id); if (el) el.style.display = val; };
      setDisplay('studentKahootBtnGrid', 'grid');
      setDisplay('studentTabKahootOptionsGrid', 'grid');
      setDisplay('studentKahootSubmittedNotice', 'none');
      setDisplay('studentTabKahootSubmittedNotice', 'none');
      setDisplay('studentKahootResultNotice', 'none');
      setDisplay('studentTabKahootResultNotice', 'none');
      setDisplay('studentKahootFinalSummary', 'none');
      setDisplay('studentTabKahootFinalSummary', 'none');

      // 更新按鈕文字與狀態
      const options = payload.options || [];
      document.querySelectorAll('.student-kahoot-opt-btn').forEach(btn => {
        const idx = Number(btn.dataset.opt);
        btn.disabled = false;
        btn.style.opacity = '1';
        btn.style.transform = 'none';
        btn.style.border = 'none';

        const optData = options[idx];
        if (optData) {
          btn.style.display = 'flex';
          const txt = optData.text || ['A','B','C','D'][idx];
          const t1 = document.getElementById(`student-kahoot-text-${idx}`);
          const t2 = document.getElementById(`student-tab-kahoot-text-${idx}`);
          if (t1) t1.textContent = txt;
          if (t2) t2.textContent = txt;
        } else {
          btn.style.display = 'none';
        }
      });

      if (this.kahootTimer) clearInterval(this.kahootTimer);
      this.kahootTimer = setInterval(() => {
        this.kahootTimeLeft--;
        const curSec = Math.max(0, this.kahootTimeLeft);
        if (t1) t1.textContent = curSec;
        if (t2) t2.textContent = curSec;
        if (this.kahootTimeLeft <= 0) {
          clearInterval(this.kahootTimer);
          this.kahootTimer = null;
          if (this.myChoice === null) {
            document.querySelectorAll('.student-kahoot-opt-btn').forEach(btn => btn.disabled = true);
          }
        }
      }, 1000);

      showToast(`🎮 答題競賽：第 ${payload.questionIndex} 題開始！`, 'info');
    },

    submitKahootAnswer(optionIndex) {
      if (this.myChoice !== null || !this.activeKahoot) return;
      this.myChoice = optionIndex;

      const timeMsRemaining = Math.max(0, this.kahootTimeLeft * 1000);

      if (window.activeSocket) {
        window.activeSocket.emit('kahoot:answer', {
          questionId: this.activeKahoot.questionId,
          optionIndex,
          timeMsRemaining
        });
      }

      // 隱藏選項，顯示等待揭曉
      const setDisplay = (id, val) => { const el = document.getElementById(id); if (el) el.style.display = val; };
      setDisplay('studentKahootBtnGrid', 'none');
      setDisplay('studentTabKahootOptionsGrid', 'none');
      setDisplay('studentKahootSubmittedNotice', 'block');
      setDisplay('studentTabKahootSubmittedNotice', 'block');

      showToast(`已送出答案：選項 ${['A','B','C','D'][optionIndex]}`, 'success');
    },

    onKahootAnswerRevealed(payload) {
      if (this.kahootTimer) {
        clearInterval(this.kahootTimer);
        this.kahootTimer = null;
      }

      const setDisplay = (id, val) => { const el = document.getElementById(id); if (el) el.style.display = val; };
      setDisplay('studentKahootSubmittedNotice', 'none');
      setDisplay('studentTabKahootSubmittedNotice', 'none');
      setDisplay('studentKahootResultNotice', 'block');
      setDisplay('studentTabKahootResultNotice', 'block');

      const isCorrect = this.myChoice !== null && this.myChoice === payload.correctOptionIndex;

      const updateResultUI = (prefix) => {
        const notice = document.getElementById(`${prefix}ResultNotice`);
        const iconEl = document.getElementById(`${prefix}ResultIcon`);
        const titleEl = document.getElementById(`${prefix}ResultTitle`);
        const scoreEl = document.getElementById(`${prefix}ResultScore`);
        const expEl = document.getElementById(`${prefix}ResultExplanation`);
        if (!notice) return;

        if (isCorrect) {
          notice.style.background = 'linear-gradient(135deg, rgba(22, 163, 74, 0.3), rgba(15, 23, 42, 0.9))';
          notice.style.border = '2px solid #22c55e';
          if (iconEl) iconEl.textContent = '🎉';
          if (titleEl) { titleEl.textContent = '太棒了！答對了！'; titleEl.style.color = '#4ade80'; }
          if (scoreEl) {
            scoreEl.style.display = 'block';
            scoreEl.textContent = `+${this.activeKahoot?.points || 1000} 分 (含競速加成)`;
          }
        } else {
          notice.style.background = 'linear-gradient(135deg, rgba(220, 38, 38, 0.25), rgba(15, 23, 42, 0.9))';
          notice.style.border = '2px solid #ef4444';
          if (iconEl) iconEl.textContent = this.myChoice === null ? '⏰' : '❌';
          if (titleEl) {
            titleEl.textContent = this.myChoice === null ? '時間到！未送出答案' : '答錯囉！繼續加油！';
            titleEl.style.color = '#f87171';
          }
          if (scoreEl) scoreEl.style.display = 'none';
        }

        if (expEl) {
          if (payload.explanation) {
            expEl.textContent = `💡 解析：${payload.explanation}`;
            expEl.style.display = 'block';
          } else {
            expEl.style.display = 'none';
          }
        }
      };

      updateResultUI('studentKahoot');
      updateResultUI('studentTabKahoot');
    },

    onKahootFinished(payload) {
      if (this.kahootTimer) {
        clearInterval(this.kahootTimer);
        this.kahootTimer = null;
      }

      const setDisplay = (id, val) => { const el = document.getElementById(id); if (el) el.style.display = val; };
      setDisplay('studentKahootBtnGrid', 'none');
      setDisplay('studentTabKahootOptionsGrid', 'none');
      setDisplay('studentKahootSubmittedNotice', 'none');
      setDisplay('studentTabKahootSubmittedNotice', 'none');
      setDisplay('studentKahootResultNotice', 'none');
      setDisplay('studentTabKahootResultNotice', 'none');
      setDisplay('studentKahootFinalSummary', 'block');
      setDisplay('studentTabKahootFinalSummary', 'block');

      showToast('🏆 答題競賽圓滿結束！請觀看大螢幕排行榜。', 'info');
    }
  };

  window.StudentApp = StudentApp;

  (async function init() {
    StudentApp.init();
    if (await tryResumeSession()) {
      showContent();
    }
  })();
})();
