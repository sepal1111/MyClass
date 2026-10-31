// MyClass 教師端：學生與班級載入、空白提示
// 由 static/js/app.js 拆出（2026-10-31，原第 1205–1381 行），程式內容未變更。
// 所有 static/js/app.js 與 static/js/app/*.js 共用同一個全域範圍（一般 <script>，不是模組），載入順序見 static/index.html。


// --- Courses & Students ---
async function loadStudents() {
  if (!AppState.currentCourseId) return [];
  try {
    // Dashboard (not the plain roster) so every AppState.students entry keeps
    // its is_absent flag — Lucky Draw reads this, and this function is what
    // quickAwardScore() calls to refresh state right after a draw, so an
    // is_absent-less roster here silently breaks the "skip absent" filter on
    // the very next draw.
    const dashData = await API.get(`/api/reports/${AppState.currentCourseId}/dashboard?period=today`);
    const students = dashData.students || [];
    AppState.students = students;
    if (window.TeachingToolkit) {
      window.TeachingToolkit.onCourseLoaded(AppState.currentCourseId, AppState.students, AppState.groups);
    }
    return students;
  } catch (err) {
    console.error('loadStudents error:', err);
    return [];
  }
}

// --- Empty State UI Helpers ---
function renderEmptyCourseNotice(container, customTitle = null) {
  if (!container) return;
  const isEn = window.I18n && window.I18n.getLanguage() === 'en';
  const t = (k, p) => window.I18n ? window.I18n.t(k, p) : k;

  const title = customTitle || (isEn ? 'No courses in system yet' : '目前系統中尚無任何班級');
  const desc = isEn 
    ? 'Welcome to the Classroom Management System! Click the button below to create your first class. Once created, you can import student rosters, arrange seating, organize group competitions, and assign points!'
    : '歡迎使用國小課堂即時記錄系統！請先點擊下方按鈕建立您的第一個班級課程。建立班級後即可進行學生名冊匯入、座位劃分、小組競賽與點數評分！';
  const createBtnText = isEn ? '➕ Click here to create a class' : '➕ 請按此先建立班級';
  const templateTitle = isEn ? '📥 Student roster sample files (ready to import once created):' : '📥 學生名冊匯入範例檔案下載（建立班級後可直接匯入）：';
  const dlExcel = isEn ? '📥 Download Excel Sample (.xlsx)' : '📥 下載 Excel 範例檔 (.xlsx)';
  const dlCsv = isEn ? '📥 Download CSV Sample (.csv)' : '📥 下載 CSV 範例檔 (.csv)';

  container.innerHTML = `
    <div class="glass-card" style="text-align: center; padding: 36px 20px; background: linear-gradient(135deg, rgba(91, 124, 214,0.06), rgba(149, 117, 196,0.06)); border: 2px dashed var(--primary-light); grid-column: 1 / -1; margin: 10px 0;">
      <div style="font-size: 3rem; margin-bottom: 12px;">🏫</div>
      <div style="font-size: 1.3rem; font-weight: 800; color: var(--text-main); margin-bottom: 8px;">${title}</div>
      <div style="font-size: 0.92rem; color: var(--text-muted); max-width: 500px; margin: 0 auto 20px; line-height: 1.6;">
        ${desc}
      </div>
      <div style="display: flex; gap: 12px; justify-content: center; flex-wrap: wrap; margin-bottom: 24px;">
        <button onclick="openModal('modal-add-course')" class="btn" style="padding: 10px 24px; font-size: 1.05rem; font-weight: 800; box-shadow: var(--shadow-primary);">
          ${createBtnText}
        </button>
      </div>
      <div style="border-top: 1px dashed var(--card-border); padding-top: 18px; margin-top: 10px;">
        <div style="font-size: 0.9rem; font-weight: 700; color: var(--text-muted); margin-bottom: 12px;">
          ${templateTitle}
        </div>
        <div style="display: flex; gap: 12px; justify-content: center; flex-wrap: wrap;">
          <a href="/api/courses/template/students_excel" data-auth-download="學生名冊匯入範例.xlsx" class="btn btn-secondary" style="text-decoration: none; padding: 8px 16px; font-size: 0.9rem; display: inline-flex; align-items: center; gap: 6px;">
            ${dlExcel}
          </a>
          <a href="/api/courses/template/students_csv" data-auth-download="學生名冊匯入範例.csv" class="btn btn-secondary" style="text-decoration: none; padding: 8px 16px; font-size: 0.9rem; display: inline-flex; align-items: center; gap: 6px;">
            ${dlCsv}
          </a>
        </div>
      </div>
    </div>
  `;
}

function renderEmptyStudentRosterNotice(container) {
  if (!container) return;
  const isEn = window.I18n && window.I18n.getLanguage() === 'en';
  const t = (k, p) => window.I18n ? window.I18n.t(k, p) : k;

  const title = isEn ? 'No student roster in this class yet' : '本班級目前尚無學生名冊';
  const desc = isEn
    ? 'You can add students manually, paste a text list, or download the template file to upload and import all students at once!'
    : '您可以使用下方按鈕手動新增單一位學生、貼上文字名單，或先下載標準範例檔，填寫完畢後上傳匯入全班學生！';
  const addBtn = isEn ? '➕ Add Student Manually' : '➕ 手動新增學生';
  const importBtn = isEn ? '📥 Import Student Roster' : '📥 匯入學生名冊';
  const templateTitle = isEn ? '📥 Student roster template download:' : '📥 學生名冊範本檔案下載：';
  const dlExcel = isEn ? '📥 Download Excel Template (.xlsx)' : '📥 下載 Excel 範本 (.xlsx)';
  const dlCsv = isEn ? '📥 Download CSV Template (.csv)' : '📥 下載 CSV 範本 (.csv)';

  container.innerHTML = `
    <div class="glass-card" style="text-align: center; padding: 36px 20px; border: 2px dashed var(--card-border); grid-column: 1 / -1; margin: 10px 0;">
      <div style="font-size: 2.8rem; margin-bottom: 10px;">👨‍🎓</div>
      <div style="font-size: 1.2rem; font-weight: 800; color: var(--text-main); margin-bottom: 6px;">${title}</div>
      <div style="font-size: 0.9rem; color: var(--text-muted); max-width: 480px; margin: 0 auto 18px; line-height: 1.6;">
        ${desc}
      </div>
      <div style="display: flex; gap: 12px; justify-content: center; flex-wrap: wrap; margin-bottom: 20px;">
        <button onclick="openAddStudentModal()" class="btn btn-secondary" style="padding: 8px 18px; font-size: 0.9rem;">${addBtn}</button>
        <button onclick="openModal('modal-import-students')" class="btn" style="padding: 8px 20px; font-size: 0.9rem; font-weight: 700;">${importBtn}</button>
      </div>
      <div style="border-top: 1px dashed var(--card-border); padding-top: 16px; margin-top: 6px;">
        <div style="font-size: 0.85rem; font-weight: 700; color: var(--text-muted); margin-bottom: 10px;">${templateTitle}</div>
        <div style="display: flex; gap: 10px; justify-content: center; flex-wrap: wrap;">
          <a href="/api/courses/template/students_excel" data-auth-download="學生名冊匯入範例.xlsx" class="btn btn-secondary" style="text-decoration: none; padding: 6px 14px; font-size: 0.85rem; display: inline-flex; align-items: center; gap: 6px;">${dlExcel}</a>
          <a href="/api/courses/template/students_csv" data-auth-download="學生名冊匯入範例.csv" class="btn btn-secondary" style="text-decoration: none; padding: 6px 14px; font-size: 0.85rem; display: inline-flex; align-items: center; gap: 6px;">${dlCsv}</a>
        </div>
      </div>
    </div>
  `;
}

function renderActiveTabEmptyNotice() {
  renderEmptyCourseNotice(document.getElementById('scoring-student-grid'));
  renderEmptyCourseNotice(document.getElementById('scoring-seating-grid'));
  renderEmptyCourseNotice(document.getElementById('attendance-student-grid'));
  renderEmptyCourseNotice(document.getElementById('seating-grid'));
  renderEmptyCourseNotice(document.getElementById('group-columns-container'));
  renderEmptyCourseNotice(document.getElementById('notes-list-container'));
  renderEmptyCourseNotice(document.getElementById('all-students-score-grid'));
  renderEmptyCourseNotice(document.getElementById('individual-leaderboard'));
  renderEmptyCourseNotice(document.getElementById('admin-students-list-container'));
  renderEmptyCourseNotice(document.getElementById('materials-units-list'));
  if (window.TeachingToolkit) window.TeachingToolkit.setCourseAvailability(false);
}

function renderCourseSelectOptions() {
  const select = document.getElementById('course-select');
  const btnDelete = document.getElementById('btn-delete-course');
  const btnPaneDelete = document.getElementById('btn-pane-delete-course');
  if (!select) return;
  const isEn = window.I18n && window.I18n.getLanguage() === 'en';
  const courses = AppState.courses || [];

  if (btnDelete) btnDelete.disabled = courses.length === 0;
  if (btnPaneDelete) btnPaneDelete.disabled = courses.length === 0;

  if (courses.length === 0) {
    select.innerHTML = `<option value="">${isEn ? '(No class, click ➕ to add)' : '(無課程，請按 ➕ 新增)'}</option>`;
    return;
  }

  const currentVal = AppState.currentCourseId || select.value;
  select.innerHTML = '';
  courses.forEach(c => {
    const opt = document.createElement('option');
    opt.value = c.id;
    const countText = isEn ? `${c.student_count || 0} students` : `${c.student_count || 0}人`;
    opt.textContent = `${c.teacher_type === 'homeroom' ? '🏫' : '🎨'} ${c.name} (${countText})`;
    select.appendChild(opt);
  });

  if (currentVal && courses.some(c => c.id == currentVal)) {
    select.value = currentVal;
  }
}

async function loadCourses() {
  try {
    const courses = await API.get('/api/courses');
    AppState.courses = courses;
    renderCourseSelectOptions();

    if (courses.length === 0) {
      AppState.currentCourseId = null;
      renderActiveTabEmptyNotice();
      openModal('modal-add-course');
      return;
    }

    if (!AppState.currentCourseId && courses.length > 0) {
      AppState.currentCourseId = courses[0].id;
    } else if (courses.length > 0 && !courses.some(c => c.id === AppState.currentCourseId)) {
      AppState.currentCourseId = courses[0].id;
    }

    const select = document.getElementById('course-select');
    if (select) select.value = AppState.currentCourseId;
    syncAppRealtimeConnection();
    refreshActiveTab(getActiveTabName());
  } catch (err) {
    const isEn = window.I18n && window.I18n.getLanguage() === 'en';
    alert(isEn ? `Failed to load courses: ${err.message}` : `載入課程失敗：${err.message}`);
  }
}
