// MyClass 學生端：首頁與小組、登入與恢復登入、修改密碼、即時連線
// 由 static/js/student.js 拆出（2026-10-31，原第 1190–1440 行），程式內容未變更；縮排保留原樣。
// student.js 與 static/js/student/*.js 共用頁面的全域範圍（一般 <script>），載入順序見 static/student.html。


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
      if (me.student.must_change_password) {
        openPasswordModal(true);
        return;
      }
      await loadMyGroup();
      await checkStudentLeadership();
      await loadContent();
      connectStudentRealtime(me.course.id);
      Notifications.refresh();
      Notifications.startPolling();
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
    showLoginHint(null);
    try {
      const res = await api('/api/auth/student/login_by_account', {
        method: 'POST',
        body: JSON.stringify({
          account: document.getElementById('accountInput').value.trim(),
          password: document.getElementById('accountPasswordInput').value,
        }),
      });
      knownPassword = document.getElementById('accountPasswordInput').value;
      saveSession(res.token, res.student);
      showContent();
    } catch (e) {
      showError(e.message);
      showLoginHint(e.data && e.data.hint);
    }
  });

  document.getElementById('logoutBtn').addEventListener('click', () => {
    exitToLogin();
  });

  // --- 修改自己的密碼（含第一次登入／被老師重設後的強制修改）與「密碼提醒」---
  // 新密碼沒有任何規則限制（只要不是空白），避免低年級學生被規則卡住。
  // 密碼提醒：前綴／主要內容／後綴，主要內容必填、前後綴至少一個；顯示成「前綴＋主要內容＋後綴」。
  (function setupChangePassword() {
    const modal = document.getElementById('modalChangePassword');
    const cur = document.getElementById('inputCurrentPassword');
    const n1 = document.getElementById('inputNewPassword');
    const n2 = document.getElementById('inputNewPassword2');
    const err = document.getElementById('changePasswordError');
    const submit = document.getElementById('btnSubmitChangePassword');
    const cancel = document.getElementById('btnCancelChangePassword');
    const title = document.getElementById('changePasswordTitle');
    const desc = document.getElementById('changePasswordDesc');
    const pwWrap = document.getElementById('passwordFieldsWrap');
    const hintWrap = document.getElementById('hintFieldsWrap');
    const hPrefix = document.getElementById('inputHintPrefix');
    const hMain = document.getElementById('inputHintMain');
    const hSuffix = document.getElementById('inputHintSuffix');
    const preview = document.getElementById('hintPreview');
    let forced = false;
    let hintOnly = false;

    const close = () => { modal.style.display = 'none'; };

    // 👁️ 顯示／隱藏新密碼（兩個新密碼欄位一起切換）
    const eyeBtns = modal.querySelectorAll('.pw-eye-btn');
    const setNewPasswordVisible = (visible) => {
      n1.type = visible ? 'text' : 'password';
      n2.type = visible ? 'text' : 'password';
      eyeBtns.forEach((b) => { b.textContent = visible ? '🙈' : '👁️'; });
    };
    eyeBtns.forEach((b) => b.addEventListener('click', () => setNewPasswordVisible(n1.type === 'password')));

    const composePreview = () => {
      const main = hMain.value.trim();
      if (!main) return '（尚未填寫）';
      return `${hPrefix.value.trim()}${main}${hSuffix.value.trim()}`;
    };
    [hPrefix, hMain, hSuffix].forEach((el) => el.addEventListener('input', () => { preview.textContent = composePreview(); }));

    // 回傳 null 代表沒問題；否則回傳要顯示的錯誤文字
    const hintError = () => {
      const p = hPrefix.value.trim(); const m = hMain.value.trim(); const x = hSuffix.value.trim();
      if (!p && !m && !x) return null;
      if (!m) return '密碼提醒的「主要內容」一定要填（例如：媽媽的電話號碼）。';
      if (!p && !x) return '前綴和後綴至少要填一個（也可以兩個都填）。';
      return null;
    };

    async function loadHint() {
      hPrefix.value = ''; hMain.value = ''; hSuffix.value = '';
      try {
        const h = await api('/api/auth/student/password_hint');
        hPrefix.value = h.prefix || ''; hMain.value = h.main || ''; hSuffix.value = h.suffix || '';
      } catch (e) { /* 取不到就留空 */ }
      preview.textContent = composePreview();
    }

    openPasswordModal = (isForced, onlyHint) => {
      forced = Boolean(isForced);
      hintOnly = Boolean(onlyHint);
      cur.value = ''; n1.value = ''; n2.value = ''; err.textContent = '';
      setNewPasswordVisible(false);
      const knowCurrent = forced && Boolean(knownPassword);
      cur.style.display = knowCurrent ? 'none' : '';
      pwWrap.style.display = hintOnly ? 'none' : 'flex';
      cancel.textContent = forced ? '登出' : '取消';
      submit.textContent = '儲存';
      if (hintOnly) {
        title.textContent = '設定密碼提醒';
        desc.textContent = '忘記密碼時，登入畫面輸入錯誤好幾次後，會顯示這段提醒幫你想起來。留空並儲存就是清除提醒。';
      } else {
        title.textContent = forced ? '請先設定你的新密碼' : '修改我的密碼';
        desc.textContent = forced
          ? '這是你第一次登入（或老師幫你重設了密碼）。請設定一個只有你知道的新密碼，記好它，也不要告訴別人。'
          : '請設定一個只有你知道的新密碼，記好它，也不要告訴別人。';
      }
      // 改密碼時提醒欄位預設是空的（舊提醒對新密碼沒有意義）；只設提醒時才帶入目前的內容
      if (hintOnly) { loadHint(); } else { hPrefix.value = ''; hMain.value = ''; hSuffix.value = ''; preview.textContent = composePreview(); }
      modal.style.display = 'flex';
      (hintOnly ? hMain : (knowCurrent ? n1 : cur)).focus();
    };

    document.getElementById('changePasswordBtn').addEventListener('click', () => openPasswordModal(false, false));
    document.getElementById('changeHintBtn').addEventListener('click', () => openPasswordModal(false, true));
    cancel.addEventListener('click', () => {
      if (forced) { close(); exitToLogin(); } else { close(); }
    });
    modal.addEventListener('click', (e) => { if (!forced && e.target === modal) close(); });

    submit.addEventListener('click', async () => {
      err.textContent = '';
      const he = hintError();
      if (he) { err.textContent = he; return; }

      if (hintOnly) {
        submit.disabled = true;
        try {
          const res = await api('/api/auth/student/password_hint', {
            method: 'PUT',
            body: JSON.stringify({ prefix: hPrefix.value, main: hMain.value, suffix: hSuffix.value }),
          });
          close();
          showToast('💡 ' + (res.message || '密碼提醒已儲存！'), 'success');
        } catch (e) {
          err.textContent = e.message;
        } finally {
          submit.disabled = false;
        }
        return;
      }

      const current = cur.style.display === 'none' ? knownPassword : cur.value;
      if (!current) { err.textContent = '請輸入目前的密碼。'; return; }
      if (!n1.value) { err.textContent = '請輸入新密碼。'; return; }
      if (n1.value !== n2.value) { err.textContent = '兩次輸入的新密碼不一樣。'; return; }
      submit.disabled = true;
      try {
        const res = await api('/api/auth/student/change_password', {
          method: 'POST',
          body: JSON.stringify({
            current_password: current,
            new_password: n1.value,
            hint_prefix: hPrefix.value,
            hint_main: hMain.value,
            hint_suffix: hSuffix.value,
          }),
        });
        // 改密碼後舊的登入憑證（含其他裝置）全部失效，這台裝置改用伺服器發的新憑證；
        // 即時連線斷線重連時也要帶新憑證，否則會被伺服器拒絕。
        if (res.token) {
          localStorage.setItem(TOKEN_KEY, res.token);
          const sock = window.activeSocket;
          if (sock && sock.io && sock.io.opts && sock.io.opts.query) sock.io.opts.query.token = res.token;
        }
        const wasForced = forced;
        knownPassword = '';
        close();
        showToast('🔑 ' + (res.message || '密碼已更新！'), 'success');
        if (wasForced) showContent(); // 改完才載入課程內容
        else loadContent(); // 附件連結內含舊憑證，重新產生一次
      } catch (e) {
        err.textContent = e.message;
      } finally {
        submit.disabled = false;
      }
    });
  })();

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
