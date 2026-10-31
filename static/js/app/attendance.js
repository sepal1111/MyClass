// MyClass 教師端：出缺席點名
// 由 static/js/app.js 拆出（2026-10-31，原第 2596–2730 行），程式內容未變更。
// 所有 static/js/app.js 與 static/js/app/*.js 共用同一個全域範圍（一般 <script>，不是模組），載入順序見 static/index.html。


// --- Attendance Pane ---
async function loadAttendanceData() {
  if (!AppState.currentCourseId || (AppState.courses && AppState.courses.length === 0)) {
    renderEmptyCourseNotice(document.getElementById('attendance-student-grid'));
    return;
  }
  const dateInput = document.getElementById('attendance-date');
  if (!dateInput.value) {
    dateInput.value = getTaiwanTodayDateStr();
  }

  try {
    const data = await API.get(`/api/attendance/${AppState.currentCourseId}?date=${dateInput.value}`);
    AppState.attendanceRecords = data.records;
    renderAttendanceGrid();
  } catch (err) {
    console.error('Attendance load error:', err);
  }
}

function renderAttendanceGrid() {
  const container = document.getElementById('attendance-student-grid');
  container.innerHTML = '';

  const summary = { present: 0, sick_leave: 0, personal_leave: 0, official_leave: 0, bereavement_leave: 0, late: 0 };
  const isEn = window.I18n && window.I18n.getLanguage() === 'en';
  const t = (k, p) => window.I18n ? window.I18n.t(k, p) : k;

  AppState.attendanceRecords.forEach(rec => {
    // If historical data had 'absent', map gracefully to 'sick_leave'
    if (rec.status === 'absent') rec.status = 'sick_leave';
    summary[rec.status] = (summary[rec.status] || 0) + 1;

    const card = document.createElement('div');
    const isNotPresent = rec.status !== 'present';
    card.className = `student-card ${isNotPresent ? 'absent' : ''} ${isNotPresent ? `att-${rec.status}` : ''}`;
    const labelMap = {
      sick_leave: t('att_sick_leave'),
      personal_leave: t('att_personal_leave'),
      official_leave: t('att_official_leave'),
      bereavement_leave: t('att_bereavement_leave'),
      late: t('att_late')
    };
    if (isNotPresent) {
      card.setAttribute('data-att-label', labelMap[rec.status] || 'Leave');
    }
    
    const displayName = getStudentDisplayName(rec);
    const numText = isEn ? `No. ${rec.student_number}` : `${rec.student_number} 號`;

    card.innerHTML = `
      <div class="student-avatar gender-${rec.gender}" style="overflow: hidden; padding: 0;">
        ${getStudentAvatarImgHtml(rec)}
      </div>
      <div class="student-number">${numText}</div>
      <div class="student-name" title="${displayName}">${displayName}</div>
      <div style="margin-top: 8px; width: 100%;">
        <select class="input-control att-status-select" style="font-size: 0.82rem; padding: 5px; font-weight: 700;">
          <option value="present" ${rec.status === 'present' ? 'selected' : ''}>✅ ${t('att_present')}</option>
          <option value="sick_leave" ${rec.status === 'sick_leave' ? 'selected' : ''}>🤒 ${t('att_sick_leave')}</option>
          <option value="personal_leave" ${rec.status === 'personal_leave' ? 'selected' : ''}>🏠 ${t('att_personal_leave')}</option>
          <option value="official_leave" ${rec.status === 'official_leave' ? 'selected' : ''}>🏛️ ${t('att_official_leave')}</option>
          <option value="bereavement_leave" ${rec.status === 'bereavement_leave' ? 'selected' : ''}>🖤 ${t('att_bereavement_leave')}</option>
          <option value="late" ${rec.status === 'late' ? 'selected' : ''}>⏰ ${t('att_late')}</option>
        </select>
      </div>
    `;

    const select = card.querySelector('.att-status-select');
    select.addEventListener('change', (e) => {
      rec.status = e.target.value;
      const isNowNotPresent = rec.status !== 'present';
      card.className = `student-card ${isNowNotPresent ? 'absent' : ''} ${isNowNotPresent ? `att-${rec.status}` : ''}`;
      if (isNowNotPresent) {
        card.setAttribute('data-att-label', labelMap[rec.status] || 'Leave');
      } else {
        card.removeAttribute('data-att-label');
      }

      // Realtime recalculate summary
      const newSummary = { present: 0, sick_leave: 0, personal_leave: 0, official_leave: 0, bereavement_leave: 0, late: 0 };
      AppState.attendanceRecords.forEach(r => {
        const st = (r.status === 'absent') ? 'sick_leave' : r.status;
        newSummary[st] = (newSummary[st] || 0) + 1;
      });
      renderAttendanceSummary(newSummary);
    });

    container.appendChild(card);
  });

  renderAttendanceSummary(summary);
}

function renderAttendanceSummary(summary) {
  const container = document.getElementById('attendance-summary');
  const t = (k, p) => window.I18n ? window.I18n.t(k, p) : k;
  container.innerHTML = `
    <span style="color: #4fae82; background: rgba(79, 174, 130,0.1); padding: 5px 12px; border-radius: 9999px; font-size: 0.88rem; font-weight: 800;">${t('att_summary_present', {count: summary.present || 0})}</span>
    <span style="color: #9a86c4; background: rgba(154, 134, 196,0.1); padding: 5px 12px; border-radius: 9999px; font-size: 0.88rem; font-weight: 800;">${t('att_summary_sick_leave', {count: summary.sick_leave || 0})}</span>
    <span style="color: #ec4899; background: rgba(236,72,153,0.1); padding: 5px 12px; border-radius: 9999px; font-size: 0.88rem; font-weight: 800;">${t('att_summary_personal_leave', {count: summary.personal_leave || 0})}</span>
    <span style="color: #5f9fcf; background: rgba(95, 159, 207,0.1); padding: 5px 12px; border-radius: 9999px; font-size: 0.88rem; font-weight: 800;">${t('att_summary_official_leave', {count: summary.official_leave || 0})}</span>
    <span style="color: #475569; background: rgba(71,85,105,0.12); padding: 5px 12px; border-radius: 9999px; font-size: 0.88rem; font-weight: 800;">${t('att_summary_bereavement_leave', {count: summary.bereavement_leave || 0})}</span>
    <span style="color: #d3a24c; background: rgba(211, 162, 76,0.1); padding: 5px 12px; border-radius: 9999px; font-size: 0.88rem; font-weight: 800;">${t('att_summary_late', {count: summary.late || 0})}</span>
  `;
}

function setAllAttendancePresent() {
  if (!AppState.attendanceRecords || AppState.attendanceRecords.length === 0) return;
  AppState.attendanceRecords.forEach(r => {
    r.status = 'present';
  });
  renderAttendanceGrid();
}

async function saveAttendance() {
  if (!ensureCourseSelected()) return;
  const dateStr = document.getElementById('attendance-date').value;
  const items = AppState.attendanceRecords.map(r => ({
    student_id: r.student_id,
    status: r.status
  }));

  try {
    const res = await API.post(`/api/attendance/${AppState.currentCourseId}`, {
      date: dateStr,
      items: items
    });

    showUndoToast(res.undo_id, `已完成 ${dateStr} 課堂點名紀錄`);
  } catch (err) {
    alert(`儲存點名失敗：${err.message}`);
  }
}
