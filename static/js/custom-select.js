/* ==========================================================================
   國小課堂即時記錄系統 - 自訂下拉選單（美化原生 <select> 展開的選項清單）
   瀏覽器原生 <select> 展開的選項清單是作業系統繪製的，CSS 幾乎無法自訂外觀
   （圓角/陰影/hover 顏色多半不受控，且清單寬度依內容自動撐開，容易超出視窗
   或所在容器，這正是回報過的下拉選單溢出問題的根源）。

   做法：保留原生 <select>（display:none，但仍是唯一事實來源——值、change 事件、
   既有程式碼的 .value/.disabled/重建 options 都繼續對它生效），疊一個自訂觸發
   按鈕＋選項面板做視覺呈現。面板用 position:fixed 掛在 <body> 下並自動避開視窗
   邊界（必要時往上開、往左收），不受任何 modal 寬度或 overflow 裁切影響。

   只在滑鼠桌面環境（hover:hover 且 pointer:fine）啟用；觸控裝置（手機遙控器
   彈窗、行動裝置窄螢幕的分頁 select 等）維持原生 select，保留原生選擇器對
   觸控更友善的操作方式，不強行套用桌面風格的小面板。
   ========================================================================== */
(function (window, document) {
  'use strict';

  const ENHANCE_MEDIA = '(hover: hover) and (pointer: fine)';

  // 目前唯一展開中的面板（全域只允許開一個，比照原生 select 的行為）。
  let openState = null; // { select, trigger, panel, activeIndex }

  function closeOpen() {
    if (!openState) return;
    const { panel, trigger } = openState;
    if (panel.parentNode) panel.parentNode.removeChild(panel);
    trigger.setAttribute('aria-expanded', 'false');
    openState = null;
  }

  function isOpenFor(select) {
    return !!openState && openState.select === select;
  }

  function positionPanel(trigger, panel) {
    const rect = trigger.getBoundingClientRect();
    const vw = document.documentElement.clientWidth;
    const vh = document.documentElement.clientHeight;
    panel.style.minWidth = `${rect.width}px`;
    const panelRect = panel.getBoundingClientRect();
    let left = rect.left;
    if (left + panelRect.width > vw - 8) left = Math.max(8, vw - panelRect.width - 8);
    let top = rect.bottom + 4;
    if (top + panelRect.height > vh - 8 && rect.top - panelRect.height - 4 > 8) {
      top = rect.top - panelRect.height - 4; // 下方空間不夠就改往上開
    }
    panel.style.left = `${left}px`;
    panel.style.top = `${top}px`;
  }

  function renderOptions(select, panel) {
    panel.innerHTML = '';
    Array.from(select.options).forEach((opt, idx) => {
      const item = document.createElement('div');
      item.className = 'custom-select-option' + (idx === select.selectedIndex ? ' selected' : '') + (opt.disabled ? ' disabled' : '');
      item.setAttribute('role', 'option');
      item.textContent = opt.textContent;
      if (!opt.disabled) {
        item.addEventListener('click', () => {
          select.selectedIndex = idx;
          select.dispatchEvent(new Event('change', { bubbles: true }));
          closeOpen();
        });
      }
      panel.appendChild(item);
    });
  }

  function highlightActive(panel, activeIndex) {
    Array.from(panel.children).forEach((el, idx) => el.classList.toggle('active', idx === activeIndex));
    const activeEl = panel.children[activeIndex];
    if (activeEl) activeEl.scrollIntoView({ block: 'nearest' });
  }

  function openFor(select, trigger) {
    closeOpen();
    const panel = document.createElement('div');
    panel.className = 'custom-select-panel';
    panel.setAttribute('role', 'listbox');
    document.body.appendChild(panel);
    renderOptions(select, panel);
    positionPanel(trigger, panel);
    requestAnimationFrame(() => panel.classList.add('open'));
    trigger.setAttribute('aria-expanded', 'true');
    openState = { select, trigger, panel, activeIndex: select.selectedIndex };
    highlightActive(panel, openState.activeIndex);
  }

  /** 原生 select 的值可能被既有程式碼直接用 `.value = x` / `.selectedIndex = x` 改掉
   *  （不會觸發 change 事件），這裡在該 select 實例上覆寫存取子，讓這種寫法也能
   *  同步更新自訂觸發按鈕上顯示的文字，完全不需要更動任何既有呼叫端程式碼。 */
  function shadowAccessor(el, prop, onChange) {
    const desc = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(el), prop);
    if (!desc || !desc.set) return;
    Object.defineProperty(el, prop, {
      configurable: true,
      enumerable: desc.enumerable,
      get() { return desc.get.call(el); },
      set(v) {
        desc.set.call(el, v);
        onChange();
      },
    });
  }

  function enhanceSelect(select) {
    if (select.dataset.customSelectEnhanced) return;
    if (select.multiple) return; // 複選 select 維持原生，行為差異太大不硬套
    select.dataset.customSelectEnhanced = '1';

    const trigger = document.createElement('button');
    trigger.type = 'button';
    // 複製原本 select 的 class／inline style，讓觸發按鈕接手原本的版面配置（寬度、flex、margin 等）。
    trigger.className = ('custom-select-trigger ' + select.className).trim();
    const inlineStyle = select.getAttribute('style');
    if (inlineStyle) trigger.setAttribute('style', inlineStyle);
    trigger.setAttribute('aria-haspopup', 'listbox');
    trigger.setAttribute('aria-expanded', 'false');

    const label = document.createElement('span');
    label.className = 'custom-select-trigger-label';
    const caret = document.createElement('span');
    caret.className = 'custom-select-trigger-caret';
    caret.textContent = '▾';
    trigger.appendChild(label);
    trigger.appendChild(caret);

    select.insertAdjacentElement('afterend', trigger);
    select.classList.add('custom-select-native-hidden');

    function syncFromSelect() {
      const opt = select.options[select.selectedIndex];
      label.textContent = opt ? opt.textContent : '';
      trigger.disabled = select.disabled;
      trigger.classList.toggle('is-disabled', select.disabled);
      if (isOpenFor(select)) renderOptions(select, openState.panel);
    }

    trigger.addEventListener('click', () => {
      if (isOpenFor(select)) closeOpen();
      else openFor(select, trigger);
    });

    trigger.addEventListener('keydown', (e) => {
      const navKeys = ['ArrowDown', 'ArrowUp', 'Enter', ' ', 'Escape', 'Home', 'End'];
      if (navKeys.includes(e.key)) e.preventDefault();
      if (!isOpenFor(select)) {
        if (e.key === 'ArrowDown' || e.key === 'ArrowUp' || e.key === 'Enter' || e.key === ' ') openFor(select, trigger);
        return;
      }
      const count = select.options.length;
      if (e.key === 'ArrowDown') { openState.activeIndex = Math.min(count - 1, openState.activeIndex + 1); highlightActive(openState.panel, openState.activeIndex); }
      else if (e.key === 'ArrowUp') { openState.activeIndex = Math.max(0, openState.activeIndex - 1); highlightActive(openState.panel, openState.activeIndex); }
      else if (e.key === 'Home') { openState.activeIndex = 0; highlightActive(openState.panel, openState.activeIndex); }
      else if (e.key === 'End') { openState.activeIndex = count - 1; highlightActive(openState.panel, openState.activeIndex); }
      else if (e.key === 'Enter' || e.key === ' ') {
        const idx = openState.activeIndex;
        if (idx >= 0 && select.options[idx] && !select.options[idx].disabled) {
          select.selectedIndex = idx;
          select.dispatchEvent(new Event('change', { bubbles: true }));
        }
        closeOpen();
      } else if (e.key === 'Escape') {
        closeOpen();
      }
    });

    select.addEventListener('change', syncFromSelect);
    shadowAccessor(select, 'value', syncFromSelect);
    shadowAccessor(select, 'selectedIndex', syncFromSelect);
    // 涵蓋既有程式碼常見的「select.innerHTML = ''; 再逐一 appendChild(option)」動態重建 options 的用法。
    new MutationObserver(syncFromSelect).observe(select, { childList: true, subtree: true, attributes: true, attributeFilter: ['disabled'] });

    syncFromSelect();
  }

  document.addEventListener('click', (e) => {
    if (openState && !e.target.closest('.custom-select-panel') && !e.target.closest('.custom-select-trigger')) closeOpen();
  });
  window.addEventListener('resize', closeOpen);
  window.addEventListener('scroll', (e) => {
    // 面板本身（含捲軸拖曳、滾輪、方向鍵捲動）觸發的 scroll 事件不應關閉選單，
    // 只有頁面／其他祖先元素的捲動才需要關閉。
    if (e.target && e.target.nodeType === 1 && e.target.closest && e.target.closest('.custom-select-panel')) return;
    closeOpen();
  }, true);

  function enhanceAll(root) {
    if (!window.matchMedia(ENHANCE_MEDIA).matches) return;
    (root || document).querySelectorAll('select').forEach(enhanceSelect);
  }

  window.CustomSelect = { enhanceAll, enhanceSelect };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => enhanceAll());
  } else {
    enhanceAll();
  }
})(window, document);
