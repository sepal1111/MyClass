/**
 * Custom Bilingual DatePicker Component (全系統中英雙語自訂日期選擇器)
 * Replaces native <input type="date"> to provide 100% controllable bilingual formatting
 * Supports English (yyyy-mm-dd, Jan-Dec, Su-Sa) and Traditional Chinese (年/月/日, 1-12月, 日-六)
 */
(function (window) {
  'use strict';

  // Inject required CSS directly to guarantee perfect rendering regardless of stylesheet caching
  const CSS_STYLES = `
    .custom-datepicker-wrapper {
      position: relative !important;
      display: inline-flex !important;
      align-items: center !important;
      width: auto !important;
      vertical-align: middle !important;
    }

    .custom-datepicker-input {
      padding-right: 32px !important;
      cursor: pointer !important;
      letter-spacing: 0.5px !important;
    }

    .custom-datepicker-icon {
      position: absolute !important;
      right: 9px !important;
      top: 50% !important;
      transform: translateY(-50%) !important;
      cursor: pointer !important;
      font-size: 0.95rem !important;
      opacity: 0.75 !important;
      transition: opacity 0.2s, transform 0.2s !important;
      user-select: none !important;
      pointer-events: auto !important;
      z-index: 2 !important;
    }

    .custom-datepicker-icon:hover {
      opacity: 1 !important;
      transform: translateY(-50%) scale(1.15) !important;
    }

    .custom-datepicker-popup {
      position: fixed !important;
      z-index: 1000000 !important;
      background: #1e293b !important;
      background: var(--card-bg, #1e293b) !important;
      border: 1.5px solid rgba(255, 255, 255, 0.18) !important;
      border-radius: 14px !important;
      box-shadow: 0 16px 40px rgba(0, 0, 0, 0.55), 0 0 0 1px rgba(255,255,255,0.1) !important;
      backdrop-filter: blur(20px) !important;
      -webkit-backdrop-filter: blur(20px) !important;
      padding: 14px !important;
      width: 295px !important;
      box-sizing: border-box !important;
      color: #ffffff !important;
      color: var(--text-main, #ffffff) !important;
      font-family: -apple-system, BlinkMacSystemFont, "Noto Sans TC", "Plus Jakarta Sans", sans-serif !important;
      animation: cdpFadeIn 0.18s cubic-bezier(0.16, 1, 0.3, 1) !important;
      user-select: none !important;
    }

    @keyframes cdpFadeIn {
      from { opacity: 0; transform: translateY(-6px); }
      to { opacity: 1; transform: translateY(0); }
    }

    .cdp-header {
      display: flex !important;
      align-items: center !important;
      justify-content: space-between !important;
      margin-bottom: 12px !important;
      padding-bottom: 8px !important;
      border-bottom: 1px solid rgba(255, 255, 255, 0.12) !important;
    }

    .cdp-title {
      font-weight: 800 !important;
      font-size: 1.02rem !important;
      color: #ffffff !important;
      color: var(--text-main, #ffffff) !important;
      letter-spacing: 0.5px !important;
    }

    .cdp-nav-btn {
      background: rgba(255, 255, 255, 0.08) !important;
      border: 1px solid rgba(255, 255, 255, 0.15) !important;
      color: #ffffff !important;
      width: 30px !important;
      height: 30px !important;
      border-radius: 8px !important;
      display: flex !important;
      align-items: center !important;
      justify-content: center !important;
      font-size: 1.2rem !important;
      font-weight: bold !important;
      cursor: pointer !important;
      transition: all 0.15s ease !important;
      line-height: 1 !important;
      padding: 0 !important;
    }

    .cdp-nav-btn:hover {
      background: #7b98e0 !important;
      color: #ffffff !important;
      border-color: #60a5fa !important;
      transform: scale(1.05) !important;
    }

    .cdp-weekdays {
      display: grid !important;
      grid-template-columns: repeat(7, 1fr) !important;
      gap: 3px !important;
      text-align: center !important;
      margin-bottom: 6px !important;
      font-weight: 800 !important;
      font-size: 0.82rem !important;
      color: #94a3b8 !important;
      color: var(--text-muted, #94a3b8) !important;
    }

    .cdp-weekday-cell {
      padding: 4px 0 !important;
    }

    .cdp-weekday-cell.cdp-weekend {
      color: #f43f5e !important;
    }

    .cdp-days-grid {
      display: grid !important;
      grid-template-columns: repeat(7, 1fr) !important;
      gap: 3px !important;
    }

    .cdp-day-cell {
      height: 34px !important;
      display: flex !important;
      align-items: center !important;
      justify-content: center !important;
      font-size: 0.9rem !important;
      font-weight: 600 !important;
      border-radius: 7px !important;
      cursor: pointer !important;
      color: #ffffff !important;
      color: var(--text-main, #ffffff) !important;
      transition: all 0.15s ease !important;
      border: 1px solid transparent !important;
      background: transparent !important;
    }

    .cdp-day-cell:hover {
      background: rgba(123, 152, 224, 0.28) !important;
      border-color: rgba(96, 165, 250, 0.6) !important;
      transform: scale(1.08) !important;
    }

    .cdp-day-cell.cdp-other-month {
      color: rgba(148, 163, 184, 0.35) !important;
    }

    .cdp-day-cell.cdp-today {
      border-color: #7b98e0 !important;
      font-weight: 800 !important;
      color: #60a5fa !important;
    }

    .cdp-day-cell.cdp-selected {
      background: linear-gradient(135deg, #7b98e0, #4a67ba) !important;
      color: #ffffff !important;
      font-weight: 800 !important;
      box-shadow: 0 2px 10px rgba(123, 152, 224, 0.5) !important;
    }

    .cdp-footer {
      display: flex !important;
      align-items: center !important;
      justify-content: space-between !important;
      margin-top: 10px !important;
      padding-top: 8px !important;
      border-top: 1px solid rgba(255, 255, 255, 0.12) !important;
    }

    .cdp-action-btn {
      background: transparent !important;
      border: none !important;
      font-size: 0.85rem !important;
      font-weight: 700 !important;
      color: #94a3b8 !important;
      color: var(--text-muted, #94a3b8) !important;
      cursor: pointer !important;
      padding: 4px 8px !important;
      border-radius: 6px !important;
      transition: all 0.15s ease !important;
    }

    .cdp-action-btn:hover {
      background: rgba(255, 255, 255, 0.1) !important;
      color: #ffffff !important;
      color: var(--text-main, #ffffff) !important;
    }

    .cdp-today-btn {
      color: #60a5fa !important;
    }

    .cdp-today-btn:hover {
      background: rgba(123, 152, 224, 0.2) !important;
      color: #93c5fd !important;
    }

    .cdp-time-row {
      display: flex !important;
      align-items: center !important;
      gap: 8px !important;
      margin-top: 10px !important;
      padding-top: 10px !important;
      border-top: 1px solid rgba(255, 255, 255, 0.12) !important;
    }

    .cdp-time-label {
      font-size: 0.85rem !important;
      font-weight: 700 !important;
      color: #94a3b8 !important;
      color: var(--text-muted, #94a3b8) !important;
      margin-right: 4px !important;
    }

    .cdp-time-input {
      width: 52px !important;
      text-align: center !important;
      background: rgba(255, 255, 255, 0.08) !important;
      border: 1px solid rgba(255, 255, 255, 0.18) !important;
      color: #ffffff !important;
      color: var(--text-main, #ffffff) !important;
      border-radius: 8px !important;
      padding: 6px 4px !important;
      font-size: 0.95rem !important;
      font-weight: 700 !important;
      font-family: inherit !important;
      outline: none !important;
    }

    .cdp-time-input:focus {
      border-color: #7b98e0 !important;
      box-shadow: 0 0 0 3px rgba(123, 152, 224, 0.25) !important;
    }

    .cdp-time-input::-webkit-outer-spin-button,
    .cdp-time-input::-webkit-inner-spin-button {
      margin: 0 !important;
    }

    .cdp-time-sep {
      font-weight: 800 !important;
      color: #ffffff !important;
      color: var(--text-main, #ffffff) !important;
    }

    .cdp-apply-btn {
      background: linear-gradient(135deg, #7b98e0, #4a67ba) !important;
      color: #ffffff !important;
      border: none !important;
      font-size: 0.85rem !important;
      font-weight: 700 !important;
      cursor: pointer !important;
      padding: 6px 14px !important;
      border-radius: 8px !important;
      transition: all 0.15s ease !important;
    }

    .cdp-apply-btn:hover {
      filter: brightness(1.1) !important;
      transform: translateY(-1px) !important;
    }
  `;

  function injectStyles() {
    if (!document.getElementById('custom-datepicker-styles')) {
      const style = document.createElement('style');
      style.id = 'custom-datepicker-styles';
      style.innerHTML = CSS_STYLES;
      document.head.appendChild(style);
    }
  }

  injectStyles();

  const DATEPICKER_I18N = {
    'zh-TW': {
      placeholder: '年 / 月 / 日',
      months: ['1月', '2月', '3月', '4月', '5月', '6月', '7月', '8月', '9月', '10月', '11月', '12月'],
      weekdays: ['日', '一', '二', '三', '四', '五', '六'],
      today: '今天',
      clear: '清除',
      yearSuffix: '年'
    },
    'en': {
      placeholder: 'YYYY-MM-DD',
      months: ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'],
      monthsShort: ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'],
      weekdays: ['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa'],
      today: 'Today',
      clear: 'Clear',
      yearSuffix: ''
    }
  };

  let activePopup = null;
  let activeInput = null;

  function getLang() {
    if (window.I18n && typeof window.I18n.getLanguage === 'function') {
      return window.I18n.getLanguage() === 'en' ? 'en' : 'zh-TW';
    }
    return document.documentElement.lang.startsWith('en') ? 'en' : 'zh-TW';
  }

  function parseDate(str) {
    if (!str || typeof str !== 'string') return null;
    const parts = str.trim().split('-');
    if (parts.length !== 3) return null;
    const y = parseInt(parts[0], 10);
    const m = parseInt(parts[1], 10) - 1;
    const d = parseInt(parts[2], 10);
    if (isNaN(y) || isNaN(m) || isNaN(d)) return null;
    const date = new Date(y, m, d);
    if (date.getFullYear() === y && date.getMonth() === m && date.getDate() === d) {
      return date;
    }
    return null;
  }

  function formatDate(year, month, day) {
    const mm = String(month + 1).padStart(2, '0');
    const dd = String(day).padStart(2, '0');
    return `${year}-${mm}-${dd}`;
  }

  // 日期時間值一律用 "YYYY-MM-DD HH:MM"（空格分隔，不含 "T"）——與後端 publish_at 欄位存的格式
  // 完全一致，前端不需要再額外轉換；也順便相容原生 datetime-local 可能給的 "YYYY-MM-DDTHH:MM"。
  function parseDateTime(str) {
    if (!str || typeof str !== 'string') return null;
    const m = str.trim().replace('T', ' ').match(/^(\d{4})-(\d{2})-(\d{2})\s+(\d{2}):(\d{2})$/);
    if (!m) return null;
    const year = parseInt(m[1], 10);
    const month = parseInt(m[2], 10) - 1;
    const day = parseInt(m[3], 10);
    const hour = parseInt(m[4], 10);
    const minute = parseInt(m[5], 10);
    const date = new Date(year, month, day);
    if (date.getFullYear() !== year || date.getMonth() !== month || date.getDate() !== day) return null;
    if (hour > 23 || minute > 59) return null;
    return { year, month, day, hour, minute };
  }

  function formatDateTime(year, month, day, hour, minute) {
    return `${formatDate(year, month, day)} ${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;
  }

  function closePopup() {
    if (activePopup) {
      activePopup.remove();
      activePopup = null;
      activeInput = null;
    }
  }

  /** 月曆天數格子（上個月補位／本月／下個月補位），供日期選擇器與日期時間選擇器共用。 */
  function buildDaysGrid(viewYear, viewMonth, selectedDateStr, onPick) {
    const today = new Date();
    const todayStr = formatDate(today.getFullYear(), today.getMonth(), today.getDate());

    const daysGrid = document.createElement('div');
    daysGrid.className = 'cdp-days-grid';

    const firstDayIndex = new Date(viewYear, viewMonth, 1).getDay();
    const daysInMonth = new Date(viewYear, viewMonth + 1, 0).getDate();
    const daysInPrevMonth = new Date(viewYear, viewMonth, 0).getDate();

    // Previous month padding
    for (let i = firstDayIndex - 1; i >= 0; i--) {
      const d = daysInPrevMonth - i;
      const cell = document.createElement('div');
      cell.className = 'cdp-day-cell cdp-other-month';
      cell.textContent = d;
      const prevM = viewMonth === 0 ? 11 : viewMonth - 1;
      const prevY = viewMonth === 0 ? viewYear - 1 : viewYear;
      const dStr = formatDate(prevY, prevM, d);
      cell.addEventListener('click', (e) => {
        e.stopPropagation();
        onPick(dStr);
      });
      daysGrid.appendChild(cell);
    }

    // Current month days
    for (let d = 1; d <= daysInMonth; d++) {
      const dStr = formatDate(viewYear, viewMonth, d);
      const cell = document.createElement('div');
      cell.className = 'cdp-day-cell';
      cell.textContent = d;

      if (dStr === todayStr) {
        cell.classList.add('cdp-today');
      }
      if (dStr === selectedDateStr) {
        cell.classList.add('cdp-selected');
      }

      const dayOfWeek = (firstDayIndex + d - 1) % 7;
      if (dayOfWeek === 0 || dayOfWeek === 6) {
        cell.classList.add('cdp-weekend');
      }

      cell.addEventListener('click', (e) => {
        e.stopPropagation();
        onPick(dStr);
      });
      daysGrid.appendChild(cell);
    }

    // Next month padding to complete 35 or 42 grid cells
    const totalCells = firstDayIndex + daysInMonth;
    const nextPadding = totalCells <= 35 ? (35 - totalCells) : (42 - totalCells);
    for (let d = 1; d <= nextPadding; d++) {
      const cell = document.createElement('div');
      cell.className = 'cdp-day-cell cdp-other-month';
      cell.textContent = d;
      const nextM = viewMonth === 11 ? 0 : viewMonth + 1;
      const nextY = viewMonth === 11 ? viewYear + 1 : viewYear;
      const dStr = formatDate(nextY, nextM, d);
      cell.addEventListener('click', (e) => {
        e.stopPropagation();
        onPick(dStr);
      });
      daysGrid.appendChild(cell);
    }

    return daysGrid;
  }

  function renderCalendar(viewYear, viewMonth, selectedDateStr, onSelect) {
    const lang = getLang();
    const dict = DATEPICKER_I18N[lang] || DATEPICKER_I18N['zh-TW'];
    const today = new Date();
    const todayStr = formatDate(today.getFullYear(), today.getMonth(), today.getDate());

    const container = document.createElement('div');
    container.className = 'custom-datepicker-popup';

    // 1. Header with navigation
    const header = document.createElement('div');
    header.className = 'cdp-header';

    const prevBtn = document.createElement('button');
    prevBtn.type = 'button';
    prevBtn.className = 'cdp-nav-btn';
    prevBtn.innerHTML = '‹';
    prevBtn.title = lang === 'en' ? 'Previous Month' : '上個月';

    const titleArea = document.createElement('div');
    titleArea.className = 'cdp-title';
    if (lang === 'en') {
      titleArea.textContent = `${dict.months[viewMonth]} ${viewYear}`;
    } else {
      titleArea.textContent = `${viewYear}${dict.yearSuffix} ${dict.months[viewMonth]}`;
    }

    const nextBtn = document.createElement('button');
    nextBtn.type = 'button';
    nextBtn.className = 'cdp-nav-btn';
    nextBtn.innerHTML = '›';
    nextBtn.title = lang === 'en' ? 'Next Month' : '下個月';

    header.appendChild(prevBtn);
    header.appendChild(titleArea);
    header.appendChild(nextBtn);
    container.appendChild(header);

    // 2. Weekday Header Row
    const weekdaysRow = document.createElement('div');
    weekdaysRow.className = 'cdp-weekdays';
    dict.weekdays.forEach((wd, i) => {
      const cell = document.createElement('div');
      cell.className = 'cdp-weekday-cell';
      if (i === 0 || i === 6) cell.classList.add('cdp-weekend');
      cell.textContent = wd;
      weekdaysRow.appendChild(cell);
    });
    container.appendChild(weekdaysRow);

    // 3. Days Grid
    const daysGrid = buildDaysGrid(viewYear, viewMonth, selectedDateStr, onSelect);
    container.appendChild(daysGrid);

    // 4. Footer with Today and Clear shortcuts
    const footer = document.createElement('div');
    footer.className = 'cdp-footer';

    const clearBtn = document.createElement('button');
    clearBtn.type = 'button';
    clearBtn.className = 'cdp-action-btn';
    clearBtn.textContent = dict.clear;
    clearBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      onSelect('');
    });

    const todayBtn = document.createElement('button');
    todayBtn.type = 'button';
    todayBtn.className = 'cdp-action-btn cdp-today-btn';
    todayBtn.textContent = dict.today;
    todayBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      onSelect(todayStr);
    });

    footer.appendChild(clearBtn);
    footer.appendChild(todayBtn);
    container.appendChild(footer);

    // Navigation events
    prevBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      let newM = viewMonth - 1;
      let newY = viewYear;
      if (newM < 0) {
        newM = 11;
        newY--;
      }
      updatePopupCalendar(newY, newM, selectedDateStr, onSelect);
    });

    nextBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      let newM = viewMonth + 1;
      let newY = viewYear;
      if (newM > 11) {
        newM = 0;
        newY++;
      }
      updatePopupCalendar(newY, newM, selectedDateStr, onSelect);
    });

    return container;
  }

  function updatePopupCalendar(year, month, selectedDateStr, onSelect) {
    if (!activePopup) return;
    const parent = activePopup.parentElement;
    const newPopup = renderCalendar(year, month, selectedDateStr, onSelect);
    newPopup.style.position = 'fixed';
    newPopup.style.top = activePopup.style.top;
    newPopup.style.left = activePopup.style.left;
    newPopup.style.zIndex = activePopup.style.zIndex;
    parent.replaceChild(newPopup, activePopup);
    activePopup = newPopup;
  }

  let lastOpenTime = 0;

  function openDatePickerForInput(input) {
    const now = Date.now();
    if (activeInput === input && activePopup) {
      if (now - lastOpenTime < 250) return;
      closePopup();
      return;
    }

    closePopup();
    activeInput = input;
    lastOpenTime = now;

    const currentVal = input.value || '';
    const parsed = parseDate(currentVal);
    const initialDate = parsed || new Date();
    const viewYear = initialDate.getFullYear();
    const viewMonth = initialDate.getMonth();

    const popup = renderCalendar(viewYear, viewMonth, currentVal, (chosenDateStr) => {
      input.value = chosenDateStr;
      input.dispatchEvent(new Event('input', { bubbles: true }));
      input.dispatchEvent(new Event('change', { bubbles: true }));
      closePopup();
    });

    document.body.appendChild(popup);
    activePopup = popup;

    // Smart Positioning with Fixed Coordinates (Immune to scroll and container overflow)
    const rect = input.getBoundingClientRect();
    const popupHeight = 320;
    const popupWidth = 295;

    let top = rect.bottom + 6;
    let left = rect.left;

    // If overflowing screen bottom, position above input
    if (rect.bottom + popupHeight > window.innerHeight && rect.top - popupHeight > 0) {
      top = rect.top - popupHeight - 6;
    }

    // If overflowing screen right, shift left
    if (left + popupWidth > window.innerWidth - 10) {
      left = window.innerWidth - popupWidth - 10;
    }
    if (left < 10) left = 10;

    popup.style.top = `${top}px`;
    popup.style.left = `${left}px`;
  }

  /** 日期時間選擇器：月曆＋時/分輸入＋清除／此刻／套用。點日期只更新選取狀態並重繪（不關閉），
   *  因為使用者通常還要接著調整時間；時/分輸入本身不觸發整個彈窗重繪（避免打字打到一半被中斷），
   *  真正送出（更新原本的 input 值＋觸發 change 事件＋關閉）發生在「套用」／「此刻」／「清除」。 */
  function renderDateTimePicker(state, callbacks) {
    const lang = getLang();
    const dict = DATEPICKER_I18N[lang] || DATEPICKER_I18N['zh-TW'];

    const container = document.createElement('div');
    container.className = 'custom-datepicker-popup';

    const header = document.createElement('div');
    header.className = 'cdp-header';
    const prevBtn = document.createElement('button');
    prevBtn.type = 'button';
    prevBtn.className = 'cdp-nav-btn';
    prevBtn.innerHTML = '‹';
    prevBtn.title = lang === 'en' ? 'Previous Month' : '上個月';
    const titleArea = document.createElement('div');
    titleArea.className = 'cdp-title';
    titleArea.textContent =
      lang === 'en' ? `${dict.months[state.month]} ${state.year}` : `${state.year}${dict.yearSuffix} ${dict.months[state.month]}`;
    const nextBtn = document.createElement('button');
    nextBtn.type = 'button';
    nextBtn.className = 'cdp-nav-btn';
    nextBtn.innerHTML = '›';
    nextBtn.title = lang === 'en' ? 'Next Month' : '下個月';
    header.appendChild(prevBtn);
    header.appendChild(titleArea);
    header.appendChild(nextBtn);
    container.appendChild(header);

    const weekdaysRow = document.createElement('div');
    weekdaysRow.className = 'cdp-weekdays';
    dict.weekdays.forEach((wd, i) => {
      const cell = document.createElement('div');
      cell.className = 'cdp-weekday-cell' + (i === 0 || i === 6 ? ' cdp-weekend' : '');
      cell.textContent = wd;
      weekdaysRow.appendChild(cell);
    });
    container.appendChild(weekdaysRow);

    const selectedDateStr = formatDate(state.year, state.month, state.day);
    const daysGrid = buildDaysGrid(state.year, state.month, selectedDateStr, (dStr) => {
      const parsed = parseDate(dStr);
      callbacks.onPick(parsed.getFullYear(), parsed.getMonth(), parsed.getDate());
    });
    container.appendChild(daysGrid);

    // 時間列：時／分兩個數字輸入
    const timeRow = document.createElement('div');
    timeRow.className = 'cdp-time-row';

    const timeLabel = document.createElement('span');
    timeLabel.className = 'cdp-time-label';
    timeLabel.textContent = lang === 'en' ? 'Time' : '時間';

    function clamp(v, min, max) {
      const n = parseInt(v, 10);
      return isNaN(n) ? min : Math.max(min, Math.min(max, n));
    }

    const hourInput = document.createElement('input');
    hourInput.type = 'number';
    hourInput.min = '0';
    hourInput.max = '23';
    hourInput.className = 'cdp-time-input';
    hourInput.value = String(state.hour).padStart(2, '0');
    hourInput.addEventListener('click', (e) => e.stopPropagation());
    hourInput.addEventListener('input', () => callbacks.onTimeChange(clamp(hourInput.value, 0, 23), undefined));
    hourInput.addEventListener('blur', () => { hourInput.value = String(clamp(hourInput.value, 0, 23)).padStart(2, '0'); });

    const sep = document.createElement('span');
    sep.className = 'cdp-time-sep';
    sep.textContent = ':';

    const minuteInput = document.createElement('input');
    minuteInput.type = 'number';
    minuteInput.min = '0';
    minuteInput.max = '59';
    minuteInput.className = 'cdp-time-input';
    minuteInput.value = String(state.minute).padStart(2, '0');
    minuteInput.addEventListener('click', (e) => e.stopPropagation());
    minuteInput.addEventListener('input', () => callbacks.onTimeChange(undefined, clamp(minuteInput.value, 0, 59)));
    minuteInput.addEventListener('blur', () => { minuteInput.value = String(clamp(minuteInput.value, 0, 59)).padStart(2, '0'); });

    timeRow.appendChild(timeLabel);
    timeRow.appendChild(hourInput);
    timeRow.appendChild(sep);
    timeRow.appendChild(minuteInput);
    container.appendChild(timeRow);

    // 4. Footer：清除／此刻／套用
    const footer = document.createElement('div');
    footer.className = 'cdp-footer';

    const clearBtn = document.createElement('button');
    clearBtn.type = 'button';
    clearBtn.className = 'cdp-action-btn';
    clearBtn.textContent = dict.clear;
    clearBtn.addEventListener('click', (e) => { e.stopPropagation(); callbacks.onClear(); });

    const nowBtn = document.createElement('button');
    nowBtn.type = 'button';
    nowBtn.className = 'cdp-action-btn cdp-today-btn';
    nowBtn.textContent = lang === 'en' ? 'Now' : '此刻';
    nowBtn.addEventListener('click', (e) => { e.stopPropagation(); callbacks.onNow(); });

    const applyBtn = document.createElement('button');
    applyBtn.type = 'button';
    applyBtn.className = 'cdp-apply-btn';
    applyBtn.textContent = lang === 'en' ? 'Apply' : '套用';
    applyBtn.addEventListener('click', (e) => { e.stopPropagation(); callbacks.onApply(); });

    footer.appendChild(clearBtn);
    footer.appendChild(nowBtn);
    footer.appendChild(applyBtn);
    container.appendChild(footer);

    prevBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      let newM = state.month - 1;
      let newY = state.year;
      if (newM < 0) { newM = 11; newY--; }
      callbacks.onNavigate(newY, newM);
    });
    nextBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      let newM = state.month + 1;
      let newY = state.year;
      if (newM > 11) { newM = 0; newY++; }
      callbacks.onNavigate(newY, newM);
    });

    return container;
  }

  function openDateTimePickerForInput(input) {
    const nowTs = Date.now();
    if (activeInput === input && activePopup) {
      if (nowTs - lastOpenTime < 250) return;
      closePopup();
      return;
    }
    closePopup();
    activeInput = input;
    lastOpenTime = nowTs;

    const now = new Date();
    const parsed = parseDateTime(input.value || '');
    let state = parsed || { year: now.getFullYear(), month: now.getMonth(), day: now.getDate(), hour: now.getHours(), minute: now.getMinutes() };

    function commit(finalState) {
      input.value = formatDateTime(finalState.year, finalState.month, finalState.day, finalState.hour, finalState.minute);
      input.dispatchEvent(new Event('input', { bubbles: true }));
      input.dispatchEvent(new Event('change', { bubbles: true }));
      closePopup();
    }

    function buildPopup() {
      return renderDateTimePicker(state, {
        onPick(y, m, d) {
          state = { ...state, year: y, month: m, day: d };
          rerender();
        },
        onNavigate(y, m) {
          // 換月保留原本選到的日期數字，新月份天數不足則夾到當月最後一天（例如 1/31 切到 2 月）。
          const maxDay = new Date(y, m + 1, 0).getDate();
          state = { ...state, year: y, month: m, day: Math.min(state.day, maxDay) };
          rerender();
        },
        onTimeChange(h, mnt) {
          if (h !== undefined) state.hour = h;
          if (mnt !== undefined) state.minute = mnt;
        },
        onApply() { commit(state); },
        onNow() {
          const n = new Date();
          state = { year: n.getFullYear(), month: n.getMonth(), day: n.getDate(), hour: n.getHours(), minute: n.getMinutes() };
          commit(state);
        },
        onClear() {
          input.value = '';
          input.dispatchEvent(new Event('input', { bubbles: true }));
          input.dispatchEvent(new Event('change', { bubbles: true }));
          closePopup();
        },
      });
    }

    function rerender() {
      if (!activePopup) return;
      const parent = activePopup.parentElement;
      const newPopup = buildPopup();
      newPopup.style.position = 'fixed';
      newPopup.style.top = activePopup.style.top;
      newPopup.style.left = activePopup.style.left;
      newPopup.style.zIndex = activePopup.style.zIndex;
      parent.replaceChild(newPopup, activePopup);
      activePopup = newPopup;
    }

    const popup = buildPopup();
    document.body.appendChild(popup);
    activePopup = popup;

    const rect = input.getBoundingClientRect();
    const popupHeight = 380;
    const popupWidth = 295;
    let top = rect.bottom + 6;
    let left = rect.left;
    if (rect.bottom + popupHeight > window.innerHeight && rect.top - popupHeight > 0) {
      top = rect.top - popupHeight - 6;
    }
    if (left + popupWidth > window.innerWidth - 10) {
      left = window.innerWidth - popupWidth - 10;
    }
    if (left < 10) left = 10;
    popup.style.top = `${top}px`;
    popup.style.left = `${left}px`;
  }

  // Global document click to close when clicking outside
  document.addEventListener('click', (e) => {
    if (activePopup) {
      if (!activePopup.contains(e.target) && (!activeInput || !activeInput.contains(e.target)) && !e.target.closest('.custom-datepicker-icon')) {
        closePopup();
      }
    }
  });

  window.addEventListener('resize', closePopup);
  window.addEventListener('scroll', closePopup, true);

  /**
   * Bind and initialize custom DatePicker on an input element
   */
  function attachDatePicker(input) {
    if (!input) return;
    if (input.dataset.customDatepickerAttached === 'true') {
      updateInputPlaceholder(input);
      return;
    }

    // datetime-local（如「定時開放」）與 date 共用同一套元件，差別在開啟哪個彈窗、值的格式，
    // 以及 placeholder 文字；用 dataset 記錄，openDatePickerForInput 呼叫端據此判斷。
    const isDateTime = input.type === 'datetime-local';
    input.dataset.datepickerMode = isDateTime ? 'datetime' : 'date';
    input.dataset.customDatepickerAttached = 'true';

    // Change type to text so browser native picker UI is completely superseded
    input.type = 'text';
    input.setAttribute('autocomplete', 'off');
    input.setAttribute('spellcheck', 'false');
    input.classList.add('custom-datepicker-input');

    updateInputPlaceholder(input);

    const openPicker = () => (isDateTime ? openDateTimePickerForInput(input) : openDatePickerForInput(input));

    // Create wrapper if not wrapped
    let wrapper = input.parentElement;
    if (!wrapper || !wrapper.classList.contains('custom-datepicker-wrapper')) {
      wrapper = document.createElement('div');
      wrapper.className = 'custom-datepicker-wrapper';
      // 複製原本 input 的完整 inline style（而不是只有 width），讓 wrapper 接手原本的版面配置
      // （例如 flex:1、min-width，常見於跟其他欄位並排的情況），避免換行後版面跑掉。
      const inlineStyle = input.getAttribute('style');
      if (inlineStyle) wrapper.setAttribute('style', inlineStyle);

      input.parentNode.insertBefore(wrapper, input);
      wrapper.appendChild(input);

      // Add clickable calendar icon
      const icon = document.createElement('span');
      icon.className = 'custom-datepicker-icon';
      icon.innerHTML = isDateTime ? '🕒' : '📅';
      icon.title = isDateTime ? 'Select Date & Time / 選擇日期時間' : 'Select Date / 選擇日期';
      icon.addEventListener('click', (e) => {
        e.stopPropagation();
        openPicker();
      });
      wrapper.appendChild(icon);
    }

    input.addEventListener('click', (e) => {
      e.stopPropagation();
      openPicker();
    });

    // Auto-format typing（datetime 模式一律透過彈窗的「套用」寫回，直接輸入文字不做自動格式化）
    if (!isDateTime) {
      input.addEventListener('blur', () => {
        const v = input.value.trim();
        if (v) {
          const p = parseDate(v);
          if (p) {
            input.value = formatDate(p.getFullYear(), p.getMonth(), p.getDate());
          }
        }
      });
    }
  }

  function updateInputPlaceholder(input) {
    const lang = getLang();
    const dict = DATEPICKER_I18N[lang] || DATEPICKER_I18N['zh-TW'];
    input.placeholder = input.dataset.datepickerMode === 'datetime'
      ? (lang === 'en' ? 'YYYY-MM-DD HH:MM' : '年/月/日 時:分')
      : dict.placeholder;
  }

  /**
   * Scan and attach custom bilingual datepicker to all target inputs
   */
  function initAll() {
    injectStyles();
    const selector = 'input[type="date"], input[type="datetime-local"], input[data-datepicker="true"], #attendance-date, #note-date, #dash-start-date, #dash-end-date, #export-start-date, #export-end-date, #quick-note-date, #score-logs-start-date, #score-logs-end-date, #proj-start-date, #proj-end-date';
    document.querySelectorAll(selector).forEach(input => {
      attachDatePicker(input);
    });
  }

  function updateAllPlaceholders() {
    document.querySelectorAll('.custom-datepicker-input').forEach(input => {
      updateInputPlaceholder(input);
    });
    if (activePopup) {
      closePopup();
    }
  }

  // Listen to language switch events
  window.addEventListener('languageChanged', updateAllPlaceholders);

  document.addEventListener('DOMContentLoaded', () => {
    initAll();
  });

  window.CustomDatePicker = {
    initAll,
    attachDatePicker,
    updateAllPlaceholders,
    close: closePopup
  };

})(window);
