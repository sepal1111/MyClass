// 測試用伺服器：用暫存資料夾（MYCLASS_BIN_DIR）啟動一份真正的 MyClass，
// 所以測試不會讀寫程式旁真正的 bin/（班級、學生、成績資料）。
import { spawn, type ChildProcess } from "child_process";
import fs from "fs";
import http from "http";
import https from "https";
import net from "net";
import os from "os";
import path from "path";

export const ROOT = path.resolve(__dirname, "..", "..");

export interface HttpResult {
  status: number;
  text: string;
  json: any; // eslint-disable-line @typescript-eslint/no-explicit-any
}

export interface RequestOptions {
  method?: string;
  headers?: Record<string, string>;
  /** 以 JSON 送出 */
  body?: unknown;
  /** 原樣送出的文字（Socket.io 輪詢用） */
  rawBody?: string;
  /** 逾時就中斷，回傳 status 0（用來確認「一段時間內沒有收到東西」） */
  timeoutMs?: number;
}

/** 對測試伺服器發請求（接受自簽憑證）。url 以 http:// 開頭時走一般 HTTP（學生專用入口）。 */
export function request(url: string, opts: RequestOptions = {}): Promise<HttpResult> {
  const u = new URL(url);
  const isHttps = u.protocol === "https:";
  const payload = opts.rawBody ?? (opts.body === undefined ? undefined : JSON.stringify(opts.body));
  const headers: Record<string, string> = { ...(opts.headers ?? {}) };
  if (payload !== undefined) {
    headers["Content-Type"] ??= opts.rawBody !== undefined ? "text/plain;charset=UTF-8" : "application/json";
    headers["Content-Length"] = String(Buffer.byteLength(payload));
  }
  return new Promise((resolve, reject) => {
    const req = (isHttps ? https : http).request(
      {
        host: u.hostname,
        port: u.port,
        // 保留原始路徑（含 %2F 等編碼），不讓 URL 物件幫忙正規化
        path: url.slice(url.indexOf(u.host) + u.host.length),
        method: opts.method ?? "GET",
        headers,
        rejectUnauthorized: false,
      },
      (res) => {
        const chunks: Buffer[] = [];
        res.on("data", (c) => chunks.push(c));
        res.on("end", () => {
          const text = Buffer.concat(chunks).toString("utf-8");
          let json: unknown = null;
          try {
            json = JSON.parse(text);
          } catch {
            /* 不是 JSON */
          }
          resolve({ status: res.statusCode ?? 0, text, json });
        });
      }
    );
    let timedOut = false;
    if (opts.timeoutMs) {
      req.setTimeout(opts.timeoutMs, () => {
        timedOut = true;
        req.destroy();
        resolve({ status: 0, text: "", json: null });
      });
    }
    req.on("error", (err) => {
      if (!timedOut) reject(err);
    });
    if (payload !== undefined) req.write(payload);
    req.end();
  });
}

function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.once("error", reject);
    srv.listen(0, "127.0.0.1", () => {
      const port = (srv.address() as net.AddressInfo).port;
      srv.close(() => resolve(port));
    });
  });
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export interface TestServer {
  /** 教師／校內入口，例如 https://127.0.0.1:8001 */
  base: string;
  /** 學生在家專用入口，例如 http://127.0.0.1:54321 */
  remoteBase: string;
  binDir: string;
  uploadsDir: string;
  dbPath: string;
  stop(): Promise<void>;
}

export async function startTestServer(): Promise<TestServer> {
  const binDir = fs.mkdtempSync(path.join(os.tmpdir(), "myclass-test-"));
  const remotePort = await freePort();
  let log = "";

  const child: ChildProcess = spawn(process.execPath, ["--import", "tsx", "src/index.ts", "--background"], {
    cwd: ROOT,
    env: {
      ...process.env,
      MYCLASS_BIN_DIR: binDir,
      MYCLASS_HOST: "127.0.0.1",
      MYCLASS_REMOTE_PORT: String(remotePort),
      MYCLASS_NO_UPDATE_CHECK: "1",
      CLASSROOM_DB_PATH: "",
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  const exitPromise = new Promise<boolean>((r) => child.once("exit", () => r(true)));
  child.stdout?.on("data", (d) => (log += d));
  child.stderr?.on("data", (d) => (log += d));

  // 等 runtime.json 出現（伺服器開始監聽後才會寫入）
  const runtimeFile = path.join(binDir, "runtime.json");
  const deadline = Date.now() + 60_000;
  let port = 0;
  let shutdownToken = "";
  while (Date.now() < deadline) {
    if (child.exitCode !== null) throw new Error(`測試伺服器啟動失敗：\n${log}`);
    if (fs.existsSync(runtimeFile)) {
      try {
        const info = JSON.parse(fs.readFileSync(runtimeFile, "utf-8"));
        port = info.port;
        shutdownToken = info.token;
        break;
      } catch {
        /* 檔案寫到一半，再等一下 */
      }
    }
    await sleep(200);
  }
  if (!port) {
    child.kill();
    throw new Error(`測試伺服器 60 秒內沒有啟動：\n${log}`);
  }

  const base = `https://127.0.0.1:${port}`;
  const remoteBase = `http://127.0.0.1:${remotePort}`;
  // 兩個入口都要能回應
  for (const url of [`${base}/`, `${remoteBase}/student`]) {
    while (true) {
      try {
        if ((await request(url)).status === 200) break;
      } catch {
        /* 還沒準備好 */
      }
      if (Date.now() > deadline) throw new Error(`測試伺服器沒有回應 ${url}：\n${log}`);
      await sleep(200);
    }
  }

  return {
    base,
    remoteBase,
    binDir,
    uploadsDir: path.join(binDir, "uploads"),
    dbPath: path.join(binDir, "classroom_record.db"),
    async stop() {
      try {
        await request(`${base}/api/system/shutdown`, { method: "POST", headers: { "x-myclass-token": shutdownToken } });
      } catch {
        /* 已經關了 */
      }
      const exited = await Promise.race([exitPromise, sleep(8000).then(() => false)]);
      if (!exited && child.exitCode === null) child.kill();
      // Windows 上 SQLite 檔案可能還被鎖住一下，多試幾次
      try {
        fs.rmSync(binDir, { recursive: true, force: true, maxRetries: 10, retryDelay: 300 });
      } catch {
        /* 暫存資料夾刪不掉不影響測試結果 */
      }
    },
  };
}

/** 在測試資料夾的 uploads/ 底下建立檔案，回傳檔案內容方便比對。 */
export function putUpload(srv: TestServer, rel: string, content = `content-of-${rel}`): string {
  const file = path.join(srv.uploadsDir, ...rel.split("/"));
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, content);
  return content;
}
