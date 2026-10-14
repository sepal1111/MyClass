// MyClass 作業掃描登記模組（教師本機專用，移植自 Examscan 的「收作業」）
// 伺服器端只接受來自教師本機的連線（middleware/localOnly.ts）；這裡另外用 /api/system/local-access
// 判斷是否顯示選單，讓區網內其他裝置根本看不到這個分頁。
(function () {
  const ST = { OK: '已繳交', LATE: '補繳', LEAVE: '請假', MISSING: '未交' };
  const S = {
    courseId: null,
    date: '',
    items: [],
    students: [],
    plan: [],
    records: new Map(), // `${studentId}|${itemId}` -> record
    selected: new Set(),
    onlyMissing: false,
    undoStack: [],
    view: 'scan',
    camera: null,
    lastText: '',
    lastAt: 0,
    labelData: null,
    recent: [],
  };

  const $ = (id) => document.getElementById(id);
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const toast = (m, t) => (window.showToast ? window.showToast(m, t) : console.log(m));
  const todayStr = () => {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  };
  const api = (path) => `/api/homework-scan/${S.courseId}${path}`;
  const itemName = (id) => S.items.find((i) => i.id === id)?.name ?? '（已刪除的作業）';
  const activeItems = () => S.items.filter((i) => !i.archived);
  const statusOf = (sid, iid) => S.records.get(`${sid}|${iid}`)?.status ?? ST.MISSING;
  const selectedItems = () => S.plan.filter((id) => S.selected.has(id));
  const isPaneActive = () => $('pane-hwscan')?.classList.contains('active');

  let bc = null;
  try {
    bc = new BroadcastChannel('teachsys-hwscan');
    bc.onmessage = async (e) => {
      if (e.data?.courseId === S.courseId && e.data?.date === S.date) {
        await loadDay();
        if (S.view === 'scan') {
          renderChips();
          renderGrid();
        }
      }
    };
  } catch (_) {}

  function notifySync() {
    try {
      if (bc) bc.postMessage({ type: 'hwscan-updated', courseId: S.courseId, date: S.date });
    } catch (_) {}
  }

  function openPopup(courseId) {
    const cid = courseId || S.courseId || window.AppState?.currentCourseId;
    const url = `/homework-scan${cid ? `?course_id=${cid}` : ''}`;
    const w = Math.min(1240, (screen.availWidth || 1280) - 40);
    const h = Math.min(920, (screen.availHeight || 960) - 60);
    const left = Math.max(0, Math.floor(((screen.availWidth || 1280) - w) / 2));
    const top = Math.max(0, Math.floor(((screen.availHeight || 960) - h) / 2));
    const features = `popup=yes,width=${w},height=${h},left=${left},top=${top},menubar=no,toolbar=no,location=no,status=no,resizable=yes,scrollbars=yes`;
    const win = window.open(url, 'KYPS_HomeworkScan_Window', features);
    if (win) {
      win.focus();
    }
    return win;
  }

  function openModal(courseId) {
    const cid = courseId || S.courseId || window.AppState?.currentCourseId;
    const old = $('modal-hwscan-popup-wrapper');
    if (old) old.remove();

    const wrap = document.createElement('div');
    wrap.id = 'modal-hwscan-popup-wrapper';
    wrap.className = 'modal-overlay open';
    wrap.style.cssText = 'display:flex;align-items:center;justify-content:center;position:fixed;top:0;left:0;right:0;bottom:0;background:rgba(15,23,42,0.65);backdrop-filter:blur(6px);z-index:100030;padding:16px;';

    wrap.innerHTML = `
      <div class="glass-card" style="width:100%;max-width:1160px;height:90vh;max-height:860px;display:flex;flex-direction:column;padding:0;overflow:hidden;border-radius:18px;box-shadow:0 25px 50px -12px rgba(0,0,0,0.35);">
        <div style="display:flex;align-items:center;justify-content:space-between;padding:12px 18px;background:rgba(255,255,255,0.95);border-bottom:1.5px solid var(--card-border);">
          <div style="font-weight:900;font-size:1.15rem;display:flex;align-items:center;gap:8px;">
            <span>📥 作業掃描登記</span>
            <span style="font-size:0.75rem;padding:2px 8px;background:#4f46e5;color:#fff;border-radius:100px;">浮動彈窗模式</span>
          </div>
          <div style="display:flex;gap:8px;">
            <button type="button" class="btn btn-secondary" id="btn-hwmodal-popout" title="轉為獨立視窗" style="padding:5px 12px;font-size:0.85rem;">↗ 轉為獨立視窗</button>
            <button type="button" class="btn btn-secondary" id="btn-hwmodal-close" style="padding:4px 10px;font-size:1.1rem;line-height:1;">✕</button>
          </div>
        </div>
        <iframe src="/homework-scan?course_id=${cid || ''}" style="width:100%;flex:1;border:none;background:#f8fafc;"></iframe>
      </div>
    `;

    document.body.appendChild(wrap);

    const close = () => wrap.remove();
    wrap.querySelector('#btn-hwmodal-close').addEventListener('click', close);
    wrap.querySelector('#btn-hwmodal-popout').addEventListener('click', () => {
      close();
      openPopup(cid);
    });
    wrap.addEventListener('click', (e) => {
      if (e.target === wrap) close();
    });
  }

  let audioCtx = null;
  function beep(kind) {
    try {
      audioCtx = audioCtx || new (window.AudioContext || window.webkitAudioContext)();
      const o = audioCtx.createOscillator();
      const g = audioCtx.createGain();
      o.frequency.value = kind === 'ok' ? 880 : kind === 'warn' ? 520 : 220;
      g.gain.value = 0.08;
      o.connect(g).connect(audioCtx.destination);
      o.start();
      o.stop(audioCtx.currentTime + (kind === 'bad' ? 0.35 : 0.12));
    } catch (_) { /* 沒有音效也不影響登記 */ }
  }

  // ---------- 載入 ----------

  async function load() {
    S.courseId = window.AppState?.currentCourseId;
    const root = $('hwscan-root');
    if (!root) return;
    if (!S.courseId) {
      root.innerHTML = '<div class="glass-card" style="text-align:center;padding:40px;">請先在上方選擇或建立班級。</div>';
      return;
    }
    if (!S.date) S.date = todayStr();
    try {
      S.items = await API.get(api('/items'));
      await loadDay();
    } catch (err) {
      root.innerHTML = `<div class="glass-card" style="padding:24px;color:var(--accent-negative,#dc2626);">${esc(err.message || '載入失敗')}</div>`;
      return;
    }
    render();
  }

  async function loadDay() {
    const d = await API.get(api(`/day?date=${S.date}`));
    S.students = d.students;
    S.plan = d.plan;
    S.records = new Map(d.records.map((r) => [`${r.student_id}|${r.item_id}`, r]));
    // 只保留還在這天計畫內的勾選；都沒勾就預設勾第一項，省去每天重新勾選
    S.selected = new Set([...S.selected].filter((id) => S.plan.includes(id)));
    if (!S.selected.size && S.plan.length) S.selected.add(S.plan[0]);
  }

  // ---------- 畫面骨架 ----------

  function render() {
    stopCamera();
    const root = $('hwscan-root');
    const tabs = [['scan', '📥 收作業'], ['items', '📚 作業項目'], ['labels', '🏷️ 列印 QR 標籤'], ['export', '📤 匯出紀錄']];
    root.innerHTML = `
      <div class="glass-card" style="margin-bottom:14px;padding:12px 16px;">
        <div style="display:flex;gap:8px;flex-wrap:wrap;align-items:center;">
          ${tabs.map(([k, t]) => `<button type="button" class="btn ${S.view === k ? '' : 'btn-secondary'}" data-hw-view="${k}" style="font-size:0.95rem;padding:8px 16px;">${t}</button>`).join('')}
          <button type="button" class="btn" id="hw-top-popup-btn" style="background:linear-gradient(135deg,#4f46e5,#6366f1);color:#fff;font-weight:700;padding:8px 16px;box-shadow:0 3px 10px rgba(79,70,229,0.3);display:inline-flex;align-items:center;gap:6px;">🚀 開啟小助手獨立掃描視窗</button>
          <span style="margin-left:auto;font-size:0.8rem;color:var(--text-muted);">🔒 僅限教師本機使用，資料不會傳到其他裝置</span>
        </div>
      </div>
      <div id="hw-body"></div>`;
    root.querySelectorAll('[data-hw-view]').forEach((b) =>
      b.addEventListener('click', () => { S.view = b.dataset.hwView; render(); })
    );
    root.querySelector('#hw-top-popup-btn')?.addEventListener('click', () => openPopup());
    ({ scan: renderScan, items: renderItems, labels: renderLabels, export: renderExport })[S.view]();
  }

  // ---------- 收作業 ----------

  function renderScan() {
    const body = $('hw-body');
    if (!S.students.length || !activeItems().length) {
      body.innerHTML = `<div class="glass-card" style="text-align:center;padding:40px;">
        <h3>${!S.students.length ? '這個班級還沒有學生名冊' : '還沒有作業項目'}</h3>
        <p style="color:var(--text-muted);">${!S.students.length ? '請先到「設定 → 學生名冊管理」匯入或新增學生。' : '請先建立作業項目（例如：聯絡簿、國語習作）。'}</p>
        ${S.students.length ? '<button type="button" class="btn" id="hw-go-items">📚 前往作業項目</button>' : ''}</div>`;
      $('hw-go-items')?.addEventListener('click', () => { S.view = 'items'; render(); });
      return;
    }
    body.innerHTML = `
      <!-- 小助手專屬獨立彈出視窗工作區推薦卡片 -->
      <div class="glass-card" style="background:linear-gradient(135deg, rgba(79, 70, 229, 0.08) 0%, rgba(99, 102, 241, 0.04) 100%);border:1.5px solid rgba(79, 70, 229, 0.28);padding:18px 20px;margin-bottom:14px;border-radius:14px;">
        <div style="display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:12px;">
          <div>
            <div style="font-size:1.15rem;font-weight:900;color:#3730a3;display:flex;align-items:center;gap:8px;">
              <span>👩‍🎓</span>
              <span>小助手作業掃描登記（獨立彈出視窗）</span>
              <span style="font-size:0.75rem;padding:2px 8px;background:#4f46e5;color:#fff;border-radius:100px;font-weight:700;">推薦</span>
            </div>
            <div style="font-size:0.88rem;color:var(--text-muted);margin-top:4px;max-width:700px;">
              作業掃描登記已全面支援「獨立彈出視窗」！可將獨立彈窗拖曳至第二螢幕或交由小助手刷條碼登記，具備超大反饋看板、自動對焦與音效，不影響老師主畫面操作。
            </div>
          </div>
          <div style="display:flex;gap:10px;flex-wrap:wrap;">
            <button type="button" class="btn" id="hw-hero-open-popup" style="background:linear-gradient(135deg,#4f46e5,#6366f1);color:#fff;font-weight:800;padding:10px 18px;font-size:0.95rem;box-shadow:0 4px 14px rgba(79,70,229,0.35);display:inline-flex;align-items:center;gap:6px;">
              🚀 開啟獨立彈出視窗（推薦）
            </button>
            <button type="button" class="btn btn-secondary" id="hw-hero-open-modal" style="font-weight:700;padding:10px 16px;font-size:0.92rem;display:inline-flex;align-items:center;gap:6px;">
              🪟 在頁面浮動彈窗開啟
            </button>
          </div>
        </div>
      </div>

      <div class="glass-card">
        <div style="display:flex;gap:10px;flex-wrap:wrap;align-items:center;">
          <label for="hw-date" style="font-weight:700;">日期</label>
          <input type="date" id="hw-date" class="input-control" style="width:auto;" value="${S.date}">
          <button type="button" class="btn btn-secondary" id="hw-today">回到今天</button>
        </div>
        <h4 style="margin:14px 0 6px;">① 這天要收哪些作業？<span style="font-weight:400;font-size:0.85rem;color:var(--text-muted);">（點一下加入或移除）</span></h4>
        <div id="hw-plan-chips" style="display:flex;gap:8px;flex-wrap:wrap;"></div>
      </div>
      <div class="glass-card">
        <h4 style="margin:0 0 6px;">② 掃描作業上的 QR Code
          <span style="font-weight:400;font-size:0.85rem;color:var(--text-muted);">（每張 QR Code 已綁定「學生＋作業」，掃一下就自動記錄是誰交了什麼）</span></h4>
        <div style="display:flex;gap:8px;flex-wrap:wrap;">
          <input type="text" id="hw-input" class="input-control" style="flex:1;min-width:220px;font-size:1.1rem;" placeholder="請掃描作業上的 QR Code…" autocomplete="off">
          <button type="button" class="btn btn-secondary" id="hw-cam-btn">📷 開啟鏡頭</button>
          <button type="button" class="btn btn-secondary" id="hw-undo" disabled>↩️ 復原上一筆</button>
        </div>
        <div id="hw-cam" style="display:none;max-width:420px;margin-top:10px;"></div>
        <div id="hw-feedback" style="margin-top:12px;padding:16px;border-radius:12px;font-size:1.3rem;font-weight:800;background:var(--input-bg);text-align:center;">等待掃描…</div>
        <div id="hw-recent" style="margin-top:10px;font-size:0.9rem;"></div>
        <details style="margin-top:12px;">
          <summary style="cursor:pointer;font-weight:700;">作業上沒有 QR Code？改用借書證條碼登記</summary>
          <p style="font-size:0.85rem;color:var(--text-muted);">勾選現在要收哪些作業（可多項），再刷學生借書證，會一次登記所有勾選的作業。專屬 QR Code 不受這裡的勾選影響。</p>
          <div id="hw-cur-chips" style="display:flex;gap:8px;flex-wrap:wrap;"></div>
        </details>
      </div>
      <div class="glass-card">
        <div style="display:flex;gap:10px;flex-wrap:wrap;align-items:center;justify-content:space-between;">
          <div id="hw-progress" style="font-weight:700;"></div>
          <div style="display:flex;gap:8px;">
            <button type="button" class="btn btn-secondary" id="hw-filter"></button>
            <button type="button" class="btn btn-secondary" id="hw-export-day">📤 匯出這天名單</button>
          </div>
        </div>
        <p style="font-size:0.85rem;color:var(--text-muted);">點學生卡片可手動登記：已繳交、補繳、請假，或改回未交。</p>
        <div id="hw-grid" style="display:grid;grid-template-columns:repeat(auto-fill,minmax(118px,1fr));gap:10px;"></div>
      </div>`;

    $('hw-hero-open-popup')?.addEventListener('click', () => openPopup());
    $('hw-hero-open-modal')?.addEventListener('click', () => openModal());
    $('hw-date').addEventListener('change', async (e) => {
      if (!e.target.value) return;
      S.date = e.target.value;
      S.undoStack = [];
      await loadDay();
      renderScan();
    });
    $('hw-today').addEventListener('click', async () => {
      S.date = todayStr();
      S.undoStack = [];
      await loadDay();
      renderScan();
    });
    $('hw-input').addEventListener('keydown', (e) => {
      if (e.key !== 'Enter') return;
      e.preventDefault();
      const v = e.target.value.trim();
      e.target.value = '';
      if (v) handleScan(v);
    });
    $('hw-cam-btn').addEventListener('click', () => (S.camera ? stopCamera() : startCamera()));
    $('hw-undo').addEventListener('click', undo);
    $('hw-filter').addEventListener('click', () => { S.onlyMissing = !S.onlyMissing; renderGrid(); });
    $('hw-export-day').addEventListener('click', () => download(`/export?from=${S.date}&to=${S.date}&format=xlsx`));
    renderChips();
    renderGrid();
    updateUndoBtn();
    renderRecent();
    $('hw-input').focus();
  }

  function renderChips() {
    $('hw-plan-chips').innerHTML = activeItems()
      .map((i) => {
        const on = S.plan.includes(i.id);
        return `<button type="button" class="btn ${on ? '' : 'btn-secondary'}" data-plan="${i.id}" style="padding:6px 14px;">${on ? '✔ ' : ''}${esc(i.name)}</button>`;
      }).join('');
    $('hw-plan-chips').querySelectorAll('[data-plan]').forEach((b) =>
      b.addEventListener('click', () => togglePlan(Number(b.dataset.plan)))
    );
    $('hw-cur-chips').innerHTML = S.plan.length
      ? S.plan.map((id) => {
        const on = S.selected.has(id);
        return `<button type="button" class="btn ${on ? '' : 'btn-secondary'}" data-cur="${id}" style="padding:6px 14px;${on ? 'background:linear-gradient(135deg,#22a06b,#15803d);' : ''}">${on ? '✔ ' : ''}${esc(itemName(id))}</button>`;
      }).join('')
      : '<span style="color:var(--text-muted);">請先在上方 ① 選擇這天要收的作業，或直接掃作業簿上的 QR Code。</span>';
    $('hw-cur-chips').querySelectorAll('[data-cur]').forEach((b) =>
      b.addEventListener('click', () => {
        const id = Number(b.dataset.cur);
        S.selected.has(id) ? S.selected.delete(id) : S.selected.add(id);
        renderChips();
        renderGrid();
        $('hw-input')?.focus();
      })
    );
  }

  async function togglePlan(itemId) {
    const on = S.plan.includes(itemId);
    if (on) {
      const count = [...S.records.values()].filter((r) => r.item_id === itemId).length;
      if (count && !(await window.showConfirmModal({
        title: '移除這項作業？',
        desc: `「${itemName(itemId)}」這天已經登記了 ${count} 筆。移除後這些紀錄不會出現在報表中（重新加入就會恢復）。`,
        confirmText: '移除', danger: true,
      }))) return;
    }
    const next = on ? S.plan.filter((id) => id !== itemId) : [...S.plan, itemId];
    await API.put(api('/plan'), { date: S.date, item_ids: next });
    if (!on) S.selected.add(itemId);
    await loadDay();
    renderChips();
    renderGrid();
    notifySync();
    $('hw-input')?.focus();
  }

  function renderGrid(flashId = null) {
    const grid = $('hw-grid');
    if (!grid) return;
    const items = selectedItems();
    const filterBtn = $('hw-filter');
    if (!items.length) {
      grid.innerHTML = '';
      $('hw-progress').textContent = '';
      filterBtn.hidden = true;
      return;
    }
    filterBtn.hidden = false;
    filterBtn.textContent = S.onlyMissing ? '顯示全部學生' : '只看未交';
    $('hw-progress').innerHTML = items.map((id) => {
      const done = S.students.filter((s) => statusOf(s.id, id) !== ST.MISSING).length;
      return `<div>${esc(itemName(id))}：已登記 ${done} / ${S.students.length} 人</div>`;
    }).join('');
    const isMissingAny = (s) => items.some((id) => statusOf(s.id, id) === ST.MISSING);
    const shown = S.onlyMissing ? S.students.filter(isMissingAny) : S.students;
    const color = { [ST.OK]: '#16a34a', [ST.LATE]: '#d97706', [ST.LEAVE]: '#6b7280', [ST.MISSING]: '#dc2626' };
    grid.innerHTML = shown.length
      ? shown.map((s) => {
        const body = items.length === 1
          ? `<div style="font-weight:800;color:${color[statusOf(s.id, items[0])]};">${statusOf(s.id, items[0])}</div>`
          : items.map((id) => `<div style="font-size:0.78rem;color:${color[statusOf(s.id, id)]};">${esc(itemName(id))} ${statusOf(s.id, id)}</div>`).join('');
        const flash = s.id === flashId ? 'outline:3px solid #22c55e;' : '';
        return `<button type="button" data-sid="${s.id}" class="glass-card" style="margin:0;padding:10px;text-align:center;cursor:pointer;${flash}">
          <div style="font-size:0.8rem;color:var(--text-muted);">${s.number} 號</div>
          <div style="font-size:1.05rem;font-weight:800;">${esc(s.name)}</div>${body}</button>`;
      }).join('')
      : '<div style="grid-column:1/-1;text-align:center;padding:24px;font-size:1.2rem;">🎉 全部都交了！</div>';
    grid.querySelectorAll('[data-sid]').forEach((c) => c.addEventListener('click', () => manualMark(Number(c.dataset.sid))));
  }

  function feedback(kind, title, detail = '') {
    const fb = $('hw-feedback');
    if (fb) {
      const bg = { ok: 'rgba(34,197,94,.22)', warn: 'rgba(245,158,11,.25)', bad: 'rgba(239,68,68,.25)' }[kind];
      fb.style.background = bg;
      fb.innerHTML = `${esc(title)}${detail ? `<div style="font-size:0.9rem;font-weight:500;margin-top:4px;">${esc(detail)}</div>` : ''}`;
    }
    beep(kind);
  }

  function pushRecent(text) {
    S.recent.unshift(`${new Date().toTimeString().slice(0, 8)}　${text}`);
    S.recent = S.recent.slice(0, 5);
    renderRecent();
  }

  function renderRecent() {
    const el = $('hw-recent');
    if (el) el.innerHTML = S.recent.length ? `<div style="color:var(--text-muted);">最近登記：</div>${S.recent.map((t) => `<div>✔ ${esc(t)}</div>`).join('')}` : '';
  }

  function updateUndoBtn() {
    const b = $('hw-undo');
    if (b) b.disabled = !S.undoStack.length;
  }

  function applyLocal(studentId, itemId, rec) {
    const key = `${studentId}|${itemId}`;
    if (rec) S.records.set(key, { student_id: studentId, item_id: itemId, ...rec });
    else S.records.delete(key);
  }

  async function handleScan(raw) {
    let r;
    try {
      r = await API.post(api('/scan'), { date: S.date, code: raw, item_ids: selectedItems() });
    } catch (err) {
      return feedback('bad', '登記失敗', err.message || '請再試一次');
    }
    if (r.type === 'empty') return;
    if (!r.ok) return feedback('bad', r.message, r.detail || '');

    if (r.type === 'item') {
      S.selected.add(r.item.id);
      await loadDay();
      S.selected.add(r.item.id);
      renderChips();
      renderGrid();
      return feedback('ok', `已加入現在收：${r.item.name}`, '接著掃描學生的借書證');
    }

    const st = r.student;
    const label = `${st.number} ${st.name}`;
    if (r.type === 'homework') {
      const wasInPlan = S.plan.includes((r.done[0] ?? r.dup[0]));
      if (!wasInPlan) { await loadDay(); renderChips(); }
    }
    r.changes.forEach((c) => S.undoStack.push({ date: S.date, ...c }));
    const time = new Date().toTimeString().slice(0, 8);
    r.done.forEach((id) => applyLocal(st.id, id, { status: ST.OK, time: `${S.date} ${time}`, method: '掃描' }));
    updateUndoBtn();
    if (r.done.length) {
      pushRecent(`${label}　${r.done.map(itemName).join('、')}`);
      const detail = r.dup.length
        ? `${r.done.map(itemName).join('、')} 已繳交；${r.dup.map(itemName).join('、')} 已經登記過了`
        : `${r.done.map(itemName).join('、')} 已繳交`;
      feedback('ok', `✔ ${label}`, detail);
    } else {
      feedback('warn', `${st.name} 已經登記過了`, r.dup.map(itemName).join('、'));
    }
    renderGrid(st.id);
    notifySync();
  }

  async function sendMark(studentId, itemId, status, extra = {}) {
    return API.put(api('/mark'), { date: S.date, student_id: studentId, item_id: itemId, status, ...extra });
  }

  async function undo() {
    const last = S.undoStack.pop();
    if (!last) return;
    try {
      const p = last.previous;
      await API.put(api('/mark'), {
        date: last.date, student_id: last.student_id, item_id: last.item_id,
        status: p ? p.status : null, time: p?.time, method: p?.method,
      });
      applyLocal(last.student_id, last.item_id, p);
      const st = S.students.find((s) => s.id === last.student_id);
      feedback('warn', `已復原：${st?.name ?? ''}`, `${itemName(last.item_id)} 回到「${p?.status ?? ST.MISSING}」`);
    } catch (err) {
      S.undoStack.push(last);
      toast(err.message || '復原失敗', 'error');
    }
    updateUndoBtn();
    renderGrid();
    notifySync();
    $('hw-input')?.focus();
  }

  // 手動登記：以彈窗讓老師選狀態（單項或多項作業都適用）
  function manualMark(studentId) {
    const items = selectedItems();
    const st = S.students.find((s) => s.id === studentId);
    if (!st || !items.length) return;
    const old = $('hw-manual');
    old?.remove();
    const wrap = document.createElement('div');
    wrap.id = 'hw-manual';
    wrap.className = 'modal-overlay';
    wrap.style.cssText = 'display:flex;z-index:100020;';
    const rows = items.map((id) => {
      const cur = S.records.get(`${studentId}|${id}`);
      const btn = (v, label, cls = 'btn-secondary') => `<button type="button" class="btn ${cls}" data-item="${id}" data-val="${v}" style="padding:8px 12px;">${label}</button>`;
      return `<div style="margin-bottom:14px;">
        <div style="font-weight:800;margin-bottom:6px;">${esc(itemName(id))}<span style="font-weight:400;color:var(--text-muted);">　${cur ? `${esc(cur.status)}（${esc((cur.time || '').slice(11))}，${esc(cur.method)}）` : ST.MISSING}</span></div>
        <div style="display:flex;gap:6px;flex-wrap:wrap;">${btn(ST.OK, '✔ 已繳交', '')}${btn(ST.LATE, '⏰ 補繳')}${btn(ST.LEAVE, '🏠 請假')}${btn('clear', '✖ 改回未交')}</div></div>`;
    }).join('');
    wrap.innerHTML = `<div class="modal-content glass-card" style="max-width:520px;width:92%;">
      <h3 style="margin-top:0;">${st.number} ${esc(st.name)}｜手動登記</h3>${rows}
      <div style="text-align:right;"><button type="button" class="btn btn-secondary" id="hw-manual-close">關閉</button></div></div>`;
    document.body.appendChild(wrap);
    const close = () => { wrap.remove(); $('hw-input')?.focus(); };
    wrap.addEventListener('click', (e) => { if (e.target === wrap) close(); });
    wrap.querySelector('#hw-manual-close').addEventListener('click', close);
    wrap.querySelectorAll('[data-val]').forEach((b) => b.addEventListener('click', async () => {
      const itemId = Number(b.dataset.item);
      const val = b.dataset.val;
      const cur = S.records.get(`${studentId}|${itemId}`);
      try {
        if (val === 'clear') {
          if (cur) await sendMark(studentId, itemId, null);
          applyLocal(studentId, itemId, null);
          if (cur) S.undoStack.push({ date: S.date, student_id: studentId, item_id: itemId, previous: { status: cur.status, time: cur.time, method: cur.method } });
          feedback('warn', `${st.name} 改回未交`, itemName(itemId));
        } else if (!cur || cur.status !== val) {
          await sendMark(studentId, itemId, val);
          S.undoStack.push({ date: S.date, student_id: studentId, item_id: itemId, previous: cur ? { status: cur.status, time: cur.time, method: cur.method } : null });
          applyLocal(studentId, itemId, { status: val, time: `${S.date} ${new Date().toTimeString().slice(0, 8)}`, method: '手動' });
          feedback('ok', `✔ ${st.number} ${st.name}`, `${itemName(itemId)}：${val}`);
        }
      } catch (err) {
        return toast(err.message || '登記失敗', 'error');
      }
      updateUndoBtn();
      close();
      renderGrid(studentId);
      notifySync();
    }));
  }

  // ---------- 鏡頭掃描（電腦本機相機；localhost 屬於安全來源，不需另外處理憑證）----------

  function loadScript(src) {
    return new Promise((resolve, reject) => {
      if (window.Html5Qrcode) return resolve();
      const s = document.createElement('script');
      s.src = src;
      s.onload = resolve;
      s.onerror = reject;
      document.head.appendChild(s);
    });
  }

  async function startCamera() {
    try {
      await loadScript('/static/js/vendor/html5-qrcode.min.js');
    } catch {
      return toast('鏡頭掃描元件載入失敗，請改用掃描器或手動輸入', 'error');
    }
    const box = $('hw-cam');
    box.style.display = 'block';
    box.innerHTML = '<div id="hw-cam-view"></div>';
    const F = window.Html5QrcodeSupportedFormats;
    const scanner = new window.Html5Qrcode('hw-cam-view', {
      formatsToSupport: [F.QR_CODE, F.CODE_128, F.CODE_39, F.EAN_13, F.CODABAR, F.ITF],
      verbose: false,
    });
    try {
      await scanner.start({ facingMode: 'environment' }, { fps: 10, qrbox: { width: 260, height: 160 } }, (text) => {
        const now = Date.now();
        if (text === S.lastText && now - S.lastAt < 3000) return; // 同一張條碼停在鏡頭前不要重複登記
        S.lastText = text;
        S.lastAt = now;
        handleScan(text);
      }, () => {});
      S.camera = scanner;
      $('hw-cam-btn').textContent = '⏹ 關閉鏡頭';
    } catch {
      box.style.display = 'none';
      toast('無法開啟鏡頭：請確認電腦有接上相機，且沒有被其他程式使用', 'error');
    }
  }

  function stopCamera() {
    const cam = S.camera;
    S.camera = null;
    if (cam) cam.stop().then(() => cam.clear()).catch(() => {});
    const box = $('hw-cam');
    if (box) box.style.display = 'none';
    const btn = $('hw-cam-btn');
    if (btn) btn.textContent = '📷 開啟鏡頭';
  }

  // 條碼掃描器的輸入就像鍵盤打字：焦點不在輸入框時自動移回掃描框，避免漏掃
  window.addEventListener('keydown', (e) => {
    if (!isPaneActive() || S.view !== 'scan' || $('hw-manual')) return;
    const input = $('hw-input');
    if (!input) return;
    const tag = document.activeElement?.tagName;
    if (tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA') return;
    if (e.key.length === 1 && !e.ctrlKey && !e.altKey && !e.metaKey) input.focus();
  }, true);

  // ---------- 作業項目 ----------

  function renderItems() {
    const quick = ['聯絡簿', '國語習作', '數學習作', '數學練習簿', '日記', '國語作業簿'].filter((n) => !S.items.some((i) => i.name === n));
    $('hw-body').innerHTML = `
      <div class="glass-card">
        <h4 style="margin-top:0;">新增作業項目</h4>
        <div style="display:flex;gap:8px;flex-wrap:wrap;">
          <input type="text" id="hw-new" class="input-control" style="flex:1;min-width:200px;" placeholder="例如：聯絡簿、國語習作、數學練習簿">
          <button type="button" class="btn" id="hw-add">➕ 新增</button>
        </div>
        ${quick.length ? `<p style="font-size:0.85rem;color:var(--text-muted);">常用：${quick.map((n) => `<button type="button" class="btn btn-secondary" data-quick="${esc(n)}" style="padding:3px 10px;font-size:0.85rem;">＋${esc(n)}</button>`).join(' ')}</p>` : ''}
      </div>
      <div class="glass-card">
        ${S.items.length ? `<table style="width:100%;border-collapse:collapse;">
          <thead><tr style="text-align:left;"><th>作業項目</th><th>狀態</th><th>登記筆數</th><th></th></tr></thead><tbody>
          ${S.items.map((i) => `<tr style="border-top:1px solid var(--card-border);">
            <td style="padding:8px 4px;">${esc(i.name)}</td><td>${i.archived ? '已停用' : '使用中'}</td><td>${i.record_count}</td>
            <td style="text-align:right;white-space:nowrap;">
              <button type="button" class="btn btn-secondary" data-rename="${i.id}" style="padding:4px 10px;">改名</button>
              <button type="button" class="btn btn-secondary" data-archive="${i.id}" style="padding:4px 10px;">${i.archived ? '重新啟用' : '停用'}</button>
              <button type="button" class="btn btn-secondary" data-del="${i.id}" style="padding:4px 10px;color:#f87171;">刪除</button></td></tr>`).join('')}
          </tbody></table>
          <p style="font-size:0.85rem;color:var(--text-muted);">「停用」的項目不會出現在收作業畫面，但舊紀錄會保留，隨時可以重新啟用。</p>`
          : '<div style="text-align:center;padding:24px;color:var(--text-muted);">還沒有作業項目：在上方輸入名稱，或點「常用」按鈕快速加入。</div>'}
      </div>`;
    const input = $('hw-new');
    const add = (name) => addItem(name);
    $('hw-add').addEventListener('click', () => add(input.value));
    input.addEventListener('keydown', (e) => { if (e.key === 'Enter') add(input.value); });
    $('hw-body').querySelectorAll('[data-quick]').forEach((b) => b.addEventListener('click', () => add(b.dataset.quick)));
    $('hw-body').querySelectorAll('[data-rename]').forEach((b) => b.addEventListener('click', () => renameItem(Number(b.dataset.rename))));
    $('hw-body').querySelectorAll('[data-archive]').forEach((b) => b.addEventListener('click', () => toggleArchive(Number(b.dataset.archive))));
    $('hw-body').querySelectorAll('[data-del]').forEach((b) => b.addEventListener('click', () => deleteItem(Number(b.dataset.del))));
    input.focus();
  }

  async function reloadItems() {
    S.items = await API.get(api('/items'));
    await loadDay();
    renderItems();
  }

  async function addItem(raw) {
    const name = raw.trim();
    if (!name) return toast('請輸入作業名稱', 'error');
    try {
      await API.post(api('/items'), { name });
      toast(`已新增「${name}」`);
      await reloadItems();
    } catch (err) { toast(err.message, 'error'); }
  }

  async function renameItem(id) {
    const item = S.items.find((i) => i.id === id);
    const name = await window.showPromptModal({ title: '修改作業名稱', defaultValue: item.name });
    if (name === null || !name.trim()) return;
    try {
      await API.put(api(`/items/${id}`), { name });
      await reloadItems();
    } catch (err) { toast(err.message, 'error'); }
  }

  async function toggleArchive(id) {
    const item = S.items.find((i) => i.id === id);
    await API.put(api(`/items/${id}`), { archived: !item.archived });
    toast(item.archived ? `已重新啟用「${item.name}」` : `已停用「${item.name}」`);
    await reloadItems();
  }

  async function deleteItem(id) {
    const item = S.items.find((i) => i.id === id);
    const ok = await window.showConfirmModal({
      title: '刪除作業項目？',
      desc: item.record_count
        ? `「${item.name}」已有 ${item.record_count} 筆繳交紀錄，刪除後紀錄也會一起消失。建議改用「停用」。`
        : `確定刪除「${item.name}」？`,
      confirmText: '刪除', danger: true,
    });
    if (!ok) return;
    await API.delete(api(`/items/${id}`));
    S.selected.delete(id);
    toast(`已刪除「${item.name}」`);
    await reloadItems();
  }

  // ---------- 列印 QR 標籤 ----------

  const PRESETS = [
    { id: 'a4-24', name: 'A4 24 格（3×8，約 63×34 mm）- 推薦', cols: 3, rows: 8 },
    { id: 'a4-21', name: 'A4 21 格（3×7，約 63×39 mm）', cols: 3, rows: 7 },
    { id: 'a4-18', name: 'A4 18 格（3×6，約 63×46 mm，大字清晰）', cols: 3, rows: 6 },
    { id: 'a4-40', name: 'A4 40 格（4×10，約 47×27 mm，小貼紙）', cols: 4, rows: 10 },
    { id: 'a4-10', name: 'A4 10 格（2×5，約 95×55 mm，大貼紙）', cols: 2, rows: 5 },
  ];

  function renderLabels() {
    const checks = (list, name, label) => list.map((x) =>
      `<label style="display:inline-flex;align-items:center;gap:4px;margin:2px 10px 2px 0;"><input type="checkbox" name="${name}" value="${x.id}" checked> ${esc(label(x))}</label>`).join('');
    $('hw-body').innerHTML = `
      <div class="glass-card">
        <h4 style="margin-top:0;">列印 QR Code 標籤</h4>
        <div style="display:grid;gap:12px;">
          <div><label style="font-weight:700;">標籤種類</label><br>
            <select id="hw-kind" class="input-control" style="width:auto;">
              <option value="homework">作業簿專屬 QR Code（每位學生 × 每項作業）</option>
              <option value="item">作業項目 QR Code（掃了就切換「現在收」的作業）</option>
              <option value="student">學生條碼 QR Code（沒有借書證的學生使用）</option>
            </select></div>
          <div id="hw-lbl-students"><label style="font-weight:700;">學生</label>
            <button type="button" class="btn btn-secondary" id="hw-stu-all" style="padding:2px 10px;">全選/取消</button><br>
            ${checks(S.students, 'hw-stu', (s) => `${s.number} ${s.name}`)}</div>
          <div id="hw-lbl-items"><label style="font-weight:700;">作業項目</label><br>
            ${checks(activeItems(), 'hw-itm', (i) => i.name)}</div>
          <div style="display:flex;gap:14px;flex-wrap:wrap;align-items:center;">
            <label>貼紙版型規格 <select id="hw-preset" class="input-control" style="width:auto;">${PRESETS.map((p) => `<option value="${p.id}">${p.name}</option>`).join('')}</select></label>
            <label>紙張邊緣留白 <select id="hw-margin" class="input-control" style="width:auto;">
              <option value="10" selected>保留 10 mm（推薦，防印表機裁切）</option>
              <option value="12">保留 12 mm（超大安全邊距）</option>
              <option value="8">保留 8 mm</option>
              <option value="5">保留 5 mm</option>
            </select></label>
            <label>每張份數 <input type="number" id="hw-copies" class="input-control" style="width:80px;" min="1" max="10" value="1"></label>
            <label>從第幾格開始 <input type="number" id="hw-start" class="input-control" style="width:80px;" min="1" value="1"></label>
            <label style="display:inline-flex;align-items:center;gap:6px;cursor:pointer;font-size:0.9rem;">
              <input type="checkbox" id="hw-cutlines" checked> 顯示裁切輔助虛線
            </label>
          </div>
          <div style="font-size:0.85rem;color:var(--text-muted);background:rgba(79,70,229,0.06);padding:8px 12px;border-radius:8px;border-left:3px solid #4f46e5;">
            💡 系統已預設為紙張四周保留 <strong>10 mm 安全邊距</strong>，確保各廠牌印表機均能完整印出邊緣的 QR Code，不會因硬體極限而遭到裁切。
          </div>
          <div><button type="button" class="btn" id="hw-print">🖨️ 預覽並列印</button></div>
        </div>
      </div>`;
    const sync = () => {
      const k = $('hw-kind').value;
      $('hw-lbl-students').style.display = k === 'item' ? 'none' : '';
      $('hw-lbl-items').style.display = k === 'student' ? 'none' : '';
    };
    $('hw-kind').addEventListener('change', sync);
    sync();
    $('hw-stu-all').addEventListener('click', () => {
      const boxes = [...document.querySelectorAll('input[name="hw-stu"]')];
      const all = boxes.every((b) => b.checked);
      boxes.forEach((b) => (b.checked = !all));
    });
    $('hw-print').addEventListener('click', printLabels);
  }

  async function printLabels() {
    const val = (name) => [...document.querySelectorAll(`input[name="${name}"]:checked`)].map((b) => b.value).join(',');
    const kind = $('hw-kind').value;
    const preset = PRESETS.find((p) => p.id === $('hw-preset').value) || PRESETS[0];
    const margin = Number($('hw-margin')?.value || 10);
    const showCutlines = $('hw-cutlines')?.checked ?? true;
    const copies = Number($('hw-copies').value) || 1;
    const start = Math.max(1, Number($('hw-start').value) || 1);

    // 依邊緣留白計算可用列印範圍（A4 標準尺寸：210mm × 297mm）
    const availW = Math.max(100, 210 - margin * 2);
    const availH = Math.max(100, 297 - margin * 2);
    const cellW = (availW / preset.cols).toFixed(2);
    const cellH = (availH / preset.rows).toFixed(2);
    const qrSize = Math.max(18, Math.min(Number(cellH) - 6, 26));
    const fontSize = Math.max(7.5, Math.min(10.5, Number(cellH) / 3.8));
    const titleSize = (fontSize + 2.5).toFixed(1);

    // 先同步開啟視窗，避免等待網路後被瀏覽器當成彈出視窗擋下
    const win = window.open('', '_blank');
    if (!win) return toast('瀏覽器擋住了預覽視窗，請允許此網站的彈出視窗後再按一次', 'error');
    win.document.write('<p style="font-family:sans-serif">產生標籤中…</p>');
    let data;
    try {
      data = await API.get(api(`/labels?kind=${kind}&student_ids=${val('hw-stu')}&item_ids=${val('hw-itm')}&copies=${copies}`));
    } catch (err) {
      win.close();
      return toast(err.message || '產生標籤失敗', 'error');
    }
    if (!data.labels.length) {
      win.close();
      return toast(data.skipped.length ? `這些學生沒有借書證條碼：${data.skipped.join('、')}` : '請至少勾選一位學生或一項作業', 'error');
    }
    const perPage = preset.cols * preset.rows;
    const cells = [...Array(start - 1).fill(null), ...data.labels];
    const pages = [];
    for (let i = 0; i < cells.length; i += perPage) pages.push(cells.slice(i, i + perPage));
    const cell = (l) => l
      ? `<div class="lb"><div class="qr">${l.svg}</div><div class="tx">${l.lines.filter(Boolean).map((t, i) => `<div class="${i === 0 ? 'ln1' : ''}">${esc(t)}</div>`).join('')}</div></div>`
      : '<div class="lb"></div>';
    win.document.open();
    win.document.write(`<!doctype html><html lang="zh-Hant"><head><meta charset="utf-8"><title>QR 標籤列印預覽</title><style>
      @page{size:A4 portrait;margin:${margin}mm}
      *{box-sizing:border-box}
      body{margin:0;padding:0;font-family:"Noto Sans TC","Microsoft JhengHei",system-ui,sans-serif;background:#f1f5f9;-webkit-print-color-adjust:exact;print-color-adjust:exact}
      .bar{padding:12px 20px;background:#eef2ff;border-bottom:1.5px solid #c7d2fe;position:sticky;top:0;z-index:100;display:flex;align-items:center;justify-content:space-between;gap:12px;flex-wrap:wrap;box-shadow:0 2px 10px rgba(0,0,0,0.06)}
      .bar-info{font-size:14px;color:#3730a3;font-weight:600}
      .bar-btn{font-size:15px;font-weight:800;padding:8px 22px;background:#4f46e5;color:#fff;border:none;border-radius:8px;cursor:pointer;box-shadow:0 2px 8px rgba(79,70,229,0.3)}
      .bar-btn:hover{background:#4338ca}
      .page-container{padding:20px 0;display:flex;flex-direction:column;align-items:center;gap:20px}
      .page{width:${availW}mm;height:${availH}mm;max-width:${availW}mm;max-height:${availH}mm;background:#ffffff;box-shadow:0 4px 20px rgba(0,0,0,0.1);page-break-after:always;break-after:page;display:grid;grid-template-columns:repeat(${preset.cols},${cellW}mm);grid-auto-rows:${cellH}mm;justify-content:center;align-content:start;overflow:hidden}
      .lb{box-sizing:border-box;display:flex;align-items:center;gap:2.5mm;padding:2mm 3mm;overflow:hidden;${showCutlines ? 'border:0.5px dashed #cbd5e1;border-radius:2mm;' : ''}}
      .qr{height:${qrSize}mm;width:${qrSize}mm;flex:none;display:flex;align-items:center;justify-content:center}.qr svg{width:100%;height:100%}
      .tx{font-size:${fontSize.toFixed(1)}pt;line-height:1.25;min-width:0;word-break:break-all}
      .ln1{font-weight:800;font-size:${titleSize}pt;color:#0f172a;margin-bottom:1.5px}
      @media print{
        body{background:transparent !important}
        .bar{display:none !important}
        .page-container{padding:0 !important;gap:0 !important}
        .page{margin:0 !important;box-shadow:none !important;page-break-after:always !important;break-after:page !important}
      }</style></head><body>
      <div class="bar">
        <div class="bar-info">
          ✅ 共 ${data.labels.length} 張標籤、${pages.length} 頁 ｜ 四邊已保留 <strong>${margin} mm 安全邊距</strong>（避免印表機邊緣裁切）。列印時請在印表機設定中確認縮放選「實際大小 / 100%」，邊界選擇「預設」或「無」。
        </div>
        <button class="bar-btn" onclick="print()">🖨️ 列印標籤</button>
      </div>
      <div class="page-container">
        ${pages.map((p) => `<div class="page">${p.map(cell).join('')}</div>`).join('')}
      </div></body></html>`);
    win.document.close();
    if (data.skipped.length) toast(`這些學生沒有借書證條碼，已略過：${data.skipped.join('、')}`, 'error');
  }

  // ---------- 匯出 ----------

  function renderExport() {
    const t = S.date || todayStr();
    $('hw-body').innerHTML = `
      <div class="glass-card">
        <h4 style="margin-top:0;">匯出作業繳交紀錄</h4>
        <div style="display:flex;gap:12px;flex-wrap:wrap;align-items:center;">
          <label>從 <input type="date" id="hw-ex-from" class="input-control" style="width:auto;" value="${t}"></label>
          <label>到 <input type="date" id="hw-ex-to" class="input-control" style="width:auto;" value="${t}"></label>
          <label>作業 <select id="hw-ex-item" class="input-control" style="width:auto;"><option value="">全部作業</option>${S.items.map((i) => `<option value="${i.id}">${esc(i.name)}</option>`).join('')}</select></label>
        </div>
        <div style="margin-top:14px;display:flex;gap:8px;">
          <button type="button" class="btn" id="hw-ex-xlsx">📤 匯出 Excel（含未交名單）</button>
          <button type="button" class="btn btn-secondary" id="hw-ex-csv">📄 匯出 CSV</button>
        </div>
        <p style="font-size:0.85rem;color:var(--text-muted);">欄位：日期、作業項目、座號、姓名、繳交狀態、登記時間、登記方式。沒有登記紀錄的學生會顯示「未交」。CSV 為 UTF-8（含 BOM），Excel 可直接開啟。</p>
      </div>`;
    const go = (fmt) => {
      const from = $('hw-ex-from').value;
      const to = $('hw-ex-to').value || from;
      const item = $('hw-ex-item').value;
      if (!from) return toast('請選擇日期', 'error');
      download(`/export?from=${from}&to=${to}&format=${fmt}${item ? `&item_id=${item}` : ''}`);
    };
    $('hw-ex-xlsx').addEventListener('click', () => go('xlsx'));
    $('hw-ex-csv').addEventListener('click', () => go('csv'));
  }

  async function download(path) {
    try {
      const token = localStorage.getItem('auth_token');
      const res = await fetch(api(path), { headers: token ? { Authorization: `Bearer ${token}` } : {}, credentials: 'same-origin' });
      if (!res.ok) {
        const err = await res.json().catch(() => ({ detail: res.statusText }));
        throw new Error(err.detail || '匯出失敗');
      }
      const cd = res.headers.get('Content-Disposition') || '';
      const m = /filename\*=UTF-8''([^;]+)/.exec(cd);
      const name = m ? decodeURIComponent(m[1]) : 'homework.xlsx';
      const url = URL.createObjectURL(await res.blob());
      const a = document.createElement('a');
      a.href = url;
      a.download = name;
      document.body.appendChild(a);
      a.click();
      setTimeout(() => { a.remove(); URL.revokeObjectURL(url); }, 5000);
      toast(`已匯出：${name}`);
    } catch (err) {
      toast(err.message || '匯出失敗', 'error');
    }
  }

  // ---------- 啟動：只有教師本機才顯示選單；離開分頁時關閉鏡頭 ----------

  async function init() {
    let isLocal = false;
    try {
      const r = await fetch('/api/system/local-access', { credentials: 'same-origin' });
      isLocal = (await r.json()).is_local === true;
    } catch (_) { /* 查不到就視為非本機 */ }
    document.querySelectorAll('[data-tab="hwscan"], option[value="hwscan"]').forEach((el) => {
      if (isLocal) { el.hidden = false; el.style.removeProperty('display'); }
    });
    const pane = $('pane-hwscan');
    if (pane) {
      new MutationObserver(() => { if (!pane.classList.contains('active')) stopCamera(); })
        .observe(pane, { attributes: true, attributeFilter: ['class'] });
    }
  }

  window.HomeworkScan = { load, init, openPopup, openModal };
  window.openHomeworkScanPopup = openPopup;
  window.openHomeworkScanModal = openModal;
  document.addEventListener('DOMContentLoaded', init);
})();
