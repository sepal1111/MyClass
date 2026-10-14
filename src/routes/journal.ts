// 教學日誌（Lesson Log）：以課程為單位的教學進度／課堂記事，跟 notes.ts（針對個別學生的質性紀錄）
// 是不同維度的功能。tag 用簡單列舉區分性質：progress｜classroom｜material｜todo｜general，
// 其中 tag=todo 時 is_done 才有意義（待辦事項是否已處理）。subUnitId 選填，供老師選擇性關聯到
// 已建立的單元結構標示「教到哪」，沒有建立單元結構的老師仍可純文字記錄。
import fs from "fs";
import path from "path";
import { Router } from "express";
import multer from "multer";
import { prisma } from "../db";
import { getUploadsDir } from "../paths";
import { getNowStrTaipei, getTodayStrTaipei } from "../timezone";
import { autoCatch } from "../asyncRoute";
import { fixUploadFilename } from "../utils/upload";

export const journalRouter = autoCatch(Router());
const upload = multer({ storage: multer.memoryStorage() });

const VALID_TAGS = new Set(["progress", "classroom", "material", "todo", "general"]);

function normalizeTag(raw: unknown): string {
  return typeof raw === "string" && VALID_TAGS.has(raw) ? raw : "general";
}

type LessonLogRow = Awaited<ReturnType<typeof prisma.lessonLog.findFirst>> & {
  subUnit?: { id: number; title: string; unit: { id: number; title: string } } | null;
};

function serialize(log: LessonLogRow) {
  return {
    id: log!.id,
    course_id: log!.courseId,
    sub_unit_id: log!.subUnitId,
    sub_unit_title: log!.subUnit?.title ?? null,
    unit_title: log!.subUnit?.unit?.title ?? null,
    content: log!.content,
    tag: log!.tag,
    is_done: !!log!.isDone,
    media_url: log!.mediaUrl,
    media_type: log!.mediaType,
    date: log!.date,
    timestamp: log!.timestamp,
  };
}

journalRouter.get("/:courseId", async (req, res) => {
  const courseId = Number(req.params.courseId);
  const { start_date, end_date, tag, sub_unit_id, is_done } = req.query as Record<string, string | undefined>;

  const where: Record<string, unknown> = { courseId };
  if (tag && VALID_TAGS.has(tag)) where.tag = tag;
  if (sub_unit_id) where.subUnitId = Number(sub_unit_id);
  if (is_done === "true" || is_done === "false") where.isDone = is_done === "true" ? 1 : 0;
  if (start_date) where.date = { ...(where.date as object), gte: start_date };
  if (end_date) where.date = { ...(where.date as object), lte: end_date };

  const logs = await prisma.lessonLog.findMany({
    where,
    orderBy: { timestamp: "desc" },
    include: { subUnit: { select: { id: true, title: true, unit: { select: { id: true, title: true } } } } },
  });

  res.json(logs.map(serialize));
});

journalRouter.post("/:courseId", async (req, res) => {
  const courseId = Number(req.params.courseId);
  const content: string = (req.body?.content ?? "").trim();
  if (!content) {
    res.status(400).json({ detail: "請輸入日誌內容" });
    return;
  }
  const subUnitId = req.body?.sub_unit_id ? Number(req.body.sub_unit_id) : null;
  const tag = normalizeTag(req.body?.tag);
  const date: string = req.body?.date || getTodayStrTaipei();

  const log = await prisma.lessonLog.create({
    data: { courseId, subUnitId, content, tag, date, timestamp: getNowStrTaipei() },
  });
  res.json({ id: log.id, message: "教學日誌已新增" });
});

journalRouter.post("/:courseId/with_media", upload.single("media_file"), async (req, res) => {
  const courseId = Number(req.params.courseId);
  const content: string = (req.body?.content ?? "").trim() || "【附件紀錄】";
  const subUnitId = req.body?.sub_unit_id ? Number(req.body.sub_unit_id) : null;
  const tag = normalizeTag(req.body?.tag);
  const date: string = req.body?.date || getTodayStrTaipei();

  let mediaUrl: string | null = null;
  let mediaType: string | null = null;
  const file = req.file;

  if (file?.originalname) {
    file.originalname = fixUploadFilename(file.originalname);
    const journalDir = path.join(getUploadsDir(), "journal");
    fs.mkdirSync(journalDir, { recursive: true });
    const ext = path.extname(file.originalname).toLowerCase() || ".jpg";
    const filename = `${Date.now()}_${Math.random().toString(36).slice(2, 8)}${ext}`;
    fs.writeFileSync(path.join(journalDir, filename), file.buffer);
    mediaUrl = `/uploads/journal/${filename}`;

    const imgExts = [".jpg", ".jpeg", ".png", ".gif", ".webp", ".bmp"];
    mediaType = imgExts.includes(ext) ? "image" : file.mimetype?.startsWith("image/") ? "image" : "video";
  }

  const log = await prisma.lessonLog.create({
    data: { courseId, subUnitId, content, tag, mediaUrl, mediaType, date, timestamp: getNowStrTaipei() },
  });
  res.json({ id: log.id, media_url: mediaUrl, media_type: mediaType, message: "教學日誌已新增" });
});

journalRouter.put("/:courseId/:id", async (req, res) => {
  const courseId = Number(req.params.courseId);
  const id = Number(req.params.id);
  const data: Record<string, unknown> = {};
  if (typeof req.body?.content === "string") data.content = req.body.content.trim();
  if (req.body?.tag !== undefined) data.tag = normalizeTag(req.body.tag);
  if (req.body?.sub_unit_id !== undefined) data.subUnitId = req.body.sub_unit_id ? Number(req.body.sub_unit_id) : null;
  if (typeof req.body?.is_done === "boolean") data.isDone = req.body.is_done ? 1 : 0;
  if (typeof req.body?.date === "string" && req.body.date.trim()) data.date = req.body.date.trim();

  const result = await prisma.lessonLog.updateMany({ where: { id, courseId }, data });
  if (result.count === 0) {
    res.status(404).json({ detail: "Lesson log not found" });
    return;
  }
  res.json({ message: "教學日誌已更新" });
});

journalRouter.delete("/:courseId/:id", async (req, res) => {
  await prisma.lessonLog.deleteMany({ where: { id: Number(req.params.id), courseId: Number(req.params.courseId) } });
  res.json({ message: "教學日誌已刪除" });
});
