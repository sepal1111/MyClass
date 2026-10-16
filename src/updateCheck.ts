// 新版本偵測：定期向 GitHub 詢問「最新發佈的版本」，只通知、不自動下載或更換程式。
//
// 隱私：只送出一個不帶任何資料的 GET（沒有班級、學生、教師、機器識別資訊，只有固定的 User-Agent）。
// 預設每 12 小時最多查一次，結果存在 system_settings；可在「設定 ➔ 密碼與連線」關閉，
// 或用環境變數 MYCLASS_NO_UPDATE_CHECK=1 強制關閉。查詢失敗一律靜默（學校網路常擋外部連線）。
//
// 目前版本：打包版由建置時寫入的 system/version.json 取得；開發模式沒有版本，整個功能不啟動。
import fs from "fs";
import path from "path";
import { prisma } from "./db";
import { getBundleDir, getExeDir } from "./paths";

const REPO = (process.env.MYCLASS_UPDATE_REPO || "sepal1111/MyClass").trim();
const API_BASE = `https://api.github.com/repos/${REPO}`;
const RELEASES_PAGE = `https://github.com/${REPO}/releases`;

const AUTO_INTERVAL_OK_MS = 12 * 60 * 60 * 1000; // 上次成功：12 小時後才再查
const AUTO_INTERVAL_FAIL_MS = 60 * 60 * 1000; // 上次失敗：1 小時後再試
const MANUAL_MIN_INTERVAL_MS = 30 * 1000; // 手動「立即檢查」最短間隔，避免連按
const FETCH_TIMEOUT_MS = 8000;
const NOTES_MAX_CHARS = 1500;

export type Edition = "portable" | "installed" | "dev";

export interface ReleaseAsset {
  name: string;
  url: string; // browser_download_url（一定是 https://github.com/ 開頭）
  size: number; // bytes
}

export interface LatestRelease {
  version: string; // 去掉 v/V 的數字版本，例如 "4.1.0"
  tag: string; // 原始標籤，例如 "v4.1.0"
  name: string;
  url: string; // 給老師點的下載頁
  notes: string;
  published_at: string | null;
  assets?: ReleaseAsset[]; // 該 Release 附的檔案（舊版快取沒有這欄）
}

export interface UpdateStatus {
  enabled: boolean;
  env_disabled: boolean;
  current_version: string | null;
  edition: Edition;
  latest: LatestRelease | null;
  /** 依平台挑出的下載檔（可攜版 zip）；找不到時為 null，介面改導向下載頁。 */
  download: ReleaseAsset | null;
  has_update: boolean;
  checked_at: string | null; // ISO
  last_ok: boolean | null;
  dismissed_version: string | null;
  repo: string;
}

// ---------------------------------------------------------------- 版本比較

/** "v4.1.0" / "V2.6.1.1" / "3.8" → [4,1,0]；沒有數字開頭則回傳 null。 */
export function parseVersion(tag: string): number[] | null {
  const m = String(tag).trim().match(/^[vV]?(\d+(?:\.\d+)*)/);
  if (!m) return null;
  return m[1].split(".").map((n) => Number(n));
}

export function compareVersions(a: number[], b: number[]): number {
  const len = Math.max(a.length, b.length);
  for (let i = 0; i < len; i++) {
    const d = (a[i] ?? 0) - (b[i] ?? 0);
    if (d !== 0) return d > 0 ? 1 : -1;
  }
  return 0;
}

/**
 * 從 Release 附件挑出這台電腦該下載的那一個。命名慣例（見 scripts/package-release.mjs）：
 *   可攜版 Windows：MyClassV<版本>-win-portable.zip
 *   可攜版 macOS：MyClassV<版本>-Mac*.zip
 * v4.3.0 起不再發佈安裝版；舊的安裝版也改下載可攜版 zip（更新說明會引導換成可攜版，見 static/js/updater.js）。
 */
export function pickDownload(
  assets: ReleaseAsset[] | undefined,
  edition: Edition,
  platform: NodeJS.Platform = process.platform
): ReleaseAsset | null {
  const list = assets ?? [];
  const find = (re: RegExp) => list.find((a) => re.test(a.name)) ?? null;
  if (edition === "dev") return null;
  if (platform === "darwin") return find(/mac.*\.zip$/i);
  return find(/portable.*\.zip$/i) ?? list.find((a) => /\.zip$/i.test(a.name) && !/mac/i.test(a.name)) ?? null;
}

// ---------------------------------------------------------------- 目前版本與版本類型

export function getCurrentVersion(): string | null {
  if (!(process as unknown as { pkg?: unknown }).pkg) return null; // 開發模式：不比對
  try {
    const file = path.join(getBundleDir(), "version.json");
    if (fs.existsSync(file)) {
      const v = JSON.parse(fs.readFileSync(file, "utf-8"))?.version;
      if (typeof v === "string" && parseVersion(v)) return String(v).replace(/^[vV]/, "");
    }
  } catch {
    /* 退回用檔名 */
  }
  // 舊版建置沒有 version.json：執行檔名稱是 MyClassV<版本>.exe
  const m = path.basename(process.execPath).match(/V(\d+(?:\.\d+)*)/i);
  return m ? m[1] : null;
}

/** 舊版安裝版（Inno Setup）會在程式資料夾放 unins000.exe；其餘為可攜版。v4.3.0 起只發佈可攜版，
 *  仍辨識安裝版是為了讓更新說明改成「換成可攜版」的步驟。 */
export function detectEdition(): Edition {
  if (!(process as unknown as { pkg?: unknown }).pkg) return "dev";
  try {
    return fs.existsSync(path.join(getExeDir(), "unins000.exe")) ? "installed" : "portable";
  } catch {
    return "portable";
  }
}

// ---------------------------------------------------------------- 設定儲存

const KEY = {
  enabled: "update_check_enabled",
  latest: "update_latest",
  attemptAt: "update_last_attempt_at",
  ok: "update_last_ok",
  dismissed: "update_dismissed_version",
} as const;

async function getSetting(key: string): Promise<string | null> {
  const row = await prisma.systemSetting.findUnique({ where: { key } });
  return row?.value ?? null;
}

async function setSetting(key: string, value: string): Promise<void> {
  await prisma.systemSetting.upsert({ where: { key }, update: { value }, create: { key, value } });
}

function envDisabled(): boolean {
  return process.env.MYCLASS_NO_UPDATE_CHECK === "1";
}

// ---------------------------------------------------------------- 取得狀態

export async function getUpdateStatus(): Promise<UpdateStatus> {
  const current = getCurrentVersion();
  const enabledSetting = await getSetting(KEY.enabled);
  let latest: LatestRelease | null = null;
  try {
    const raw = await getSetting(KEY.latest);
    if (raw) latest = JSON.parse(raw) as LatestRelease;
  } catch {
    latest = null;
  }
  const attempt = Number(await getSetting(KEY.attemptAt));
  const okRaw = await getSetting(KEY.ok);

  let hasUpdate = false;
  if (current && latest) {
    const c = parseVersion(current);
    const l = parseVersion(latest.version);
    hasUpdate = Boolean(c && l && compareVersions(l, c) > 0);
  }

  return {
    enabled: !envDisabled() && enabledSetting !== "0",
    env_disabled: envDisabled(),
    current_version: current,
    edition: detectEdition(),
    latest,
    download: latest ? pickDownload(latest.assets, detectEdition()) : null,
    has_update: hasUpdate,
    checked_at: attempt ? new Date(attempt).toISOString() : null,
    last_ok: okRaw === null ? null : okRaw === "1",
    dismissed_version: await getSetting(KEY.dismissed),
    repo: REPO,
  };
}

// ---------------------------------------------------------------- 向 GitHub 查詢

const HEADERS = {
  Accept: "application/vnd.github+json",
  "User-Agent": "MyClass-UpdateCheck",
  "X-GitHub-Api-Version": "2022-11-28",
};

async function getJson(url: string): Promise<{ status: number; json: unknown }> {
  const res = await fetch(url, { headers: HEADERS, signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
  const json = res.ok ? await res.json() : null;
  return { status: res.status, json };
}

/** 先看 GitHub「Releases」的最新正式版；沒有任何 Release 時，退而求其次取 tag 中版本最大的。 */
async function fetchLatestRelease(): Promise<LatestRelease | null> {
  const rel = await getJson(`${API_BASE}/releases/latest`);
  if (rel.status === 200 && rel.json && typeof rel.json === "object") {
    const r = rel.json as Record<string, unknown>;
    const tag = String(r.tag_name ?? "");
    if (parseVersion(tag)) {
      return {
        version: tag.replace(/^[vV]/, ""),
        tag,
        name: String(r.name || tag),
        url: typeof r.html_url === "string" && r.html_url.startsWith("https://github.com/") ? r.html_url : RELEASES_PAGE,
        notes: String(r.body ?? "").slice(0, NOTES_MAX_CHARS),
        published_at: typeof r.published_at === "string" ? r.published_at : null,
        assets: (Array.isArray(r.assets) ? (r.assets as Record<string, unknown>[]) : [])
          .filter((a) => typeof a.browser_download_url === "string" && a.browser_download_url.startsWith("https://github.com/"))
          .map((a) => ({ name: String(a.name ?? ""), url: String(a.browser_download_url), size: Number(a.size) || 0 })),
      };
    }
  }
  if (rel.status !== 404 && rel.status !== 200) throw new Error(`GitHub API ${rel.status}`);

  const tags = await getJson(`${API_BASE}/tags?per_page=50`);
  if (tags.status !== 200 || !Array.isArray(tags.json)) {
    if (tags.status === 404) return null; // 儲存庫不存在或尚無任何 tag：視為「沒有新版」
    throw new Error(`GitHub API ${tags.status}`);
  }
  let best: { tag: string; v: number[] } | null = null;
  for (const t of tags.json as { name?: string }[]) {
    const v = t.name ? parseVersion(t.name) : null;
    if (v && (!best || compareVersions(v, best.v) > 0)) best = { tag: String(t.name), v };
  }
  if (!best) return null;
  return {
    version: best.tag.replace(/^[vV]/, ""),
    tag: best.tag,
    name: best.tag,
    url: RELEASES_PAGE,
    notes: "",
    published_at: null,
  };
}

let inFlight: Promise<UpdateStatus> | null = null;

/** 執行一次檢查。`force`＝老師按「立即檢查」（不受 12 小時限制，但最短間隔 30 秒）。 */
export function runUpdateCheck(opts: { force?: boolean } = {}): Promise<UpdateStatus> {
  if (inFlight) return inFlight;
  inFlight = (async () => {
    try {
      const status = await getUpdateStatus();
      if (!status.enabled || !status.current_version) return status;

      const sinceLast = status.checked_at ? Date.now() - new Date(status.checked_at).getTime() : Infinity;
      const needed = opts.force
        ? MANUAL_MIN_INTERVAL_MS
        : status.last_ok === false
          ? AUTO_INTERVAL_FAIL_MS
          : AUTO_INTERVAL_OK_MS;
      if (sinceLast < needed) return status;

      await setSetting(KEY.attemptAt, String(Date.now()));
      try {
        const latest = await fetchLatestRelease();
        await setSetting(KEY.latest, latest ? JSON.stringify(latest) : "");
        await setSetting(KEY.ok, "1");
      } catch (err) {
        await setSetting(KEY.ok, "0");
        console.warn("[update-check] 無法取得最新版本資訊：", (err as Error).message);
      }
      return await getUpdateStatus();
    } finally {
      inFlight = null;
    }
  })();
  return inFlight;
}

export async function setUpdateCheckEnabled(enabled: boolean): Promise<UpdateStatus> {
  await setSetting(KEY.enabled, enabled ? "1" : "0");
  return getUpdateStatus();
}

export async function dismissVersion(version: string): Promise<UpdateStatus> {
  await setSetting(KEY.dismissed, String(version).slice(0, 40));
  return getUpdateStatus();
}

/** 啟動後延遲查一次，之後每小時檢查是否到了該查的時間（實際間隔由 runUpdateCheck 控制）。 */
export function startUpdateChecker(): void {
  if (!getCurrentVersion() || envDisabled()) return;
  setTimeout(() => void runUpdateCheck(), 20 * 1000).unref();
  setInterval(() => void runUpdateCheck(), 60 * 60 * 1000).unref();
}
