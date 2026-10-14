// 課堂文字雲（Word Cloud）：
// 支援題目設定、學生重複詞彙限制、歷程儲存與清空
import { Router } from "express";
import { prisma } from "../db";
import { getNowStrTaipei } from "../timezone";
import { autoCatch } from "../asyncRoute";

export const wordCloudsRouter = autoCatch(Router());

// 取得課程所有的文字雲活動
wordCloudsRouter.get("/:courseId", async (req, res) => {
  const courseId = Number(req.params.courseId);
  const sessions = await prisma.wordCloudSession.findMany({
    where: { courseId },
    orderBy: { id: "desc" },
  });

  res.json(
    sessions.map((s) => ({
      id: s.id,
      course_id: s.courseId,
      title: s.title,
      status: s.status,
      allow_duplicate: s.allowDuplicate,
      max_words_per_user: s.maxWordsPerUser,
      words: JSON.parse(s.wordsData || "[]"),
      created_at: s.createdAt,
      updated_at: s.updatedAt,
    }))
  );
});

// 建立/啟動新的文字雲活動
wordCloudsRouter.post("/:courseId", async (req, res) => {
  const courseId = Number(req.params.courseId);
  const title = (req.body?.title ?? "").trim();
  if (!title) {
    res.status(400).json({ detail: "請填寫文字雲主題" });
    return;
  }
  const allowDuplicate = req.body?.allow_duplicate ? 1 : 0;
  const maxWordsPerUser = Number(req.body?.max_words_per_user) || 3;
  const now = getNowStrTaipei();

  const session = await prisma.wordCloudSession.create({
    data: {
      courseId,
      title,
      status: "active",
      allowDuplicate,
      maxWordsPerUser,
      wordsData: "[]",
      createdAt: now,
      updatedAt: now,
    },
  });

  res.json({
    id: session.id,
    course_id: session.courseId,
    title: session.title,
    status: session.status,
    allow_duplicate: session.allowDuplicate,
    max_words_per_user: session.maxWordsPerUser,
    words: [],
    created_at: session.createdAt,
    updated_at: session.updatedAt,
  });
});

// 取得單個文字雲活動詳情
wordCloudsRouter.get("/:courseId/:id", async (req, res) => {
  const courseId = Number(req.params.courseId);
  const id = Number(req.params.id);
  if (isNaN(courseId) || isNaN(id)) {
    res.status(400).json({ detail: "無效的 ID 參數" });
    return;
  }
  const session = await prisma.wordCloudSession.findFirst({
    where: { id, courseId },
  });
  if (!session) {
    res.status(404).json({ detail: "文字雲活動不存在" });
    return;
  }
  res.json({
    id: session.id,
    course_id: session.courseId,
    title: session.title,
    status: session.status,
    allow_duplicate: session.allowDuplicate,
    max_words_per_user: session.maxWordsPerUser,
    words: JSON.parse(session.wordsData || "[]"),
    created_at: session.createdAt,
    updated_at: session.updatedAt,
  });
});

// 更新文字雲狀態（結束收集/重啟收集/清空詞彙）
wordCloudsRouter.put("/:courseId/:id", async (req, res) => {
  const courseId = Number(req.params.courseId);
  const id = Number(req.params.id);
  if (isNaN(courseId) || isNaN(id)) {
    res.status(400).json({ detail: "無效的 ID 參數" });
    return;
  }
  const data: Record<string, unknown> = {};

  if (typeof req.body?.title === "string" && req.body.title.trim()) {
    data.title = req.body.title.trim();
  }
  if (typeof req.body?.status === "string") {
    data.status = req.body.status;
  }
  if (req.body?.clear_words === true) {
    data.wordsData = "[]";
  }
  data.updatedAt = getNowStrTaipei();

  const result = await prisma.wordCloudSession.updateMany({
    where: { id, courseId },
    data,
  });

  if (result.count === 0) {
    res.status(404).json({ detail: "文字雲活動不存在" });
    return;
  }

  res.json({ message: "文字雲已更新" });
});

// 刪除文字雲活動
wordCloudsRouter.delete("/:courseId/:id", async (req, res) => {
  const courseId = Number(req.params.courseId);
  const id = Number(req.params.id);
  if (isNaN(courseId) || isNaN(id)) {
    res.status(400).json({ detail: "無效的 ID 參數" });
    return;
  }
  await prisma.wordCloudSession.deleteMany({
    where: { id, courseId },
  });
  res.json({ message: "文字雲已刪除" });
});
