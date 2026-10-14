// 簡易版簡報引擎：<main class="deck"> 內每個 <section class="slide"> 為一頁。
// 操作：← → / 空白鍵 / PageUp PageDown / Home End、左右滑動、底部按鈕、F 全螢幕；網址 #3 可直接跳到第 3 頁。
(function () {
  const slides = Array.from(document.querySelectorAll('.deck .slide'));
  if (!slides.length) return;

  const btnPrev = document.getElementById('slPrev');
  const btnNext = document.getElementById('slNext');
  const btnFull = document.getElementById('slFull');
  const dotsWrap = document.getElementById('slDots');
  const countEl = document.getElementById('slCount');
  let idx = 0;

  const dots = slides.map((_, i) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.setAttribute('aria-label', `第 ${i + 1} 頁`);
    b.addEventListener('click', () => go(i));
    dotsWrap.appendChild(b);
    return b;
  });

  function go(n) {
    idx = Math.max(0, Math.min(slides.length - 1, n));
    slides.forEach((s, i) => s.classList.toggle('active', i === idx));
    dots.forEach((d, i) => d.classList.toggle('on', i === idx));
    countEl.textContent = `${idx + 1} / ${slides.length}`;
    btnPrev.disabled = idx === 0;
    btnNext.disabled = idx === slides.length - 1;
    slides[idx].scrollTop = 0;
    try { history.replaceState(null, '', `#${idx + 1}`); } catch (_) { /* ignore */ }
  }

  function toggleFullscreen() {
    if (document.fullscreenElement) document.exitFullscreen();
    else if (document.documentElement.requestFullscreen) document.documentElement.requestFullscreen().catch(() => {});
  }

  btnPrev.addEventListener('click', () => go(idx - 1));
  btnNext.addEventListener('click', () => go(idx + 1));
  if (btnFull) {
    if (document.documentElement.requestFullscreen) btnFull.addEventListener('click', toggleFullscreen);
    else btnFull.style.display = 'none'; // iPhone Safari 不支援網頁全螢幕
  }

  document.addEventListener('keydown', (e) => {
    if (e.altKey || e.ctrlKey || e.metaKey) return;
    switch (e.key) {
      case 'ArrowRight': case 'ArrowDown': case 'PageDown': case ' ': e.preventDefault(); go(idx + 1); break;
      case 'ArrowLeft': case 'ArrowUp': case 'PageUp': e.preventDefault(); go(idx - 1); break;
      case 'Home': go(0); break;
      case 'End': go(slides.length - 1); break;
      case 'f': case 'F': toggleFullscreen(); break;
      default: break;
    }
  });

  // 左右滑動換頁（垂直捲動優先，不誤觸）
  let sx = 0, sy = 0;
  const deck = document.querySelector('.deck');
  deck.addEventListener('touchstart', (e) => { sx = e.touches[0].clientX; sy = e.touches[0].clientY; }, { passive: true });
  deck.addEventListener('touchend', (e) => {
    const dx = e.changedTouches[0].clientX - sx;
    const dy = e.changedTouches[0].clientY - sy;
    if (Math.abs(dx) > 60 && Math.abs(dx) > Math.abs(dy) * 1.5) go(idx + (dx < 0 ? 1 : -1));
  }, { passive: true });

  const fromHash = parseInt(location.hash.replace('#', ''), 10);
  go(Number.isFinite(fromHash) ? fromHash - 1 : 0);
})();
