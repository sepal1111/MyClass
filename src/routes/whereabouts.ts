// 早自修／午休「在位掌握」：記錄學生不在教室的原因（棒球隊、羽球隊、科展…），
// 並讓教師為每個原因填入負責老師（選填），導師臨時要找學生時能快速知道該問誰。
//
// - 離開原因（whereabouts_reasons）為全域設定，所有班級共用，預設項目於 db.ts 首次建立時寫入。
// - 登記（whereabouts_records）每筆代表「一次外出」，保留離開與回來時間；回到教室只填 returned_at，不刪紀錄。
//   沒有「尚未回來」（returned_at 為 null）的紀錄代表目前在教室。
import crypto from "crypto";
import ExcelJS from "exceljs";
import { Router } from "express";
import QRCode from "qrcode";
import { prisma } from "../db";
import { getLocalIp } from "../utils/network";
import { getNowStrTaipei, getTodayStrTaipei } from "../timezone";
import { broadcastToCourse } from "../realtime";
import { autoCatch } from "../asyncRoute";

export const whereaboutsRouter = autoCatch(Router());

const SLOTS = new Set(["morning", "noon"]);
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const dateOf = (v: unknown): string => (typeof v === "string" && DATE_RE.test(v) ? v : getTodayStrTaipei());
const text = (v: unknown, max: number): string => (typeof v === "string" ? v.trim().slice(0, max) : "");

type ReasonRow = {
  id: number;
  title: string;
  icon: string;
  teacherName: string | null;
  isOther: number;
  isActive: number;
  sortOrder: number;
};

const serializeReason = (r: ReasonRow) => ({
  id: r.id,
  title: r.title,
  icon: r.icon,
  teacher_name: r.teacherName ?? "",
  is_other: r.isOther === 1,
  is_active: r.isActive === 1,
  sort_order: r.sortOrder,
});

// ---------- 離開原因設定（放在 /:courseId 之前，避免被當成課程編號） ----------

whereaboutsRouter.get("/reasons", async (req, res) => {
  const includeInactive = req.query.all === "1";
  const rows = await prisma.whereaboutsReason.findMany({
    where: includeInactive ? {} : { isActive: 1 },
    orderBy: [{ sortOrder: "asc" }, { id: "asc" }],
  });
  res.json(rows.map(serializeReason));
});

whereaboutsRouter.post("/reasons", async (req, res) => {
  const title = text(req.body?.title, 30);
  if (!title) {
    res.status(400).json({ detail: "請填寫項目名稱" });
    return;
  }
  const last = await prisma.whereaboutsReason.findFirst({ orderBy: { sortOrder: "desc" } });
  const row = await prisma.whereaboutsReason.create({
    data: {
      title,
      icon: text(req.body?.icon, 8) || "📍",
      teacherName: text(req.body?.teacher_name, 30) || null,
      isOther: req.body?.is_other ? 1 : 0,
      sortOrder: (last?.sortOrder ?? 0) + 1,
    },
  });
  res.json(serializeReason(row));
});

whereaboutsRouter.put("/reasons/:id", async (req, res) => {
  const id = Number(req.params.id);
  const existing = await prisma.whereaboutsReason.findUnique({ where: { id } });
  if (!existing) {
    res.status(404).json({ detail: "找不到此項目" });
    return;
  }
  const data: Record<string, unknown> = {};
  if (req.body?.title !== undefined) {
    const title = text(req.body.title, 30);
    if (!title) {
      res.status(400).json({ detail: "項目名稱不可為空白" });
      return;
    }
    data.title = title;
  }
  if (req.body?.icon !== undefined) data.icon = text(req.body.icon, 8) || "📍";
  if (req.body?.teacher_name !== undefined) data.teacherName = text(req.body.teacher_name, 30) || null;
  if (req.body?.is_active !== undefined) data.isActive = req.body.is_active ? 1 : 0;
  if (req.body?.sort_order !== undefined && Number.isFinite(Number(req.body.sort_order))) {
    data.sortOrder = Number(req.body.sort_order);
  }
  const row = await prisma.whereaboutsReason.update({ where: { id }, data });
  res.json(serializeReason(row));
});

// 已被登記使用過的項目只能停用（保留歷史紀錄的原因名稱），沒用過的才真的刪除。
whereaboutsRouter.delete("/reasons/:id", async (req, res) => {
  const id = Number(req.params.id);
  const used = await prisma.whereaboutsRecord.count({ where: { reasonId: id } });
  if (used > 0) {
    await prisma.whereaboutsReason.update({ where: { id }, data: { isActive: 0 } });
    res.json({ message: "此項目已有登記紀錄，已改為停用", deactivated: true });
    return;
  }
  await prisma.whereaboutsReason.deleteMany({ where: { id } });
  res.json({ message: "已刪除", deactivated: false });
});

// ---------- 外出紀錄（每筆＝一次外出） ----------

type TripRow = {
  id: number;
  date: string;
  slot: string;
  reasonId: number | null;
  note: string | null;
  outAt: string;
  returnedAt: string | null;
  reason: ReasonRow | null;
};

const SLOT_LABEL: Record<string, string> = { morning: "早自修", noon: "午休" };

const toMs = (t: string): number => new Date(t.replace(" ", "T") + "Z").getTime();
/** 離開到回來的分鐘數（四捨五入）；尚未回來則為 null。 */
const minutesBetween = (outAt: string, returnedAt: string | null): number | null =>
  returnedAt ? Math.max(0, Math.round((toMs(returnedAt) - toMs(outAt)) / 60000)) : null;

const serializeTrip = (r: TripRow) => ({
  id: r.id,
  reason_id: r.reasonId,
  reason_title: r.reason?.title ?? "（原因已刪除）",
  icon: r.reason?.icon ?? "📍",
  teacher_name: r.reason?.teacherName ?? "",
  is_other: r.reason?.isOther === 1,
  note: r.note ?? "",
  out_at: r.outAt,
  returned_at: r.returnedAt,
  minutes: minutesBetween(r.outAt, r.returnedAt),
});

/** 某班某天的狀態：每位學生每個時段「目前外出」的那一筆（沒有＝在教室），以及當天所有外出紀錄。 */
async function dayState(courseId: number, date: string, withTrips: boolean) {
  const [course, students, records, reasons] = await Promise.all([
    prisma.course.findUnique({ where: { id: courseId }, select: { seatRows: true, seatCols: true, blackboardPosition: true } }),
    prisma.student.findMany({ where: { courseId, isActive: 1 }, orderBy: { studentNumber: "asc" } }),
    prisma.whereaboutsRecord.findMany({ where: { courseId, date }, include: { reason: true }, orderBy: { outAt: "asc" } }),
    prisma.whereaboutsReason.findMany({ where: { isActive: 1 }, orderBy: [{ sortOrder: "asc" }, { id: "asc" }] }),
  ]);
  const byStudent = new Map<number, TripRow[]>();
  for (const r of records) {
    const list = byStudent.get(r.studentId) ?? [];
    list.push(r);
    byStudent.set(r.studentId, list);
  }
  const current = (list: TripRow[], slot: string) => {
    const open = list.filter((t) => t.slot === slot && t.returnedAt === null);
    const last = open[open.length - 1];
    return last ? serializeTrip(last) : null;
  };
  const rows = course?.seatRows || 5;
  const cols = course?.seatCols || 6;
  const inSeat = (s: (typeof students)[number]) =>
    s.seatRow != null && s.seatCol != null && s.seatRow >= 1 && s.seatRow <= rows && s.seatCol >= 1 && s.seatCol <= cols;
  return {
    date,
    // 座位表（與「班級管理 ➔ 座位表」同一份設定），供「座位表檢視」使用
    seat: { rows, cols, blackboard_position: course?.blackboardPosition || "top" },
    reasons: reasons.map(serializeReason),
    students: students.map((s) => {
      const list = byStudent.get(s.id) ?? [];
      const base = {
        student_id: s.id,
        student_number: s.studentNumber,
        name: s.name,
        seat_row: inSeat(s) ? s.seatRow : null,
        seat_col: inSeat(s) ? s.seatCol : null,
        morning: current(list, "morning"),
        noon: current(list, "noon"),
      };
      if (!withTrips) return base;
      return {
        ...base,
        english_name: s.englishName,
        trips: {
          morning: list.filter((t) => t.slot === "morning").map(serializeTrip),
          noon: list.filter((t) => t.slot === "noon").map(serializeTrip),
        },
      };
    }),
  };
}

/** 設定外出原因：已在外面的學生只更新原因（保留原本的離開時間），否則新增一次外出。 */
async function markOut(courseId: number, date: string, slot: string, studentIds: number[], reasonId: number, note: string) {
  const now = getNowStrTaipei();
  for (const studentId of studentIds) {
    const open = await prisma.whereaboutsRecord.findFirst({
      where: { courseId, studentId, date, slot, returnedAt: null },
      orderBy: { outAt: "desc" },
    });
    if (open) {
      await prisma.whereaboutsRecord.update({ where: { id: open.id }, data: { reasonId, note: note || null } });
    } else {
      await prisma.whereaboutsRecord.create({
        data: { courseId, studentId, date, slot, reasonId, note: note || null, outAt: now },
      });
    }
  }
}

/** 標記回到教室：只填回來時間，紀錄保留。回傳實際更新的筆數。 */
async function markReturned(courseId: number, date: string, slot: string, studentIds?: number[]) {
  const where = { courseId, date, slot, returnedAt: null, ...(studentIds ? { studentId: { in: studentIds } } : {}) };
  const res = await prisma.whereaboutsRecord.updateMany({ where, data: { returnedAt: getNowStrTaipei() } });
  return res.count;
}

async function validateReason(reasonId: number, note: string): Promise<string | null> {
  const reason = await prisma.whereaboutsReason.findUnique({ where: { id: reasonId } });
  if (!reason || reason.isActive !== 1) return "此原因不存在或已停用";
  if (reason.isOther === 1 && !note) return "選擇「其他」時，請填寫原因";
  return null;
}

// ---------- 每日登記（教師端） ----------

whereaboutsRouter.get("/:courseId", async (req, res) => {
  res.json(await dayState(Number(req.params.courseId), dateOf(req.query.date), true));
});

// 設定一位或多位學生在某時段「不在教室」的原因；reason_id 為 null 代表「回到教室」（保留紀錄與回來時間）。
whereaboutsRouter.put("/:courseId/record", async (req, res) => {
  const courseId = Number(req.params.courseId);
  const date = dateOf(req.body?.date);
  const slot = String(req.body?.slot ?? "");
  if (!SLOTS.has(slot)) {
    res.status(400).json({ detail: "時段不正確" });
    return;
  }
  const ids: number[] = Array.isArray(req.body?.student_ids)
    ? req.body.student_ids.map(Number).filter((n: number) => Number.isInteger(n))
    : [];
  if (ids.length === 0) {
    res.status(400).json({ detail: "請選擇學生" });
    return;
  }
  const valid = await prisma.student.findMany({ where: { courseId, id: { in: ids } }, select: { id: true } });
  const studentIds = valid.map((s) => s.id);
  if (studentIds.length === 0) {
    res.status(400).json({ detail: "找不到這些學生" });
    return;
  }

  const reasonId = req.body?.reason_id === null || req.body?.reason_id === undefined ? null : Number(req.body.reason_id);
  if (reasonId === null) {
    await markReturned(courseId, date, slot, studentIds);
  } else {
    const note = text(req.body?.note, 100);
    const err = await validateReason(reasonId, note);
    if (err) {
      res.status(400).json({ detail: err });
      return;
    }
    await markOut(courseId, date, slot, studentIds, reasonId, note);
  }

  broadcastToCourse(courseId, "whereabouts_updated");
  res.json({ message: "已更新", count: studentIds.length });
});

// 一鍵「全班都在教室」：把該時段所有尚未回來的學生標記為已回到教室（紀錄保留）。
whereaboutsRouter.post("/:courseId/clear", async (req, res) => {
  const courseId = Number(req.params.courseId);
  const date = dateOf(req.body?.date);
  const slot = String(req.body?.slot ?? "");
  if (!SLOTS.has(slot)) {
    res.status(400).json({ detail: "時段不正確" });
    return;
  }
  const count = await markReturned(courseId, date, slot);
  broadcastToCourse(courseId, "whereabouts_updated");
  res.json({ message: "已將外出的學生標記為回到教室", count });
});

// 誤按時刪除單筆外出紀錄（教師專用；學生端只能標記回到教室，不能刪紀錄）。
whereaboutsRouter.delete("/:courseId/trip/:tripId", async (req, res) => {
  const courseId = Number(req.params.courseId);
  const result = await prisma.whereaboutsRecord.deleteMany({ where: { id: Number(req.params.tripId), courseId } });
  if (result.count === 0) {
    res.status(404).json({ detail: "找不到這筆紀錄" });
    return;
  }
  broadcastToCourse(courseId, "whereabouts_updated");
  res.json({ message: "已刪除這筆紀錄" });
});

// ---------- 紀錄查詢與統計 ----------

async function buildReport(courseId: number, start: string, end: string, slot: string | null) {
  const rows = await prisma.whereaboutsRecord.findMany({
    where: { courseId, date: { gte: start, lte: end }, ...(slot ? { slot } : {}) },
    include: { reason: true, student: true },
    orderBy: [{ date: "asc" }, { outAt: "asc" }],
  });
  const today = getTodayStrTaipei();

  const trips = rows.map((r) => {
    const minutes = minutesBetween(r.outAt, r.returnedAt);
    return {
      id: r.id,
      date: r.date,
      slot: r.slot,
      slot_label: SLOT_LABEL[r.slot] ?? r.slot,
      student_id: r.studentId,
      student_number: r.student.studentNumber,
      name: r.student.name,
      reason_title: r.reason?.title ?? "（原因已刪除）",
      icon: r.reason?.icon ?? "📍",
      teacher_name: r.reason?.teacherName ?? "",
      note: r.note ?? "",
      out_at: r.outAt,
      returned_at: r.returnedAt,
      minutes,
      // 尚未登記回來：今天＝可能還在外面；過去的日期＝忘了登記回來
      status: r.returnedAt ? "returned" : r.date >= today ? "out" : "no_return",
    };
  });

  const byStudentMap = new Map<number, { student_id: number; student_number: number; name: string; count: number; minutes: number; reasons: Record<string, number> }>();
  const byReasonMap = new Map<string, { title: string; icon: string; teacher_name: string; count: number; minutes: number; students: Set<number> }>();
  for (const t of trips) {
    const st = byStudentMap.get(t.student_id) ?? { student_id: t.student_id, student_number: t.student_number, name: t.name, count: 0, minutes: 0, reasons: {} };
    st.count += 1;
    st.minutes += t.minutes ?? 0;
    st.reasons[t.reason_title] = (st.reasons[t.reason_title] ?? 0) + 1;
    byStudentMap.set(t.student_id, st);

    const rs = byReasonMap.get(t.reason_title) ?? { title: t.reason_title, icon: t.icon, teacher_name: t.teacher_name, count: 0, minutes: 0, students: new Set<number>() };
    rs.count += 1;
    rs.minutes += t.minutes ?? 0;
    rs.students.add(t.student_id);
    byReasonMap.set(t.reason_title, rs);
  }

  return {
    start,
    end,
    slot,
    trips,
    by_student: [...byStudentMap.values()].sort((a, b) => b.count - a.count || a.student_number - b.student_number),
    by_reason: [...byReasonMap.values()]
      .sort((a, b) => b.count - a.count)
      .map((r) => ({ title: r.title, icon: r.icon, teacher_name: r.teacher_name, count: r.count, students: r.students.size, minutes: r.minutes })),
  };
}

function parseRange(req: { query: Record<string, unknown> }) {
  const today = getTodayStrTaipei();
  const start = typeof req.query.start === "string" && DATE_RE.test(req.query.start) ? req.query.start : today.slice(0, 8) + "01";
  const end = typeof req.query.end === "string" && DATE_RE.test(req.query.end) ? req.query.end : today;
  const slot = typeof req.query.slot === "string" && SLOTS.has(req.query.slot) ? req.query.slot : null;
  return { start, end, slot };
}

whereaboutsRouter.get("/:courseId/report", async (req, res) => {
  const { start, end, slot } = parseRange(req);
  if (start > end) {
    res.status(400).json({ detail: "開始日期不能大於結束日期" });
    return;
  }
  res.json(await buildReport(Number(req.params.courseId), start, end, slot));
});

whereaboutsRouter.get("/:courseId/report.xlsx", async (req, res) => {
  const courseId = Number(req.params.courseId);
  const { start, end, slot } = parseRange(req);
  if (start > end) {
    res.status(400).json({ detail: "開始日期不能大於結束日期" });
    return;
  }
  const [report, course] = await Promise.all([
    buildReport(courseId, start, end, slot),
    prisma.course.findUnique({ where: { id: courseId }, select: { name: true } }),
  ]);

  const wb = new ExcelJS.Workbook();
  const styleHeader = (ws: ExcelJS.Worksheet) => {
    const row = ws.getRow(1);
    row.font = { bold: true, color: { argb: "FFFFFFFF" } };
    row.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF0284C7" } };
    row.alignment = { vertical: "middle", horizontal: "center" };
    ws.views = [{ state: "frozen", ySplit: 1 }];
  };
  const timeOnly = (t: string | null) => (t ? t.slice(11, 16) : "");

  const wsDetail = wb.addWorksheet("外出明細");
  wsDetail.columns = [
    { header: "日期", key: "date", width: 12 },
    { header: "時段", key: "slot", width: 9 },
    { header: "座號", key: "num", width: 7 },
    { header: "姓名", key: "name", width: 12 },
    { header: "原因", key: "reason", width: 14 },
    { header: "備註", key: "note", width: 24 },
    { header: "負責老師", key: "teacher", width: 12 },
    { header: "離開時間", key: "out", width: 10 },
    { header: "回來時間", key: "back", width: 10 },
    { header: "外出分鐘", key: "min", width: 10 },
    { header: "狀態", key: "status", width: 14 },
  ];
  const statusText: Record<string, string> = { returned: "已回教室", out: "尚未回來", no_return: "未登記回來" };
  for (const t of report.trips) {
    wsDetail.addRow({
      date: t.date, slot: t.slot_label, num: t.student_number, name: t.name, reason: t.reason_title,
      note: t.note, teacher: t.teacher_name, out: timeOnly(t.out_at), back: timeOnly(t.returned_at),
      min: t.minutes ?? "", status: statusText[t.status],
    });
  }
  styleHeader(wsDetail);

  const wsStudent = wb.addWorksheet("學生統計");
  wsStudent.columns = [
    { header: "座號", key: "num", width: 7 },
    { header: "姓名", key: "name", width: 12 },
    { header: "外出次數", key: "count", width: 10 },
    { header: "累計分鐘", key: "min", width: 10 },
    { header: "各原因次數", key: "reasons", width: 50 },
  ];
  for (const s of report.by_student) {
    wsStudent.addRow({
      num: s.student_number, name: s.name, count: s.count, min: s.minutes,
      reasons: Object.entries(s.reasons).map(([k, v]) => `${k}×${v}`).join("、"),
    });
  }
  styleHeader(wsStudent);

  const wsReason = wb.addWorksheet("原因統計");
  wsReason.columns = [
    { header: "原因", key: "title", width: 16 },
    { header: "負責老師", key: "teacher", width: 12 },
    { header: "外出次數", key: "count", width: 10 },
    { header: "人數", key: "students", width: 8 },
    { header: "累計分鐘", key: "min", width: 10 },
  ];
  for (const r of report.by_reason) {
    wsReason.addRow({ title: `${r.icon} ${r.title}`, teacher: r.teacher_name, count: r.count, students: r.students, min: r.minutes });
  }
  styleHeader(wsReason);

  const buffer = await wb.xlsx.writeBuffer();
  const filename = `${course?.name ?? "班級"}_在位掌握紀錄_${start}_${end}.xlsx`;
  res.set({
    "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    "Content-Disposition": `attachment; filename*=UTF-8''${encodeURIComponent(filename)}`,
  });
  res.send(Buffer.from(buffer));
});

// ---------- 學生自行登記頁（免登入）的連結管理（教師端） ----------
// 公開頁網址帶每班一組隨機金鑰；教師可停用或重新產生（舊連結立即失效）。

async function kioskInfo(req: { socket: { localPort?: number } }, courseId: number) {
  const row = await prisma.whereaboutsKiosk.findUnique({ where: { courseId } });
  if (!row) return { enabled: false };
  const port = req.socket.localPort ?? 8000;
  const query = `/whereabouts?c=${courseId}&k=${row.token}`;
  const url = `https://${getLocalIp()}:${port}${query}`; // 區網其他裝置（手機／平板）掃碼用
  // 教師電腦自己的書籤用 localhost：不受區網 IP 變動影響，且憑證警告只需在這台電腦接受一次。
  const local_url = `https://localhost:${port}${query}`;
  const qr_code = await QRCode.toDataURL(url, { errorCorrectionLevel: "L", margin: 2, scale: 8 });
  return { enabled: true, url, local_url, qr_code };
}

whereaboutsRouter.get("/:courseId/kiosk", async (req, res) => {
  res.json(await kioskInfo(req, Number(req.params.courseId)));
});

whereaboutsRouter.post("/:courseId/kiosk", async (req, res) => {
  const courseId = Number(req.params.courseId);
  const course = await prisma.course.findUnique({ where: { id: courseId }, select: { id: true } });
  if (!course) {
    res.status(404).json({ detail: "找不到此班級" });
    return;
  }
  const existing = await prisma.whereaboutsKiosk.findUnique({ where: { courseId } });
  const enabled = req.body?.enabled !== false;
  if (!enabled) {
    await prisma.whereaboutsKiosk.deleteMany({ where: { courseId } });
  } else if (!existing || req.body?.regenerate === true) {
    const token = crypto.randomBytes(12).toString("hex");
    await prisma.whereaboutsKiosk.upsert({
      where: { courseId },
      update: { token, createdAt: getNowStrTaipei() },
      create: { courseId, token, createdAt: getNowStrTaipei() },
    });
  }
  res.json(await kioskInfo(req, courseId));
});

// ---------- 學生自行登記頁（公開，不需教師登入；以金鑰保護） ----------
// 只開放「看名單、為單一學生設定外出原因／標記回到教室」，日期固定為伺服器今天；
// 不回傳學號條碼（student_code）與任何照片連結，也不能刪除紀錄。

export const whereaboutsPublicRouter = autoCatch(Router());

async function checkKiosk(courseId: number, key: unknown): Promise<boolean> {
  if (typeof key !== "string" || key.length < 8) return false;
  const row = await prisma.whereaboutsKiosk.findUnique({ where: { courseId } });
  if (!row || row.token.length !== key.length) return false;
  return crypto.timingSafeEqual(Buffer.from(row.token), Buffer.from(key));
}

whereaboutsPublicRouter.get("/:courseId", async (req, res) => {
  const courseId = Number(req.params.courseId);
  if (!(await checkKiosk(courseId, req.query.key))) {
    res.status(403).json({ detail: "此連結已失效或未開放，請向老師索取新的 QR Code" });
    return;
  }
  const course = await prisma.course.findUnique({ where: { id: courseId }, select: { name: true } });
  const state = await dayState(courseId, getTodayStrTaipei(), false);
  res.json({ course_name: course?.name ?? "", ...state });
});

whereaboutsPublicRouter.put("/:courseId/record", async (req, res) => {
  const courseId = Number(req.params.courseId);
  if (!(await checkKiosk(courseId, req.body?.key))) {
    res.status(403).json({ detail: "此連結已失效或未開放，請向老師索取新的 QR Code" });
    return;
  }
  const slot = String(req.body?.slot ?? "");
  if (!SLOTS.has(slot)) {
    res.status(400).json({ detail: "時段不正確" });
    return;
  }
  // 支援一次登記多位學生（student_ids），也相容舊的單人欄位 student_id；單次最多 60 人。
  const rawIds: unknown[] = Array.isArray(req.body?.student_ids) ? req.body.student_ids : [req.body?.student_id];
  const wanted = [...new Set(rawIds.map(Number).filter((n) => Number.isInteger(n)))].slice(0, 60);
  const found = await prisma.student.findMany({ where: { id: { in: wanted }, courseId, isActive: 1 }, select: { id: true } });
  const studentIds = found.map((s) => s.id);
  if (studentIds.length === 0) {
    res.status(400).json({ detail: "找不到這些學生" });
    return;
  }
  const date = getTodayStrTaipei();
  const reasonId = req.body?.reason_id === null || req.body?.reason_id === undefined ? null : Number(req.body.reason_id);

  if (reasonId === null) {
    await markReturned(courseId, date, slot, studentIds);
  } else {
    const note = text(req.body?.note, 100);
    const err = await validateReason(reasonId, note);
    if (err) {
      res.status(400).json({ detail: err });
      return;
    }
    await markOut(courseId, date, slot, studentIds, reasonId, note);
  }
  broadcastToCourse(courseId, "whereabouts_updated");
  res.json({ message: "已更新", count: studentIds.length });
});
