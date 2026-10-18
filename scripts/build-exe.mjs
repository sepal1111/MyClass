#!/usr/bin/env node
// Builds a portable release folder: `npm run build`, pkg the CommonJS bundle
// into a single exe, then copy static/ and the Prisma query engine into a
// system/ folder next to it as plain files (not embedded in pkg's snapshot —
// see src/paths.ts:getPackagedPrismaEngineLibraryPath for why). `bin/` is
// deliberately NOT created here; the app creates it next to the exe on first
// run (src/paths.ts:getBinDir).
// 伺服器執行檔放在 system/ 裡；Windows 另外編譯托盤程式 MyClass.exe（tools/tray/MyClassTray.cs）放在
// 資料夾最上層，是老師唯一要點的程式：伺服器在背景執行、右下角顯示圖示，並可設定開機自動啟動。
// macOS 對應的是 tools/tray-mac/MyClassTray.swift 編譯成的 MyClass.app（選單列圖示）。
// （v4.3.0 起不再提供安裝版，托盤併入可攜版。）
import { zipAndRemove } from "./lib/portable-zip.mjs";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

// On Windows, npm/npx are .cmd shims — execFileSync needs the explicit
// extension (or shell:true) to find them via PATH.
const npmCmd = process.platform === "win32" ? "npm.cmd" : "npm";
const npxCmd = process.platform === "win32" ? "npx.cmd" : "npx";

function getGitVersion(cwd) {
  const tryRun = (cmd, args) => {
    try {
      return execFileSync(cmd, args, { cwd, encoding: "utf8", stdio: ["pipe", "pipe", "ignore"] }).trim();
    } catch {
      return "";
    }
  };

  // 1. Tag pointing directly at HEAD
  let tag = tryRun("git", ["tag", "--points-at", "HEAD"]).split("\n")[0].trim();
  if (tag) {
    const match = tag.match(/[a-zA-Z0-9._-]+/);
    if (match) return match[0];
  }

  // 2. Latest commit message leading version (e.g. "V2.6.1.1", "V2.6 增加檔案上傳與管理模組")
  const msg = tryRun("git", ["log", "-1", "--pretty=%B"]);
  if (msg) {
    const norm = msg.replace(/[\uFF21-\uFF3A\uFF41-\uFF5A\uFF10-\uFF19]/g, (ch) =>
      String.fromCharCode(ch.charCodeAt(0) - 0xFEE0)
    );
    const match = norm.match(/^([a-zA-Z0-9._-]+)/);
    if (match) {
      const ver = match[1];
      // Automatically register the tag on HEAD if not already tagged
      tryRun("git", ["tag", ver]);
      return ver;
    }
  }

  // 3. Fallback to latest tag in repository
  tag = tryRun("git", ["describe", "--tags", "--abbrev=0"]).split("\n")[0].trim();
  if (!tag) tag = tryRun("git", ["tag", "--sort=-creatordate"]).split("\n")[0].trim();
  if (tag) {
    const match = tag.match(/[a-zA-Z0-9._-]+/);
    if (match) return match[0];
  }

  return "";
}

/** 從 .ico 取出內嵌的 PNG，轉成 macOS 的 .icns（用內建的 sips 與 iconutil）。失敗只警告，沿用預設圖示。 */
function makeIcns(icoPath, icnsPath) {
  try {
    const ico = fs.readFileSync(icoPath);
    let best = null;
    for (let i = 0; i < ico.readUInt16LE(4); i++) {
      const size = ico.readUInt32LE(6 + i * 16 + 8);
      const offset = ico.readUInt32LE(6 + i * 16 + 12);
      const data = ico.subarray(offset, offset + size);
      const isPng = data.subarray(1, 4).toString("latin1") === "PNG";
      const w = ico[6 + i * 16] || 256;
      if (isPng && (!best || w > best.w)) best = { w, data };
    }
    if (!best) throw new Error(".ico 內沒有 PNG 圖像");
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "myclass-icns-"));
    const src = path.join(tmp, "src.png");
    const iconset = path.join(tmp, "MyClass.iconset");
    fs.writeFileSync(src, best.data);
    fs.mkdirSync(iconset);
    for (const base of [16, 32, 128, 256]) {
      for (const scale of [1, 2]) {
        const px = base * scale;
        if (px > best.w) continue;
        execFileSync("sips", ["-z", String(px), String(px), src, "--out", path.join(iconset, `icon_${base}x${base}${scale === 2 ? "@2x" : ""}.png`)], { stdio: "ignore" });
      }
    }
    execFileSync("iconutil", ["-c", "icns", iconset, "-o", icnsPath], { stdio: "ignore" });
    fs.rmSync(tmp, { recursive: true, force: true });
  } catch (err) {
    console.warn(`[build-exe] 警告：無法產生 .icns 圖示，改用預設圖示（${err.message}）`);
  }
}

const gitVersion = getGitVersion(rootDir);
console.log(`[build-exe] Detected version tag: ${gitVersion || "none"}`);

const TARGETS = {
  win: {
    pkgTarget: "node22-win-x64",
    engineFile: "query_engine-windows.dll.node",
    engineGlob: "query_engine-windows.dll.node",
    baseName: "MyClass",
    folderSuffix: "",
    ext: ".exe",
  },
  mac: {
    pkgTarget: `node22-macos-${process.arch}`,
    engineFile: process.arch === "arm64" ? "libquery_engine-darwin-arm64.dylib.node" : "libquery_engine-darwin.dylib.node",
    engineGlob: "libquery_engine-darwin-*.node",
    baseName: "MyClass",
    folderSuffix: "-Mac",
    ext: "",
    isMac: true,
  },
  "mac-arm64": {
    pkgTarget: "node22-macos-arm64",
    engineFile: "libquery_engine-darwin-arm64.dylib.node",
    engineGlob: "libquery_engine-darwin-arm64.dylib.node",
    baseName: "MyClass",
    folderSuffix: "-Mac-arm64",
    ext: "",
    isMac: true,
  },
  "mac-x64": {
    pkgTarget: "node22-macos-x64",
    engineFile: "libquery_engine-darwin.dylib.node",
    engineGlob: "libquery_engine-darwin.dylib.node",
    baseName: "MyClass",
    folderSuffix: "-Mac-x64",
    ext: "",
    isMac: true,
  },
};
TARGETS["mac-smoketest"] = TARGETS.mac;

const which = process.argv[2];
if (!which || !TARGETS[which]) {
  console.error(`Usage: node scripts/build-exe.mjs <${Object.keys(TARGETS).join("|")}>`);
  process.exit(1);
}
const target = TARGETS[which];
const normVersion = gitVersion
  ? gitVersion.startsWith("V") || gitVersion.startsWith("v")
    ? `V${gitVersion.slice(1)}`
    : `V${gitVersion}`
  : "";
// 伺服器執行檔一律含「V」（MyClassV<版本>.exe），托盤程式才能靠檔名區分它與自己（MyClass.exe）
const exeName = `${target.baseName}${normVersion || "Vdev"}${target.ext}`;
const folderBase = `${target.baseName}${normVersion || "Vdev"}`;
const folderName = `${folderBase}${target.folderSuffix || ""}`;
const outDir = path.join(rootDir, "release", folderName);

console.log("[1/4] building project (npm run build)");
try {
  execFileSync(npmCmd, ["run", "build"], { cwd: rootDir, stdio: "inherit", shell: process.platform === "win32" });
} catch (buildErr) {
  const testEngineDir = path.join(rootDir, "node_modules", ".prisma", "client");
  const existingEngine = (target.engineFile && fs.existsSync(path.join(testEngineDir, target.engineFile)))
    || (fs.globSync(target.engineGlob, { cwd: testEngineDir }) || [])[0];
  if (existingEngine) {
    console.warn("\n[build-exe] 注意：prisma generate 因本機正運行 dev server 鎖定 DLL 而跳過，正在以現有 Prisma Client 進行 TypeScript 編譯...");
    execFileSync(npxCmd, ["tsc", "-p", "tsconfig.json"], { cwd: rootDir, stdio: "inherit", shell: process.platform === "win32" });
  } else {
    throw buildErr;
  }
}

console.log(`[2/4] locating Prisma engine (${target.engineFile || target.engineGlob})`);
const engineDir = path.join(rootDir, "node_modules", ".prisma", "client");
let engineFile = target.engineFile && fs.existsSync(path.join(engineDir, target.engineFile))
  ? target.engineFile
  : (fs.globSync(target.engineGlob, { cwd: engineDir }) || [])[0];
if (!engineFile) {
  throw new Error(
    `No Prisma engine matching "${target.engineFile || target.engineGlob}" found in ${engineDir}. ` +
      `Check the generator's "binaryTargets" in prisma/schema.prisma and re-run "npx prisma generate".`
  );
}

fs.rmSync(outDir, { recursive: true, force: true });
fs.mkdirSync(outDir, { recursive: true });
const systemDir = path.join(outDir, "system");
fs.mkdirSync(systemDir, { recursive: true });

// 伺服器執行檔一律放在 system/ 裡，資料夾最上層只留老師要點的入口：Windows 是托盤程式
// MyClass.exe（見下方），mac 是 MyClass.app（選單列程式）。src/paths.ts:getExeDir() 遇到上一層名為
// "system" 時會再往上一層，所以 bin/ 仍建在資料夾最上層。
const exeDir = systemDir;
const exePath = path.join(exeDir, exeName);

// Windows：把執行檔縮圖換成 assets/myclass.ico（由 assets/logo.svg 產生，見 scripts/make-icon.mjs）。
// 不能在 pkg 完成後才用 rcedit 修改——pkg 把程式附加在 exe 尾端，事後改資源會讓附加資料遺失、
// 程式無法啟動。因此先複製 pkg 使用的基底 node.exe、替換圖示，再以 PKG_NODE_PATH 指定給 pkg。
// 任何一步失敗只會警告，仍以預設圖示完成封裝。
async function prepareIconBase() {
  if (which !== "win") return null;
  const icon = path.join(rootDir, "assets", "myclass.ico");
  if (!fs.existsSync(icon)) return null;
  try {
    const fetchPkg = path.join(rootDir, "node_modules", "@yao-pkg", "pkg-fetch", "lib-es5", "index.js");
    const { need } = (await import(pathToFileURL(fetchPkg).href)).default;
    const base = await need({ nodeRange: "node22", platform: "win", arch: "x64" });
    const patched = path.join(rootDir, "dist", "node-base-icon.exe");
    fs.mkdirSync(path.dirname(patched), { recursive: true });
    fs.copyFileSync(base, patched);
    const { default: rcedit } = await import("rcedit");
    await rcedit(patched, { icon });
    console.log(`[build-exe] 已替換執行檔圖示：${path.relative(rootDir, icon)}`);
    return patched;
  } catch (err) {
    console.warn(`[build-exe] 警告：無法替換執行檔圖示，改用預設圖示（${err.message}）`);
    return null;
  }
}

const iconBase = await prepareIconBase();

console.log(`[3/4] pkg dist/index.js --targets ${target.pkgTarget} -> ${path.relative(outDir, exePath)}`);
execFileSync(
  npxCmd,
  ["@yao-pkg/pkg", "dist/index.js", "--targets", target.pkgTarget, "--output", exePath],
  {
    cwd: rootDir,
    stdio: "inherit",
    shell: process.platform === "win32",
    env: iconBase ? { ...process.env, PKG_NODE_PATH: iconBase } : process.env,
  }
);

console.log("[4/4] copying static/ and engine/ into system/");
fs.cpSync(path.join(rootDir, "static"), path.join(systemDir, "static"), { recursive: true });
fs.mkdirSync(path.join(systemDir, "engine"), { recursive: true });
// 執行期的「新版本偵測」（src/updateCheck.ts）靠這個檔案得知目前版本；沒有 git 標籤時不寫版本，功能自動停用。
fs.writeFileSync(
  path.join(systemDir, "version.json"),
  JSON.stringify({ version: normVersion ? normVersion.replace(/^V/, "") : null, tag: normVersion || null, built_at: new Date().toISOString() }, null, 2) + "\n"
);
fs.copyFileSync(path.join(engineDir, engineFile), path.join(systemDir, "engine", engineFile));

// 托盤程式：用 Windows 內建的 .NET Framework 4 編譯器（csc.exe），不需要另外安裝 SDK。
// 它是 Windows 版唯一放在最上層的入口（伺服器執行檔在 system/ 裡），編譯不出來就讓封裝失敗，
// 避免發出一個老師找不到程式可以點的資料夾。
if (which === "win") {
  console.log("[tray] compiling tray launcher MyClass.exe (csc.exe)");
  const windir = process.env.WINDIR || "C:\\Windows";
  const csc = [
    path.join(windir, "Microsoft.NET", "Framework64", "v4.0.30319", "csc.exe"),
    path.join(windir, "Microsoft.NET", "Framework", "v4.0.30319", "csc.exe"),
  ].find((p) => fs.existsSync(p));
  if (!csc) {
    throw new Error("找不到 .NET Framework 4 的 csc.exe（Windows 內建，通常位於 C:\\Windows\\Microsoft.NET\\Framework64\\v4.0.30319\\），無法編譯托盤程式 MyClass.exe。");
  }
  execFileSync(
    csc,
    [
      "/nologo", "/target:winexe", `/out:${path.join(outDir, "MyClass.exe")}`,
      `/win32icon:${path.join(rootDir, "assets", "myclass.ico")}`,
      "/r:System.Windows.Forms.dll", "/r:System.Drawing.dll", "/r:System.dll", "/r:System.Core.dll",
      path.join(rootDir, "tools", "tray", "MyClassTray.cs"),
    ],
    { cwd: rootDir, stdio: "inherit" }
  );
}

if (target.isMac) {
  // 選單列程式 MyClass.app（tools/tray-mac/MyClassTray.swift）是 mac 版唯一放在最上層的入口，
  // 對應 Windows 的 MyClass.exe：伺服器在背景執行、選單列顯示圖示，並可設定登入時自動啟動。
  // 以 macOS 內建的 swiftc 編譯（不需 Xcode）；圖示由 assets/myclass.ico 內的 PNG 轉成 .icns。
  // 編譯不出來就讓封裝失敗，避免發出一個老師找不到程式可以點的資料夾。
  console.log("[tray] compiling menu bar app MyClass.app (swiftc)");
  const appDir = path.join(outDir, "MyClass.app");
  const macosDir = path.join(appDir, "Contents", "MacOS");
  const resDir = path.join(appDir, "Contents", "Resources");
  fs.mkdirSync(macosDir, { recursive: true });
  fs.mkdirSync(resDir, { recursive: true });

  const swiftTarget = target.pkgTarget.endsWith("arm64") ? "arm64-apple-macos11" : "x86_64-apple-macos10.15";
  execFileSync(
    "swiftc",
    ["-O", "-target", swiftTarget, path.join(rootDir, "tools", "tray-mac", "MyClassTray.swift"), "-o", path.join(macosDir, "MyClass")],
    { cwd: rootDir, stdio: "inherit" }
  );

  makeIcns(path.join(rootDir, "assets", "myclass.ico"), path.join(resDir, "MyClass.icns"));

  fs.writeFileSync(
    path.join(appDir, "Contents", "Info.plist"),
    `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>CFBundleName</key><string>MyClass</string>
  <key>CFBundleDisplayName</key><string>MyClass</string>
  <key>CFBundleIdentifier</key><string>tw.myclass.tray</string>
  <key>CFBundleExecutable</key><string>MyClass</string>
  <key>CFBundleIconFile</key><string>MyClass</string>
  <key>CFBundlePackageType</key><string>APPL</string>
  <key>CFBundleShortVersionString</key><string>${normVersion ? normVersion.replace(/^V/, "") : "0"}</string>
  <key>CFBundleVersion</key><string>${normVersion ? normVersion.replace(/^V/, "") : "0"}</string>
  <key>LSMinimumSystemVersion</key><string>${swiftTarget.endsWith("macos11") ? "11.0" : "10.15"}</string>
  <key>LSUIElement</key><true/>
  <key>NSHighResolutionCapable</key><true/>
</dict>
</plist>
`
  );

  // Best-effort ad-hoc codesign（app 與伺服器執行檔）。這「不能」讓另一台 Mac 的 Gatekeeper 放行
  // （那需要付費的 Developer ID 與公證），從網路下載、AirDrop 或解壓縮後的第一次開啟，
  // 老師需在 MyClass 上按右鍵 >「打開」一次，或執行：xattr -dr com.apple.quarantine <資料夾>
  for (const p of [exePath, appDir]) {
    try {
      execFileSync("codesign", ["--force", "--sign", "-", p], { stdio: "ignore" });
    } catch {
      /* codesign not available or failed — non-fatal, see note above */
    }
  }

  console.log("[build-exe] Top level now has MyClass.app and system/ — the server binary lives in system/.");
  console.log(
    "[build-exe] NOTE: this build is unsigned (ad-hoc only). On first launch on another Mac, " +
      "right-click MyClass.app and choose \"Open\" once, or run: xattr -dr com.apple.quarantine \"" + outDir + "\""
  );
}

// 預設只留下壓縮檔：資料夾裡的執行檔約 140 MB（超過 GitHub 單檔 100 MB 上限），壓縮後約 90 MB。
// 加 --keep-folder（或環境變數 MYCLASS_KEEP_FOLDER=1）可保留資料夾，例如本機直接執行測試。
const keepFolder = process.argv.includes("--keep-folder") || process.env.MYCLASS_KEEP_FOLDER === "1";
if (keepFolder) {
  console.log(`\n[build-exe] Done! Package folder kept at: ${outDir}`);
  console.log(`[build-exe] Executable: ${exeName}`);
} else {
  const { zipPath, mb } = zipAndRemove(path.join(rootDir, "release"), folderName);
  console.log(`\n[build-exe] Done! 已壓縮為 ${path.relative(rootDir, zipPath)}（${mb.toFixed(1)} MB），原資料夾已刪除。`);
  console.log("[build-exe] 解壓縮後即可使用；zip 不含 bin（使用者資料）。要保留資料夾請加 --keep-folder。");
}

