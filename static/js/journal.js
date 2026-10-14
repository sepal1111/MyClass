/* ==========================================================================
   國小課堂即時記錄系統 - 教學日誌模組 (Lesson Journal)
   以課程為單位的教學進度／課堂記事，與 app.js 的「特殊表現紀錄」(針對個別學生) 是不同維度。
   ========================================================================== */
(function () {
  let journalEntries = [];
  let subUnitOptions = []; // flattened [{ id, label }]
  let activeTagFilter = 'all';

  const TAG_META = {
    general: { emoji: '🗒️', i18nKey: 'journal_tag_general', color: '#7b98e0' },
    progress: { emoji: '📈', i18nKey: 'journal_tag_progress', color: '#4fae82' },
    classroom: { emoji: '🏫', i18nKey: 'journal_tag_classroom', color: '#ec4899' },
    material: { emoji: '📦', i18nKey: 'journal_tag_material', color: '#e0a13b' },
    todo: { emoji: '✅', i18nKey: 'journal_tag_todo', color: '#d9807e' },
  };
  const TAG_ORDER = ['general', 'progress', 'classroom', 'material', 'todo'];

  function courseId() {
    return window.AppState && window.AppState.currentCourseId;
  }

  function escapeHtml(s) {
    const d = document.createElement('div');
    d.textContent = s == null ? '' : String(s);
    return d.innerHTML;
  }

  function t(key, fallback, params) {
    if (window.I18n && typeof window.I18n.t === 'function') {
      return window.I18n.t(key, params);
    }
    return fallback;
  }

  async function load() {
    const cid = courseId();
    const container = document.getElementById('journal-list-container');
    if (!container) return;
    if (!cid) {
      if (window.renderEmptyCourseNotice) window.renderEmptyCourseNotice(container);
      return;
    }
    try {
      const [entries, units] = await Promise.all([
        API.get(`/api/journal/${cid}`),
        API.get(`/api/units/${cid}`),
      ]);
      journalEntries = entries;
      subUnitOptions = flattenSubUnits(units);
      renderSubUnitSelect();
      const dateInput = document.getElementById('journal-date');
      if (dateInput && !dateInput.value && window.getTaiwanTodayDateStr) {
        dateInput.value = window.getTaiwanTodayDateStr();
      }
      renderTagFilterBar();
      applyFiltersAndRender();
    } catch (err) {
      console.error('LessonJournal.load error', err);
      container.innerHTML = `<div style="padding: 24px; color: var(--accent-negative);">教學日誌載入失敗：${escapeHtml(err.message)}</div>`;
    }
  }

  function flattenSubUnits(units) {
    const out = [];
    (units || []).forEach((u) => {
      (u.subUnits || []).forEach((su) => {
        out.push({ id: su.id, label: `${u.title} - ${su.title}` });
      });
    });
    return out;
  }

  function renderSubUnitSelect() {
    const select = document.getElementById('journal-subunit-select');
    if (!select) return;
    const prevValue = select.value;
    select.innerHTML = `<option value="">${t('journal_select_subunit', '關聯單元（選填）...')}</option>`;
    subUnitOptions.forEach((su) => {
      const opt = document.createElement('option');
      opt.value = su.id;
      opt.textContent = su.label;
      select.appendChild(opt);
    });
    if (prevValue && subUnitOptions.some((su) => String(su.id) === prevValue)) {
      select.value = prevValue;
    }
  }

  function renderTagFilterBar() {
    const bar = document.getElementById('journal-tag-filter-bar');
    if (!bar) return;
    const allLabel = `📋 ${t('journal_filter_all', '全部')}`;
    const chips = [{ key: 'all', label: allLabel }].concat(
      TAG_ORDER.map((key) => ({ key, label: t(TAG_META[key].i18nKey, `${TAG_META[key].emoji} ${key}`) }))
    );
    bar.innerHTML = '';
    chips.forEach((chip) => {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = `btn btn-sm ${activeTagFilter === chip.key ? '' : 'btn-secondary'}`;
      btn.style.fontSize = '0.82rem';
      btn.style.padding = '5px 12px';
      btn.textContent = chip.label;
      btn.addEventListener('click', () => {
        activeTagFilter = chip.key;
        renderTagFilterBar();
        applyFiltersAndRender();
      });
      bar.appendChild(btn);
    });
  }

  function applyFiltersAndRender() {
    const onlyOpenTodo = document.getElementById('journal-only-open-todo')?.checked;
    let filtered = journalEntries;
    if (activeTagFilter !== 'all') {
      filtered = filtered.filter((e) => e.tag === activeTagFilter);
    }
    if (onlyOpenTodo) {
      filtered = filtered.filter((e) => e.tag === 'todo' && !e.is_done);
    }
    renderList(filtered);
  }

  function renderList(entries) {
    const container = document.getElementById('journal-list-container');
    if (!container) return;
    container.innerHTML = '';

    if (entries.length === 0) {
      container.innerHTML = `<div style="color: var(--text-muted); text-align: center; padding: 20px;">${t('journal_no_records', '尚無教學日誌紀錄')}</div>`;
      return;
    }

    entries.forEach((entry) => {
      const meta = TAG_META[entry.tag] || TAG_META.general;
      const item = document.createElement('div');
      item.className = 'glass-card';
      item.style.padding = '14px';
      item.style.marginBottom = '10px';
      if (entry.tag === 'todo' && entry.is_done) item.style.opacity = '0.6';

      const unitBadge = entry.sub_unit_title
        ? `<span style="font-size: 0.78rem; color: var(--text-muted); background: rgba(123,152,224,0.12); padding: 2px 8px; border-radius: 999px;">🔗 ${escapeHtml(entry.unit_title || '')} - ${escapeHtml(entry.sub_unit_title)}</span>`
        : '';

      let mediaHtml = '';
      if (entry.media_url) {
        mediaHtml = entry.media_type === 'video'
          ? `<video src="${entry.media_url}" controls style="max-width: 100%; max-height: 360px; border-radius: 8px; margin-top: 10px; display: block; border: 1px solid var(--card-border);"></video>`
          : `<img src="${entry.media_url}" alt="附件" style="max-width: 100%; max-height: 360px; border-radius: 8px; margin-top: 10px; display: block; cursor: pointer; border: 1px solid var(--card-border);" onclick="window.open('${entry.media_url}', '_blank')">`;
      }

      const todoCheckbox = entry.tag === 'todo'
        ? `<input type="checkbox" class="journal-todo-check" ${entry.is_done ? 'checked' : ''} style="width: 18px; height: 18px; cursor: pointer;" title="標記待辦完成">`
        : '';

      item.innerHTML = `
        <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 6px; gap: 8px; flex-wrap: wrap;">
          <div style="display: flex; align-items: center; gap: 8px; flex-wrap: wrap;">
            ${todoCheckbox}
            <span style="font-weight: 700; color: ${meta.color};">${escapeHtml(t(meta.i18nKey, `${meta.emoji} ${entry.tag}`))}</span>
            <span style="font-size: 0.82rem; color: var(--text-muted);">${escapeHtml(entry.date)}</span>
            ${unitBadge}
          </div>
          <div style="display: flex; align-items: center; gap: 8px;">
            <span style="font-size: 0.8rem; color: var(--text-muted);">${entry.timestamp}</span>
            <button class="btn-del-journal btn-icon" style="width: 24px; height: 24px; font-size: 0.7rem;" title="刪除日誌">✕</button>
          </div>
        </div>
        <div style="font-size: 0.95rem; line-height: 1.5; white-space: pre-wrap; ${entry.tag === 'todo' && entry.is_done ? 'text-decoration: line-through;' : ''}">${escapeHtml(entry.content)}</div>
        ${mediaHtml}
      `;

      const checkbox = item.querySelector('.journal-todo-check');
      if (checkbox) {
        checkbox.addEventListener('change', async () => {
          try {
            await API.put(`/api/journal/${courseId()}/${entry.id}`, { is_done: checkbox.checked });
            load();
          } catch (err) {
            alert(`更新失敗：${err.message}`);
          }
        });
      }

      item.querySelector('.btn-del-journal').onclick = async () => {
        const isEn = window.I18n && window.I18n.getLanguage() === 'en';
        const confirmed = window.showConfirmModal
          ? await window.showConfirmModal({
              icon: '🗑️',
              danger: true,
              title: isEn ? 'Delete Journal Entry' : '刪除教學日誌',
              desc: t('journal_delete_confirm', '確定要刪除這則教學日誌嗎？此動作無法復原。'),
              confirmText: isEn ? 'Delete' : '確定刪除',
              cancelText: isEn ? 'Cancel' : '取消',
            })
          : confirm(t('journal_delete_confirm', '確定要刪除這則教學日誌嗎？此動作無法復原。'));
        if (confirmed) {
          await API.delete(`/api/journal/${courseId()}/${entry.id}`);
          load();
        }
      };

      container.appendChild(item);
    });
  }

  async function save() {
    const cid = courseId();
    if (!cid) {
      if (window.ensureCourseSelected) window.ensureCourseSelected();
      return;
    }
    const content = document.getElementById('journal-content-input').value.trim();
    const tag = document.getElementById('journal-tag-select').value;
    const subUnitId = document.getElementById('journal-subunit-select').value;
    const dateStr = document.getElementById('journal-date').value;
    const fileInput = document.getElementById('journal-media-file');

    if (!content && (!fileInput.files || fileInput.files.length === 0)) {
      alert(t('journal_empty_alert', '請輸入日誌內容或選擇要上傳的照片！'));
      return;
    }

    try {
      if (fileInput.files && fileInput.files.length > 0) {
        const formData = new FormData();
        formData.append('content', content);
        formData.append('tag', tag);
        if (subUnitId) formData.append('sub_unit_id', subUnitId);
        formData.append('date', dateStr);
        formData.append('media_file', fileInput.files[0]);
        await API.postFormData(`/api/journal/${cid}/with_media`, formData);
        if (window.resetCustomFileInput) window.resetCustomFileInput(fileInput);
      } else {
        await API.post(`/api/journal/${cid}`, {
          content,
          tag,
          sub_unit_id: subUnitId ? Number(subUnitId) : null,
          date: dateStr,
        });
      }

      document.getElementById('journal-content-input').value = '';
      document.getElementById('journal-tag-select').value = 'general';
      document.getElementById('journal-subunit-select').value = '';
      if (window.resetCustomFileInput) window.resetCustomFileInput(document.getElementById('journal-media-file'));
      load();
    } catch (err) {
      alert(`儲存教學日誌失敗：${err.message}`);
    }
  }

  function bindStaticUi() {
    document.getElementById('btn-save-journal')?.addEventListener('click', save);
    document.getElementById('journal-only-open-todo')?.addEventListener('change', applyFiltersAndRender);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', bindStaticUi);
  } else {
    bindStaticUi();
  }

  window.LessonJournal = { load };
})();
