// MyClass 作業掃描登記 - 小助手專屬獨立彈出視窗控制器
(function () {
  const ST = { OK: '已繳交', LATE: '補繳', LEAVE: '請假', MISSING: '未交' };
  const S = {
    courseId: null,
    coursesList: [],
    date: '',
    items: [],
    students: [],
    plan: [],
    records: new Map(), // `${studentId}|${itemId}` -> record
    selected: new Set(),
    onlyMissing: false,
    undoStack: [],
    camera: null,
    lastText: '',
    lastAt: 0,
    recent: [],
    soundEnabled: localStorage.getItem('teachsys_hwscan_sound') !== 'false',
  };

  const $ = (id) => document.getElementById(id);
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const todayStr = () => {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  };
  const api = (path) => `/api/homework-scan/${S.courseId}${path}`;
  const itemName = (id) => S.items.find((i) => i.id === id)?.name ?? '（已刪除的作業）';
  const activeItems = () => S.items.filter((i) => !i.archived);
  const statusOf = (sid, iid) => S.records.get(`${sid}|${iid}`)?.status ?? ST.MISSING;
  const selectedItems = () => S.plan.filter((id) => S.selected.has(id));

  // 跨分頁與主畫面同步廣播頻道
  let bc = null;
  try {
    bc = new BroadcastChannel('teachsys-hwscan');
    bc.onmessage = (e) => {
      if (e.data?.courseId === S.courseId && e.data?.date === S.date) {
        loadDay(false);
      }
    };
  } catch (_) { /* BroadcastChannel 不支援時安靜忽略 */ }

  function notifySync() {
    try {
      if (bc) bc.postMessage({ type: 'hwscan-updated', courseId: S.courseId, date: S.date });
    } catch (_) {}
  }

  // ---------- 音效引擎 ----------
  let audioCtx = null;
  function beep(kind) {
    if (!S.soundEnabled) return;
    try {
      audioCtx = audioCtx || new (window.AudioContext || window.webkitAudioContext)();
      const o = audioCtx.createOscillator();
      const g = audioCtx.createGain();
      o.frequency.value = kind === 'ok' ? 880 : kind === 'warn' ? 520 : 220;
      g.gain.value = 0.1;
      o.connect(g).connect(audioCtx.destination);
      o.start();
      o.stop(audioCtx.currentTime + (kind === 'bad' ? 0.35 : 0.14));
    } catch (_) {}
  }

  // 自動對焦掃描框（方便小助手連續使用掃描槍）
  function refocusInput() {
    setTimeout(() => {
      const input = $('hw-input');
      if (input && document.activeElement !== input && !document.querySelector('.modal-overlay')) {
        input.focus();
      }
    }, 180);
  }

  // ---------- 初始化 ----------
  async function init() {
    S.date = todayStr();
    $('hw-date').value = S.date;

    // 綁定頂部工具按鈕
    $('hw-date').addEventListener('change', async (e) => {
      if (!e.target.value) return;
      S.date = e.target.value;
      S.undoStack = [];
      await loadDay();
      refocusInput();
    });

    $('hw-today').addEventListener('click', async () => {
      S.date = todayStr();
      $('hw-date').value = S.date;
      S.undoStack = [];
      await loadDay();
      refocusInput();
    });

    $('btn-toggle-sound').addEventListener('click', () => {
      S.soundEnabled = !S.soundEnabled;
      localStorage.setItem('teachsys_hwscan_sound', String(S.soundEnabled));
      updateSoundBtn();
      refocusInput();
    });
    updateSoundBtn();

    $('btn-toggle-fullscreen').addEventListener('click', toggleFullscreen);

    // 取得 URL 指定的 course_id
    const params = new URLSearchParams(window.location.search);
    const paramCourseId = params.get('course_id');

    // 載入班級清單
    try {
      const coursesRes = await API.get('/api/courses');
      S.coursesList = Array.isArray(coursesRes) ? coursesRes : (coursesRes.courses || []);
      const sel = $('hw-course-select');
      sel.innerHTML = '';
      if (!S.coursesList.length) {
        $('hw-loading-state').innerHTML = '<div style="padding:40px;color:var(--accent-negative);">系統內尚無班級資料，請先在主畫面建立班級。</div>';
        return;
      }

      S.coursesList.forEach((c) => {
        const opt = document.createElement('option');
        opt.value = c.id;
        opt.textContent = `${c.teacher_type === 'homeroom' ? '🏫' : '🎨'} ${c.name}`;
        sel.appendChild(opt);
      });

      if (paramCourseId && S.coursesList.some((c) => c.id === Number(paramCourseId))) {
        S.courseId = Number(paramCourseId);
      } else {
        S.courseId = S.coursesList[0].id;
      }
      sel.value = String(S.courseId);

      sel.addEventListener('change', async (e) => {
        S.courseId = Number(e.target.value);
        S.undoStack = [];
        await loadCourseData();
        refocusInput();
      });

      // 監聽掃描輸入
      $('hw-input').addEventListener('keydown', (e) => {
        if (e.key !== 'Enter') return;
        e.preventDefault();
        const v = e.target.value.trim();
        e.target.value = '';
        if (v) handleScan(v);
      });

      // 快速鍵 Ctrl+Z 復原
      window.addEventListener('keydown', (e) => {
        if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') {
          e.preventDefault();
          undo();
        }
      });

      // 鏡頭與復原
      $('hw-cam-btn').addEventListener('click', () => (S.camera ? stopCamera() : startCamera()));
      $('hw-undo').addEventListener('click', undo);

      // 篩選切換
      $('hw-filter-all').addEventListener('click', () => {
        S.onlyMissing = false;
        $('hw-filter-all').classList.add('active');
        $('hw-filter-missing').classList.remove('active');
        renderGrid();
        refocusInput();
      });
      $('hw-filter-missing').addEventListener('click', () => {
        S.onlyMissing = true;
        $('hw-filter-missing').classList.add('active');
        $('hw-filter-all').classList.remove('active');
        renderGrid();
        refocusInput();
      });

      // 匯出名單
      $('hw-export-day').addEventListener('click', () => {
        downloadExport();
        refocusInput();
      });

      // 視窗點擊時自動回焦到掃描輸入框（除非點擊了輸入欄位或彈窗）
      window.addEventListener('click', (e) => {
        if (e.target.tagName !== 'INPUT' && e.target.tagName !== 'SELECT' && e.target.tagName !== 'TEXTAREA' && !e.target.closest('.modal-overlay')) {
          refocusInput();
        }
      });

      await loadCourseData();
    } catch (err) {
      $('hw-loading-state').innerHTML = `<div style="padding:40px;color:var(--accent-negative);">載入失敗：${esc(err.message || '請確認教師本機連線')}</div>`;
    }
  }

  function updateSoundBtn() {
    $('btn-toggle-sound').textContent = S.soundEnabled ? '🔊 音效開啟' : '🔇 音效靜音';
    $('btn-toggle-sound').classList.toggle('active', S.soundEnabled);
  }

  function toggleFullscreen() {
    if (!document.fullscreenElement) {
      document.documentElement.requestFullscreen?.().catch(() => {});
      $('btn-toggle-fullscreen').textContent = '🪟 退出全螢幕';
    } else {
      document.exitFullscreen?.().catch(() => {});
      $('btn-toggle-fullscreen').textContent = '📺 全螢幕';
    }
    refocusInput();
  }

  // ---------- 載入班級資料 ----------
  async function loadCourseData() {
    $('hw-loading-state').style.display = 'block';
    $('hw-main-app').style.display = 'none';
    try {
      S.items = await API.get(api('/items'));
      await loadDay(true);
      $('hw-loading-state').style.display = 'none';
      $('hw-main-app').style.display = 'flex';
      refocusInput();
    } catch (err) {
      $('hw-loading-state').innerHTML = `<div style="padding:40px;color:var(--accent-negative);">${esc(err.message || '無法載入作業資料')}</div>`;
    }
  }

  async function loadDay(isInit = true) {
    try {
      const d = await API.get(api(`/day?date=${S.date}`));
      S.students = d.students || [];
      S.plan = d.plan || [];
      S.records = new Map((d.records || []).map((r) => [`${r.student_id}|${r.item_id}`, r]));
      
      // 維持目前勾選的作業
      S.selected = new Set([...S.selected].filter((id) => S.plan.includes(id)));
      if (!S.selected.size && S.plan.length) S.selected.add(S.plan[0]);

      renderChips();
      renderGrid();
      updateUndoBtn();
      renderRecent();
      if (isInit) refocusInput();
    } catch (err) {
      console.error('loadDay failed:', err);
    }
  }

  // ---------- 渲染作業項目 Chips ----------
  function renderChips() {
    const active = activeItems();
    const chipsEl = $('hw-plan-chips');
    const curChipsEl = $('hw-cur-chips');
    const summaryEl = $('hw-plan-summary');

    if (!active.length) {
      chipsEl.innerHTML = '<span style="color:var(--text-muted);">此班級尚未建立作業項目（請在教師主畫面「作業項目」建立）。</span>';
      summaryEl.textContent = '';
      return;
    }

    summaryEl.textContent = `今日預計收 ${S.plan.length} 項作業`;

    chipsEl.innerHTML = active.map((i) => {
      const on = S.plan.includes(i.id);
      return `<button type="button" class="btn ${on ? '' : 'btn-secondary'} hw-chip-btn ${on ? 'active' : ''}" data-plan="${i.id}">
        <span>${on ? '✔' : '+'}</span>
        <span>${esc(i.name)}</span>
      </button>`;
    }).join('');

    chipsEl.querySelectorAll('[data-plan]').forEach((b) => {
      b.addEventListener('click', () => {
        togglePlan(Number(b.dataset.plan));
        refocusInput();
      });
    });

    // 借書證登記輔助勾選清單
    curChipsEl.innerHTML = S.plan.length
      ? S.plan.map((id) => {
        const on = S.selected.has(id);
        return `<button type="button" class="btn ${on ? '' : 'btn-secondary'} hw-chip-btn ${on ? 'active' : ''}" data-cur="${id}">
          <span>${on ? '✔' : '○'}</span>
          <span>${esc(itemName(id))}</span>
        </button>`;
      }).join('')
      : '<span style="color:var(--text-muted);">請先在上方 ① 點選今日要收哪些作業。</span>';

    curChipsEl.querySelectorAll('[data-cur]').forEach((b) => {
      b.addEventListener('click', () => {
        const id = Number(b.dataset.cur);
        S.selected.has(id) ? S.selected.delete(id) : S.selected.add(id);
        renderChips();
        renderGrid();
        refocusInput();
      });
    });
  }

  async function togglePlan(itemId) {
    const on = S.plan.includes(itemId);
    if (on) {
      const count = [...S.records.values()].filter((r) => r.item_id === itemId).length;
      if (count && !confirm(`「${itemName(itemId)}」今天已經登記了 ${count} 筆。\n從今日計畫中移除後這些紀錄暫時不顯示在進度中，確定要移除嗎？`)) {
        return;
      }
    }
    const next = on ? S.plan.filter((id) => id !== itemId) : [...S.plan, itemId];
    await API.put(api('/plan'), { date: S.date, item_ids: next });
    if (!on) S.selected.add(itemId);
    await loadDay(false);
    notifySync();
    refocusInput();
  }

  // ---------- 渲染學生名冊與進度 ----------
  function renderGrid(flashId = null) {
    const grid = $('hw-grid');
    const progressText = $('hw-progress-text');
    const progressBars = $('hw-progress-bars');
    const items = selectedItems();

    if (!S.students.length) {
      grid.innerHTML = '<div style="grid-column:1/-1;text-align:center;padding:30px;color:var(--text-muted);">此班級尚未匯入學生名冊。</div>';
      progressText.textContent = '';
      progressBars.innerHTML = '';
      return;
    }

    if (!items.length) {
      grid.innerHTML = '<div style="grid-column:1/-1;text-align:center;padding:30px;color:var(--text-muted);">請先在上方點選今天要收的作業項目。</div>';
      progressText.textContent = '尚未選取收件項目';
      progressBars.innerHTML = '';
      return;
    }

    // 計算各作業進度
    let totalDone = 0;
    let totalSlots = items.length * S.students.length;

    progressBars.innerHTML = items.map((id) => {
      const done = S.students.filter((s) => statusOf(s.id, id) !== ST.MISSING).length;
      totalDone += done;
      const pct = Math.round((done / S.students.length) * 100);
      return `<div style="margin-bottom:8px;">
        <div style="display:flex;justify-content:space-between;font-size:0.85rem;font-weight:700;">
          <span>${esc(itemName(id))}</span>
          <span style="color:${pct === 100 ? '#16a34a' : 'var(--text-main)'};">${done} / ${S.students.length} 人 (${pct}%)</span>
        </div>
        <div class="hw-progress-track">
          <div class="hw-progress-fill" style="width:${pct}%;${pct === 100 ? 'background:linear-gradient(90deg,#16a34a,#22c55e);' : ''}"></div>
        </div>
      </div>`;
    }).join('');

    const overallPct = totalSlots > 0 ? Math.round((totalDone / totalSlots) * 100) : 0;
    progressText.textContent = `全班共 ${S.students.length} 人 ｜ 已收齊率：${overallPct}%`;

    // 篩選學生
    const isMissingAny = (s) => items.some((id) => statusOf(s.id, id) === ST.MISSING);
    const shown = S.onlyMissing ? S.students.filter(isMissingAny) : S.students;

    const color = { [ST.OK]: '#16a34a', [ST.LATE]: '#d97706', [ST.LEAVE]: '#6b7280', [ST.MISSING]: '#dc2626' };
    const cardClass = { [ST.OK]: 'hw-card-ok', [ST.LATE]: 'hw-card-late', [ST.LEAVE]: 'hw-card-leave', [ST.MISSING]: 'hw-card-missing' };

    $('hw-filter-missing').textContent = `🚨 只看未交 (${S.students.filter(isMissingAny).length})`;

    grid.innerHTML = shown.length
      ? shown.map((s) => {
        let cardStatusClass = 'hw-card-missing';
        if (items.length === 1) {
          cardStatusClass = cardClass[statusOf(s.id, items[0])] || '';
        } else {
          const allOk = items.every((id) => statusOf(s.id, id) === ST.OK);
          if (allOk) cardStatusClass = 'hw-card-ok';
          else if (!isMissingAny(s)) cardStatusClass = 'hw-card-late';
        }

        const body = items.length === 1
          ? `<div style="font-weight:900;font-size:1.05rem;color:${color[statusOf(s.id, items[0])]};margin-top:4px;">${statusOf(s.id, items[0])}</div>`
          : items.map((id) => `<div style="font-size:0.78rem;font-weight:700;color:${color[statusOf(s.id, id)]};">${esc(itemName(id))} ${statusOf(s.id, id)}</div>`).join('');

        const flashStyle = s.id === flashId ? 'outline:3.5px solid #22c55e;transform:scale(1.04);' : '';

        return `<div class="hw-student-card ${cardStatusClass}" data-sid="${s.id}" style="${flashStyle}">
          <div style="font-size:0.8rem;font-weight:700;color:var(--text-muted);">${s.number} 號</div>
          <div style="font-size:1.1rem;font-weight:900;color:var(--text-main);">${esc(s.name)}</div>
          ${body}
        </div>`;
      }).join('')
      : '<div style="grid-column:1/-1;text-align:center;padding:36px;font-size:1.35rem;font-weight:900;color:#16a34a;">🎉 太棒了，全部學生都繳齊了！</div>';

    grid.querySelectorAll('[data-sid]').forEach((c) => {
      c.addEventListener('click', () => manualMark(Number(c.dataset.sid)));
    });
  }

  // ---------- 反饋提示 ----------
  function feedback(kind, title, detail = '') {
    const fb = $('hw-feedback');
    if (!fb) return;
    fb.className = `hw-feedback-banner hw-state-${kind}`;
    fb.innerHTML = `
      <div style="display:flex;align-items:center;gap:8px;">
        <span>${kind === 'ok' ? '✔' : kind === 'warn' ? '⚠️' : '❌'}</span>
        <span>${esc(title)}</span>
      </div>
      ${detail ? `<div style="font-size:0.95rem;font-weight:600;margin-top:4px;">${esc(detail)}</div>` : ''}
    `;
    beep(kind);
  }

  function pushRecent(text) {
    S.recent.unshift(`${new Date().toTimeString().slice(0, 8)}　${text}`);
    S.recent = S.recent.slice(0, 5);
    renderRecent();
  }

  function renderRecent() {
    const el = $('hw-recent');
    if (!el) return;
    el.innerHTML = S.recent.length
      ? `<div style="font-weight:700;color:var(--text-muted);margin-bottom:4px;">最近登記紀錄：</div>${S.recent.map((t) => `<div style="font-size:0.88rem;color:var(--text-main);">✔ ${esc(t)}</div>`).join('')}`
      : '';
  }

  function updateUndoBtn() {
    const b = $('hw-undo');
    const cnt = $('hw-undo-count');
    if (b) b.disabled = !S.undoStack.length;
    if (cnt) cnt.textContent = String(S.undoStack.length);
  }

  function applyLocal(studentId, itemId, rec) {
    const key = `${studentId}|${itemId}`;
    if (rec) S.records.set(key, { student_id: studentId, item_id: itemId, ...rec });
    else S.records.delete(key);
  }

  // ---------- 處理條碼掃描 ----------
  async function handleScan(raw) {
    let r;
    try {
      r = await API.post(api('/scan'), { date: S.date, code: raw, item_ids: selectedItems() });
    } catch (err) {
      refocusInput();
      return feedback('bad', '登記失敗', err.message || '請再試一次');
    }

    if (r.type === 'empty') {
      refocusInput();
      return;
    }
    if (!r.ok) {
      refocusInput();
      return feedback('bad', r.message, r.detail || '');
    }

    if (r.type === 'item') {
      S.selected.add(r.item.id);
      await loadDay(false);
      S.selected.add(r.item.id);
      renderChips();
      renderGrid();
      notifySync();
      refocusInput();
      return feedback('ok', `已加入現在收：${r.item.name}`, '接著請掃描學生的借書證條碼');
    }

    const st = r.student;
    const label = `${st.number} 號 ${st.name}`;

    if (r.type === 'homework') {
      const wasInPlan = S.plan.includes((r.done[0] ?? r.dup[0]));
      if (!wasInPlan) {
        await loadDay(false);
        renderChips();
      }
    }

    r.changes.forEach((c) => S.undoStack.push({ date: S.date, ...c }));
    const time = new Date().toTimeString().slice(0, 8);
    r.done.forEach((id) => applyLocal(st.id, id, { status: ST.OK, time: `${S.date} ${time}`, method: '掃描' }));
    updateUndoBtn();

    if (r.done.length) {
      pushRecent(`${label}　${r.done.map(itemName).join('、')}`);
      const detail = r.dup.length
        ? `${r.done.map(itemName).join('、')} 已繳交；${r.dup.map(itemName).join('、')} 之前已登記過`
        : `${r.done.map(itemName).join('、')} 已成功繳交 ✔`;
      feedback('ok', `${label}`, detail);
    } else {
      feedback('warn', `${st.name} 剛才已經登記過了`, r.dup.map(itemName).join('、'));
    }

    renderGrid(st.id);
    notifySync();
    refocusInput();
  }

  // ---------- 手動登記狀態彈窗 ----------
  function manualMark(studentId) {
    const items = selectedItems();
    const st = S.students.find((s) => s.id === studentId);
    if (!st || !items.length) return;

    $('hw-manual-popup')?.remove();
    const wrap = document.createElement('div');
    wrap.id = 'hw-manual-popup';
    wrap.className = 'modal-overlay open';
    wrap.style.cssText = 'display:flex;align-items:center;justify-content:center;z-index:100020;background:rgba(0,0,0,0.5);position:fixed;top:0;left:0;right:0;bottom:0;';

    const rows = items.map((id) => {
      const cur = S.records.get(`${studentId}|${id}`);
      const btn = (v, label, cls = 'btn-secondary') =>
        `<button type="button" class="btn ${cls}" data-item="${id}" data-val="${v}" style="padding:10px 14px;font-size:0.95rem;font-weight:700;">${label}</button>`;
      return `<div style="margin-bottom:16px;background:var(--input-bg);padding:14px;border-radius:12px;border:1px solid var(--card-border);">
        <div style="font-weight:900;font-size:1.05rem;margin-bottom:8px;color:var(--text-main);">
          ${esc(itemName(id))}
          <span style="font-weight:600;font-size:0.85rem;color:var(--text-muted);margin-left:8px;">
            目前狀態：${cur ? `${esc(cur.status)}（${esc((cur.time || '').slice(11))}，${esc(cur.method)}）` : ST.MISSING}
          </span>
        </div>
        <div style="display:flex;gap:8px;flex-wrap:wrap;">
          ${btn(ST.OK, '✔ 已繳交', '')}
          ${btn(ST.LATE, '⏰ 補繳')}
          ${btn(ST.LEAVE, '🏠 請假')}
          ${btn('clear', '✖ 改回未交')}
        </div>
      </div>`;
    }).join('');

    wrap.innerHTML = `<div class="modal-content glass-card" style="max-width:540px;width:92%;padding:22px;border-radius:16px;">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:14px;">
        <h3 style="margin:0;font-size:1.25rem;">${st.number} 號 ${esc(st.name)} ｜ 手動登記狀態</h3>
        <button type="button" class="btn btn-secondary" id="hw-manual-close-x" style="padding:4px 10px;font-size:1.1rem;line-height:1;">✕</button>
      </div>
      ${rows}
      <div style="text-align:right;margin-top:10px;">
        <button type="button" class="btn btn-secondary" id="hw-manual-close" style="padding:8px 18px;">關閉</button>
      </div>
    </div>`;

    document.body.appendChild(wrap);

    const close = () => {
      wrap.remove();
      refocusInput();
    };

    wrap.addEventListener('click', (e) => { if (e.target === wrap) close(); });
    wrap.querySelector('#hw-manual-close').addEventListener('click', close);
    wrap.querySelector('#hw-manual-close-x').addEventListener('click', close);

    wrap.querySelectorAll('[data-val]').forEach((b) => {
      b.addEventListener('click', async () => {
        const itemId = Number(b.dataset.item);
        const val = b.dataset.val;
        const cur = S.records.get(`${studentId}|${itemId}`);

        try {
          if (val === 'clear') {
            if (cur) await API.put(api('/mark'), { date: S.date, student_id: studentId, item_id: itemId, status: null });
            applyLocal(studentId, itemId, null);
            if (cur) S.undoStack.push({ date: S.date, student_id: studentId, item_id: itemId, previous: { status: cur.status, time: cur.time, method: cur.method } });
            feedback('warn', `${st.name} 改回未交`, itemName(itemId));
          } else if (!cur || cur.status !== val) {
            await API.put(api('/mark'), { date: S.date, student_id: studentId, item_id: itemId, status: val });
            S.undoStack.push({ date: S.date, student_id: studentId, item_id: itemId, previous: cur ? { status: cur.status, time: cur.time, method: cur.method } : null });
            applyLocal(studentId, itemId, { status: val, time: `${S.date} ${new Date().toTimeString().slice(0, 8)}`, method: '手動' });
            feedback('ok', `${st.number} 號 ${st.name}`, `${itemName(itemId)}：${val}`);
          }
        } catch (err) {
          alert(err.message || '登記失敗');
        }

        updateUndoBtn();
        close();
        renderGrid(studentId);
        notifySync();
      });
    });
  }

  // ---------- 復原 ----------
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
      feedback('warn', `已復原：${st?.name ?? ''}`, `${itemName(last.item_id)} 回復為「${p?.status ?? ST.MISSING}」`);
    } catch (err) {
      S.undoStack.push(last);
      alert(err.message || '復原失敗');
    }
    updateUndoBtn();
    renderGrid();
    notifySync();
    refocusInput();
  }

  // ---------- 鏡頭掃描 ----------
  async function startCamera() {
    const box = $('hw-cam');
    box.style.display = 'block';
    box.innerHTML = '<div id="hw-cam-view" style="width:100%;"></div>';
    try {
      const F = window.Html5QrcodeSupportedFormats;
      const scanner = new window.Html5Qrcode('hw-cam-view', {
        formatsToSupport: [F.QR_CODE, F.CODE_128, F.CODE_39, F.EAN_13, F.CODABAR, F.ITF],
        verbose: false,
      });
      await scanner.start(
        { facingMode: 'environment' },
        { fps: 10, qrbox: { width: 280, height: 180 } },
        (text) => {
          const now = Date.now();
          if (text === S.lastText && now - S.lastAt < 3000) return;
          S.lastText = text;
          S.lastAt = now;
          handleScan(text);
        },
        () => {}
      );
      S.camera = scanner;
      $('hw-cam-btn').textContent = '⏹ 關閉相機';
    } catch (e) {
      box.style.display = 'none';
      alert('無法開啟相機鏡頭：請確認權限或設備');
    }
  }

  function stopCamera() {
    if (S.camera) {
      S.camera.stop().catch(() => {}).then(() => {
        try { S.camera.clear(); } catch (_) {}
        S.camera = null;
        $('hw-cam').style.display = 'none';
        $('hw-cam-btn').textContent = '📷 開啟相機鏡頭';
        refocusInput();
      });
    }
  }

  // ---------- 匯出報表 ----------
  async function downloadExport() {
    try {
      const res = await fetch(`/api/homework-scan/${S.courseId}/export?from=${S.date}&to=${S.date}&format=xlsx`, {
        headers: API.getHeaders(),
        credentials: 'same-origin',
      });
      if (!res.ok) throw new Error('匯出失敗');
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `作業登記名單_${S.date}.xlsx`;
      document.body.appendChild(a);
      a.click();
      setTimeout(() => { a.remove(); URL.revokeObjectURL(url); }, 5000);
    } catch (e) {
      alert(e.message || '匯出失敗');
    }
  }

  document.addEventListener('DOMContentLoaded', init);
  window.addEventListener('beforeunload', stopCamera);
})();
