// 「僅限教師本機」的判斷：只看 TCP 實際來源，且帶有任何代理標頭就一律不算本機。
// 忘記密碼重設、作業掃描、安全關閉都靠這個判斷，判斷錯了等於把這些功能開放給區網或網際網路。
import { test } from "node:test";
import assert from "node:assert/strict";
import os from "os";
import type { Request } from "express";
import { isLocalRequest } from "../src/middleware/localOnly";

function fakeReq(remoteAddress: string | undefined, headers: Record<string, string> = {}): Request {
  return { headers, socket: { remoteAddress } } as unknown as Request;
}

test("本機迴路位址算本機", () => {
  assert.equal(isLocalRequest(fakeReq("127.0.0.1")), true);
  assert.equal(isLocalRequest(fakeReq("::1")), true);
  assert.equal(isLocalRequest(fakeReq("::ffff:127.0.0.1")), true);
});

test("這台電腦自己的網卡位址算本機", () => {
  const own = Object.values(os.networkInterfaces())
    .flat()
    .find((n) => n && n.family === "IPv4" && !n.internal);
  if (!own) return; // 沒有區網卡的環境略過
  assert.equal(isLocalRequest(fakeReq(own.address)), true);
});

test("區網其他裝置不算本機", () => {
  assert.equal(isLocalRequest(fakeReq("10.255.254.253")), false);
  assert.equal(isLocalRequest(fakeReq("192.0.2.10")), false);
});

test("沒有來源位址不算本機", () => {
  assert.equal(isLocalRequest(fakeReq(undefined)), false);
  assert.equal(isLocalRequest(fakeReq("")), false);
});

test("帶有任何代理標頭，即使來源是 127.0.0.1 也不算本機", () => {
  const proxyHeaders = [
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
  for (const h of proxyHeaders) {
    assert.equal(isLocalRequest(fakeReq("127.0.0.1", { [h]: "1.2.3.4" })), false, `標頭 ${h} 應視為經過代理`);
  }
});
