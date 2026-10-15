// 教師登入的失敗次數限制（僅針對「不是從教師本機」的請求）。
//
// 每天的密碼是「字頭 + 月日」，攻擊者只需要猜字頭；沒有限制就能在區網內無限次嘗試。
// 這裡以來源位址計算：10 分鐘內失敗 8 次，就暫停該位址 10 分鐘。教師本機不受限制，
// 所以就算有人在區網狂試，老師仍能在自己的電腦登入。
// 限制：校園網路若把許多裝置經 NAT 轉成同一個來源位址，被攻擊時同一位址的手機版登入也會暫停，
// 這種情況請改在教師電腦登入。記憶體內計數，程式重新啟動後歸零。
import type { Request } from "express";
import { isLocalRequest } from "./localOnly";

const MAX_FAILURES = 8;
const WINDOW_MS = 10 * 60 * 1000;
const BLOCK_MS = 10 * 60 * 1000;

interface Entry {
  failures: number;
  firstAt: number;
  blockedUntil: number;
}
const entries = new Map<string, Entry>();

function keyOf(req: Request): string {
  const a = req.socket.remoteAddress ?? "unknown";
  return a.startsWith("::ffff:") ? a.slice(7) : a;
}

function sweep(now: number): void {
  for (const [k, e] of entries) {
    if (e.blockedUntil <= now && now - e.firstAt > WINDOW_MS) entries.delete(k);
  }
}

/** 回傳還要等幾秒才能再試；0 表示可以嘗試。本機請求永遠回傳 0。 */
export function loginBlockedSeconds(req: Request, now = Date.now()): number {
  if (isLocalRequest(req)) return 0;
  const e = entries.get(keyOf(req));
  if (!e || e.blockedUntil <= now) return 0;
  return Math.ceil((e.blockedUntil - now) / 1000);
}

export function recordLoginFailure(req: Request, now = Date.now()): void {
  if (isLocalRequest(req)) return;
  sweep(now);
  const key = keyOf(req);
  let e = entries.get(key);
  if (!e || now - e.firstAt > WINDOW_MS) {
    e = { failures: 0, firstAt: now, blockedUntil: 0 };
    entries.set(key, e);
  }
  e.failures += 1;
  if (e.failures >= MAX_FAILURES) {
    e.blockedUntil = now + BLOCK_MS;
    e.failures = 0;
    e.firstAt = now;
  }
}

export function recordLoginSuccess(req: Request): void {
  entries.delete(keyOf(req));
}
