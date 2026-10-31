// MyClass 教師端：學生名冊、照片、評分規則、名冊匯入、Excel 匯出、加減分紀錄
// 由 static/js/app.js 拆出（2026-10-31，原第 4319–5163 行），程式內容未變更。
// 所有 static/js/app.js 與 static/js/app/*.js 共用同一個全域範圍（一般 <script>，不是模組），載入順序見 static/index.html。


// --- Admin & Export Pane ---
async function loadAdminData() {
  if (!AppState.currentCourseId) {
    renderEmptyCourseNotice(document.getElementById('admin-students-list-container'));
    return;
  }
  loadAdminStudentsData();
  loadAdminRulesData();
  const activeSubtab = document.querySelector('.admin-subtab-btn.active')?.dataset.subtab;
  if (activeSubtab === 'pointcards' && window.PointCardsManager && typeof window.PointCardsManager.reload === 'function') {
    window.PointCardsManager.reload();
  }
}

async function loadAdminStudentsData() {
  const container = document.getElementById('admin-students-list-container');
  if (!container) return;

  const isEn = window.I18n && window.I18n.getLanguage() === 'en';
  const t = (k, p) => window.I18n ? window.I18n.t(k, p) : k;

  if (!AppState.currentCourseId || (AppState.courses && AppState.courses.length === 0)) {
    renderEmptyCourseNotice(container, isEn ? 'No courses in system yet' : '目前系統中尚無任何班級');
    return;
  }

  try {
    const students = await API.get(`/api/courses/${AppState.currentCourseId}/students`);
    container.innerHTML = '';

    if (students.length === 0) {
      renderEmptyStudentRosterNotice(container);
      return;
    }

    students.forEach(s => {
      const item = document.createElement('div');
      item.className = 'glass-card';
      // 卡片是窄欄位（約 260～320px）：姓名／學號帳號／密碼狀態／操作按鈕改為上下排列，
      // 避免標籤與四顆按鈕把文字擠成一條。
      item.style.padding = '12px 14px';
      item.style.display = 'flex';
      item.style.flexDirection = 'column';
      item.style.alignItems = 'stretch';
      item.style.textAlign = 'center';
      item.style.gap = '8px';
      item.style.minWidth = '0';

      const engStr = s.english_name ? ` (${s.english_name})` : '';
      // 第一行（座號、姓名、英文名）盡量不斷行；英文名的字母超過 12 個才把英文名移到下一行
      const engLetterCount = (s.english_name || '').replace(/[^A-Za-z]/g, '').length;
      const engOnNewLine = Boolean(s.english_name) && engLetterCount > 12;
      const codeStr = s.student_code ? (isEn ? ` (ID: ${s.student_code})` : ` (學號: ${s.student_code})`) : '';
      const numText = isEn ? `No. ${s.student_number}` : `${s.student_number}號`;
      const noCodeText = isEn ? 'No ID set' : '未設定學號';
      const accountStr = s.login_account ? (isEn ? ` · 🔑 Account: ${s.login_account}` : ` · 🔑 帳號: ${s.login_account}`) : '';
      // 密碼狀態：學生是否已自己設定過密碼（尚未＝仍是預設密碼，或老師恢復預設後還沒再改）
      const pwBadge = s.password_changed
        ? `<span style="display:inline-block; padding:2px 10px; border-radius:999px; font-size:0.74rem; font-weight:700; white-space:nowrap; background:rgba(16,185,129,0.15); color:#059669;">${isEn ? '🔒 Own password set' : '🔒 已自訂密碼'}</span>`
        : `<span style="display:inline-block; padding:2px 10px; border-radius:999px; font-size:0.74rem; font-weight:700; white-space:nowrap; background:rgba(245,158,11,0.18); color:#b45309;">${isEn ? '⚠️ Not changed yet (default)' : '⚠️ 尚未修改（預設密碼）'}</span>`;
      const hintBadge = s.has_password_hint
        ? `<span title="${isEn ? 'The student has written a password hint' : '學生已寫下密碼提醒'}" style="font-size:0.9rem;">💡</span>`
        : '';

      item.innerHTML = `
        <div style="display: flex; align-items: center; gap: 8px; min-width: 0;">
          <div style="width: 48px; height: 48px; border-radius: 50%; overflow: hidden; flex-shrink: 0;">
            ${getStudentAvatarImgHtml(s)}
          </div>
          <div style="min-width: 0; flex: 1; text-align: center;">
            <div style="font-weight: bold; font-size: 0.98rem; line-height: 1.35;">
              <span style="white-space: nowrap;">${numText} ${getStudentDisplayName(s)}</span>${engOnNewLine || !s.english_name ? '' : ` <span style="white-space: nowrap; font-weight: 500; font-size: 0.88em; color: var(--text-muted);">(${s.english_name})</span>`}
            </div>
            ${engOnNewLine ? `<div style="font-weight: 500; font-size: 0.9rem; line-height: 1.3; color: var(--text-muted); overflow-wrap: anywhere;">(${s.english_name})</div>` : ''}
            <div style="font-size: 0.78rem; color: var(--text-muted); line-height: 1.5; margin-top: 2px;">
              <div>${codeStr ? codeStr.trim() : noCodeText}</div>
              ${s.login_account ? `<div style="overflow-wrap: anywhere;">${accountStr.replace(/^ · /, '')}</div>` : ''}
            </div>
          </div>
        </div>
        <div style="display: flex; flex-direction: column; align-items: center; gap: 8px; border-top: 1px dashed var(--card-border); padding-top: 8px;">
          <div style="display: flex; align-items: center; justify-content: center; gap: 6px; flex-wrap: wrap;">${pwBadge}${hintBadge}</div>
          <div style="display: flex; justify-content: center; gap: 6px;">
            <button class="btn-logs-student btn-icon" style="width: 30px; height: 30px; font-size: 0.8rem;" title="${t('btn_view_logs')}">📜</button>
            <button class="btn-reset-student-pw btn-icon" style="width: 30px; height: 30px; font-size: 0.8rem;" title="${isEn ? 'Restore default password' : '恢復預設密碼（學號）'}">🔑</button>
            <button class="btn-edit-student btn-icon" style="width: 30px; height: 30px; font-size: 0.8rem;" title="${t('admin_edit')}">✏️</button>
            <button class="btn-del-student btn-icon" style="width: 30px; height: 30px; font-size: 0.8rem;" title="${t('admin_delete')}">✕</button>
          </div>
        </div>
      `;

      item.querySelector('.btn-logs-student').onclick = () => openStudentScoreLogsModal(s.id);
      item.querySelector('.btn-edit-student').onclick = () => openEditStudentModal(s);
      item.querySelector('.btn-reset-student-pw').onclick = async () => {
        const defaultPw = (s.student_code && String(s.student_code).trim()) || String(s.student_number).padStart(4, '0');
        const defaultKind = s.student_code && String(s.student_code).trim()
          ? (isEn ? 'student ID' : '學號')
          : (isEn ? 'seat number (4 digits; no student ID set)' : '座號四碼（此學生未填學號）');
        if (await showConfirmModal({
          icon: '🔑',
          title: isEn ? 'Restore the default password?' : '恢復預設密碼？',
          desc: isEn
            ? `${s.name}'s password will be reset to the default (${defaultKind}: ${defaultPw}). The student must set a new password at next login, and the saved password hint is cleared.`
            : `將【${s.name}】的密碼恢復為預設值（${defaultKind}：${defaultPw}）。學生下次登入時需要自己重新設定密碼，原本寫下的密碼提醒也會一併清除。`,
          confirmText: isEn ? 'Restore' : '確定恢復',
          cancelText: isEn ? 'Cancel' : '取消'
        })) {
          try {
            const res = await API.put(`/api/courses/${AppState.currentCourseId}/students/${s.id}/password`, {});
            showToast(`🔑 ${res.message}`, 'success');
            loadAdminStudentsData();
          } catch (err) {
            showToast(err.message, 'error');
          }
        }
      };
      item.querySelector('.btn-del-student').onclick = async () => {
        if (await showConfirmModal({
          icon: '🗑️',
          danger: true,
          title: isEn ? 'Delete Student Confirmation' : '刪除學生確認',
          desc: isEn ? `Are you sure you want to delete student 【${s.name}】?` : `確定要刪除學生【${s.name}】嗎？此動作將一併移除該學生之所有評分紀錄。`,
          confirmText: isEn ? 'Delete' : '確定刪除',
          cancelText: isEn ? 'Cancel' : '取消'
        })) {
          await API.delete(`/api/courses/${AppState.currentCourseId}/students/${s.id}`);
          loadStudents();
          loadAdminStudentsData();
        }
      };

      container.appendChild(item);
    });
  } catch (err) {
    console.error('Admin students load error:', err);
  }
}

// --- 學生照片：網頁上傳 / 更換 / 移除 ---

/** 將任何瀏覽器可讀的圖片縮成長邊 600px 以內的 JPEG（後端只收 JPEG，檔案也不會過大）。 */
function prepareStudentPhoto(file, maxSide = 600) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      const scale = Math.min(1, maxSide / Math.max(img.naturalWidth, img.naturalHeight));
      const canvas = document.createElement('canvas');
      canvas.width = Math.max(1, Math.round(img.naturalWidth * scale));
      canvas.height = Math.max(1, Math.round(img.naturalHeight * scale));
      const ctx = canvas.getContext('2d');
      ctx.fillStyle = '#fff';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
      URL.revokeObjectURL(url);
      canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('圖片轉換失敗'))), 'image/jpeg', 0.88);
    };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error(`無法讀取圖片：${file.name}`)); };
    img.src = url;
  });
}

/** 照片變更後：清掉前端的「無照片」快取並重新載入名冊與目前頁面。 */
async function afterStudentPhotosChanged() {
  if (window.StudentPhotoCache) { window.StudentPhotoCache.missing.clear(); window.StudentPhotoCache.loaded.clear(); }
  await loadStudents();
  loadAdminStudentsData();
  refreshActiveTab(getActiveTabName());
}

let editingPhotoStudent = null;

function setEditStudentPhotoBlock(student) {
  editingPhotoStudent = student;
  const block = document.getElementById('edit-student-photo-block');
  if (!block) return;
  if (!student) { block.style.display = 'none'; return; }
  const isEn = window.I18n && window.I18n.getLanguage() === 'en';
  block.style.display = 'flex';
  document.getElementById('edit-student-photo-preview').innerHTML = getStudentAvatarImgHtml(student);
  document.getElementById('btn-edit-student-photo-restore').style.display = student.has_photo_backup ? '' : 'none';
  document.getElementById('edit-student-photo-hint').textContent = student.student_code
    ? (isEn ? `Saved as photo/${student.student_code}.jpg` : `將儲存為 photo/${student.student_code}.jpg`)
    : (isEn ? 'Set and save a student ID first (photos are stored by ID).' : '請先設定並儲存學號（照片以學號為檔名）。');
}

async function changeEditingStudentPhoto(file) {
  const s = editingPhotoStudent;
  if (!s || !file) return;
  const isEn = window.I18n && window.I18n.getLanguage() === 'en';
  try {
    const blob = await prepareStudentPhoto(file);
    const fd = new FormData();
    fd.append('file', blob, `${s.student_code || 'photo'}.jpg`);
    await API.putFormData(`/api/courses/${AppState.currentCourseId}/students/${s.id}/photo`, fd);
    await afterStudentPhotosChanged();
    setEditStudentPhotoBlock(AppState.students.find((x) => x.id === s.id) || s);
    showToast(isEn ? 'Photo updated' : '照片已更新', 'success');
  } catch (err) {
    alert(`${isEn ? 'Photo update failed: ' : '更新照片失敗：'}${err.message}`);
  }
}

async function removeEditingStudentPhoto() {
  const s = editingPhotoStudent;
  if (!s) return;
  const isEn = window.I18n && window.I18n.getLanguage() === 'en';
  try {
    await API.delete(`/api/courses/${AppState.currentCourseId}/students/${s.id}/photo`);
    await afterStudentPhotosChanged();
    setEditStudentPhotoBlock(AppState.students.find((x) => x.id === s.id) || s);
    showToast(isEn ? 'Photo removed' : '照片已移除', 'success');
  } catch (err) {
    alert(err.message);
  }
}

/** 批次匯入的預覽視窗：列出每張照片「新增／覆蓋／找不到學號」，由教師勾選要匯入的項目。回傳選中的 File 陣列（取消則為 null）。 */
function showPhotoImportPreview(files, items) {
  const isEn = window.I18n && window.I18n.getLanguage() === 'en';
  const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  return new Promise((resolve) => {
    const urls = files.map((f) => URL.createObjectURL(f));
    // 同一學號出現多張時，預設只勾最後一張，且同學號一次只能勾一張
    const lastOf = new Map();
    items.forEach((it, i) => { if (it.status !== 'unmatched') lastOf.set(it.code, i); });
    const dupCodes = new Set(items.filter((it, i) => it.status !== 'unmatched' && items.findIndex((x) => x.code === it.code && x.status !== 'unmatched') !== i).map((it) => it.code));
    const label = { new: isEn ? 'New' : '新增', overwrite: isEn ? 'Replace existing' : '覆蓋現有照片', unmatched: isEn ? 'No matching ID' : '找不到對應學號' };
    const color = { new: '#15803d', overwrite: '#b45309', unmatched: '#94a3b8' };

    const overlay = document.createElement('div');
    overlay.style.cssText = 'position:fixed;inset:0;z-index:10000;background:rgba(15,23,42,0.55);display:flex;align-items:center;justify-content:center;padding:16px;';
    const rows = items.map((it, i) => {
      const can = it.status !== 'unmatched';
      const checked = can && lastOf.get(it.code) === i;
      // 現有照片讀不到時，與其他頁面一致改顯示預設的男／女生頭像（不顯示破圖）
      const fallback = (it.gender === 'F' || it.gender === 'female' || it.gender === '女') ? '/static/avatars/girl.png' : '/static/avatars/boy.png';
      const current = it.status === 'overwrite' ? `<img src="/photo/${encodeURIComponent(it.code)}.jpg" style="width:44px;height:44px;border-radius:50%;object-fit:cover;" onerror="this.onerror=null;this.src='${fallback}';"><span style="color:var(--text-muted);">→</span>` : '';
      return `
        <label style="display:flex;align-items:center;gap:10px;padding:8px 6px;border-bottom:1px solid var(--glass-border,#e2e8f0);${can ? 'cursor:pointer;' : 'opacity:0.55;'}">
          <input type="checkbox" data-i="${i}" ${checked ? 'checked' : ''} ${can ? '' : 'disabled'}>
          ${current}
          <img src="${urls[i]}" style="width:44px;height:44px;border-radius:50%;object-fit:cover;">
          <div style="flex:1;min-width:0;">
            <div style="font-weight:700;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${esc(it.name)}</div>
            <div style="font-size:0.78rem;color:var(--text-muted);">${can ? `${esc(isEn ? 'No.' : '座號')} ${esc(it.student_number)} ${esc(it.student_name)}（${esc(it.code)}）` : ''}${dupCodes.has(it.code) && can ? (isEn ? ' · duplicate ID: pick one' : ' · 同學號有多張，請擇一') : ''}</div>
          </div>
          <span style="font-size:0.78rem;font-weight:800;color:${color[it.status]};white-space:nowrap;">${label[it.status]}</span>
        </label>`;
    }).join('');
    const nNew = items.filter((x) => x.status === 'new').length;
    const nOver = items.filter((x) => x.status === 'overwrite').length;
    const nNo = items.filter((x) => x.status === 'unmatched').length;
    overlay.innerHTML = `
      <div style="background:var(--card-bg,#fff);color:var(--text-main,#1e293b);border-radius:16px;width:min(620px,100%);max-height:88vh;display:flex;flex-direction:column;box-shadow:0 20px 60px rgba(0,0,0,0.35);">
        <div style="padding:16px 18px 8px;">
          <div style="font-size:1.1rem;font-weight:900;">${isEn ? 'Review photo import' : '批次匯入照片：預覽'}</div>
          <div style="font-size:0.85rem;color:var(--text-muted);margin-top:4px;">
            ${isEn ? `New ${nNew} · Replace ${nOver} · Unmatched ${nNo}. Replaced photos are kept once and can be restored from the student's edit window.` : `新增 ${nNew} 張 · 覆蓋 ${nOver} 張 · 找不到學號 ${nNo} 張。被覆蓋的舊照片會保留一份，可在學生編輯視窗還原。`}
          </div>
        </div>
        <div style="overflow:auto;padding:0 12px;flex:1;">${rows}</div>
        <div style="display:flex;gap:8px;justify-content:flex-end;padding:12px 18px;align-items:center;">
          <span data-count style="margin-right:auto;font-size:0.85rem;color:var(--text-muted);"></span>
          <button type="button" class="btn btn-secondary" data-cancel>${isEn ? 'Cancel' : '取消'}</button>
          <button type="button" class="btn" data-ok>${isEn ? 'Import selected' : '匯入選取的照片'}</button>
        </div>
      </div>`;
    document.body.appendChild(overlay);

    const boxes = Array.from(overlay.querySelectorAll('input[type=checkbox]'));
    const refresh = () => {
      const n = boxes.filter((b) => b.checked).length;
      overlay.querySelector('[data-count]').textContent = isEn ? `${n} selected` : `已選 ${n} 張`;
      overlay.querySelector('[data-ok]').disabled = n === 0;
    };
    boxes.forEach((b) => b.addEventListener('change', () => {
      if (b.checked) {
        const code = items[Number(b.dataset.i)].code;
        boxes.forEach((o) => { if (o !== b && items[Number(o.dataset.i)].code === code) o.checked = false; });
      }
      refresh();
    }));
    refresh();

    const close = (result) => { urls.forEach((u) => URL.revokeObjectURL(u)); overlay.remove(); resolve(result); };
    overlay.querySelector('[data-cancel]').addEventListener('click', () => close(null));
    overlay.querySelector('[data-ok]').addEventListener('click', () => close(boxes.filter((b) => b.checked).map((b) => files[Number(b.dataset.i)])));
  });
}

/** 批次匯入：檔名（不含副檔名）須為學號；先預覽（新增／覆蓋／找不到學號）再由教師確認。 */
async function batchImportStudentPhotos(files) {
  if (!files.length) return;
  if (!ensureCourseSelected()) return;
  const isEn = window.I18n && window.I18n.getLanguage() === 'en';
  try {
    const preview = await API.post(`/api/courses/${AppState.currentCourseId}/students/photos/preview`, { names: files.map((f) => f.name) });
    const chosen = await showPhotoImportPreview(files, preview.items);
    if (!chosen || !chosen.length) return;
    const fd = new FormData();
    for (const f of chosen) {
      fd.append('files', await prepareStudentPhoto(f), f.name);
    }
    const res = await API.postFormData(`/api/courses/${AppState.currentCourseId}/students/photos`, fd);
    await afterStudentPhotosChanged();
    let msg = isEn ? `Imported ${res.saved_count} photo(s).` : `已匯入 ${res.saved_count} 張照片。`;
    if (res.skipped.length) {
      msg += (isEn ? `\n\nSkipped ${res.skipped.length}:\n` : `\n\n略過 ${res.skipped.length} 張：\n`)
        + res.skipped.slice(0, 15).map((x) => `• ${x.name}（${x.reason}）`).join('\n');
      if (res.skipped.length > 15) msg += '\n…';
    }
    alert(msg);
  } catch (err) {
    alert(`${isEn ? 'Photo import failed: ' : '匯入照片失敗：'}${err.message}`);
  }
}

/** 還原上一張照片（被覆蓋或移除前自動保留的那一張）。 */
async function restoreEditingStudentPhoto() {
  const s = editingPhotoStudent;
  if (!s) return;
  const isEn = window.I18n && window.I18n.getLanguage() === 'en';
  try {
    await API.post(`/api/courses/${AppState.currentCourseId}/students/${s.id}/photo/restore`, {});
    await afterStudentPhotosChanged();
    setEditStudentPhotoBlock(AppState.students.find((x) => x.id === s.id) || s);
    showToast(isEn ? 'Previous photo restored' : '已還原上一張照片', 'success');
  } catch (err) {
    alert(err.message);
  }
}

function openAddStudentModal() {
  if (!ensureCourseSelected()) return;
  setEditStudentPhotoBlock(null);
  const nextNumber = AppState.students.length + 1;
  document.getElementById('edit-student-id').value = '';
  document.getElementById('edit-student-number').value = nextNumber;
  document.getElementById('edit-student-code').value = '';
  // 帳號必填——預先帶入建議值（{課程ID}-{座號4碼}），教師可直接沿用或自行改成好記的帳號。
  document.getElementById('edit-student-login-account').value = `${AppState.currentCourseId}-${String(nextNumber).padStart(4, '0')}`;
  document.getElementById('edit-student-password').value = '';
  document.getElementById('edit-student-name').value = '';
  const engInput = document.getElementById('edit-student-english-name');
  if (engInput) engInput.value = '';
  document.getElementById('edit-student-gender').value = 'M';
  document.getElementById('edit-student-modal-title').textContent = window.I18n ? window.I18n.t('modal_add_student_title') : '➕ 新增學生';
  openModal('modal-edit-student');
}

function openEditStudentModal(s) {
  document.getElementById('edit-student-id').value = s.id;
  document.getElementById('edit-student-number').value = s.student_number;
  document.getElementById('edit-student-code').value = s.student_code || '';
  document.getElementById('edit-student-login-account').value = s.login_account || '';
  document.getElementById('edit-student-password').value = '';
  document.getElementById('edit-student-name').value = s.name;
  const engInput = document.getElementById('edit-student-english-name');
  if (engInput) engInput.value = s.english_name || '';
  document.getElementById('edit-student-gender').value = s.gender || 'M';
  setEditStudentPhotoBlock(s);
  const prefix = window.I18n ? window.I18n.t('modal_edit_student_title') : '✏️ 編輯學生資料';
  document.getElementById('edit-student-modal-title').textContent = `${prefix} (${getStudentDisplayName(s)})`;
  openModal('modal-edit-student');
}

async function confirmSaveStudent() {
  const sid = document.getElementById('edit-student-id').value;
  const num = parseInt(document.getElementById('edit-student-number').value);
  const code = document.getElementById('edit-student-code').value.trim();
  const loginAccount = document.getElementById('edit-student-login-account').value.trim();
  const password = document.getElementById('edit-student-password').value.trim();
  const name = document.getElementById('edit-student-name').value.trim();
  const engInput = document.getElementById('edit-student-english-name');
  const englishName = engInput ? engInput.value.trim() : '';
  const gender = document.getElementById('edit-student-gender').value;

  if (!num || !name) {
    alert(window.I18n && window.I18n.getLanguage() === 'en' ? 'Please fill in Seat No. and Name!' : '請填寫座號與姓名！');
    return;
  }
  if (!loginAccount) {
    alert(window.I18n && window.I18n.getLanguage() === 'en' ? 'Please fill in the login account!' : '請填寫學生登入帳號！');
    return;
  }

  try {
    if (sid) {
      await API.put(`/api/courses/${AppState.currentCourseId}/students/${sid}`, {
        student_number: num,
        student_code: code || null,
        login_account: loginAccount,
        name: name,
        english_name: englishName || null,
        gender: gender
      });
      // 密碼欄位留空＝不修改；有值才呼叫專屬的密碼端點更新。
      if (password) {
        await API.put(`/api/courses/${AppState.currentCourseId}/students/${sid}/password`, { password: password });
      }
    } else {
      await API.post(`/api/courses/${AppState.currentCourseId}/students`, {
        student_number: num,
        student_code: code || null,
        login_account: loginAccount,
        password: password || undefined,
        name: name,
        english_name: englishName || null,
        gender: gender
      });
    }

    document.querySelectorAll('.modal-overlay').forEach(m => m.classList.remove('open'));
    await loadStudents();
    loadAdminStudentsData();
    refreshActiveTab(getActiveTabName());
  } catch (err) {
    alert(`儲存學生資料失敗：${err.message}`);
  }
}

async function loadAdminRulesData() {
  if (!AppState.currentCourseId) return;
  try {
    const rules = await API.get(`/api/scores/${AppState.currentCourseId}/rules`);
    const container = document.getElementById('admin-rules-list');
    container.innerHTML = '';

    const isEn = window.I18n && window.I18n.getLanguage() === 'en';
    const t = (k, p) => window.I18n ? window.I18n.t(k, p) : k;

    rules.forEach(r => {
      const item = document.createElement('div');
      item.className = `rule-btn ${r.category}`;
      item.style.cursor = 'default';
      const displayTitle = window.I18n ? window.I18n.getRuleDisplayTitle(r.title) : r.title;
      item.innerHTML = `
        <span>${r.icon} ${displayTitle} (${r.score_value > 0 ? '+' : ''}${r.score_value})</span>
        <div style="display: flex; gap: 4px; margin-left: 8px;">
          <button class="btn-edit-rule btn-icon" style="width: 26px; height: 26px; font-size: 0.75rem;" title="${t('admin_edit')}">✏️</button>
          <button class="btn-del-rule btn-icon" style="width: 26px; height: 26px; font-size: 0.75rem;" title="${t('admin_delete')}">✕</button>
        </div>
      `;

      item.querySelector('.btn-edit-rule').onclick = (e) => {
        e.stopPropagation();
        openEditRuleModal(r);
      };

      item.querySelector('.btn-del-rule').onclick = async (e) => {
        e.stopPropagation();
        if (await showConfirmModal({
          icon: '🗑️',
          danger: true,
          title: isEn ? 'Delete Rule Confirmation' : '刪除評分項目確認',
          desc: isEn ? `Are you sure you want to delete rule 【${displayTitle}】?` : `確定要刪除評分項目【${r.title}】嗎？`,
          confirmText: isEn ? 'Delete' : '確定刪除',
          cancelText: isEn ? 'Cancel' : '取消'
        })) {
          await API.delete(`/api/scores/${AppState.currentCourseId}/rules/${r.id}`);
          loadAdminData();
          loadScoringData();
        }
      };

      container.appendChild(item);
    });
  } catch (err) {
    console.error('Admin load error:', err);
  }
}

function openAddRuleModal() {
  if (!ensureCourseSelected()) return;
  document.getElementById('editing-rule-id').value = '';
  document.getElementById('modal-rule-title').textContent = window.I18n ? window.I18n.t('rule_modal_title_add') : '➕ 新增自訂評分項目';
  document.getElementById('new-rule-title').value = '';
  document.getElementById('new-rule-score').value = '1';
  document.getElementById('new-rule-category').value = 'positive';
  document.getElementById('new-rule-icon').value = '⭐';
  openModal('modal-add-rule');
}

function openEditRuleModal(rule) {
  document.getElementById('editing-rule-id').value = rule.id;
  const displayTitle = window.I18n ? window.I18n.getRuleDisplayTitle(rule.title) : rule.title;
  const prefix = window.I18n ? window.I18n.t('rule_modal_title_edit') : '✏️ 編輯評分項目';
  document.getElementById('modal-rule-title').textContent = `${prefix}【${displayTitle}】`;
  document.getElementById('new-rule-title').value = rule.title;
  document.getElementById('new-rule-score').value = rule.score_value;
  document.getElementById('new-rule-category').value = rule.category;
  document.getElementById('new-rule-icon').value = rule.icon || '⭐';
  openModal('modal-add-rule');
}

async function resetRulesDefault() {
  if (!ensureCourseSelected()) return;
  const isEn = window.I18n && window.I18n.getLanguage() === 'en';
  if (!await showConfirmModal({
    icon: '🔄',
    title: isEn ? 'Restore Default Scoring Rules' : '恢復預設評分項目',
    desc: isEn ? 'Are you sure you want to restore default scoring rules? (Custom rules will be replaced)' : '確定要將本課程的評分項目恢復為預設項目嗎？(現有自訂項目將被取代)',
    confirmText: isEn ? 'Restore' : '確定恢復',
    cancelText: isEn ? 'Cancel' : '取消'
  })) {
    return;
  }
  try {
    await API.post(`/api/scores/${AppState.currentCourseId}/rules/reset_defaults`);
    showToast(isEn ? 'Scoring rules restored to default!' : '已成功恢復預設評分項目！', 'positive');
    loadAdminData();
    loadScoringData();
  } catch (err) {
    showAlertModal(`恢復預設項目失敗：${err.message}`);
  }
}

async function confirmSaveRule() {
  const editingId = document.getElementById('editing-rule-id').value;
  const title = document.getElementById('new-rule-title').value.trim();
  const score = parseInt(document.getElementById('new-rule-score').value);
  const category = document.getElementById('new-rule-category').value;
  const icon = document.getElementById('new-rule-icon').value.trim() || '⭐';

  if (!title) {
    alert(window.I18n && window.I18n.getLanguage() === 'en' ? 'Please enter rule name!' : '請輸入評分項目名稱！');
    return;
  }
  if (isNaN(score)) {
    alert(window.I18n && window.I18n.getLanguage() === 'en' ? 'Please enter a valid score number!' : '請輸入有效的分數數值！');
    return;
  }

  try {
    const payload = {
      title: title,
      score_value: score,
      category: category,
      icon: icon
    };

    if (editingId) {
      await API.put(`/api/scores/${AppState.currentCourseId}/rules/${editingId}`, payload);
    } else {
      await API.post(`/api/scores/${AppState.currentCourseId}/rules`, payload);
    }

    document.getElementById('new-rule-title').value = '';
    document.querySelectorAll('.modal-overlay').forEach(m => m.classList.remove('open'));
    loadAdminData();
    loadScoringData();
  } catch (err) {
    alert(`儲存評分項目失敗：${err.message}`);
  }
}

async function uploadStudentFile() {
  const fileInput = document.getElementById('file-import-students');
  if (!fileInput.files || fileInput.files.length === 0) {
    alert(window.I18n && window.I18n.getLanguage() === 'en' ? 'Please select an Excel or CSV file first!' : '請先選擇要匯入的 Excel 或 CSV 檔案！');
    return;
  }
  const file = fileInput.files[0];
  try {
    const res = await API.uploadFile(`/api/courses/${AppState.currentCourseId}/students/upload`, file);
    alert(window.I18n && window.I18n.getLanguage() === 'en' ? `Imported successfully! Added ${res.imported_count} students` : `匯入成功！已新增 ${res.imported_count} 位學生`);
    resetCustomFileInput(fileInput);
    loadCourses();
  } catch (err) {
    alert(`匯入失敗：${err.message}`);
  }
}

function updateExportExcelButtonState() {
  const startInput = document.getElementById('export-start-date');
  const endInput = document.getElementById('export-end-date');
  const btnExport = document.getElementById('btn-export-excel');
  if (!btnExport) return;

  const startDate = startInput ? startInput.value.trim() : '';
  const endDate = endInput ? endInput.value.trim() : '';

  if (!startDate || !endDate) {
    btnExport.disabled = true;
    btnExport.title = '請先選擇開始日期與結束日期';
    btnExport.style.opacity = '0.6';
    btnExport.style.cursor = 'not-allowed';
  } else if (startDate > endDate) {
    btnExport.disabled = true;
    btnExport.title = '開始日期不能大於結束日期';
    btnExport.style.opacity = '0.6';
    btnExport.style.cursor = 'not-allowed';
  } else {
    btnExport.disabled = false;
    btnExport.removeAttribute('title');
    btnExport.style.opacity = '1';
    btnExport.style.cursor = 'pointer';
  }
}

async function exportExcel() {
  if (!ensureCourseSelected()) return;
  const startDate = document.getElementById('export-start-date')?.value?.trim() || '';
  const endDate = document.getElementById('export-end-date')?.value?.trim() || '';

  if (!startDate || !endDate) {
    showToast('請先選擇匯出報表的開始日期與結束日期！', 'warning');
    updateExportExcelButtonState();
    return;
  }

  if (startDate > endDate) {
    showToast('開始日期不能大於結束日期，請重新選取日期區間！', 'warning');
    updateExportExcelButtonState();
    return;
  }

  const token = localStorage.getItem('auth_token') || '';
  let url = `/api/reports/${AppState.currentCourseId}/export?start_date=${encodeURIComponent(startDate)}&end_date=${encodeURIComponent(endDate)}`;

  const courseObj = (AppState.courses || []).find(c => c.id === AppState.currentCourseId);
  const safeName = (courseObj ? courseObj.name : `班級_${AppState.currentCourseId}`).replace(/[/\\?%*:|"<> ]/g, '_');
  const filename = `${safeName}_全班成績與課堂記錄.xlsx`;

  showToast('正在產生並下載 Excel 資料報表，請稍候...', 'info');

  try {
    const headers = token ? { 'Authorization': `Bearer ${token}` } : {};
    const res = await fetch(url, { headers, credentials: 'same-origin' });
    if (!res.ok) {
      const err = await res.json().catch(() => ({ detail: res.statusText }));
      throw new Error(err.detail || '匯出報表失敗');
    }

    const buffer = await res.arrayBuffer();
    const blob = new Blob([buffer], {
      type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
    });

    const blobUrl = window.URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.style.display = 'none';
    a.href = blobUrl;
    a.download = filename;
    document.body.appendChild(a);
    a.click();

    // 延遲 5 秒清理，確保 Chromium 的下載線程有充裕時間讀取 a.download 檔名與附檔名
    setTimeout(() => {
      if (document.body.contains(a)) {
        document.body.removeChild(a);
      }
      window.URL.revokeObjectURL(blobUrl);
    }, 5000);

    showToast('🎉 Excel 資料報表下載成功！', 'positive');
  } catch (err) {
    console.error('Export Excel failed:', err);
    showToast(`匯出報表失敗：${err.message}`, 'error');
  }
}

// --- Student Score Logs Modal & Logic ---
let currentLogStudentId = null;

async function openStudentScoreLogsModal(studentId) {
  if (!AppState.currentCourseId || !studentId) return;
  currentLogStudentId = studentId;

  const startDateInput = document.getElementById('score-logs-start-date');
  const endDateInput = document.getElementById('score-logs-end-date');
  if (startDateInput) startDateInput.value = '';
  if (endDateInput) endDateInput.value = '';

  const student = AppState.students.find(s => s.id === studentId);
  const titleEl = document.getElementById('score-logs-modal-title');
  const bannerEl = document.getElementById('score-logs-student-banner');
  const isEn = window.I18n && window.I18n.getLanguage() === 'en';
  const t = (k, p) => window.I18n ? window.I18n.t(k, p) : k;

  const sDisplayName = student ? getStudentDisplayName(student) : '';
  const numPrefix = isEn ? `No. ${student?.student_number}` : `${student?.student_number}號`;
  const studentNameStr = student ? `${numPrefix} ${sDisplayName}` : `ID: ${studentId}`;
  if (titleEl) {
    titleEl.textContent = isEn ? `📜 Score History - ${studentNameStr}` : `📜【${studentNameStr}】加減分歷程紀錄`;
  }

  if (bannerEl && student) {
    const groupText = student.group_name ? `${isEn ? 'Group' : '組別'}: ${student.group_name}` : (isEn ? 'Unassigned' : '未分組');
    const codeText = student.student_code ? ` | ${isEn ? 'ID' : '學號'}: ${student.student_code}` : '';
    bannerEl.innerHTML = `
      <div style="display: flex; align-items: center; gap: 12px;">
        <div style="width: 44px; height: 44px; border-radius: 50%; overflow: hidden; flex-shrink: 0; border: 2px solid var(--primary-light);">
          ${getStudentAvatarImgHtml(student)}
        </div>
        <div>
          <div style="font-weight: 800; font-size: 1.05rem;">${numPrefix} ${sDisplayName}</div>
          <div style="font-size: 0.8rem; color: var(--text-muted); font-weight: 600;">${groupText}${codeText}</div>
        </div>
      </div>
      <div id="score-logs-summary-badges" style="display: flex; gap: 8px; font-weight: 800; font-size: 0.88rem; flex-wrap: wrap;">
        <!-- Scores injected by loadStudentScoreLogs -->
      </div>
    `;
  }

  openModal('modal-student-score-logs');
  await loadStudentScoreLogs();
}

async function loadStudentScoreLogs() {
  if (!AppState.currentCourseId || !currentLogStudentId) return;

  const startDate = document.getElementById('score-logs-start-date')?.value;
  const endDate = document.getElementById('score-logs-end-date')?.value;
  const isEn = window.I18n && window.I18n.getLanguage() === 'en';
  const t = (k, p) => window.I18n ? window.I18n.t(k, p) : k;

  let url = `/api/scores/${AppState.currentCourseId}/student/${currentLogStudentId}/logs?`;
  if (startDate) url += `start_date=${startDate}&`;
  if (endDate) url += `end_date=${endDate}&`;

  try {
    const data = await API.get(url);
    const container = document.getElementById('score-logs-list-container');
    const summaryBadges = document.getElementById('score-logs-summary-badges');

    if (summaryBadges) {
      const posText = data.positive_score > 0 ? `+${data.positive_score}` : '0';
      const negText = data.negative_score;
      const totalPrefix = data.total_score > 0 ? '+' : '';
      summaryBadges.innerHTML = `
        <span style="color: #4fae82; background: rgba(79, 174, 130,0.12); padding: 4px 10px; border-radius: 9999px;">${t('badge_positive')}: ${posText}</span>
        <span style="color: #d9807e; background: rgba(217, 128, 126,0.12); padding: 4px 10px; border-radius: 9999px;">${t('badge_negative')}: ${negText}</span>
        <span style="color: #d3a24c; background: rgba(211, 162, 76,0.15); padding: 4px 10px; border-radius: 9999px; font-size: 0.92rem;">⭐ ${isEn ? 'Total' : '總分'}: ${totalPrefix}${data.total_score}</span>
      `;
    }

    if (!container) return;
    container.innerHTML = '';

    const logs = data.logs || [];
    if (logs.length === 0) {
      container.innerHTML = `
        <div style="text-align: center; color: var(--text-muted); padding: 30px; font-weight: 600; font-size: 0.95rem;">
          ${t('score_logs_empty')}
        </div>
      `;
      return;
    }

    logs.forEach(log => {
      const item = document.createElement('div');
      const isPos = log.score > 0;
      const isUndone = log.is_undone === 1;
      item.className = `score-log-item ${isPos ? 'positive' : 'negative'}`;
      if (isUndone) {
        item.style.opacity = '0.55';
        item.style.borderStyle = 'dashed';
      }

      const scoreText = log.score > 0 ? `+${log.score} ${t('pts')}` : `${log.score} ${t('pts')}`;
      const badgeClass = isPos ? 'score-log-badge-positive' : 'score-log-badge-negative';
      const catText = isPos ? t('badge_positive') : t('badge_negative');
      const displayTitle = window.I18n ? window.I18n.getRuleDisplayTitle(log.rule_title) : log.rule_title;

      const groupTagHtml = (log.group_name || log.plan_name)
        ? `<span style="font-size: 0.74rem; background: rgba(123, 152, 224, 0.15); color: #60a5fa; border: 1px solid rgba(123, 152, 224, 0.35); padding: 2px 8px; border-radius: 6px; font-weight: 700; display: inline-flex; align-items: center; gap: 4px;">🏷️ ${log.plan_name ? log.plan_name + ' · ' : ''}${log.group_name || ''}</span>`
        : `<span style="font-size: 0.74rem; background: rgba(255, 255, 255, 0.08); color: var(--text-muted); padding: 2px 7px; border-radius: 6px; font-weight: 600;">👤 ${t('score_log_personal_tag')}</span>`;

      const undoneBadgeHtml = isUndone
        ? `<span style="font-size: 0.72rem; color: #d9807e; background: rgba(217, 128, 126, 0.15); border: 1px solid rgba(217, 128, 126, 0.3); padding: 2px 6px; border-radius: 4px; font-weight: 700;">${t('score_log_revoked_badge')}</span>`
        : '';

      const actionBtnHtml = isUndone
        ? `<button class="btn-restore-score-log btn" style="font-size: 0.75rem; padding: 4px 10px; background: rgba(79, 174, 130, 0.2); color: #4fae82; border: 1px solid rgba(79, 174, 130, 0.4); border-radius: 6px; font-weight: 700; cursor: pointer;" title="${t('score_log_restore_btn')}">${t('score_log_restore_btn')}</button>`
        : `<button class="btn-del-score-log btn-icon" style="width: 28px; height: 28px; font-size: 0.8rem; color: #d9807e;" title="${t('admin_delete')}">🗑️</button>`;

      item.innerHTML = `
        <div style="display: flex; flex-direction: column; gap: 4px; min-width: 0; flex: 1;">
          <div style="display: flex; align-items: center; gap: 8px; flex-wrap: wrap;">
            <span style="font-weight: 800; font-size: 0.98rem; color: var(--text-main); ${isUndone ? 'text-decoration: line-through;' : ''}">${displayTitle}</span>
            <span style="font-size: 0.75rem; color: var(--text-muted);">${catText}</span>
            ${groupTagHtml}
            ${undoneBadgeHtml}
          </div>
          <div style="font-size: 0.78rem; color: var(--text-muted); font-family: monospace;">
            📅 ${log.timestamp || log.date}
          </div>
        </div>
        <div style="display: flex; align-items: center; gap: 10px; flex-shrink: 0;">
          <span class="${badgeClass}" style="${isUndone ? 'text-decoration: line-through; opacity: 0.6;' : ''}">${scoreText}</span>
          ${actionBtnHtml}
        </div>
      `;

      const delBtn = item.querySelector('.btn-del-score-log');
      if (delBtn) {
        delBtn.onclick = async () => {
          const groupContext = (log.group_name || log.plan_name) ? `【${log.plan_name ? log.plan_name + ' · ' : ''}${log.group_name || ''}】` : '';
          const confirmMsg = isEn 
            ? `Are you sure you want to delete score record 【${displayTitle} (${scoreText})】${groupContext}?` 
            : `確定要刪除/撤銷【${log.rule_title} (${scoreText})】${groupContext}這筆紀錄嗎？\n該筆分數將自學生與小組成績中扣除。`;
          if (await showConfirmModal(confirmMsg)) {
            try {
              await API.delete(`/api/scores/${AppState.currentCourseId}/logs/${log.id}`);
              await loadStudentScoreLogs();
              notifyScoreUpdates();
              loadScoringData();
            } catch (err) {
              alert(`刪除評分紀錄失敗：${err.message}`);
            }
          }
        };
      }

      const restoreBtn = item.querySelector('.btn-restore-score-log');
      if (restoreBtn) {
        restoreBtn.onclick = async () => {
          const groupContext = (log.group_name || log.plan_name) ? `【${log.plan_name ? log.plan_name + ' · ' : ''}${log.group_name || ''}】` : '';
          const confirmMsg = isEn
            ? `Restore score record 【${displayTitle} (${scoreText})】${groupContext}?`
            : `確定要回復【${log.rule_title} (${scoreText})】${groupContext}這筆紀錄嗎？\n該筆分數將重新計入學生與小組成績。`;
          if (await showConfirmModal(confirmMsg)) {
            try {
              await API.post(`/api/scores/${AppState.currentCourseId}/logs/${log.id}/restore`);
              showToast(t('score_log_restored_toast'), 'positive');
              await loadStudentScoreLogs();
              notifyScoreUpdates();
              loadScoringData();
            } catch (err) {
              alert(`回復評分紀錄失敗：${err.message}`);
            }
          }
        };
      }

      container.appendChild(item);
    });
  } catch (err) {
    console.error('loadStudentScoreLogs error:', err);
  }
}
