// 作業掃描登記（移植自 Examscan 的「收作業」模組）。整組路由掛在 requireLocalOnly 之後
// （見 index.ts），只有教師本機能呼叫；資料寫入 hw_items / hw_plans / hw_records。
//
// 掃描內容格式（與 Examscan 相同）：
//   ES:H:<學生ID>:<作業ID>  作業簿專屬 QR Code：只登記自己代表的那一項
//   ES:I:<作業ID>           作業項目 QR Code：切換「現在收」的作業
//   其他                    視為學生借書證條碼（比對 students.student_code）
import { Router } from "express";
import ExcelJS from "exceljs";
import QRCode from "qrcode";
import { prisma } from "../db";
import { getNowStrTaipei, getTodayStrTaipei } from "../timezone";
import { autoCatch } from "../asyncRoute";

export const homeworkScanRouter = autoCatch(Router());

const STATUS = { SUBMITTED: "已繳交", LATE: "補繳", LEAVE: "請假", MISSING: "未交" } as const;
const VALID_STATUS = new Set<string>([STATUS.SUBMITTED, STATUS.LATE, STATUS.LEAVE]);
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

const dateOf = (v: unknown): string => (typeof v === "string" && DATE_RE.test(v) ? v : getTodayStrTaipei());

function serializeStudent(s: { id: number; studentNumber: number; name: string; studentCode: string | null }) {
  return { id: s.id, number: s.studentNumber, name: s.name, code: s.studentCode ?? "" };
}

type Rec = { studentId: number; itemId: number; status: string; recordedAt: string; method: string };
const serializeRecord = (r: Rec) => ({
  student_id: r.studentId,
  item_id: r.itemId,
  status: r.status,
  time: r.recordedAt,
  method: r.method,
});

async function activeStudents(courseId: number) {
  return prisma.student.findMany({ where: { courseId, isActive: 1 }, orderBy: { studentNumber: "asc" } });
}

async function planItemIds(courseId: number, date: string): Promise<number[]> {
  const rows = await prisma.homeworkPlan.findMany({ where: { courseId, planDate: date }, orderBy: { id: "asc" } });
  return rows.map((r) => r.itemId);
}

async function addToPlan(courseId: number, date: string, itemId: number) {
  await prisma.homeworkPlan.upsert({
    where: { courseId_planDate_itemId: { courseId, planDate: date, itemId } },
    create: { courseId, planDate: date, itemId },
    update: {},
  });
}

/** 寫入一筆繳交狀態；狀態相同視為重複掃描（duplicate），不改動原紀錄。 */
async function upsertRecord(
  courseId: number,
  date: string,
  studentId: number,
  itemId: number,
  status: string,
  method: string,
  time = getNowStrTaipei()
) {
  const key = { itemId_studentId_recordDate: { itemId, studentId, recordDate: date } };
  const existing = await prisma.homeworkRecord.findUnique({ where: key });
  if (existing && existing.status === status) return { duplicate: true, previous: existing, record: existing };
  const record = await prisma.homeworkRecord.upsert({
    where: key,
    create: { courseId, itemId, studentId, recordDate: date, status, recordedAt: time, method },
    update: { status, recordedAt: time, method },
  });
  return { duplicate: false, previous: existing, record };
}

const previousOf = (r: Rec | null) => (r ? { status: r.status, time: r.recordedAt, method: r.method } : null);

// --- 作業項目 ---

homeworkScanRouter.get("/:courseId/items", async (req, res) => {
  const courseId = Number(req.params.courseId);
  const items = await prisma.homeworkItem.findMany({
    where: { courseId },
    orderBy: { id: "asc" },
    include: { _count: { select: { records: true } } },
  });
  res.json(
    items.map((i) => ({ id: i.id, name: i.name, archived: i.archived === 1, record_count: i._count.records }))
  );
});

homeworkScanRouter.post("/:courseId/items", async (req, res) => {
  const courseId = Number(req.params.courseId);
  const name = String(req.body?.name ?? "").trim();
  if (!name) {
    res.status(400).json({ detail: "請輸入作業名稱" });
    return;
  }
  if (await prisma.homeworkItem.findUnique({ where: { courseId_name: { courseId, name } } })) {
    res.status(400).json({ detail: `「${name}」已經有了` });
    return;
  }
  const item = await prisma.homeworkItem.create({ data: { courseId, name, createdAt: getNowStrTaipei() } });
  res.json({ id: item.id, name: item.name, archived: false, record_count: 0 });
});

homeworkScanRouter.put("/:courseId/items/:id", async (req, res) => {
  const courseId = Number(req.params.courseId);
  const id = Number(req.params.id);
  const data: { name?: string; archived?: number } = {};
  if (typeof req.body?.name === "string") {
    const name = req.body.name.trim();
    if (!name) {
      res.status(400).json({ detail: "名稱不能是空白" });
      return;
    }
    const dup = await prisma.homeworkItem.findUnique({ where: { courseId_name: { courseId, name } } });
    if (dup && dup.id !== id) {
      res.status(400).json({ detail: `「${name}」已經有了` });
      return;
    }
    data.name = name;
  }
  if (typeof req.body?.archived === "boolean") data.archived = req.body.archived ? 1 : 0;
  const result = await prisma.homeworkItem.updateMany({ where: { id, courseId }, data });
  if (result.count === 0) {
    res.status(404).json({ detail: "找不到這個作業項目" });
    return;
  }
  res.json({ message: "已更新" });
});

homeworkScanRouter.delete("/:courseId/items/:id", async (req, res) => {
  await prisma.homeworkItem.deleteMany({ where: { id: Number(req.params.id), courseId: Number(req.params.courseId) } });
  res.json({ message: "已刪除" });
});

// --- 單日畫面資料：名冊、這天的計畫、繳交紀錄 ---

homeworkScanRouter.get("/:courseId/day", async (req, res) => {
  const courseId = Number(req.params.courseId);
  const date = dateOf(req.query.date);
  const [students, plan, records] = await Promise.all([
    activeStudents(courseId),
    planItemIds(courseId, date),
    prisma.homeworkRecord.findMany({ where: { courseId, recordDate: date } }),
  ]);
  res.json({
    date,
    students: students.map(serializeStudent),
    plan,
    records: records.map(serializeRecord),
  });
});

homeworkScanRouter.put("/:courseId/plan", async (req, res) => {
  const courseId = Number(req.params.courseId);
  const date = dateOf(req.body?.date);
  const ids: number[] = Array.isArray(req.body?.item_ids) ? req.body.item_ids.map(Number).filter(Number.isInteger) : [];
  const valid = await prisma.homeworkItem.findMany({ where: { courseId, id: { in: ids } }, select: { id: true } });
  const validIds = ids.filter((id) => valid.some((v) => v.id === id));
  await prisma.$transaction([
    prisma.homeworkPlan.deleteMany({ where: { courseId, planDate: date } }),
    ...validIds.map((itemId) => prisma.homeworkPlan.create({ data: { courseId, planDate: date, itemId } })),
  ]);
  res.json({ plan: validIds });
});

// --- 掃描：由伺服器解析內容並登記，回傳結果與復原所需的舊狀態 ---

homeworkScanRouter.post("/:courseId/scan", async (req, res) => {
  const courseId = Number(req.params.courseId);
  const date = dateOf(req.body?.date);
  const raw = String(req.body?.code ?? "").trim();
  const selected: number[] = Array.isArray(req.body?.item_ids) ? req.body.item_ids.map(Number) : [];
  if (!raw) {
    res.json({ type: "empty" });
    return;
  }

  const parts = raw.split(":");

  // 作業項目 QR Code：加入這天的計畫並切換為「現在收」
  if (parts[0] === "ES" && parts[1] === "I" && parts.length === 3) {
    const item = await prisma.homeworkItem.findFirst({ where: { id: Number(parts[2]), courseId } });
    if (!item) {
      res.json({ type: "item", ok: false, message: "找不到這個作業項目", detail: "這張 QR Code 可能是已刪除的作業" });
      return;
    }
    await addToPlan(courseId, date, item.id);
    res.json({ type: "item", ok: true, item: { id: item.id, name: item.name } });
    return;
  }

  // 作業簿專屬 QR Code：只登記自己代表的那一項，不受勾選影響
  if (parts[0] === "ES" && parts[1] === "H" && parts.length === 4) {
    const item = await prisma.homeworkItem.findFirst({ where: { id: Number(parts[3]), courseId } });
    if (!item) {
      res.json({ type: "homework", ok: false, message: "找不到這個作業項目", detail: "這張 QR Code 可能是已刪除的作業" });
      return;
    }
    const student = await prisma.student.findFirst({ where: { id: Number(parts[2]), courseId, isActive: 1 } });
    if (!student) {
      res.json({ type: "homework", ok: false, message: "找不到這位學生", detail: "這張 QR Code 可能不是這個班級的，請點下方卡片手動登記" });
      return;
    }
    await addToPlan(courseId, date, item.id);
    const r = await upsertRecord(courseId, date, student.id, item.id, STATUS.SUBMITTED, "掃描");
    res.json({
      type: "homework",
      ok: true,
      student: serializeStudent(student),
      done: r.duplicate ? [] : [item.id],
      dup: r.duplicate ? [item.id] : [],
      dup_time: r.duplicate ? r.record.recordedAt : undefined,
      changes: r.duplicate ? [] : [{ student_id: student.id, item_id: item.id, previous: previousOf(r.previous) }],
    });
    return;
  }

  // 一般借書證條碼：登記目前勾選、且在這天計畫內的所有作業
  const code = raw.toUpperCase();
  const candidates = await prisma.student.findMany({ where: { courseId, isActive: 1, studentCode: { not: null } } });
  const student = candidates.find((s) => (s.studentCode ?? "").trim().toUpperCase() === code);
  if (!student) {
    res.json({ type: "student", ok: false, message: `找不到條碼「${raw}」`, detail: "請到「學生名冊管理」確認這位學生的借書證條碼，或點下方卡片手動登記" });
    return;
  }
  const plan = new Set(await planItemIds(courseId, date));
  const itemIds = selected.filter((id) => plan.has(id));
  if (!itemIds.length) {
    res.json({ type: "student", ok: false, message: "請先勾選現在要收哪些作業" });
    return;
  }
  const done: number[] = [];
  const dup: number[] = [];
  const changes: unknown[] = [];
  for (const itemId of itemIds) {
    const r = await upsertRecord(courseId, date, student.id, itemId, STATUS.SUBMITTED, "掃描");
    if (r.duplicate) dup.push(itemId);
    else {
      done.push(itemId);
      changes.push({ student_id: student.id, item_id: itemId, previous: previousOf(r.previous) });
    }
  }
  res.json({ type: "student", ok: true, student: serializeStudent(student), done, dup, changes });
});

// --- 手動登記 / 改回未交 / 復原（status 為 null 代表刪除紀錄）---

homeworkScanRouter.put("/:courseId/mark", async (req, res) => {
  const courseId = Number(req.params.courseId);
  const date = dateOf(req.body?.date);
  const studentId = Number(req.body?.student_id);
  const itemId = Number(req.body?.item_id);
  const status: string | null = req.body?.status ?? null;
  if (status !== null && !VALID_STATUS.has(status)) {
    res.status(400).json({ detail: "狀態必須是：已繳交、補繳、請假，或 null（改回未交）" });
    return;
  }
  const [student, item] = await Promise.all([
    prisma.student.findFirst({ where: { id: studentId, courseId } }),
    prisma.homeworkItem.findFirst({ where: { id: itemId, courseId } }),
  ]);
  if (!student || !item) {
    res.status(404).json({ detail: "找不到學生或作業項目" });
    return;
  }
  const key = { itemId_studentId_recordDate: { itemId, studentId, recordDate: date } };
  const existing = await prisma.homeworkRecord.findUnique({ where: key });
  if (status === null) {
    if (existing) await prisma.homeworkRecord.delete({ where: key });
  } else {
    // 復原時會帶回原本的時間與方式；一般手動登記則用現在時間
    const time = typeof req.body?.time === "string" && req.body.time ? req.body.time : getNowStrTaipei();
    const method = typeof req.body?.method === "string" && req.body.method ? req.body.method : "手動";
    await prisma.homeworkRecord.upsert({
      where: key,
      create: { courseId, itemId, studentId, recordDate: date, status, recordedAt: time, method },
      update: { status, recordedAt: time, method },
    });
  }
  res.json({ previous: previousOf(existing) });
});

// --- 匯出（Excel / CSV，CSV 為 UTF-8 with BOM）---

homeworkScanRouter.get("/:courseId/export", async (req, res) => {
  const courseId = Number(req.params.courseId);
  const from = dateOf(req.query.from);
  const to = dateOf(req.query.to ?? req.query.from);
  const format = req.query.format === "csv" ? "csv" : "xlsx";
  const itemFilter = req.query.item_id ? Number(req.query.item_id) : null;

  const course = await prisma.course.findUnique({ where: { id: courseId } });
  if (!course) {
    res.status(404).json({ detail: "Course not found" });
    return;
  }
  const [students, items, plans, records] = await Promise.all([
    activeStudents(courseId),
    prisma.homeworkItem.findMany({ where: { courseId } }),
    prisma.homeworkPlan.findMany({
      where: { courseId, planDate: { gte: from, lte: to } },
      orderBy: [{ planDate: "asc" }, { id: "asc" }],
    }),
    prisma.homeworkRecord.findMany({ where: { courseId, recordDate: { gte: from, lte: to } } }),
  ]);
  const itemName = new Map(items.map((i) => [i.id, i.name]));
  const byKey = new Map(records.map((r) => [`${r.recordDate}|${r.studentId}|${r.itemId}`, r]));

  const detail: (string | number)[][] = [];
  const missing: (string | number)[][] = [];
  for (const p of plans) {
    if (itemFilter && p.itemId !== itemFilter) continue;
    const name = itemName.get(p.itemId);
    if (!name) continue;
    for (const s of students) {
      const r = byKey.get(`${p.planDate}|${s.id}|${p.itemId}`);
      const status = r ? r.status : STATUS.MISSING;
      detail.push([p.planDate, name, s.studentNumber, s.name, status, r?.recordedAt ?? "", r?.method ?? ""]);
      if (!r) missing.push([p.planDate, name, s.studentNumber, s.name]);
    }
  }
  if (!detail.length) {
    res.status(404).json({ detail: "這段期間沒有要收的作業可以匯出" });
    return;
  }

  const detailHeader = ["日期", "作業項目", "座號", "姓名", "繳交狀態", "登記時間", "登記方式"];
  const missingHeader = ["日期", "作業項目", "座號", "姓名"];
  const range = from === to ? from : `${from}_${to}`;
  const safeCourse = (course.name || `course_${courseId}`).replace(/[/\\?%*:|"<> ]/g, "_");
  const baseName = `作業繳交紀錄_${safeCourse}_${range}`;
  res.setHeader("Access-Control-Expose-Headers", "Content-Disposition");

  if (format === "csv") {
    const esc = (v: string | number) => `"${String(v).replace(/"/g, '""')}"`;
    const csv = [detailHeader, ...detail].map((row) => row.map(esc).join(",")).join("\r\n");
    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    res.setHeader("Content-Disposition", `attachment; filename="homework_${range}.csv"; filename*=UTF-8''${encodeURIComponent(baseName)}.csv`);
    res.send(Buffer.from("﻿" + csv, "utf-8"));
    return;
  }

  const wb = new ExcelJS.Workbook();
  const addSheet = (title: string, header: string[], rows: (string | number)[][]) => {
    const ws = wb.addWorksheet(title);
    ws.addRow(header);
    rows.forEach((r) => ws.addRow(r));
    ws.getRow(1).font = { bold: true, color: { argb: "FFFFFFFF" } };
    ws.getRow(1).fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF3B82F6" } };
    ws.columns.forEach((c) => (c.width = 16));
  };
  addSheet("繳交紀錄", detailHeader, detail);
  addSheet("未交名單", missingHeader, missing);
  const buffer = await wb.xlsx.writeBuffer();
  res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
  res.setHeader("Content-Disposition", `attachment; filename="homework_${range}.xlsx"; filename*=UTF-8''${encodeURIComponent(baseName)}.xlsx`);
  res.send(Buffer.from(buffer));
});

// --- 標籤 QR Code（回傳內嵌 SVG，前端直接排版列印）---

homeworkScanRouter.get("/:courseId/labels", async (req, res) => {
  const courseId = Number(req.params.courseId);
  const kind = String(req.query.kind ?? "homework");
  const ids = (v: unknown) => String(v ?? "").split(",").map(Number).filter(Number.isInteger);
  const studentIds = ids(req.query.student_ids);
  const itemIds = ids(req.query.item_ids);
  const copies = Math.min(Math.max(Number(req.query.copies) || 1, 1), 10);

  const [course, students, items] = await Promise.all([
    prisma.course.findUnique({ where: { id: courseId } }),
    prisma.student.findMany({ where: { courseId, isActive: 1, id: { in: studentIds } }, orderBy: { studentNumber: "asc" } }),
    prisma.homeworkItem.findMany({ where: { courseId, id: { in: itemIds } }, orderBy: { id: "asc" } }),
  ]);
  const className = course?.name ?? "";
  const seatName = (s: { studentNumber: number; name: string }) => `${s.studentNumber}號 ${s.name}`;

  const specs: { text: string; lines: string[] }[] = [];
  const skipped: string[] = [];
  if (kind === "homework") {
    for (const s of students) for (const i of items) specs.push({ text: `ES:H:${s.id}:${i.id}`, lines: [seatName(s), i.name, className] });
  } else if (kind === "item") {
    for (const i of items) specs.push({ text: `ES:I:${i.id}`, lines: [i.name, "掃描切換作業", className] });
  } else if (kind === "student") {
    for (const s of students) {
      if (!s.studentCode) skipped.push(s.name);
      else specs.push({ text: s.studentCode, lines: [seatName(s), className] });
    }
  } else {
    res.status(400).json({ detail: "不支援的標籤種類" });
    return;
  }

  const labels = [];
  for (const spec of specs) {
    const svg = await QRCode.toString(spec.text, { type: "svg", margin: 0, errorCorrectionLevel: "M" });
    for (let c = 0; c < copies; c++) labels.push({ svg, lines: spec.lines });
  }
  res.json({ labels, skipped });
});
