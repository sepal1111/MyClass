// Port of app/routers/system.py's session helpers. The Phase-1 migration keeps
// the existing single shared "password prefix + today's MMDD" scheme as-is
// (teachers' daily workflow must not change); per-user teacher/student accounts
// are a Phase-2 (LMS) addition layered on top, not a replacement.
import crypto from "crypto";
import type { NextFunction, Request, Response } from "express";
import { prisma } from "../db";
import { getNowStrTaipei, getTodayStrTaipei } from "../timezone";

const SESSION_TTL_MS = 24 * 60 * 60 * 1000; // 1 day, same as the Python version's max_age=86400

function addMs(dateStr: string, ms: number): string {
  // dateStr is "YYYY-MM-DD HH:MM:SS" in Taipei wall-clock time; do the arithmetic
  // in a timezone-naive way (treat it as UTC) so the stored string stays comparable
  // to future getNowStrTaipei() output via plain string comparison.
  const asUtc = new Date(dateStr.replace(" ", "T") + "Z");
  const shifted = new Date(asUtc.getTime() + ms);
  return shifted.toISOString().slice(0, 19).replace("T", " ");
}

export async function createSession(): Promise<string> {
  const token = crypto.randomBytes(32).toString("base64url");
  const todayStr = getTodayStrTaipei();
  const nowStr = getNowStrTaipei();
  const expiresAt = addMs(nowStr, SESSION_TTL_MS);

  await prisma.systemSession.deleteMany({
    where: { OR: [{ expiresAt: { lt: nowStr } }, { createdDate: { not: todayStr } }] },
  });

  await prisma.systemSession.create({
    data: { token, createdDate: todayStr, expiresAt, createdAt: nowStr },
  });
  return token;
}

export async function validateSessionToken(token: string | undefined | null): Promise<boolean> {
  if (!token) return false;
  const todayStr = getTodayStrTaipei();
  const nowStr = getNowStrTaipei();
  const row = await prisma.systemSession.findFirst({
    where: { token, createdDate: todayStr, expiresAt: { gte: nowStr } },
  });
  return Boolean(row);
}

export function getCurrentSessionToken(req: Request): string | undefined {
  const authHeader = req.headers.authorization;
  if (authHeader?.startsWith("Bearer ")) {
    return authHeader.slice(7).trim();
  }
  const xToken = req.headers["x-auth-token"];
  if (typeof xToken === "string" && xToken) {
    return xToken.trim();
  }
  const cookieToken = req.cookies?.auth_session;
  if (cookieToken) {
    return String(cookieToken).trim();
  }
  const queryToken = req.query?.token;
  if (typeof queryToken === "string" && queryToken) {
    return queryToken.trim();
  }
  return undefined;
}

export const DEFAULT_PASSWORD_PREFIX = "Admin";

export async function getPasswordPrefix(): Promise<string> {
  const row = await prisma.systemSetting.findUnique({ where: { key: "password_prefix" } });
  return row?.value || DEFAULT_PASSWORD_PREFIX;
}

// 是否仍在使用預設字頭（不分大小寫）。requireAuth 每個請求都會問一次，所以快取結果；
// 字頭被修改／重置時由 invalidatePrefixCache() 清除。
let prefixIsDefaultCache: boolean | null = null;

export function invalidatePrefixCache(): void {
  prefixIsDefaultCache = null;
}

export async function isDefaultPrefix(): Promise<boolean> {
  if (prefixIsDefaultCache === null) {
    const prefix = await getPasswordPrefix();
    prefixIsDefaultCache = prefix.trim().toLowerCase() === DEFAULT_PASSWORD_PREFIX.toLowerCase();
  }
  return prefixIsDefaultCache;
}

export async function isRequestAuthenticated(req: Request): Promise<boolean> {
  return validateSessionToken(getCurrentSessionToken(req));
}

/** Express middleware that mirrors the FastAPI `require_auth` dependency.
 *  Applied directly via `app.use(requireAuth, ...)`, so it isn't covered by
 *  autoCatch() — guard it explicitly to avoid a DB hiccup crashing the process. */
export async function requireAuth(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const token = getCurrentSessionToken(req);
    if (!(await validateSessionToken(token))) {
      res.status(401).json({ detail: "未登入或身分驗證已逾期，請先登入系統！" });
      return;
    }
    // 仍是預設字頭（Admin）時，除了 /api/system/*（修改字頭、登出等）之外一律擋下，
    // 強制教師先改掉公開的預設密碼公式。
    if (!req.originalUrl.startsWith("/api/system/") && (await isDefaultPrefix())) {
      res.status(403).json({
        detail: "目前仍使用預設密碼字頭，請先修改密碼字頭後再使用系統！",
        code: "PREFIX_CHANGE_REQUIRED",
      });
      return;
    }
    next();
  } catch (err) {
    next(err);
  }
  return;
}
