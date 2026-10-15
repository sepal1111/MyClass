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
    if (status.edition === 'installed') {
      return [
        T('按下方「前往下載頁」，下載最新的<b>安裝程式</b>（檔名含 Setup）。', 'Click “Open download page” below and download the latest <b>installer</b> (file name contains Setup).'),
        T('直接執行安裝程式，一路按「下一步」。你的班級與學生資料<b>會自動保留</b>，不需要另外備份或匯入。', 'Run the installer and keep clicking Next. Your classes and student data are <b>kept automatically</b>.'),
        T('安裝完成後重新開啟 MyClass 即可。', 'Open MyClass again when the installation finishes.'),
      ]
        .map((t, i) => `<div style="margin:6px 0;">${i + 1}. ${t}</div>`)
        .join('');
    }
    return [
      T('按下方「前往下載頁」，下載最新版的壓縮檔並<b>解壓縮</b>（放在跟舊版不同的位置）。', 'Click “Open download page” below, download the latest zip and <b>extract</b> it somewhere different from the old version.'),
      T('先<b>關閉 MyClass</b>（關掉黑色的執行視窗）。', '<b>Close MyClass</b> first (close the black console window).'),
      T('把<b>舊資料夾裡的 <code>bin</code> 資料夾</b>整個複製到新資料夾裡（裡面是你所有的班級、學生與上傳檔案）。', 'Copy the <b><code>bin</code> folder from the old folder</b> into the new folder (it holds all your classes, students and uploads).'),
      T('開啟新資料夾裡的 MyClass 執行檔。舊資料夾請先保留一陣子當備份。', 'Start MyClass from the new folder. Keep the old folder for a while as a backup.'),
    ]
      .map((t, i) => `<div style="margin:6px 0;">${i + 1}. ${t}</div>`)
      .join('');
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
          <a id="update-open-download" class="btn" href="${esc(latest.url)}" target="_blank" rel="noopener noreferrer" style="text-decoration:none;">${esc(T('前往下載頁', 'Open download page'))}</a>
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
