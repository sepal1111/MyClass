// 極簡的 Socket.io 測試客戶端：直接走 Engine.IO v4 的 HTTP 輪詢協定，
// 不用另外安裝 socket.io-client。只支援測試需要的部分：連線、收事件、判斷是否被伺服器斷線。
//
// 封包格式（多個封包以 \x1e 分隔）：
//   0{...}  Engine.IO 開啟（含 sid）    2  ping（要回 3）     1  關閉
//   40{...} Socket.io 已連線             41 被伺服器斷線       42[...] 事件
import { request } from "./server";

const SEP = "\x1e";

export interface ServerEvent {
  event: string;
  course_id?: number;
  payload?: unknown;
}

export class TestSocket {
  private sid = "";
  connected = false;
  disconnected = false;
  events: ServerEvent[] = [];

  private constructor(private readonly base: string, private readonly query: string) {}

  /** query 例如 { token, course_id }；base 是 https://…（校內）或 http://…（學生專用入口） */
  static async open(base: string, query: Record<string, string | number> = {}): Promise<TestSocket> {
    const qs = Object.entries(query)
      .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(String(v))}`)
      .join("&");
    const s = new TestSocket(base, qs);
    const open = await request(s.url(false));
    const first = open.text.split(SEP).find((p) => p.startsWith("0"));
    if (!first) throw new Error(`Socket.io 握手失敗（${open.status}）：${open.text}`);
    s.sid = JSON.parse(first.slice(1)).sid;
    await s.send("40");
    return s;
  }

  private url(withSid = true): string {
    const q = this.query ? `&${this.query}` : "";
    return `${this.base}/socket.io/?EIO=4&transport=polling${q}${withSid ? `&sid=${this.sid}` : ""}`;
  }

  private async send(packet: string): Promise<void> {
    await request(this.url(), { method: "POST", rawBody: packet });
  }

  /** 送出事件（等同 socket.emit(name, data)） */
  async emit(name: string, data: unknown): Promise<void> {
    await this.send(`42${JSON.stringify([name, data])}`);
  }

  /** 輪詢一次；timeoutMs 內沒有資料就回傳（並結束這條連線，之後不要再用）。 */
  private async pollOnce(timeoutMs: number): Promise<boolean> {
    const r = await request(this.url(), { timeoutMs });
    if (r.status === 0) return false;
    if (r.status !== 200) {
      this.disconnected = true;
      return true;
    }
    for (const p of r.text.split(SEP)) {
      if (p.startsWith("40")) this.connected = true;
      else if (p === "41" || p === "1") this.disconnected = true;
      else if (p === "2") await this.send("3");
      else if (p.startsWith("42")) {
        const [name, data] = JSON.parse(p.slice(2));
        if (name === "server_event") this.events.push(data as ServerEvent);
      }
    }
    return true;
  }

  /** 一直輪詢，直到條件成立（回傳 true）或超過 timeoutMs（回傳 false）。 */
  async waitFor(cond: () => boolean, timeoutMs = 3000): Promise<boolean> {
    const deadline = Date.now() + timeoutMs;
    while (!cond()) {
      if (this.disconnected) return cond();
      const left = deadline - Date.now();
      if (left <= 0) return false;
      if (!(await this.pollOnce(left))) return cond();
    }
    return true;
  }

  /** 等伺服器處理完連線（伺服器會非同步驗證身分、加入班級房間）。只是等待、不輪詢：
   *  輪詢逾時會讓伺服器關閉連線，期間的封包伺服器會先暫存，下次輪詢再一起收。 */
  async settle(ms = 800): Promise<void> {
    await new Promise((r) => setTimeout(r, ms));
  }
}
