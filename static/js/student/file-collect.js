// MyClass 學生端：檔案蒐集（含拍照／錄影上傳）
// 由 static/js/student.js 拆出（2026-10-31，原第 3140–3787 行），程式內容未變更；縮排保留原樣。
// student.js 與 static/js/student/*.js 共用頁面的全域範圍（一般 <script>），載入順序見 static/student.html。


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
