#!/usr/bin/env node
// Builds a portable release folder: `npm run build`, pkg the CommonJS bundle
// into a single exe, then copy static/ and the Prisma query engine into a
// system/ folder next to it as plain files (not embedded in pkg's snapshot —
// see src/paths.ts:getPackagedPrismaEngineLibraryPath for why). `bin/` is
// deliberately NOT created here; the app creates it next to the exe on first
// run (src/paths.ts:getBinDir).
// 伺服器執行檔放在 system/ 裡；Windows 另外編譯托盤程式 MyClass.exe（tools/tray/MyClassTray.cs）放在
// 資料夾最上層，是老師唯一要點的程式：伺服器在背景執行、右下角顯示圖示，並可設定開機自動啟動。
// （v4.3.0 起不再提供安裝版，托盤併入可攜版。）
import { zipAndRemove } from "./lib/portable-zip.mjs";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
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
// MyClass.exe（見下方），mac 是 .command 啟動檔。src/paths.ts:getExeDir() 遇到上一層名為
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
  // A bare Mach-O binary has no registered LaunchServices handler, so
  // double-clicking it in Finder fails silently ("no application knows how
  // to open this file" — kLSApplicationNotFoundErr). A `.command` file *is*
  // a recognized document type: Finder opens it in Terminal.app and Terminal
  // executes it directly, side-stepping the missing-handler problem. It's
  // the only thing left at the top level — the real binary lives in system/.
  const commandScript = `#!/bin/bash\ncd "$(dirname "$0")"\n# 自動清除下載或傳輸時可能附加的隔離屬性\nxattr -d com.apple.quarantine ./system/"${exeName}" 2>/dev/null || true\n./system/"${exeName}"\n`;

  const commandName = `${exeName}.command`;
  const commandPath = path.join(outDir, commandName);
  fs.writeFileSync(commandPath, commandScript, { mode: 0o755 });
  fs.chmodSync(commandPath, 0o755);

  const friendlyCommand = path.join(outDir, "啟動課堂系統.command");
  fs.writeFileSync(friendlyCommand, commandScript, { mode: 0o755 });
  fs.chmodSync(friendlyCommand, 0o755);

  // Best-effort ad-hoc codesign so the raw binary at least has a valid local
  // signature. This does NOT satisfy Gatekeeper on another Mac (that needs a
  // paid Developer ID + notarization) — teachers copying this to a different
  // machine will still need to right-click > Open the first time, or run
  // `xattr -d com.apple.quarantine <file>`, to clear the quarantine flag
  // that Finder/AirDrop/Zip attaches on transfer.
  try {
    execFileSync("codesign", ["--force", "--sign", "-", exePath], { stdio: "ignore" });
  } catch {
    /* codesign not available or failed — non-fatal, see note above */
  }

  console.log(`[build-exe] Top level now has ${commandName} and 啟動課堂系統.command — the exe moved into system/.`);
  console.log(
    "[build-exe] NOTE: this build is unsigned (ad-hoc only). On first launch on any Mac " +
      "(including this one, once the files are zipped/AirDropped/downloaded), Gatekeeper " +
      "may refuse to open it. Right-click the .command file (or the exe) and choose \"Open\" " +
      "once to allow it, or run: xattr -dr com.apple.quarantine \"" + outDir + "\""
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

