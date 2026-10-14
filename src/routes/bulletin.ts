// 課堂即時公布欄（Bulletin Board）：教學互動工具箱內可切換的多份佈告，內容改為寫入
// 資料庫（原本只存瀏覽器 localStorage，換機/清快取即遺失），見 static/js/toolkit.js
// 的 BulletinBoard 模組。
import { Router } from "express";
import { prisma } from "../db";
import { getNowStrTaipei } from "../timezone";
import { autoCatch } from "../asyncRoute";
import { broadcastToCourse } from "../realtime";

export const bulletinRouter = autoCatch(Router());

function serialize(post: { id: number; title: string; content: string; orderIndex: number; updatedAt: string }) {
  return {
    id: post.id,
    title: post.title,
    content: post.content,
    order_index: post.orderIndex,
    updated_at: post.updatedAt,
  };
}

bulletinRouter.get("/:courseId", async (req, res) => {
  const courseId = Number(req.params.courseId);
  const posts = await prisma.bulletinPost.findMany({
    where: { courseId },
    orderBy: [{ orderIndex: "asc" }, { id: "asc" }],
  });
  res.json(posts.map(serialize));
});

bulletinRouter.post("/:courseId", async (req, res) => {
  const courseId = Number(req.params.courseId);
  const title: string = (req.body?.title ?? "").trim();
  if (!title) {
    res.status(400).json({ detail: "請輸入佈告名稱" });
    return;
  }
  const content: string = typeof req.body?.content === "string" ? req.body.content : "";

  const last = await prisma.bulletinPost.findFirst({ where: { courseId }, orderBy: { orderIndex: "desc" } });
  const orderIndex = (last?.orderIndex ?? -1) + 1;
  const now = getNowStrTaipei();

  const post = await prisma.bulletinPost.create({
    data: { courseId, title, content, orderIndex, createdAt: now, updatedAt: now },
  });
  broadcastToCourse(courseId, "bulletin_updated");
  res.json(serialize(post));
});

bulletinRouter.put("/:courseId/:id", async (req, res) => {
  const courseId = Number(req.params.courseId);
  const id = Number(req.params.id);
  const data: Record<string, unknown> = {};
  if (typeof req.body?.title === "string" && req.body.title.trim()) data.title = req.body.title.trim();
  if (typeof req.body?.content === "string") data.content = req.body.content;
  if (Object.keys(data).length === 0) {
    res.status(400).json({ detail: "沒有可更新的欄位" });
    return;
  }
  data.updatedAt = getNowStrTaipei();

  const result = await prisma.bulletinPost.updateMany({ where: { id, courseId }, data });
  if (result.count === 0) {
    res.status(404).json({ detail: "Bulletin post not found" });
    return;
  }
  // 只有改名才通知其他畫面重新整理佈告清單；單純編輯內容很頻繁，不廣播以免干擾正在打字的畫面
  if (typeof data.title === "string") broadcastToCourse(courseId, "bulletin_updated");
  res.json({ message: "佈告已更新" });
});

bulletinRouter.delete("/:courseId/:id", async (req, res) => {
  const courseId = Number(req.params.courseId);
  await prisma.bulletinPost.deleteMany({ where: { id: Number(req.params.id), courseId } });
  broadcastToCourse(courseId, "bulletin_updated");
  res.json({ message: "佈告已刪除" });
});
