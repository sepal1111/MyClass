// MyClass 教師端：特殊表現紀錄（文字與影音附件）
// 由 static/js/app.js 拆出（2026-10-31，原第 3419–3684 行），程式內容未變更。
// 所有 static/js/app.js 與 static/js/app/*.js 共用同一個全域範圍（一般 <script>，不是模組），載入順序見 static/index.html。


// --- Qualitative Notes Pane ---

// 常用片語：點一下就帶入文字，課堂中不必打字（電腦版紀錄頁與評分頁的快速紀錄視窗共用）
const NOTE_QUICK_PHRASES = [
  { zh: '主動發言', en: 'Spoke up', tone: 'pos' },
  { zh: '專注認真', en: 'Focused', tone: 'pos' },
  { zh: '幫助同學', en: 'Helped a classmate', tone: 'pos' },
  { zh: '進步明顯', en: 'Clear progress', tone: 'pos' },
  { zh: '創意表現', en: 'Creative work', tone: 'pos' },
  { zh: '分享想法', en: 'Shared ideas', tone: 'pos' },
  { zh: '需要提醒', en: 'Needs a reminder', tone: 'neg' },
  { zh: '情緒不穩', en: 'Upset', tone: 'neg' },
  { zh: '與同學衝突', en: 'Conflict with peers', tone: 'neg' },
  { zh: '作業未完成', en: 'Homework missing', tone: 'neg' }
];

function renderNotePhraseChips(containerId, textareaId) {
  const container = document.getElementById(containerId);
  const textarea = document.getElementById(textareaId);
  if (!container || !textarea) return;
  const isEn = window.I18n && window.I18n.getLanguage() === 'en';
  container.innerHTML = '';
  NOTE_QUICK_PHRASES.forEach(ph => {
    const label = isEn ? ph.en : ph.zh;
    const chip = document.createElement('button');
    chip.type = 'button';
    chip.className = `note-phrase-chip ${ph.tone}`;
    chip.textContent = label;
    chip.addEventListener('click', () => {
      const cur = textarea.value.trim();
      if (cur.includes(label)) return;
      textarea.value = cur ? `${cur}${isEn ? ', ' : '、'}${label}` : label;
      textarea.focus();
    });
    container.appendChild(chip);
  });
}

// 「拍照／錄影」與「選擇檔案」兩個輸入擇一：選了其中一個就清掉另一個
function bindExclusiveMediaInputs(inputIds) {
  const inputs = inputIds.map(id => document.getElementById(id)).filter(Boolean);
  inputs.forEach(inp => {
    inp.addEventListener('change', () => {
      if (!inp.files || inp.files.length === 0) return;
      inputs.forEach(other => { if (other !== inp) other.value = ''; });
    });
  });
}

function getNoteMediaFile(inputIds) {
  for (const id of inputIds) {
    const el = document.getElementById(id);
    if (el && el.files && el.files[0]) return el.files[0];
  }
  return null;
}

function resetNoteMedia(inputIds) {
  inputIds.forEach(id => resetCustomFileInput(document.getElementById(id)));
}

const NOTE_MEDIA_INPUT_IDS = ['note-media-camera', 'note-media-file'];
const QUICK_NOTE_MEDIA_INPUT_IDS = ['quick-note-media-camera', 'quick-note-media-file'];

function setNoteDate(dateStr) {
  const input = document.getElementById('note-date');
  if (input) input.value = dateStr;
  const label = document.getElementById('note-date-text');
  if (label) {
    const t = (k, p) => window.I18n ? window.I18n.t(k, p) : k;
    label.textContent = dateStr === getTaiwanTodayDateStr() ? `${dateStr}（${t('notes_date_today')}）` : dateStr;
  }
}

function selectNoteStudent(studentId) {
  const hidden = document.getElementById('note-student-select');
  if (!hidden) return;
  const next = String(hidden.value) === String(studentId) ? '' : String(studentId);
  hidden.value = next;
  document.querySelectorAll('#note-student-picker .note-student-chip').forEach(chip => {
    chip.classList.toggle('selected', next !== '' && chip.dataset.studentId === next);
  });
}

function renderNoteStudentPicker(students) {
  const picker = document.getElementById('note-student-picker');
  const hidden = document.getElementById('note-student-select');
  if (!picker || !hidden) return;
  const isEn = window.I18n && window.I18n.getLanguage() === 'en';
  const keep = hidden.value;
  picker.innerHTML = '';
  students.forEach(s => {
    const chip = document.createElement('button');
    chip.type = 'button';
    chip.className = 'note-student-chip';
    chip.dataset.studentId = s.id;

    const avatar = document.createElement('span');
    avatar.className = 'note-student-avatar';
    avatar.innerHTML = getStudentAvatarImgHtml(s);
    const num = document.createElement('span');
    num.className = 'note-student-num';
    num.textContent = isEn ? `No.${s.student_number}` : `${s.student_number}號`;
    const name = document.createElement('span');
    name.className = 'note-student-name';
    name.textContent = getStudentDisplayName(s);

    chip.append(avatar, num, name);
    chip.addEventListener('click', () => selectNoteStudent(s.id));
    picker.appendChild(chip);
  });
  hidden.value = '';
  if (keep && students.some(s => String(s.id) === String(keep))) selectNoteStudent(keep);
}

function initNoteQuickForm() {
  renderNotePhraseChips('note-phrase-chips', 'note-text-input');
  bindExclusiveMediaInputs(NOTE_MEDIA_INPUT_IDS);
  bindExclusiveMediaInputs(QUICK_NOTE_MEDIA_INPUT_IDS);

  const toggleBtn = document.getElementById('btn-note-toggle-date');
  const editWrap = document.getElementById('note-date-edit-wrap');
  if (toggleBtn && editWrap) {
    toggleBtn.addEventListener('click', () => {
      const show = editWrap.style.display === 'none';
      editWrap.style.display = show ? 'inline-flex' : 'none';
    });
  }
  const dateInput = document.getElementById('note-date');
  if (dateInput) {
    const sync = () => { if (dateInput.value) setNoteDate(dateInput.value); };
    dateInput.addEventListener('change', sync);
    dateInput.addEventListener('input', sync);
  }
}

async function loadNotesData() {
  if (!AppState.currentCourseId || (AppState.courses && AppState.courses.length === 0)) {
    renderEmptyCourseNotice(document.getElementById('notes-list-container'));
    return;
  }
  try {
    const [students, notes] = await Promise.all([
      API.get(`/api/courses/${AppState.currentCourseId}/students`),
      API.get(`/api/notes/${AppState.currentCourseId}`)
    ]);

    renderNoteStudentPicker(students);
    setNoteDate(getTaiwanTodayDateStr());
    renderNotePhraseChips('note-phrase-chips', 'note-text-input');
    renderNotesList(notes);
  } catch (err) {
    console.error('Notes load error:', err);
  }
}

function renderNotesList(notes) {
  const container = document.getElementById('notes-list-container');
  container.innerHTML = '';

  const isEn = window.I18n && window.I18n.getLanguage() === 'en';
  const t = (k, p) => window.I18n ? window.I18n.t(k, p) : k;

  if (notes.length === 0) {
    container.innerHTML = `<div style="color: var(--text-muted); text-align: center; padding: 20px;">${t('notes_no_records')}</div>`;
    return;
  }

  notes.forEach(note => {
    const item = document.createElement('div');
    item.className = 'glass-card';
    item.style.padding = '14px';
    item.style.marginBottom = '10px';

    let mediaHtml = '';
    if (note.media_url) {
      if (note.media_type === 'video') {
        mediaHtml = `<video src="${note.media_url}" controls style="max-width: 100%; max-height: 360px; border-radius: 8px; margin-top: 10px; display: block; border: 1px solid var(--card-border);"></video>`;
      } else {
        mediaHtml = `<img src="${note.media_url}" alt="照片" style="max-width: 100%; max-height: 360px; border-radius: 8px; margin-top: 10px; display: block; cursor: pointer; border: 1px solid var(--card-border);" onclick="window.open('${note.media_url}', '_blank')">`;
      }
    }

    const noteStudent = AppState.students.find(s => s.id === note.student_id) || { id: note.student_id, student_number: note.student_number, name: note.student_name };
    const numText = isEn ? `No. ${note.student_number}` : `${note.student_number}號`;

    item.innerHTML = `
      <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 6px; font-weight: bold; color: var(--primary-light);">
        <div style="display: flex; align-items: center; gap: 8px;">
          <div style="width: 28px; height: 28px; border-radius: 50%; overflow: hidden; flex-shrink: 0;">
            ${getStudentAvatarImgHtml(noteStudent)}
          </div>
          <span>${numText} ${getStudentDisplayName(noteStudent)}</span>
        </div>
        <div style="display: flex; align-items: center; gap: 8px;">
          <span style="font-size: 0.8rem; color: var(--text-muted);">${note.timestamp}</span>
          <button class="btn-del-note btn-icon" style="width: 24px; height: 24px; font-size: 0.7rem;" title="刪除紀錄">✕</button>
        </div>
      </div>
      <div style="font-size: 0.95rem; line-height: 1.5; white-space: pre-wrap;">${note.note_text}</div>
      ${mediaHtml}
    `;

    item.querySelector('.btn-del-note').onclick = async () => {
      const isEn = window.I18n && window.I18n.getLanguage() === 'en';
      if (await showConfirmModal({
        icon: '🗑️',
        danger: true,
        title: isEn ? 'Delete Note' : '刪除特殊表現紀錄',
        desc: t('notes_delete_confirm'),
        confirmText: isEn ? 'Delete' : '確定刪除',
        cancelText: isEn ? 'Cancel' : '取消'
      })) {
        await API.delete(`/api/notes/${AppState.currentCourseId}/${note.id}`);
        loadNotesData();
      }
    };

    container.appendChild(item);
  });
}

async function saveNote() {
  if (!ensureCourseSelected()) return;
  const studentId = document.getElementById('note-student-select').value;
  const noteText = document.getElementById('note-text-input').value.trim();
  const dateStr = document.getElementById('note-date').value || getTaiwanTodayDateStr();
  const mediaFile = getNoteMediaFile(NOTE_MEDIA_INPUT_IDS);
  const t = (k, p) => window.I18n ? window.I18n.t(k, p) : k;

  if (!studentId) {
    alert(t('notes_need_student'));
    return;
  }
  if (!noteText && !mediaFile) {
    alert('請輸入紀錄內容或選擇要上傳的照片/影片！');
    return;
  }

  try {
    if (mediaFile) {
      const formData = new FormData();
      formData.append('student_id', studentId);
      formData.append('note_text', noteText || '【多媒體特殊表現紀錄】');
      formData.append('date_str', dateStr);
      formData.append('media_file', mediaFile);

      await API.postFormData(`/api/notes/${AppState.currentCourseId}/with_media`, formData);
    } else {
      await API.post(`/api/notes/${AppState.currentCourseId}`, {
        student_id: parseInt(studentId),
        note_text: noteText,
        date: dateStr
      });
    }

    // 存完清空學生選取，避免連續紀錄時誤記到同一位學生
    document.getElementById('note-text-input').value = '';
    resetNoteMedia(NOTE_MEDIA_INPUT_IDS);
    document.getElementById('note-student-select').value = '';
    loadNotesData();
  } catch (err) {
    alert(`儲存筆記失敗：${err.message}`);
  }
}
