// 登入失敗次數限制（僅針對「不是從教師本機」的請求）。
//
// 教師登入：每天的密碼是「字頭 + 月日」，攻擊者只需要猜字頭；沒有限制就能在區網內無限次嘗試。
//   以來源位址計算：10 分鐘內失敗 8 次，暫停該位址 10 分鐘。教師本機不受限制，
//   所以就算有人在區網狂試，老師仍能在自己的電腦登入。
// 學生登入：預設密碼是學號（或座號四碼），同班同學之間很容易猜。校園網路常把許多裝置 NAT 成同一個位址，
//   以位址計算會讓全班一起被鎖，所以改以「帳號」計算：10 分鐘內失敗 10 次，暫停該帳號 5 分鐘
//   （10 次 / 5 分鐘 ≈ 每分鐘 2 次，試完 1 萬種要好幾天）。代價是惡意同學能讓別人的帳號短暫鎖住
//   5 分鐘；老師可在自己的電腦登入或請同學稍後再試。
// 記憶體內計數，程式重新啟動後歸零。
import type { Request } from "express";
import { isLocalRequest } from "./localOnly";

interface Entry {
  failures: number;
  firstAt: number;
  blockedUntil: number;
}

function makeThrottle(max: number, windowMs: number, blockMs: number) {
  const entries = new Map<string, Entry>();
  const sweep = (now: number) => {
    for (const [k, e] of entries) {
      if (e.blockedUntil <= now && now - e.firstAt > windowMs) entries.delete(k);
    }
  };
  return {
    blockedSeconds(key: string, now: number): number {
      const e = entries.get(key);
      if (!e || e.blockedUntil <= now) return 0;
      return Math.ceil((e.blockedUntil - now) / 1000);
    },
    fail(key: string, now: number): void {
      sweep(now);
      let e = entries.get(key);
      if (!e || now - e.firstAt > windowMs) {
        e = { failures: 0, firstAt: now, blockedUntil: 0 };
        entries.set(key, e);
      }
      e.failures += 1;
      if (e.failures >= max) {
        e.blockedUntil = now + blockMs;
        e.failures = 0;
        e.firstAt = now;
      }
    },
    ok(key: string): void {
      entries.delete(key);
    },
  };
}

function ipOf(req: Request): string {
  const a = req.socket.remoteAddress ?? "unknown";
  return a.startsWith("::ffff:") ? a.slice(7) : a;
}

// ---- 教師登入（依來源位址）
const teacher = makeThrottle(8, 10 * 60 * 1000, 10 * 60 * 1000);

/** 回傳還要等幾秒才能再試；0 表示可以嘗試。本機請求永遠回傳 0。 */
export function loginBlockedSeconds(req: Request, now = Date.now()): number {
  return isLocalRequest(req) ? 0 : teacher.blockedSeconds(ipOf(req), now);
}
export function recordLoginFailure(req: Request, now = Date.now()): void {
  if (!isLocalRequest(req)) teacher.fail(ipOf(req), now);
}
export function recordLoginSuccess(req: Request): void {
  teacher.ok(ipOf(req));
}

// ---- 學生登入（依帳號，不分大小寫）
const student = makeThrottle(10, 10 * 60 * 1000, 5 * 60 * 1000);
const accountKey = (account: string) => account.trim().toLowerCase();

export function studentLoginBlockedSeconds(req: Request, account: string, now = Date.now()): number {
  return isLocalRequest(req) ? 0 : student.blockedSeconds(accountKey(account), now);
}
export function recordStudentLoginFailure(req: Request, account: string, now = Date.now()): void {
  if (!isLocalRequest(req)) student.fail(accountKey(account), now);
}
export function recordStudentLoginSuccess(account: string): void {
  student.ok(accountKey(account));
}

// ---- 密碼提醒的觸發計數（依帳號，不分大小寫）
// 與上面的「封鎖」是兩件事：這裡只決定什麼時候把提醒顯示給輸入錯誤的人看。
// 不受「教師本機不限制」的影響，因此在教室電腦上也能看到提醒。
const HINT_AFTER_FAILURES = 3;
const HINT_WINDOW_MS = 10 * 60 * 1000;
const hintCounts = new Map<string, { count: number; firstAt: number }>();

export function recordHintFailure(account: string, now = Date.now()): number {
  const key = accountKey(account);
  let e = hintCounts.get(key);
  if (!e || now - e.firstAt > HINT_WINDOW_MS) {
    e = { count: 0, firstAt: now };
    hintCounts.set(key, e);
  }
  e.count += 1;
  return e.count;
}

export function hintFailureCount(account: string, now = Date.now()): number {
  const e = hintCounts.get(accountKey(account));
  return e && now - e.firstAt <= HINT_WINDOW_MS ? e.count : 0;
}

export function clearHintFailures(account: string): void {
  hintCounts.delete(accountKey(account));
}

export function shouldShowHint(account: string, now = Date.now()): boolean {
  return hintFailureCount(account, now) >= HINT_AFTER_FAILURES;
}
