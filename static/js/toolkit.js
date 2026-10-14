/**
 * Classroom Teaching Toolkit (國小課堂教學輔助工具箱)
 * 1. Bulletin Board (公布欄：文字縮放、顏色、粗體、黑板主題、全螢幕投影)
 * 2. Lucky Draw (隨機抽籤：個人/小組、指定人數、排除已中籤、滾動動畫、一鍵加分)
 * 3. Timer & Stopwatch (計時器與碼錶：倒數預設、5秒警示、歸零鬧鈴、碼錶計圈、浮動迷你視窗)
 * 4. Attention Bells (課堂注意警示鈴聲：Web Audio API 晶片級原生音效合成，零外部依賴)
 */
(function (window) {
  'use strict';

  // =========================================================================
  // 1. AudioEngine (Web Audio API 晶片級原生合成音訊引擎)
  // Shared with the projection screen — see static/js/audio-engine.js, which
  // must be loaded before this file.
  // =========================================================================
  const AudioEngine = window.AudioEngine;

  // =========================================================================
  // 2. BulletinBoard (課堂公布欄 - 支援多份佈告儲存與切換)
  // =========================================================================
  const BulletinBoard = {
    currentCourseId: null,
    currentTheme: 'chalk-green',
    fontSize: '1.25rem',
    textColor: '#ffffff',
    posts: [],
    activePostId: null,
    _saveInFlight: false,
    _pendingResave: null,
    _statusHideTimer: null,
    saveStatus: 'idle', // 'idle' | 'dirty' | 'saving' | 'saved' | 'error'

    getCourseId() {
      if (window.AppState && window.AppState.currentCourseId) {
        const id = Number(window.AppState.currentCourseId);
        if (!isNaN(id)) {
          this.currentCourseId = id;
          return id;
        }
      }
      if (this.currentCourseId) {
        const id = Number(this.currentCourseId);
        if (!isNaN(id)) return id;
      }
      return null;
    },

    getActivePost() {
      if (!Array.isArray(this.posts) || this.posts.length === 0) return null;
      if (this.activePostId !== null && this.activePostId !== undefined) {
        const found = this.posts.find(p => String(p.id) === String(this.activePostId));
        if (found) return found;
      }
      return this.posts[0] || null;
    },

    init() {
      const editor = document.getElementById('bulletin-editor');
      if (!editor) return;

      // Restore theme and font settings
      const savedTheme = localStorage.getItem('bulletin_theme') || 'chalk-green';
      this.setTheme(savedTheme);

      // Auto-load course posts if course is already selected on startup
      if (!this.currentCourseId && window.AppState?.currentCourseId) {
        this.loadCourse(window.AppState.currentCourseId);
      }

      // Real-time auto-save: mark dirty immediately, then write to the server right away
      // (see saveContent/triggerImmediateSave) — no fixed debounce delay before it's sent.
      editor.addEventListener('input', () => {
        this.setSaveStatus('dirty');
        this.saveContent(false);
        this.syncFullscreenContent();
      });

      // Chinese IME input completion (選字完成立即寫入)
      editor.addEventListener('compositionend', () => {
        this.setSaveStatus('dirty');
        this.saveContent(false);
      });

      // Save on paste
      editor.addEventListener('paste', () => {
        setTimeout(() => {
          this.setSaveStatus('dirty');
          this.saveContent(false);
        }, 0);
      });

      // Save immediately when clicking away (blur)
      editor.addEventListener('blur', () => {
        this.flushActivePost();
      });

      // Warn before leaving the page while there's a pending or failed save, so a teacher
      // closing the tab mid-typing (or after a network error) doesn't silently lose content.
      window.addEventListener('beforeunload', (e) => {
        if (['dirty', 'saving', 'error'].includes(this.saveStatus)) {
          this.flushActivePost();
          e.preventDefault();
          e.returnValue = '';
        }
      });
      window.addEventListener('pagehide', () => {
        this.flushActivePost();
      });

      // Multi-post select dropdown
      const selectPost = document.getElementById('bulletin-post-select');
      if (selectPost) {
        selectPost.addEventListener('change', (e) => {
          this.switchPost(e.target.value);
        });
      }

      // Add Post Button
      const btnAddPost = document.getElementById('btn-bulletin-add-post');
      if (btnAddPost) {
        btnAddPost.addEventListener('click', () => {
          this.addNewPost();
        });
      }

      // Rename Post Button
      const btnRenamePost = document.getElementById('btn-bulletin-rename-post');
      if (btnRenamePost) {
        btnRenamePost.addEventListener('click', () => {
          this.renameActivePost();
        });
      }

      // Delete Post Button
      const btnDeletePost = document.getElementById('btn-bulletin-delete-post');
      if (btnDeletePost) {
        btnDeletePost.addEventListener('click', () => {
          this.deleteActivePost();
        });
      }

      // Bind toolbar buttons
      document.querySelectorAll('.btn-bulletin-font-size').forEach(btn => {
        btn.addEventListener('click', (e) => {
          const size = e.currentTarget.dataset.size || '1.25rem';
          this.setFontSize(size);
        });
      });

      document.querySelectorAll('.btn-bulletin-color').forEach(btn => {
        btn.addEventListener('click', (e) => {
          const color = e.currentTarget.dataset.color || '#ffffff';
          this.setTextColor(color);
        });
      });

      document.querySelectorAll('.btn-bulletin-theme').forEach(btn => {
        btn.addEventListener('click', (e) => {
          const theme = e.currentTarget.dataset.theme || 'chalk-green';
          this.setTheme(theme);
        });
      });

      const btnBold = document.getElementById('btn-bulletin-bold');
      if (btnBold) {
        btnBold.addEventListener('click', () => {
          document.execCommand('bold', false, null);
          this.setSaveStatus('dirty');
          this.saveContent(false);
        });
      }

      const btnList = document.getElementById('btn-bulletin-list');
      if (btnList) {
        btnList.addEventListener('click', () => {
          document.execCommand('insertUnorderedList', false, null);
          this.setSaveStatus('dirty');
          this.saveContent(false);
        });
      }

      // Submit Add / Rename Post modal
      const btnSubmitPostTitle = document.getElementById('btn-submit-bulletin-post-title');
      const inputPostTitle = document.getElementById('input-bulletin-post-title');
      if (btnSubmitPostTitle) {
        btnSubmitPostTitle.addEventListener('click', () => {
          this.handlePostTitleSubmit();
        });
      }
      if (inputPostTitle) {
        inputPostTitle.addEventListener('keydown', (e) => {
          if (e.key === 'Enter') {
            e.preventDefault();
            this.handlePostTitleSubmit();
          }
        });
      }

      // Confirm Delete Post modal submit
      const btnConfirmDeletePost = document.getElementById('btn-confirm-delete-bulletin-post-submit');
      if (btnConfirmDeletePost) {
        btnConfirmDeletePost.addEventListener('click', () => {
          this.handleConfirmDeletePost();
        });
      }

      // Clear Button triggers Beautiful Confirmation Modal
      const btnClear = document.getElementById('btn-bulletin-clear');
      if (btnClear) {
        btnClear.addEventListener('click', () => {
          if (typeof window.openModal === 'function') {
            window.openModal('modal-confirm-clear-bulletin');
          } else {
            const modal = document.getElementById('modal-confirm-clear-bulletin');
            if (modal) modal.classList.add('open');
          }
        });
      }

      // Confirmation Modal Submit
      const btnClearSubmit = document.getElementById('btn-confirm-clear-bulletin-submit');
      if (btnClearSubmit) {
        btnClearSubmit.addEventListener('click', () => {
          editor.innerHTML = '';
          this.saveContent(false);
          if (typeof window.closeModal === 'function') {
            window.closeModal('modal-confirm-clear-bulletin');
          } else {
            const modal = document.getElementById('modal-confirm-clear-bulletin');
            if (modal) modal.classList.remove('open');
          }
          if (window.showToast) {
            window.showToast(window.I18n ? window.I18n.t('bulletin_btn_clear') : '已清空當前佈告內容', 'info');
          }
        });
      }

      const btnFullscreen = document.getElementById('btn-bulletin-fullscreen');
      if (btnFullscreen) {
        btnFullscreen.addEventListener('click', () => {
          this.openFullscreen();
        });
      }
    },

    async loadCourse(courseId, force = false) {
      if (!courseId) return;
      const numCourseId = Number(courseId);
      if (!force && numCourseId === this.currentCourseId && Array.isArray(this.posts) && this.posts.length > 0) {
        this.renderPostDropdown();
        return;
      }
      if (this.currentCourseId && this.currentCourseId !== numCourseId) {
        this.flushActivePost(); // persist the outgoing course's in-progress edit before switching away
      }
      this.currentCourseId = numCourseId;
      const editor = document.getElementById('bulletin-editor');
      if (!editor) return;

      const ph = window.I18n ? window.I18n.t('bulletin_placeholder') : '在此書寫課程重點、注意事項或隨堂提示...';
      editor.setAttribute('data-placeholder', ph);

      let loadedPosts = [];
      try {
        loadedPosts = await API.get(`/api/bulletin/${numCourseId}`);
      } catch (err) {
        console.error('BulletinBoard.loadCourse error', err);
        const msg = window.I18n ? window.I18n.t('bulletin_load_failed') : '公布欄載入失敗：';
        if (window.showToast) window.showToast(`${msg}${err.message}`, 'negative');
        loadedPosts = [];
      }

      // 若課程換到這個新版本前，資料曾存在瀏覽器 localStorage（舊版行為），
      // 且伺服器尚無任何佈告，則把舊資料搬移進資料庫，之後就以伺服器為主。
      if (numCourseId === this.currentCourseId && (!Array.isArray(loadedPosts) || loadedPosts.length === 0)) {
        loadedPosts = await this.migrateLegacyLocalStorage(numCourseId);
      }

      if (numCourseId !== this.currentCourseId) return; // course switched again while awaiting

      if (!Array.isArray(loadedPosts) || loadedPosts.length === 0) {
        const defaultTitle = window.I18n && window.I18n.getLanguage() === 'en' ? 'Class Board 1' : '課堂佈告 1';
        try {
          const created = await API.post(`/api/bulletin/${numCourseId}`, { title: defaultTitle, content: '' });
          loadedPosts = [created];
        } catch (err) {
          console.error('BulletinBoard.loadCourse create default error', err);
          loadedPosts = [];
        }
      }

      this.posts = loadedPosts;
      const initialActive = this.getActivePost();
      this.activePostId = initialActive?.id || this.posts[0]?.id || null;

      this.renderPostDropdown();
      this.loadActivePost();
    },

    async migrateLegacyLocalStorage(courseId) {
      const postsKey = `bulletin_posts_course_${courseId}`;
      const legacyKey = `bulletin_content_course_${courseId}`;
      const savedPostsJson = localStorage.getItem(postsKey);

      let legacyPosts = [];
      if (savedPostsJson) {
        try {
          legacyPosts = JSON.parse(savedPostsJson);
        } catch (e) {
          legacyPosts = [];
        }
      }
      if (!Array.isArray(legacyPosts) || legacyPosts.length === 0) {
        const legacyContent = localStorage.getItem(legacyKey);
        if (legacyContent) {
          const defaultTitle = window.I18n && window.I18n.getLanguage() === 'en' ? 'Class Board 1' : '課堂佈告 1';
          legacyPosts = [{ title: defaultTitle, content: legacyContent }];
        }
      }
      if (!Array.isArray(legacyPosts) || legacyPosts.length === 0) return [];

      const migrated = [];
      for (const p of legacyPosts) {
        try {
          const created = await API.post(`/api/bulletin/${courseId}`, {
            title: p.title || '課堂佈告',
            content: p.content || '',
          });
          migrated.push(created);
        } catch (err) {
          console.error('BulletinBoard migrateLegacyLocalStorage error', err);
        }
      }

      if (migrated.length > 0) {
        localStorage.removeItem(postsKey);
        localStorage.removeItem(legacyKey);
      }
      return migrated;
    },

    renderPostDropdown() {
      const select = document.getElementById('bulletin-post-select');
      if (!select) return;
      select.innerHTML = '';

      this.posts.forEach((p, idx) => {
        const opt = document.createElement('option');
        opt.value = p.id;
        opt.textContent = `📌 ${p.title || `佈告 ${idx + 1}`}`;
        select.appendChild(opt);
      });

      const active = this.getActivePost();
      if (active) {
        this.activePostId = active.id;
        select.value = String(active.id);
      }
    },

    loadActivePost() {
      const editor = document.getElementById('bulletin-editor');
      if (!editor) return;

      const post = this.getActivePost();
      if (post) {
        this.activePostId = post.id;
        editor.innerHTML = post.content || '';
      } else {
        editor.innerHTML = '';
      }
      const select = document.getElementById('bulletin-post-select');
      if (select && post) {
        select.value = String(post.id);
      }
      this.setSaveStatus('idle');
      this.syncFullscreenContent();
    },

    switchPost(postId) {
      this.flushActivePost();
      this.activePostId = Number(postId) || postId;
      this.loadActivePost();
    },

    // Persists whatever is currently in the editor for the still-active post right away
    // (see triggerImmediateSave). Call this before swapping activePostId/editor content —
    // e.g. in switchPost or when adding a new post — so an edit that's still mid-flight for
    // the *old* post isn't silently dropped when the editor's innerHTML is swapped out.
    flushActivePost() {
      const editor = document.getElementById('bulletin-editor');
      const courseId = this.getCourseId();
      if (!editor || !courseId) return;
      const post = this.getActivePost();
      if (!post) return;
      if (post.content === editor.innerHTML && (this.saveStatus === 'saved' || this.saveStatus === 'idle')) {
        return;
      }
      post.content = editor.innerHTML;
      this.triggerImmediateSave(post);
    },

    // 其他裝置（教師手機）新增、刪除或改名佈告後，同步這裡的佈告清單。
    // 清單沒有變化時完全不動畫面，避免打字時被重新載入內容。
    async refreshPosts() {
      const courseId = this.getCourseId();
      if (!courseId) return;
      let posts;
      try {
        posts = await API.get(`/api/bulletin/${courseId}`);
      } catch (_) {
        return;
      }
      if (!Array.isArray(posts)) return;
      const sig = (list) => (list || []).map(p => `${p.id}:${p.title}`).join('|');
      if (sig(posts) === sig(this.posts)) return;

      const prevActive = this.activePostId;
      this.flushActivePost(); // 先存下目前編輯中的內容，再換成新的清單
      this.posts = posts;
      const stillThere = posts.find(p => String(p.id) === String(prevActive));
      this.activePostId = stillThere ? stillThere.id : (posts[0] ? posts[0].id : null);
      this.renderPostDropdown();
      if (!stillThere) {
        this.loadActivePost();
      } else {
        this.syncFullscreenContent();
      }
    },

    // 由教師手機發佈／指定佈告時，重新載入並切換到該篇，同步即時更新全螢幕模式
    async showPost(postId) {
      const courseId = this.getCourseId();
      if (!courseId) return;
      await this.loadCourse(courseId, true);
      if (postId != null) this.switchPost(postId);
      this.renderPostDropdown();
      this.syncFullscreenContent();
    },

    showText(text) {
      const editor = document.getElementById('bulletin-editor');
      const formatted = (text || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/\n/g, '<br>');
      if (editor) {
        editor.innerHTML = formatted;
      }
      this.syncFullscreenContent();
    },

    addNewPost() {
      this.modalMode = 'add';
      const defaultName = window.I18n && window.I18n.getLanguage() === 'en'
        ? `Board ${this.posts.length + 1}`
        : `課堂佈告 ${this.posts.length + 1}`;

      const iconEl = document.getElementById('modal-bulletin-icon');
      const headingEl = document.getElementById('modal-bulletin-post-heading');
      const inputEl = document.getElementById('input-bulletin-post-title');

      if (iconEl) iconEl.textContent = '➕';
      if (headingEl) {
        headingEl.textContent = window.I18n ? window.I18n.t('bulletin_modal_add_title') : '➕ 新增佈告';
      }
      if (inputEl) {
        inputEl.value = defaultName;
      }

      if (typeof window.openModal === 'function') {
        window.openModal('modal-bulletin-post-title');
      } else {
        const m = document.getElementById('modal-bulletin-post-title');
        if (m) m.classList.add('open');
      }

      setTimeout(() => {
        if (inputEl) {
          inputEl.focus();
          inputEl.select();
        }
      }, 100);
    },

    renameActivePost() {
      this.flushActivePost();
      const post = this.getActivePost();
      if (!post) {
        if (window.showToast) window.showToast('尚未選取任何佈告！', 'warning');
        return;
      }
      this.activePostId = post.id;

      this.modalMode = 'rename';
      const iconEl = document.getElementById('modal-bulletin-icon');
      const headingEl = document.getElementById('modal-bulletin-post-heading');
      const inputEl = document.getElementById('input-bulletin-post-title');

      if (iconEl) iconEl.textContent = '✏️';
      if (headingEl) {
        headingEl.textContent = window.I18n ? window.I18n.t('bulletin_modal_rename_title') : '✏️ 重新命名佈告';
      }
      if (inputEl) {
        inputEl.value = post.title;
      }

      if (typeof window.openModal === 'function') {
        window.openModal('modal-bulletin-post-title');
      } else {
        const m = document.getElementById('modal-bulletin-post-title');
        if (m) m.classList.add('open');
      }

      setTimeout(() => {
        if (inputEl) {
          inputEl.focus();
          inputEl.select();
        }
      }, 100);
    },

    async handlePostTitleSubmit() {
      const inputEl = document.getElementById('input-bulletin-post-title');
      const courseId = this.getCourseId();
      if (!inputEl || !courseId) return;
      this.currentCourseId = courseId;
      const title = inputEl.value.trim();
      if (!title) {
        if (window.showToast) window.showToast('請輸入有效的佈告名稱！', 'warning');
        inputEl.focus();
        return;
      }

      if (this.modalMode === 'add') {
        try {
          this.flushActivePost(); // don't lose an in-progress edit on the current board
          const newPost = await API.post(`/api/bulletin/${courseId}`, { title, content: '' });
          this.posts.push(newPost);
          this.activePostId = newPost.id;
          this.renderPostDropdown();
          this.loadActivePost();

          if (typeof window.closeModal === 'function') {
            window.closeModal('modal-bulletin-post-title');
          } else {
            const m = document.getElementById('modal-bulletin-post-title');
            if (m) m.classList.remove('open');
          }

          if (window.showToast) window.showToast(`✨ 已新增佈告【${newPost.title}】！`, 'positive');
          const editor = document.getElementById('bulletin-editor');
          if (editor) editor.focus();
        } catch (err) {
          console.error('BulletinBoard add post error', err);
          if (window.showToast) window.showToast(`新增佈告失敗：${err.message}`, 'negative');
        }
      } else if (this.modalMode === 'rename') {
        const post = this.getActivePost();
        if (!post) return;
        try {
          this.flushActivePost();
          await API.put(`/api/bulletin/${courseId}/${post.id}`, { title });
          post.title = title;
          this.renderPostDropdown();

          if (typeof window.closeModal === 'function') {
            window.closeModal('modal-bulletin-post-title');
          } else {
            const m = document.getElementById('modal-bulletin-post-title');
            if (m) m.classList.remove('open');
          }

          if (window.showToast) window.showToast(`✏️ 佈告已重新命名為【${title}】！`, 'positive');
        } catch (err) {
          console.error('BulletinBoard rename post error', err);
          if (window.showToast) window.showToast(`重新命名失敗：${err.message}`, 'negative');
        }
      }
    },

    deleteActivePost() {
      if (this.posts.length <= 1) {
        const msg = window.I18n ? window.I18n.t('bulletin_delete_post_only_one') : '目前只有一個佈告，無法刪除！若要清空內容請使用「清除內容」。';
        if (window.showToast) {
          window.showToast(msg, 'warning');
        } else {
          alert(msg);
        }
        return;
      }

      const post = this.getActivePost();
      if (!post) return;
      this.activePostId = post.id;

      const descEl = document.getElementById('modal-bulletin-delete-desc');
      if (descEl) {
        const confirmMsg = window.I18n 
          ? window.I18n.t('bulletin_delete_post_confirm', { title: post.title })
          : `確定要刪除當前佈告「${post.title}」嗎？此動作無法復原。`;
        descEl.textContent = confirmMsg;
      }

      if (typeof window.openModal === 'function') {
        window.openModal('modal-confirm-delete-bulletin-post');
      } else {
        const m = document.getElementById('modal-confirm-delete-bulletin-post');
        if (m) m.classList.add('open');
      }
    },

    async handleConfirmDeletePost() {
      const courseId = this.getCourseId();
      const post = this.getActivePost();
      const postTitle = post ? post.title : '';
      if (!post || !courseId) return;
      this.currentCourseId = courseId;

      try {
        await API.delete(`/api/bulletin/${courseId}/${post.id}`);
        this.posts = this.posts.filter(p => String(p.id) !== String(post.id));
        this.activePostId = this.posts[0]?.id || null;
        this.renderPostDropdown();
        this.loadActivePost();

        if (typeof window.closeModal === 'function') {
          window.closeModal('modal-confirm-delete-bulletin-post');
        } else {
          const m = document.getElementById('modal-confirm-delete-bulletin-post');
          if (m) m.classList.remove('open');
        }

        if (window.showToast) window.showToast(`🗑️ 已成功刪除佈告「${postTitle}」！`, 'info');
      } catch (err) {
        console.error('BulletinBoard delete post error', err);
        if (window.showToast) window.showToast(`刪除佈告失敗：${err.message}`, 'negative');
      }
    },

    async saveContent(showToastFeedback = false) {
      const editor = document.getElementById('bulletin-editor');
      if (!editor) return;

      const courseId = this.getCourseId();
      if (!courseId) {
        if (showToastFeedback && window.showToast) {
          window.showToast('請先選擇班級課程後再儲存佈告！', 'warning');
        }
        return;
      }
      this.currentCourseId = courseId;

      let post = this.getActivePost();
      if (!post) {
        if (Array.isArray(this.posts) && this.posts.length > 0) {
          post = this.posts[0];
          this.activePostId = post.id;
        } else {
          try {
            this.setSaveStatus('saving');
            const defaultTitle = window.I18n && window.I18n.getLanguage() === 'en' ? 'Class Board 1' : '課堂佈告 1';
            const created = await API.post(`/api/bulletin/${courseId}`, {
              title: defaultTitle,
              content: editor.innerHTML || ''
            });
            this.posts = [created];
            this.activePostId = created.id;
            this.renderPostDropdown();
            this.setSaveStatus('saved');
            if (showToastFeedback) {
              const msg = window.I18n ? window.I18n.t('bulletin_saved_toast') : `📌 佈告【${created.title}】內容已成功儲存！`;
              if (window.showToast) window.showToast(msg, 'positive');
              if (window.AudioEngine?.playChime) window.AudioEngine.playChime();
            }
            return;
          } catch (err) {
            console.error('BulletinBoard auto-create post error:', err);
            this.setSaveStatus('error');
            if (showToastFeedback && window.showToast) {
              window.showToast(`儲存失敗：${err.message}`, 'negative');
            }
            return;
          }
        }
      }

      this.activePostId = post.id;
      post.content = editor.innerHTML;

      if (showToastFeedback) {
        await this.persistContent(post, true);
      } else {
        this.setSaveStatus('dirty');
        this.triggerImmediateSave(post);
      }
    },

    // 即時自動儲存：每次輸入立刻嘗試寫入資料庫，不再等待固定的防抖延遲。若前一次寫入
    // 還在進行中（例如打字速度快於網路/資料庫寫入速度），不會同時發出多個重疊的請求，
    // 而是記下「還有更新待送出」，等目前這次請求完成後立刻用最新內容再送一次，確保
    // 最終送到伺服器的一定是使用者停手當下看到的內容。
    triggerImmediateSave(post) {
      if (this._saveInFlight) {
        this._pendingResave = post;
        return;
      }
      this._saveInFlight = true;
      this.persistContent(post, false).finally(() => {
        this._saveInFlight = false;
        if (this._pendingResave) {
          const next = this._pendingResave;
          this._pendingResave = null;
          this.triggerImmediateSave(next);
        }
      });
    },

    async persistContent(post, showToastFeedback) {
      const courseId = this.getCourseId();
      if (!courseId || !post) return;
      this.currentCourseId = courseId;

      this.setSaveStatus('saving');
      try {
        await API.put(`/api/bulletin/${courseId}/${post.id}`, { content: post.content });
        // Only clear the warning if nothing marked the board dirty again while this request
        // was in flight (e.g. the teacher kept typing) — that newer edit is already queued in
        // _pendingResave and must not get masked by this older request's "saved" status.
        if (showToastFeedback || this.saveStatus === 'saving') {
          this.setSaveStatus('saved');
        }
        if (showToastFeedback) {
          const msg = window.I18n ? window.I18n.t('bulletin_saved_toast') : `📌 佈告【${post.title}】內容已成功儲存！`;
          if (window.showToast) window.showToast(msg, 'positive');
          if (window.AudioEngine?.playChime) window.AudioEngine.playChime();
        }
      } catch (err) {
        console.error('BulletinBoard persistContent error', err);
        if (this.saveStatus === 'saving') this.setSaveStatus('error');
        const msg = window.I18n ? window.I18n.t('bulletin_save_failed') : '公布欄儲存失敗：';
        if (window.showToast) window.showToast(`${msg}${err.message}`, 'negative');
      }
    },

    // 在儲存按鈕旁顯示「變更中／自動儲存中／已自動儲存／儲存失敗」小提示，讓老師隨堂編輯時
    // 能立即察覺內容是否已真正寫進資料庫。
    setSaveStatus(status) {
      this.saveStatus = status;
      const el = document.getElementById('bulletin-save-status');
      if (!el) return;

      clearTimeout(this._statusHideTimer);
      el.classList.remove('status-dirty', 'status-saving', 'status-saved', 'status-error', 'is-visible');

      if (status === 'idle') {
        el.textContent = '';
        return;
      }

      const STATUS_META = {
        dirty: { key: 'bulletin_status_dirty', fallback: '● 變更中...' },
        saving: { key: 'bulletin_status_saving', fallback: '⏳ 自動儲存中...' },
        saved: { key: 'bulletin_status_saved', fallback: '✅ 已自動儲存' },
        error: { key: 'bulletin_status_error', fallback: '⚠️ 儲存失敗，請檢查連線' },
      };
      const meta = STATUS_META[status];
      if (!meta) return;

      const baseText = window.I18n ? window.I18n.t(meta.key) : meta.fallback;
      if (status === 'saved') {
        const now = new Date();
        const pad = n => String(n).padStart(2, '0');
        const timeStr = `${pad(now.getHours())}:${pad(now.getMinutes())}:${pad(now.getSeconds())}`;
        el.textContent = `${baseText} (${timeStr})`;
      } else {
        el.textContent = baseText;
      }
      el.classList.add(`status-${status}`, 'is-visible');

      if (status === 'saved') {
        this._statusHideTimer = setTimeout(() => this.setSaveStatus('idle'), 4000);
      }
    },

    setFontSize(size) {
      this.fontSize = size;
      const editor = document.getElementById('bulletin-editor');
      if (editor) {
        editor.style.fontSize = size;
      }
      document.querySelectorAll('.btn-bulletin-font-size').forEach(btn => {
        btn.classList.toggle('active', btn.dataset.size === size);
      });
    },

    setTextColor(color) {
      this.textColor = color;
      document.execCommand('foreColor', false, color);
      document.querySelectorAll('.btn-bulletin-color').forEach(btn => {
        btn.classList.toggle('active', btn.dataset.color === color);
      });
      this.setSaveStatus('dirty');
      this.saveContent(false);
    },

    setTheme(theme) {
      this.currentTheme = theme;
      localStorage.setItem('bulletin_theme', theme);

      const board = document.getElementById('bulletin-board-card');
      if (board) {
        board.className = `bulletin-board-card theme-${theme}`;
      }

      document.querySelectorAll('.btn-bulletin-theme').forEach(btn => {
        btn.classList.toggle('active', btn.dataset.theme === theme);
      });
      this.syncFullscreenContent();
    },

    syncFullscreenContent() {
      const fsContent = document.getElementById('bulletin-fullscreen-content');
      if (!fsContent) return;

      const post = this.getActivePost();
      const editor = document.getElementById('bulletin-editor');
      const content = (post && post.content != null) ? post.content : (editor ? editor.innerHTML : '');

      fsContent.innerHTML = content;
      fsContent.className = `bulletin-fullscreen-container theme-${this.currentTheme}`;

      fsContent.classList.remove('content-updated');
      void fsContent.offsetWidth; // 強制觸發重繪動畫
      fsContent.classList.add('content-updated');
    },

    openFullscreen() {
      this.flushActivePost();
      const modal = document.getElementById('modal-bulletin-fullscreen');
      const fsContent = document.getElementById('bulletin-fullscreen-content');
      if (!modal || !fsContent) return;

      this.syncFullscreenContent();
      modal.classList.add('open');
      if (modal.requestFullscreen && !document.fullscreenElement) {
        modal.requestFullscreen().catch(() => {});
      }
    },

    closeFullscreen() {
      const modal = document.getElementById('modal-bulletin-fullscreen');
      if (modal) modal.classList.remove('open');
      if (document.fullscreenElement && document.exitFullscreen) {
        document.exitFullscreen().catch(() => {});
      }
    }
  };

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

  // =========================================================================
  // 4. TimerEngine (倒數計時器與碼錶)
  // =========================================================================
  const TimerEngine = {
    // Countdown State
    timerMode: 'countdown', // 'countdown' | 'stopwatch'
    countdownTotalSeconds: 180,
    countdownRemainingSeconds: 180,
    countdownInterval: null,
    isCountdownRunning: false,

    // Background Music (BGM) State
    bgmAudio: new Audio(),
    bgmMusicList: [
      { title: 'BGM_01', filename: 'BGM_01.mp3', url: '/static/music/BGM_01.mp3' },
      { title: 'BGM_02', filename: 'BGM_02.mp3', url: '/static/music/BGM_02.mp3' },
      { title: 'BGM_03', filename: 'BGM_03.mp3', url: '/static/music/BGM_03.mp3' },
      { title: 'BGM_04', filename: 'BGM_04.mp3', url: '/static/music/BGM_04.mp3' },
      { title: 'BGM_05', filename: 'BGM_05.mp3', url: '/static/music/BGM_05.mp3' },
      { title: 'BGM_06', filename: 'BGM_06.mp3', url: '/static/music/BGM_06.mp3' }
    ],
    currentBgmIndex: -1,
    isBgmPlaying: false,
    isBgmUserMuted: localStorage.getItem('toolkit_timer_bgm_muted') === 'true',
    bgmVolume: parseFloat(localStorage.getItem('toolkit_timer_bgm_vol') || '0.5'),

    // Stopwatch State
    stopwatchStartTime: 0,
    stopwatchElapsedMs: 0,
    stopwatchInterval: null,
    isStopwatchRunning: false,
    stopwatchLaps: [],

    init() {
      // Mode switcher (countdown vs stopwatch)
      document.querySelectorAll('.btn-timer-mode').forEach(btn => {
        btn.addEventListener('click', (e) => {
          const mode = e.currentTarget.dataset.mode;
          this.switchTimerMode(mode);
        });
      });

      // Countdown presets
      document.querySelectorAll('.btn-timer-preset').forEach(btn => {
        btn.addEventListener('click', (e) => {
          const secs = parseInt(e.currentTarget.dataset.seconds, 10) || 180;
          this.setCountdownSeconds(secs);
        });
      });

      // Countdown controls
      const btnToggleCountdown = document.getElementById('btn-timer-toggle');
      if (btnToggleCountdown) {
        btnToggleCountdown.addEventListener('click', () => {
          this.toggleCountdown();
        });
      }

      // Background Music (BGM) Controls Initialization
      this.loadBgmList();

      const btnBgmToggle = document.getElementById('btn-timer-bgm-toggle');
      if (btnBgmToggle) btnBgmToggle.addEventListener('click', () => this.toggleBgm());

      const btnFsBgmToggle = document.getElementById('btn-fs-timer-bgm-toggle');
      if (btnFsBgmToggle) btnFsBgmToggle.addEventListener('click', () => this.toggleBgm());

      const btnBgmNext = document.getElementById('btn-timer-bgm-next');
      if (btnBgmNext) btnBgmNext.addEventListener('click', () => this.nextBgm());

      const btnFsBgmNext = document.getElementById('btn-fs-timer-bgm-next');
      if (btnFsBgmNext) btnFsBgmNext.addEventListener('click', () => this.nextBgm());

      const bgmSlider = document.getElementById('timer-bgm-vol-slider');
      if (bgmSlider) {
        bgmSlider.value = this.bgmVolume;
        bgmSlider.addEventListener('input', (e) => this.setBgmVolume(e.target.value));
      }

      const fsBgmSlider = document.getElementById('fs-timer-bgm-vol-slider');
      if (fsBgmSlider) {
        fsBgmSlider.value = this.bgmVolume;
        fsBgmSlider.addEventListener('input', (e) => this.setBgmVolume(e.target.value));
      }

      this.updateBgmUi();

      const btnResetCountdown = document.getElementById('btn-timer-reset');
      if (btnResetCountdown) {
        btnResetCountdown.addEventListener('click', () => {
          this.resetCountdown();
        });
      }

      const setupCustomInputPair = (btnId, minId, secId) => {
        const btn = document.getElementById(btnId);
        const minInput = document.getElementById(minId);
        const secInput = document.getElementById(secId);

        const applyTime = () => {
          const m = parseInt(minInput ? minInput.value : 0, 10) || 0;
          const s = parseInt(secInput ? secInput.value : 0, 10) || 0;
          const total = m * 60 + s;
          if (total > 0) {
            this.setCountdownSeconds(total);
            if (window.showToast) {
              window.showToast(`已設定倒數時間為 ${m} 分 ${s} 秒`, 'info');
            }
          }
        };

        if (btn) {
          btn.addEventListener('click', applyTime);
        }
        [minInput, secInput].forEach(inp => {
          if (inp) {
            inp.addEventListener('keydown', (e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                applyTime();
              }
            });
          }
        });
      };

      setupCustomInputPair('btn-timer-set-custom', 'timer-custom-minutes', 'timer-custom-seconds');
      setupCustomInputPair('btn-fs-timer-set-custom', 'fs-timer-custom-minutes', 'fs-timer-custom-seconds');
      setupCustomInputPair('btn-dock-timer-set-custom', 'dock-timer-custom-minutes', 'dock-timer-custom-seconds');

      // Stopwatch controls
      const btnToggleSw = document.getElementById('btn-sw-toggle');
      if (btnToggleSw) {
        btnToggleSw.addEventListener('click', () => {
          this.toggleStopwatch();
        });
      }

      const btnResetSw = document.getElementById('btn-sw-reset');
      if (btnResetSw) {
        btnResetSw.addEventListener('click', () => {
          this.resetStopwatch();
        });
      }

      const btnLapSw = document.getElementById('btn-sw-lap');
      if (btnLapSw) {
        btnLapSw.addEventListener('click', () => {
          this.recordStopwatchLap();
        });
      }

      // Floating mini widget toggle
      const btnMini = document.getElementById('btn-timer-mini-toggle');
      if (btnMini) {
        btnMini.addEventListener('click', () => {
          this.toggleFloatingMiniWidget();
        });
      }

      const btnCloseMini = document.getElementById('btn-close-floating-timer');
      if (btnCloseMini) {
        btnCloseMini.addEventListener('click', (e) => {
          e.stopPropagation();
          const widget = document.getElementById('floating-mini-timer-widget');
          if (widget) widget.style.display = 'none';
        });
      }

      // Fullscreen Timer modal openers & controls
      const btnFullscreen = document.getElementById('btn-timer-fullscreen');
      if (btnFullscreen) {
        btnFullscreen.addEventListener('click', () => {
          this.openFullscreen();
        });
      }

      // Mode switch in Fullscreen
      document.querySelectorAll('.btn-fs-timer-mode').forEach(btn => {
        btn.addEventListener('click', (e) => {
          const mode = e.currentTarget.dataset.mode;
          this.switchTimerMode(mode);
        });
      });

      // Browser fullscreen toggle in modal
      const btnFsBrowserToggle = document.getElementById('btn-timer-fs-browser-toggle');
      if (btnFsBrowserToggle) {
        btnFsBrowserToggle.addEventListener('click', () => {
          if (!document.fullscreenElement) {
            document.documentElement.requestFullscreen().catch(() => {});
          } else {
            document.exitFullscreen().catch(() => {});
          }
        });
      }

      // Fullscreen presets
      document.querySelectorAll('.btn-fs-timer-preset').forEach(btn => {
        btn.addEventListener('click', (e) => {
          const secs = parseInt(e.currentTarget.dataset.seconds, 10) || 180;
          this.setCountdownSeconds(secs);
        });
      });

      // Quick add buttons (+30s, +1m)
      const btnAdd30s = document.getElementById('btn-fs-add-30s');
      if (btnAdd30s) {
        btnAdd30s.addEventListener('click', () => this.quickAddSeconds(30));
      }
      const btnAdd1m = document.getElementById('btn-fs-add-1m');
      if (btnAdd1m) {
        btnAdd1m.addEventListener('click', () => this.quickAddSeconds(60));
      }

      // Fullscreen Action buttons
      const btnFsToggleCountdown = document.getElementById('btn-fs-timer-toggle');
      if (btnFsToggleCountdown) {
        btnFsToggleCountdown.addEventListener('click', () => this.toggleCountdown());
      }
      const btnFsResetCountdown = document.getElementById('btn-fs-timer-reset');
      if (btnFsResetCountdown) {
        btnFsResetCountdown.addEventListener('click', () => this.resetCountdown());
      }

      const btnFsToggleSw = document.getElementById('btn-fs-sw-toggle');
      if (btnFsToggleSw) {
        btnFsToggleSw.addEventListener('click', () => this.toggleStopwatch());
      }
      const btnFsLapSw = document.getElementById('btn-fs-sw-lap');
      if (btnFsLapSw) {
        btnFsLapSw.addEventListener('click', () => this.recordStopwatchLap());
      }
      const btnFsResetSw = document.getElementById('btn-fs-sw-reset');
      if (btnFsResetSw) {
        btnFsResetSw.addEventListener('click', () => this.resetStopwatch());
      }

      // Floating widget click & drag support
      const widget = document.getElementById('floating-mini-timer-widget');
      if (widget) {
        let hasMoved = false;
        let isDragging = false;
        let startX, startY, initialLeft, initialTop;

        widget.addEventListener('mousedown', (e) => {
          if (e.target.closest('#btn-close-floating-timer')) return;
          isDragging = true;
          hasMoved = false;
          startX = e.clientX;
          startY = e.clientY;
          const rect = widget.getBoundingClientRect();
          initialLeft = rect.left;
          initialTop = rect.top;
          widget.style.bottom = 'auto';
          widget.style.right = 'auto';
          widget.style.left = `${initialLeft}px`;
          widget.style.top = `${initialTop}px`;
          widget.style.userSelect = 'none';
        });

        window.addEventListener('mousemove', (e) => {
          if (!isDragging) return;
          const dx = e.clientX - startX;
          const dy = e.clientY - startY;
          if (Math.abs(dx) > 3 || Math.abs(dy) > 3) {
            hasMoved = true;
          }
          widget.style.left = `${Math.max(10, Math.min(window.innerWidth - widget.offsetWidth - 10, initialLeft + dx))}px`;
          widget.style.top = `${Math.max(10, Math.min(window.innerHeight - widget.offsetHeight - 10, initialTop + dy))}px`;
        });

        window.addEventListener('mouseup', () => {
          isDragging = false;
          widget.style.userSelect = '';
        });

        widget.addEventListener('click', (e) => {
          if (hasMoved || e.target.closest('#btn-close-floating-timer')) return;
          const tabBtn = document.querySelector('.nav-tab[data-tab="toolkit"]');
          if (tabBtn) tabBtn.click();
          if (window.TeachingToolkit) {
            window.TeachingToolkit.switchSubtab('timer');
          }
        });
      }

      this.updateCountdownDisplay();
    },

    openFullscreen() {
      const modal = document.getElementById('modal-timer-fullscreen');
      if (!modal) return;
      modal.classList.add('open');

      this.updateCountdownDisplay();
      this.updateStopwatchDisplay();
      this.renderStopwatchLaps();
      this.updateCountdownControls();
      this.updateStopwatchControls();
      this.updatePresetButtons();
      this.syncCustomTimeInputs(Math.floor(this.countdownTotalSeconds / 60), this.countdownTotalSeconds % 60);

      // Keyboard Shortcuts Handler in Fullscreen
      this._fsKeyHandler = (e) => {
        if (!modal.classList.contains('open')) return;
        if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;

        if (e.code === 'Space') {
          e.preventDefault();
          if (this.timerMode === 'stopwatch') this.toggleStopwatch();
          else this.toggleCountdown();
        } else if (e.key === 'r' || e.key === 'R') {
          e.preventDefault();
          if (this.timerMode === 'stopwatch') this.resetStopwatch();
          else this.resetCountdown();
        } else if (e.key === 'l' || e.key === 'L') {
          if (this.timerMode === 'stopwatch') {
            e.preventDefault();
            this.recordStopwatchLap();
          }
        } else if (e.key === 'Escape') {
          this.closeFullscreen();
        }
      };
      window.addEventListener('keydown', this._fsKeyHandler);
    },

    closeFullscreen() {
      const modal = document.getElementById('modal-timer-fullscreen');
      if (modal) modal.classList.remove('open');
      if (this._fsKeyHandler) {
        window.removeEventListener('keydown', this._fsKeyHandler);
        this._fsKeyHandler = null;
      }
      if (document.fullscreenElement) {
        document.exitFullscreen().catch(() => {});
      }
    },

    quickAddSeconds(secs) {
      this.countdownRemainingSeconds += secs;
      if (this.countdownRemainingSeconds > this.countdownTotalSeconds) {
        this.countdownTotalSeconds = this.countdownRemainingSeconds;
      }
      this.updateCountdownDisplay();
    },

    switchTimerMode(mode) {
      this.timerMode = mode;
      document.querySelectorAll('.btn-timer-mode, .btn-fs-timer-mode').forEach(btn => {
        const isActive = btn.dataset.mode === mode;
        btn.classList.toggle('active', isActive);
        btn.classList.toggle('btn-secondary', !isActive);
      });

      const countdownBlock = document.getElementById('timer-countdown-container');
      const stopwatchBlock = document.getElementById('timer-stopwatch-container');
      if (countdownBlock) countdownBlock.style.display = mode === 'countdown' ? 'block' : 'none';
      if (stopwatchBlock) stopwatchBlock.style.display = mode === 'stopwatch' ? 'block' : 'none';

      const fsCountdown = document.getElementById('fs-countdown-container');
      const fsStopwatch = document.getElementById('fs-stopwatch-container');
      if (fsCountdown) fsCountdown.style.display = mode === 'countdown' ? 'flex' : 'none';
      if (fsStopwatch) fsStopwatch.style.display = mode === 'stopwatch' ? 'flex' : 'none';

      this.syncFloatingMiniWidget();
    },

    toggleFloatingMiniWidget() {
      const widget = document.getElementById('floating-mini-timer-widget');
      if (!widget) return;
      const isVisible = widget.style.display === 'flex' || widget.style.display === 'block';
      widget.style.display = isVisible ? 'none' : 'flex';
      if (!isVisible) {
        this.syncFloatingMiniWidget();
      }
    },

    syncFloatingMiniWidget() {
      const miniDigits = document.getElementById('floating-timer-digits');
      const dockDigits = document.getElementById('dock-timer-digits');
      const dockIcon = document.getElementById('dock-timer-state-icon');

      let timeText = '03:00';
      if (this.timerMode === 'stopwatch') {
        const totalMs = this.stopwatchElapsedMs;
        const mins = Math.floor(totalMs / 60000);
        const secs = Math.floor((totalMs % 60000) / 1000);
        const ms = Math.floor((totalMs % 1000) / 10);
        timeText = `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}.${String(ms).padStart(2, '0')}`;
        if (dockIcon) dockIcon.textContent = this.isStopwatchRunning ? '⏱️' : '⏹️';
      } else {
        const mins = Math.floor(this.countdownRemainingSeconds / 60);
        const secs = this.countdownRemainingSeconds % 60;
        timeText = `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
        if (dockIcon) dockIcon.textContent = this.isCountdownRunning ? '⏳' : '⏱️';
      }

      if (miniDigits) miniDigits.textContent = timeText;
      if (dockDigits) dockDigits.textContent = timeText;
    },

    syncCustomTimeInputs(m, s) {
      const pairs = [
        ['timer-custom-minutes', 'timer-custom-seconds'],
        ['fs-timer-custom-minutes', 'fs-timer-custom-seconds'],
        ['dock-timer-custom-minutes', 'dock-timer-custom-seconds']
      ];
      pairs.forEach(([minId, secId]) => {
        const minEl = document.getElementById(minId);
        const secEl = document.getElementById(secId);
        if (minEl && document.activeElement !== minEl) minEl.value = m;
        if (secEl && document.activeElement !== secEl) secEl.value = s;
      });
    },

    setCountdownSeconds(secs) {
      this.pauseCountdown();
      this.countdownTotalSeconds = secs;
      this.countdownRemainingSeconds = secs;
      this.updateCountdownDisplay();
      this.syncCustomTimeInputs(Math.floor(secs / 60), secs % 60);

      // Sync active state on preset pills
      document.querySelectorAll('.btn-timer-preset, .btn-fs-timer-preset').forEach(btn => {
        const btnSecs = parseInt(btn.dataset.seconds, 10);
        btn.classList.toggle('active', btnSecs === secs);
      });
    },

    toggleCountdown() {
      if (this.isCountdownRunning) {
        this.pauseCountdown();
      } else {
        this.startCountdown();
      }
    },

    startCountdown() {
      if (this.countdownRemainingSeconds <= 0) {
        this.countdownRemainingSeconds = this.countdownTotalSeconds;
      }
      this.isCountdownRunning = true;
      this.updateCountdownControls();

      AudioEngine.init();

      this.countdownInterval = setInterval(() => {
        this.countdownRemainingSeconds--;

        if (this.countdownRemainingSeconds <= 0) {
          this.countdownRemainingSeconds = 0;
          this.pauseCountdown();
          this.pauseBgm(false);
          AudioEngine.playTimerAlarm(3);
          this.triggerCountdownFinishAnimation();
        }

        this.updateCountdownDisplay();
      }, 1000);
    },

    pauseCountdown() {
      this.isCountdownRunning = false;
      if (this.countdownInterval) {
        clearInterval(this.countdownInterval);
        this.countdownInterval = null;
      }
      this.updateCountdownControls();
    },

    resetCountdown() {
      this.pauseCountdown();
      this.countdownRemainingSeconds = this.countdownTotalSeconds;
      this.updateCountdownDisplay();
    },

    updateCountdownDisplay() {
      const mins = Math.floor(this.countdownRemainingSeconds / 60);
      const secs = this.countdownRemainingSeconds % 60;
      const formatted = `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;

      const numDisplay = document.getElementById('timer-countdown-digits');
      if (numDisplay) {
        numDisplay.textContent = formatted;
        numDisplay.classList.toggle('urgent', this.countdownRemainingSeconds <= 5 && this.countdownRemainingSeconds > 0);
        numDisplay.classList.toggle('finished', this.countdownRemainingSeconds === 0);
      }

      const fsNumDisplay = document.getElementById('fs-countdown-digits');
      if (fsNumDisplay) {
        fsNumDisplay.textContent = formatted;
        fsNumDisplay.classList.toggle('urgent', this.countdownRemainingSeconds <= 5 && this.countdownRemainingSeconds > 0);
        fsNumDisplay.classList.toggle('finished', this.countdownRemainingSeconds === 0);
      }

      // Progress bars
      const percent = this.countdownTotalSeconds > 0 ? (this.countdownRemainingSeconds / this.countdownTotalSeconds) * 100 : 0;
      const progressBar = document.getElementById('timer-progress-fill');
      if (progressBar) {
        progressBar.style.width = `${percent}%`;
      }
      const fsProgressBar = document.getElementById('fs-timer-progress-fill');
      if (fsProgressBar) {
        fsProgressBar.style.width = `${percent}%`;
      }

      // Sync with floating mini widget & dock
      if (this.timerMode !== 'stopwatch') {
        const miniDigits = document.getElementById('floating-timer-digits');
        const dockDigits = document.getElementById('dock-timer-digits');
        if (miniDigits) miniDigits.textContent = formatted;
        if (dockDigits) dockDigits.textContent = formatted;
      }
    },

    updateCountdownControls() {
      const lang = window.I18n ? window.I18n.getLanguage() : 'zh-TW';
      const label = this.isCountdownRunning ? (lang === 'en' ? '⏸️ Pause' : '⏸️ 暫停計時') : (lang === 'en' ? '▶️ Start' : '▶️ 開始計時');
      const bg = this.isCountdownRunning ? 'linear-gradient(135deg, #d3a24c, #d97706)' : 'linear-gradient(135deg, #4fae82, #059669)';

      const dockIcon = document.getElementById('dock-timer-state-icon');
      if (dockIcon) {
        dockIcon.textContent = this.isCountdownRunning ? '⏳' : '⏱️';
      }

      const btn = document.getElementById('btn-timer-toggle');
      if (btn) {
        btn.innerHTML = label;
        btn.style.background = bg;
      }
      const fsBtn = document.getElementById('btn-fs-timer-toggle');
      if (fsBtn) {
        fsBtn.innerHTML = label;
        fsBtn.style.background = bg;
      }
    },

    triggerCountdownFinishAnimation() {
      const display = document.getElementById('timer-countdown-digits');
      if (display) {
        display.classList.add('alarm-pulse');
        setTimeout(() => display.classList.remove('alarm-pulse'), 3500);
      }
      const fsDisplay = document.getElementById('fs-countdown-digits');
      if (fsDisplay) {
        fsDisplay.classList.add('alarm-pulse');
        setTimeout(() => fsDisplay.classList.remove('alarm-pulse'), 3500);
      }
    },

    // Stopwatch Methods
    toggleStopwatch() {
      if (this.isStopwatchRunning) {
        this.pauseStopwatch();
      } else {
        this.startStopwatch();
      }
    },

    startStopwatch() {
      this.isStopwatchRunning = true;
      this.stopwatchStartTime = Date.now() - this.stopwatchElapsedMs;
      this.updateStopwatchControls();

      this.stopwatchInterval = setInterval(() => {
        this.stopwatchElapsedMs = Date.now() - this.stopwatchStartTime;
        this.updateStopwatchDisplay();
      }, 30);
    },

    pauseStopwatch() {
      this.isStopwatchRunning = false;
      if (this.stopwatchInterval) {
        clearInterval(this.stopwatchInterval);
        this.stopwatchInterval = null;
      }
      this.updateStopwatchControls();
    },

    resetStopwatch() {
      this.pauseStopwatch();
      this.stopwatchElapsedMs = 0;
      this.stopwatchLaps = [];
      this.updateStopwatchDisplay();
      this.renderStopwatchLaps();
    },

    recordStopwatchLap() {
      if (this.stopwatchElapsedMs === 0) return;
      this.stopwatchLaps.unshift(this.stopwatchElapsedMs);
      this.renderStopwatchLaps();
    },

    updateStopwatchDisplay() {
      const totalMs = this.stopwatchElapsedMs;
      const mins = Math.floor(totalMs / 60000);
      const secs = Math.floor((totalMs % 60000) / 1000);
      const ms = Math.floor((totalMs % 1000) / 10);

      const formatted = `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}.${String(ms).padStart(2, '0')}`;
      const display = document.getElementById('stopwatch-digits');
      if (display) {
        display.textContent = formatted;
      }
      const fsDisplay = document.getElementById('fs-stopwatch-digits');
      if (fsDisplay) {
        fsDisplay.textContent = formatted;
      }

      // Sync with floating mini widget if in stopwatch mode
      if (this.timerMode === 'stopwatch') {
        const miniDigits = document.getElementById('floating-timer-digits');
        if (miniDigits) {
          miniDigits.textContent = formatted;
        }
      }
    },

    renderStopwatchLaps() {
      const container = document.getElementById('stopwatch-laps-list');
      const fsContainer = document.getElementById('fs-stopwatch-laps-list');
      if (container) container.innerHTML = '';
      if (fsContainer) fsContainer.innerHTML = '';

      const isEn = window.I18n && window.I18n.getLanguage() === 'en';
      const lapPrefix = isEn ? 'Lap' : '圈數';

      this.stopwatchLaps.forEach((lapMs, idx) => {
        const mins = Math.floor(lapMs / 60000);
        const secs = Math.floor((lapMs % 60000) / 1000);
        const ms = Math.floor((lapMs % 1000) / 10);
        const formatted = `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}.${String(ms).padStart(2, '0')}`;

        if (container) {
          const lapItem = document.createElement('div');
          lapItem.className = 'stopwatch-lap-item';
          lapItem.innerHTML = `
            <span>${lapPrefix} ${this.stopwatchLaps.length - idx}</span>
            <b>${formatted}</b>
          `;
          container.appendChild(lapItem);
        }

        if (fsContainer) {
          const fsLapItem = document.createElement('div');
          fsLapItem.className = 'btn btn-secondary btn-sm';
          fsLapItem.style.cursor = 'default';
          fsLapItem.style.background = 'rgba(255,255,255,0.08)';
          fsLapItem.style.border = '1px solid rgba(255,255,255,0.15)';
          fsLapItem.innerHTML = `
            <span style="color: var(--text-muted); margin-right: 6px;">${lapPrefix} ${this.stopwatchLaps.length - idx}</span>
            <b style="color: #60a5fa;">${formatted}</b>
          `;
          fsContainer.appendChild(fsLapItem);
        }
      });
    },

    updateStopwatchControls() {
      const lang = window.I18n ? window.I18n.getLanguage() : 'zh-TW';
      const label = this.isStopwatchRunning ? (lang === 'en' ? '⏸️ Pause' : '⏸️ 暫停') : (lang === 'en' ? '▶️ Start' : '▶️ 開始');
      const bg = this.isStopwatchRunning ? 'linear-gradient(135deg, #d3a24c, #d97706)' : 'linear-gradient(135deg, #4fae82, #059669)';

      const btn = document.getElementById('btn-sw-toggle');
      if (btn) {
        btn.innerHTML = label;
        btn.style.background = bg;
      }
      const fsBtn = document.getElementById('btn-fs-sw-toggle');
      if (fsBtn) {
        fsBtn.innerHTML = label;
        fsBtn.style.background = bg;
      }
    },

    // =======================================================================
    // BGM Methods
    // =======================================================================
    async loadBgmList() {
      try {
        const resp = await fetch('/api/system/bgm_list');
        if (resp.ok) {
          const data = await resp.json();
          if (data.music && data.music.length > 0) {
            this.bgmMusicList = data.music;
          }
        }
      } catch (e) {
        console.warn('Failed to load bgm list, using fallback', e);
      }
    },

    playRandomBgm(force = false) {
      if (!this.bgmMusicList || this.bgmMusicList.length === 0) return;
      if (this.isBgmUserMuted && !force) {
        this.updateBgmUi();
        return;
      }

      let nextIndex = Math.floor(Math.random() * this.bgmMusicList.length);
      if (this.bgmMusicList.length > 1 && nextIndex === this.currentBgmIndex) {
        nextIndex = (nextIndex + 1) % this.bgmMusicList.length;
      }
      this.currentBgmIndex = nextIndex;
      const track = this.bgmMusicList[this.currentBgmIndex];

      this.bgmAudio.src = track.url;
      this.bgmAudio.loop = true;
      this.bgmAudio.volume = this.bgmVolume;

      const playPromise = this.bgmAudio.play();
      if (playPromise !== undefined) {
        playPromise.then(() => {
          this.isBgmPlaying = true;
          this.updateBgmUi();
        }).catch(err => {
          console.log('BGM waiting for user interaction:', err);
          this.isBgmPlaying = false;
          this.updateBgmUi();
        });
      }
    },

    toggleBgm() {
      if (this.isBgmPlaying) {
        this.pauseBgm(true);
      } else {
        this.isBgmUserMuted = false;
        localStorage.setItem('toolkit_timer_bgm_muted', 'false');
        if (this.currentBgmIndex >= 0 && this.bgmAudio.src) {
          this.bgmAudio.volume = this.bgmVolume;
          this.bgmAudio.play().then(() => {
            this.isBgmPlaying = true;
            this.updateBgmUi();
          }).catch(e => {
            this.playRandomBgm(true);
          });
        } else {
          this.playRandomBgm(true);
        }
      }
    },

    pauseBgm(setUserMuted = false) {
      if (this.bgmAudio) {
        this.bgmAudio.pause();
      }
      this.isBgmPlaying = false;
      if (setUserMuted) {
        this.isBgmUserMuted = true;
        localStorage.setItem('toolkit_timer_bgm_muted', 'true');
      }
      this.updateBgmUi();
    },

    nextBgm() {
      this.isBgmUserMuted = false;
      localStorage.setItem('toolkit_timer_bgm_muted', 'false');
      this.playRandomBgm(true);
    },

    setBgmVolume(val) {
      this.bgmVolume = Math.max(0, Math.min(1, parseFloat(val) || 0.5));
      localStorage.setItem('toolkit_timer_bgm_vol', String(this.bgmVolume));
      if (this.bgmAudio) {
        this.bgmAudio.volume = this.bgmVolume;
      }
      const s1 = document.getElementById('timer-bgm-vol-slider');
      const s2 = document.getElementById('fs-timer-bgm-vol-slider');
      if (s1) s1.value = this.bgmVolume;
      if (s2) s2.value = this.bgmVolume;
    },

    updateBgmUi() {
      const isEn = (localStorage.getItem('app_lang') === 'en');
      const track = (this.currentBgmIndex >= 0 && this.bgmMusicList[this.currentBgmIndex]) 
        ? this.bgmMusicList[this.currentBgmIndex] 
        : (this.bgmMusicList[0] || { filename: 'BGM_01.mp3' });

      // Track titles
      const nameEl = document.getElementById('timer-bgm-name');
      const fsNameEl = document.getElementById('fs-timer-bgm-name');
      if (nameEl) nameEl.textContent = track.filename || track.title;
      if (fsNameEl) fsNameEl.textContent = track.filename || track.title;

      // Icons & Text
      const iconEl = document.getElementById('timer-bgm-icon');
      const fsIconEl = document.getElementById('fs-timer-bgm-icon');
      const textEl = document.getElementById('timer-bgm-btn-text');
      const fsTextEl = document.getElementById('fs-timer-bgm-btn-text');

      const btn1 = document.getElementById('btn-timer-bgm-toggle');
      const btn2 = document.getElementById('btn-fs-timer-bgm-toggle');

      if (this.isBgmPlaying) {
        if (iconEl) iconEl.textContent = '⏸️';
        if (fsIconEl) fsIconEl.textContent = '⏸️';
        if (textEl) textEl.textContent = isEn ? 'Pause Music' : '暫停音樂';
        if (fsTextEl) fsTextEl.textContent = isEn ? 'Pause Music' : '暫停音樂';
        if (btn1) { btn1.style.background = 'linear-gradient(135deg, #4fae82, #059669)'; }
        if (btn2) { btn2.style.background = 'linear-gradient(135deg, #4fae82, #059669)'; }
      } else {
        if (iconEl) iconEl.textContent = '▶️';
        if (fsIconEl) fsIconEl.textContent = '▶️';
        if (textEl) textEl.textContent = isEn ? 'Play Music' : '播放音樂';
        if (fsTextEl) fsTextEl.textContent = isEn ? 'Play Music' : '播放音樂';
        if (btn1) { btn1.style.background = 'linear-gradient(135deg, #7b98e0, #4a67ba)'; }
        if (btn2) { btn2.style.background = 'linear-gradient(135deg, #7b98e0, #4a67ba)'; }
      }

      // Slider sync
      const s1 = document.getElementById('timer-bgm-vol-slider');
      const s2 = document.getElementById('fs-timer-bgm-vol-slider');
      if (s1) s1.value = this.bgmVolume;
      if (s2) s2.value = this.bgmVolume;
    },

    onEnterTimerTab() {
      if (!this.isBgmPlaying && !this.isBgmUserMuted) {
        this.playRandomBgm(false);
      }
    },

    onLeaveTimerTab() {
      if (this.isBgmPlaying) {
        this.bgmAudio.pause();
        this.isBgmPlaying = false;
        this.updateBgmUi();
      }
    },

    updatePresetButtons() {
      const isEn = window.I18n && window.I18n.getLanguage() === 'en';
      document.querySelectorAll('.btn-timer-preset, .btn-fs-timer-preset').forEach(btn => {
        const secs = parseInt(btn.dataset.seconds, 10);
        if (secs === 30) btn.textContent = isEn ? '30s' : '30 秒';
        else if (secs === 60) btn.textContent = isEn ? '1 min' : '1 分鐘';
        else if (secs === 120) btn.textContent = isEn ? '2 min' : '2 分鐘';
        else if (secs === 180) btn.textContent = isEn ? '3 min' : '3 分鐘';
        else if (secs === 300) btn.textContent = isEn ? '5 min' : '5 分鐘';
        else if (secs === 600) btn.textContent = isEn ? '10 min' : '10 分鐘';
        else if (secs === 900) btn.textContent = isEn ? '15 min' : '15 分鐘';
      });
    }
  };

  // =========================================================================
  // 4.5 即時互動牆 (Live Wall)：開一個限時場次，學生每人限交一則文字/手繪/拍照貼文，
  // 教師端這裡與大螢幕投影（static/js/projection.js）即時同步呈現。
  // =========================================================================
  function livewallEscapeHtml(s) {
    const d = document.createElement('div');
    d.textContent = s == null ? '' : String(s);
    return d.innerHTML;
  }

  function livewallT(key, params) {
    return window.I18n ? window.I18n.t(key, params) : key;
  }

  function livewallModeLabel(mode) {
    const keyMap = { text: 'livewall_mode_text', drawing: 'livewall_mode_drawing', photo: 'livewall_mode_photo' };
    return keyMap[mode] ? livewallT(keyMap[mode]) : mode;
  }

  function livewallSeatLine(studentNumber, studentName) {
    return `${livewallT('livewall_seat_number', { num: studentNumber })} ${livewallEscapeHtml(studentName)}`;
  }

  const LiveWall = {
    currentSession: null,
    heartbeatTimer: null,

    init() {
      document.getElementById('btn-livewall-start')?.addEventListener('click', () => this.start());
      document.getElementById('btn-livewall-clear')?.addEventListener('click', () => this.clear());
      document.getElementById('btn-livewall-end')?.addEventListener('click', () => this.end());
      document.getElementById('btn-livewall-history')?.addEventListener('click', () => this.openHistory());
    },

    onEnterLiveWallTab() {
      this.refresh();
    },

    // 教師離開互動牆分頁或關閉視窗時自動結束進行中的場次
    async onLeaveLiveWallTab(options = {}) {
      this.stopHeartbeat();
      if (!this.currentSession || !this.currentSession.id) return;
      const sessionId = this.currentSession.id;
      this.currentSession = null;

      const token = localStorage.getItem('auth_token') || '';
      const closeUrl = `/api/live-wall/sessions/${sessionId}/close?token=${encodeURIComponent(token)}`;

      if (options.isUnload) {
        try {
          if (navigator.sendBeacon) {
            const blob = new Blob([JSON.stringify({})], { type: 'application/json' });
            navigator.sendBeacon(closeUrl, blob);
          } else {
            fetch(closeUrl, {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
                ...(token ? { 'Authorization': `Bearer ${token}` } : {})
              },
              body: JSON.stringify({}),
              keepalive: true,
              credentials: 'same-origin'
            }).catch(() => {});
          }
        } catch (e) {
          console.warn('[LiveWall] Unload close failed:', e);
        }
      } else {
        try {
          await API.post(closeUrl, {});
          window.showToast && window.showToast(livewallT('livewall_toast_auto_ended') || '已離開互動牆，場次已自動結束', 'info');
          await this.refresh();
        } catch (err) {
          console.warn('[LiveWall] Auto close on leave failed:', err);
        }
      }
    },

    startHeartbeat() {
      this.stopHeartbeat();
      if (!this.currentSession?.id) return;
      const sendPing = () => {
        if (!this.currentSession?.id) {
          this.stopHeartbeat();
          return;
        }
        API.post(`/api/live-wall/sessions/${this.currentSession.id}/heartbeat`, {}).catch(() => {});
      };
      this.heartbeatTimer = setInterval(sendPing, 15000);
    },

    stopHeartbeat() {
      if (this.heartbeatTimer) {
        clearInterval(this.heartbeatTimer);
        this.heartbeatTimer = null;
      }
    },

    async refresh() {
      const courseId = window.AppState && window.AppState.currentCourseId;
      if (!courseId) return;
      try {
        const data = await API.get(`/api/live-wall/courses/${courseId}/active`);
        this.currentSession = data.session;
        this.render(data.session, data.posts || []);
      } catch (err) {
        console.error('LiveWall.refresh error:', err);
      }
    },

    render(session, posts) {
      const startForm = document.getElementById('livewall-start-form');
      const activeView = document.getElementById('livewall-active-view');
      if (startForm) startForm.style.display = session ? 'none' : 'block';
      if (activeView) activeView.style.display = session ? 'block' : 'none';
      if (!session) {
        this.stopHeartbeat();
        return;
      }
      this.startHeartbeat();

      const statusMeta = document.getElementById('livewall-status-meta');
      if (statusMeta) {
        statusMeta.textContent =
          livewallT('livewall_status_meta_base', {
            mode: livewallModeLabel(session.mode),
            visibility: livewallT(session.show_names ? 'livewall_named' : 'livewall_anonymous'),
            count: posts.length
          }) +
          (session.title ? livewallT('livewall_status_meta_prompt_suffix', { title: session.title }) : '');
      }

      const grid = document.getElementById('livewall-posts-grid');
      const empty = document.getElementById('livewall-posts-empty');
      if (!grid) return;
      grid.innerHTML = '';
      if (empty) empty.style.display = posts.length ? 'none' : 'block';
      const postAlt = livewallT('livewall_post_alt');
      posts.forEach((p) => {
        const card = document.createElement('div');
        card.className = 'glass-card';
        card.style.cssText = 'padding:12px; display:flex; flex-direction:column; gap:8px;';
        const nameLine = livewallSeatLine(p.student_number, p.student_name);
        if (p.image_url) {
          card.innerHTML = `
            <img src="${p.image_url}" style="width:100%; border-radius:var(--radius-md); object-fit:cover; max-height:200px; cursor:zoom-in;" alt="${postAlt}">
            <div style="font-size:0.82rem; color:var(--text-muted); font-weight:700;">${nameLine}</div>
          `;
          // 改為彈出視窗放大檢視（可縮放/平移），取代原本開新分頁的做法，見 static/js/image-lightbox.js。
          card.querySelector('img').addEventListener('click', () => {
            window.ImageLightbox && window.ImageLightbox.open(p.image_url);
          });
        } else {
          card.innerHTML = `
            <div style="white-space:pre-wrap; font-size:0.92rem;">${livewallEscapeHtml(p.text_content || '')}</div>
            <div style="font-size:0.82rem; color:var(--text-muted); font-weight:700;">${nameLine}</div>
          `;
        }
        // 進行中場次的即時看板一律唯讀——刪除紀錄的功能移到「📜 歷史紀錄」彈窗管理，不放在這裡。
        grid.appendChild(card);
      });
    },

    async start() {
      const courseId = window.AppState && window.AppState.currentCourseId;
      if (!courseId) { window.ensureCourseSelected && window.ensureCourseSelected(); return; }
      const mode = document.querySelector('input[name="livewall-mode"]:checked').value;
      const title = document.getElementById('livewall-title-input').value.trim();
      const showNames = document.getElementById('livewall-show-names').checked;
      try {
        await API.post(`/api/live-wall/courses/${courseId}/start`, { mode, title, show_names: showNames });
        document.getElementById('livewall-title-input').value = '';
        window.showToast && window.showToast(livewallT('livewall_toast_started'), 'success');
        await this.refresh();
      } catch (err) {
        window.showToast && window.showToast(err.message, 'error');
      }
    },

    async clear() {
      if (!this.currentSession) return;
      if (!(await window.showConfirmModal(livewallT('livewall_clear_confirm')))) return;
      try {
        await API.post(`/api/live-wall/sessions/${this.currentSession.id}/clear`);
        window.showToast && window.showToast(livewallT('livewall_toast_cleared'), 'success');
        await this.refresh();
      } catch (err) {
        window.showToast && window.showToast(err.message, 'error');
      }
    },

    async end() {
      if (!this.currentSession) return;
      if (!(await window.showConfirmModal(livewallT('livewall_end_confirm')))) return;
      const sessionId = this.currentSession.id;
      this.stopHeartbeat();
      this.currentSession = null;
      try {
        await API.post(`/api/live-wall/sessions/${sessionId}/close`);
        window.showToast && window.showToast(livewallT('livewall_toast_ended'), 'success');
        await this.refresh();
      } catch (err) {
        window.showToast && window.showToast(err.message, 'error');
      }
    },

    // --- 歷史紀錄（教師端）：該課程所有場次、所有學生的完整上傳紀錄，與「進行中場次」的
    // 即時看板分開——刪除紀錄的管理動作只在這裡進行，不影響/不出現在進行中場次的唯讀看板。

    async openHistory() {
      const courseId = window.AppState && window.AppState.currentCourseId;
      if (!courseId) { window.ensureCourseSelected && window.ensureCourseSelected(); return; }
      await this.loadHistory();
      window.openModal && window.openModal('modal-livewall-history');
    },

    async loadHistory() {
      const courseId = window.AppState && window.AppState.currentCourseId;
      if (!courseId) return;
      try {
        const posts = await API.get(`/api/live-wall/courses/${courseId}/history`);
        this.renderHistory(posts);
      } catch (err) {
        window.showToast && window.showToast(err.message, 'error');
      }
    },

    // 依場次分組呈現為「日期－活動名稱（N 則）」的可展開分類，點開才顯示該場次所有學生的
    // 送出內容——避免全部紀錄攤平成一長串列表不好找。groups 為後端回傳的 [{session, posts}]。
    renderHistory(groups) {
      const list = document.getElementById('livewall-history-list');
      const empty = document.getElementById('livewall-history-empty');
      if (!list) return;
      list.innerHTML = '';
      if (empty) empty.style.display = groups.length ? 'none' : 'block';

      groups.forEach((group) => {
        const { session, posts } = group;
        const dateLabel = (session.created_at || '').split(' ')[0];
        const activityName = session.title || livewallModeLabel(session.mode);
        const countSuffix = livewallT('livewall_history_count_suffix', { count: posts.length });

        const wrap = document.createElement('div');
        wrap.style.cssText = 'border:1px solid var(--card-border); border-radius:var(--radius-md); overflow:hidden;';

        const header = document.createElement('button');
        header.type = 'button';
        header.style.cssText = 'width:100%; display:flex; align-items:center; justify-content:space-between; gap:8px; padding:12px 14px; background:var(--nav-bg); border:none; cursor:pointer; text-align:left; font-weight:700; font-size:0.92rem; color:var(--text-main);';
        header.innerHTML = `
          <span>📅 ${livewallEscapeHtml(dateLabel)}－${livewallEscapeHtml(activityName)}<span style="font-weight:400; color:var(--text-muted); margin-left:6px;">${livewallEscapeHtml(countSuffix)}</span></span>
          <span class="livewall-history-toggle-icon">▶</span>
        `;

        const body = document.createElement('div');
        body.style.cssText = 'padding:10px; display:flex; flex-direction:column; gap:8px;';
        body.hidden = true;
        posts.forEach((p) => body.appendChild(this.renderHistoryPostRow(p)));

        header.addEventListener('click', () => {
          body.hidden = !body.hidden;
          header.querySelector('.livewall-history-toggle-icon').textContent = body.hidden ? '▶' : '▼';
        });

        wrap.appendChild(header);
        wrap.appendChild(body);
        list.appendChild(wrap);
      });
    },

    renderHistoryPostRow(p) {
      const row = document.createElement('div');
      row.className = 'glass-card';
      row.style.cssText = 'padding:10px 12px; display:flex; align-items:center; gap:12px;';
      const postAlt = livewallT('livewall_post_alt');
      const thumb = p.image_url
        ? `<img src="${p.image_url}" style="width:56px; height:56px; object-fit:cover; border-radius:var(--radius-sm); cursor:zoom-in; flex-shrink:0;" alt="${postAlt}">`
        : `<div style="width:56px; height:56px; border-radius:var(--radius-sm); background:var(--nav-bg); display:flex; align-items:center; justify-content:center; font-size:1.3rem; flex-shrink:0;">✏️</div>`;
      row.innerHTML = `
        ${thumb}
        <div style="flex:1; min-width:0;">
          <div style="font-weight:700; font-size:0.9rem;">${livewallSeatLine(p.student_number, p.student_name)}</div>
          <div style="font-size:0.78rem; color:var(--text-muted);">${livewallEscapeHtml(p.created_at || '')}</div>
          ${p.text_content ? `<div style="font-size:0.85rem; margin-top:4px; white-space:pre-wrap;">${livewallEscapeHtml(p.text_content)}</div>` : ''}
        </div>
      `;
      if (p.image_url) {
        row.querySelector('img').addEventListener('click', () => {
          window.ImageLightbox && window.ImageLightbox.open(p.image_url);
        });
      }
      const delBtn = document.createElement('button');
      delBtn.type = 'button';
      delBtn.className = 'btn-icon';
      delBtn.title = livewallT('livewall_delete_title');
      delBtn.style.cssText = 'flex-shrink:0;';
      delBtn.textContent = '🗑️';
      delBtn.addEventListener('click', () => this.deletePost(p.id));
      row.appendChild(delBtn);
      return row;
    },

    // 刪除單筆上傳紀錄（教師端專用，從「歷史紀錄」彈窗操作）：後端會連同伺服器上的手繪/拍照
    // 檔案一併刪除，此動作無法復原。若該筆同時也還在進行中場次的看板上，一併重新整理看板。
    async deletePost(postId) {
      if (!(await window.showConfirmModal(livewallT('livewall_delete_confirm')))) return;
      try {
        await API.delete(`/api/live-wall/posts/${postId}`);
        window.showToast && window.showToast(livewallT('livewall_toast_deleted'), 'success');
        await Promise.all([this.loadHistory(), this.refresh()]);
      } catch (err) {
        window.showToast && window.showToast(err.message, 'error');
      }
    },
  };

  // =========================================================================
  // 5. FloatingClassroomDock (全域課堂懸浮動態膠囊與抽籤連動加分)
  // =========================================================================
  const FloatingClassroomDock = {
    currentWinner: null,
    currentWinnerMode: 'student',
    isRolling: false,
    drawnStudentIds: new Set(),

    init() {
      // 1. Collapse toggle
      const btnCollapse = document.getElementById('btn-dock-collapse');
      const dock = document.getElementById('classroom-floating-dock');
      const savedCollapsed = localStorage.getItem('classroom_dock_collapsed') === 'true';
      if (dock && savedCollapsed) {
        dock.classList.add('collapsed');
      }

      if (btnCollapse && dock) {
        btnCollapse.addEventListener('click', (e) => {
          e.stopPropagation();
          dock.classList.toggle('collapsed');
          localStorage.setItem('classroom_dock_collapsed', dock.classList.contains('collapsed'));
          if (dock.classList.contains('collapsed')) {
            this.closeAllPopovers();
          }
        });
      }

      // 2. Chime button
      const btnChime = document.getElementById('btn-dock-chime');
      if (btnChime) {
        btnChime.addEventListener('click', () => {
          if (AudioEngine && AudioEngine.playChime) {
            AudioEngine.playChime();
          }
          btnChime.classList.add('pulse');
          setTimeout(() => btnChime.classList.remove('pulse'), 400);
        });
      }

      // 3. Draw button
      const btnDraw = document.getElementById('btn-dock-draw');
      if (btnDraw) {
        btnDraw.addEventListener('click', (e) => {
          e.stopPropagation();
          this.toggleDrawPanel();
        });
      }

      // 4. Timer capsule button (start/pause)
      const btnTimerToggle = document.getElementById('btn-dock-timer-toggle');
      if (btnTimerToggle) {
        btnTimerToggle.addEventListener('click', (e) => {
          e.stopPropagation();
          TimerEngine.toggleCountdown();
        });
      }

      // 5. Timer menu button
      const btnTimerMenu = document.getElementById('btn-dock-timer-menu');
      if (btnTimerMenu) {
        btnTimerMenu.addEventListener('click', (e) => {
          e.stopPropagation();
          this.toggleTimerPanel();
        });
      }

      // 6. Close buttons for popovers
      const btnCloseDraw = document.getElementById('btn-close-floating-draw');
      if (btnCloseDraw) {
        btnCloseDraw.addEventListener('click', () => this.closeDrawPanel());
      }

      const btnCloseTimer = document.getElementById('btn-close-floating-timer');
      if (btnCloseTimer) {
        btnCloseTimer.addEventListener('click', () => this.closeTimerPanel());
      }

      // 7. Floating Draw Controls
      const modeSelect = document.getElementById('floating-draw-mode');
      if (modeSelect) {
        modeSelect.addEventListener('change', () => {
          this.updatePoolBadge();
          this.resetDrawCard();
        });
      }

      const excludeDrawn = document.getElementById('floating-draw-exclude-drawn');
      if (excludeDrawn) {
        excludeDrawn.addEventListener('change', () => this.updatePoolBadge());
      }

      const btnResetPool = document.getElementById('btn-floating-draw-reset-pool');
      if (btnResetPool) {
        btnResetPool.addEventListener('click', () => {
          this.drawnStudentIds.clear();
          this.updatePoolBadge();
          this.resetDrawCard();
          if (window.showToast) window.showToast('已重置抽籤池', 'info');
        });
      }

      const btnStartDraw = document.getElementById('btn-start-floating-draw');
      if (btnStartDraw) {
        btnStartDraw.addEventListener('click', () => this.startFloatingDraw());
      }

      // 8. Instant scoring buttons on winner reveal
      document.querySelectorAll('.btn-winner-score').forEach(btn => {
        btn.addEventListener('click', async (e) => {
          const delta = parseInt(e.currentTarget.dataset.delta, 10) || 1;
          await this.awardScoreToCurrentWinner(delta, e.currentTarget);
        });
      });

      const btnCustomScore = document.getElementById('btn-winner-custom-score');
      if (btnCustomScore) {
        btnCustomScore.addEventListener('click', () => {
          this.openCustomScoreForWinner();
        });
      }

      // 9. Floating Timer Presets and buttons
      document.querySelectorAll('.btn-dock-timer-preset').forEach(btn => {
        btn.addEventListener('click', (e) => {
          const secs = parseInt(e.currentTarget.dataset.seconds, 10) || 180;
          TimerEngine.setCountdownSeconds(secs);
          TimerEngine.startCountdown();
          this.closeTimerPanel();
        });
      });

      const btnAdd30s = document.getElementById('btn-dock-timer-add30s');
      if (btnAdd30s) {
        btnAdd30s.addEventListener('click', () => TimerEngine.quickAddSeconds(30));
      }

      const btnAdd1m = document.getElementById('btn-dock-timer-add1m');
      if (btnAdd1m) {
        btnAdd1m.addEventListener('click', () => TimerEngine.quickAddSeconds(60));
      }

      const btnResetTimer = document.getElementById('btn-dock-timer-reset');
      if (btnResetTimer) {
        btnResetTimer.addEventListener('click', () => TimerEngine.resetCountdown());
      }

      const btnFullscreen = document.getElementById('btn-dock-timer-fullscreen');
      if (btnFullscreen) {
        btnFullscreen.addEventListener('click', () => {
          this.closeTimerPanel();
          TimerEngine.openFullscreen();
        });
      }

      // Close popover when clicking outside
      document.addEventListener('click', (e) => {
        const drawPanel = document.getElementById('floating-draw-panel');
        const timerPanel = document.getElementById('floating-timer-panel');
        const dock = document.getElementById('classroom-floating-dock');
        if (drawPanel && !drawPanel.contains(e.target) && !dock?.contains(e.target)) {
          drawPanel.style.display = 'none';
        }
        if (timerPanel && !timerPanel.contains(e.target) && !dock?.contains(e.target)) {
          timerPanel.style.display = 'none';
        }
      });

      this.updatePoolBadge();
    },

    toggleDrawPanel() {
      const panel = document.getElementById('floating-draw-panel');
      const timerPanel = document.getElementById('floating-timer-panel');
      if (timerPanel) timerPanel.style.display = 'none';
      if (!panel) return;
      const isVisible = panel.style.display !== 'none';
      panel.style.display = isVisible ? 'none' : 'block';
      if (!isVisible) {
        this.updatePoolBadge();
        if (!this.isRolling && !this.currentWinner) {
          this.resetDrawCard();
        }
      }
    },

    closeDrawPanel() {
      const panel = document.getElementById('floating-draw-panel');
      if (panel) panel.style.display = 'none';
    },

    toggleTimerPanel() {
      const panel = document.getElementById('floating-timer-panel');
      const drawPanel = document.getElementById('floating-draw-panel');
      if (drawPanel) drawPanel.style.display = 'none';
      if (!panel) return;
      panel.style.display = panel.style.display !== 'none' ? 'none' : 'block';
    },

    closeTimerPanel() {
      const panel = document.getElementById('floating-timer-panel');
      if (panel) panel.style.display = 'none';
    },

    closeAllPopovers() {
      this.closeDrawPanel();
      this.closeTimerPanel();
    },

    updatePoolBadge() {
      const badge = document.getElementById('floating-draw-pool-badge');
      if (!badge) return;
      const mode = document.getElementById('floating-draw-mode')?.value || 'student';
      const excludeDrawn = document.getElementById('floating-draw-exclude-drawn')?.checked ?? true;
      const students = window.AppState ? (window.AppState.students || []) : [];
      const groups = window.AppState ? (window.AppState.groups || []) : [];
      const isEn = window.I18n && window.I18n.getLanguage() === 'en';

      if (mode === 'group') {
        const count = groups.length;
        badge.textContent = isEn ? `Pool: ${count} groups` : `抽籤池：共 ${count} 組`;
        return;
      }

      const eligible = students.filter(s => !s.is_absent);
      const remaining = excludeDrawn ? eligible.filter(s => !this.drawnStudentIds.has(s.id)).length : eligible.length;
      badge.textContent = isEn ? `Pool: ${remaining} left` : `抽籤池：剩餘 ${remaining} 人`;
    },

    resetDrawCard() {
      this.currentWinner = null;
      const card = document.getElementById('floating-draw-card');
      const img = document.getElementById('floating-draw-avatar-img');
      const badge = document.getElementById('floating-draw-seat-badge');
      const name = document.getElementById('floating-draw-name-label');
      const actions = document.getElementById('floating-draw-winner-actions');
      const mode = document.getElementById('floating-draw-mode')?.value || 'student';
      const isEn = window.I18n && window.I18n.getLanguage() === 'en';

      if (card) {
        card.classList.remove('rolling', 'winner');
      }
      if (img) {
        img.src = mode === 'group' ? '/static/pic/animals/penguin.png' : '/static/avatars/boy.png';
      }
      if (badge) {
        badge.textContent = 'READY';
      }
      if (name) {
        name.textContent = isEn ? 'Ready to Draw' : '點擊開始抽籤';
      }
      if (actions) {
        actions.style.display = 'none';
      }
    },

    async startFloatingDraw() {
      if (this.isRolling) return;
      const mode = document.getElementById('floating-draw-mode')?.value || 'student';
      const excludeDrawn = document.getElementById('floating-draw-exclude-drawn')?.checked ?? true;
      const students = window.AppState ? (window.AppState.students || []) : [];
      const groups = window.AppState ? (window.AppState.groups || []) : [];

      let pool = [];
      if (mode === 'student') {
        pool = students.filter(s => !s.is_absent);
        if (excludeDrawn) {
          pool = pool.filter(s => !this.drawnStudentIds.has(s.id));
        }
        if (pool.length === 0) {
          if (students.filter(s => !s.is_absent).length > 0) {
            this.drawnStudentIds.clear();
            this.updatePoolBadge();
            pool = students.filter(s => !s.is_absent);
          } else {
            alert('名冊內無符合條件的學生');
            return;
          }
        }
      } else {
        pool = groups;
        if (pool.length === 0) {
          alert('目前尚未建立分組');
          return;
        }
      }

      this.isRolling = true;
      const card = document.getElementById('floating-draw-card');
      const actions = document.getElementById('floating-draw-winner-actions');

      if (card) {
        card.classList.remove('winner');
        card.classList.add('rolling');
      }
      if (actions) actions.style.display = 'none';

      // Pick winner
      const winnerIndex = Math.floor(Math.random() * pool.length);
      const winner = pool[winnerIndex];

      const durationMs = 1800;
      const startTime = performance.now();
      let lastShuffleTime = 0;

      const shuffleFrame = (now) => {
        const elapsed = now - startTime;
        const progress = Math.min(1, elapsed / durationMs);
        const interval = 50 + Math.pow(progress, 2) * 160;

        if (now - lastShuffleTime > interval && progress < 1) {
          lastShuffleTime = now;
          const randomItem = pool[Math.floor(Math.random() * pool.length)];
          this.renderDrawItem(randomItem, mode);
          if (AudioEngine && AudioEngine.playTick) {
            AudioEngine.playTick(progress < 0.7);
          }
        }

        if (progress < 1) {
          requestAnimationFrame(shuffleFrame);
        } else {
          // Reveal winner!
          this.isRolling = false;
          this.currentWinner = winner;
          this.currentWinnerMode = mode;
          if (mode === 'student') {
            this.drawnStudentIds.add(winner.id);
          }
          this.updatePoolBadge();

          this.renderDrawItem(winner, mode);
          if (card) {
            card.classList.remove('rolling');
            card.classList.add('winner');
          }
          if (actions) {
            actions.style.display = 'block';
            actions.querySelectorAll('.btn-winner-score').forEach(b => {
              const d = b.dataset.delta;
              b.textContent = `➕ +${d} 分`;
              b.style.background = '';
              b.disabled = false;
            });
          }

          if (AudioEngine) {
            if (AudioEngine.playVictory) AudioEngine.playVictory();
            else if (AudioEngine.playChime) AudioEngine.playChime();
          }
        }
      };

      requestAnimationFrame(shuffleFrame);
    },

    renderDrawItem(item, mode) {
      if (!item) return;
      const img = document.getElementById('floating-draw-avatar-img');
      const badge = document.getElementById('floating-draw-seat-badge');
      const name = document.getElementById('floating-draw-name-label');
      const isEn = window.I18n && window.I18n.getLanguage() === 'en';

      if (mode === 'student') {
        const displayName = window.getStudentDisplayName ? window.getStudentDisplayName(item) : (item.name || '');
        const numText = isEn ? `No. ${item.student_number}` : `${item.student_number}號`;
        if (badge) badge.textContent = numText;
        if (name) name.textContent = displayName;
        if (img) {
          const gender = item.gender || 'M';
          const isFemale = gender === 'female' || gender === 'F' || gender === '女';
          const fallback = isFemale ? '/static/avatars/girl.png' : '/static/avatars/boy.png';
          img.src = item.custom_avatar_url || (item.student_code ? `/photo/${item.student_code}.jpg` : fallback);
          img.onerror = () => { img.onerror = null; img.src = fallback; };
        }
      } else {
        const groupName = item.group_name || item.name || '小組';
        if (badge) badge.textContent = isEn ? 'GROUP' : '小組';
        if (name) name.textContent = groupName;
        if (img) {
          let icon = item.icon_url || item.group_icon_url || item.custom_icon_url;
          if (!icon && typeof window.getGroupAvatarSrc === 'function') {
            icon = window.getGroupAvatarSrc(item);
          }
          img.src = icon || '/static/pic/animals/penguin.png';
        }
      }
    },

    async awardScoreToCurrentWinner(delta, btnElement) {
      if (!this.currentWinner || !window.AppState || !window.AppState.currentCourseId) return;
      const winner = this.currentWinner;
      const mode = this.currentWinnerMode;
      const courseId = window.AppState.currentCourseId;

      if (btnElement) {
        btnElement.disabled = true;
        btnElement.textContent = '⏳ 加分中...';
      }

      try {
        if (mode === 'student') {
          const res = await API.post(`/api/scores/${courseId}/add`, {
            student_ids: [winner.id],
            rule_title: '抽籤表現加分',
            score: delta,
            category: 'positive'
          });

          winner.score = (winner.score || 0) + delta;
          if (window.prevStudentScoresMap) {
            window.prevStudentScoresMap[winner.id] = winner.score;
          }

          const toastMsg = window.I18n ? window.I18n.t('undo_toast_single', {
            name: `${winner.student_number}號 ${window.getStudentDisplayName ? window.getStudentDisplayName(winner) : winner.name}`,
            icon: '🎲',
            rule: '抽籤表現加分',
            score: `+${delta}`
          }) : `已為【${winner.student_number}號 ${winner.name}】抽籤表現 +${delta} 分！`;

          if (window.showUndoToast) window.showUndoToast(res.undo_id, toastMsg);
        } else {
          // Group
          const studentIds = (winner.students || []).map(s => s.id);
          const payload = {
            plan_id: winner.plan_id || window.AppState.activeGroupPlanId,
            group_id: winner.id,
            student_ids: studentIds,
            rule_title: '小組抽籤加分',
            score: delta,
            category: 'positive'
          };
          const res = await API.post(`/api/scores/${courseId}/add`, payload);
          if (window.showUndoToast) {
            window.showUndoToast(res.undo_id, `已為【${winner.group_name}】全員 +${delta} 分！`);
          }
        }

        if (btnElement) {
          btnElement.textContent = `✅ +${delta}分成功`;
          btnElement.style.background = 'linear-gradient(135deg, #10b981, #047857)';
        }

        // Live refresh background views (both roster grid and seating view)
        if (window.renderScoringView) window.renderScoringView();
        if (window.notifyScoreUpdates) window.notifyScoreUpdates();
        if (window.loadScoringData) window.loadScoringData();

      } catch (err) {
        alert(`評分失敗：${err.message}`);
        if (btnElement) {
          btnElement.disabled = false;
          btnElement.textContent = `➕ +${delta} 分`;
        }
      }
    },

    openCustomScoreForWinner() {
      if (!this.currentWinner || this.currentWinnerMode !== 'student') return;
      const winner = this.currentWinner;
      this.closeDrawPanel();

      if (window.AppState) {
        window.AppState.selectedStudentIds.clear();
        window.AppState.selectedStudentIds.add(winner.id);
        if (window.renderScoringView) window.renderScoringView();
        if (window.updateFloatingScoringDrawer) {
          window.lastClickCoords = { x: window.innerWidth - 380, y: window.innerHeight - 300 };
          window.updateFloatingScoringDrawer();
        }
      }
    }
  };

  // =========================================================================
  // 6. WordCloud (課堂即時文字雲 - 螺旋防重疊算法、詞頻統計與多色彩主題)
  // =========================================================================
  const WordCloud = {
    currentCourseId: null,
    currentSession: null,
    words: new Map(),
    totalWordsCount: 0,
    wordsList: [],
    spiralWords: [],
    colors: [
      '#38bdf8', '#818cf8', '#c084fc', '#f472b6', '#fb7185',
      '#34d399', '#fbbf24', '#f97316', '#a78bfa', '#22d3ee',
      '#4ade80', '#e879f9'
    ],

    getCourseId() {
      if (window.AppState && window.AppState.currentCourseId) {
        return Number(window.AppState.currentCourseId);
      }
      return this.currentCourseId;
    },

    init() {
      const btnStart = document.getElementById('btn-wordcloud-start');
      const btnStop = document.getElementById('btn-wordcloud-stop');
      const btnClear = document.getElementById('btn-wordcloud-clear');
      const btnExport = document.getElementById('btn-wordcloud-export');
      const btnFullscreen = document.getElementById('btn-wordcloud-fullscreen');
      const btnHistory = document.getElementById('btn-wordcloud-history');
      const btnCloseHistory = document.getElementById('btn-close-wordcloud-history');

      if (btnStart) btnStart.addEventListener('click', () => this.startSession());
      if (btnStop) btnStop.addEventListener('click', () => this.stopSession());
      if (btnClear) btnClear.addEventListener('click', () => this.clearWords());
      if (btnExport) btnExport.addEventListener('click', () => this.exportImage());
      if (btnFullscreen) btnFullscreen.addEventListener('click', () => this.toggleFullscreen());
      if (btnHistory) btnHistory.addEventListener('click', () => this.openHistory());
      if (btnCloseHistory) btnCloseHistory.addEventListener('click', () => {
        document.getElementById('modal-wordcloud-history')?.classList.remove('open');
      });

      window.addEventListener('resize', () => {
        if (this.words.size > 0) this.renderCloud();
      });
    },

    async loadCourse(courseId) {
      this.currentCourseId = Number(courseId);
      if (!this.currentCourseId) return;

      try {
        const res = await fetch(`/api/wordclouds/${this.currentCourseId}`);
        if (!res.ok) return;
        const sessions = await res.json();
        const active = sessions.find(s => s.status === 'active');
        if (active) {
          this.setSession(active);
        } else {
          this.resetUI();
        }
      } catch (err) {
        console.error('[WordCloud] loadCourse error:', err);
      }
    },

    setSession(session) {
      this.currentSession = session;
      const titleInput = document.getElementById('wordcloud-title-input');
      const badge = document.getElementById('wordcloud-status-badge');
      const btnStart = document.getElementById('btn-wordcloud-start');
      const btnStop = document.getElementById('btn-wordcloud-stop');
      const btnClear = document.getElementById('btn-wordcloud-clear');

      if (titleInput) titleInput.value = session.title || '';
      if (badge) {
        badge.textContent = session.status === 'active' ? '🟢 收集進行中' : '⚪ 已停止收集';
        badge.style.background = session.status === 'active' ? 'rgba(16, 185, 129, 0.2)' : 'rgba(148, 163, 184, 0.2)';
        badge.style.color = session.status === 'active' ? '#34d399' : '#cbd5e1';
      }

      if (btnStart) btnStart.style.display = session.status === 'active' ? 'none' : 'inline-flex';
      if (btnStop) btnStop.style.display = session.status === 'active' ? 'inline-flex' : 'none';
      if (btnClear) btnClear.style.display = 'inline-flex';

      this.words.clear();
      this.wordsList = Array.isArray(session.words) ? session.words : [];
      this.totalWordsCount = this.wordsList.length;

      this.wordsList.forEach(w => {
        const text = w.word;
        this.words.set(text, (this.words.get(text) || 0) + 1);
      });

      this.renderCloud();
      this.renderRanking();
    },

    resetUI() {
      this.currentSession = null;
      this.words.clear();
      this.wordsList = [];
      this.totalWordsCount = 0;

      const badge = document.getElementById('wordcloud-status-badge');
      const btnStart = document.getElementById('btn-wordcloud-start');
      const btnStop = document.getElementById('btn-wordcloud-stop');
      const btnClear = document.getElementById('btn-wordcloud-clear');

      if (badge) {
        badge.textContent = '未開始';
        badge.style.background = 'rgba(148, 163, 184, 0.2)';
        badge.style.color = '#cbd5e1';
      }
      if (btnStart) btnStart.style.display = 'inline-flex';
      if (btnStop) btnStop.style.display = 'none';
      if (btnClear) btnClear.style.display = 'none';

      const stage = document.getElementById('wordcloud-stage');
      const emptyHint = document.getElementById('wordcloud-empty-hint');
      const rankingList = document.getElementById('wordcloud-ranking-list');
      const statsCount = document.getElementById('wordcloud-stats-count');

      if (stage) stage.innerHTML = '';
      if (emptyHint) emptyHint.style.display = 'block';
      if (rankingList) rankingList.innerHTML = '<div style="color: #64748b; font-size: 0.85rem; text-align: center; padding: 20px 0;">暫無數據</div>';
      if (statsCount) statsCount.textContent = '共 0 詞';
    },

    async startSession() {
      const courseId = this.getCourseId();
      if (!courseId) {
        alert('請先選擇或載入班級！');
        return;
      }
      const titleInput = document.getElementById('wordcloud-title-input');
      const title = (titleInput?.value || '').trim();
      if (!title) {
        alert('請先輸入提示主題！');
        titleInput?.focus();
        return;
      }

      const allowDuplicate = document.getElementById('wordcloud-allow-duplicate')?.checked ? 1 : 0;
      const maxWords = Number(document.getElementById('wordcloud-max-words')?.value) || 3;

      try {
        const res = await fetch(`/api/wordclouds/${courseId}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            title,
            allow_duplicate: allowDuplicate,
            max_words_per_user: maxWords
          })
        });
        if (!res.ok) {
          const err = await res.json().catch(() => ({}));
          throw new Error(err.detail || '啟動文字雲失敗');
        }
        const session = await res.json();
        this.setSession(session);

        if (window.activeSocket) {
          window.activeSocket.emit('wordcloud:start', {
            sessionId: session.id,
            title: session.title,
            allowDuplicate: session.allow_duplicate,
            maxWordsPerUser: session.max_words_per_user
          });
        }
      } catch (err) {
        alert(err.message);
      }
    },

    async stopSession() {
      if (!this.currentSession) return;
      const courseId = this.getCourseId();
      try {
        const res = await fetch(`/api/wordclouds/${courseId}/${this.currentSession.id}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ status: 'closed' })
        });
        if (res.ok) {
          this.currentSession.status = 'closed';
          const badge = document.getElementById('wordcloud-status-badge');
          const btnStart = document.getElementById('btn-wordcloud-start');
          const btnStop = document.getElementById('btn-wordcloud-stop');
          if (badge) {
            badge.textContent = '⚪ 已停止收集';
            badge.style.background = 'rgba(148, 163, 184, 0.2)';
            badge.style.color = '#cbd5e1';
          }
          if (btnStart) btnStart.style.display = 'inline-flex';
          if (btnStop) btnStop.style.display = 'none';

          if (window.activeSocket) {
            window.activeSocket.emit('wordcloud:end', { sessionId: this.currentSession.id });
          }
        }
      } catch (err) {
        console.error('[WordCloud] stop error:', err);
      }
    },

    async clearWords() {
      if (!this.currentSession) return;
      if (!confirm('確定要清空當前文字雲的所有詞彙嗎？此動作無法復原。')) return;

      const courseId = this.getCourseId();
      try {
        const res = await fetch(`/api/wordclouds/${courseId}/${this.currentSession.id}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ clear_words: true })
        });
        if (res.ok) {
          this.words.clear();
          this.wordsList = [];
          this.totalWordsCount = 0;
          this.renderCloud();
          this.renderRanking();
        }
      } catch (err) {
        alert('清空失敗：' + err.message);
      }
    },

    onNewWord(payload) {
      if (!this.currentSession || this.currentSession.id !== payload.sessionId) {
        return;
      }
      const word = payload.word;
      this.words.set(word, (this.words.get(word) || 0) + 1);
      this.totalWordsCount++;

      AudioEngine?.playChime?.();

      this.renderCloud();
      this.renderRanking();
    },

    renderCloud() {
      const stage = document.getElementById('wordcloud-stage');
      const emptyHint = document.getElementById('wordcloud-empty-hint');
      const container = document.getElementById('wordcloud-canvas-container');
      if (!stage || !container) return;

      if (this.words.size === 0) {
        stage.innerHTML = '';
        if (emptyHint) emptyHint.style.display = 'block';
        return;
      }
      if (emptyHint) emptyHint.style.display = 'none';

      const width = container.clientWidth || 650;
      const height = container.clientHeight || 480;

      const entries = Array.from(this.words.entries()).sort((a, b) => b[1] - a[1]);
      const maxCount = entries[0]?.[1] || 1;

      const placedRects = [];
      const placedWords = [];

      entries.forEach(([word, count], idx) => {
        const rel = count / maxCount;
        const fontSize = Math.round(18 + rel * 46);
        const color = this.colors[Math.abs(word.charCodeAt(0) * 13 + (word.charCodeAt(1) || 7)) % this.colors.length];

        const estWidth = word.length * (fontSize * 0.95) + 16;
        const estHeight = fontSize * 1.3;

        let found = false;
        let x = 0, y = 0;

        if (idx === 0) {
          x = (width - estWidth) / 2;
          y = (height - estHeight) / 2;
          found = true;
        } else {
          let radius = Math.min(estWidth, estHeight) * 0.4 + 20;
          const maxRadius = Math.max(width, height);
          const angleOffset = (word.charCodeAt(0) * 23) % 360;

          while (!found && radius < maxRadius) {
            for (let a = 0; a < 360; a += 20) {
              const rad = ((angleOffset + a) * Math.PI) / 180;
              x = width / 2 + radius * Math.cos(rad) - estWidth / 2;
              y = height / 2 + radius * Math.sin(rad) - estHeight / 2;

              const pad = 6;
              const rect = {
                left: x - pad,
                top: y - pad,
                right: x + estWidth + pad,
                bottom: y + estHeight + pad,
              };

              if (rect.left > 10 && rect.top > 10 && rect.right < width - 10 && rect.bottom < height - 10) {
                const overlaps = placedRects.some(p => !(
                  rect.right < p.left ||
                  rect.left > p.right ||
                  rect.bottom < p.top ||
                  rect.top > p.bottom
                ));
                if (!overlaps) {
                  found = true;
                  break;
                }
              }
            }
            radius += 10;
          }
        }

        if (found) {
          placedRects.push({
            left: x,
            top: y,
            right: x + estWidth,
            bottom: y + estHeight,
          });
          placedWords.push({ word, count, x, y, fontSize, color, isTop: idx === 0 });
        }
      });

      this.spiralWords = placedWords;

      stage.innerHTML = placedWords.map(w => `
        <div class="wordcloud-item" style="
          position: absolute;
          left: ${Math.round(w.x)}px;
          top: ${Math.round(w.y)}px;
          font-size: ${w.fontSize}px;
          color: ${w.color};
          font-weight: 800;
          line-height: 1.2;
          text-shadow: 0 2px 10px rgba(0,0,0,0.6)${w.isTop ? ', 0 0 20px ' + w.color : ''};
          transition: all 0.3s cubic-bezier(0.16, 1, 0.3, 1);
          user-select: none;
          display: flex;
          align-items: center;
          gap: 6px;
        ">
          <span>${w.word}</span>
        </div>
      `).join('');
    },

    renderRanking() {
      const listEl = document.getElementById('wordcloud-ranking-list');
      const countEl = document.getElementById('wordcloud-stats-count');
      if (!listEl) return;

      const entries = Array.from(this.words.entries()).sort((a, b) => b[1] - a[1]);
      if (countEl) countEl.textContent = `共 ${entries.length} 詞（${this.totalWordsCount} 次提交）`;

      if (entries.length === 0) {
        listEl.innerHTML = '<div style="color: var(--text-muted, #64748b); font-size: 0.85rem; text-align: center; padding: 20px 0;">暫無數據</div>';
        return;
      }

      const maxCount = entries[0]?.[1] || 1;

      listEl.innerHTML = entries.map(([word, count], i) => {
        const rankBg = i === 0 ? '#f59e0b' : i === 1 ? '#94a3b8' : i === 2 ? '#b45309' : '#e2e8f0';
        const rankColor = i < 3 ? '#ffffff' : '#475569';
        // 語詞次數越多，大小越大（基礎 0.95rem 至最高 1.45rem）
        const ratio = maxCount > 1 ? (count - 1) / (maxCount - 1) : 0;
        const fontSize = (0.95 + ratio * 0.5).toFixed(2) + 'rem';

        return `
          <div title="${word}（${count} 次）" style="
            display: flex;
            align-items: center;
            gap: 10px;
            padding: 8px 12px;
            background: var(--bg-main, #f8fafc);
            border-radius: var(--radius-sm, 8px);
            border: 1px solid var(--card-border, #e2e8f0);
            box-shadow: 0 1px 2px rgba(0,0,0,0.03);
            transition: all 0.2s ease;
          ">
            <span style="
              flex-shrink: 0;
              font-weight: 800;
              font-size: 0.85rem;
              width: 22px;
              height: 22px;
              border-radius: 50%;
              display: flex;
              align-items: center;
              justify-content: center;
              background: ${rankBg};
              color: ${rankColor};
            ">
              ${i + 1}
            </span>
            <span style="
              font-weight: ${count > 1 ? 800 : 700};
              font-size: ${fontSize};
              color: var(--text-main, #1e293b);
              line-height: 1.25;
              word-break: break-word;
            ">
              ${word}
            </span>
          </div>
        `;
      }).join('');
    },

    exportImage() {
      const container = document.getElementById('wordcloud-canvas-container');
      if (!container || this.spiralWords.length === 0) {
        alert('目前無文字雲內容可匯出');
        return;
      }

      const canvas = document.createElement('canvas');
      const width = container.clientWidth || 800;
      const height = container.clientHeight || 600;
      canvas.width = width * 2;
      canvas.height = height * 2;
      const ctx = canvas.getContext('2d');
      if (!ctx) return;

      ctx.scale(2, 2);

      const bgGrad = ctx.createRadialGradient(width / 2, height / 2, 20, width / 2, height / 2, width / 2);
      bgGrad.addColorStop(0, '#1e293b');
      bgGrad.addColorStop(1, '#0f172a');
      ctx.fillStyle = bgGrad;
      ctx.fillRect(0, 0, width, height);

      ctx.fillStyle = '#94a3b8';
      ctx.font = 'bold 16px sans-serif';
      ctx.fillText(this.currentSession?.title || '課堂文字雲', 20, 32);

      this.spiralWords.forEach(w => {
        ctx.fillStyle = w.color;
        ctx.font = `800 ${w.fontSize}px "Segoe UI", "PingFang TC", "Microsoft JhengHei", sans-serif`;
        ctx.fillText(w.word, w.x, w.y + w.fontSize);
      });

      const link = document.createElement('a');
      link.download = `文字雲_${this.currentSession?.title || '紀錄'}_${Date.now()}.png`;
      link.href = canvas.toDataURL('image/png');
      link.click();
    },

    toggleFullscreen() {
      const elem = document.getElementById('wordcloud-canvas-container');
      if (!elem) return;
      if (!document.fullscreenElement) {
        elem.requestFullscreen().catch(() => {});
      } else {
        document.exitFullscreen().catch(() => {});
      }
    },

    async openHistory() {
      const courseId = this.getCourseId();
      if (!courseId) return;

      const modal = document.getElementById('modal-wordcloud-history');
      const listEl = document.getElementById('wordcloud-history-list');
      if (!modal || !listEl) return;

      modal.classList.add('open');
      listEl.innerHTML = '<div style="text-align: center; color: #94a3b8; padding: 20px 0;">載入中...</div>';

      try {
        const res = await fetch(`/api/wordclouds/${courseId}`);
        const sessions = await res.json();
        if (sessions.length === 0) {
          listEl.innerHTML = '<div style="text-align: center; color: #64748b; padding: 30px 0;">尚無歷史文字雲紀錄</div>';
          return;
        }

        listEl.innerHTML = sessions.map(s => `
          <div style="display: flex; align-items: center; justify-content: space-between; padding: 12px 16px; background: var(--bg-main, #f8fafc); border-radius: var(--radius-md); border: 1px solid var(--card-border);">
            <div>
              <div style="font-weight: 800; font-size: 1rem; color: var(--text-main, #1e293b);">${s.title}</div>
              <div style="font-size: 0.82rem; color: var(--text-muted, #64748b); margin-top: 4px;">
                狀態：${s.status === 'active' ? '🟢 進行中' : '⚪ 已關閉'} ｜ 總收集：${(s.words || []).length} 個詞 ｜ 時間：${s.created_at || ''}
              </div>
            </div>
            <div style="display: flex; gap: 8px;">
              <button type="button" class="btn btn-sm btn-primary" onclick="TeachingToolkit.wordCloud.loadSpecificSession(${s.id})">載入查看</button>
              <button type="button" class="btn btn-sm btn-secondary" style="color: #f87171;" onclick="TeachingToolkit.wordCloud.deleteSession(${s.id})">刪除</button>
            </div>
          </div>
        `).join('');
      } catch (err) {
        listEl.innerHTML = `<div style="color: #f87171; padding: 20px 0;">載入失敗：${err.message}</div>`;
      }
    },

    async loadSpecificSession(sessionId) {
      const courseId = this.getCourseId();
      try {
        const res = await fetch(`/api/wordclouds/${courseId}/${sessionId}`);
        if (res.ok) {
          const s = await res.json();
          this.setSession(s);
          document.getElementById('modal-wordcloud-history')?.classList.remove('open');
        }
      } catch (err) {
        alert(err.message);
      }
    },

    async deleteSession(sessionId) {
      if (!confirm('確定要刪除此歷史文字雲嗎？')) return;
      const courseId = this.getCourseId();
      try {
        const res = await fetch(`/api/wordclouds/${courseId}/${sessionId}`, { method: 'DELETE' });
        if (res.ok) {
          if (this.currentSession?.id === sessionId) {
            this.resetUI();
          }
          this.openHistory();
        }
      } catch (err) {
        alert(err.message);
      }
    }
  };

  // =========================================================================
  // 7. KahootGame (課堂答題競賽 - 個人與小組模式、實時競速計分與頒獎台)
  // =========================================================================
  const KahootGame = {
    currentCourseId: null,
    sets: [],
    selectedSet: null,
    questions: [],
    mode: 'individual',
    currentQIndex: 0,
    currentQuestion: null,
    phase: 'lobby',
    timeLeft: 20,
    timerHandle: null,
    answers: new Map(),
    scores: new Map(),
    groupScores: new Map(),
    importLmsQuizzes: [],
    importQuestionsDraft: [],
    importCsvQuestionsDraft: [],
    importTab: 'lms',
    importTargetMode: 'new',

    getCourseId() {
      if (window.AppState && window.AppState.currentCourseId) {
        return Number(window.AppState.currentCourseId);
      }
      return this.currentCourseId;
    },

    init() {
      document.getElementById('btn-kahoot-manage-sets')?.addEventListener('click', () => this.openManageModal());
      document.getElementById('btn-close-kahoot-manage')?.addEventListener('click', () => {
        document.getElementById('modal-kahoot-manage-sets')?.classList.remove('open');
      });
      document.getElementById('btn-close-kahoot-q-edit')?.addEventListener('click', () => {
        document.getElementById('modal-kahoot-edit-question')?.classList.remove('open');
      });

      document.getElementById('kahoot-set-select')?.addEventListener('change', (e) => {
        const setId = Number(e.target.value);
        this.selectSet(setId);
      });

      document.querySelectorAll('input[name="kahoot-mode"]').forEach(r => {
        r.addEventListener('change', (e) => {
          this.mode = e.target.value;
        });
      });

      document.getElementById('btn-kahoot-start-game')?.addEventListener('click', () => this.startGame());
      document.getElementById('btn-kahoot-reveal-answer')?.addEventListener('click', () => this.revealAnswer());
      document.getElementById('btn-kahoot-next-question')?.addEventListener('click', () => this.nextQuestion());
      document.getElementById('btn-kahoot-end-game')?.addEventListener('click', () => this.endGame());
      document.getElementById('btn-kahoot-award-points')?.addEventListener('click', () => this.awardPointsToBoard());
      document.getElementById('btn-kahoot-restart-lobby')?.addEventListener('click', () => this.returnToLobby());
      document.getElementById('btn-kahoot-fullscreen')?.addEventListener('click', () => {
        const elem = document.getElementById('kahoot-stage-container');
        if (!elem) return;
        if (!document.fullscreenElement) elem.requestFullscreen().catch(() => {});
        else document.exitFullscreen().catch(() => {});
      });

      document.getElementById('btn-kahoot-create-set')?.addEventListener('click', () => this.promptCreateSet());
      document.getElementById('btn-kahoot-add-question')?.addEventListener('click', () => this.openEditQuestionModal());
      document.getElementById('btn-kahoot-delete-set')?.addEventListener('click', () => this.deleteCurrentSet());
      document.getElementById('form-kahoot-question')?.addEventListener('submit', (e) => this.handleSaveQuestion(e));

      // 題庫匯入（LMS 線上測驗 / CSV 檔案）
      document.getElementById('btn-close-kahoot-import')?.addEventListener('click', () => {
        document.getElementById('modal-kahoot-import-quiz')?.classList.remove('open');
      });
      document.getElementById('btn-cancel-kahoot-import')?.addEventListener('click', () => {
        document.getElementById('modal-kahoot-import-quiz')?.classList.remove('open');
      });
      document.getElementById('btn-kahoot-import-set')?.addEventListener('click', () => this.openImportModal('new'));
      document.getElementById('btn-kahoot-import-to-current')?.addEventListener('click', () => this.openImportModal('append'));
      document.getElementById('tab-kahoot-import-lms')?.addEventListener('click', () => this.switchImportTab('lms'));
      document.getElementById('tab-kahoot-import-csv')?.addEventListener('click', () => this.switchImportTab('csv'));
      document.getElementById('select-kahoot-import-lms-quiz')?.addEventListener('change', (e) => this.onSelectImportLmsQuiz(e.target.value));
      document.getElementById('chk-kahoot-import-select-all')?.addEventListener('change', (e) => this.toggleSelectAllImportQuestions(e.target.checked));
      document.getElementById('input-kahoot-import-csv-file')?.addEventListener('change', (e) => this.handleImportCsvFile(e.target.files?.[0]));
      document.getElementById('btn-kahoot-download-csv-template')?.addEventListener('click', () => this.downloadImportCsvTemplate());
      document.getElementById('btn-confirm-kahoot-import')?.addEventListener('click', () => this.handleConfirmImport());
      document.querySelectorAll('input[name="kahoot-import-target-mode"]').forEach(r => {
        r.addEventListener('change', (e) => this.onImportTargetModeChange(e.target.value));
      });
    },

    async loadCourse(courseId) {
      this.currentCourseId = Number(courseId);
      if (!this.currentCourseId) return;

      try {
        const res = await fetch(`/api/quiz-sets/${this.currentCourseId}`);
        if (!res.ok) return;
        this.sets = await res.json();
        this.renderSetDropdown();
      } catch (err) {
        console.error('[KahootGame] loadCourse error:', err);
      }
    },

    renderSetDropdown() {
      const select = document.getElementById('kahoot-set-select');
      if (!select) return;
      if (this.sets.length === 0) {
        select.innerHTML = '<option value="">(尚未建立題庫)</option>';
        this.selectedSet = null;
        this.questions = [];
        return;
      }

      select.innerHTML = this.sets.map(s => `
        <option value="${s.id}">${s.title} (${s.question_count} 題)</option>
      `).join('');

      const firstId = this.sets[0].id;
      select.value = firstId;
      this.selectSet(firstId);
    },

    async selectSet(setId) {
      const idNum = Number(setId);
      this.selectedSet = this.sets.find(s => s.id === idNum) || null;
      if (!this.selectedSet) return;

      try {
        const res = await fetch(`/api/quiz-sets/${this.currentCourseId}/${setId}/questions`);
        if (res.ok) {
          this.questions = await res.json();
          const lobbyTitle = document.getElementById('kahoot-lobby-title');
          const lobbyDesc = document.getElementById('kahoot-lobby-desc');
          if (lobbyTitle) lobbyTitle.textContent = `準備開始：${this.selectedSet.title}`;
          if (lobbyDesc) lobbyDesc.textContent = `共 ${this.questions.length} 道題目。請選擇個人或小組競賽模式，點擊下方按鈕啟動！`;
        }
      } catch (err) {
        console.error('[KahootGame] selectSet error:', err);
      }
    },

    startGame() {
      if (!this.selectedSet || this.questions.length === 0) {
        alert('請先選擇包含題目的題庫，或至題庫管理中新增題目！');
        return;
      }

      this.currentQIndex = 0;
      this.scores.clear();
      this.groupScores.clear();
      this.startQuestion(0);
    },

    startQuestion(index) {
      if (index >= this.questions.length) {
        this.showPodium();
        return;
      }

      this.currentQIndex = index;
      this.currentQuestion = this.questions[index];
      this.phase = 'running';
      this.answers.clear();
      this.timeLeft = this.currentQuestion.time_limit_sec || 20;

      document.getElementById('kahoot-lobby-view').style.display = 'none';
      document.getElementById('kahoot-podium-view').style.display = 'none';
      const runningView = document.getElementById('kahoot-running-view');
      runningView.style.display = 'flex';

      document.getElementById('kahoot-q-badge').textContent = `第 ${index + 1} / ${this.questions.length} 題`;
      document.getElementById('kahoot-mode-badge').textContent = this.mode === 'group' ? '🚩 小組競賽模式' : '🧑 個人競賽模式';
      document.getElementById('kahoot-question-text').textContent = this.currentQuestion.prompt;
      document.getElementById('kahoot-timer-text').textContent = this.timeLeft;
      document.getElementById('kahoot-answered-count').textContent = '0';

      const totalStudentsCount = window.AppState?.students?.length || 0;
      document.getElementById('kahoot-total-students').textContent = `/ ${totalStudentsCount}`;

      const imgWrap = document.getElementById('kahoot-question-img-wrap');
      const imgEl = document.getElementById('kahoot-question-img');
      if (this.currentQuestion.image_url) {
        imgEl.src = this.currentQuestion.image_url;
        imgWrap.style.display = 'block';
      } else {
        imgWrap.style.display = 'none';
      }

      const options = this.currentQuestion.options || [];
      for (let i = 0; i < 4; i++) {
        const card = document.getElementById(`kahoot-opt-card-${i}`);
        const textEl = document.getElementById(`kahoot-opt-text-${i}`);
        const statEl = document.getElementById(`kahoot-opt-stat-${i}`);
        if (!card) continue;

        if (i < options.length) {
          card.style.display = 'flex';
          card.style.opacity = '1';
          card.style.border = 'none';
          card.style.boxShadow = 'none';
          textEl.textContent = options[i].text || `選項 ${['A','B','C','D'][i]}`;
          statEl.style.display = 'none';
          statEl.textContent = '0 票';
        } else {
          card.style.display = 'none';
        }
      }

      document.getElementById('kahoot-explanation-box').style.display = 'none';
      document.getElementById('btn-kahoot-reveal-answer').style.display = 'inline-flex';
      document.getElementById('btn-kahoot-next-question').style.display = 'none';

      if (window.activeSocket) {
        window.activeSocket.emit('kahoot:start_question', {
          quizSetId: this.selectedSet.id,
          questionId: this.currentQuestion.id,
          questionIndex: index + 1,
          totalQuestions: this.questions.length,
          mode: this.mode
        });
      }

      if (this.timerHandle) clearInterval(this.timerHandle);
      this.timerHandle = setInterval(() => {
        this.timeLeft--;
        const timerText = document.getElementById('kahoot-timer-text');
        if (timerText) timerText.textContent = Math.max(0, this.timeLeft);

        if (this.timeLeft <= 5 && this.timeLeft > 0) {
          AudioEngine?.playTick?.(false);
        }

        if (this.timeLeft <= 0) {
          clearInterval(this.timerHandle);
          this.timerHandle = null;
          this.revealAnswer();
        }
      }, 1000);
    },

    onStudentAnswered(payload) {
      if (this.phase !== 'running') return;
      this.answers.set(payload.studentId, payload);
      const countEl = document.getElementById('kahoot-answered-count');
      if (countEl) countEl.textContent = this.answers.size;

      AudioEngine?.playTick?.(true);

      const totalStudents = window.AppState?.students?.length || 0;
      if (totalStudents > 0 && this.answers.size >= totalStudents) {
        clearInterval(this.timerHandle);
        this.timerHandle = null;
        this.revealAnswer();
      }
    },

    revealAnswer() {
      if (this.phase === 'revealed') return;
      this.phase = 'revealed';
      if (this.timerHandle) {
        clearInterval(this.timerHandle);
        this.timerHandle = null;
      }

      const options = this.currentQuestion.options || [];
      const correctIdx = options.findIndex(o => o.isCorrect === true);

      if (window.activeSocket) {
        window.activeSocket.emit('kahoot:reveal_answer', {
          questionId: this.currentQuestion.id
        });
      }

      const counts = [0, 0, 0, 0];
      this.answers.forEach(ans => {
        if (ans.optionIndex >= 0 && ans.optionIndex < 4) {
          counts[ans.optionIndex]++;
        }

        const isCorrect = ans.optionIndex === correctIdx;
        if (isCorrect) {
          const ratio = Math.max(0, Math.min(1, (ans.timeMsRemaining || 0) / (this.currentQuestion.time_limit_sec * 1000)));
          const pts = Math.round((this.currentQuestion.points || 1000) * (0.5 + 0.5 * ratio));

          const currentStu = this.scores.get(ans.studentId) || {
            studentId: ans.studentId,
            studentName: ans.studentName,
            studentNumber: ans.studentNumber,
            groupId: ans.groupId,
            groupName: ans.groupName,
            totalScore: 0,
            correctCount: 0
          };
          currentStu.totalScore += pts;
          currentStu.correctCount++;
          this.scores.set(ans.studentId, currentStu);

          if (ans.groupId) {
            const currentGrp = this.groupScores.get(ans.groupId) || {
              groupId: ans.groupId,
              groupName: ans.groupName || `第 ${ans.groupId} 組`,
              totalScore: 0,
              memberCount: 0
            };
            currentGrp.totalScore += pts;
            this.groupScores.set(ans.groupId, currentGrp);
          }
        }
      });

      for (let i = 0; i < 4; i++) {
        const card = document.getElementById(`kahoot-opt-card-${i}`);
        const statEl = document.getElementById(`kahoot-opt-stat-${i}`);
        if (!card) continue;

        if (statEl) {
          statEl.textContent = `${counts[i]} 人選`;
          statEl.style.display = 'inline-block';
        }

        if (i === correctIdx) {
          card.style.opacity = '1';
          card.style.border = '4px solid #facc15';
          card.style.boxShadow = '0 0 25px rgba(250, 204, 21, 0.6)';
        } else {
          card.style.opacity = '0.35';
        }
      }

      AudioEngine?.playVictory?.();

      const explanation = this.currentQuestion.explanation;
      const expBox = document.getElementById('kahoot-explanation-box');
      const expText = document.getElementById('kahoot-explanation-text');
      if (expBox && expText) {
        if (explanation) {
          expText.textContent = explanation;
          expBox.style.display = 'block';
        } else {
          expBox.style.display = 'none';
        }
      }

      document.getElementById('btn-kahoot-reveal-answer').style.display = 'none';
      const nextBtn = document.getElementById('btn-kahoot-next-question');
      if (nextBtn) {
        nextBtn.style.display = 'inline-flex';
        nextBtn.textContent = (this.currentQIndex + 1 < this.questions.length) ? '➡️ 下一題' : '🏆 查看頒獎台';
      }
    },

    nextQuestion() {
      if (this.currentQIndex + 1 < this.questions.length) {
        this.startQuestion(this.currentQIndex + 1);
      } else {
        this.showPodium();
      }
    },

    showPodium() {
      this.phase = 'podium';
      document.getElementById('kahoot-running-view').style.display = 'none';
      const podiumView = document.getElementById('kahoot-podium-view');
      podiumView.style.display = 'flex';

      AudioEngine?.playApplause?.();

      let leaderboard = [];
      if (this.mode === 'group') {
        leaderboard = Array.from(this.groupScores.values())
          .sort((a, b) => b.totalScore - a.totalScore)
          .map(g => ({
            id: g.groupId,
            name: g.groupName,
            score: g.totalScore,
            isGroup: true
          }));
      } else {
        leaderboard = Array.from(this.scores.values())
          .sort((a, b) => b.totalScore - a.totalScore)
          .map(s => ({
            id: s.studentId,
            name: `${s.studentNumber ? s.studentNumber + '號 ' : ''}${s.studentName}`,
            score: s.totalScore,
            groupId: s.groupId,
            isGroup: false
          }));
      }

      const p1 = leaderboard[0];
      const p2 = leaderboard[1];
      const p3 = leaderboard[2];

      document.getElementById('podium-name-1').textContent = p1 ? p1.name : '（從缺）';
      document.getElementById('podium-score-1').textContent = p1 ? `${p1.score} 分` : '0 分';

      document.getElementById('podium-name-2').textContent = p2 ? p2.name : '（從缺）';
      document.getElementById('podium-score-2').textContent = p2 ? `${p2.score} 分` : '0 分';

      document.getElementById('podium-name-3').textContent = p3 ? p3.name : '（從缺）';
      document.getElementById('podium-score-3').textContent = p3 ? `${p3.score} 分` : '0 分';

      const moreList = document.getElementById('podium-more-list');
      if (moreList) {
        const others = leaderboard.slice(3, 10);
        if (others.length === 0) {
          moreList.innerHTML = '';
        } else {
          moreList.innerHTML = others.map((item, idx) => `
            <div style="display: flex; align-items: center; justify-content: space-between; padding: 6px 14px; background: rgba(255,255,255,0.06); border-radius: 6px; font-size: 0.95rem;">
              <span style="font-weight: 700; color: #cbd5e1;">第 ${idx + 4} 名：${item.name}</span>
              <span style="font-weight: 800; color: #93c5fd;">${item.score} 分</span>
            </div>
          `).join('');
        }
      }

      if (window.activeSocket) {
        window.activeSocket.emit('kahoot:finished', {
          quizSetId: this.selectedSet?.id,
          leaderboard
        });
      }
    },

    async awardPointsToBoard() {
      const courseId = this.getCourseId();
      if (!courseId) return;

      const rewards = [];
      if (this.mode === 'group') {
        const grpList = Array.from(this.groupScores.values()).sort((a, b) => b.totalScore - a.totalScore);
        const topBonuses = [3, 2, 1];

        grpList.slice(0, 3).forEach((g, idx) => {
          const bonus = topBonuses[idx] || 1;
          const members = (window.AppState?.students || []).filter(s => s.groupId === g.groupId);
          members.forEach(m => {
            rewards.push({
              studentId: m.id,
              score: bonus,
              reason: `答題競賽小組優勝【${g.groupName}】第 ${idx + 1} 名`,
              groupId: g.groupId
            });
          });
        });
      } else {
        const stuList = Array.from(this.scores.values()).sort((a, b) => b.totalScore - a.totalScore);
        const topBonuses = [3, 2, 1];

        stuList.slice(0, 3).forEach((s, idx) => {
          rewards.push({
            studentId: s.studentId,
            score: topBonuses[idx] || 1,
            reason: `答題競賽個人優勝第 ${idx + 1} 名`,
            groupId: s.groupId
          });
        });
      }

      if (rewards.length === 0) {
        alert('尚無可發放獎勵的名單！');
        return;
      }

      if (!confirm(`確定要為優勝名單（共 ${rewards.length} 人次）發放系統獎勵加分嗎？`)) {
        return;
      }

      try {
        const res = await fetch(`/api/quiz-sets/${courseId}/award-scores`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ rewards })
        });
        if (!res.ok) throw new Error('發放加分失敗');
        const data = await res.json();
        alert(`🎉 ${data.message}！`);

        if (window.renderScoringView) window.renderScoringView();
        if (window.notifyScoreUpdates) window.notifyScoreUpdates();
      } catch (err) {
        alert('加分失敗：' + err.message);
      }
    },

    returnToLobby() {
      this.phase = 'lobby';
      document.getElementById('kahoot-podium-view').style.display = 'none';
      document.getElementById('kahoot-running-view').style.display = 'none';
      document.getElementById('kahoot-lobby-view').style.display = 'block';
    },

    endGame() {
      if (confirm('確定要提前結束本次測驗嗎？')) {
        this.showPodium();
      }
    },

    openManageModal() {
      const modal = document.getElementById('modal-kahoot-manage-sets');
      if (!modal) return;
      modal.classList.add('open');
      this.renderManageModal();
    },

    renderManageModal() {
      const setsListEl = document.getElementById('kahoot-sets-list');
      if (!setsListEl) return;

      if (this.sets.length === 0) {
        setsListEl.innerHTML = '<div style="color: var(--text-muted, #64748b); font-size: 0.85rem; padding: 12px 0;">暫無題庫</div>';
        this.renderManageQuestions(null);
        return;
      }

      setsListEl.innerHTML = this.sets.map(s => {
        const isSelected = this.selectedSet?.id === s.id;
        return `
          <div class="kahoot-manage-set-item ${isSelected ? 'active' : ''}" onclick="TeachingToolkit.kahoot.manageSelectSet(${s.id})" style="
            padding: 10px 12px;
            border-radius: var(--radius-sm);
            cursor: pointer;
            background: ${isSelected ? 'rgba(59, 130, 246, 0.12)' : 'var(--bg-main, #f8fafc)'};
            border: 1px solid ${isSelected ? 'rgba(59, 130, 246, 0.45)' : 'var(--card-border, #e2e8f0)'};
            transition: all 0.15s ease;
          ">
            <div style="font-weight: 800; font-size: 0.95rem; color: ${isSelected ? 'var(--primary-dark, #1d4ed8)' : 'var(--text-main, #1e293b)'};">${s.title}</div>
            <div style="font-size: 0.8rem; color: ${isSelected ? 'var(--primary, #2563eb)' : 'var(--text-muted, #64748b)'}; margin-top: 3px; font-weight: 600;">共 ${s.question_count} 題</div>
          </div>
        `;
      }).join('');

      this.renderManageQuestions(this.selectedSet || this.sets[0]);
    },

    manageSelectSet(setId) {
      this.selectSet(setId).then(() => {
        this.renderManageModal();
      });
    },

    renderManageQuestions(set) {
      const titleEl = document.getElementById('kahoot-selected-set-title');
      const countEl = document.getElementById('kahoot-selected-set-count');
      const addQBtn = document.getElementById('btn-kahoot-add-question');
      const delSetBtn = document.getElementById('btn-kahoot-delete-set');
      const qListEl = document.getElementById('kahoot-questions-list');

      const importToCurrentBtn = document.getElementById('btn-kahoot-import-to-current');
      if (!set) {
        if (titleEl) titleEl.textContent = '請先選擇題庫';
        if (countEl) countEl.textContent = '';
        if (addQBtn) addQBtn.style.display = 'none';
        if (delSetBtn) delSetBtn.style.display = 'none';
        if (importToCurrentBtn) importToCurrentBtn.style.display = 'none';
        if (qListEl) qListEl.innerHTML = '<div style="color: var(--text-muted, #64748b); font-size: 0.9rem; text-align: center; padding: 40px 0;">請由左側點選或新增題庫</div>';
        return;
      }

      if (titleEl) titleEl.textContent = set.title;
      if (countEl) countEl.textContent = `(共 ${this.questions.length} 題)`;
      if (addQBtn) addQBtn.style.display = 'inline-flex';
      if (delSetBtn) delSetBtn.style.display = 'inline-flex';
      if (importToCurrentBtn) importToCurrentBtn.style.display = 'inline-flex';

      if (this.questions.length === 0) {
        qListEl.innerHTML = '<div style="color: var(--text-muted, #64748b); font-size: 0.9rem; text-align: center; padding: 40px 0;">題庫內尚無題目，請點擊「➕ 新增題目」</div>';
        return;
      }

      qListEl.innerHTML = this.questions.map((q, idx) => {
        const opts = q.options || [];
        return `
          <div style="padding: 14px 16px; background: var(--bg-main, #f8fafc); border-radius: var(--radius-md); border: 1px solid var(--card-border, #e2e8f0); box-shadow: 0 1px 3px rgba(0,0,0,0.03);">
            <div style="display: flex; align-items: flex-start; justify-content: space-between; gap: 10px;">
              <div style="font-weight: 800; font-size: 1rem; color: var(--text-main, #1e293b); line-height: 1.4;">
                <span style="color: var(--primary, #2563eb); font-weight: 900; margin-right: 6px;">Q${idx + 1}.</span>${q.prompt}
              </div>
              <div style="display: flex; gap: 6px; flex-shrink: 0;">
                <button type="button" class="btn btn-sm btn-secondary" onclick="TeachingToolkit.kahoot.openEditQuestionModal(${q.id})" title="編輯題目">✏️</button>
                <button type="button" class="btn btn-sm btn-secondary" style="color: #ef4444;" onclick="TeachingToolkit.kahoot.deleteQuestion(${q.id})" title="刪除題目">🗑️</button>
              </div>
            </div>
            <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 8px; margin-top: 10px; font-size: 0.88rem;">
              ${opts.map((o, oi) => `
                <div style="
                  color: ${o.isCorrect ? '#15803d' : 'var(--text-main, #334155)'};
                  font-weight: ${o.isCorrect ? '800' : '600'};
                  background: ${o.isCorrect ? '#ecfdf5' : 'rgba(0,0,0,0.02)'};
                  border: 1px solid ${o.isCorrect ? '#a7f3d0' : 'transparent'};
                  padding: 4px 8px;
                  border-radius: 6px;
                ">
                  <span style="font-weight: 800; color: ${o.isCorrect ? '#16a34a' : 'var(--text-muted, #64748b)'}; margin-right: 4px;">${['A','B','C','D'][oi]}.</span>
                  <span>${o.text}</span>
                  ${o.isCorrect ? '<span style="margin-left: 4px; font-size: 0.82rem;">✓ (正解)</span>' : ''}
                </div>
              `).join('')}
            </div>
            <div style="font-size: 0.8rem; color: var(--text-muted, #64748b); margin-top: 8px; font-weight: 600; display: flex; align-items: center; gap: 6px;">
              <span>⏱️ ${q.time_limit_sec} 秒</span>
              <span>｜</span>
              <span>🌟 ${q.points} 分</span>
              ${q.explanation ? `<span>｜</span><span style="color: #d97706;">💡 解析：${q.explanation}</span>` : ''}
            </div>
          </div>
        `;
      }).join('');
    },

    async promptCreateSet() {
      const title = prompt('請輸入新題庫名稱（例如：第四單元自然科學競賽）：');
      if (!title || !title.trim()) return;

      const courseId = this.getCourseId();
      try {
        const res = await fetch(`/api/quiz-sets/${courseId}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ title: title.trim() })
        });
        if (res.ok) {
          const newSet = await res.json();
          this.sets.unshift(newSet);
          this.renderSetDropdown();
          this.selectSet(newSet.id).then(() => {
            this.renderManageModal();
          });
        }
      } catch (err) {
        alert(err.message);
      }
    },

    async deleteCurrentSet() {
      if (!this.selectedSet) return;
      if (!confirm(`確定要刪除題庫【${this.selectedSet.title}】及其所有題目嗎？`)) return;

      const courseId = this.getCourseId();
      try {
        const res = await fetch(`/api/quiz-sets/${courseId}/${this.selectedSet.id}`, { method: 'DELETE' });
        if (res.ok) {
          this.sets = this.sets.filter(s => s.id !== this.selectedSet.id);
          this.selectedSet = this.sets[0] || null;
          this.renderSetDropdown();
          this.renderManageModal();
        }
      } catch (err) {
        alert(err.message);
      }
    },

    openEditQuestionModal(qId = null) {
      const modal = document.getElementById('modal-kahoot-edit-question');
      if (!modal) return;

      const idInput = document.getElementById('kahoot-edit-q-id');
      const promptInput = document.getElementById('kahoot-edit-q-prompt');
      const timeInput = document.getElementById('kahoot-edit-q-timelimit');
      const pointsInput = document.getElementById('kahoot-edit-q-points');
      const expInput = document.getElementById('kahoot-edit-q-explanation');

      if (qId) {
        const q = this.questions.find(item => item.id === qId);
        if (!q) return;
        document.getElementById('modal-kahoot-q-title').textContent = '✏️ 編輯測驗題目';
        idInput.value = q.id;
        promptInput.value = q.prompt;
        timeInput.value = q.time_limit_sec;
        pointsInput.value = q.points;
        expInput.value = q.explanation || '';

        const opts = q.options || [];
        opts.forEach((o, i) => {
          const optInput = document.getElementById(`kahoot-opt-input-${i}`);
          if (optInput) optInput.value = o.text || '';
          if (o.isCorrect) {
            const rad = document.querySelector(`input[name="kahoot-correct-opt"][value="${i}"]`);
            if (rad) rad.checked = true;
          }
        });
      } else {
        document.getElementById('modal-kahoot-q-title').textContent = '➕ 新增測驗題目';
        idInput.value = '';
        promptInput.value = '';
        timeInput.value = '20';
        pointsInput.value = '1000';
        expInput.value = '';
        for (let i = 0; i < 4; i++) {
          const optInput = document.getElementById(`kahoot-opt-input-${i}`);
          if (optInput) optInput.value = '';
        }
        const rad0 = document.querySelector('input[name="kahoot-correct-opt"][value="0"]');
        if (rad0) rad0.checked = true;
      }

      modal.classList.add('open');
    },

    async handleSaveQuestion(e) {
      e.preventDefault();
      if (!this.selectedSet) return;

      const courseId = this.getCourseId();
      const qId = document.getElementById('kahoot-edit-q-id').value;
      const prompt = document.getElementById('kahoot-edit-q-prompt').value.trim();
      const timeLimitSec = Number(document.getElementById('kahoot-edit-q-timelimit').value) || 20;
      const points = Number(document.getElementById('kahoot-edit-q-points').value) || 1000;
      const explanation = document.getElementById('kahoot-edit-q-explanation').value.trim();
      const correctIdx = Number(document.querySelector('input[name="kahoot-correct-opt"]:checked')?.value || 0);

      const options = [];
      for (let i = 0; i < 4; i++) {
        const text = (document.getElementById(`kahoot-opt-input-${i}`)?.value || '').trim();
        if (text) {
          options.push({
            id: ['A', 'B', 'C', 'D'][i],
            text,
            isCorrect: i === correctIdx
          });
        }
      }

      if (options.length < 2) {
        alert('請至少填寫 2 個選項！');
        return;
      }

      const body = {
        prompt,
        options,
        time_limit_sec: timeLimitSec,
        points,
        explanation
      };

      try {
        let res;
        if (qId) {
          res = await fetch(`/api/quiz-sets/${courseId}/${this.selectedSet.id}/questions/${qId}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body)
          });
        } else {
          res = await fetch(`/api/quiz-sets/${courseId}/${this.selectedSet.id}/questions`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body)
          });
        }

        if (res.ok) {
          document.getElementById('modal-kahoot-edit-question')?.classList.remove('open');
          await this.selectSet(this.selectedSet.id);
          this.renderManageQuestions(this.selectedSet);
        }
      } catch (err) {
        alert('儲存失敗：' + err.message);
      }
    },

    async deleteQuestion(qId) {
      if (!confirm('確定要刪除這道題目嗎？')) return;
      const courseId = this.getCourseId();
      try {
        const res = await fetch(`/api/quiz-sets/${courseId}/${this.selectedSet.id}/questions/${qId}`, { method: 'DELETE' });
        if (res.ok) {
          await this.selectSet(this.selectedSet.id);
          this.renderManageQuestions(this.selectedSet);
        }
      } catch (err) {
        alert(err.message);
      }
    },

    // --- 題庫匯入相關方法（調用 LMS 線上測驗是非題/選擇題、CSV 檔案） ---
    async openImportModal(defaultMode = 'new') {
      const modal = document.getElementById('modal-kahoot-import-quiz');
      if (!modal) return;

      this.importTab = 'lms';
      this.switchImportTab('lms');

      const appendRadio = document.querySelector('input[name="kahoot-import-target-mode"][value="append"]');
      const newRadio = document.querySelector('input[name="kahoot-import-target-mode"][value="new"]');
      const appendLabel = document.getElementById('kahoot-import-target-append-label');
      const appendText = document.getElementById('kahoot-import-target-append-text');
      const titleInput = document.getElementById('input-kahoot-import-set-title');
      const titleWrap = document.getElementById('kahoot-import-new-title-wrap');

      if (this.selectedSet) {
        if (appendLabel) appendLabel.style.display = 'inline-flex';
        if (appendText) appendText.textContent = `匯入至當前題庫「${this.selectedSet.title}」`;
        if (defaultMode === 'append') {
          if (appendRadio) appendRadio.checked = true;
          this.importTargetMode = 'append';
          if (titleWrap) titleWrap.style.display = 'none';
        } else {
          if (newRadio) newRadio.checked = true;
          this.importTargetMode = 'new';
          if (titleWrap) titleWrap.style.display = 'flex';
        }
      } else {
        if (appendLabel) appendLabel.style.display = 'none';
        if (newRadio) newRadio.checked = true;
        this.importTargetMode = 'new';
        if (titleWrap) titleWrap.style.display = 'flex';
      }

      modal.classList.add('open');
      await this.loadLmsQuizzesForImport();
    },

    onImportTargetModeChange(mode) {
      this.importTargetMode = mode;
      const titleWrap = document.getElementById('kahoot-import-new-title-wrap');
      if (titleWrap) {
        titleWrap.style.display = mode === 'new' ? 'flex' : 'none';
      }
    },

    switchImportTab(tab) {
      this.importTab = tab;
      const tabLms = document.getElementById('tab-kahoot-import-lms');
      const tabCsv = document.getElementById('tab-kahoot-import-csv');
      const paneLms = document.getElementById('pane-kahoot-import-lms');
      const paneCsv = document.getElementById('pane-kahoot-import-csv');

      if (tab === 'lms') {
        tabLms?.classList.replace('btn-secondary', 'btn-primary');
        tabCsv?.classList.replace('btn-primary', 'btn-secondary');
        if (paneLms) paneLms.style.display = 'flex';
        if (paneCsv) paneCsv.style.display = 'none';
      } else {
        tabCsv?.classList.replace('btn-secondary', 'btn-primary');
        tabLms?.classList.replace('btn-primary', 'btn-secondary');
        if (paneCsv) paneCsv.style.display = 'flex';
        if (paneLms) paneLms.style.display = 'none';
      }
      this.updateImportCounts();
    },

    async loadLmsQuizzesForImport() {
      const select = document.getElementById('select-kahoot-import-lms-quiz');
      const preview = document.getElementById('kahoot-import-questions-preview');
      if (!select) return;

      select.innerHTML = '<option value="">載入 LMS 線上測驗中...</option>';
      const courseId = this.getCourseId();
      if (!courseId) return;

      try {
        const res = await fetch(`/api/quiz-sets/${courseId}/lms-quizzes`);
        if (!res.ok) throw new Error('讀取 LMS 測驗失敗');
        this.importLmsQuizzes = await res.json();

        if (this.importLmsQuizzes.length === 0) {
          select.innerHTML = '<option value="">此課程尚未建立任何 LMS 線上測驗</option>';
          if (preview) preview.innerHTML = '<div style="color: var(--text-muted, #64748b); text-align: center; padding: 30px 0;">此課程尚未建立任何 LMS 線上測驗，請至「學習內容 (LMS)」建立測驗或由 CSV 檔案匯入。</div>';
          this.importQuestionsDraft = [];
          this.updateImportCounts();
          return;
        }

        select.innerHTML = this.importLmsQuizzes.map((q, idx) => `
          <option value="${idx}">【${q.unit_title}】${q.quiz_title} (${q.question_count} 題)</option>
        `).join('');

        const firstWithQ = this.importLmsQuizzes.findIndex(q => q.question_count > 0);
        const selIdx = firstWithQ >= 0 ? firstWithQ : 0;
        select.value = String(selIdx);
        this.onSelectImportLmsQuiz(selIdx);
      } catch (err) {
        select.innerHTML = `<option value="">載入失敗：${err.message}</option>`;
        if (preview) preview.innerHTML = `<div style="color: #ef4444; text-align: center; padding: 20px 0;">載入失敗：${err.message}</div>`;
      }
    },

    onSelectImportLmsQuiz(idxStr) {
      const idx = Number(idxStr);
      const quiz = this.importLmsQuizzes[idx];
      const titleInput = document.getElementById('input-kahoot-import-set-title');
      if (titleInput && quiz && !titleInput.value) {
        titleInput.value = `${quiz.quiz_title}（競賽題庫）`;
      }

      if (!quiz || !quiz.questions || quiz.questions.length === 0) {
        this.importQuestionsDraft = [];
        this.renderImportPreview([], 'lms');
        return;
      }

      this.importQuestionsDraft = quiz.questions.map((q, qi) => {
        const isTrueFalse = q.type === 'true_false';
        let options = [];
        if (isTrueFalse) {
          const ca = String(q.correct_answer || '').toLowerCase();
          const isTrue = ca === 'true' || ca === '1' || ca === 'o' || ca === '正確' || ca === '是';
          options = [
            { id: 'A', text: '⭕ 正確', isCorrect: isTrue },
            { id: 'B', text: '❌ 錯誤', isCorrect: !isTrue },
          ];
        } else {
          const rawOpts = Array.isArray(q.options) ? q.options : [];
          const correctAns = String(q.correct_answer ?? '').trim();
          options = rawOpts.map((optText, oi) => {
            const str = String(optText).trim();
            const isMatch = correctAns === String(oi) || correctAns === str;
            return {
              id: ['A', 'B', 'C', 'D'][oi] || String(oi + 1),
              text: str,
              isCorrect: isMatch,
            };
          });
          if (!options.some(o => o.isCorrect)) {
            const num = parseInt(correctAns, 10);
            if (!isNaN(num) && num >= 1 && num <= options.length) {
              options[num - 1].isCorrect = true;
            } else if (options.length > 0) {
              options[0].isCorrect = true;
            }
          }
        }

        return {
          _selected: true,
          type: isTrueFalse ? 'true_false' : 'single',
          typeLabel: isTrueFalse ? '是非題' : '選擇題',
          prompt: q.question_text || q.prompt || `第 ${qi + 1} 題`,
          options,
          time_limit_sec: 20,
          points: 1000,
          explanation: q.explanation || '',
        };
      });

      this.renderImportPreview(this.importQuestionsDraft, 'lms');
    },

    renderImportPreview(questions, source = 'lms') {
      const containerId = source === 'lms' ? 'kahoot-import-questions-preview' : 'kahoot-import-csv-preview';
      const container = document.getElementById(containerId);
      if (!container) return;

      if (!questions || questions.length === 0) {
        container.innerHTML = '<div style="color: var(--text-muted, #64748b); text-align: center; padding: 30px 0;">此測驗內無題目</div>';
        this.updateImportCounts();
        return;
      }

      container.innerHTML = questions.map((q, idx) => `
        <div style="padding: 10px 12px; background: var(--bg-main, #f8fafc); border-radius: var(--radius-sm); border: 1px solid var(--card-border, #e2e8f0); display: flex; align-items: flex-start; gap: 10px;">
          <input type="checkbox" class="kahoot-import-q-chk" data-idx="${idx}" ${q._selected ? 'checked' : ''} style="cursor: pointer; margin-top: 4px; width: 16px; height: 16px;">
          <div style="flex: 1;">
            <div style="display: flex; align-items: center; gap: 8px; margin-bottom: 4px; flex-wrap: wrap;">
              <span style="font-weight: 800; font-size: 0.8rem; background: ${q.type === 'true_false' ? 'rgba(168, 85, 247, 0.15)' : 'rgba(59, 130, 246, 0.15)'}; color: ${q.type === 'true_false' ? '#9333ea' : '#2563eb'}; padding: 1px 8px; border-radius: 4px;">
                ${q.typeLabel || (q.type === 'true_false' ? '是非題' : '選擇題')}
              </span>
              <span style="font-weight: 800; font-size: 0.92rem; color: var(--text-main, #1e293b);">
                Q${idx + 1}. ${q.prompt}
              </span>
            </div>
            <div style="display: flex; flex-wrap: wrap; gap: 6px; font-size: 0.82rem; margin-top: 6px;">
              ${(q.options || []).map(o => `
                <span style="
                  padding: 2px 8px;
                  border-radius: 4px;
                  background: ${o.isCorrect ? '#ecfdf5' : 'rgba(0,0,0,0.03)'};
                  color: ${o.isCorrect ? '#15803d' : 'var(--text-main, #475569)'};
                  font-weight: ${o.isCorrect ? '800' : '500'};
                  border: 1px solid ${o.isCorrect ? '#a7f3d0' : 'transparent'};
                ">
                  ${o.id}. ${o.text} ${o.isCorrect ? '✓' : ''}
                </span>
              `).join('')}
            </div>
          </div>
        </div>
      `).join('');

      container.querySelectorAll('.kahoot-import-q-chk').forEach(chk => {
        chk.addEventListener('change', (e) => {
          const i = Number(e.target.dataset.idx);
          if (questions[i]) questions[i]._selected = e.target.checked;
          this.updateImportCounts();
        });
      });

      this.updateImportCounts();
    },

    toggleSelectAllImportQuestions(checked) {
      const questions = this.importTab === 'lms' ? this.importQuestionsDraft : this.importCsvQuestionsDraft;
      (questions || []).forEach(q => { q._selected = checked; });
      const containerId = this.importTab === 'lms' ? 'kahoot-import-questions-preview' : 'kahoot-import-csv-preview';
      document.querySelectorAll(`#${containerId} .kahoot-import-q-chk`).forEach(chk => {
        chk.checked = checked;
      });
      this.updateImportCounts();
    },

    updateImportCounts() {
      const questions = this.importTab === 'lms' ? this.importQuestionsDraft : this.importCsvQuestionsDraft;
      const total = (questions || []).length;
      const selected = (questions || []).filter(q => q._selected).length;

      const selCountEl = document.getElementById('kahoot-import-selected-count');
      const totalCountEl = document.getElementById('kahoot-import-total-count');
      const confirmBtn = document.getElementById('btn-confirm-kahoot-import');
      const selectAllChk = document.getElementById('chk-kahoot-import-select-all');

      if (selCountEl) selCountEl.textContent = selected;
      if (totalCountEl) totalCountEl.textContent = total;
      if (selectAllChk) selectAllChk.checked = total > 0 && selected === total;

      if (confirmBtn) {
        confirmBtn.disabled = selected === 0;
        confirmBtn.textContent = `📥 確認匯入 (${selected} 題)`;
      }
    },

    handleImportCsvFile(file) {
      if (!file) return;
      const filenameEl = document.getElementById('kahoot-import-csv-filename');
      if (filenameEl) filenameEl.textContent = file.name;

      const reader = new FileReader();
      reader.onload = (e) => {
        const text = e.target.result || '';
        const cleaned = text.replace(/^\uFEFF/, '');
        const lines = cleaned.split(/\r\n|\r|\n/).filter(l => l.trim());
        const dataLines = lines.slice(1);
        const parsed = [];

        for (const line of dataLines) {
          const row = this.parseCsvLine(line);
          const [typeLabel, questionText, opt1, opt2, opt3, opt4, correctAnswerRaw, pointsRaw] = row;
          if (!questionText || !questionText.trim()) continue;

          const isTf = String(typeLabel || '').includes('是非');
          const correctText = String(correctAnswerRaw || '').trim();
          let options = [];

          if (isTf) {
            const isTrue = correctText === '正確' || correctText === 'true' || correctText === '1' || correctText === 'O' || correctText === '是';
            options = [
              { id: 'A', text: '⭕ 正確', isCorrect: isTrue },
              { id: 'B', text: '❌ 錯誤', isCorrect: !isTrue }
            ];
          } else {
            const rawOpts = [opt1, opt2, opt3, opt4].map(o => String(o || '').trim()).filter(Boolean);
            if (rawOpts.length < 2) continue;
            options = rawOpts.map((text, oi) => {
              const isMatch = correctText === text || correctText === String(oi) || correctText === ['A', 'B', 'C', 'D'][oi];
              return {
                id: ['A', 'B', 'C', 'D'][oi] || String(oi + 1),
                text,
                isCorrect: isMatch
              };
            });
            if (!options.some(o => o.isCorrect)) {
              options[0].isCorrect = true;
            }
          }

          parsed.push({
            _selected: true,
            type: isTf ? 'true_false' : 'single',
            typeLabel: isTf ? '是非題' : '選擇題',
            prompt: questionText.trim(),
            options,
            time_limit_sec: 20,
            points: Number(pointsRaw) || 1000,
            explanation: '',
          });
        }

        this.importCsvQuestionsDraft = parsed;
        const titleInput = document.getElementById('input-kahoot-import-set-title');
        if (titleInput && !titleInput.value) {
          titleInput.value = file.name.replace(/\.[^/.]+$/, '') + '（競賽題庫）';
        }
        this.renderImportPreview(this.importCsvQuestionsDraft, 'csv');
      };
      reader.readAsText(file);
    },

    downloadImportCsvTemplate() {
      const headers = ['題型', '題目內容', '選項1', '選項2', '選項3', '選項4', '正確答案', '配分'];
      const sampleRows = [
        ['選擇題', '正三角形的三個內角度數均為多少度？', '60 度', '90 度', '45 度', '180 度', '60 度', '1000'],
        ['是非題', '光合作用產生的主要氣體產物為氧氣。', '', '', '', '', '正確', '1000'],
        ['選擇題', '太陽系中體積最大的行星是哪一顆？', '木星', '土星', '地球', '火星', '木星', '1000'],
        ['是非題', '地球繞太陽公轉一週約為一個月。', '', '', '', '', '錯誤', '1000']
      ];
      const csv = [headers, ...sampleRows].map(r => r.map(c => `"${String(c).replace(/"/g, '""')}"`).join(',')).join('\r\n');
      const blob = new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8;' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = '答題競賽題目匯入範本.csv';
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    },

    parseCsvLine(line) {
      const cells = [];
      let cur = '';
      let inQuotes = false;
      for (let i = 0; i < line.length; i++) {
        const ch = line[i];
        if (inQuotes) {
          if (ch === '"') {
            if (line[i + 1] === '"') { cur += '"'; i++; } else { inQuotes = false; }
          } else {
            cur += ch;
          }
        } else if (ch === '"') {
          inQuotes = true;
        } else if (ch === ',') {
          cells.push(cur.trim());
          cur = '';
        } else {
          cur += ch;
        }
      }
      cells.push(cur.trim());
      return cells;
    },

    async handleConfirmImport() {
      const questions = this.importTab === 'lms' ? this.importQuestionsDraft : this.importCsvQuestionsDraft;
      const selectedQuestions = (questions || []).filter(q => q._selected);

      if (selectedQuestions.length === 0) {
        alert('請至少勾選一道要匯入的題目');
        return;
      }

      const courseId = this.getCourseId();
      if (!courseId) return;

      const isAppend = this.importTargetMode === 'append' && this.selectedSet;
      const targetSetId = isAppend ? this.selectedSet.id : null;
      let title = document.getElementById('input-kahoot-import-set-title')?.value.trim();
      if (!isAppend && !title) {
        title = '匯入競賽題庫';
      }

      const confirmBtn = document.getElementById('btn-confirm-kahoot-import');
      if (confirmBtn) {
        confirmBtn.disabled = true;
        confirmBtn.textContent = '匯入處理中...';
      }

      try {
        const res = await fetch(`/api/quiz-sets/${courseId}/import`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            target_set_id: targetSetId,
            title,
            questions: selectedQuestions
          })
        });

        const data = await res.json();
        if (!res.ok) throw new Error(data.detail || '匯入失敗');

        document.getElementById('modal-kahoot-import-quiz')?.classList.remove('open');
        alert(data.message || '匯入成功！');

        await this.loadCourse(courseId);
        if (data.quiz_set_id) {
          await this.selectSet(data.quiz_set_id);
        }
        this.renderManageModal();
      } catch (err) {
        alert('匯入失敗：' + err.message);
      } finally {
        if (confirmBtn) {
          confirmBtn.disabled = false;
          confirmBtn.textContent = `📥 確認匯入 (${selectedQuestions.length} 題)`;
        }
      }
    }
  };

  // =========================================================================
  // 8. Master Teaching Toolkit Manager
  // =========================================================================
  const TeachingToolkit = {
    audio: AudioEngine,
    bulletin: BulletinBoard,
    luckyDraw: LuckyDraw,
    timer: TimerEngine,
    liveWall: LiveWall,
    wordCloud: WordCloud,
    kahoot: KahootGame,
    floatingDock: FloatingClassroomDock,

    init() {
      this.bulletin.init();
      this.luckyDraw.init();
      this.timer.init();
      this.liveWall.init();
      this.wordCloud.init();
      this.kahoot.init();
      this.floatingDock.init();

      this.luckyDraw.updatePoolCountBadge();
      this.timer.updatePresetButtons();

      // Subtab switcher inside Toolkit pane
      document.querySelectorAll('.toolkit-subtab-btn').forEach(btn => {
        btn.addEventListener('click', (e) => {
          const subtab = e.currentTarget.dataset.toolkitTab;
          this.switchSubtab(subtab);
        });
      });

      // Synchronize toolkit elements on language switch
      window.addEventListener('languageChanged', () => {
        this.bulletin.renderPostDropdown();
        if (this.bulletin.saveStatus !== 'idle') this.bulletin.setSaveStatus(this.bulletin.saveStatus);
        this.luckyDraw.updatePoolCountBadge();
        if (!this.luckyDraw.isRolling) {
          this.luckyDraw.resetSpotlightCard();
        }
        this.timer.updatePresetButtons();
        this.timer.updateCountdownControls();
        this.timer.updateStopwatchControls();
        this.liveWall.refresh();
        if (document.getElementById('modal-livewall-history')?.classList.contains('open')) {
          this.liveWall.loadHistory();
        }
      });
    },

    switchSubtab(subtab) {
      if (this.bulletin && typeof this.bulletin.flushActivePost === 'function') {
        this.bulletin.flushActivePost();
      }
      document.querySelectorAll('.toolkit-subtab-btn').forEach(b => {
        const isActive = b.dataset.toolkitTab === subtab;
        b.classList.toggle('active', isActive);
        b.classList.toggle('btn-secondary', !isActive);
      });
      document.querySelectorAll('.toolkit-subpane').forEach(p => {
        p.style.display = p.id === `toolkit-subpane-${subtab}` ? 'block' : 'none';
      });
      if (subtab === 'bulletin') {
        const cId = this.bulletin.getCourseId();
        if (cId && (!this.bulletin.posts || this.bulletin.posts.length === 0 || this.bulletin.currentCourseId !== cId)) {
          this.bulletin.loadCourse(cId);
        }
      }
      if (subtab === 'draw') {
        this.luckyDraw.resetSpotlightCard();
      }
      if (subtab === 'timer') {
        this.timer.onEnterTimerTab();
      } else {
        this.timer.onLeaveTimerTab();
      }
      if (subtab === 'liveWall') {
        this.liveWall.onEnterLiveWallTab();
      } else {
        this.liveWall.onLeaveLiveWallTab();
      }
      if (subtab === 'wordCloud') {
        const cId = this.wordCloud.getCourseId();
        if (cId && !this.wordCloud.currentSession) {
          this.wordCloud.loadCourse(cId);
        }
      }
      if (subtab === 'kahoot') {
        const cId = this.kahoot.getCourseId();
        if (cId && this.kahoot.sets.length === 0) {
          this.kahoot.loadCourse(cId);
        }
      }
    },

    onCourseLoaded(courseId, students, groups) {
      if (this.liveWall && this.liveWall.currentSession && this.liveWall.currentSession.course_id !== courseId) {
        this.liveWall.onLeaveLiveWallTab();
      }
      this.setCourseAvailability(true);
      this.bulletin.loadCourse(courseId);
      this.luckyDraw.setStudents(students);
      this.luckyDraw.setGroups(groups);
      this.wordCloud.loadCourse(courseId);
      this.kahoot.loadCourse(courseId);
    },

    // 課堂公布欄／隨機抽籤都需要課程資料（公告存在 localStorage 的課程 key 下、抽籤池來自班級名冊），
    // 尚未建立班級時分別在這兩個子分頁裡顯示跟其他分頁一致的「尚無班級」提示卡，取代原本的內容；
    // 計時器與碼錶不受影響，維持可用。
    setCourseAvailability(hasCourse) {
      const pairs = [
        ['toolkit-bulletin-empty-notice', 'toolkit-bulletin-content'],
        ['toolkit-draw-empty-notice', 'toolkit-draw-content'],
      ];
      pairs.forEach(([noticeId, contentId]) => {
        const notice = document.getElementById(noticeId);
        const content = document.getElementById(contentId);
        if (!notice || !content) return;
        if (hasCourse) {
          notice.style.display = 'none';
          content.style.display = '';
        } else {
          if (window.renderEmptyCourseNotice) window.renderEmptyCourseNotice(notice);
          notice.style.display = 'block';
          content.style.display = 'none';
        }
      });
    }
  };

  window.addEventListener('beforeunload', () => {
    if (TeachingToolkit?.timer) {
      TeachingToolkit.timer.onLeaveTimerTab();
    }
    if (TeachingToolkit?.liveWall) {
      TeachingToolkit.liveWall.onLeaveLiveWallTab({ isUnload: true });
    }
  });

  window.addEventListener('pagehide', () => {
    if (TeachingToolkit?.timer) {
      TeachingToolkit.timer.onLeaveTimerTab();
    }
    if (TeachingToolkit?.liveWall) {
      TeachingToolkit.liveWall.onLeaveLiveWallTab({ isUnload: true });
    }
  });

  document.addEventListener('DOMContentLoaded', () => {
    TeachingToolkit.init();
  });

  window.TeachingToolkit = TeachingToolkit;

})(window);
