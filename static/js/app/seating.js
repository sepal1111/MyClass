// MyClass 教師端：座位表與自動分組
// 由 static/js/app.js 拆出（2026-10-31，原第 3223–3418 行），程式內容未變更。
// 所有 static/js/app.js 與 static/js/app/*.js 共用同一個全域範圍（一般 <script>，不是模組），載入順序見 static/index.html。


// --- Seating Chart Pane ---
async function loadSeatingData() {
  if (!AppState.currentCourseId || (AppState.courses && AppState.courses.length === 0)) {
    renderEmptyCourseNotice(document.getElementById('seating-grid'));
    return;
  }
  try {
    const data = await API.get(`/api/seating/${AppState.currentCourseId}`);
    document.getElementById('seat-rows-input').value = data.seat_rows;
    document.getElementById('seat-cols-input').value = data.seat_cols;
    
    const bbPos = data.blackboard_position || 'top';
    const posInput = document.getElementById('seat-blackboard-pos-input');
    if (posInput) posInput.value = bbPos;

    ['top', 'bottom', 'left', 'right'].forEach(p => {
      const el = document.getElementById(`podium-banner-${p}`);
      if (el) el.style.display = (p === bbPos) ? 'block' : 'none';
    });

    AppState.seatingData = data;
    renderSeatingGrid(data);
  } catch (err) {
    console.error('Seating load error:', err);
  }
}

function renderSeatingGrid(data) {
  const container = document.getElementById('seating-grid');
  container.style.gridTemplateColumns = `repeat(${data.seat_cols}, minmax(110px, 1fr))`;
  container.innerHTML = '';

  const isEn = window.I18n && window.I18n.getLanguage() === 'en';
  const t = (k, p) => window.I18n ? window.I18n.t(k, p) : k;

  (data.grid || []).forEach(rowCells => {
    rowCells.forEach(cell => {
      const seatEl = document.createElement('div');
      const student = cell.student;
      seatEl.className = `seat-cell ${student ? 'occupied' : 'empty'}`;
      seatEl.dataset.row = cell.row;
      seatEl.dataset.col = cell.col;

      if (student) {
        seatEl.draggable = true;
        seatEl.dataset.studentId = student.id;
        const numText = isEn ? `No. ${student.student_number}` : `${student.student_number}號`;

        seatEl.innerHTML = `
          <div class="seat-coord-badge">(${cell.row},${cell.col})</div>
          <div style="margin-top: 4px; display: flex; justify-content: center;">
            <div style="width: 42px; height: 42px; border-radius: 50%; overflow: hidden; border: 1.5px solid var(--primary-light);">
              ${getStudentAvatarImgHtml(student)}
            </div>
          </div>
          <div style="font-size: 0.8rem; color: var(--text-muted); font-weight: bold; margin-top: 2px;">${numText}</div>
          <div style="font-size: 0.9rem; font-weight: bold;" title="${getStudentDisplayName(student)}">${getStudentDisplayName(student)}</div>
        `;

        seatEl.addEventListener('dragstart', (e) => {
          e.dataTransfer.setData('text/plain', student.id);
          seatEl.style.opacity = '0.5';
        });

        seatEl.addEventListener('dragend', () => {
          seatEl.style.opacity = '1';
        });
      } else {
        seatEl.innerHTML = `
          <div class="seat-coord-badge">(${cell.row},${cell.col})</div>
          <div style="font-size: 0.8rem; margin-top: 10px;">${t('seating_empty_slot')}</div>
        `;
      }

      // Drag Over & Drop on seat
      seatEl.addEventListener('dragover', (e) => {
        e.preventDefault();
        seatEl.classList.add('drag-over');
      });

      seatEl.addEventListener('dragleave', () => {
        seatEl.classList.remove('drag-over');
      });

      seatEl.addEventListener('drop', async (e) => {
        e.preventDefault();
        seatEl.classList.remove('drag-over');
        const studentId = e.dataTransfer.getData('text/plain');
        if (!studentId) return;

        try {
          await API.put(`/api/seating/${AppState.currentCourseId}/drag`, {
            student_id: parseInt(studentId),
            target_row: cell.row,
            target_col: cell.col
          });
          loadSeatingData();
        } catch (err) {
          alert(`座位調整失敗：${err.message}`);
        }
      });

      container.appendChild(seatEl);
    });
  });

  // Render unassigned students
  const unassignedContainer = document.getElementById('seating-unassigned-list');
  unassignedContainer.innerHTML = '';

  if ((data.unassigned || []).length === 0) {
    unassignedContainer.innerHTML = `<div style="color: var(--text-muted); font-size: 0.85rem;">${t('seating_all_seated')}</div>`;
  } else {
    data.unassigned.forEach(s => {
      const card = document.createElement('div');
      card.className = 'student-card';
      card.draggable = true;
      card.dataset.studentId = s.id;
      const numText = isEn ? `No. ${s.student_number}` : `${s.student_number}號`;

      card.innerHTML = `
        <div class="student-avatar gender-${s.gender}" style="overflow: hidden; padding: 0;">
          ${getStudentAvatarImgHtml(s)}
        </div>
        <div class="student-number">${numText}</div>
        <div class="student-name" title="${getStudentDisplayName(s)}">${getStudentDisplayName(s)}</div>
      `;

      card.addEventListener('dragstart', (e) => {
        e.dataTransfer.setData('text/plain', s.id);
      });

      unassignedContainer.appendChild(card);
    });
  }
}

async function saveSeatConfig() {
  if (!ensureCourseSelected()) return;
  const rows = parseInt(document.getElementById('seat-rows-input').value);
  const cols = parseInt(document.getElementById('seat-cols-input').value);
  const bbPos = document.getElementById('seat-blackboard-pos-input').value;

  if (rows < 1 || cols < 1) {
    alert('行列數必須大於等於 1');
    return;
  }

  try {
    await API.post(`/api/seating/${AppState.currentCourseId}/config`, {
      seat_rows: rows,
      seat_cols: cols,
      blackboard_position: bbPos
    });
    loadSeatingData();
  } catch (err) {
    alert(`儲存座位設定失敗：${err.message}`);
  }
}

async function autoArrangeSeats(mode) {
  if (!ensureCourseSelected()) return;
  try {
    await API.post(`/api/seating/${AppState.currentCourseId}/auto`, { mode: mode });
    loadSeatingData();
  } catch (err) {
    alert(`自動編排座位失敗：${err.message}`);
  }
}

async function runAutoGrouping() {
  if (!ensureCourseSelected()) return;
  const targetType = document.getElementById('group-target-type').value;
  const targetVal = parseInt(document.getElementById('group-target-value').value);
  const mode = document.getElementById('group-mode').value;

  const payload = { 
    mode: mode,
    plan_id: AppState.currentGroupPlanId
  };
  if (targetType === 'per_group') {
    payload.students_per_group = targetVal;
  } else {
    payload.num_groups = targetVal;
  }

  try {
    const data = await API.post(`/api/groups/${AppState.currentCourseId}/auto`, payload);
    renderGroupColumns(data);
    loadDashboardData(true);
    refreshProjectionData(true);
  } catch (err) {
    alert(`自動分組失敗：${err.message}`);
  }
}
