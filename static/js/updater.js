/* ==========================================================================
   新版本提示（教師端）
   伺服器（src/updateCheck.ts）定期向 GitHub 查詢最新版本；這裡只負責「通知」：
   - 頁首橫幅：有新版本時提示，可「查看並更新」或「略過此版本」
   - 設定 ➔ 密碼與連線：軟體更新卡片（目前版本、立即檢查、開關自動檢查）
   不會自動下載或更換任何檔案；更新步驟寫在說明視窗裡，由老師自行操作。
   ========================================================================== */
(function () {
  const isEn = () => Boolean(window.I18n && window.I18n.getLanguage() === 'en');
  const T = (zh, en) => (isEn() ? en : zh);
  const esc = (s) =>
    String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  let status = null;
  let bannerClosedThisSession = false;

  async function load() {
    try {
      status = await API.get('/api/system/update_status');
    } catch (e) {
      status = null;
    }
    render();
  }

  function shouldNotify() {
    return Boolean(
      status && status.enabled && status.has_update && status.latest &&
      status.dismissed_version !== status.latest.version
    );
  }

  function fmtTime(iso) {
    if (!iso) return '';
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return '';
    const p = (n) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
  }

  function fmtSize(bytes) {
    if (!bytes) return '';
    return bytes >= 1048576 ? `${(bytes / 1048576).toFixed(0)} MB` : `${Math.max(1, Math.round(bytes / 1024))} KB`;
  }

  function editionLabel(ed) {
    if (ed === 'installed') return T('安裝版', 'installed edition');
    if (ed === 'portable') return T('可攜版', 'portable edition');
    return T('開發版', 'development build');
  }

  // ------------------------------------------------------------ 頁首橫幅
  function renderBanner() {
    let bar = document.getElementById('update-banner');
    if (!shouldNotify() || bannerClosedThisSession) {
      if (bar) bar.remove();
      return;
    }
    if (!bar) {
      bar = document.createElement('div');
      bar.id = 'update-banner';
      bar.style.cssText =
        'position: sticky; top: 0; z-index: 900; display: flex; align-items: center; justify-content: center; ' +
        'gap: 12px; flex-wrap: wrap; padding: 10px 16px; background: linear-gradient(135deg, #0369a1, #4f46e5); ' +
        'color: #fff; font-size: 0.95rem; font-weight: 700; box-shadow: 0 2px 10px rgba(0,0,0,0.25);';
      document.body.insertBefore(bar, document.body.firstChild);
    }
    const latest = status.latest;
    bar.innerHTML = `
      <span>🆕 ${esc(T('MyClass 有新版本', 'A new version of MyClass is available'))}：<b>v${esc(latest.version)}</b>
        <span style="opacity:.85; font-weight:500;">（${esc(T('目前', 'current'))} v${esc(status.current_version)}）</span></span>
      <button type="button" id="update-banner-open" style="background:#fff;color:#0369a1;border:none;border-radius:999px;padding:6px 16px;font-weight:800;cursor:pointer;font-family:inherit;">${esc(T('查看並更新', 'View & update'))}</button>
      <button type="button" id="update-banner-skip" style="background:transparent;color:#fff;border:1px solid rgba(255,255,255,.55);border-radius:999px;padding:6px 14px;cursor:pointer;font-family:inherit;">${esc(T('略過此版本', 'Skip this version'))}</button>
      <button type="button" id="update-banner-close" aria-label="close" style="background:transparent;color:#fff;border:none;font-size:1.2rem;cursor:pointer;line-height:1;">✕</button>`;
    bar.querySelector('#update-banner-open').addEventListener('click', openDetail);
    bar.querySelector('#update-banner-skip').addEventListener('click', skipVersion);
    bar.querySelector('#update-banner-close').addEventListener('click', () => {
      bannerClosedThisSession = true;
      renderBanner();
    });
  }

  async function skipVersion() {
    if (!status || !status.latest) return;
    try {
      status = await API.post('/api/system/update_dismiss', { version: status.latest.version });
    } catch (e) {
      /* 略過失敗不影響使用 */
    }
    const modal = document.getElementById('update-detail-overlay');
    if (modal) modal.remove();
    render();
  }

  // ------------------------------------------------------------ 更新說明視窗
  function stepsHtml() {
    const fmt = (list) => list.map((t, i) => `<div style="margin:6px 0;">${i + 1}. ${t}</div>`).join('');
    // v4.3.0 起不再提供安裝版：安裝版要換成可攜版（資料在安裝資料夾的 bin，複製過去即可）。
    // 順序要「先解除安裝舊版、再開新版並勾開機自動啟動」：舊安裝程式解除安裝時會刪掉同名的開機啟動登錄值。
    if (status.edition === 'installed') {
      return fmt([
        T('從 v4.3.0 起 MyClass <b>只提供可攜版</b>（不用安裝，功能完全相同，右下角一樣有圖示）。請依下面步驟換成可攜版。', 'From v4.3.0 MyClass is <b>portable only</b> (no installation, same features, still with a tray icon). Follow the steps below to switch.'),
        T('按下方的「下載更新檔」，把壓縮檔<b>解壓縮</b>到你想放的位置（例如 <code>D:\\MyClass</code>），會得到一個新的資料夾。', 'Click “Download update” and <b>extract</b> the zip to where you want to keep it (e.g. <code>D:\\MyClass</code>).'),
        T('在右下角 MyClass 圖示按右鍵 →「<b>結束 MyClass</b>」。', 'Right-click the MyClass tray icon → “<b>Exit MyClass</b>”.'),
        T('打開舊的安裝資料夾（通常是 <code>C:\\MyClass</code>），把裡面的 <code>bin</code> 資料夾<b>整個複製</b>到新資料夾裡（和 <code>MyClass.exe</code> 放在同一層）。<code>bin</code> 裡面是你所有的班級、學生與上傳檔案。', 'Open the old install folder (usually <code>C:\\MyClass</code>) and <b>copy its whole <code>bin</code> folder</b> into the new folder (next to <code>MyClass.exe</code>). <code>bin</code> holds all your classes, students and uploads.'),
        T('到「Windows 設定 → 應用程式」<b>解除安裝</b>舊的「MyClass 課堂即時記錄系統」。', '<b>Uninstall</b> the old “MyClass” from Windows Settings → Apps.'),
        T('點兩下新資料夾裡的 <b>MyClass.exe</b>。需要開機自動啟動的話，在右下角圖示按右鍵勾選「開機時自動啟動」。確認班級資料都在之後，舊的 <code>C:\\MyClass</code> 資料夾就可以刪除。', 'Double-click <b>MyClass.exe</b> in the new folder. To start with Windows, right-click the tray icon and tick “Start with Windows”. Once your classes are there, you can delete the old <code>C:\\MyClass</code> folder.'),
      ]);
    }
    return fmt([
      T('按下方的「下載更新檔」，把壓縮檔<b>解壓縮</b>，會得到一個新的資料夾（裡面有 <code>MyClass.exe</code>、MyClass 伺服器程式和 <code>system</code> 資料夾，<b>要放在一起</b>）。', 'Click “Download update” below and <b>extract</b> the zip. You get a new folder containing <code>MyClass.exe</code>, the MyClass server program and a <code>system</code> folder (<b>keep them together</b>).'),
      T('先<b>關閉 MyClass</b>：在右下角 MyClass 圖示按右鍵 →「結束 MyClass」（舊版沒有圖示的話，關掉黑色的執行視窗）。', '<b>Close MyClass</b> first: right-click the MyClass tray icon → “Exit MyClass” (older versions without an icon: close the black console window).'),
      T('打開<b>舊版的資料夾</b>，把裡面的 <code>bin</code> 資料夾<b>整個複製</b>到新資料夾裡（和執行檔放在同一層）。<code>bin</code> 裡面是你所有的班級、學生與上傳檔案。', 'Open the <b>old folder</b> and <b>copy its whole <code>bin</code> folder</b> into the new folder (next to the program). <code>bin</code> holds all your classes, students and uploads.'),
      T('點兩下新資料夾裡的 <b>MyClass.exe</b>。第一次啟動時系統會先自動備份資料庫；有設定開機自動啟動的話，也會自動改成新資料夾。確認班級資料都在之後，再刪除舊資料夾。', 'Double-click <b>MyClass.exe</b> in the new folder. On the first start the database is backed up automatically, and “Start with Windows” (if enabled) switches to the new folder. Delete the old folder once you have confirmed your classes are there.'),
    ]);
  }

  function openDetail() {
    if (!status || !status.latest) return;
    const old = document.getElementById('update-detail-overlay');
    if (old) old.remove();
    const latest = status.latest;
    const overlay = document.createElement('div');
    overlay.id = 'update-detail-overlay';
    overlay.className = 'modal-overlay open';
    overlay.style.cssText = 'z-index: 100001; display: flex; align-items: center; justify-content: center;';
    const notes = latest.notes
      ? `<div style="margin-top:14px;font-weight:800;">${esc(T('這個版本的更新內容', 'What’s new'))}</div>
         <div style="margin-top:6px;padding:10px 12px;border-radius:10px;background:rgba(127,127,127,.12);max-height:180px;overflow:auto;white-space:pre-wrap;font-size:.85rem;line-height:1.6;">${esc(latest.notes)}</div>`
      : '';
    overlay.innerHTML = `
      <div class="modal-content" style="max-width: 560px; padding: 26px; max-height: 90vh; overflow:auto;">
        <div style="font-size:2.2rem;text-align:center;">🆕</div>
        <div class="modal-title" style="text-align:center;margin-bottom:6px;">${esc(T('有新版本可以更新', 'A new version is available'))}</div>
        <div style="text-align:center;color:var(--text-muted);margin-bottom:14px;">
          v${esc(status.current_version)} ➔ <b style="color:var(--text-main);">v${esc(latest.version)}</b>
          <span style="opacity:.8;">（${esc(editionLabel(status.edition))}）</span>
        </div>
        <div style="font-weight:800;">${esc(T('怎麼更新？', 'How to update'))}</div>
        <div style="margin-top:6px;font-size:.92rem;line-height:1.7;">${stepsHtml()}</div>
        ${notes}
        <div style="display:flex;gap:10px;flex-wrap:wrap;justify-content:center;margin-top:20px;">
          ${status.download
            ? `<a id="update-open-download" class="btn" href="${esc(status.download.url)}" rel="noopener noreferrer" style="text-decoration:none;">⬇️ ${esc(T('下載更新檔', 'Download update'))}（${esc(fmtSize(status.download.size))}）</a>
               <a class="btn btn-secondary" href="${esc(latest.url)}" target="_blank" rel="noopener noreferrer" style="text-decoration:none;">${esc(T('查看所有下載', 'All downloads'))}</a>`
            : `<a id="update-open-download" class="btn" href="${esc(latest.url)}" target="_blank" rel="noopener noreferrer" style="text-decoration:none;">${esc(T('前往下載頁', 'Open download page'))}</a>`}
          <button type="button" id="update-detail-skip" class="btn btn-secondary">${esc(T('略過此版本', 'Skip this version'))}</button>
          <button type="button" id="update-detail-later" class="btn btn-secondary">${esc(T('稍後再說', 'Later'))}</button>
        </div>
      </div>`;
    document.body.appendChild(overlay);
    overlay.querySelector('#update-detail-skip').addEventListener('click', skipVersion);
    overlay.querySelector('#update-detail-later').addEventListener('click', () => overlay.remove());
    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) overlay.remove();
    });
  }

  // ------------------------------------------------------------ 設定頁卡片
  function renderCard() {
    const box = document.getElementById('update-card-status');
    if (!box) return;
    const auto = document.getElementById('update-auto-check');
    if (!status) {
      box.textContent = T('無法取得版本資訊。', 'Unable to read version information.');
      return;
    }
    if (auto) {
      auto.checked = Boolean(status.enabled);
      auto.disabled = Boolean(status.env_disabled) || !status.current_version;
    }
    const lines = [];
    if (!status.current_version) {
      lines.push(T('目前是開發版本，不進行版本偵測。', 'This is a development build; version checking is off.'));
    } else {
      lines.push(`${esc(T('目前版本', 'Current version'))}：<b>v${esc(status.current_version)}</b>（${esc(editionLabel(status.edition))}）`);
      if (status.env_disabled) {
        lines.push(T('這台電腦已由環境設定停用版本偵測。', 'Version checking is disabled by environment setting on this computer.'));
      } else if (status.latest) {
        if (status.has_update) {
          lines.push(
            `${esc(T('最新版本', 'Latest version'))}：<b>v${esc(status.latest.version)}</b> 🆕 ` +
              `<a href="#" id="update-card-open" style="color:var(--primary-light);font-weight:700;">${esc(T('查看並更新', 'View & update'))}</a>`
          );
        } else {
          lines.push(`${esc(T('已是最新版本', 'You are up to date'))} ✅（v${esc(status.latest.version)}）`);
        }
      } else if (status.checked_at && status.last_ok) {
        lines.push(T('已檢查，目前沒有發佈的新版本。', 'Checked: no newer version has been published.'));
      }
      if (status.checked_at) {
        lines.push(
          `${esc(T('上次檢查', 'Last checked'))}：${esc(fmtTime(status.checked_at))}` +
            (status.last_ok === false ? `（${esc(T('失敗，可能是這個網路無法連到 GitHub', 'failed; this network may not reach GitHub'))}）` : '')
        );
      }
    }
    box.innerHTML = lines.map((l) => `<div>${l}</div>`).join('');
    const openLink = document.getElementById('update-card-open');
    if (openLink) {
      openLink.addEventListener('click', (e) => {
        e.preventDefault();
        openDetail();
      });
    }
    const btn = document.getElementById('btn-update-check-now');
    if (btn) btn.disabled = !status.current_version || !status.enabled;
  }

  function render() {
    renderBanner();
    renderCard();
  }

  function bindCard() {
    const btn = document.getElementById('btn-update-check-now');
    if (btn && !btn.dataset.bound) {
      btn.dataset.bound = '1';
      btn.addEventListener('click', async () => {
        btn.disabled = true;
        const label = btn.textContent;
        btn.textContent = T('檢查中…', 'Checking…');
        try {
          status = await API.post('/api/system/update_check', {});
          bannerClosedThisSession = false;
          if (status.last_ok === false) {
            alert(T('無法連到 GitHub，請確認這台電腦可以上網。', 'Unable to reach GitHub. Please check this computer’s internet connection.'));
          } else if (!status.has_update) {
            alert(T('目前已是最新版本。', 'You are up to date.'));
          }
        } catch (e) {
          alert(e.message || T('檢查失敗', 'Check failed'));
        } finally {
          btn.textContent = label;
          render();
        }
      });
    }
    const auto = document.getElementById('update-auto-check');
    if (auto && !auto.dataset.bound) {
      auto.dataset.bound = '1';
      auto.addEventListener('change', async () => {
        try {
          status = await API.post('/api/system/update_settings', { enabled: auto.checked });
        } catch (e) {
          auto.checked = !auto.checked;
          alert(e.message);
        }
        render();
      });
    }
  }

  window.UpdateNotice = {
    // app.js 在登入完成、班級載入後呼叫
    onAppReady() {
      bindCard();
      load();
    },
    refresh: load,
  };
})();
