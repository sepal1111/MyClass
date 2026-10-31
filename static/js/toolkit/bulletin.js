// 課堂工具箱：課堂公布欄（多份佈告儲存與切換）
// 由 static/js/toolkit.js 拆出（2026-10-30），程式內容未變更。載入順序見 static/index.html；
// 模組之間透過 window.ToolkitModules 取用彼此（toolkit/common.js 建立）。
(function (window) {
  'use strict';
  const TK = window.ToolkitModules;

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

  TK.BulletinBoard = BulletinBoard;
})(window);
