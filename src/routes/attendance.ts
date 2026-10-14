// Port of app/routers/attendance.py
import { Router } from "express";
import { prisma } from "../db";
import { getNowStrTaipei, getTodayStrTaipei } from "../timezone";
import { broadcastToCourse } from "../realtime";
import { autoCatch } from "../asyncRoute";

// autoCatch must wrap the router BEFORE any routes are registered on it below —
// it only patches future .get/.post/... calls, not ones already made.
export const attendanceRouter = autoCatch(Router());

attendanceRouter.get("/:courseId", async (req, res) => {
  const courseId = Number(req.params.courseId);
  const targetDate = (req.query.date as string) || getTodayStrTaipei();

  const students = await prisma.student.findMany({
    where: { courseId, isActive: 1 },
    orderBy: { studentNumber: "asc" },
    include: { attendance: { where: { date: targetDate } } },
  });

  const records = students.map((s) => ({
    student_id: s.id,
    student_number: s.studentNumber,
    student_code: s.studentCode,
    name: s.name,
    english_name: s.englishName,
    gender: s.gender,
    status: s.attendance[0]?.status ?? "present",
    attendance_id: s.attendance[0]?.id ?? null,
  }));

  res.json({ date: targetDate, records });
});

attendanceRouter.post("/:courseId", async (req, res) => {
  const courseId = Number(req.params.courseId);
  const targetDate: string = req.body?.date;
  const items: Array<{ student_id: number; status: string }> = req.body?.items ?? [];
  const nowTime = getNowStrTaipei();

  const oldRecords = await prisma.attendance.findMany({
    where: { courseId, date: targetDate },
    select: { studentId: true, status: true },
  });

  for (const item of items) {
    await prisma.attendance.upsert({
      where: { courseId_studentId_date: { courseId, studentId: item.student_id, date: targetDate } },
      update: { status: item.status, updatedAt: nowTime },
      create: { courseId, studentId: item.student_id, date: targetDate, status: item.status, updatedAt: nowTime },
    });
  }

  const undoPayload = JSON.stringify({
    course_id: courseId,
    date: targetDate,
    old_records: oldRecords.map((r) => ({ student_id: r.studentId, status: r.status })),
  });

  const undoLog = await prisma.undoLog.create({
    data: { actionType: "attendance", targetId: courseId, payloadJson: undoPayload, createdAt: nowTime },
  });

  broadcastToCourse(courseId, "attendance_updated");
  res.json({ message: "Attendance updated successfully", undo_id: undoLog.id });
});
