// Port of app/main.py + run_server.py.
import fs from "fs";
import net from "net";
import path from "path";
import https from "https";
import { exec } from "child_process";
import express, { NextFunction, Request, Response } from "express";
import cookieParser from "cookie-parser";
import cors from "cors";
import QRCode from "qrcode";

import { initSchema, prisma } from "./db";
import { backupBeforeUpgrade } from "./backup";
import { getBinDir, getBundleDir, getUploadsDir } from "./paths";
import { isRequestAuthenticated, requireAuth } from "./middleware/auth";
import { getBearerToken, verifyStudentToken } from "./middleware/studentAuth";
import { setupRealtime } from "./realtime";
import { autoCatch } from "./asyncRoute";
import { getOrCreateHttpsOptions } from "./tls";
import { clearRuntimeInfo, findRunningInstance, newShutdownToken, readRuntimeInfo, registerShutdown, requestShutdown, writeRuntimeInfo } from "./runtime";
import { isLocalRequest } from "./middleware/localOnly";

import { systemRouter } from "./routes/system";
import { coursesRouter } from "./routes/courses";
import { attendanceRouter } from "./routes/attendance";
import { whereaboutsRouter, whereaboutsPublicRouter } from "./routes/whereabouts";
import { groupsRouter } from "./routes/groups";
import { seatingRouter } from "./routes/seating";
import { scoresRouter } from "./routes/scores";
import { notesRouter } from "./routes/notes";
import { journalRouter } from "./routes/journal";
import { reportsRouter } from "./routes/reports";
import { unitsRouter } from "./routes/units";
import { studentAuthRouter } from "./routes/studentAuth";
import { studentContentRouter } from "./routes/studentContent";
import { liveWallRouter } from "./routes/liveWall";
import { studentLiveWallRouter } from "./routes/studentLiveWall";
import { pointCardsRouter } from "./routes/pointCards";
import { studentPointCardsRouter } from "./routes/studentPointCards";
import { rewardsRouter } from "./routes/rewards";
import { studentRewardsRouter } from "./routes/studentRewards";
import { studentNotificationsRouter } from "./routes/studentNotifications";
import { startUpdateChecker } from "./updateCheck";
import { paperQuizzesRouter } from "./routes/paperQuizzes";
import { bulletinRouter } from "./routes/bulletin";
import { fileCollectionsRouter } from "./routes/fileCollections";
import { studentFileCollectionsRouter } from "./routes/studentFileCollections";
import { homeworkScanRouter } from "./routes/homeworkScan";
import { quizSetsRouter } from "./routes/quizSets";
import { wordCloudsRouter } from "./routes/wordClouds";
import { timetableRouter } from "./routes/timetable";
import { requireLocalOnly } from "./middleware/localOnly";

const APP_STARTUP_TIMESTAMP = String(Date.now());
const bundleDir = getBundleDir();
const staticDir = path.join(bundleDir, "static");
const binDir = getBinDir();
const uploadsDir = getUploadsDir();
const photoDir = path.join(binDir, "photo");
fs.mkdirSync(path.join(uploadsDir, "notes"), { recursive: true });
fs.mkdirSync(path.join(uploadsDir, "journal"), { recursive: true });
fs.mkdirSync(path.join(uploadsDir, "groups"), { recursive: true });
fs.mkdirSync(path.join(uploadsDir, "live_wall"), { recursive: true });
fs.mkdirSync(path.join(uploadsDir, "rewards"), { recursive: true });
fs.mkdirSync(path.join(uploadsDir, "quizzes"), { recursive: true });
fs.mkdirSync(path.join(uploadsDir, "collections"), { recursive: true });
fs.mkdirSync(photoDir, { recursive: true });

const app = express();
autoCatch(app);
// 前端頁面與 API 同源，不需要開放跨來源。只放行「沒有 Origin 標頭」（同源 GET、curl、App）
// 與 Origin 主機等於請求 Host 的請求，其他網站的頁面不能帶著 cookie 來呼叫 API。
app.use(
  cors((req, callback) => {
    const origin = req.headers.origin;
    let allowed = !origin;
    if (origin) {
      try {
        allowed = new URL(origin).host === req.headers.host;
      } catch {
        allowed = false;
      }
    }
    callback(null, { origin: allowed, credentials: true });
  })
);
app.use(cookieParser());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// --- HTTP Middleware: force no-cache on static/html/js/css/json, mirroring main.py ---
app.use((req: Request, res: Response, next: NextFunction) => {
  const p = req.path;
  if (
    p.startsWith("/static") ||
    /\.(html|js|css|json)$/.test(p) ||
    ["", "/", "/projection", "/guide", "/student", "/student-guide", "/quick-guide", "/student-quick-guide", "/whereabouts", "/mobile", "/favicon.ico"].includes(p)
  ) {
    res.set({
      "Cache-Control": "no-cache, no-store, must-revalidate, max-age=0",
      Pragma: "no-cache",
      Expires: "0",
    });
  }
  next();
});

function renderCachedHtml(res: Response, filePath: string) {
  try {
    let content = fs.readFileSync(filePath, "utf-8");
    content = content.replace(/(\.js|\.css)(\?v=[^"'\s>]+)?/g, `$1?v=${APP_STARTUP_TIMESTAMP}`);
    res.set({
      "Content-Type": "text/html; charset=utf-8",
      "Cache-Control": "no-cache, no-store, must-revalidate, max-age=0",
      Pragma: "no-cache",
      Expires: "0",
    });
    res.send(content);
  } catch {
    res.status(500).send("Page loading error");
  }
}

app.use("/static", express.static(staticDir));

// --- Secure access for student photos and note/group attachments ---
/** Resolves `rel` under `baseDir`, rejecting any path that escapes it via `..`. */
function resolveSafePath(baseDir: string, rel: string): string | null {
  const resolved = path.resolve(baseDir, rel);
  if (resolved !== baseDir && !resolved.startsWith(baseDir + path.sep)) return null;
  return resolved;
}

app.get("/photo/*", async (req, res) => {
  if (!(await isRequestAuthenticated(req))) {
    res.status(401).json({ detail: "未登入無法讀取學生照片" });
    return;
  }
  const rel = (req.params as Record<string, string>)[0] ?? "";
  const filePath = resolveSafePath(photoDir, rel);
  if (filePath && fs.existsSync(filePath) && fs.statSync(filePath).isFile()) {
    // 照片可由網頁更換：每次都向伺服器驗證（ETag），沒變就回 304，換了就立即看到新照片
    res.setHeader("Cache-Control", "no-cache");
    res.sendFile(filePath);
  } else {
    res.status(404).json({ detail: "Photo not found" });
  }
});

app.get("/uploads/*", async (req, res) => {
  const rel = (req.params as Record<string, string>)[0] ?? "";

  // 點數卡底圖、獎勵圖片與組別圖示等公開卡面視覺資源，允許直接載入顯示（避免 <img> 標籤無法攜帶 Authorization header 導致 401）
  const isPublicVisualAsset =
    rel.startsWith("card_backgrounds/") ||
    rel.startsWith("rewards/") ||
    rel.startsWith("groups/");

  if (!isPublicVisualAsset) {
    // 教材/作業附件同時給教師（系統 session）與學生（LMS JWT）存取，兩種驗證只要其一成立即可。
    // 學生端也接受 ?token= query（<img src>/<a href> 無法附加 Authorization header）。
    const token = getBearerToken(req) || (typeof req.query.token === "string" ? req.query.token : undefined);
    const isStudent = token ? Boolean(await verifyStudentToken(token)) : false;
    if (!isStudent && !(await isRequestAuthenticated(req))) {
      res.status(401).json({ detail: "未登入無法讀取系統附件" });
      return;
    }
  }
  const filePath = resolveSafePath(uploadsDir, rel);
  if (filePath && fs.existsSync(filePath) && fs.statSync(filePath).isFile()) {
    // 磁碟上的檔名是亂數產生的（避免碰撞），跟素材頁面顯示的標題不同；呼叫端可選擇性帶
    // ?name= 指定下載/另存時要用的檔名（例如素材標題），保留實際副檔名以免存成打不開的檔案。
    const displayName = typeof req.query.name === "string" ? req.query.name.trim() : "";
    if (displayName) {
      const ext = path.extname(filePath);
      const safeBase = displayName.replace(/[\\/]/g, "");
      const finalName = ext && !safeBase.toLowerCase().endsWith(ext.toLowerCase()) ? `${safeBase}${ext}` : safeBase;
      res.setHeader("Content-Disposition", `inline; filename*=UTF-8''${encodeURIComponent(finalName)}`);
    }
    res.sendFile(filePath);
  } else {
    res.status(404).json({ detail: "File not found" });
  }
});

app.get("/favicon.ico", (_req, res) => {
  const customLogo = path.join(binDir, "custom_logo.png");
  if (fs.existsSync(customLogo)) {
    res.sendFile(customLogo, { headers: { "Content-Type": "image/png" } });
    return;
  }
  const favicon = path.join(staticDir, "logo.svg");
  if (fs.existsSync(favicon)) {
    res.sendFile(favicon, { headers: { "Content-Type": "image/svg+xml" } });
    return;
  }
  res.json({ message: "Favicon not found" });
});

app.get("/", (_req, res) => {
  const indexFile = path.join(staticDir, "index.html");
  if (fs.existsSync(indexFile)) {
    renderCachedHtml(res, indexFile);
  } else {
    res.json({ message: "Server is running, but static/index.html is missing" });
  }
});

app.get("/guide", async (req, res) => {
  if (!(await isRequestAuthenticated(req))) {
    const redirectTarget = req.originalUrl.includes("?") ? req.originalUrl : "/guide";
    res.redirect(307, `/?redirect=${encodeURIComponent(redirectTarget)}`);
    return;
  }
  const guideFile = path.join(staticDir, "guide.html");
  if (fs.existsSync(guideFile)) {
    renderCachedHtml(res, guideFile);
  } else {
    res.json({ message: "Guide page is missing" });
  }
});

app.get("/projection", async (req, res) => {
  if (!(await isRequestAuthenticated(req))) {
    const redirectTarget = req.originalUrl.includes("?") ? req.originalUrl : "/projection";
    res.redirect(307, `/?redirect=${encodeURIComponent(redirectTarget)}`);
    return;
  }
  const projFile = path.join(staticDir, "projection.html");
  const indexFile = path.join(staticDir, "index.html");
  if (fs.existsSync(projFile)) {
    renderCachedHtml(res, projFile);
  } else if (fs.existsSync(indexFile)) {
    renderCachedHtml(res, indexFile);
  } else {
    res.json({ message: "Projection page is missing" });
  }
});

// --- 作業掃描登記：小助手獨立彈出視窗（僅限教師本機） ---
app.get("/homework-scan", requireLocalOnly, async (req, res) => {
  if (!(await isRequestAuthenticated(req))) {
    const redirectTarget = req.originalUrl.includes("?") ? req.originalUrl : "/homework-scan";
    res.redirect(307, `/?redirect=${encodeURIComponent(redirectTarget)}`);
    return;
  }
  const scanFile = path.join(staticDir, "homework-scan.html");
  const indexFile = path.join(staticDir, "index.html");
  if (fs.existsSync(scanFile)) {
    renderCachedHtml(res, scanFile);
  } else if (fs.existsSync(indexFile)) {
    renderCachedHtml(res, indexFile);
  } else {
    res.json({ message: "Homework scan page is missing" });
  }
});


// --- LMS 學生入口頁（Phase 2）：公開頁面，不需要教師系統密碼登入。
// 使用者不再直接輸入這個網址——教師與學生一律從 http://localhost:8000 進入，學生登入成功後
// 由 static/js/app.js 的 enterStudentMode() 把這個頁面載進一個同源全螢幕 iframe 顯示，
// 此路由純粹是那個 iframe 的內部資源來源，保留路徑不變只是為了不用同時改前後端。 ---
app.get("/student", (_req, res) => {
  const studentFile = path.join(staticDir, "student.html");
  if (fs.existsSync(studentFile)) {
    renderCachedHtml(res, studentFile);
  } else {
    res.json({ message: "Student page is missing" });
  }
});

// --- 學生使用說明頁：公開頁面（學生端不需要教師登入），與 /student 相同 ---
app.get("/student-guide", (_req, res) => {
  const guideFile = path.join(staticDir, "student-guide.html");
  if (fs.existsSync(guideFile)) {
    renderCachedHtml(res, guideFile);
  } else {
    res.json({ message: "Student guide page is missing" });
  }
});

// --- 簡易版簡報說明：教師版需登入（比照 /guide），學生版為公開頁 ---
app.get("/quick-guide", async (req, res) => {
  if (!(await isRequestAuthenticated(req))) {
    const redirectTarget = req.originalUrl.includes("?") ? req.originalUrl : "/quick-guide";
    res.redirect(307, `/?redirect=${encodeURIComponent(redirectTarget)}`);
    return;
  }
  const file = path.join(staticDir, "quick-guide.html");
  if (fs.existsSync(file)) {
    renderCachedHtml(res, file);
  } else {
    res.json({ message: "Quick guide page is missing" });
  }
});

app.get("/student-quick-guide", (_req, res) => {
  const file = path.join(staticDir, "student-quick-guide.html");
  if (fs.existsSync(file)) {
    renderCachedHtml(res, file);
  } else {
    res.json({ message: "Student quick guide page is missing" });
  }
});

// --- 在位掌握：學生自行登記頁（公開頁面，不需教師登入；資料存取需帶班級金鑰） ---
app.get("/whereabouts", (_req, res) => {
  const file = path.join(staticDir, "whereabouts.html");
  if (fs.existsSync(file)) {
    renderCachedHtml(res, file);
  } else {
    res.json({ message: "Whereabouts page is missing" });
  }
});

// --- 教師手機專用頁（選班級 ➜ 點名／快速加減分／紀錄／日誌／教學小工具）：
// 頁面本身是公開的靜態檔，登入（教師每日密碼）與資料存取都在頁面內以教師 token 呼叫 API 完成。 ---
app.get("/mobile", (_req, res) => {
  const file = path.join(staticDir, "mobile.html");
  if (fs.existsSync(file)) {
    renderCachedHtml(res, file);
  } else {
    res.json({ message: "Mobile page is missing" });
  }
});

// --- API Routers (each router self-wraps via autoCatch() at construction time,
// in its own file, so a rejected promise in a handler reaches the error
// middleware below instead of crashing the whole server) ---
// 托盤程式（MyClass.exe）用來安全關閉伺服器：必須來自本機，且帶有 bin/runtime.json 內的權杖。
app.post("/api/system/shutdown", (req, res) => {
  const info = readRuntimeInfo();
  const token = req.get("x-myclass-token");
  if (!isLocalRequest(req) || !info || info.pid !== process.pid || !token || token !== info.token) {
    res.status(403).json({ detail: "不允許的操作" });
    return;
  }
  res.json({ message: "伺服器即將關閉" });
  setTimeout(requestShutdown, 200);
});
app.use("/api/system", systemRouter);
app.use("/api/courses", requireAuth, coursesRouter);
app.use("/api/attendance", requireAuth, attendanceRouter);
app.use("/api/whereabouts", requireAuth, whereaboutsRouter);
// 免登入的學生自行登記（以每班金鑰保護，見 routes/whereabouts.ts）
app.use("/api/public/whereabouts", whereaboutsPublicRouter);
app.use("/api/groups", requireAuth, groupsRouter);
app.use("/api/seating", requireAuth, seatingRouter);
app.use("/api/scores", requireAuth, scoresRouter);
app.use("/api/notes", requireAuth, notesRouter);
app.use("/api/journal", requireAuth, journalRouter);
app.use("/api/reports", requireAuth, reportsRouter);
app.use("/api/units", requireAuth, unitsRouter);
app.use("/api/live-wall", requireAuth, liveWallRouter);
app.use("/api/point-cards", requireAuth, pointCardsRouter);
app.use("/api/rewards", requireAuth, rewardsRouter);
app.use("/api/paper-quizzes", requireAuth, paperQuizzesRouter);
app.use("/api/bulletin", requireAuth, bulletinRouter);
app.use("/api/file-collections", requireAuth, fileCollectionsRouter);
// 作業掃描登記：只有教師本機（連線來源為本機）能呼叫，先擋來源再驗教師登入
app.use("/api/homework-scan", requireLocalOnly, requireAuth, homeworkScanRouter);
app.use("/api/quiz-sets", requireAuth, quizSetsRouter);
app.use("/api/wordclouds", requireAuth, wordCloudsRouter);
app.use("/api/timetable", requireAuth, timetableRouter);

// --- LMS 學生端（Phase 2）：獨立的 JWT 驗證，不套用教師 requireAuth ---
app.use("/api/auth/student", studentAuthRouter);
app.use("/api/student", studentContentRouter);
app.use("/api/student/live-wall", studentLiveWallRouter);
app.use("/api/student/point-cards", studentPointCardsRouter);
app.use("/api/student/rewards", studentRewardsRouter);
app.use("/api/student/notifications", studentNotificationsRouter);
app.use("/api/student/file-collections", studentFileCollectionsRouter);

// --- Global error handler: isolate a single request's failure instead of
// letting an unhandled rejection crash the whole process (all other teachers'
// live connections included). Must be registered last, after every route. ---
app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
  console.error("[Request Error]", err);
  if (res.headersSent) return;
  const message = err instanceof Error ? err.message : "Internal Server Error";
  res.status(500).json({ detail: message });
});

// --- Startup: find an available port, boot the DB schema, then listen ---

// 預設監聽所有網卡：學生的手機／平板要從區網連進來。只在教師本機使用、不開放學生連線時，
// 可用環境變數 MYCLASS_HOST=127.0.0.1 限縮為僅本機可連。
const LISTEN_HOST = process.env.MYCLASS_HOST?.trim() || "0.0.0.0";

function isPortFree(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const tester = net
      .createServer()
      .once("error", () => resolve(false))
      .once("listening", () => tester.close(() => resolve(true)))
      .listen(port, LISTEN_HOST);
  });
}

async function findAvailablePort(startPort = 8000, maxAttempts = 20): Promise<number> {
  for (let port = startPort; port < startPort + maxAttempts; port++) {
    if (await isPortFree(port)) return port;
  }
  return startPort;
}

function getLocalIp(): string {
  const os = require("os") as typeof import("os");
  const nets = os.networkInterfaces();
  for (const name of Object.keys(nets)) {
    for (const net of nets[name] ?? []) {
      if (net.family === "IPv4" && !net.internal) return net.address;
    }
  }
  return "127.0.0.1";
}

function openBrowser(url: string) {
  const cmd = process.platform === "win32" ? `start "" "${url}"` : process.platform === "darwin" ? `open "${url}"` : `xdg-open "${url}"`;
  exec(cmd, () => undefined);
}

async function waitForServerReady(port: number, timeoutMs = 15000): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const ok = await new Promise<boolean>((resolve) => {
        const req = https.get(
          { host: "127.0.0.1", port, path: "/", timeout: 500, rejectUnauthorized: false },
          (res) => {
            resolve(res.statusCode === 200);
            res.resume();
          }
        );
        req.on("error", () => resolve(false));
        req.on("timeout", () => {
          req.destroy();
          resolve(false);
        });
      });
      if (ok) return;
    } catch {
      /* keep polling */
    }
    await new Promise((r) => setTimeout(r, 200));
  }
}

async function printBanner(port: number) {
  const localIp = getLocalIp();
  const localUrl = `https://localhost:${port}`;
  const networkUrl = `https://${localIp}:${port}`;

  console.log("=".repeat(60));
  console.log("  [*] 國小課堂即時記錄系統 (MyClass - Node.js Edition)");
  console.log("=".repeat(60));
  console.log(` 本機開啟網址 : ${localUrl}`);
  console.log(` 區網手機/平板 : ${networkUrl}`);
  console.log("-".repeat(60));
  console.log(" 請確保手機/平板與此電腦連線至相同的教室 Wi-Fi 網路！");
  console.log(" 本系統採自簽憑證的 HTTPS，瀏覽器第一次連線會顯示「不安全連線」警告，");
  console.log(" 屬正常現象，請點選「進階」→「繼續前往」即可（相機掃描功能需要 HTTPS 才能使用）。");
  console.log(" 掃描下方 QR Code 即可快速連線：\n");
  try {
    console.log(await QRCode.toString(networkUrl, { type: "terminal", small: true }));
  } catch {
    /* best-effort ASCII QR */
  }
  console.log("=".repeat(60));
}

// Last-resort safety net: log and keep running rather than let a stray rejection
// (e.g. inside a Socket.io event handler, outside Express's request lifecycle)
// take down every connected teacher/classroom's session.
process.on("unhandledRejection", (err) => console.error("[Unhandled Rejection]", err));
process.on("uncaughtException", (err) => console.error("[Uncaught Exception]", err));

async function main() {
  // --background（托盤程式啟動時使用）：不開瀏覽器、不印 QR Code 橫幅。
  const background = process.argv.includes("--background") || process.env.MYCLASS_BACKGROUND === "1" || process.env.TEACHSYS_BACKGROUND === "1";

  // 同一份資料只允許一個伺服器：已經在執行時，直接開啟既有網址後結束。
  const existing = await findRunningInstance();
  if (existing) {
    console.log(`[MyClass] 系統已在執行中（${existing.local_url}），不重複啟動。`);
    if (!background) openBrowser(existing.local_url);
    process.exit(0);
  }

  // 程式有更新時，先自動備份資料庫，再執行資料庫遷移（見 backup.ts）
  await backupBeforeUpgrade();
  await initSchema();

  const port = await findAvailablePort(8000);
  const httpsOptions = await getOrCreateHttpsOptions();
  const httpServer = https.createServer(httpsOptions, app);
  setupRealtime(httpServer);

  registerShutdown(
    () =>
      new Promise<void>((resolve) => {
        httpServer.close(() => resolve());
        // 既有的長連線（Socket.io 等）不會自己斷，讓 close 不必等它們
        (httpServer as unknown as { closeAllConnections?: () => void }).closeAllConnections?.();
        prisma.$disconnect().catch(() => undefined);
      })
  );
  process.on("exit", () => clearRuntimeInfo(process.pid));
  process.on("SIGINT", () => requestShutdown());
  process.on("SIGTERM", () => requestShutdown());

  httpServer.listen(port, LISTEN_HOST, async () => {
    const localUrl = `https://localhost:${port}`;
    writeRuntimeInfo({
      pid: process.pid,
      port,
      token: newShutdownToken(),
      local_url: localUrl,
      lan_url: `https://${getLocalIp()}:${port}`,
      started_at: new Date().toISOString(),
    });
    startUpdateChecker(); // 新版本偵測（只通知；開發模式與無版本號的建置不會啟動）
    if (background) {
      console.log(`[MyClass] 背景執行中：${localUrl}`);
      return;
    }
    await printBanner(port);
    waitForServerReady(port).then(() => openBrowser(localUrl));
  });
}

main().catch((err) => {
  console.error("[Fatal Startup Error]", err);
  process.exit(1);
});
