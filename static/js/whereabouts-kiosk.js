// 在位掌握：學生自行登記頁（免教師登入，連結帶班級金鑰）。
// 學生點自己的名字，選擇不在教室的原因；回來時再點一次按「我回到教室了」。
(function () {
  const params = new URLSearchParams(location.search);
  const courseId = Number(params.get('c'));
  const key = params.get('k') || '';
  const SLOTS = [
    { key: 'morning', label: '🌅 早自修' },
    { key: 'noon', label: '🍱 午休' },
  ];
  const S = {
    slot: new Date().getHours() >= 11 ? 'noon' : 'morning',
    data: null,
    sheetOpen: false,
    selecting: false, // 多人一起登記模式
    selected: new Set(),
    view: (() => { try { return localStorage.getItem('wb_kiosk_view') === 'seat' ? 'seat' : 'grid'; } catch (_) { return 'grid'; } })(),
  };

  const $ = (id) => document.getElementById(id);
  const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const slotLabel = () => SLOTS.find((s) => s.key === S.slot).label;
  const recOf = (s) => s[S.slot];
  const base = `/api/public/whereabouts/${courseId}`;

  function toast(msg, isErr) {
    const t = $('toast');
    t.textContent = msg;
    t.className = `toast show${isErr ? ' err' : ''}`;
    clearTimeout(toast.timer);
    toast.timer = setTimeout(() => { t.className = 'toast'; }, 2200);
  }

  function showFatal(msg) {
    $('subTitle').textContent = '';
    $('app').innerHTML = `<div class="msg err">${esc(msg)}</div>`;
  }

  async function load() {
    if (!courseId || !key) {
      showFatal('這個連結不完整，請重新掃描老師提供的 QR Code。');
      return false;
    }
    try {
      const res = await fetch(`${base}?key=${encodeURIComponent(key)}`);
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        showFatal(body.detail || '無法載入，請稍後再試。');
        return false;
      }
      S.data = body;
      if (!S.sheetOpen) render();
      return true;
    } catch (_) {
      // 暫時斷線：保留畫面，等下次輪詢
      return false;
    }
  }

  function stuButton(s) {
    const r = recOf(s);
    return `<button type="button" class="stu ${r ? 'out' : ''} ${S.selecting && S.selected.has(s.student_id) ? 'sel' : ''}" data-id="${s.student_id}">
      <span class="n">${esc(s.student_number)} 號</span>
      <span class="nm">${esc(s.name)}</span>
      <span class="st ${r ? 'out' : 'in'}">${r ? `${esc(r.icon)} ${esc(r.reason_title)}` : '✅ 在教室'}</span>
    </button>`;
  }

  // 名冊（依座號）或座位表（依教室座位，與教師設定的座位表相同）
  function renderStudents(d) {
    const list = `<div class="grid">${d.students.map(stuButton).join('')}</div>`;
    const seat = d.seat;
    const seated = d.students.filter((s) => s.seat_row != null);
    if (S.view !== 'seat' || !seat) return list;
    if (!seated.length) return `<p class="hint">這個班級老師還沒有安排座位，請先使用「名冊」。</p>${list}`;
    const at = new Map(seated.map((s) => [`${s.seat_row},${s.seat_col}`, s]));
    let cells = '';
    for (let r = 1; r <= seat.rows; r++) {
      for (let c = 1; c <= seat.cols; c++) {
        const s = at.get(`${r},${c}`);
        cells += s ? stuButton(s) : '<div class="seatempty"></div>';
      }
    }
    const unseated = d.students.filter((s) => s.seat_row == null);
    const bb = ['top', 'bottom', 'left', 'right'].includes(seat.blackboard_position) ? seat.blackboard_position : 'top';
    return `<div class="seatwrap ${bb}">
        <div class="board">講台／黑板</div>
        <div class="seatscroll"><div class="seatgrid" style="grid-template-columns: repeat(${seat.cols}, minmax(84px, 1fr));">${cells}</div></div>
      </div>
      ${unseated.length ? `<p class="hint" style="margin-top:12px;">尚未安排座位的同學：</p><div class="grid">${unseated.map(stuButton).join('')}</div>` : ''}`;
  }

  function render() {
    const d = S.data;
    document.body.classList.toggle('slot-noon', S.slot === 'noon'); // 午休＝暖色系背景
    $('subTitle').textContent = `${d.course_name}　${d.date}`;
    document.title = `${d.course_name} 公出登記`; // 加入書籤時的預設名稱
    const out = d.students.filter((s) => recOf(s));

    const groups = new Map();
    out.forEach((s) => {
      const r = recOf(s);
      const k = r.reason_id ?? `x:${r.reason_title}`;
      if (!groups.has(k)) groups.set(k, { r, list: [] });
      groups.get(k).list.push(s);
    });

    $('app').innerHTML = `
      <div class="bar" id="slotBar">
        ${SLOTS.map((s) => `<button type="button" class="slot-btn ${s.key === S.slot ? 'on' : ''}" data-slot="${s.key}">${s.label}</button>`).join('')}
      </div>

      <div class="panel">
        <h2>🚪 目前不在教室（${slotLabel()}）</h2>
        ${out.length === 0 ? '<div class="none">✅ 全班都在教室</div>' : [...groups.values()].map(({ r, list }) => `
          <div class="out-row">
            <b>${esc(r.icon)} ${esc(r.reason_title)}</b>
            ${r.teacher_name ? `<span class="tag">負責老師：${esc(r.teacher_name)}</span>` : ''}
            <span>${list.map((s) => `${esc(s.student_number)}號 ${esc(s.name)}${recOf(s).note && r.reason_title === '其他' ? `（${esc(recOf(s).note)}）` : ''}`).join('、')}</span>
          </div>`).join('')}
      </div>

      <div class="hintbar">
        <p class="hint" style="margin:0; flex:1;">${S.selecting ? '☑️ 多人模式：點選要一起登記的同學（再點一次取消），選好後按下方「選擇原因」。' : '要離開教室的同學，請點自己的名字，選擇原因。回來時再點一次自己的名字。'}</p>
        <button type="button" class="btn ${S.selecting ? 'primary' : 'ghost'}" id="btnMulti">${S.selecting ? '✖ 結束多人模式' : '☑️ 多人一起登記'}</button>
      </div>
      <div class="viewbar" id="viewBar">
        <button type="button" class="view-btn ${S.view === 'grid' ? 'on' : ''}" data-view="grid">👥 名冊</button>
        <button type="button" class="view-btn ${S.view === 'seat' ? 'on' : ''}" data-view="seat">🪑 座位表</button>
      </div>
      ${renderStudents(d)}
      <div class="selbar" id="selBar" style="display:${S.selecting && S.selected.size ? 'flex' : 'none'};">
        <b>已選 ${S.selected.size} 人</b>
        <button type="button" class="btn primary" id="btnSelSet">📍 選擇原因</button>
        <button type="button" class="btn ghost" id="btnSelClear">取消選取</button>
      </div>
    `;

    $('slotBar').querySelectorAll('button').forEach((b) =>
      b.addEventListener('click', () => { S.slot = b.dataset.slot; render(); })
    );
    $('app').querySelectorAll('.stu').forEach((b) =>
      b.addEventListener('click', () => onStudentClick(Number(b.dataset.id)))
    );
    $('viewBar').querySelectorAll('button').forEach((b) =>
      b.addEventListener('click', () => {
        S.view = b.dataset.view;
        try { localStorage.setItem('wb_kiosk_view', S.view); } catch (_) { /* ignore */ }
        render();
      })
    );
    $('btnMulti').addEventListener('click', () => { S.selecting = !S.selecting; S.selected.clear(); render(); });
    const setBtn = $('btnSelSet');
    if (setBtn) {
      setBtn.addEventListener('click', () => openSheet([...S.selected]));
      $('btnSelClear').addEventListener('click', () => { S.selected.clear(); render(); });
    }
  }

  function onStudentClick(id) {
    if (S.selecting) {
      if (S.selected.has(id)) S.selected.delete(id); else S.selected.add(id);
      render();
    } else {
      openSheet([id]);
    }
  }

  async function save(studentIds, reasonId, note) {
    try {
      const res = await fetch(`${base}/record`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ key, slot: S.slot, student_ids: studentIds, reason_id: reasonId, note }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.detail || '儲存失敗');
      return true;
    } catch (err) {
      toast(err.message, true);
      return false;
    }
  }

  function closeSheet() {
    S.sheetOpen = false;
    $('overlay').classList.remove('show');
    if (S.data) render();
  }

  function openSheet(ids) {
    const d = S.data;
    const stus = ids.map((id) => d.students.find((s) => s.student_id === id)).filter(Boolean);
    if (!stus.length) return;
    const multi = stus.length > 1;
    const cur = multi ? null : recOf(stus[0]);
    S.sheetOpen = true;

    $('sheet').innerHTML = `
      <h3>${multi ? `已選 ${stus.length} 位同學` : `${esc(stus[0].student_number)} 號 ${esc(stus[0].name)}`}</h3>
      <div class="sub">${slotLabel()}${multi ? `｜${stus.map((s) => `${esc(s.student_number)}號 ${esc(s.name)}`).join('、')}` : cur ? `｜目前：${esc(cur.icon)} ${esc(cur.reason_title)}${cur.note ? `（${esc(cur.note)}）` : ''}` : '｜目前在教室'}</div>
      ${cur || multi ? `<button type="button" class="btn green" id="btnBack">${multi ? '✅ 大家都回到教室了' : '✅ 我回到教室了'}</button>` : ''}
      <div style="font-weight:800; margin-bottom:6px;">${multi ? '大家一起離開教室，原因是：' : cur ? '改成其他原因：' : '我要離開教室，原因是：'}</div>
      <div class="reasons">
        ${d.reasons.map((r) => `<button type="button" class="btn" data-reason="${r.id}">${esc(r.icon)} ${esc(r.title)}${r.teacher_name ? `<small>👩‍🏫 ${esc(r.teacher_name)}</small>` : ''}</button>`).join('')}
      </div>
      <div id="otherWrap" style="display:none; margin-top:12px;">
        <label style="font-weight:800;">請輸入原因（必填）</label>
        <input class="txt" id="otherTxt" maxlength="100" placeholder="例如：幫老師搬資料">
        <button type="button" class="btn primary" id="otherOk" style="width:100%;">確定</button>
      </div>
      <div style="text-align:right; margin-top:14px;"><button type="button" class="btn ghost" id="btnCancel">取消</button></div>
    `;
    $('overlay').classList.add('show');

    const done = async (ok, msg) => {
      if (!ok) return;
      toast(msg);
      if (multi) { S.selected.clear(); S.selecting = false; }
      closeSheet();
      load();
    };

    $('btnCancel').addEventListener('click', closeSheet);
    const back = $('btnBack');
    if (back) back.addEventListener('click', async () => done(await save(ids, null, ''), multi ? `已登記 ${ids.length} 人回到教室` : '歡迎回來！已登記在教室'));

    let other = null;
    $('sheet').querySelectorAll('[data-reason]').forEach((b) =>
      b.addEventListener('click', async () => {
        const r = d.reasons.find((x) => x.id === Number(b.dataset.reason));
        if (r.is_other) {
          other = r;
          $('otherWrap').style.display = 'block';
          $('otherTxt').focus();
          return;
        }
        done(await save(ids, r.id, ''), multi ? `已登記 ${ids.length} 人：${r.title}` : `已登記：${r.title}`);
      })
    );
    const submitOther = async () => {
      const note = $('otherTxt').value.trim();
      if (!note) { toast('請輸入原因', true); return; }
      done(await save(ids, other.id, note), multi ? `已登記 ${ids.length} 人：${note}` : `已登記：${note}`);
    };
    $('otherOk').addEventListener('click', submitOther);
    $('otherTxt').addEventListener('keydown', (e) => { if (e.key === 'Enter') submitOther(); });
  }

  $('overlay').addEventListener('mousedown', (e) => { if (e.target === $('overlay')) closeSheet(); });

  // 其他裝置（老師或同學）變更後，約每 10 秒自動更新；操作視窗開著時暫停，避免打斷輸入。
  load().then((ok) => {
    if (!ok && !S.data) return;
    setInterval(() => { if (!S.sheetOpen && !document.hidden) load(); }, 10000);
  });
})();
