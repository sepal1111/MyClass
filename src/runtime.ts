// 執行中實例的資訊（bin/runtime.json）：
//  - 防止同一份資料被啟動兩次（第二次啟動只會開啟瀏覽器到既有網址，不再另開伺服器，避免兩個程序同時寫同一個 SQLite 資料庫）。
//  - 讓托盤程式（MyClass.exe）知道伺服器的埠號、連線網址，以及安全關閉用的一次性權杖。
import crypto from "crypto";
import fs from "fs";
import https from "https";
import path from "path";
import { getBinDir } from "./paths";

export interface RuntimeInfo {
  pid: number;
  port: number;
  /** 安全關閉用權杖：只存在這個檔案裡，托盤程式讀取後才能呼叫 /api/system/shutdown。 */
  token: string;
  local_url: string;
  lan_url: string;
  started_at: string;
}

const runtimePath = () => path.join(getBinDir(), "runtime.json");

export function newShutdownToken(): string {
  return crypto.randomBytes(24).toString("hex");
}

export function writeRuntimeInfo(info: RuntimeInfo): void {
  fs.writeFileSync(runtimePath(), JSON.stringify(info, null, 2), "utf-8");
}

export function readRuntimeInfo(): RuntimeInfo | null {
  try {
    return JSON.parse(fs.readFileSync(runtimePath(), "utf-8")) as RuntimeInfo;
  } catch {
    return null;
  }
}

/** 只在檔案內容仍是自己寫的才刪除，避免誤刪後來啟動的另一個實例的資訊。 */
export function clearRuntimeInfo(pid: number): void {
  const info = readRuntimeInfo();
  if (info && info.pid === pid) {
    try {
      fs.unlinkSync(runtimePath());
    } catch {
      /* best-effort */
    }
  }
}

function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    // EPERM＝程序存在但無權限傳訊號，仍視為存活
    return (err as NodeJS.ErrnoException).code === "EPERM";
  }
}

function probe(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const req = https.get({ host: "127.0.0.1", port, path: "/", timeout: 1500, rejectUnauthorized: false }, (res) => {
      resolve((res.statusCode ?? 0) > 0);
      res.resume();
    });
    req.on("error", () => resolve(false));
    req.on("timeout", () => {
      req.destroy();
      resolve(false);
    });
  });
}

/** 若同一份資料（同一個 bin/）已經有伺服器在執行，回傳它的資訊；否則回傳 null。 */
export async function findRunningInstance(): Promise<RuntimeInfo | null> {
  const info = readRuntimeInfo();
  if (!info || info.pid === process.pid || !isProcessAlive(info.pid)) return null;
  return (await probe(info.port)) ? info : null;
}

let shutdownHandler: (() => Promise<void>) | null = null;
export function registerShutdown(fn: () => Promise<void>): void {
  shutdownHandler = fn;
}

/** 安全關閉：先收掉連線與資料庫，最多等 4 秒，之後無論如何都結束程序。 */
export function requestShutdown(): void {
  const force = setTimeout(() => process.exit(0), 4000);
  force.unref();
  (shutdownHandler ? shutdownHandler() : Promise.resolve()).finally(() => process.exit(0));
}
