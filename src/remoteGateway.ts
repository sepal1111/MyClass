// 在家上線用的「學生專用入口」：另開一個只綁在 127.0.0.1 的 HTTP 埠，給 Cloudflare Tunnel
// （cloudflared）之類的通道程式轉送外網連線。這個入口是一層「白名單轉送」：只有學生頁面、
// 學生 API、附件與 Socket.io 會被轉給主伺服器，教師端的頁面與 API 一律回 404，
// 所以教師的每日密碼（字頭 + 月日）不會暴露在網際網路上被猜。
//
// 判斷「外網」的依據是連進來的埠，而不是任何標頭：只有這個入口會把請求標上 REMOTE_HEADER，
// 主伺服器看到這個標頭就套用外網限制（見 isRemoteRequest 的使用處）。外部自己帶來的同名標頭
// 會先被移除；區網裝置就算自己加上這個標頭，也只會讓自己受到更多限制，不會多拿到權限。
//
// 啟用方式（擇一，預設不啟用，原本的區網使用完全不受影響）：
//   - 環境變數 MYCLASS_REMOTE_PORT=8100
//   - bin/remote_access.json：{ "enabled": true, "port": 8100 }
import fs from "fs";
import http from "http";
import https from "https";
import path from "path";
import type { Duplex } from "stream";
import type { Request } from "express";
import { getBinDir } from "./paths";

export const REMOTE_HEADER = "x-myclass-remote";

/** 這個請求是否經由學生專用入口（外網）進來。 */
export function isRemoteRequest(req: Pick<Request, "headers">): boolean {
  return req.headers[REMOTE_HEADER] !== undefined;
}

/** 外網請求的學生真實 IP（由入口寫進 x-forwarded-for）；不是外網請求回傳 null。 */
export function remoteClientIp(req: Pick<Request, "headers">): string | null {
  if (!isRemoteRequest(req)) return null;
  const xff = req.headers["x-forwarded-for"];
  return (typeof xff === "string" && xff.trim()) || "unknown";
}

const DEFAULT_REMOTE_PORT = 8100;

export function getRemoteGatewayPort(): number | null {
  const envPort = process.env.MYCLASS_REMOTE_PORT?.trim();
  if (envPort) {
    const n = Number(envPort);
    return Number.isInteger(n) && n > 0 && n < 65536 ? n : null;
  }
  try {
    const cfg = JSON.parse(fs.readFileSync(path.join(getBinDir(), "remote_access.json"), "utf-8"));
    if (!cfg?.enabled) return null;
    const n = Number(cfg.port ?? DEFAULT_REMOTE_PORT);
    return Number.isInteger(n) && n > 0 && n < 65536 ? n : null;
  } catch {
    return null;
  }
}

// 學生在家需要的路徑。「/」直接改送學生頁面（學生頁面自帶登入表單）。
const EXACT_PATHS = new Set(["/student", "/student-guide", "/student-quick-guide", "/favicon.ico", "/api/system/logo"]);
const PREFIX_PATHS = ["/static/", "/uploads/", "/socket.io/", "/api/auth/student/", "/api/student/"];

function isAllowedPath(pathname: string): boolean {
  if (EXACT_PATHS.has(pathname)) return true;
  if (pathname === "/api/student") return true;
  return PREFIX_PATHS.some((p) => pathname.startsWith(p));
}

/** 回傳要轉給主伺服器的路徑（含 query）；不在白名單內就回傳 null。 */
function mapPath(rawUrl: string | undefined): string | null {
  const url = rawUrl || "/";
  const q = url.indexOf("?");
  const pathname = q >= 0 ? url.slice(0, q) : url;
  const search = q >= 0 ? url.slice(q) : "";
  // 擋掉編碼過的斜線、反斜線與 ..，避免繞過白名單（例如 /static/..%2Fapi/courses）
  if (/%2f|%5c|%2e|\\|\/\.\.?(\/|$)/i.test(pathname)) return null;
  if (pathname === "/") return "/student" + search;
  return isAllowedPath(pathname) ? url : null;
}

/** 學生的真實來源 IP。這個入口只綁 127.0.0.1，連進來的一定是同一台電腦上的通道程式，
 *  所以可以相信它們附上的標頭：Cloudflare 用 cf-connecting-ip；Tailscale Funnel 會把
 *  x-forwarded-for 整個換成真實位址（實測會丟掉外部偽造的值）。都沒有才用 TCP 來源。 */
function clientIpOf(req: http.IncomingMessage): string {
  const cf = req.headers["cf-connecting-ip"];
  if (typeof cf === "string" && cf.trim()) return cf.trim();
  const xff = req.headers["x-forwarded-for"];
  if (typeof xff === "string" && xff.trim()) {
    const parts = xff.split(",").map((s) => s.trim()).filter(Boolean);
    if (parts.length) return parts[parts.length - 1];
  }
  return req.socket.remoteAddress || "";
}

/** 轉送前整理標頭：移除教師登入憑證與外部偽造的標記，再補上外網標記與真實來源位址。 */
function buildForwardHeaders(req: http.IncomingMessage): http.OutgoingHttpHeaders {
  const headers: http.OutgoingHttpHeaders = { ...req.headers };
  // 學生端用 localStorage + Authorization 標頭，不用 cookie；教師的 auth_session cookie 一律不轉送
  delete headers.cookie;
  delete headers["x-auth-token"];
  delete headers[REMOTE_HEADER];
  headers["x-forwarded-for"] = clientIpOf(req);
  headers[REMOTE_HEADER] = "1";
  return headers;
}

function rejectSocket(socket: Duplex, status: string) {
  socket.end(`HTTP/1.1 ${status}\r\nConnection: close\r\n\r\n`);
}

export function startRemoteGateway(listenPort: number, targetPort: number): http.Server {
  const target = { host: "127.0.0.1", port: targetPort, rejectUnauthorized: false };

  const server = http.createServer((req, res) => {
    const forwardPath = mapPath(req.url);
    if (!forwardPath) {
      res.writeHead(404, { "Content-Type": "application/json; charset=utf-8" });
      res.end(JSON.stringify({ detail: "這個功能只能在學校區網內使用。" }));
      return;
    }
    const proxyReq = https.request(
      { ...target, method: req.method, path: forwardPath, headers: buildForwardHeaders(req) },
      (proxyRes) => {
        res.writeHead(proxyRes.statusCode ?? 502, proxyRes.headers);
        proxyRes.pipe(res);
      }
    );
    proxyReq.on("error", (err) => {
      console.error("[Remote Gateway]", err.message);
      if (!res.headersSent) res.writeHead(502, { "Content-Type": "application/json; charset=utf-8" });
      res.end(JSON.stringify({ detail: "老師的電腦目前無法連線，請稍後再試。" }));
    });
    req.pipe(proxyReq);
  });

  // Socket.io 的 WebSocket 升級連線
  server.on("upgrade", (req: http.IncomingMessage, socket: Duplex, head: Buffer) => {
    const forwardPath = mapPath(req.url);
    if (!forwardPath || !forwardPath.startsWith("/socket.io/")) {
      rejectSocket(socket, "404 Not Found");
      return;
    }
    const proxyReq = https.request({ ...target, method: req.method, path: forwardPath, headers: buildForwardHeaders(req) });
    proxyReq.on("upgrade", (proxyRes, proxySocket, proxyHead) => {
      const lines = [`HTTP/1.1 ${proxyRes.statusCode} ${proxyRes.statusMessage}`];
      for (let i = 0; i < proxyRes.rawHeaders.length; i += 2) {
        lines.push(`${proxyRes.rawHeaders[i]}: ${proxyRes.rawHeaders[i + 1]}`);
      }
      socket.write(lines.join("\r\n") + "\r\n\r\n");
      if (proxyHead.length) socket.write(proxyHead);
      if (head.length) proxySocket.write(head);
      proxySocket.pipe(socket);
      socket.pipe(proxySocket);
      proxySocket.on("error", () => socket.destroy());
      socket.on("error", () => proxySocket.destroy());
    });
    proxyReq.on("response", (proxyRes) => {
      // 主伺服器拒絕升級（例如驗證失敗）
      rejectSocket(socket, `${proxyRes.statusCode} ${proxyRes.statusMessage}`);
      proxyRes.resume();
    });
    proxyReq.on("error", () => rejectSocket(socket, "502 Bad Gateway"));
    proxyReq.end();
  });

  server.on("error", (err) => console.error("[Remote Gateway] 學生專用入口無法啟動：", err.message));
  // 只綁本機：外網一律經由同一台電腦上的通道程式進來，區網裝置無法直接連這個埠
  server.listen(listenPort, "127.0.0.1", () => {
    console.log(`[MyClass] 學生在家專用入口：http://127.0.0.1:${listenPort}（請用 Tailscale Funnel 對外開放這個埠）`);
  });
  return server;
}
