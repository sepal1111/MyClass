// 只允許「教師本機」呼叫的閘門：連線來源必須是這台電腦自己（127.0.0.1 / ::1，或這台電腦
// 自己的區網 IP）。區網內的學生手機/平板、以及開了教師登入的其他裝置，即使知道網址也一律拒絕。
// 判斷依據是 TCP 連線的實際來源位址，不看 Host / X-Forwarded-For 之類可被偽造的標頭。
import os from "os";
import type { NextFunction, Request, Response } from "express";

function normalize(addr: string | undefined): string {
  if (!addr) return "";
  return addr.startsWith("::ffff:") ? addr.slice(7) : addr;
}

function ownAddresses(): Set<string> {
  const set = new Set<string>(["127.0.0.1", "::1"]);
  for (const list of Object.values(os.networkInterfaces())) {
    for (const n of list ?? []) set.add(normalize(n.address));
  }
  return set;
}

// 反向代理或通道（ngrok、cloudflared、nginx…）轉進來的請求，TCP 來源會是代理自己（常常就是
// 127.0.0.1），光看來源位址會誤判成「本機」。這些工具都會附上下列標頭之一；正常的本機瀏覽器
// 不會帶，所以只要出現就一律視為「不是本機」，讓僅限本機的功能（忘記密碼重設、作業掃描、
// 安全關閉）不會因為老師把電腦開放到外網而對外開放。
const PROXY_HEADERS = [
  "x-forwarded-for",
  "x-forwarded-host",
  "x-forwarded-proto",
  "forwarded",
  "x-real-ip",
  "via",
  "cf-connecting-ip",
  "true-client-ip",
  "x-client-ip",
];

function viaProxy(req: Request): boolean {
  return PROXY_HEADERS.some((h) => req.headers?.[h] !== undefined);
}

export function isLocalRequest(req: Request): boolean {
  if (viaProxy(req)) return false;
  const remote = normalize(req.socket.remoteAddress);
  return remote !== "" && ownAddresses().has(remote);
}

export function requireLocalOnly(req: Request, res: Response, next: NextFunction): void {
  if (!isLocalRequest(req)) {
    res.status(403).json({ detail: "作業掃描登記只能在教師本機的電腦上使用，這台裝置無法開啟。" });
    return;
  }
  next();
}
