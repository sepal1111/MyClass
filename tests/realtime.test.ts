// 即時連線（Socket.io）的身分驗證與班級隔離：
// 沒帶憑證、密碼改過的舊憑證、經由學生專用入口的教師身分都會被斷線；
// 廣播只送到該班；學生不能送出教師專用的遙控事件。
import { after, before, describe, test } from "node:test";
import assert from "node:assert/strict";
import { getTodayMMDDTaipei } from "../src/timezone";
import { request, startTestServer, type TestServer } from "./helpers/server";
import { TestSocket } from "./helpers/socket";

let srv: TestServer;
let teacherToken = "";
let courseA = 0;
let courseB = 0;
let stuA = ""; // A 班學生的憑證（目前有效）
let stuAOld = ""; // A 班學生改密碼前的憑證（應失效）
let stuB = ""; // B 班學生的憑證

const bearer = (t: string) => ({ Authorization: `Bearer ${t}` });

/** 叫伺服器對某一班廣播 bulletin_updated（新增一則佈告） */
async function broadcastTo(courseId: number) {
  const r = await request(`${srv.base}/api/bulletin/${courseId}`, {
    method: "POST",
    headers: bearer(teacherToken),
    body: { title: "測試佈告", content: "" },
  });
  assert.equal(r.status, 200, r.text);
}

const gotBulletin = (s: TestSocket, courseId: number) => () =>
  s.events.some((e) => e.event === "bulletin_updated" && e.course_id === courseId);

before(async () => {
  srv = await startTestServer();
  const mmdd = getTodayMMDDTaipei();
  const login = await request(`${srv.base}/api/system/verify_password`, { method: "POST", body: { password: `Admin${mmdd}` } });
  teacherToken = login.json.auth_token;
  await request(`${srv.base}/api/system/update_password_prefix`, {
    method: "POST",
    headers: bearer(teacherToken),
    body: { current_password: `Admin${mmdd}`, new_prefix: "TestPrefix" },
  });
  const mkCourse = async (name: string) =>
    (await request(`${srv.base}/api/courses`, { method: "POST", headers: bearer(teacherToken), body: { name } })).json.id as number;
  courseA = await mkCourse("即時A班");
  courseB = await mkCourse("即時B班");

  const mkAndLogin = async (courseId: number, n: number, account: string) => {
    await request(`${srv.base}/api/courses/${courseId}/students`, {
      method: "POST",
      headers: bearer(teacherToken),
      body: { student_number: n, name: `學生${n}`, login_account: account, password: "init" },
    });
    const r = await request(`${srv.base}/api/auth/student/login_by_account`, { method: "POST", body: { account, password: "init" } });
    assert.equal(r.status, 200, r.text);
    return r.json.token as string;
  };
  stuAOld = await mkAndLogin(courseA, 1, "rt_a");
  stuB = await mkAndLogin(courseB, 2, "rt_b");
  const changed = await request(`${srv.base}/api/auth/student/change_password`, {
    method: "POST",
    headers: bearer(stuAOld),
    body: { current_password: "init", new_password: "Strong123" },
  });
  assert.equal(changed.status, 200, changed.text);
  stuA = changed.json.token;
});

after(async () => {
  await srv?.stop();
});

describe("即時連線的身分驗證", () => {
  test("沒帶憑證會被斷線", async () => {
    const s = await TestSocket.open(srv.base);
    assert.ok(await s.waitFor(() => s.disconnected), "應被伺服器斷線");
  });

  test("亂寫的憑證會被斷線", async () => {
    const s = await TestSocket.open(srv.base, { token: "not-a-token", course_id: courseA });
    assert.ok(await s.waitFor(() => s.disconnected));
  });

  test("密碼改過之後，舊的學生憑證會被斷線", async () => {
    const s = await TestSocket.open(srv.base, { token: stuAOld });
    assert.ok(await s.waitFor(() => s.disconnected));
  });

  test("教師憑證經由學生專用入口（外網）會被斷線", async () => {
    const s = await TestSocket.open(srv.remoteBase, { token: teacherToken, course_id: courseA });
    assert.ok(await s.waitFor(() => s.disconnected));
  });

  test("教師憑證在校內可以連線並收到該班事件", async () => {
    const s = await TestSocket.open(srv.base, { token: teacherToken, course_id: courseA, role: "desktop" });
    await s.settle();
    await broadcastTo(courseA);
    assert.ok(await s.waitFor(gotBulletin(s, courseA)), "老師應收到 A 班的事件");
    assert.equal(s.disconnected, false);
  });

  test("學生從外網用有效憑證可以連線", async () => {
    const remoteLogin = await request(`${srv.remoteBase}/api/auth/student/login_by_account`, {
      method: "POST",
      body: { account: "rt_a", password: "Strong123" },
    });
    assert.equal(remoteLogin.status, 200, remoteLogin.text);
    const s = await TestSocket.open(srv.remoteBase, { token: remoteLogin.json.token });
    await s.settle();
    await broadcastTo(courseA);
    assert.ok(await s.waitFor(gotBulletin(s, courseA)), "在家的 A 班學生應收到 A 班事件");
  });
});

describe("班級隔離", () => {
  test("廣播只送到該班：A 班學生收得到，B 班學生收不到", async () => {
    const a = await TestSocket.open(srv.base, { token: stuA });
    const b = await TestSocket.open(srv.base, { token: stuB });
    await Promise.all([a.settle(), b.settle()]);
    await broadcastTo(courseA);
    assert.ok(await a.waitFor(gotBulletin(a, courseA)), "A 班學生應收到");
    await b.waitFor(gotBulletin(b, courseA), 1500);
    assert.equal(b.events.some((e) => e.course_id === courseA), false, "B 班學生不應收到 A 班的事件");
  });

  test("學生帶 course_id 參數也不能加入別班", async () => {
    // 學生的班級只看憑證內容；就算自己在網址加上別班的 course_id 也沒用
    const b = await TestSocket.open(srv.base, { token: stuB, course_id: courseA });
    await b.settle();
    await broadcastTo(courseA);
    await b.waitFor(gotBulletin(b, courseA), 1500);
    assert.equal(b.events.some((e) => e.course_id === courseA), false);
  });

  test("學生不能送出教師專用的遙控事件（toolkit_action）", async () => {
    const t = await TestSocket.open(srv.base, { token: teacherToken, course_id: courseA, role: "projection" });
    const a = await TestSocket.open(srv.base, { token: stuA });
    await Promise.all([t.settle(), a.settle()]);
    await a.emit("toolkit_action", { action: "lucky_draw", payload: { fake: true } });
    await t.waitFor(() => t.events.some((e) => e.event === "toolkit_action"), 1500);
    assert.equal(
      t.events.some((e) => e.event === "toolkit_action"),
      false,
      "投影畫面不應收到學生送出的遙控事件"
    );
  });
});
