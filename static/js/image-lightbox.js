/* ==========================================================================
   國小課堂即時記錄系統 - 圖片放大檢視 Lightbox
   取代「點圖片開新分頁」的做法：彈出視窗檢視，支援放大/縮小（按鈕、滾輪）、
   拖曳平移（放大後）、Esc 關閉。目前用於教學小工具的即時互動牆貼文縮圖
   （toolkit.js），但設計成通用元件，其他地方要用同一個 modal 直接呼叫
   window.ImageLightbox.open(url) 即可。
   ========================================================================== */
(function (window, document) {
  'use strict';

  const MIN_SCALE = 1;
  const MAX_SCALE = 4;
  const STEP = 0.25;

  let scale = 1;
  let translateX = 0;
  let translateY = 0;
  let dragging = false;
  let dragStartX = 0;
  let dragStartY = 0;
  let dragOriginX = 0;
  let dragOriginY = 0;

  function els() {
    return {
      overlay: document.getElementById('modal-image-lightbox'),
      img: document.getElementById('lightbox-image'),
      wrap: document.getElementById('lightbox-image-wrap'),
      zoomLabel: document.getElementById('text-lightbox-zoom-level'),
    };
  }

  function applyTransform() {
    const { img, zoomLabel } = els();
    if (!img) return;
    img.style.transform = `translate(${translateX}px, ${translateY}px) scale(${scale})`;
    img.style.cursor = scale > MIN_SCALE ? 'grab' : 'default';
    if (zoomLabel) zoomLabel.textContent = `${Math.round(scale * 100)}%`;
  }

  function resetTransform() {
    scale = MIN_SCALE;
    translateX = 0;
    translateY = 0;
    applyTransform();
  }

  function zoomBy(delta) {
    scale = Math.min(MAX_SCALE, Math.max(MIN_SCALE, scale + delta));
    if (scale === MIN_SCALE) {
      translateX = 0;
      translateY = 0;
    }
    applyTransform();
  }

  function open(url) {
    const { img } = els();
    if (!img) return;
    img.src = url;
    resetTransform();
    if (window.openModal) window.openModal('modal-image-lightbox');
  }

  function close() {
    if (window.closeModal) window.closeModal('modal-image-lightbox');
  }

  function init() {
    const { overlay, img, wrap } = els();
    if (!overlay || !img || !wrap) return;

    document.getElementById('btn-lightbox-zoom-in')?.addEventListener('click', () => zoomBy(STEP));
    document.getElementById('btn-lightbox-zoom-out')?.addEventListener('click', () => zoomBy(-STEP));
    document.getElementById('btn-lightbox-zoom-reset')?.addEventListener('click', resetTransform);
    // 關閉按鈕本身已掛 .close-modal class，交給 app.js 的 initModals() 通用邏輯處理。

    wrap.addEventListener('wheel', (e) => {
      e.preventDefault();
      zoomBy(e.deltaY < 0 ? STEP : -STEP);
    }, { passive: false });

    // 放大後可拖曳平移；用 Pointer Events 同時涵蓋滑鼠與觸控。
    img.addEventListener('pointerdown', (e) => {
      if (scale <= MIN_SCALE) return;
      dragging = true;
      dragStartX = e.clientX;
      dragStartY = e.clientY;
      dragOriginX = translateX;
      dragOriginY = translateY;
      img.setPointerCapture(e.pointerId);
      img.style.cursor = 'grabbing';
    });
    img.addEventListener('pointermove', (e) => {
      if (!dragging) return;
      translateX = dragOriginX + (e.clientX - dragStartX);
      translateY = dragOriginY + (e.clientY - dragStartY);
      applyTransform();
    });
    ['pointerup', 'pointercancel', 'pointerleave'].forEach((evt) => {
      img.addEventListener(evt, () => {
        dragging = false;
        if (scale > MIN_SCALE) img.style.cursor = 'grab';
      });
    });

    // 雙擊快速放大/還原
    img.addEventListener('dblclick', () => {
      if (scale > MIN_SCALE) resetTransform();
      else zoomBy(STEP * 4);
    });

    document.addEventListener('keydown', (e) => {
      if (!overlay.classList.contains('open')) return;
      if (e.key === 'Escape') close();
      else if (e.key === '+' || e.key === '=') zoomBy(STEP);
      else if (e.key === '-') zoomBy(-STEP);
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

  window.ImageLightbox = { open, close };
})(window, document);
