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

const HOWTO = `MyClass 更新方式
================

1. 先關閉 MyClass（關掉黑色的執行視窗）。
2. 把你「舊版資料夾」裡的 bin 資料夾，整個複製到這個新資料夾裡（和 MyClass 執行檔放在同一層）。
   bin 裡面是你所有的班級、學生、成績與上傳檔案，一定要複製過來。
3. 開啟這個資料夾裡的 MyClass 執行檔。第一次啟動時，系統會先自動備份資料庫。
4. 確認班級資料都在之後，再把舊版資料夾刪除。

注意：執行檔和 system 資料夾要放在一起，不能只搬其中一個。
`;

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
  fs.writeFileSync(path.join(dir, "HOW-TO-UPDATE.txt"), "\uFEFF" + HOWTO, "utf-8");

  const zipPath = path.join(releaseDir, zipNameFor(folderName));
  fs.rmSync(zipPath, { force: true });
  execFileSync(tarExe(), ["-a", "-c", "-f", zipPath, `--exclude=${folderName}/bin`, "-C", releaseDir, folderName], {
    stdio: "inherit",
  });
  return zipPath;
}

/** 把 zip 解開到 releaseDir（會得到原本的可攜版資料夾）。用於 --skip-server 沿用既有封裝。 */
export function unzipPortable(zipPath, releaseDir) {
  execFileSync(tarExe(), ["-x", "-f", zipPath, "-C", releaseDir], { stdio: "inherit" });
}

/** 壓縮並刪除原資料夾；回傳 zip 路徑與大小（MB）。 */
export function zipAndRemove(releaseDir, folderName) {
  const zipPath = zipPortableFolder(releaseDir, folderName);
  fs.rmSync(path.join(releaseDir, folderName), { recursive: true, force: true });
  const mb = fs.statSync(zipPath).size / 1048576;
  return { zipPath, mb };
}
