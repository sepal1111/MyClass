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

export function isLocalRequest(req: Request): boolean {
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
