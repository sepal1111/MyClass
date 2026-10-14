// Portable deployment model: the server binary lives on a USB drive / in a folder
// together with a `static/` asset folder and (at runtime) a `bin/` subfolder that
// holds the SQLite db file and all uploads. Everything must resolve relative to
// where the executable/script actually is, not the process's cwd.
import fs from "fs";
import path from "path";

/** True when running inside a `pkg`-built single-file executable. */
function isPackaged(): boolean {
  return Boolean((process as unknown as { pkg?: unknown }).pkg);
}

/** Absolute directory containing the running executable (or, in dev, the repo's server/ dir).
 *
 *  On Windows the exe sits directly in the release folder, so its own directory
 *  *is* the app root. On mac the exe is placed inside `system/` instead (so the
 *  release folder's top level only shows the `.command` launcher — see
 *  scripts/build-exe.mjs), so when the exe's immediate parent is named `system`,
 *  the app root is one level further up. */
export function getExeDir(): string {
  if (isPackaged()) {
    const dir = path.dirname(process.execPath);
    return path.basename(dir) === "system" ? path.dirname(dir) : dir;
  }
  // Dev / `node dist/index.js`: use the project root (one level above dist/ or src/).
  return path.resolve(__dirname, "..");
}

/** Path to bin/ subfolder inside the executable directory, created if needed. */
export function getBinDir(): string {
  const binPath = path.join(getExeDir(), "bin");
  fs.mkdirSync(binPath, { recursive: true });
  return binPath;
}

/** Migrates any legacy root-level db/photo/uploads folders into bin/, matching the
 *  one-time migration the Python version performed when it introduced bin/. */
function migrateOldRootFiles(): void {
  const exeDir = getExeDir();
  const binDir = getBinDir();

  const oldDb = path.join(exeDir, "classroom_record.db");
  const newDb = path.join(binDir, "classroom_record.db");
  if (fs.existsSync(oldDb) && !fs.existsSync(newDb)) {
    try {
      fs.renameSync(oldDb, newDb);
    } catch {
      /* best-effort */
    }
  }

  for (const folder of ["photo", "uploads"]) {
    const oldDir = path.join(exeDir, folder);
    const newDir = path.join(binDir, folder);
    if (fs.existsSync(oldDir) && oldDir !== newDir) {
      fs.mkdirSync(newDir, { recursive: true });
      try {
        moveDirContentsRecursive(oldDir, newDir);
      } catch {
        /* best-effort */
      }
    }
  }
}

function moveDirContentsRecursive(srcDir: string, destDir: string): void {
  for (const entry of fs.readdirSync(srcDir, { withFileTypes: true })) {
    const src = path.join(srcDir, entry.name);
    const dest = path.join(destDir, entry.name);
    if (entry.isDirectory()) {
      fs.mkdirSync(dest, { recursive: true });
      moveDirContentsRecursive(src, dest);
    } else if (!fs.existsSync(dest)) {
      fs.renameSync(src, dest);
    }
  }
}

/** Resolves the SQLite database file path (env override wins, else bin/classroom_record.db). */
export function getDbPath(): string {
  if (process.env.CLASSROOM_DB_PATH) {
    return process.env.CLASSROOM_DB_PATH;
  }
  migrateOldRootFiles();
  return path.join(getBinDir(), "classroom_record.db");
}

/** Bundle root: where the shipped `static/` folder lives (source checkout, or
 *  in `system/` next to the packaged exe — see scripts/build-exe.mjs). */
export function getBundleDir(): string {
  if (isPackaged()) {
    return path.join(getExeDir(), "system");
  }
  return path.resolve(__dirname, "..");
}

export function getUploadsDir(): string {
  const dir = path.join(getBinDir(), "uploads");
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

/** Path to Prisma's native query engine file shipped in `system/engine/` next
 *  to a packaged exe (see scripts/build-exe.mjs), or `null` in dev where
 *  Prisma resolves its own engine from node_modules/.prisma/client as usual.
 *
 *  pkg's virtual snapshot filesystem isn't visible to real OS calls like the
 *  dlopen used to load this native .node file, so the engine can't live
 *  inside the packaged snapshot — it must ship as a plain file beside the
 *  exe, and PRISMA_QUERY_ENGINE_LIBRARY (set from this) tells Prisma to load
 *  it from there instead of its normal snapshot-relative lookup. */
export function getPackagedPrismaEngineLibraryPath(): string | null {
  if (!isPackaged()) return null;
  const engineDir = path.join(getExeDir(), "system", "engine");
  if (!fs.existsSync(engineDir)) return null;
  const engineFile = fs.readdirSync(engineDir).find((name) => name.endsWith(".node"));
  return engineFile ? path.join(engineDir, engineFile) : null;
}
