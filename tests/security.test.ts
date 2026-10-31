// 安全邊界的整合測試：啟動一份使用暫存資料夾的真正 MyClass，從
// 「未登入」「校內學生」「外網學生（學生專用入口）」「老師」四種身分去打，確認每道門都擋得住。
import { after, before, describe, test } from "node:test";
import assert from "node:assert/strict";
import crypto from "crypto";
import fs from "fs";
import https from "https";
import path from "path";
import jwt from "jsonwebtoken";
import { PrismaClient } from "@prisma/client";
import { getTodayMMDDTaipei } from "../src/timezone";
import { putUpload, request, ROOT, startTestServer, type TestServer } from "./helpers/server";

let srv: TestServer;
let teacher: Record<string, string>; // 教師的 Authorization 標頭
let teacherCookie: Record<string, string>; // 教師的 cookie（<img src> 走這條）
let courseA = 0;
let courseB = 0;
let stu1 = 0; // A 班，會改成夠強的密碼，可以在家登入
let stu3 = 0; // B 班
let stu1Token = ""; // 校內登入的學生憑證（密碼已改成強密碼之後）
let stu1RemoteToken = ""; // 外網登入的學生憑證
let myGroup = 0; // stu1 所屬的組
let otherGroup = 0; // stu1 不屬於的組
let collectionId = 0;

const NOTE_FILE = "notes/測試班-05-20261030.jpg"; // 觀察紀錄附件的實際命名規則：課程-座號-日期
const enc = (rel: string) => rel.split("/").map(encodeURIComponent).join("/");
const bearer = (t: string) => ({ Authorization: `Bearer ${t}` });

before(async () => {
  srv = await startTestServer();

  // 全新安裝：預設字頭 Admin，登入後先改字頭，其他教師 API 才能用
  const login = await request(`${srv.base}/api/system/verify_password`, {
    method: "POST",
    body: { password: `Admin${getTodayMMDDTaipei()}` },
  });
  assert.equal(login.status, 200, login.text);
  teacher = bearer(login.json.auth_token);
  teacherCookie = { Cookie: `auth_session=${login.json.auth_token}` };
  const changed = await request(`${srv.base}/api/system/update_password_prefix`, {
    method: "POST",
    headers: teacher,
    body: { current_password: `Admin${getTodayMMDDTaipei()}`, new_prefix: "TestPrefix" },
  });
  assert.equal(changed.status, 200, changed.text);

  const mkCourse = async (name: string) =>
    (await request(`${srv.base}/api/courses`, { method: "POST", headers: teacher, body: { name } })).json.id as number;
  courseA = await mkCourse("測試班");
  courseB = await mkCourse("別班");

  const mkStudent = async (courseId: number, n: number, account: string, password: string) => {
    const r = await request(`${srv.base}/api/courses/${courseId}/students`, {
      method: "POST",
      headers: teacher,
      body: { student_number: n, name: `學生${n}`, login_account: account, password },
    });
    assert.equal(r.status, 200, r.text);
    return r.json.id as number;
  };
  stu1 = await mkStudent(courseA, 5, "t_stu1", "init1");
  await mkStudent(courseA, 6, "t_stu2", "init2");
  stu3 = await mkStudent(courseB, 7, "t_stu3", "init3");

  // 各種附件
  putUpload(srv, "rewards/reward.png");
  putUpload(srv, NOTE_FILE);
  putUpload(srv, "journal/j.jpg");
  putUpload(srv, `materials/${courseA}/1/a.txt`);
  putUpload(srv, `materials/${courseB}/1/b.txt`);
  putUpload(srv, `submissions/${courseA}/1/student_${stu1}/mine.txt`);
  putUpload(srv, `submissions/${courseA}/1/student_${stu3}/other.txt`);

  // 小組與檔案蒐集：直接寫進測試資料庫（只是要有「誰屬於哪一組」「誰上傳了哪個檔」的紀錄）
  const db = new PrismaClient({ datasourceUrl: `file:${srv.dbPath}` });
  try {
    const plan = await db.groupPlan.create({ data: { courseId: courseA, name: "測試分組" } });
    const mine = await db.group.create({ data: { courseId: courseA, groupName: "第一組", planId: plan.id } });
    const other = await db.group.create({ data: { courseId: courseA, groupName: "第二組", planId: plan.id } });
    await db.groupMember.create({ data: { planId: plan.id, groupId: mine.id, studentId: stu1 } });
    myGroup = mine.id;
    otherGroup = other.id;
    putUpload(srv, `submissions/${courseA}/1/group_${myGroup}/g.txt`);
    putUpload(srv, `submissions/${courseA}/1/group_${otherGroup}/g.txt`);

    const now = "2026-10-30 12:00:00";
    const col = await db.fileCollection.create({ data: { courseId: courseA, title: "測試蒐集", createdAt: now } });
    const item = (studentId: number, file: string) =>
      db.fileCollectionItem.create({
        data: {
          collectionId: col.id,
          studentId,
          courseId: courseA,
          originalFilename: file,
          displayName: file,
          fileUrl: `/uploads/collections/${col.id}/${file}`,
          fileSize: 10,
          uploadedAt: now,
        },
      });
    await item(stu1, "mine.bin");
    await item(stu3, "other.bin");
    collectionId = col.id;
    for (const f of ["mine.bin", "other.bin", "orphan.bin"]) putUpload(srv, `collections/${col.id}/${f}`);
  } finally {
    await db.$disconnect();
  }
});

after(async () => {
  await srv?.stop();
});

describe("附件讀取 /uploads（校內）", () => {
  test("公開視覺資源（獎勵圖片）不用登入就能讀", async () => {
    const r = await request(`${srv.base}/uploads/rewards/reward.png`);
    assert.equal(r.status, 200);
  });

  test("觀察紀錄附件：未登入讀不到", async () => {
    assert.equal((await request(`${srv.base}/uploads/${enc(NOTE_FILE)}`)).status, 401);
  });

  test("觀察紀錄附件：老師的 cookie 讀得到", async () => {
    const r = await request(`${srv.base}/uploads/${enc(NOTE_FILE)}`, { headers: teacherCookie });
    assert.equal(r.status, 200);
  });

  // 2026-10-30 修正的漏洞：路徑開頭是公開資料夾，實際卻指向觀察紀錄
  const traversals = [
    `rewards/..%2F${enc(NOTE_FILE)}`,
    `rewards/%2e%2e%2F${enc(NOTE_FILE)}`,
    `rewards/%2E%2E%2f${enc(NOTE_FILE)}`,
    `groups/..%2F${enc(NOTE_FILE)}`,
    `card_backgrounds/..%2F${enc(NOTE_FILE)}`,
    `rewards/..%5C${enc(NOTE_FILE).replace("/", "%5C")}`, // Windows 反斜線
  ];
  for (const t of traversals) {
    test(`路徑穿越免登入讀不到觀察紀錄：/uploads/${decodeURIComponent(t).slice(0, 30)}…`, async () => {
      const r = await request(`${srv.base}/uploads/${t}`);
      assert.notEqual(r.status, 200, "穿越網址不應讀到檔案");
      assert.ok(!r.text.includes("content-of-"), "回應不應含有檔案內容");
    });
  }

  test("不能穿越到 uploads/ 外面（例如 bin/runtime.json）", async () => {
    const r = await request(`${srv.base}/uploads/rewards/..%2F..%2Fruntime.json`);
    assert.notEqual(r.status, 200);
    assert.ok(!r.text.includes("token"), "不應洩漏 runtime.json 內容");
  });
});

describe("學生登入與憑證", () => {
  let firstToken = "";

  test("第一次登入必須先改密碼，其他學生 API 一律 403", async () => {
    const r = await request(`${srv.base}/api/auth/student/login_by_account`, {
      method: "POST",
      body: { account: "t_stu1", password: "init1" },
    });
    assert.equal(r.status, 200, r.text);
    assert.equal(r.json.must_change_password, true);
    firstToken = r.json.token;
    const units = await request(`${srv.base}/api/student/units`, { headers: bearer(firstToken) });
    assert.equal(units.status, 403);
    assert.equal(units.json.code, "PASSWORD_CHANGE_REQUIRED");
  });

  test("帳號不分大小寫", async () => {
    const r = await request(`${srv.base}/api/auth/student/login_by_account`, {
      method: "POST",
      body: { account: "T_STU1", password: "init1" },
    });
    assert.equal(r.status, 200);
  });

  test("改密碼後，舊憑證立刻失效、新憑證可用", async () => {
    const r = await request(`${srv.base}/api/auth/student/change_password`, {
      method: "POST",
      headers: bearer(firstToken),
      body: { current_password: "init1", new_password: "weakpw" },
    });
    assert.equal(r.status, 200, r.text);
    assert.equal((await request(`${srv.base}/api/auth/student/me`, { headers: bearer(firstToken) })).status, 401);
    assert.equal((await request(`${srv.base}/api/auth/student/me`, { headers: bearer(r.json.token) })).status, 200);
    stu1Token = r.json.token;
  });

  test("外網：密碼太簡單不能在家登入", async () => {
    const r = await request(`${srv.remoteBase}/api/auth/student/login_by_account`, {
      method: "POST",
      body: { account: "t_stu1", password: "weakpw" },
    });
    assert.equal(r.status, 403);
    assert.equal(r.json.code, "REMOTE_WEAK_PASSWORD");
  });

  test("外網：還沒改過預設密碼的帳號不能在家登入", async () => {
    const r = await request(`${srv.remoteBase}/api/auth/student/login_by_account`, {
      method: "POST",
      body: { account: "t_stu2", password: "init2" },
    });
    assert.equal(r.status, 403);
    assert.equal(r.json.code, "REMOTE_REQUIRES_OWN_PASSWORD");
  });

  test("外網：改成強密碼後可以在家登入", async () => {
    const change = await request(`${srv.base}/api/auth/student/change_password`, {
      method: "POST",
      headers: bearer(stu1Token),
      body: { current_password: "weakpw", new_password: "Strong123" },
    });
    assert.equal(change.status, 200, change.text);
    stu1Token = change.json.token;
    const r = await request(`${srv.remoteBase}/api/auth/student/login_by_account`, {
      method: "POST",
      body: { account: "t_stu1", password: "Strong123" },
    });
    assert.equal(r.status, 200, r.text);
    stu1RemoteToken = r.json.token;
  });

  test("外網：只接受簽發 7 天內、帶密碼版本的憑證（校內仍可用）", async () => {
    // 直接從測試資料庫拿簽章金鑰，自己做出「8 天前簽發」與「舊式沒有 pwv」的憑證
    const db = new PrismaClient({ datasourceUrl: `file:${srv.dbPath}` });
    try {
      const secret = (await db.systemSetting.findUnique({ where: { key: "jwt_secret" } }))!.value;
      const hash = (await db.student.findUnique({ where: { id: stu1 } }))!.passwordHash ?? "";
      const pwv = crypto.createHash("sha256").update(hash).digest("base64url").slice(0, 16);
      const now = Math.floor(Date.now() / 1000);
      const old = jwt.sign({ studentId: stu1, courseId: courseA, pwv, iat: now - 8 * 86400, exp: now + 22 * 86400 }, secret);
      const legacy = jwt.sign({ studentId: stu1, courseId: courseA, iat: now, exp: now + 86400 }, secret);
      for (const [name, tok] of [["8 天前簽發", old], ["舊式沒有 pwv", legacy]] as const) {
        assert.equal((await request(`${srv.remoteBase}/api/auth/student/me`, { headers: bearer(tok) })).status, 401, `外網：${name}`);
        assert.equal((await request(`${srv.base}/api/auth/student/me`, { headers: bearer(tok) })).status, 200, `校內：${name}`);
      }
      const forged = jwt.sign({ studentId: stu1, courseId: courseA, pwv }, "wrong-secret");
      assert.equal((await request(`${srv.base}/api/auth/student/me`, { headers: bearer(forged) })).status, 401, "偽造簽章");
    } finally {
      await db.$disconnect();
    }
  });
});

describe("學生讀附件的範圍", () => {
  test("校內學生：讀得到自己班的教材", async () => {
    const r = await request(`${srv.base}/uploads/materials/${courseA}/1/a.txt`, { headers: bearer(stu1Token) });
    assert.equal(r.status, 200);
  });

  test("校內學生：讀不到觀察紀錄與教學日誌附件", async () => {
    for (const rel of [NOTE_FILE, "journal/j.jpg"]) {
      const r = await request(`${srv.base}/uploads/${enc(rel)}`, { headers: bearer(stu1Token) });
      assert.equal(r.status, 403, rel);
      const q = await request(`${srv.base}/uploads/${enc(rel)}?token=${encodeURIComponent(stu1Token)}`);
      assert.equal(q.status, 403, `${rel}（?token=）`);
    }
  });

  const remoteCases: Array<[string, () => string, number]> = [
    ["自己班的教材", () => `materials/${courseA}/1/a.txt`, 200],
    ["別班的教材", () => `materials/${courseB}/1/b.txt`, 403],
    ["自己的作業", () => `submissions/${courseA}/1/student_${stu1}/mine.txt`, 200],
    ["別人的作業", () => `submissions/${courseA}/1/student_${stu3}/other.txt`, 403],
    ["觀察紀錄", () => NOTE_FILE, 403],
    ["教學日誌", () => "journal/j.jpg", 403],
    ["自己小組的作業", () => `submissions/${courseA}/1/group_${myGroup}/g.txt`, 200],
    ["別組的作業", () => `submissions/${courseA}/1/group_${otherGroup}/g.txt`, 403],
    ["自己上傳的蒐集檔案", () => `collections/${collectionId}/mine.bin`, 200],
    ["別人上傳的蒐集檔案", () => `collections/${collectionId}/other.bin`, 403],
    ["沒有上傳紀錄的蒐集檔案", () => `collections/${collectionId}/orphan.bin`, 403],
  ];
  for (const [name, rel, expected] of remoteCases) {
    test(`外網學生：${name} → ${expected}`, async () => {
      const r = await request(`${srv.remoteBase}/uploads/${enc(rel())}`, { headers: bearer(stu1RemoteToken) });
      assert.equal(r.status, expected, r.text);
    });
  }

  test("外網：老師的 cookie 不被接受", async () => {
    const r = await request(`${srv.remoteBase}/uploads/${enc(NOTE_FILE)}`, { headers: teacherCookie });
    assert.equal(r.status, 401);
  });
});

describe("學生在家專用入口（白名單）", () => {
  test("/ 直接導向學生頁面", async () => {
    const r = await request(`${srv.remoteBase}/`);
    assert.equal(r.status, 200);
  });

  for (const p of ["/api/courses", "/api/system/verify_password", "/api/system/reset_password_prefix", "/guide", "/mobile", "/api/homework-scan/x"]) {
    test(`教師端路徑一律 404：${p}`, async () => {
      const r = await request(`${srv.remoteBase}${p}`, { method: p.includes("verify") || p.includes("reset") ? "POST" : "GET", headers: teacher });
      assert.equal(r.status, 404);
    });
  }

  for (const p of ["/static/..%2Fapi/courses", "/static/%2e%2e/api/courses", "/static/../api/courses", "/static/..%5Capi/courses", "/api/student/..%2F..%2Fapi/courses"]) {
    test(`編碼繞過白名單一律 404：${p}`, async () => {
      assert.equal((await request(`${srv.remoteBase}${p}`, { headers: teacher })).status, 404);
    });
  }
});

describe("僅限教師本機的功能", () => {
  test("帶有代理標頭的忘記密碼重設會被拒絕（字頭不變）", async () => {
    const r = await request(`${srv.base}/api/system/reset_password_prefix`, {
      method: "POST",
      headers: { "X-Forwarded-For": "203.0.113.9" },
    });
    assert.equal(r.status, 403);
    // 字頭沒有被重設：用新字頭還能登入
    const login = await request(`${srv.base}/api/system/verify_password`, {
      method: "POST",
      body: { password: `TestPrefix${getTodayMMDDTaipei()}` },
    });
    assert.equal(login.status, 200);
  });

  test("安全關閉需要正確的權杖", async () => {
    const r = await request(`${srv.base}/api/system/shutdown`, { method: "POST", headers: { "x-myclass-token": "wrong" } });
    assert.equal(r.status, 403);
  });
});

describe("教師 API 與 cookie", () => {
  test("未登入不能呼叫教師 API", async () => {
    assert.equal((await request(`${srv.base}/api/courses`)).status, 401);
  });

  test("學生憑證不能當教師憑證用", async () => {
    assert.equal((await request(`${srv.base}/api/courses`, { headers: bearer(stu1Token) })).status, 401);
  });

  test("登入 cookie 設為 HttpOnly（網頁程式讀不到）", async () => {
    const r = await new Promise<string[]>((resolve, reject) => {
      const body = JSON.stringify({ password: `TestPrefix${getTodayMMDDTaipei()}` });
      const u = new URL(srv.base);
      const req = https.request(
        { host: u.hostname, port: u.port, path: "/api/system/verify_password", method: "POST", rejectUnauthorized: false, headers: { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(body) } },
        (res) => {
          res.resume();
          resolve(res.headers["set-cookie"] ?? []);
        }
      );
      req.on("error", reject);
      req.end(body);
    });
    const cookie = r.find((c) => c.startsWith("auth_session="));
    assert.ok(cookie, "應該要設定 auth_session cookie");
    assert.match(cookie!, /HttpOnly/i);
  });
});

describe("前端輸出跳脫（回歸檢查）", () => {
  // 文字雲詞彙來自學生輸入，必須跳脫後才放進 innerHTML 或屬性值（2026-10-30 修正詞雲與詞頻排行榜）。
  // 模板字串裡直接出現 ${word}、${w.word} 就是沒跳脫。
  for (const file of ["static/js/toolkit/word-cloud.js", "static/js/projection.js"]) {
    test(`${file} 的文字雲詞彙都有跳脫`, () => {
      const src = fs.readFileSync(path.join(ROOT, file), "utf-8");
      assert.ok(src.includes("word"), "檔案內容不對（找不到文字雲程式）");
      const raw = src.match(/\$\{\s*(?:w\.)?word\s*\}/g) ?? [];
      assert.deepEqual(raw, [], "文字雲詞彙應先經過跳脫函式");
    });
  }

  test("共用 escapeHtml 會轉換引號（才能用在屬性值）", () => {
    const src = fs.readFileSync(path.join(ROOT, "static/js/toolkit/common.js"), "utf-8");
    const TK: { escapeHtml?: (s: unknown) => string } = {};
    // common.js 只需要 window；在這裡給它一個假的 window 執行
    new Function("window", src)({ ToolkitModules: TK });
    assert.equal(TK.escapeHtml!(`<img src=x onerror="a">'&`), "&lt;img src=x onerror=&quot;a&quot;&gt;&#39;&amp;");
    assert.equal(TK.escapeHtml!(null), "");
  });
});
