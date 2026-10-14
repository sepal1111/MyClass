// MyClass File Collection Module (Teacher-side)
// Handles topic management, instant upload locking, student file preview with inline video/audio players, and ZIP downloads.
(function () {
  let activeCourseId = null;
  let currentTopic = null;
  let cachedItems = [];
  let activeFilterType = 'all';
  let activeSearchQuery = '';

  function formatBytes(bytes) {
    if (!bytes || bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
  }

  function getFileType(item) {
    const ext = (item.file_url || '').split('.').pop()?.toLowerCase() || '';
    const mime = (item.mime_type || '').toLowerCase();
    if (['mp4', 'webm', 'mov', 'm4v', 'mkv', 'avi'].includes(ext) || mime.startsWith('video/')) return 'video';
    if (['mp3', 'wav', 'm4a', 'ogg', 'aac', 'flac'].includes(ext) || mime.startsWith('audio/')) return 'audio';
    if (['jpg', 'jpeg', 'png', 'gif', 'webp', 'svg', 'bmp'].includes(ext) || mime.startsWith('image/')) return 'image';
    return 'other';
  }

  async function loadTopics() {
    activeCourseId = window.AppState?.currentCourseId;
    if (!activeCourseId) return;

    try {
      const res = await fetch(`/api/file-collections/courses/${activeCourseId}`, {
        credentials: 'include'
      });
      if (!res.ok) throw new Error('無法取得檔案蒐集主題清單');
      const topics = await res.json();

      renderTopics(topics);
      updateStats(topics);
    } catch (err) {
      console.error('[FileCollect] loadTopics error:', err);
      if (typeof window.showToast === 'function') {
        window.showToast(err.message, 'error');
      }
    }
  }

  function updateStats(topics) {
    const statTopics = document.getElementById('filecollect-stat-total-topics');
    const statFiles = document.getElementById('filecollect-stat-total-files');
    const statStudents = document.getElementById('filecollect-stat-total-students');

    if (!statTopics) return;

    const totalTopics = topics.length;
    const totalFiles = topics.reduce((sum, t) => sum + (t.file_count || 0), 0);
    const totalStudents = topics.reduce((sum, t) => sum + (t.student_count || 0), 0);

    statTopics.textContent = totalTopics;
    statFiles.textContent = totalFiles;
    statStudents.textContent = totalStudents;
  }

  function renderTopics(topics) {
    const container = document.getElementById('filecollect-topics-container');
    const emptyNotice = document.getElementById('filecollect-topics-empty');
    if (!container) return;

    container.innerHTML = '';
    if (!topics || topics.length === 0) {
      if (emptyNotice) emptyNotice.style.display = 'block';
      return;
    }
    if (emptyNotice) emptyNotice.style.display = 'none';

    topics.forEach((topic) => {
      const card = document.createElement('div');
      card.className = 'glass-card';
      card.style.margin = '0';
      card.style.display = 'flex';
      card.style.flexDirection = 'column';
      card.style.justifyContent = 'space-between';
      card.style.padding = '18px';
      card.style.border = topic.allow_upload ? '1.5px solid rgba(16, 185, 129, 0.4)' : '1.5px solid var(--card-border)';
      card.style.background = topic.allow_upload ? 'linear-gradient(135deg, var(--card-bg) 0%, rgba(16, 185, 129, 0.04) 100%)' : 'var(--card-bg)';
      card.style.boxShadow = 'var(--shadow-sm)';

      const isOpen = Boolean(topic.allow_upload);
      const statusBadge = isOpen
        ? `<span class="badge" style="background: var(--accent-positive-bg, #ecfdf5); color: var(--accent-positive, #059669); border: 1px solid rgba(16, 185, 129, 0.3); font-size: 0.8rem; padding: 4px 10px; border-radius: 12px; font-weight: 800;">🟢 開放上傳中</span>`
        : `<span class="badge" style="background: var(--accent-negative-bg, #fef2f2); color: var(--accent-negative, #dc2626); border: 1px solid rgba(239, 68, 68, 0.3); font-size: 0.8rem; padding: 4px 10px; border-radius: 12px; font-weight: 800;">🔒 已停止上傳</span>`;

      const extsHint = topic.allowed_extensions
        ? `<div style="font-size: 0.78rem; color: var(--text-muted); margin-top: 4px;">副檔名限制: <code>${topic.allowed_extensions}</code></div>`
        : '';

      card.innerHTML = `
        <div>
          <div style="display: flex; justify-content: space-between; align-items: flex-start; gap: 8px; margin-bottom: 10px;">
            <h4 style="margin: 0; font-size: 1.12rem; font-weight: 800; color: var(--text-main); word-break: break-word;">${escapeHtml(topic.title)}</h4>
            ${statusBadge}
          </div>
          <div style="font-size: 0.85rem; color: var(--text-muted); line-height: 1.5; margin-bottom: 12px; min-height: 2.8em; word-break: break-word;">
            ${topic.description ? escapeHtml(topic.description) : '<span style="color: var(--text-muted); font-style: italic;">無特別備註</span>'}
          </div>
          ${extsHint}
          
          <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 8px; margin: 14px 0; background: var(--input-bg); padding: 10px 12px; border-radius: var(--radius-sm); border: 1px solid var(--card-border); text-align: center;">
            <div>
              <div style="font-size: 0.75rem; color: var(--text-muted); font-weight: 700;">繳交進度</div>
              <div style="font-size: 1.15rem; font-weight: 900; color: var(--primary); margin-top: 2px;">
                ${topic.student_count} <span style="font-size: 0.8rem; font-weight: 600; color: var(--text-muted);">/ ${topic.total_students} 人</span>
              </div>
            </div>
            <div>
              <div style="font-size: 0.75rem; color: var(--text-muted); font-weight: 700;">總收件容量</div>
              <div style="font-size: 1.15rem; font-weight: 900; color: var(--text-main); margin-top: 2px;">
                ${topic.file_count} <span style="font-size: 0.8rem; font-weight: 600; color: var(--text-muted);">件 (${formatBytes(topic.total_bytes)})</span>
              </div>
            </div>
          </div>
        </div>

        <div>
          <div style="display: flex; gap: 6px; flex-wrap: wrap; margin-bottom: 8px;">
            <button type="button" class="btn btn-primary btn-topic-view" style="flex: 1 1 120px; font-size: 0.85rem; padding: 7px 12px;">👀 查看收件成果</button>
            <button type="button" class="btn ${isOpen ? 'btn-secondary' : 'btn-primary'} btn-topic-toggle-upload" style="font-size: 0.82rem; padding: 7px 10px;" title="${isOpen ? '點擊關閉學生上傳' : '點擊重啟學生上傳'}">
              ${isOpen ? '🔒 停止上傳' : '🟢 開放上傳'}
            </button>
          </div>
          <div style="display: flex; justify-content: space-between; align-items: center; gap: 6px;">
            <span style="font-size: 0.74rem; color: var(--text-muted);">${topic.created_at ? topic.created_at.slice(0, 16) : ''}</span>
            <div style="display: flex; gap: 4px;">
              <button type="button" class="btn btn-secondary btn-topic-edit" style="font-size: 0.78rem; padding: 4px 8px;">✏️</button>
              <button type="button" class="btn btn-secondary btn-topic-delete" style="font-size: 0.78rem; padding: 4px 8px; color: var(--accent-negative); border-color: var(--accent-negative-border);">🗑️</button>
            </div>
          </div>
        </div>
      `;

      card.querySelector('.btn-topic-view').addEventListener('click', () => viewTopic(topic.id));
      card.querySelector('.btn-topic-toggle-upload').addEventListener('click', () => toggleUpload(topic.id));
      card.querySelector('.btn-topic-edit').addEventListener('click', () => openEditTopicModal(topic));
      card.querySelector('.btn-topic-delete').addEventListener('click', () => deleteTopic(topic.id, topic.title));

      container.appendChild(card);
    });
  }

  async function viewTopic(topicId) {
    try {
      const res = await fetch(`/api/file-collections/${topicId}/items`, { credentials: 'include' });
      if (!res.ok) throw new Error('無法取得該主題檔案');
      const data = await res.json();

      currentTopic = data.collection;
      cachedItems = data.items || [];

      document.getElementById('filecollect-topics-view').style.display = 'none';
      const filesView = document.getElementById('filecollect-files-view');
      filesView.style.display = 'block';

      // 填充主題標題與資訊
      document.getElementById('filecollect-view-topic-title').textContent = currentTopic.title;
      const badge = document.getElementById('filecollect-view-topic-status-badge');
      const toggleBtn = document.getElementById('btn-filecollect-toggle-upload');

      if (currentTopic.allow_upload) {
        badge.textContent = '🟢 開放上傳中';
        badge.style.background = 'var(--accent-positive-bg, #ecfdf5)';
        badge.style.color = 'var(--accent-positive, #059669)';
        badge.style.borderColor = 'rgba(16, 185, 129, 0.3)';
        toggleBtn.textContent = '🔒 停止上傳';
        toggleBtn.className = 'btn btn-secondary';
      } else {
        badge.textContent = '🔒 已停止上傳';
        badge.style.background = 'var(--accent-negative-bg, #fef2f2)';
        badge.style.color = 'var(--accent-negative, #dc2626)';
        badge.style.borderColor = 'rgba(239, 68, 68, 0.3)';
        toggleBtn.textContent = '🟢 開放上傳';
        toggleBtn.className = 'btn btn-primary';
      }

      const descBox = document.getElementById('filecollect-view-topic-desc');
      let descHtml = `<b>說明：</b>${currentTopic.description ? escapeHtml(currentTopic.description) : '無特別備註'}`;
      if (currentTopic.allowed_extensions) {
        descHtml += ` | <b>限制副檔名：</b><code>${currentTopic.allowed_extensions}</code>`;
      }
      descHtml += ` | <b>建立時間：</b>${currentTopic.created_at || ''}`;
      descBox.innerHTML = descHtml;

      renderFilteredItems();
    } catch (err) {
      console.error('[FileCollect] viewTopic error:', err);
      if (typeof window.showToast === 'function') {
        window.showToast(err.message, 'error');
      }
    }
  }

  function renderFilteredItems() {
    const container = document.getElementById('filecollect-files-container');
    const emptyNotice = document.getElementById('filecollect-files-empty');
    const countBadge = document.getElementById('filecollect-files-count-badge');
    if (!container) return;

    container.innerHTML = '';

    const query = (activeSearchQuery || '').trim().toLowerCase();
    const filtered = cachedItems.filter((item) => {
      const type = getFileType(item);
      if (activeFilterType !== 'all' && type !== activeFilterType) return false;

      if (query) {
        const studentNum = String(item.student_number);
        const name = (item.student_name || '').toLowerCase();
        const disp = (item.display_name || '').toLowerCase();
        const orig = (item.original_filename || '').toLowerCase();
        if (!studentNum.includes(query) && !name.includes(query) && !disp.includes(query) && !orig.includes(query)) {
          return false;
        }
      }
      return true;
    });

    if (countBadge) {
      countBadge.textContent = `顯示 ${filtered.length} / 共 ${cachedItems.length} 個檔案`;
    }

    if (filtered.length === 0) {
      if (emptyNotice) emptyNotice.style.display = 'block';
      return;
    }
    if (emptyNotice) emptyNotice.style.display = 'none';

    filtered.forEach((item) => {
      const type = getFileType(item);
      const card = document.createElement('div');
      card.className = 'glass-card';
      card.style.margin = '0';
      card.style.padding = '14px';
      card.style.display = 'flex';
      card.style.flexDirection = 'column';
      card.style.justifyContent = 'space-between';
      card.style.border = '1px solid var(--card-border)';
      card.style.boxShadow = 'var(--shadow-xs)';

      // 學生資訊頭像標籤
      const genderIcon = item.gender === 'F' ? '👧' : '👦';
      const numStr = String(item.student_number).padStart(2, '0');
      const studentLabel = `[${numStr}] ${item.student_name}`;

      // 預覽區域 HTML
      let previewHtml = '';
      if (type === 'video') {
        previewHtml = `
          <div style="position: relative; width: 100%; border-radius: 8px; overflow: hidden; background: #000; margin-bottom: 10px;">
            <video controls preload="metadata" playsinline style="width: 100%; max-height: 180px; display: block;">
              <source src="${item.file_url}" type="${item.mime_type || 'video/mp4'}">
              您的瀏覽器不支援影片直接播放。
            </video>
          </div>
        `;
      } else if (type === 'audio') {
        previewHtml = `
          <div style="background: linear-gradient(135deg, rgba(91, 124, 214, 0.08) 0%, rgba(128, 115, 196, 0.08) 100%); border: 1px solid var(--primary-light, #c7d2fe); border-radius: 8px; padding: 12px; margin-bottom: 10px; text-align: center;">
            <div style="font-size: 1.8rem; margin-bottom: 6px;">🎵</div>
            <audio controls preload="metadata" style="width: 100%; height: 36px;">
              <source src="${item.file_url}" type="${item.mime_type || 'audio/mpeg'}">
              您的瀏覽器不支援音訊直接播放。
            </audio>
          </div>
        `;
      } else if (type === 'image') {
        previewHtml = `
          <div style="width: 100%; height: 160px; display: flex; align-items: center; justify-content: center; background: #f8fafc; border-radius: 8px; overflow: hidden; margin-bottom: 10px; cursor: pointer; border: 1px solid var(--card-border);" onclick="window.open('${item.file_url}', '_blank')">
            <img src="${item.file_url}" alt="${escapeHtml(item.display_name)}" style="max-width: 100%; max-height: 100%; object-fit: contain;">
          </div>
        `;
      } else {
        previewHtml = `
          <div style="width: 100%; height: 120px; display: flex; flex-direction: column; align-items: center; justify-content: center; background: #f8fafc; border-radius: 8px; margin-bottom: 10px; border: 1px dashed var(--card-border);">
            <div style="font-size: 2.2rem; margin-bottom: 4px;">📄</div>
            <span style="font-size: 0.78rem; color: var(--text-muted);">文件 / 附件檔案</span>
          </div>
        `;
      }

      const downloadUrl = `${item.file_url}?name=${encodeURIComponent(item.display_name || item.original_filename)}`;

      card.innerHTML = `
        <div>
          <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 8px;">
            <span style="display: inline-flex; align-items: center; gap: 4px; font-weight: 800; font-size: 0.95rem; color: var(--text-main);">
              <span>${genderIcon}</span>
              <span>${escapeHtml(studentLabel)}</span>
            </span>
            <span style="font-size: 0.75rem; color: var(--text-muted); font-weight: 600;">${formatBytes(item.file_size)}</span>
          </div>

          ${previewHtml}

          <div style="margin-top: 4px;">
            <div style="font-weight: 700; font-size: 0.9rem; color: var(--text-main); word-break: break-all; line-height: 1.3;" title="${escapeHtml(item.display_name)}">
              ${escapeHtml(item.display_name)}
            </div>
            ${item.display_name !== item.original_filename ? `<div style="font-size: 0.75rem; color: var(--text-muted); margin-top: 2px;">原檔名: ${escapeHtml(item.original_filename)}</div>` : ''}
          </div>
        </div>

        <div style="margin-top: 10px; padding-top: 8px; border-top: 1px dashed var(--card-border); display: flex; justify-content: space-between; align-items: center;">
          <span style="font-size: 0.72rem; color: var(--text-muted);">${item.uploaded_at ? item.uploaded_at.slice(5, 16) : ''}</span>
          <div style="display: flex; gap: 6px;">
            <a href="${downloadUrl}" download class="btn btn-secondary" style="font-size: 0.78rem; padding: 4px 8px; text-decoration: none;" title="下載此檔案">📥 下載</a>
            <button type="button" class="btn btn-secondary btn-delete-file" style="font-size: 0.78rem; padding: 4px 8px; color: var(--accent-negative); border-color: var(--accent-negative-border);" title="刪除檔案">🗑️</button>
          </div>
        </div>
      `;

      card.querySelector('.btn-delete-file').addEventListener('click', () => deleteFile(item.id, item.display_name));
      container.appendChild(card);
    });
  }

  async function toggleUpload(topicId) {
    try {
      const res = await fetch(`/api/file-collections/${topicId}/toggle_upload`, {
        method: 'PATCH',
        credentials: 'include'
      });
      if (!res.ok) throw new Error('切換上傳狀態失敗');
      const data = await res.json();

      if (typeof window.showToast === 'function') {
        window.showToast(data.message, 'success');
      }

      if (currentTopic && currentTopic.id === topicId) {
        viewTopic(topicId);
      } else {
        loadTopics();
      }
    } catch (err) {
      console.error('[FileCollect] toggleUpload error:', err);
      if (typeof window.showToast === 'function') {
        window.showToast(err.message, 'error');
      }
    }
  }

  async function deleteTopic(topicId, title) {
    if (!(await window.showConfirmModal({ icon: '🗑️', title: `確定要刪除「${title}」蒐集主題嗎？`, desc: '該主題內所有學生上傳之檔案與影片也將一併從伺服器永久刪除，無法復原！', danger: true }))) {
      return;
    }

    try {
      const res = await fetch(`/api/file-collections/${topicId}`, {
        method: 'DELETE',
        credentials: 'include'
      });
      if (!res.ok) throw new Error('刪除主題失敗');

      if (typeof window.showToast === 'function') {
        window.showToast('蒐集主題已刪除', 'success');
      }
      loadTopics();
    } catch (err) {
      console.error('[FileCollect] deleteTopic error:', err);
      if (typeof window.showToast === 'function') {
        window.showToast(err.message, 'error');
      }
    }
  }

  async function deleteFile(itemId, displayName) {
    if (!(await window.showConfirmModal({ icon: '🗑️', title: `確定要刪除檔案「${displayName}」嗎？`, danger: true }))) {
      return;
    }

    try {
      const res = await fetch(`/api/file-collections/${currentTopic.id}/items/${itemId}`, {
        method: 'DELETE',
        credentials: 'include'
      });
      if (!res.ok) throw new Error('刪除檔案失敗');

      if (typeof window.showToast === 'function') {
        window.showToast('檔案已刪除', 'success');
      }
      viewTopic(currentTopic.id);
    } catch (err) {
      console.error('[FileCollect] deleteFile error:', err);
      if (typeof window.showToast === 'function') {
        window.showToast(err.message, 'error');
      }
    }
  }

  function openCreateTopicModal() {
    document.getElementById('modal-filecollect-title').textContent = '➕ 建立檔案蒐集主題';
    document.getElementById('filecollect-edit-id').value = '';
    document.getElementById('filecollect-edit-title').value = '';
    document.getElementById('filecollect-edit-desc').value = '';
    document.getElementById('filecollect-edit-extensions').value = '';
    document.getElementById('filecollect-edit-allow-upload').checked = true;

    if (typeof window.openModal === 'function') {
      window.openModal('modal-filecollect-editor');
    }
  }

  function openEditTopicModal(topic) {
    document.getElementById('modal-filecollect-title').textContent = '✏️ 編輯檔案蒐集主題';
    document.getElementById('filecollect-edit-id').value = topic.id;
    document.getElementById('filecollect-edit-title').value = topic.title || '';
    document.getElementById('filecollect-edit-desc').value = topic.description || '';
    document.getElementById('filecollect-edit-extensions').value = topic.allowed_extensions || '';
    document.getElementById('filecollect-edit-allow-upload').checked = Boolean(topic.allow_upload);

    if (typeof window.openModal === 'function') {
      window.openModal('modal-filecollect-editor');
    }
  }

  async function handleTopicFormSubmit(e) {
    e.preventDefault();
    activeCourseId = window.AppState?.currentCourseId;
    if (!activeCourseId) return;

    const id = document.getElementById('filecollect-edit-id').value;
    const title = document.getElementById('filecollect-edit-title').value.trim();
    const description = document.getElementById('filecollect-edit-desc').value.trim();
    const allowed_extensions = document.getElementById('filecollect-edit-extensions').value.trim();
    const allow_upload = document.getElementById('filecollect-edit-allow-upload').checked ? 1 : 0;

    if (!title) {
      alert('請填寫主題名稱');
      return;
    }

    const payload = { title, description, allowed_extensions, allow_upload };
    const url = id ? `/api/file-collections/${id}` : `/api/file-collections/courses/${activeCourseId}`;
    const method = id ? 'PUT' : 'POST';

    try {
      const res = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
        credentials: 'include'
      });
      if (!res.ok) {
        const errJson = await res.json().catch(() => ({}));
        throw new Error(errJson.detail || '儲存失敗');
      }

      if (typeof window.closeModal === 'function') {
        window.closeModal('modal-filecollect-editor');
      }
      if (typeof window.showToast === 'function') {
        window.showToast(id ? '主題設定已更新' : '已成功建立蒐集主題', 'success');
      }

      loadTopics();
    } catch (err) {
      alert(err.message);
    }
  }

  function escapeHtml(str) {
    if (!str) return '';
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }

  function init() {
    // 綁定按鈕事件
    const btnCreate = document.getElementById('btn-open-create-collection');
    if (btnCreate) btnCreate.addEventListener('click', openCreateTopicModal);

    const btnRefresh = document.getElementById('btn-refresh-collections');
    if (btnRefresh) btnRefresh.addEventListener('click', loadTopics);

    const btnBack = document.getElementById('btn-filecollect-back-to-topics');
    if (btnBack) {
      btnBack.addEventListener('click', () => {
        document.getElementById('filecollect-files-view').style.display = 'none';
        document.getElementById('filecollect-topics-view').style.display = 'block';
        loadTopics();
      });
    }

    const btnToggle = document.getElementById('btn-filecollect-toggle-upload');
    if (btnToggle) {
      btnToggle.addEventListener('click', () => {
        if (currentTopic) toggleUpload(currentTopic.id);
      });
    }

    const btnDownloadZip = document.getElementById('btn-filecollect-download-zip');
    if (btnDownloadZip) {
      btnDownloadZip.addEventListener('click', () => {
        if (!currentTopic) return;
        window.location.href = `/api/file-collections/${currentTopic.id}/download_zip`;
      });
    }

    const btnRefreshFiles = document.getElementById('btn-filecollect-refresh-files');
    if (btnRefreshFiles) {
      btnRefreshFiles.addEventListener('click', () => {
        if (currentTopic) viewTopic(currentTopic.id);
      });
    }

    const form = document.getElementById('form-filecollect');
    if (form) form.addEventListener('submit', handleTopicFormSubmit);

    // 篩選與搜尋
    document.querySelectorAll('.btn-file-filter').forEach((btn) => {
      btn.addEventListener('click', (e) => {
        document.querySelectorAll('.btn-file-filter').forEach((b) => b.classList.remove('active'));
        e.currentTarget.classList.add('active');
        activeFilterType = e.currentTarget.dataset.type || 'all';
        renderFilteredItems();
      });
    });

    const searchInput = document.getElementById('filecollect-search-input');
    if (searchInput) {
      searchInput.addEventListener('input', (e) => {
        activeSearchQuery = e.target.value;
        renderFilteredItems();
      });
    }

    // 即時 Socket 事件監聽
    if (window.RealtimeManager && typeof window.RealtimeManager.on === 'function') {
      window.RealtimeManager.on('file_collection_updated', () => {
        const activeTab = window.getActiveTabName ? window.getActiveTabName() : '';
        if (activeTab === 'filecollect') {
          if (currentTopic && document.getElementById('filecollect-files-view').style.display !== 'none') {
            viewTopic(currentTopic.id);
          } else {
            loadTopics();
          }
        }
      });
    }
  }

  window.FileCollectManager = {
    init,
    load: loadTopics,
    reload: loadTopics,
    viewTopic,
  };

  document.addEventListener('DOMContentLoaded', () => {
    init();
  });
})();
