#!/usr/bin/env node
// 產生 Windows「安裝版」：
//   1. 呼叫 build-exe.mjs 建置可攜版資料夾（伺服器 exe + system\）。除非加 --skip-server 沿用現有的。
//   2. 用 Windows 內建的 .NET Framework 編譯器（csc.exe）編譯托盤程式 MyClass.exe。
//   3. 把兩者放進暫存資料夾，交給 Inno Setup（ISCC.exe）產生 MyClassSetupV<版本>.exe。
// 可攜版不受影響：release\MyClassV<版本>\ 仍是原本的資料夾。
import { unzipPortable, zipAndRemove } from "./lib/portable-zip.mjs";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const releaseDir = path.join(rootDir, "release");
const skipServer = process.argv.includes("--skip-server");

if (process.platform !== "win32") {
  console.error("安裝版只支援 Windows。");
  process.exit(1);
}

function findFirst(candidates) {
  return candidates.find((p) => p && fs.existsSync(p));
}

// ---- 1. 伺服器（可攜版資料夾） ----
if (!skipServer) {
  console.log("[1/4] 建置伺服器與可攜版資料夾（build-exe.mjs win）");
  // --keep-folder：安裝程式需要這個資料夾；等安裝程式產生完，才由本腳本把它壓縮並刪除
  execFileSync(process.execPath, [path.join(rootDir, "scripts", "build-exe.mjs"), "win", "--keep-folder"], {
    cwd: rootDir,
    stdio: "inherit",
  });
} else {
  console.log("[1/4] 略過伺服器建置（--skip-server），沿用 release\\ 內最新的可攜版");
}

// 現在封裝只留 zip：--skip-server 且資料夾不存在時，先把最新的可攜版 zip 解開
const hasPortableFolder = () =>
  fs.readdirSync(releaseDir, { withFileTypes: true }).some((d) => {
    if (!d.isDirectory() || !/^MyClassV/.test(d.name) || /-Mac/i.test(d.name)) return false;
    try {
      return fs.readdirSync(path.join(releaseDir, d.name)).some((f) => /^MyClassV.*\.exe$/i.test(f));
    } catch {
      return false;
    }
  });
if (skipServer && !hasPortableFolder()) {
  const zips = fs
    .readdirSync(releaseDir)
    .filter((f) => /^MyClassV.*-win-portable\.zip$/i.test(f))
    .map((f) => ({ f, t: fs.statSync(path.join(releaseDir, f)).mtimeMs }))
    .sort((a, b) => b.t - a.t);
  if (zips.length === 0) throw new Error("找不到可攜版資料夾或 zip，請先執行 build-win.bat 封裝，或不要加 --skip-server。");
  console.log(`      解開 ${zips[0].f} 以取得安裝內容`);
  unzipPortable(path.join(releaseDir, zips[0].f), releaseDir);
}

const portableDirs = fs
  .readdirSync(releaseDir, { withFileTypes: true })
  .filter((d) => {
    if (!d.isDirectory() || !/^MyClass/.test(d.name)) return false;
    try {
      return fs.readdirSync(path.join(releaseDir, d.name)).some((f) => /^MyClassV.*\.exe$/i.test(f));
    } catch {
      return false;
    }
  })
  .map((d) => ({ name: d.name, full: path.join(releaseDir, d.name), mtime: fs.statSync(path.join(releaseDir, d.name)).mtimeMs }))
  .sort((a, b) => b.mtime - a.mtime);
if (portableDirs.length === 0) throw new Error("找不到 release\\MyClass* 資料夾，請先建置可攜版。");
const portable = portableDirs[0];
const serverExe = fs.readdirSync(portable.full).find((f) => /^MyClassV.*\.exe$/i.test(f));
if (!serverExe) throw new Error(`${portable.full} 內找不到 MyClassV*.exe`);
const version = (serverExe.match(/^MyClassV(.+)\.exe$/i) || [, "0.0.0"])[1];
console.log(`      使用 ${portable.name}（伺服器 ${serverExe}，版本 ${version}）`);

// ---- 2. 托盤程式 ----
console.log("[2/4] 編譯托盤程式 MyClass.exe（csc.exe）");
const csc = findFirst([
  path.join(process.env.WINDIR || "C:\\Windows", "Microsoft.NET", "Framework64", "v4.0.30319", "csc.exe"),
  path.join(process.env.WINDIR || "C:\\Windows", "Microsoft.NET", "Framework", "v4.0.30319", "csc.exe"),
]);
if (!csc) throw new Error("找不到 .NET Framework 4 的 csc.exe（Windows 內建，通常位於 C:\\Windows\\Microsoft.NET\\Framework64\\v4.0.30319\\）。");

const staging = path.join(releaseDir, "_installer_staging");
fs.rmSync(staging, { recursive: true, force: true });
fs.mkdirSync(staging, { recursive: true });

const trayExe = path.join(staging, "MyClass.exe");
execFileSync(
  csc,
  [
    "/nologo", "/target:winexe", `/out:${trayExe}`,
    `/win32icon:${path.join(rootDir, "assets", "myclass.ico")}`,
    "/r:System.Windows.Forms.dll", "/r:System.Drawing.dll", "/r:System.dll", "/r:System.Core.dll",
    path.join(rootDir, "tools", "tray", "MyClassTray.cs"),
  ],
  { cwd: rootDir, stdio: "inherit" }
);

// ---- 3. 備妥安裝內容 ----
console.log("[3/4] 備妥安裝內容（不含 bin\\，避免把開發資料包進安裝檔）");
for (const entry of fs.readdirSync(portable.full, { withFileTypes: true })) {
  if (entry.name === "bin") continue;
  fs.cpSync(path.join(portable.full, entry.name), path.join(staging, entry.name), { recursive: true });
}

// ---- 4. Inno Setup ----
console.log("[4/4] 產生安裝程式（Inno Setup）");
const iscc = findFirst([
  process.env.ISCC_PATH,
  path.join(process.env["ProgramFiles(x86)"] || "C:\\Program Files (x86)", "Inno Setup 6", "ISCC.exe"),
  path.join(process.env.ProgramFiles || "C:\\Program Files", "Inno Setup 6", "ISCC.exe"),
  path.join(process.env.LOCALAPPDATA || path.join(os.homedir(), "AppData", "Local"), "Programs", "Inno Setup 6", "ISCC.exe"),
]);
if (!iscc) {
  throw new Error("找不到 Inno Setup 6（ISCC.exe）。請先安裝 https://jrsoftware.org/isdl.php ，或設定環境變數 ISCC_PATH 指向 ISCC.exe。");
}
execFileSync(
  iscc,
  [
    `/DAppVersion=${version}`, `/DServerExe=${serverExe}`, `/DSourceDir=${staging}`, `/DOutputDir=${releaseDir}`,
    path.join(rootDir, "installer", "MyClass.iss"),
  ],
  { cwd: rootDir, stdio: "inherit" }
);

fs.rmSync(staging, { recursive: true, force: true });

// 安裝程式已產生：把可攜版資料夾壓成 zip 並刪除，release\ 只留 zip 與安裝程式
const { zipPath, mb } = zipAndRemove(releaseDir, portable.name);
console.log(`\n[build-installer] 完成：`);
console.log(`  安裝版：${path.join(releaseDir, `MyClassSetupV${version}.exe`)}`);
console.log(`  可攜版：${zipPath}（${mb.toFixed(1)} MB，原資料夾已刪除）`);
