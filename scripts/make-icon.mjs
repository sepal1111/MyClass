// 由 assets/logo.svg 產生 Windows 圖示 assets/myclass.ico（16–256px 多尺寸、透明背景）。
// 需要本機安裝 Chrome / Edge（以無頭模式轉出 PNG）；產生後的 .ico 已納入版本控制，
// 平常封裝不需要重新執行，只有更換 logo.svg 時才需要：  node scripts/make-icon.mjs
import fs from "fs";
import os from "os";
import path from "path";
import { execFileSync } from "child_process";
import { fileURLToPath } from "url";

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const svgPath = path.join(rootDir, "assets", "logo.svg");
const icoPath = path.join(rootDir, "assets", "myclass.ico");
const SIZES = [16, 24, 32, 48, 64, 128, 256];

const browser = [
  process.env.CHROME_PATH,
  "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
  "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe",
  "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
  "C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe",
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
].find((p) => p && fs.existsSync(p));
if (!browser) throw new Error("找不到 Chrome / Edge，請安裝或設定環境變數 CHROME_PATH。");
if (!fs.existsSync(svgPath)) throw new Error(`找不到 ${svgPath}`);

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "myclass-icon-"));
const svgData = `data:image/svg+xml;base64,${fs.readFileSync(svgPath).toString("base64")}`;
const pngs = SIZES.map((size) => {
  const html = path.join(tmp, `i${size}.html`);
  const out = path.join(tmp, `i${size}.png`);
  fs.writeFileSync(
    html,
    `<!doctype html><meta charset="utf-8"><style>html,body{margin:0;background:transparent}img{display:block;width:${size}px;height:${size}px}</style><img src="${svgData}">`
  );
  execFileSync(browser, [
    "--headless=new", "--disable-gpu", "--hide-scrollbars", "--default-background-color=00000000",
    `--user-data-dir=${path.join(tmp, "profile")}`, `--window-size=${size},${size}`, `--screenshot=${out}`,
    `file:///${html.replace(/\\/g, "/")}`,
  ], { stdio: "ignore" });
  return fs.readFileSync(out);
});

// ICO：檔頭 + 目錄 + PNG 資料（Vista 以後皆支援 PNG 格式）
const header = Buffer.alloc(6 + 16 * SIZES.length);
header.writeUInt16LE(1, 2);
header.writeUInt16LE(SIZES.length, 4);
let offset = header.length;
SIZES.forEach((size, i) => {
  const at = 6 + 16 * i;
  header[at] = size === 256 ? 0 : size;
  header[at + 1] = size === 256 ? 0 : size;
  header.writeUInt16LE(1, at + 4);
  header.writeUInt16LE(32, at + 6);
  header.writeUInt32LE(pngs[i].length, at + 8);
  header.writeUInt32LE(offset, at + 12);
  offset += pngs[i].length;
});
fs.writeFileSync(icoPath, Buffer.concat([header, ...pngs]));
fs.rmSync(tmp, { recursive: true, force: true });
console.log(`已產生 ${path.relative(rootDir, icoPath)}（${SIZES.join("/")}px）`);
