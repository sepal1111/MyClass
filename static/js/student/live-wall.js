// MyClass 學生端：即時互動牆
// 由 static/js/student.js 拆出（2026-10-31，原第 1441–1631 行），程式內容未變更；縮排保留原樣。
// student.js 與 static/js/student/*.js 共用頁面的全域範圍（一般 <script>），載入順序見 static/student.html。


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
