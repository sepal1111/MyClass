// 升級前自動備份資料庫。
//
// 每次啟動都會在資料庫遷移（initSchema）之前呼叫 backupBeforeUpgrade()：
//  - 程式有更新（版本標記和上次備份時不同）才備份，一般重新啟動不會產生備份。
//  - 備份存放在 bin/backups/，檔名含版本與時間；只保留最近 10 份自動備份。
//  - 備份失敗不會阻擋啟動（避免因為備份問題讓老師完全無法使用），但會留下警告。
// 只備份資料庫（班級、學生、成績、紀錄等）；學生上傳的檔案與照片很大，且升級不會更動它們，不在備份範圍。
import fs from "fs";
import path from "path";
import { prisma } from "./db";
import { getBinDir, getDbPath } from "./paths";

const KEEP = 10;
const PREFIX = "classroom_record_before_";

function backupDir(): string {
  const dir = path.join(getBinDir(), "backups");
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

/** 目前程式的版本標記：打包版用「執行檔名稱＋大小」（任何重新建置都會改變），開發模式用 db.ts 的修改時間。 */
export function currentVersionToken(): string {
  try {
    if ((process as unknown as { pkg?: unknown }).pkg) {
      const st = fs.statSync(process.execPath);
      return `${path.basename(process.execPath)}-${st.size}`;
    }
    return `dev-${Math.floor(fs.statSync(path.join(__dirname, "db.ts")).mtimeMs)}`;
  } catch {
    return "unknown";
  }
}

function stamp(): string {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}_${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
}

function safeName(s: string): string {
  return s.replace(/[^A-Za-z0-9._-]+/g, "_").slice(0, 60);
}

function pruneOld(dir: string): void {
  const files = fs
    .readdirSync(dir)
    .filter((f) => f.startsWith(PREFIX) && f.endsWith(".db"))
    .map((f) => ({ f, t: fs.statSync(path.join(dir, f)).mtimeMs }))
    .sort((a, b) => b.t - a.t);
  for (const old of files.slice(KEEP)) {
    try {
      fs.unlinkSync(path.join(dir, old.f));
    } catch {
      /* best-effort */
    }
  }
}

export async function backupBeforeUpgrade(): Promise<void> {
  const token = currentVersionToken();
  const dir = backupDir();
  const markerPath = path.join(dir, ".last_version");
  const dbPath = getDbPath();

  // 全新安裝（還沒有資料庫）：沒有東西可備份，只記下目前版本
  const hasDb = fs.existsSync(dbPath) && fs.statSync(dbPath).size > 0;
  let last = "";
  try {
    last = fs.readFileSync(markerPath, "utf-8").trim();
  } catch {
    /* 沒有標記檔 */
  }
  if (!hasDb) {
    fs.writeFileSync(markerPath, token, "utf-8");
    return;
  }
  if (last === token) return; // 程式沒有更新，不需要備份

  const target = path.join(dir, `${PREFIX}${safeName(token)}_${stamp()}.db`);
  try {
    // VACUUM INTO 會產生一份完整、一致的單檔備份（包含還在 WAL 內尚未寫回的資料）
    await prisma.$executeRawUnsafe(`VACUUM INTO '${target.replace(/'/g, "''")}'`);
  } catch (err) {
    // 退而求其次：直接複製檔案（此時沒有其他程序在使用資料庫）
    try {
      fs.copyFileSync(dbPath, target);
      for (const ext of ["-wal", "-shm"]) {
        if (fs.existsSync(dbPath + ext)) fs.copyFileSync(dbPath + ext, target + ext);
      }
    } catch (err2) {
      console.warn(`[MyClass] ⚠ 升級前自動備份失敗，仍繼續啟動：${(err2 as Error).message}（原因：${(err as Error).message}）`);
      return; // 沒備份成功就不更新標記，下次啟動會再試一次
    }
  }
  fs.writeFileSync(markerPath, token, "utf-8");
  pruneOld(dir);
  console.log(`[MyClass] 已在升級前自動備份資料庫：${target}`);
}
