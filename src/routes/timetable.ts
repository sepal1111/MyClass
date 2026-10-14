// 課表（Timetable）：教師設定每週課表，前端開啟時比對當下時間，提醒這一節是哪一班的什麼課
// （見 static/js/timetable.js）。
//
// - 作息節次（timetable_periods）與科目清單（timetable_subjects）為全域設定，預設值於 db.ts 首次建立時寫入。
// - 課表格子（timetable_entries）以「星期 × 節次」為唯一鍵；科目存文字，手動輸入的新科目會自動加入科目清單。
import { Router } from "express";
import { prisma } from "../db";
import { autoCatch } from "../asyncRoute";

export const timetableRouter = autoCatch(Router());

const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;
const text = (v: unknown, max: number): string => (typeof v === "string" ? v.trim().slice(0, max) : "");

type PeriodRow = { id: number; name: string; startTime: string; endTime: string };
type EntryRow = { id: number; weekday: number; periodId: number; courseId: number | null; subject: string; note: string | null };

const serializePeriod = (p: PeriodRow) => ({ id: p.id, name: p.name, start_time: p.startTime, end_time: p.endTime });
const serializeEntry = (e: EntryRow) => ({
  id: e.id,
  weekday: e.weekday,
  period_id: e.periodId,
  course_id: e.courseId,
  subject: e.subject,
  note: e.note ?? "",
});

const listSubjects = () => prisma.timetableSubject.findMany({ orderBy: [{ sortOrder: "asc" }, { id: "asc" }] });

async function addSubject(name: string) {
  const existing = await prisma.timetableSubject.findUnique({ where: { name } });
  if (existing) return existing;
  const last = await prisma.timetableSubject.findFirst({ orderBy: { sortOrder: "desc" } });
  return prisma.timetableSubject.create({ data: { name, sortOrder: (last?.sortOrder ?? 0) + 1 } });
}

const ROLES = new Set(["homeroom", "subject"]);

async function getSetting(key: string): Promise<string> {
  return (await prisma.systemSetting.findUnique({ where: { key } }))?.value ?? "";
}

async function setSetting(key: string, value: string): Promise<void> {
  await prisma.systemSetting.upsert({ where: { key }, create: { key, value }, update: { value } });
}

timetableRouter.get("", async (_req, res) => {
  const [periods, subjects, entries, assignments, role, homeCourse] = await Promise.all([
    prisma.timetablePeriod.findMany({ orderBy: [{ startTime: "asc" }, { id: "asc" }] }),
    listSubjects(),
    prisma.timetableEntry.findMany(),
    prisma.teachingAssignment.findMany({ orderBy: { id: "asc" } }),
    getSetting("teacher_role"),
    getSetting("timetable_home_course_id"),
  ]);
  res.json({
    role: ROLES.has(role) ? role : "",
    home_course_id: Number(homeCourse) || null,
    periods: periods.map(serializePeriod),
    subjects: subjects.map((s) => ({ id: s.id, name: s.name })),
    entries: entries.map(serializeEntry),
    assignments: assignments.map((a) => ({ id: a.id, course_id: a.courseId, subject: a.subject })),
  });
});

// ---------- 教師身分與任教清單 ----------

timetableRouter.put("/profile", async (req, res) => {
  if (req.body?.role !== undefined) {
    if (!ROLES.has(req.body.role)) {
      res.status(400).json({ detail: "教師身分不正確" });
      return;
    }
    await setSetting("teacher_role", req.body.role);
  }
  if (req.body?.home_course_id !== undefined) {
    const id = Number(req.body.home_course_id) || 0;
    if (id && !(await prisma.course.findUnique({ where: { id } }))) {
      res.status(404).json({ detail: "找不到這個班級" });
      return;
    }
    await setSetting("timetable_home_course_id", id ? String(id) : "");
  }
  res.json({ message: "已儲存" });
});

timetableRouter.post("/assignments", async (req, res) => {
  const courseId = Number(req.body?.course_id);
  const subject = text(req.body?.subject, 20);
  if (!subject) {
    res.status(400).json({ detail: "請選擇或輸入科目" });
    return;
  }
  if (!(await prisma.course.findUnique({ where: { id: courseId } }))) {
    res.status(404).json({ detail: "找不到這個班級" });
    return;
  }
  await addSubject(subject);
  const row = await prisma.teachingAssignment.upsert({
    where: { courseId_subject: { courseId, subject } },
    create: { courseId, subject },
    update: {},
  });
  res.json({
    assignment: { id: row.id, course_id: row.courseId, subject: row.subject },
    subjects: (await listSubjects()).map((s) => ({ id: s.id, name: s.name })),
  });
});

timetableRouter.delete("/assignments/:id", async (req, res) => {
  // 只從任教清單移除；已排入課表的格子保留
  await prisma.teachingAssignment.deleteMany({ where: { id: Number(req.params.id) } });
  res.json({ message: "已移除" });
});

// ---------- 作息節次 ----------

function parsePeriodBody(body: Record<string, unknown> | undefined, current?: PeriodRow) {
  const name = body?.name !== undefined ? text(body.name, 20) : current?.name ?? "";
  const startTime = body?.start_time !== undefined ? text(body.start_time, 5) : current?.startTime ?? "";
  const endTime = body?.end_time !== undefined ? text(body.end_time, 5) : current?.endTime ?? "";
  if (!name) return { error: "請填寫節次名稱" };
  if (!TIME_RE.test(startTime) || !TIME_RE.test(endTime)) return { error: "時間格式不正確" };
  if (startTime >= endTime) return { error: "結束時間必須晚於開始時間" };
  return { data: { name, startTime, endTime } };
}

timetableRouter.post("/periods", async (req, res) => {
  const parsed = parsePeriodBody(req.body);
  if (!parsed.data) {
    res.status(400).json({ detail: parsed.error });
    return;
  }
  res.json(serializePeriod(await prisma.timetablePeriod.create({ data: parsed.data })));
});

timetableRouter.put("/periods/:id", async (req, res) => {
  const id = Number(req.params.id);
  const current = await prisma.timetablePeriod.findUnique({ where: { id } });
  if (!current) {
    res.status(404).json({ detail: "找不到這個節次" });
    return;
  }
  const parsed = parsePeriodBody(req.body, current);
  if (!parsed.data) {
    res.status(400).json({ detail: parsed.error });
    return;
  }
  res.json(serializePeriod(await prisma.timetablePeriod.update({ where: { id }, data: parsed.data })));
});

timetableRouter.delete("/periods/:id", async (req, res) => {
  const id = Number(req.params.id);
  // 不依賴連線層級的 PRAGMA foreign_keys，明確先刪掉這個節次的課表格子
  await prisma.timetableEntry.deleteMany({ where: { periodId: id } });
  await prisma.timetablePeriod.deleteMany({ where: { id } });
  res.json({ message: "節次已刪除" });
});

// ---------- 科目清單 ----------

timetableRouter.post("/subjects", async (req, res) => {
  const name = text(req.body?.name, 20);
  if (!name) {
    res.status(400).json({ detail: "請填寫科目名稱" });
    return;
  }
  const row = await addSubject(name);
  res.json({ id: row.id, name: row.name });
});

timetableRouter.delete("/subjects/:id", async (req, res) => {
  // 只從快速選單移除；已排入課表的格子保留原本的科目文字
  await prisma.timetableSubject.deleteMany({ where: { id: Number(req.params.id) } });
  res.json({ message: "科目已刪除" });
});

// ---------- 課表格子 ----------

timetableRouter.put("/entry", async (req, res) => {
  const weekday = Number(req.body?.weekday);
  const periodId = Number(req.body?.period_id);
  if (!Number.isInteger(weekday) || weekday < 1 || weekday > 5) {
    res.status(400).json({ detail: "星期不正確" });
    return;
  }
  if (!(await prisma.timetablePeriod.findUnique({ where: { id: periodId } }))) {
    res.status(404).json({ detail: "找不到這個節次" });
    return;
  }
  const subject = text(req.body?.subject, 20);
  const note = text(req.body?.note, 40);
  let courseId: number | null = req.body?.course_id ? Number(req.body.course_id) : null;
  if (courseId && !(await prisma.course.findUnique({ where: { id: courseId } }))) courseId = null;

  // 什麼都沒填＝清除這一節
  if (!subject && !note && !courseId) {
    await prisma.timetableEntry.deleteMany({ where: { weekday, periodId } });
    res.json({ entry: null, subjects: (await listSubjects()).map((s) => ({ id: s.id, name: s.name })) });
    return;
  }

  if (subject) await addSubject(subject);
  const data = { courseId, subject, note: note || null };
  const entry = await prisma.timetableEntry.upsert({
    where: { weekday_periodId: { weekday, periodId } },
    create: { weekday, periodId, ...data },
    update: data,
  });
  res.json({ entry: serializeEntry(entry), subjects: (await listSubjects()).map((s) => ({ id: s.id, name: s.name })) });
});
