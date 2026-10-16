// 彙整「發佈到 GitHub Release」要附上的檔案，並印出建立 Release 的步驟。
//
//   npm run package:release            # 自動挑 release/ 底下版本最大的
//   npm run package:release -- 4.1.1   # 指定版本
//
// 封裝（build-win.bat）完成後 release/ 只會留下壓縮檔（v4.3.0 起不再提供安裝版）：
//   MyClassV<版本>-win-portable.zip   可攜版 Windows（含托盤程式 MyClass.exe；不含 bin，即不含任何班級資料）
//   MyClassV<版本>-Mac*.zip           可攜版 macOS（若有封裝）
// 若你用 --keep-folder 留下了資料夾，這裡會先把資料夾壓成 zip（同樣排除 bin）。
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { zipPortableFolder } from "./lib/portable-zip.mjs";

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const releaseDir = path.join(rootDir, "release");

const parse = (v) => v.split(".").map(Number);
function cmp(a, b) {
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    const d = (a[i] ?? 0) - (b[i] ?? 0);
    if (d) return d;
  }
  return 0;
}

if (!fs.existsSync(releaseDir)) {
  console.error("找不到 release/ 資料夾，請先執行 build-win.bat 封裝。");
  process.exit(1);
}

const entries = fs.readdirSync(releaseDir, { withFileTypes: true });
const versionOf = (name) => name.match(/^MyClassV(\d+(?:\.\d+)*)/)?.[1] ?? null;
const versions = [...new Set(entries.map((e) => versionOf(e.name)).filter(Boolean))];
if (versions.length === 0) {
  console.error("release/ 底下沒有 MyClass 的封裝結果，請先封裝。");
  process.exit(1);
}
const wanted = process.argv[2]?.replace(/^[vV]/, "") ?? versions.sort((a, b) => cmp(parse(b), parse(a)))[0];
if (!versions.includes(wanted)) {
  console.error(`找不到版本 ${wanted} 的封裝結果。現有版本：${versions.join("、")}`);
  process.exit(1);
}

// 還留著資料夾（--keep-folder）就先壓縮，但不刪除原資料夾
for (const d of entries) {
  if (d.isDirectory() && versionOf(d.name) === wanted && /^MyClassV/.test(d.name)) {
    zipPortableFolder(releaseDir, d.name);
  }
}

const files = fs
  .readdirSync(releaseDir)
  .filter((f) => versionOf(f) === wanted && /\.zip$/i.test(f))
  .filter((f) => !fs.statSync(path.join(releaseDir, f)).isDirectory())
  .map((f) => path.join(releaseDir, f));

if (!files.some((f) => /-win-portable\.zip$/i.test(f))) console.warn("[package-release] 沒有可攜版 zip（先執行 build-win.bat）。");

console.log(`\n版本 v${wanted} 的發佈檔案：`);
for (const f of files) {
  const size = (fs.statSync(f).size / 1048576).toFixed(1);
  const sha = crypto.createHash("sha256").update(fs.readFileSync(f)).digest("hex").slice(0, 16);
  console.log(`  ${path.relative(rootDir, f)}  ${size} MB  sha256:${sha}…`);
}

const quoted = files.map((f) => `"${path.relative(rootDir, f)}"`).join(" ");
console.log(`
下一步（在 GitHub 建立 Release，使用者的更新提示才會出現）：
  1. git tag v${wanted} && git push origin v${wanted}
  2. 開啟 https://github.com/sepal1111/MyClass/releases/new ，選擇標籤 v${wanted}，填寫更新內容，
     把上面的檔案拖進「Attach binaries」，按 Publish release。
  或用 GitHub CLI：
  gh release create v${wanted} ${quoted} --title "MyClass v${wanted}" --notes "更新內容…"
`);
