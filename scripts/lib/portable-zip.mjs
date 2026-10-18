// 可攜版封裝後的「只留壓縮檔」處理：把 release/<資料夾>/ 壓成 zip，並（預設）刪掉原資料夾。
//
// 為什麼只留 zip：資料夾裡的伺服器執行檔約 140 MB，超過 GitHub 單一檔案 100 MB 的上限，也不適合
// 進版控；壓縮後約 90 MB。發佈（GitHub Release）與使用者下載、更新時也只需要這一個檔案。
//
// zip 一律排除 bin/（使用者的資料庫、照片、上傳檔），並附上 HOW-TO-UPDATE.txt。
// 檔名需符合 src/updateCheck.ts 的 pickDownload()：
//   Windows 可攜版  MyClassV<版本>-win-portable.zip
//   macOS 可攜版    MyClassV<版本>-Mac[-arm64|-x64].zip
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

// zip 內 HOW-TO-UPDATE.txt 的內容來源：專案根目錄的「初始密碼與更新文件.txt」（直接編輯那個檔案即可，
// 下次封裝就會帶入）。找不到或是空檔案時，才使用下面這份內建的更新說明。
const NOTE_FILE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "初始密碼與更新文件.txt");

const HOWTO = `MyClass 更新方式
================

1. 先關閉 MyClass：在右下角 MyClass 圖示按右鍵 →「結束 MyClass」（舊版沒有圖示的話，關掉黑色的執行視窗）。
2. 把你「舊版資料夾」裡的 bin 資料夾，整個複製到這個新資料夾裡（和 MyClass.exe 放在同一層）。
   bin 裡面是你所有的班級、學生、成績與上傳檔案，一定要複製過來。
3. 點兩下這個資料夾裡的 MyClass.exe。第一次啟動時，系統會先自動備份資料庫。
4. 確認班級資料都在之後，再把舊版資料夾刪除。

注意：MyClass.exe 和 system 資料夾要放在一起，不能只搬其中一個。
`;

const HOWTO_MAC = `MyClass 使用與更新方式（macOS）
==============================

初始密碼
--------
1. 初始密碼為 Admin + 當天月日 4 個數字，例如 2026/10/15，密碼為 Admin1015。
2. 登入後須變更前綴英文，變更後以新的前綴 + 當天月日 4 個數字為密碼。
3. 首頁的忘記密碼只有在執行程式的電腦才可以使用，可以還原成初始密碼。

開啟方式
--------
解壓縮後，點兩下資料夾裡的 MyClass（MyClass.app）。MyClass 會在背景執行，
螢幕右上角的選單列會出現 MyClass 圖示：
- 按一下圖示：開啟 MyClass、複製學生連線網址、開啟檔案資料夾、「登入時自動啟動」、「結束 MyClass」

第一次開啟若出現「無法打開，因為無法驗證開發者」：
- 在 MyClass 上按右鍵 →「打開」→ 再按一次「打開」；或
- 打開「終端機」，輸入 xattr -dr com.apple.quarantine 再加一個空格，把整個 MyClass 資料夾拖進視窗，按 Enter。
第一次執行時若 macOS 詢問是否允許接受連入網路連線，請按「允許」，學生的平板才連得進來。

更新方式
--------
1. 先關閉 MyClass：按選單列的 MyClass 圖示 →「結束 MyClass」。
2. 把你「舊版資料夾」裡的 bin 資料夾，整個複製到這個新資料夾裡（和 MyClass.app 放在同一層）。
   bin 裡面是你所有的班級、學生、成績與上傳檔案，一定要複製過來。
3. 點兩下這個資料夾裡的 MyClass。第一次啟動時，系統會先自動備份資料庫；
   有設定登入時自動啟動的話，也會自動改成這個新資料夾。
4. 確認班級資料都在之後，再把舊版資料夾刪除。

注意：MyClass.app 和 system 資料夾要放在一起，不能只搬其中一個。
`;

/** 讀取要放進 zip 的說明文字；回傳 { text, source }。統一成 CRLF，舊版記事本才能正確換行。 */
function readHowTo(folderName) {
  if (/-Mac/i.test(folderName)) return { text: HOWTO_MAC.replace(/\r?\n/g, "\r\n"), source: "（內建 macOS 說明）" };
  try {
    const raw = fs.readFileSync(NOTE_FILE, "utf-8").replace(/^﻿/, "");
    if (raw.trim()) return { text: raw.replace(/\r?\n/g, "\r\n"), source: path.basename(NOTE_FILE) };
  } catch {
    /* 沒有該檔案：用內建說明 */
  }
  return { text: HOWTO.replace(/\r?\n/g, "\r\n"), source: "（內建預設說明）" };
}

/** Windows 上明確指定 System32\tar.exe（bsdtar）：從 Git Bash 執行時 PATH 裡的 tar 是 GNU tar，不能輸出 zip。 */
function tarExe() {
  return process.platform === "win32" ? path.join(process.env.SystemRoot || "C:\\Windows", "System32", "tar.exe") : "tar";
}

/** 依資料夾名稱決定 zip 檔名。 */
export function zipNameFor(folderName) {
  return /-Mac/i.test(folderName) ? `${folderName}.zip` : `${folderName}-win-portable.zip`;
}

/** 把 releaseDir/folderName 壓成 zip（不含 bin）。回傳 zip 的完整路徑。 */
export function zipPortableFolder(releaseDir, folderName) {
  const dir = path.join(releaseDir, folderName);
  if (!fs.existsSync(dir)) throw new Error(`找不到資料夾：${dir}`);

  // 檔名用英文、內容加 UTF-8 BOM：舊版 Windows 的解壓縮與記事本才不會把中文弄成亂碼
  const howTo = readHowTo(folderName);
  fs.writeFileSync(path.join(dir, "HOW-TO-UPDATE.txt"), "\uFEFF" + howTo.text, "utf-8");
  console.log(`[portable-zip] HOW-TO-UPDATE.txt \u5167\u5BB9\u4F86\u6E90\uFF1A${howTo.source}`);

  const zipPath = path.join(releaseDir, zipNameFor(folderName));
  fs.rmSync(zipPath, { force: true });
  // macOS 的 tar 預設會把擴充屬性存成 ._ 檔；加 --no-mac-metadata 避免解壓縮後出現多餘檔案
  const macFlags = process.platform === "darwin" ? ["--no-mac-metadata"] : [];
  execFileSync(tarExe(), ["-a", "-c", ...macFlags, "-f", zipPath, `--exclude=${folderName}/bin`, "-C", releaseDir, folderName], {
    stdio: "inherit",
  });
  return zipPath;
}

/** 壓縮並刪除原資料夾；回傳 zip 路徑與大小（MB）。 */
export function zipAndRemove(releaseDir, folderName) {
  const zipPath = zipPortableFolder(releaseDir, folderName);
  fs.rmSync(path.join(releaseDir, folderName), { recursive: true, force: true });
  const mb = fs.statSync(zipPath).size / 1048576;
  return { zipPath, mb };
}
