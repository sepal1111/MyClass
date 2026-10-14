// Port of app/routers/notes.py
import fs from "fs";
import path from "path";
import { Router } from "express";
import multer from "multer";
import { prisma } from "../db";
import { getUploadsDir } from "../paths";
import { getNowStrTaipei, getTodayStrTaipei } from "../timezone";
import { autoCatch } from "../asyncRoute";

export const notesRouter = autoCatch(Router());
const upload = multer({ storage: multer.memoryStorage() });

function sanitizeFilenamePart(text: string): string {
  const cleaned = text.replace(/[\\/*?:"<>|]/g, "").replace(/\s/g, "");
  return cleaned || "課程";
}

function buildMediaFilename(courseName: string, studentNumber: number, noteDateStr: string, filename: string) {
  const cleanCourse = sanitizeFilenamePart(courseName);
  const seatStr = String(studentNumber).padStart(2, "0");
  const cleanDate = noteDateStr.replace(/-/g, "");

  let ext = path.extname(filename).toLowerCase();
  if (!ext) ext = ".jpg";

  const baseName = `${cleanCourse}-${seatStr}-${cleanDate}`;
  let finalName = `${baseName}${ext}`;

  const notesDir = path.join(getUploadsDir(), "notes");
  fs.mkdirSync(notesDir, { recursive: true });

  let targetPath = path.join(notesDir, finalName);
  let idx = 1;
  while (fs.existsSync(targetPath)) {
    finalName = `${baseName}_${idx}${ext}`;
    targetPath = path.join(notesDir, finalName);
    idx++;
  }

  return { finalName, targetPath, ext };
}

notesRouter.get("/:courseId", async (req, res) => {
  const courseId = Number(req.params.courseId);
  const { student_id, start_date, end_date } = req.query as Record<string, string | undefined>;

  const where: Record<string, unknown> = { courseId };
  if (student_id) where.studentId = Number(student_id);
  if (start_date) where.date = { ...(where.date as object), gte: start_date };
  if (end_date) where.date = { ...(where.date as object), lte: end_date };

  const notes = await prisma.qualitativeNote.findMany({
    where,
    orderBy: { timestamp: "desc" },
    include: { student: { select: { studentNumber: true, name: true, englishName: true } } },
  });

  res.json(
    notes.map((n) => ({
      id: n.id,
      course_id: n.courseId,
      student_id: n.studentId,
      note_text: n.noteText,
      date: n.date,
      media_url: n.mediaUrl,
      media_type: n.mediaType,
      timestamp: n.timestamp,
      student_number: n.student.studentNumber,
      student_name: n.student.name,
      student_english_name: n.student.englishName,
    }))
  );
});

notesRouter.post("/:courseId/with_media", upload.single("media_file"), async (req, res) => {
  const courseId = Number(req.params.courseId);
  const studentId = Number(req.body?.student_id);
  const noteDate: string = req.body?.date_str || getTodayStrTaipei();
  const nowTime = getNowStrTaipei();
  const rawNoteText: string | undefined = req.body?.note_text;
  const finalNoteText = rawNoteText && rawNoteText.trim() ? rawNoteText.trim() : "【多媒體特殊表現紀錄】";

  const course = await prisma.course.findUnique({ where: { id: courseId } });
  if (!course) {
    res.status(404).json({ detail: "Course not found" });
    return;
  }
  const student = await prisma.student.findUnique({ where: { id: studentId } });
  if (!student) {
    res.status(404).json({ detail: "Student not found" });
    return;
  }

  let mediaUrl: string | null = null;
  let mediaType: string | null = null;
  const file = req.file;

  if (file?.originalname) {
    const { finalName, targetPath, ext } = buildMediaFilename(course.name, student.studentNumber, noteDate, file.originalname);
    fs.writeFileSync(targetPath, file.buffer);
    mediaUrl = `/uploads/notes/${finalName}`;

    const imgExts = [".jpg", ".jpeg", ".png", ".gif", ".webp", ".bmp"];
    const vidExts = [".mp4", ".mov", ".webm", ".avi", ".mkv"];
    if (imgExts.includes(ext)) {
      mediaType = "image";
    } else if (vidExts.includes(ext)) {
      mediaType = "video";
    } else {
      mediaType = file.mimetype?.startsWith("image/") ? "image" : "video";
    }
  }

  const note = await prisma.qualitativeNote.create({
    data: { courseId, studentId, noteText: finalNoteText, date: noteDate, mediaUrl, mediaType, timestamp: nowTime },
  });

  res.json({ id: note.id, media_url: mediaUrl, media_type: mediaType, message: "Note with media added successfully" });
});

notesRouter.post("/:courseId", async (req, res) => {
  const courseId = Number(req.params.courseId);
  const { student_id, note_text, date } = req.body ?? {};
  const noteDate: string = date || getTodayStrTaipei();
  const nowTime = getNowStrTaipei();

  const note = await prisma.qualitativeNote.create({
    data: { courseId, studentId: student_id, noteText: note_text, date: noteDate, timestamp: nowTime },
  });
  res.json({ id: note.id, message: "Note added successfully" });
});

notesRouter.delete("/:courseId/:noteId", async (req, res) => {
  await prisma.qualitativeNote.deleteMany({
    where: { id: Number(req.params.noteId), courseId: Number(req.params.courseId) },
  });
  res.json({ message: "Note deleted" });
});
