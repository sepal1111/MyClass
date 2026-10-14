// MyClass 早自修／午休「在位掌握」（教師端）
// 只記「不在教室」的學生與原因；沒有紀錄＝在教室。離開原因與負責老師由教師自訂（全班級共用）。
(function () {
  const SLOTS = [
    { key: 'morning', label: '🌅 早自修' },
    { key: 'noon', label: '🍱 午休' },
  ];

  const S = {
    date: '',
    slot: new Date().getHours() >= 11 ? 'noon' : 'morning',
    students: [],
    reasons: [],
    selecting: false,
    selected: new Set(),
    seat: null,
    view: (() => { try { return localStorage.getItem('wb_view') === 'seat' ? 'seat' : 'grid'; } catch (_) { return 'grid'; } })(),
  };

  const $ = (id) => document.getElementById(id);
  const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const toast = (m, t) => (window.showToast ? window.showToast(m, t) : console.log(m));
  const courseId = () => window.AppState && window.AppState.currentCourseId;
  const todayStr = () => (typeof getTaiwanTodayDateStr === 'function' ? getTaiwanTodayDateStr() : new Date().toISOString().slice(0, 10));
  const slotLabel = () => SLOTS.find((s) => s.key === S.slot).label;
  const nameOf = (s) => (typeof getStudentDisplayName === 'function' ? getStudentDisplayName(s) : s.name);
  const recOf = (s) => s[S.slot];
  const hm = (t) => (t ? String(t).slice(11, 16) : '');
  const tripsOf = (s) => (s.trips && s.trips[S.slot]) || [];
  const tripText = (t) => `${t.icon} ${t.reason_title}${t.note ? `（${t.note}）` : ''} ${hm(t.out_at)}–${hm(t.returned_at) || '未回'}${t.minutes != null ? `（${t.minutes} 分）` : ''}`;

  // ---------- 載入與繪製 ----------

  async function load() {
    const root = $('whereabouts-root');
    if (!root) return;
    if (!courseId() || (window.AppState.courses && window.AppState.courses.length === 0)) {
      if (typeof renderEmptyCourseNotice === 'function') renderEmptyCourseNotice(root);
      return;
    }
    if (!S.date) S.date = todayStr();
    try {
      const data = await API.get(`/api/whereabouts/${courseId()}?date=${S.date}`);
      S.students = data.students;
      S.reasons = data.reasons;
      S.seat = data.seat;
      // 離開的學生可能已被刪除或換班：清掉不存在的選取
      const ids = new Set(S.students.map((s) => s.student_id));
      S.selected.forEach((id) => { if (!ids.has(id)) S.selected.delete(id); });
      render();
    } catch (err) {
      console.error('Whereabouts load error:', err);
      root.innerHTML = `<div class="glass-card" style="color: var(--accent-negative);">載入失敗：${esc(err.message)}</div>`;
    }
  }

  function render() {
    const root = $('whereabouts-root');
    if (!root) return;
    root.classList.toggle('wb-noon', S.slot === 'noon'); // 午休＝暖色系
    const out = S.students.filter((s) => recOf(s));
    const inCount = S.students.length - out.length;

    root.innerHTML = `
      <div class="glass-card">
        <div class="glass-card-header" style="flex-wrap: wrap; gap: 10px;">
          <div>
            <div class="glass-card-title">🚶 早自修／午休在位掌握</div>
            <div style="font-size: 0.85rem; color: var(--text-muted); margin-top: 4px;">預設全班都在教室；點學生卡片，選擇不在教室的原因。</div>
          </div>
          <div style="display: flex; gap: 8px; align-items: center; flex-wrap: wrap;">
            <input type="date" id="wb-date" class="input-control" style="width: auto;" value="${esc(S.date)}">
            <div id="wb-slot-group" style="display: inline-flex; gap: 4px; background: rgba(0,0,0,0.05); padding: 3px; border-radius: 10px;">
              ${SLOTS.map((s) => `<button type="button" class="btn ${s.key === S.slot ? '' : 'btn-secondary'}" data-slot="${s.key}" style="font-size: 0.88rem; padding: 6px 14px;">${s.label}</button>`).join('')}
            </div>
            <div id="wb-view-group" style="display: inline-flex; gap: 4px; background: rgba(0,0,0,0.05); padding: 3px; border-radius: 10px;">
              <button type="button" class="btn ${S.view === 'grid' ? '' : 'btn-secondary'}" data-view="grid" style="font-size: 0.85rem; padding: 6px 12px;">👥 名冊</button>
              <button type="button" class="btn ${S.view === 'seat' ? '' : 'btn-secondary'}" data-view="seat" style="font-size: 0.85rem; padding: 6px 12px;">🪑 座位表</button>
            </div>
            <button type="button" id="wb-btn-clear" class="btn btn-secondary" style="font-size: 0.85rem; padding: 6px 12px;">✅ 全班都在教室</button>
            <button type="button" id="wb-btn-select" class="btn ${S.selecting ? '' : 'btn-secondary'}" style="font-size: 0.85rem; padding: 6px 12px;">${S.selecting ? '✖ 結束多選' : '☑️ 多選'}</button>
            <button type="button" id="wb-btn-report" class="btn btn-secondary" style="font-size: 0.85rem; padding: 6px 12px;">📊 紀錄與統計</button>
            <button type="button" id="wb-btn-kiosk" class="btn btn-secondary" style="font-size: 0.85rem; padding: 6px 12px;">🔗 學生自行登記頁（免登入）</button>
            <button type="button" id="wb-btn-manage" class="btn btn-secondary" style="font-size: 0.85rem; padding: 6px 12px;">⚙️ 管理原因與負責老師</button>
          </div>
        </div>

        <div style="display: flex; gap: 10px; flex-wrap: wrap; margin-bottom: 14px; font-weight: 800; font-size: 0.92rem;">
          <span style="color: #4fae82; background: rgba(79,174,130,0.12); padding: 5px 12px; border-radius: 9999px;">✅ 在教室 ${inCount} 人</span>
          <span style="color: ${out.length ? '#c2410c' : '#64748b'}; background: ${out.length ? 'rgba(249,115,22,0.14)' : 'rgba(100,116,139,0.1)'}; padding: 5px 12px; border-radius: 9999px;">🚪 不在教室 ${out.length} 人</span>
          <span style="color: var(--text-muted); padding: 5px 4px;">${esc(S.date)} ${slotLabel()}</span>
        </div>

        ${renderOutPanel(out)}

        ${renderStudents()}
      </div>

      <div id="wb-select-bar" style="display: ${S.selecting && S.selected.size ? 'flex' : 'none'}; position: sticky; bottom: 12px; margin-top: 12px; gap: 10px; align-items: center; justify-content: center; flex-wrap: wrap; background: var(--card-bg, #fff); border: 1.5px solid var(--primary); border-radius: 14px; padding: 10px 14px; box-shadow: 0 8px 24px rgba(0,0,0,0.18);">
        <b>已選 ${S.selected.size} 人</b>
        <button type="button" id="wb-sel-set" class="btn" style="padding: 7px 16px;">📍 設定不在教室原因</button>
        <button type="button" id="wb-sel-in" class="btn btn-secondary" style="padding: 7px 16px;">✅ 改回在教室</button>
        <button type="button" id="wb-sel-cancel" class="btn btn-secondary" style="padding: 7px 16px;">取消選取</button>
      </div>
    `;
    bind();
  }

  // 「找人」清單：依原因分組，直接顯示負責老師，導師臨時找學生時一眼就知道該問誰。
  function renderOutPanel(out) {
    if (!out.length) {
      return `<div style="padding: 12px 14px; border-radius: 12px; background: rgba(79,174,130,0.08); border: 1px dashed rgba(79,174,130,0.4); color: #2f8a62; font-weight: 700; margin-bottom: 14px;">🎉 這個時段全班都在教室。</div>`;
    }
    const groups = new Map();
    out.forEach((s) => {
      const r = recOf(s);
      const key = r.reason_id ?? `deleted:${r.reason_title}`;
      if (!groups.has(key)) groups.set(key, { r, list: [] });
      groups.get(key).list.push(s);
    });
    const order = new Map(S.reasons.map((r, i) => [r.id, i]));
    const sorted = [...groups.values()].sort((a, b) => (order.get(a.r.reason_id) ?? 999) - (order.get(b.r.reason_id) ?? 999));

    return `
      <div style="margin-bottom: 16px; border: 1.5px solid rgba(249,115,22,0.4); background: rgba(249,115,22,0.06); border-radius: 14px; padding: 12px 14px;">
        <div style="font-weight: 900; color: #c2410c; margin-bottom: 8px;">🚪 不在教室名單（${slotLabel()}）</div>
        <div style="display: flex; flex-direction: column; gap: 8px;">
          ${sorted.map(({ r, list }) => `
            <div style="display: flex; gap: 10px; flex-wrap: wrap; align-items: baseline; background: var(--card-bg, #fff); border: 1px solid rgba(249,115,22,0.25); border-radius: 10px; padding: 8px 12px;">
              <span style="font-weight: 900; white-space: nowrap;">${esc(r.icon)} ${esc(r.reason_title)}</span>
              <span style="font-size: 0.82rem; font-weight: 800; padding: 2px 8px; border-radius: 9999px; white-space: nowrap; ${r.teacher_name ? 'background: rgba(59,130,246,0.12); color: #1d4ed8;' : 'background: rgba(100,116,139,0.1); color: #64748b;'}">${r.teacher_name ? `負責老師：${esc(r.teacher_name)}` : '未設定負責老師'}</span>
              <span style="flex: 1; min-width: 160px; font-weight: 700;">
                ${list.map((s) => {
                  const note = recOf(s).note;
                  return `<span style="display: inline-block; margin: 2px 8px 2px 0;">${esc(s.student_number)}號 ${esc(nameOf(s))}${note ? `<span style="font-weight: 500; color: var(--text-muted);">（${esc(note)}）</span>` : ''}<span style="font-weight: 500; font-size: 0.78rem; color: var(--text-muted);"> ${hm(recOf(s).out_at)} 離開</span></span>`;
                }).join('')}
              </span>
            </div>`).join('')}
        </div>
      </div>`;
  }

  // 名冊（依座號）或座位表（依教室座位）顯示學生卡片；兩種檢視的點選、多選行為相同。
  function renderStudents() {
    const seat = S.seat;
    const seated = S.students.filter((s) => s.seat_row != null);
    if (S.view !== 'seat' || !seat) return `<div id="wb-grid" class="student-grid">${S.students.map(renderCard).join('')}</div>`;
    if (!seated.length) {
      return `<div style="padding: 14px; color: var(--text-muted);">這個班級尚未安排座位，請先到「設定 ➔ 座位表編排」排座位，或改用「名冊」檢視。</div><div id="wb-grid" class="student-grid">${S.students.map(renderCard).join('')}</div>`;
    }
    const at = new Map(seated.map((s) => [`${s.seat_row},${s.seat_col}`, s]));
    let cells = '';
    for (let r = 1; r <= seat.rows; r++) {
      for (let c = 1; c <= seat.cols; c++) {
        const s = at.get(`${r},${c}`);
        cells += s ? renderCard(s) : '<div class="wb-seat-empty"></div>';
      }
    }
    const unseated = S.students.filter((s) => s.seat_row == null);
    const bb = seat.blackboard_position || 'top';
    return `<div id="wb-grid">
      <div class="wb-seat-wrap ${esc(bb)}">
        <div class="wb-board">講台／黑板</div>
        <div class="wb-seat-grid" style="grid-template-columns: repeat(${seat.cols}, minmax(110px, 1fr));">${cells}</div>
      </div>
      ${unseated.length ? `<div class="wb-unseated-title">尚未安排座位（${unseated.length} 人）</div><div class="student-grid">${unseated.map(renderCard).join('')}</div>` : ''}
    </div>`;
  }

  function renderCard(s) {
    const r = recOf(s);
    const sel = S.selecting && S.selected.has(s.student_id);
    const numText = `${s.student_number} 號`;
    return `
      <div class="student-card wb-card ${r ? 'wb-out' : ''} ${sel ? 'selected' : ''}" data-id="${s.student_id}">
        <div class="student-number">${numText}</div>
        <div class="student-name" title="${esc(nameOf(s))}">${esc(nameOf(s))}</div>
        <div class="wb-status ${r ? 'out' : 'in'}">${r ? `${esc(r.icon)} ${esc(r.reason_title)}${r.note ? `：${esc(r.note)}` : ''}` : '✅ 在教室'}</div>
        ${r ? `<div class="wb-teacher">🕒 ${hm(r.out_at)} 離開${r.teacher_name ? `　👩‍🏫 ${esc(r.teacher_name)}` : ''}</div>` : ''}
        ${!r && tripsOf(s).length ? `<div class="wb-teacher" title="${esc(tripsOf(s).map(tripText).join('\n'))}">↩ 曾外出 ${tripsOf(s).length} 次</div>` : ''}
      </div>`;
  }

  function bind() {
    $('wb-date').addEventListener('change', (e) => {
      S.date = e.target.value || todayStr();
      S.selected.clear();
      load();
    });
    $('wb-slot-group').querySelectorAll('button').forEach((b) =>
      b.addEventListener('click', () => { S.slot = b.dataset.slot; S.selected.clear(); render(); })
    );
    $('wb-view-group').querySelectorAll('button').forEach((b) =>
      b.addEventListener('click', () => {
        S.view = b.dataset.view;
        try { localStorage.setItem('wb_view', S.view); } catch (_) { /* ignore */ }
        render();
      })
    );
    $('wb-btn-clear').addEventListener('click', clearAll);
    $('wb-btn-select').addEventListener('click', () => { S.selecting = !S.selecting; S.selected.clear(); render(); });
    $('wb-btn-manage').addEventListener('click', openManage);
    $('wb-btn-kiosk').addEventListener('click', openKiosk);
    $('wb-btn-report').addEventListener('click', openReport);
    $('wb-grid').querySelectorAll('.wb-card').forEach((el) =>
      el.addEventListener('click', () => onCardClick(Number(el.dataset.id)))
    );
    const setBtn = $('wb-sel-set');
    if (setBtn) {
      setBtn.addEventListener('click', () => openPicker([...S.selected]));
      $('wb-sel-in').addEventListener('click', () => save([...S.selected], null, ''));
      $('wb-sel-cancel').addEventListener('click', () => { S.selected.clear(); render(); });
    }
  }

  function onCardClick(id) {
    if (S.selecting) {
      if (S.selected.has(id)) S.selected.delete(id); else S.selected.add(id);
      render();
    } else {
      openPicker([id]);
    }
  }

  // ---------- 寫入 ----------

  async function save(ids, reasonId, note) {
    try {
      await API.put(`/api/whereabouts/${courseId()}/record`, {
        date: S.date, slot: S.slot, student_ids: ids, reason_id: reasonId, note,
      });
      S.selected.clear();
      await load();
      return true;
    } catch (err) {
      toast(`儲存失敗：${err.message}`, 'error');
      return false;
    }
  }

  async function clearAll() {
    if (!window.ensureCourseSelected || !window.ensureCourseSelected()) return;
    const hasOut = S.students.some((s) => recOf(s));
    if (!hasOut) { toast('目前全班都在教室', 'info'); return; }
    if (!confirm(`確定要將 ${S.date}「${slotLabel().replace(/^\S+\s/, '')}」所有外出的學生標記為「已回到教室」嗎？\n（外出紀錄會保留，並記下現在的回來時間）`)) return;
    try {
      await API.post(`/api/whereabouts/${courseId()}/clear`, { date: S.date, slot: S.slot });
      await load();
    } catch (err) {
      toast(`操作失敗：${err.message}`, 'error');
    }
  }

  // ---------- 原因選擇視窗 ----------

  function overlay(inner, onClose, width = 560) {
    const el = document.createElement('div');
    el.style.cssText = 'position:fixed;inset:0;z-index:9999;background:rgba(15,23,42,0.55);display:flex;align-items:center;justify-content:center;padding:14px;';
    el.innerHTML = `<div style="background: var(--card-bg, #fff); color: var(--text-main, #1e293b); border-radius: 18px; width: min(${width}px, 100%); max-height: 88vh; overflow-y: auto; padding: 18px 18px 14px; box-shadow: 0 20px 60px rgba(0,0,0,0.35);">${inner}</div>`;
    const close = () => { el.remove(); if (onClose) onClose(); };
    el.addEventListener('mousedown', (e) => { if (e.target === el) close(); });
    document.body.appendChild(el);
    return { el, close };
  }

  function openPicker(ids) {
    if (!ids.length) return;
    const stus = ids.map((id) => S.students.find((s) => s.student_id === id)).filter(Boolean);
    const title = stus.length === 1 ? `${stus[0].student_number}號 ${esc(nameOf(stus[0]))}` : `已選 ${stus.length} 位學生`;
    const cur = stus.length === 1 ? recOf(stus[0]) : null;
    const todayTrips = stus.length === 1 ? ['morning', 'noon'].flatMap((k) => ((stus[0].trips || {})[k] || []).map((t) => ({ ...t, slotKey: k }))) : [];

    const { el, close } = overlay(`
      <div style="font-size: 1.1rem; font-weight: 900; margin-bottom: 4px;">${title}</div>
      <div style="font-size: 0.85rem; color: var(--text-muted); margin-bottom: 12px;">${esc(S.date)} ${slotLabel()}${cur ? `｜目前：${esc(cur.icon)} ${esc(cur.reason_title)}（${hm(cur.out_at)} 離開）` : '｜目前在教室'}</div>
      ${todayTrips.length ? `<div style="font-size: 0.78rem; color: var(--text-muted); margin-bottom: 10px; line-height: 1.6; border-left: 3px solid var(--primary); padding-left: 8px;"><b>當天外出紀錄</b><br>${todayTrips.map((t) => `${t.slotKey === 'morning' ? '🌅' : '🍱'} ${esc(tripText(t))}`).join('<br>')}</div>` : ''}
      ${cur || stus.length > 1 ? '<button type="button" class="btn" data-in style="width: 100%; padding: 12px; font-size: 1rem; font-weight: 800; margin-bottom: 12px; background: linear-gradient(135deg,#4fae82,#2f8a62);">✅ 回到教室了</button>' : ''}
      <div style="font-size: 0.85rem; font-weight: 800; margin-bottom: 6px;">不在教室，原因是：</div>
      <div style="display: grid; grid-template-columns: repeat(auto-fill, minmax(150px, 1fr)); gap: 8px;">
        ${S.reasons.map((r) => `
          <button type="button" class="btn btn-secondary" data-reason="${r.id}" style="padding: 10px 8px; text-align: left; line-height: 1.35; white-space: normal;">
            <span style="font-weight: 800;">${esc(r.icon)} ${esc(r.title)}</span>
            ${r.teacher_name ? `<span style="display: block; font-size: 0.76rem; color: var(--text-muted); font-weight: 600;">👩‍🏫 ${esc(r.teacher_name)}</span>` : ''}
          </button>`).join('')}
      </div>
      <div id="wb-note-wrap" style="display: none; margin-top: 12px;">
        <label style="font-size: 0.85rem; font-weight: 800;">請輸入原因（必填）</label>
        <input type="text" id="wb-note" class="input-control" maxlength="100" placeholder="例如：幫老師搬資料" style="width: 100%; margin-top: 4px;">
        <button type="button" class="btn" id="wb-note-ok" style="margin-top: 8px; width: 100%; padding: 10px;">確定</button>
      </div>
      <div style="display: flex; justify-content: space-between; align-items: center; margin-top: 12px; gap: 8px;">
        ${cur ? '<button type="button" class="btn btn-secondary" data-del style="padding: 6px 12px; color: var(--accent-negative); font-size: 0.8rem;" title="誤按時使用，這筆不會留下紀錄">🗑️ 誤按，刪除這筆</button>' : '<span></span>'}
        <button type="button" class="btn btn-secondary" data-cancel style="padding: 6px 16px;">取消</button>
      </div>
    `);

    el.querySelector('[data-cancel]').addEventListener('click', close);
    const inBtn = el.querySelector('[data-in]');
    if (inBtn) inBtn.addEventListener('click', async () => { if (await save(ids, null, '')) close(); });
    const delBtn = el.querySelector('[data-del]');
    if (delBtn) delBtn.addEventListener('click', async () => {
      if (!confirm('刪除後這筆外出不會留下任何紀錄。確定是誤按嗎？')) return;
      try {
        await API.delete(`/api/whereabouts/${courseId()}/trip/${cur.id}`);
        close();
        await load();
      } catch (err) {
        toast(`刪除失敗：${err.message}`, 'error');
      }
    });
    let pendingOther = null;
    el.querySelectorAll('[data-reason]').forEach((b) =>
      b.addEventListener('click', async () => {
        const r = S.reasons.find((x) => x.id === Number(b.dataset.reason));
        if (r.is_other) {
          pendingOther = r;
          el.querySelector('#wb-note-wrap').style.display = 'block';
          el.querySelector('#wb-note').focus();
          return;
        }
        if (await save(ids, r.id, '')) close();
      })
    );
    const submitOther = async () => {
      const note = el.querySelector('#wb-note').value.trim();
      if (!note) { toast('請輸入原因', 'error'); return; }
      if (await save(ids, pendingOther.id, note)) close();
    };
    el.querySelector('#wb-note-ok').addEventListener('click', submitOther);
    el.querySelector('#wb-note').addEventListener('keydown', (e) => { if (e.key === 'Enter') submitOther(); });
  }

  // ---------- 管理原因與負責老師 ----------

  async function openManage() {
    let reasons;
    try {
      reasons = await API.get('/api/whereabouts/reasons?all=1');
    } catch (err) {
      toast(`載入失敗：${err.message}`, 'error');
      return;
    }

    const { el, close } = overlay('<div id="wb-manage-body"></div>', () => load());
    const body = el.querySelector('#wb-manage-body');

    const rowHtml = (r) => `
      <div class="wb-row" data-id="${r.id}" style="display: grid; grid-template-columns: 52px 1fr 1fr auto auto; gap: 6px; align-items: center; margin-bottom: 6px; ${r.is_active ? '' : 'opacity: 0.55;'}">
        <input class="input-control" data-f="icon" value="${esc(r.icon)}" maxlength="4" style="text-align: center; padding: 6px 2px;" title="圖示">
        <input class="input-control" data-f="title" value="${esc(r.title)}" maxlength="30" placeholder="項目名稱">
        <input class="input-control" data-f="teacher_name" value="${esc(r.teacher_name)}" maxlength="30" placeholder="負責老師（選填）">
        <label style="font-size: 0.78rem; white-space: nowrap; display: flex; align-items: center; gap: 3px;"><input type="checkbox" data-f="is_active" ${r.is_active ? 'checked' : ''}>啟用</label>
        <button type="button" class="btn btn-secondary" data-del title="刪除" style="padding: 5px 9px; color: var(--accent-negative);">🗑️</button>
      </div>`;

    const draw = () => {
      body.innerHTML = `
        <div style="font-size: 1.1rem; font-weight: 900; margin-bottom: 4px;">⚙️ 管理不在教室原因與負責老師</div>
        <div style="font-size: 0.82rem; color: var(--text-muted); margin-bottom: 12px; line-height: 1.5;">
          負責老師為選填，會顯示在「不在教室名單」，導師找學生時可以直接詢問。修改後自動儲存，<b>所有班級共用</b>。<br>
          已有登記紀錄的項目無法刪除，只會改為停用。
        </div>
        <div style="display: grid; grid-template-columns: 52px 1fr 1fr auto auto; gap: 6px; font-size: 0.75rem; color: var(--text-muted); font-weight: 700; margin-bottom: 4px;"><span>圖示</span><span>項目名稱</span><span>負責老師</span><span></span><span></span></div>
        ${reasons.map(rowHtml).join('')}
        <div style="border-top: 1px dashed var(--card-border, #cbd5e1); margin-top: 10px; padding-top: 10px; display: grid; grid-template-columns: 52px 1fr 1fr auto; gap: 6px; align-items: center;">
          <input class="input-control" id="wb-new-icon" value="📍" maxlength="4" style="text-align: center; padding: 6px 2px;">
          <input class="input-control" id="wb-new-title" maxlength="30" placeholder="新項目名稱">
          <input class="input-control" id="wb-new-teacher" maxlength="30" placeholder="負責老師（選填）">
          <button type="button" class="btn" id="wb-new-add" style="padding: 6px 12px;">➕ 新增</button>
        </div>
        <div style="text-align: right; margin-top: 14px;"><button type="button" class="btn" id="wb-manage-done" style="padding: 7px 20px;">完成</button></div>
      `;

      body.querySelector('#wb-manage-done').addEventListener('click', close);

      body.querySelectorAll('.wb-row').forEach((row) => {
        const id = Number(row.dataset.id);
        row.querySelectorAll('[data-f]').forEach((inp) =>
          inp.addEventListener('change', async () => {
            const f = inp.dataset.f;
            const val = inp.type === 'checkbox' ? inp.checked : inp.value.trim();
            if (f === 'title' && !val) { toast('項目名稱不可為空白', 'error'); draw(); return; }
            try {
              const upd = await API.put(`/api/whereabouts/reasons/${id}`, { [f]: val });
              const i = reasons.findIndex((r) => r.id === id);
              reasons[i] = upd;
              if (f === 'is_active') draw();
              else toast('已儲存', 'success');
            } catch (err) {
              toast(`儲存失敗：${err.message}`, 'error');
            }
          })
        );
        row.querySelector('[data-del]').addEventListener('click', async () => {
          const r = reasons.find((x) => x.id === id);
          if (!confirm(`確定要刪除「${r.title}」嗎？`)) return;
          try {
            const res = await API.delete(`/api/whereabouts/reasons/${id}`);
            if (res.deactivated) {
              reasons.find((x) => x.id === id).is_active = false;
            } else {
              reasons = reasons.filter((x) => x.id !== id);
            }
            toast(res.message, 'success');
            draw();
          } catch (err) {
            toast(`刪除失敗：${err.message}`, 'error');
          }
        });
      });

      body.querySelector('#wb-new-add').addEventListener('click', async () => {
        const title = body.querySelector('#wb-new-title').value.trim();
        if (!title) { toast('請填寫項目名稱', 'error'); return; }
        try {
          const created = await API.post('/api/whereabouts/reasons', {
            title,
            icon: body.querySelector('#wb-new-icon').value.trim() || '📍',
            teacher_name: body.querySelector('#wb-new-teacher').value.trim(),
          });
          reasons.push(created);
          draw();
        } catch (err) {
          toast(`新增失敗：${err.message}`, 'error');
        }
      });
    };
    draw();
  }

  // ---------- 紀錄與統計 ----------

  async function openReport() {
    if (!window.ensureCourseSelected || !window.ensureCourseSelected()) return;
    const today = todayStr();
    const R = { start: today.slice(0, 8) + '01', end: today, slot: '', tab: 'student', data: null };

    const { el } = overlay('<div id="wb-rp-body"></div>', null, 880);
    const body = el.querySelector('#wb-rp-body');
    const statusLabel = { returned: '已回教室', out: '尚未回來', no_return: '⚠️ 未登記回來' };
    const th = 'text-align: left; padding: 6px 8px; border-bottom: 1.5px solid var(--card-border, #cbd5e1); white-space: nowrap; font-size: 0.8rem; color: var(--text-muted);';
    const td = 'padding: 6px 8px; border-bottom: 1px solid var(--card-border, #e2e8f0); font-size: 0.86rem; vertical-align: top;';
    const query = () => `start=${R.start}&end=${R.end}${R.slot ? `&slot=${R.slot}` : ''}`;

    const tableHtml = () => {
      const d = R.data;
      if (!d) return '';
      if (R.tab === 'student') {
        if (!d.by_student.length) return '<div style="padding: 18px; color: var(--text-muted);">這段期間沒有外出紀錄。</div>';
        return `<table style="width: 100%; border-collapse: collapse;"><tr><th style="${th}">座號</th><th style="${th}">姓名</th><th style="${th}">次數</th><th style="${th}">累計分鐘</th><th style="${th}">各原因次數</th></tr>
          ${d.by_student.map((s) => `<tr><td style="${td}">${esc(s.student_number)}</td><td style="${td}">${esc(s.name)}</td><td style="${td} font-weight: 800;">${s.count}</td><td style="${td}">${s.minutes}</td><td style="${td}">${Object.entries(s.reasons).map(([k, v]) => `${esc(k)}×${v}`).join('、')}</td></tr>`).join('')}</table>`;
      }
      if (R.tab === 'reason') {
        if (!d.by_reason.length) return '<div style="padding: 18px; color: var(--text-muted);">這段期間沒有外出紀錄。</div>';
        return `<table style="width: 100%; border-collapse: collapse;"><tr><th style="${th}">原因</th><th style="${th}">負責老師</th><th style="${th}">次數</th><th style="${th}">人數</th><th style="${th}">累計分鐘</th></tr>
          ${d.by_reason.map((r) => `<tr><td style="${td} font-weight: 800;">${esc(r.icon)} ${esc(r.title)}</td><td style="${td}">${esc(r.teacher_name) || '—'}</td><td style="${td}">${r.count}</td><td style="${td}">${r.students}</td><td style="${td}">${r.minutes}</td></tr>`).join('')}</table>`;
      }
      if (!d.trips.length) return '<div style="padding: 18px; color: var(--text-muted);">這段期間沒有外出紀錄。</div>';
      return `<table style="width: 100%; border-collapse: collapse;"><tr><th style="${th}">日期</th><th style="${th}">時段</th><th style="${th}">學生</th><th style="${th}">原因</th><th style="${th}">離開–回來</th><th style="${th}">分鐘</th><th style="${th}">狀態</th></tr>
        ${d.trips.map((t) => `<tr><td style="${td}">${esc(t.date)}</td><td style="${td}">${esc(t.slot_label)}</td><td style="${td}">${esc(t.student_number)}號 ${esc(t.name)}</td><td style="${td}">${esc(t.icon)} ${esc(t.reason_title)}${t.note ? `<br><span style="color: var(--text-muted);">${esc(t.note)}</span>` : ''}${t.teacher_name ? `<br><span style="color: var(--text-muted);">👩‍🏫 ${esc(t.teacher_name)}</span>` : ''}</td><td style="${td} white-space: nowrap;">${hm(t.out_at)}–${hm(t.returned_at) || '？'}</td><td style="${td}">${t.minutes ?? ''}</td><td style="${td} ${t.status === 'no_return' ? 'color: #c2410c; font-weight: 800;' : ''}">${statusLabel[t.status]}</td></tr>`).join('')}</table>`;
    };

    const draw = () => {
      const d = R.data;
      const noReturn = d ? d.trips.filter((t) => t.status === 'no_return').length : 0;
      body.innerHTML = `
        <div style="font-size: 1.15rem; font-weight: 900; margin-bottom: 10px;">📊 外出紀錄與統計</div>
        <div style="display: flex; gap: 8px; flex-wrap: wrap; align-items: center; margin-bottom: 12px;">
          <input type="date" id="wb-rp-start" class="input-control" style="width: auto;" value="${esc(R.start)}">
          <span>～</span>
          <input type="date" id="wb-rp-end" class="input-control" style="width: auto;" value="${esc(R.end)}">
          <select id="wb-rp-slot" class="input-control" style="width: auto;">
            <option value="" ${R.slot === '' ? 'selected' : ''}>全部時段</option>
            <option value="morning" ${R.slot === 'morning' ? 'selected' : ''}>🌅 早自修</option>
            <option value="noon" ${R.slot === 'noon' ? 'selected' : ''}>🍱 午休</option>
          </select>
          <button type="button" class="btn" id="wb-rp-go" style="padding: 6px 14px;">🔍 查詢</button>
          <button type="button" class="btn btn-secondary" id="wb-rp-xlsx" style="padding: 6px 14px;">📥 匯出 Excel</button>
        </div>
        ${d ? `<div style="display: flex; gap: 8px; flex-wrap: wrap; margin-bottom: 10px; font-weight: 800; font-size: 0.88rem;">
          <span style="background: rgba(59,130,246,0.12); color: #1d4ed8; padding: 4px 12px; border-radius: 9999px;">共 ${d.trips.length} 次外出</span>
          <span style="background: rgba(79,174,130,0.14); color: #2f8a62; padding: 4px 12px; border-radius: 9999px;">${d.by_student.length} 位學生</span>
          ${noReturn ? `<span style="background: rgba(249,115,22,0.16); color: #c2410c; padding: 4px 12px; border-radius: 9999px;">⚠️ ${noReturn} 筆未登記回來</span>` : ''}
        </div>` : ''}
        <div style="display: flex; gap: 4px; margin-bottom: 8px;">
          ${[['student', '👤 學生統計'], ['reason', '📍 原因統計'], ['detail', '📋 明細']].map(([k, label]) => `<button type="button" class="btn ${R.tab === k ? '' : 'btn-secondary'}" data-tab="${k}" style="padding: 5px 14px; font-size: 0.85rem;">${label}</button>`).join('')}
        </div>
        <div style="overflow-x: auto;">${d ? tableHtml() : '載入中…'}</div>
        ${d && R.tab === 'detail' && noReturn ? '<div style="font-size: 0.78rem; color: var(--text-muted); margin-top: 6px;">「未登記回來」代表過了當天仍沒有人標記回到教室，這幾筆不計入累計分鐘。</div>' : ''}
        <div style="text-align: right; margin-top: 12px;"><button type="button" class="btn btn-secondary" id="wb-rp-close" style="padding: 6px 18px;">關閉</button></div>`;

      body.querySelector('#wb-rp-close').addEventListener('click', () => el.remove());
      body.querySelector('#wb-rp-start').addEventListener('change', (e) => { R.start = e.target.value; });
      body.querySelector('#wb-rp-end').addEventListener('change', (e) => { R.end = e.target.value; });
      body.querySelector('#wb-rp-slot').addEventListener('change', (e) => { R.slot = e.target.value; });
      body.querySelector('#wb-rp-go').addEventListener('click', fetchReport);
      body.querySelector('#wb-rp-xlsx').addEventListener('click', downloadXlsx);
      body.querySelectorAll('[data-tab]').forEach((b) => b.addEventListener('click', () => { R.tab = b.dataset.tab; draw(); }));
    };

    async function fetchReport() {
      if (!R.start || !R.end || R.start > R.end) { toast('請選擇正確的日期區間', 'error'); return; }
      try {
        R.data = await API.get(`/api/whereabouts/${courseId()}/report?${query()}`);
        draw();
      } catch (err) {
        toast(`查詢失敗：${err.message}`, 'error');
      }
    }

    async function downloadXlsx() {
      if (!R.start || !R.end || R.start > R.end) { toast('請選擇正確的日期區間', 'error'); return; }
      try {
        const res = await fetch(`/api/whereabouts/${courseId()}/report.xlsx?${query()}`, { headers: API.getHeaders(), credentials: 'same-origin' });
        if (!res.ok) {
          const err = await res.json().catch(() => ({ detail: res.statusText }));
          throw new Error(err.detail || '匯出失敗');
        }
        const m = /filename\*=UTF-8''([^;]+)/.exec(res.headers.get('Content-Disposition') || '');
        const name = m ? decodeURIComponent(m[1]) : `在位掌握紀錄_${R.start}_${R.end}.xlsx`;
        const url = URL.createObjectURL(await res.blob());
        const a = document.createElement('a');
        a.href = url;
        a.download = name;
        document.body.appendChild(a);
        a.click();
        a.remove();
        setTimeout(() => URL.revokeObjectURL(url), 5000);
      } catch (err) {
        toast(`匯出失敗：${err.message}`, 'error');
      }
    }

    draw();
    fetchReport();
  }

  // ---------- 學生自行登記頁（免登入）連結 ----------

  async function openKiosk() {
    if (!window.ensureCourseSelected || !window.ensureCourseSelected()) return;
    const { el, close } = overlay('<div id="wb-kiosk-body" style="text-align: center;">載入中…</div>');
    const body = el.querySelector('#wb-kiosk-body');
    const url = () => `/api/whereabouts/${courseId()}/kiosk`;

    const draw = (info) => {
      if (!info.enabled) {
        body.innerHTML = `
          <div style="font-size: 1.15rem; font-weight: 900; margin-bottom: 6px;">🔗 學生自行登記頁</div>
          <div style="font-size: 0.88rem; color: var(--text-muted); line-height: 1.6; text-align: left; margin-bottom: 14px;">
            教師不在教室時，學生可以<b>用手機／平板掃 QR Code</b>，不需登入，自己點選公出原因。
            啟用後會產生這個班級專屬的連結；不想開放時按「停用」，連結立即失效。
          </div>
          <button type="button" class="btn" id="wb-k-on" style="padding: 9px 22px;">✅ 啟用學生自行登記</button>
          <div style="margin-top: 12px;"><button type="button" class="btn btn-secondary" id="wb-k-close" style="padding: 6px 16px;">關閉</button></div>`;
      } else {
        body.innerHTML = `
          <div style="font-size: 1.15rem; font-weight: 900; margin-bottom: 4px;">🔗 學生自行登記頁（已啟用）</div>
          <div style="font-size: 0.82rem; color: var(--text-muted); margin-bottom: 10px;">不需登入系統，學生可直接在這個頁面登記公出。</div>

          <div style="text-align: left; border: 1.5px solid var(--primary); background: rgba(59,130,246,0.06); border-radius: 12px; padding: 10px 12px; margin-bottom: 12px;">
            <div style="font-weight: 900; margin-bottom: 4px;">💻 教師電腦用：加入瀏覽器書籤</div>
            <ol style="margin: 0 0 8px; padding-left: 20px; font-size: 0.85rem; line-height: 1.6;">
              <li>按「🔗 開啟登記頁」，在新分頁開啟。</li>
              <li>在新分頁按 <b>Ctrl + D</b>（Mac 為 ⌘ + D）加入書籤，建議放在書籤列。</li>
              <li>之後教師離開教室、系統未登入時，學生直接點這個書籤就能登記。</li>
            </ol>
            <div style="display: flex; gap: 8px; flex-wrap: wrap;">
              <button type="button" class="btn" id="wb-k-open" style="padding: 7px 14px;">🔗 開啟登記頁</button>
              <button type="button" class="btn btn-secondary" id="wb-k-copy-local" style="padding: 7px 14px;">📋 複製書籤網址</button>
            </div>
          </div>

          <div style="font-weight: 800; font-size: 0.9rem; margin-bottom: 6px;">📱 學生手機／平板：掃描 QR Code</div>
          <img src="${esc(info.qr_code)}" alt="QR Code" style="width: min(220px, 60vw); background: #fff; border-radius: 12px; padding: 8px; cursor: zoom-in;" id="wb-k-qr" title="點一下在新視窗放大">
          <div style="margin: 6px 0; font-size: 0.75rem; word-break: break-all; color: var(--text-muted);">${esc(info.url)}</div>
          <button type="button" class="btn btn-secondary" id="wb-k-copy" style="padding: 6px 12px;">📋 複製區網連結</button>
          <div style="font-size: 0.78rem; color: var(--text-muted); margin-top: 10px; line-height: 1.5; text-align: left;">
            ⚠️ 知道這個連結的人都能登記，請只提供給本班學生。連結外流或不想再開放時，請「重新產生」或「停用」。學生只能登記<b>今天</b>的狀態。
          </div>
          <div style="display: flex; gap: 8px; justify-content: center; flex-wrap: wrap; margin-top: 10px;">
            <button type="button" class="btn btn-secondary" id="wb-k-regen" style="padding: 6px 12px;">🔄 重新產生連結</button>
            <button type="button" class="btn btn-secondary" id="wb-k-off" style="padding: 6px 12px; color: var(--accent-negative);">⛔ 停用</button>
            <button type="button" class="btn btn-secondary" id="wb-k-close" style="padding: 6px 12px;">關閉</button>
          </div>`;
      }
      body.querySelector('#wb-k-close').addEventListener('click', close);

      const change = async (payload, okMsg) => {
        try {
          const next = await API.post(url(), payload);
          if (okMsg) toast(okMsg, 'success');
          draw(next);
        } catch (err) {
          toast(`操作失敗：${err.message}`, 'error');
        }
      };
      const on = body.querySelector('#wb-k-on');
      if (on) on.addEventListener('click', () => change({ enabled: true }, '已啟用'));
      const off = body.querySelector('#wb-k-off');
      if (off) off.addEventListener('click', () => { if (confirm('停用後，目前的連結與 QR Code 立即失效。確定嗎？')) change({ enabled: false }, '已停用'); });
      const regen = body.querySelector('#wb-k-regen');
      if (regen) regen.addEventListener('click', () => { if (confirm('重新產生後，舊的連結與 QR Code 會立即失效。確定嗎？')) change({ enabled: true, regenerate: true }, '已重新產生'); });
      const open = body.querySelector('#wb-k-open');
      if (open) open.addEventListener('click', () => window.open(info.local_url, '_blank', 'noopener'));
      const copyLocal = body.querySelector('#wb-k-copy-local');
      if (copyLocal) copyLocal.addEventListener('click', async () => {
        try { await navigator.clipboard.writeText(info.local_url); toast('已複製書籤網址', 'success'); }
        catch (_) { window.prompt('請複製書籤網址：', info.local_url); }
      });
      const copy = body.querySelector('#wb-k-copy');
      if (copy) copy.addEventListener('click', async () => {
        try { await navigator.clipboard.writeText(info.url); toast('已複製連結', 'success'); }
        catch (_) { window.prompt('請複製連結：', info.url); }
      });
      const qr = body.querySelector('#wb-k-qr');
      if (qr && typeof openQrFullscreenTab === 'function') qr.addEventListener('click', () => openQrFullscreenTab(info.qr_code, info.url));
    };

    try {
      draw(await API.get(url()));
    } catch (err) {
      body.textContent = `載入失敗：${err.message}`;
    }
  }

  window.Whereabouts = { load };
})();
