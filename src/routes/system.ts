// Port of app/routers/system.py (minus the WebSocket endpoint, now handled by
// src/realtime.ts via Socket.io — see setupRealtime()).
import fs from "fs";
import path from "path";
import { Router } from "express";
import multer from "multer";
import QRCode from "qrcode";
import { prisma } from "../db";
import { getBinDir, getBundleDir } from "../paths";
import { getTodayMMDDTaipei, getTodayStrTaipei } from "../timezone";
import {
  createSession,
  DEFAULT_PASSWORD_PREFIX,
  getCurrentSessionToken,
  getPasswordPrefix,
  invalidatePrefixCache,
  isDefaultPrefix,
  isRequestAuthenticated,
  requireAuth,
} from "../middleware/auth";
import { autoCatch } from "../asyncRoute";
import { getLocalIp } from "../utils/network";
import { isLocalRequest } from "../middleware/localOnly";

export const systemRouter = autoCatch(Router());
const upload = multer({ storage: multer.memoryStorage() });

// 前端用來決定要不要顯示「僅限教師本機」的功能（如作業掃描登記）；真正的攔阻在伺服器端
// （middleware/localOnly.ts），這裡只是讓其他裝置看不到多餘的選單。
systemRouter.get("/local-access", (req, res) => {
  res.json({ is_local: isLocalRequest(req) });
});

// --- Network & System Info ---

systemRouter.get("/info", async (req, res) => {
  const port = Number(req.query.port ?? 8000);
  const courseId = req.query.course_id ? Number(req.query.course_id) : undefined;
  const mode = (req.query.mode as string) ?? "mobile";

  const localIp = getLocalIp();
  const baseUrl = `https://${localIp}:${port}`;
  // 教師手機專用頁（選班級 ➜ 點名／快速加減分／紀錄／日誌／教學小工具），見 static/mobile.html
  const mobileUrl = `${baseUrl}/mobile`;
  // 學生連線 QR Code（登入畫面用）：主登入介面預設只顯示教師登入，學生改用自己的手機/平板
  // 掃這組 QR Code，帶 ?login=student 讓對方裝置上開啟的頁面直接顯示學生登入表單（見
  // static/js/app.js 的 getDefaultAuthPanel()），不影響掃碼裝置以外的任何畫面。
  const studentLoginUrl = `${baseUrl}/?login=student`;
  const targetUrl = mode === "mobile" ? mobileUrl : mode === "student" ? studentLoginUrl : baseUrl;

  const qrDataUrl = await QRCode.toDataURL(targetUrl, {
    errorCorrectionLevel: "L",
    margin: 2,
    scale: 8,
  });

  res.json({
    local_ip: localIp,
    port,
    url: targetUrl,
    base_url: baseUrl,
    mobile_url: mobileUrl,
    qr_code: qrDataUrl,
  });
});

// --- Password & Auth Endpoints ---

systemRouter.get("/auth_info", async (req, res) => {
  res.json({
    today_str: getTodayStrTaipei(),
    today_mmdd: getTodayMMDDTaipei(),
    default_prefix: DEFAULT_PASSWORD_PREFIX,
    authenticated: await isRequestAuthenticated(req),
    must_change_prefix: await isDefaultPrefix(),
  });
});

systemRouter.get("/check_auth", async (req, res) => {
  res.json({
    authenticated: await isRequestAuthenticated(req),
    today_str: getTodayStrTaipei(),
    must_change_prefix: await isDefaultPrefix(),
  });
});

systemRouter.post("/verify_password", async (req, res) => {
  const password = String(req.body?.password ?? "");
  const prefix = await getPasswordPrefix();
  const todayMmdd = getTodayMMDDTaipei();
  const expected = `${prefix}${todayMmdd}`;

  if (password.trim() !== expected) {
    res.status(401).json({ detail: `密碼錯誤！密碼公式為：[字頭] + [當天月日${todayMmdd}]` });
    return;
  }

  const token = await createSession();
  res.cookie("auth_session", token, {
    maxAge: 86400 * 1000,
    path: "/",
    sameSite: "lax",
    httpOnly: false,
  });
  res.json({ success: true, message: "身分驗證成功！", auth_token: token, auth_date: getTodayStrTaipei(), must_change_prefix: await isDefaultPrefix() });
});

systemRouter.post("/logout", async (req, res) => {
  const token = getCurrentSessionToken(req);
  if (token) {
    await prisma.systemSession.deleteMany({ where: { token } });
  }
  res.clearCookie("auth_session", { path: "/" });
  res.json({ success: true, message: "已成功登出系統！" });
});

systemRouter.post("/update_password_prefix", requireAuth, async (req, res) => {
  const currentPassword = String(req.body?.current_password ?? "");
  const newPrefixRaw = String(req.body?.new_prefix ?? "");
  const prefix = await getPasswordPrefix();
  const todayMmdd = getTodayMMDDTaipei();
  const expected = `${prefix}${todayMmdd}`;

  if (currentPassword.trim() !== expected) {
    res.status(401).json({ detail: "目前密碼驗證失敗！" });
    return;
  }

  const newPrefix = newPrefixRaw.trim();
  if (newPrefix.length < 4) {
    res.status(400).json({ detail: "密碼字頭長度至少必須為 4 碼！" });
    return;
  }

  if (newPrefix.toLowerCase() === DEFAULT_PASSWORD_PREFIX.toLowerCase()) {
    res.status(400).json({ detail: `新的密碼字頭不可使用預設值『${DEFAULT_PASSWORD_PREFIX}』！` });
    return;
  }

  await prisma.systemSetting.upsert({
    where: { key: "password_prefix" },
    update: { value: newPrefix },
    create: { key: "password_prefix", value: newPrefix },
  });
  invalidatePrefixCache();

  res.json({
    success: true,
    message: `密碼字頭已成功修改為『${newPrefix}』！今日最新密碼為：${newPrefix}${todayMmdd}`,
  });
});

// 忘記密碼的重置：未登入就能呼叫，所以只允許教師本機（非區網其他裝置）使用，
// 否則任何人都能把字頭重置成公開的預設值再登入。重置後下次登入會被強制改字頭。
systemRouter.post("/reset_password_prefix", async (req, res) => {
  if (!isLocalRequest(req)) {
    res.status(403).json({ detail: "忘記密碼的重置只能在教師本機的電腦上操作！" });
    return;
  }
  await prisma.systemSetting.upsert({
    where: { key: "password_prefix" },
    update: { value: DEFAULT_PASSWORD_PREFIX },
    create: { key: "password_prefix", value: DEFAULT_PASSWORD_PREFIX },
  });
  invalidatePrefixCache();
  const todayMmdd = getTodayMMDDTaipei();
  res.json({ success: true, message: `密碼字頭已成功恢復為預設『${DEFAULT_PASSWORD_PREFIX}』！今日密碼為：${DEFAULT_PASSWORD_PREFIX}${todayMmdd}，登入後須立即修改字頭。` });
});

// --- Logo & Favicon 自訂替換支援 ---

function getCustomLogoPath(): string {
  return path.join(getBinDir(), "custom_logo.png");
}
function getDefaultLogoPath(): string {
  return path.join(getBundleDir(), "static", "logo.svg");
}

systemRouter.get("/logo", (_req, res) => {
  const custom = getCustomLogoPath();
  if (fs.existsSync(custom)) {
    res.sendFile(custom, { headers: { "Content-Type": "image/png" } });
    return;
  }
  const defaultSvg = getDefaultLogoPath();
  if (fs.existsSync(defaultSvg)) {
    res.sendFile(defaultSvg, { headers: { "Content-Type": "image/svg+xml" } });
    return;
  }
  res.json({ message: "Logo not found" });
});

systemRouter.post("/logo", requireAuth, upload.single("file"), (req, res) => {
  const file = req.file;
  if (!file) {
    res.status(400).json({ detail: "請上傳 PNG、JPG 或 SVG 圖片檔案！" });
    return;
  }
  const filename = file.originalname.toLowerCase();
  if (!/\.(png|jpg|jpeg|svg|webp)$/.test(filename)) {
    res.status(400).json({ detail: "請上傳 PNG、JPG 或 SVG 圖片檔案！" });
    return;
  }
  fs.writeFileSync(getCustomLogoPath(), file.buffer);
  res.json({ success: true, message: "Logo 與 Favicon 已成功替換！" });
});

systemRouter.post("/logo/reset", requireAuth, (_req, res) => {
  const custom = getCustomLogoPath();
  if (fs.existsSync(custom)) {
    try {
      fs.unlinkSync(custom);
    } catch {
      /* best-effort */
    }
  }
  res.json({ success: true, message: "已成功恢復為系統預設 Logo！" });
});

systemRouter.get("/bgm_list", (_req, res) => {
  const musicDir = path.join(getBundleDir(), "static", "music");
  const musicList: { title: string; filename: string; url: string }[] = [];
  if (fs.existsSync(musicDir)) {
    const exts = new Set([".mp3", ".wav", ".ogg", ".m4a", ".aac", ".flac"]);
    for (const f of fs.readdirSync(musicDir).sort()) {
      const ext = path.extname(f).toLowerCase();
      if (exts.has(ext)) {
        musicList.push({ title: path.basename(f, ext), filename: f, url: `/static/music/${f}` });
      }
    }
  }
  res.json({ music: musicList });
});
