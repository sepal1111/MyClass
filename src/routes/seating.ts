// Port of app/routers/seating.py
import { Router } from "express";
import { prisma } from "../db";
import { autoCatch } from "../asyncRoute";

export const seatingRouter = autoCatch(Router());

function shuffled<T>(arr: T[]): T[] {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

async function buildSeatingChart(courseId: number) {
  const course = await prisma.course.findUnique({ where: { id: courseId } });
  if (!course) return null;

  const rows = course.seatRows || 5;
  const cols = course.seatCols || 6;
  const bbPos = course.blackboardPosition || "top";

  const students = await prisma.student.findMany({
    where: { courseId, isActive: 1 },
    orderBy: { studentNumber: "asc" },
  });

  const serializeStudent = (s: (typeof students)[number]) => ({
    id: s.id,
    student_number: s.studentNumber,
    student_code: s.studentCode,
    name: s.name,
    english_name: s.englishName,
    gender: s.gender,
  });

  const gridMap = new Map<string, (typeof students)[number]>();
  const unassigned: typeof students = [];
  for (const s of students) {
    if (s.seatRow != null && s.seatCol != null && s.seatRow >= 1 && s.seatRow <= rows && s.seatCol >= 1 && s.seatCol <= cols) {
      gridMap.set(`${s.seatRow},${s.seatCol}`, s);
    } else {
      unassigned.push(s);
    }
  }

  const grid = [];
  for (let r = 1; r <= rows; r++) {
    const rowCells = [];
    for (let c = 1; c <= cols; c++) {
      const s = gridMap.get(`${r},${c}`);
      rowCells.push({ row: r, col: c, student: s ? serializeStudent(s) : null });
    }
    grid.push(rowCells);
  }

  return { seat_rows: rows, seat_cols: cols, blackboard_position: bbPos, grid, unassigned: unassigned.map(serializeStudent) };
}

seatingRouter.get("/:courseId", async (req, res) => {
  const result = await buildSeatingChart(Number(req.params.courseId));
  if (!result) {
    res.status(404).json({ detail: "Course not found" });
    return;
  }
  res.json(result);
});

seatingRouter.post("/:courseId/config", async (req, res) => {
  const courseId = Number(req.params.courseId);
  const { seat_rows, seat_cols, blackboard_position } = req.body ?? {};
  const bbPos = ["top", "bottom", "left", "right"].includes(blackboard_position) ? blackboard_position : "top";
  await prisma.course.update({ where: { id: courseId }, data: { seatRows: seat_rows, seatCols: seat_cols, blackboardPosition: bbPos } });
  res.json({ message: "Seating config updated successfully" });
});

seatingRouter.post("/:courseId/auto", async (req, res) => {
  const courseId = Number(req.params.courseId);
  const mode: string = req.body?.mode ?? "random";

  const course = await prisma.course.findUnique({ where: { id: courseId } });
  if (!course) {
    res.status(404).json({ detail: "Course not found" });
    return;
  }
  const rows = course.seatRows || 5;
  const cols = course.seatCols || 6;

  const students = await prisma.student.findMany({ where: { courseId, isActive: 1 } });
  await prisma.student.updateMany({ where: { courseId }, data: { seatRow: null, seatCol: null } });

  const availableSeats: [number, number][] = [];
  for (let r = 1; r <= rows; r++) for (let c = 1; c <= cols; c++) availableSeats.push([r, c]);

  const place = async (list: typeof students) => {
    for (let idx = 0; idx < list.length && idx < availableSeats.length; idx++) {
      const [r, c] = availableSeats[idx];
      await prisma.student.update({ where: { id: list[idx].id }, data: { seatRow: r, seatCol: c } });
    }
  };

  if (mode === "by_number") {
    const sorted = [...students].sort((a, b) => a.studentNumber - b.studentNumber);
    await place(sorted);
  } else if (mode === "gender_balanced") {
    const males = shuffled(students.filter((s) => s.gender === "M"));
    const females = shuffled(students.filter((s) => s.gender === "F"));
    const others = shuffled(students.filter((s) => s.gender !== "M" && s.gender !== "F"));

    const alternating: typeof students = [];
    let mIdx = 0;
    let fIdx = 0;
    let turnMale = true;
    for (let i = 0; i < students.length; i++) {
      if (turnMale) {
        if (mIdx < males.length) alternating.push(males[mIdx++]);
        else if (fIdx < females.length) alternating.push(females[fIdx++]);
        else if (others.length) alternating.push(others.shift()!);
      } else {
        if (fIdx < females.length) alternating.push(females[fIdx++]);
        else if (mIdx < males.length) alternating.push(males[mIdx++]);
        else if (others.length) alternating.push(others.shift()!);
      }
      turnMale = !turnMale;
    }
    await place(alternating);
  } else {
    await place(shuffled(students));
  }

  res.json(await buildSeatingChart(courseId));
});

seatingRouter.put("/:courseId/drag", async (req, res) => {
  const courseId = Number(req.params.courseId);
  const { student_id, target_row, target_col } = req.body ?? {};

  const targetStudent = await prisma.student.findFirst({
    where: { courseId, seatRow: target_row, seatCol: target_col, id: { not: student_id } },
  });
  const sourceStudent = await prisma.student.findFirst({ where: { id: student_id, courseId } });
  if (!sourceStudent) {
    res.status(404).json({ detail: "Student not found" });
    return;
  }

  if (targetStudent) {
    await prisma.student.update({
      where: { id: targetStudent.id },
      data: { seatRow: sourceStudent.seatRow, seatCol: sourceStudent.seatCol },
    });
  }
  await prisma.student.update({ where: { id: student_id }, data: { seatRow: target_row, seatCol: target_col } });

  res.json({ message: "Seat updated successfully" });
});
