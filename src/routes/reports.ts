import fs from "fs";
import path from "path";
import ExcelJS from "exceljs";
import { Router } from "express";
import { Prisma } from "@prisma/client";
import { prisma } from "../db";
import { getBinDir } from "../paths";
import { getTodayStrTaipei, getTodayTaipei } from "../timezone";
import { autoCatch } from "../asyncRoute";
import { getLeaveLabelZh } from "./paperQuizzes";

export const reportsRouter = autoCatch(Router());
const photoDir = path.join(getBinDir(), "photo");

function isoDate(year: number, month: number, day: number): string {
  return `${year.toString().padStart(4, "0")}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

reportsRouter.get("/:courseId/dashboard", async (req, res) => {
  const courseId = Number(req.params.courseId);
  const period = (req.query.period as string) ?? "today";
  const planIdParam = req.query.plan_id ? Number(req.query.plan_id) : undefined;
  let startDate = req.query.start_date as string | undefined;
  let endDate = req.query.end_date as string | undefined;

  const today = getTodayTaipei();
  const todayStr = isoDate(today.year, today.month, today.day);

  if (period === "today") {
    startDate = todayStr;
    endDate = todayStr;
  } else if (period === "week") {
    const mondayOffset = today.weekday; // Monday=0
    const mondayUtc = new Date(Date.UTC(today.year, today.month - 1, today.day - mondayOffset));
    const sundayUtc = new Date(mondayUtc.getTime() + 6 * 86400000);
    startDate = mondayUtc.toISOString().slice(0, 10);
    endDate = sundayUtc.toISOString().slice(0, 10);
  } else if (period === "month") {
    const lastDay = new Date(Date.UTC(today.year, today.month, 0)).getUTCDate();
    startDate = isoDate(today.year, today.month, 1);
    endDate = isoDate(today.year, today.month, lastDay);
  } else if (period === "semester") {
    startDate = undefined;
    endDate = undefined;
  }

  let activePlan = planIdParam
    ? await prisma.groupPlan.findFirst({ where: { id: planIdParam, courseId } })
    : await prisma.groupPlan.findFirst({ where: { courseId, isActive: 1 } });
  if (!activePlan) {
    activePlan = await prisma.groupPlan.findFirst({ where: { courseId }, orderBy: { id: "asc" } });
  }
  const planIdVal = activePlan?.id ?? null;

  const students = await prisma.student.findMany({
    where: { courseId, isActive: 1 },
    orderBy: { studentNumber: "asc" },
    include: {
      groupMemberships: { where: { planId: planIdVal ?? -1 }, include: { group: true } },
      group: true,
    },
  });

  const todayAttendance = await prisma.attendance.findMany({ where: { courseId, date: todayStr } });
  const attendanceMap = new Map(todayAttendance.map((a) => [a.studentId, a.status]));

  const rangeIsEmpty = period === "range" && !startDate && !endDate;

  const scoreWhere: Prisma.ScoreLogWhereInput = { courseId, isUndone: 0 };
  if (rangeIsEmpty) {
    scoreWhere.id = -1; // matches Python's "AND 1 = 0" — no rows.
  } else {
    if (startDate) scoreWhere.date = { ...(scoreWhere.date as object), gte: startDate };
    if (endDate) scoreWhere.date = { ...(scoreWhere.date as object), lte: endDate };
  }
  const scoreSums = rangeIsEmpty
    ? []
    : await prisma.scoreLog.groupBy({ by: ["studentId"], where: scoreWhere, _sum: { score: true } });
  const scoreMap = new Map(scoreSums.map((s) => [s.studentId, s._sum.score ?? 0]));

  // Group award events: dedupe identical (group_id, timestamp, rule_title, score) rows
  // before summing, so a group-wide award counts once rather than once per member.
  let groupAwardMap = new Map<number, number>();
  if (!rangeIsEmpty) {
    const rows = await prisma.$queryRaw<{ group_id: number | bigint; group_score: number | bigint }[]>(
      Prisma.sql`
        SELECT group_id, SUM(event_score) AS group_score FROM (
          SELECT sl.group_id AS group_id, sl.timestamp, sl.rule_title, sl.score AS event_score
          FROM score_logs sl
          LEFT JOIN groups g ON sl.group_id = g.id
          WHERE sl.course_id = ${courseId} AND sl.is_undone = 0 AND sl.group_id IS NOT NULL
            ${planIdVal != null ? Prisma.sql`AND (sl.plan_id = ${planIdVal} OR (sl.plan_id IS NULL AND (g.plan_id = ${planIdVal} OR g.plan_id IS NULL)))` : Prisma.empty}
            ${startDate ? Prisma.sql`AND sl.date >= ${startDate}` : Prisma.empty}
            ${endDate ? Prisma.sql`AND sl.date <= ${endDate}` : Prisma.empty}
          GROUP BY sl.group_id, sl.timestamp, sl.rule_title, sl.score
        )
        GROUP BY group_id
      `
    );
    groupAwardMap = new Map(rows.map((r) => [Number(r.group_id), Number(r.group_score ?? 0)]));
  }

  const planGroups = planIdVal
    ? await prisma.group.findMany({ where: { courseId, planId: planIdVal }, orderBy: [{ orderIndex: "asc" }, { id: "asc" }] })
    : await prisma.group.findMany({ where: { courseId }, orderBy: [{ orderIndex: "asc" }, { id: "asc" }] });

  const memberCountMap = new Map<number, number>();
  const studentsOut = students.map((s) => {
    const groupId = planIdVal ? s.groupMemberships[0]?.groupId ?? null : (s as unknown as { groupId: number | null }).groupId;
    const groupName = planIdVal ? s.groupMemberships[0]?.group.groupName ?? null : (s as unknown as { group?: { groupName: string } }).group?.groupName ?? null;
    if (groupId) memberCountMap.set(groupId, (memberCountMap.get(groupId) ?? 0) + 1);

    const status = attendanceMap.get(s.id) ?? "present";
    return {
      id: s.id,
      student_number: s.studentNumber,
      student_code: s.studentCode,
      name: s.name,
      english_name: s.englishName,
      gender: s.gender,
      group_id: groupId,
      group_name: groupName,
      score: scoreMap.get(s.id) ?? 0,
      today_attendance: status,
      is_absent: ["absent", "sick_leave", "personal_leave", "official_leave", "bereavement_leave"].includes(status),
      has_photo: Boolean(s.studentCode && fs.existsSync(path.join(photoDir, `${s.studentCode}.jpg`))),
    };
  });

  const groupScores = planGroups.map((g) => {
    const totalPts = Number(groupAwardMap.get(g.id) ?? 0);
    return {
      id: g.id,
      group_name: g.groupName,
      icon_url: g.iconUrl,
      total_score: totalPts,
      member_count: memberCountMap.get(g.id) ?? 0,
      avg_score: totalPts,
    };
  });

  const individualLeaderboard = studentsOut
    .filter((s) => s.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, 10);
  const groupLeaderboard = groupScores.filter((g) => g.total_score > 0).sort((a, b) => b.total_score - a.total_score);

  res.json({
    period,
    plan: activePlan,
    start_date: startDate ?? null,
    end_date: endDate ?? null,
    students: studentsOut,
    individual_leaderboard: individualLeaderboard,
    group_leaderboard: groupLeaderboard,
  });
});

reportsRouter.get("/:courseId/export", async (req, res) => {
  const courseId = Number(req.params.courseId);
  const startDate = req.query.start_date as string | undefined;
  const endDate = req.query.end_date as string | undefined;

  if (!startDate || !endDate) {
    res.status(400).json({ detail: "請先指定匯出報表的開始日期與結束日期！" });
    return;
  }

  if (startDate > endDate) {
    res.status(400).json({ detail: "開始日期不能大於結束日期！" });
    return;
  }

  const course = await prisma.course.findUnique({ where: { id: courseId } });
  if (!course) {
    res.status(404).json({ detail: "Course not found" });
    return;
  }

  const wb = new ExcelJS.Workbook();
  const headerFill: ExcelJS.Fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF3B82F6" } };
  const headerFont: Partial<ExcelJS.Font> = { name: "Arial", size: 11, bold: true, color: { argb: "FFFFFFFF" } };
  const titleFont: Partial<ExcelJS.Font> = { name: "Arial", size: 14, bold: true };
  const thinBorder: Partial<ExcelJS.Borders> = {
    top: { style: "thin", color: { argb: "FFD1D5DB" } },
    left: { style: "thin", color: { argb: "FFD1D5DB" } },
    bottom: { style: "thin", color: { argb: "FFD1D5DB" } },
    right: { style: "thin", color: { argb: "FFD1D5DB" } },
  };

  const students = await prisma.student.findMany({ where: { courseId, isActive: 1 }, orderBy: { studentNumber: "asc" } });

  // --- Sheet 1: 出缺席統計 ---
  const wsAtt = wb.addWorksheet("出缺席統計");
  wsAtt.addRow([`課程：${course.name} - 出缺席統計報表`, `區間：${startDate || "不限"} ~ ${endDate || "不限"}`]);
  wsAtt.addRow([]);
  wsAtt.addRow(["座號", "姓名", "性別", "出席次數", "病假次數", "事假次數", "公假次數", "喪假次數", "遲到次數"]);

  for (const s of students) {
    const where: Prisma.AttendanceWhereInput = { studentId: s.id };
    if (startDate) where.date = { ...(where.date as object), gte: startDate };
    if (endDate) where.date = { ...(where.date as object), lte: endDate };
    const counts = await prisma.attendance.groupBy({ by: ["status"], where, _count: { status: true } });
    const countMap = new Map(counts.map((c) => [c.status, c._count.status]));

    wsAtt.addRow([
      s.studentNumber,
      s.name,
      s.gender === "M" ? "男" : "女",
      countMap.get("present") ?? 0,
      (countMap.get("sick_leave") ?? 0) + (countMap.get("absent") ?? 0),
      countMap.get("personal_leave") ?? 0,
      countMap.get("official_leave") ?? 0,
      countMap.get("bereavement_leave") ?? 0,
      countMap.get("late") ?? 0,
    ]);
  }

  // --- Sheet 2: 量化成績計分表 ---
  const wsScore = wb.addWorksheet("量化成績統計與明細");
  wsScore.addRow([`課程：${course.name} - 量化成績總計與評分明細`]);
  wsScore.addRow([]);
  wsScore.addRow(["座號", "姓名", "加減分總計", "課堂加分-個人", "小組加分", "實體卡片", "測驗分數"]);

  const logWhere: Prisma.ScoreLogWhereInput = { courseId, isUndone: 0 };
  if (startDate) logWhere.date = { ...(logWhere.date as object), gte: startDate };
  if (endDate) logWhere.date = { ...(logWhere.date as object), lte: endDate };
  const logs = await prisma.scoreLog.findMany({
    where: logWhere,
    orderBy: { timestamp: "desc" },
    include: { student: true },
  });

  // 依評分來源分四類：實體卡片兌換 (ruleTitle 帶 🎫 前綴)、測驗成績 (ruleTitle 帶「測驗成績：」前綴)、
  // 小組加分 (該筆記錄有 group_id，含小組加分與小組作業評分)，其餘（含個人加分、個人作業評分、
  // 榮譽徽章/特殊圖卡/實體獎品兌換扣點等）都算「課堂加分-個人」。四類加總必等於加減分總計。
  type ScoreCategory = "individual" | "group" | "card" | "quiz";
  function categorizeLog(log: (typeof logs)[number]): ScoreCategory {
    if (log.ruleTitle.startsWith("🎫")) return "card";
    if (log.ruleTitle.startsWith("測驗成績：")) return "quiz";
    if (log.groupId != null) return "group";
    return "individual";
  }
  const categorySumsByStudent = new Map<number, Record<ScoreCategory, number>>();
  for (const log of logs) {
    const sums = categorySumsByStudent.get(log.studentId) ?? { individual: 0, group: 0, card: 0, quiz: 0 };
    sums[categorizeLog(log)] += log.score;
    categorySumsByStudent.set(log.studentId, sums);
  }

  for (const s of students) {
    const c = categorySumsByStudent.get(s.id) ?? { individual: 0, group: 0, card: 0, quiz: 0 };
    const total = c.individual + c.group + c.card + c.quiz;
    wsScore.addRow([s.studentNumber, s.name, total, c.individual, c.group, c.card, c.quiz]);
  }

  wsScore.addRow([]);
  wsScore.addRow(["--- 評分細項明細 ---"]);
  wsScore.addRow(["日期時間", "座號", "學生姓名", "評分項目", "分數", "類別", "所屬分組模式", "所屬小組"]);

  const planIds = [...new Set(logs.map((l) => l.planId).filter((v): v is number => v != null))];
  const groupIds = [...new Set(logs.map((l) => l.groupId).filter((v): v is number => v != null))];
  const planMap = new Map((await prisma.groupPlan.findMany({ where: { id: { in: planIds } } })).map((p) => [p.id, p.name]));
  const groupMap = new Map((await prisma.group.findMany({ where: { id: { in: groupIds } } })).map((g) => [g.id, g.groupName]));

  for (const log of logs) {
    wsScore.addRow([
      log.timestamp,
      log.student.studentNumber,
      log.student.name,
      log.ruleTitle,
      log.score,
      log.category === "positive" ? "正向" : "負向",
      (log.planId != null ? planMap.get(log.planId) : null) || "個人評分",
      (log.groupId != null ? groupMap.get(log.groupId) : null) || "-",
    ]);
  }

  // --- Sheet 3: 小組分數成員與得分一覽 ---
  const wsGroups = wb.addWorksheet("小組分數成員與得分一覽");
  wsGroups.addRow([`課程：${course.name} - 小組分組名單、獨立總得分與成員一覽`, `區間：${startDate || "不限"} ~ ${endDate || "不限"}`]);
  wsGroups.addRow([]);

  const plans = await prisma.groupPlan.findMany({ where: { courseId }, orderBy: { id: "asc" } });
  const pastelColors = ["EFF6FF", "ECFDF5", "FFFBEB", "FAF5FF", "FFF1F2", "F0FDFA", "FFF7ED", "F5F3FF"];

  type GroupRow = { planIdx: number; planName: string; groupName: string; groupScore: number | string; memberCount: number; members: string[] };
  const allGroupData: GroupRow[] = [];
  let maxMembers = 1;

  for (let planIdx = 0; planIdx < plans.length; planIdx++) {
    const p = plans[planIdx];
    const pGroups = await prisma.group.findMany({ where: { courseId, planId: p.id }, orderBy: [{ orderIndex: "asc" }, { id: "asc" }] });

    const pGroupRows = await prisma.$queryRaw<{ group_id: number | bigint; group_score: number | bigint }[]>(
      Prisma.sql`
        SELECT group_id, SUM(event_score) AS group_score FROM (
          SELECT sl.group_id AS group_id, sl.timestamp, sl.rule_title, sl.score AS event_score
          FROM score_logs sl
          LEFT JOIN groups g ON sl.group_id = g.id
          WHERE sl.course_id = ${courseId} AND sl.is_undone = 0 AND sl.group_id IS NOT NULL
            AND (sl.plan_id = ${p.id} OR (sl.plan_id IS NULL AND (g.plan_id = ${p.id} OR g.plan_id IS NULL)))
            ${startDate ? Prisma.sql`AND sl.date >= ${startDate}` : Prisma.empty}
            ${endDate ? Prisma.sql`AND sl.date <= ${endDate}` : Prisma.empty}
          GROUP BY sl.group_id, sl.timestamp, sl.rule_title, sl.score
        )
        GROUP BY group_id
      `
    );
    const pGroupScoreMap = new Map(pGroupRows.map((r) => [Number(r.group_id), Number(r.group_score ?? 0)]));

    for (const g of pGroups) {
      const members = await prisma.groupMember.findMany({
        where: { planId: p.id, groupId: g.id, student: { isActive: 1 } },
        include: { student: true },
        orderBy: { student: { studentNumber: "asc" } },
      });
      maxMembers = Math.max(maxMembers, members.length);
      allGroupData.push({
        planIdx,
        planName: p.name,
        groupName: g.groupName,
        groupScore: pGroupScoreMap.get(g.id) ?? 0,
        memberCount: members.length,
        members: members.map((m) => `${m.student.studentNumber}號 ${m.student.name}`),
      });
    }

    const assignedIds = new Set((await prisma.groupMember.findMany({ where: { planId: p.id } })).map((m) => m.studentId));
    const unassignedMembers = (await prisma.student.findMany({ where: { courseId, isActive: 1 }, orderBy: { studentNumber: "asc" } })).filter(
      (s) => !assignedIds.has(s.id)
    );
    if (unassignedMembers.length) {
      maxMembers = Math.max(maxMembers, unassignedMembers.length);
      allGroupData.push({
        planIdx,
        planName: p.name,
        groupName: "未分組",
        groupScore: "-",
        memberCount: unassignedMembers.length,
        members: unassignedMembers.map((m) => `${m.studentNumber}號 ${m.name}`),
      });
    }
  }

  wsGroups.addRow(["分組模式", "小組名稱", "小組獨立得分", "組內成員人數", ...Array.from({ length: maxMembers }, (_, i) => `成員 ${i + 1}`)]);
  for (const item of allGroupData) {
    const row = wsGroups.addRow([item.planName, item.groupName, item.groupScore, item.memberCount, ...item.members]);
    const fill: ExcelJS.Fill = { type: "pattern", pattern: "solid", fgColor: { argb: `FF${pastelColors[item.planIdx % pastelColors.length]}` } };
    row.eachCell((cell, colNumber) => {
      cell.fill = fill;
      cell.border = thinBorder;
      if ([1, 2, 3, 4].includes(colNumber)) cell.alignment = { horizontal: "center", vertical: "middle" };
    });
  }

  // --- Sheet 4: 質性紀錄明細 ---
  const wsNotes = wb.addWorksheet("質性紀錄明細");
  wsNotes.addRow([`課程：${course.name} - 特殊表現與質性紀錄明細`]);
  wsNotes.addRow([]);
  wsNotes.addRow(["日期時間", "座號", "學生姓名", "紀錄內容"]);

  const notesWhere: Prisma.QualitativeNoteWhereInput = { courseId };
  if (startDate) notesWhere.date = { ...(notesWhere.date as object), gte: startDate };
  if (endDate) notesWhere.date = { ...(notesWhere.date as object), lte: endDate };
  const notes = await prisma.qualitativeNote.findMany({ where: notesWhere, orderBy: { timestamp: "desc" }, include: { student: true } });
  for (const n of notes) {
    wsNotes.addRow([n.timestamp, n.student.studentNumber, n.student.name, n.noteText]);
  }

  // --- Sheet 5: 紙本測驗成績一覽 ---
  const quizWhere: Prisma.PaperQuizWhereInput = { courseId };
  if (startDate) quizWhere.quizDate = { ...(quizWhere.quizDate as object), gte: startDate };
  if (endDate) quizWhere.quizDate = { ...(quizWhere.quizDate as object), lte: endDate };

  const paperQuizzes = await prisma.paperQuiz.findMany({
    where: quizWhere,
    include: {
      subUnit: { select: { title: true } },
      records: {
        include: {
          student: true,
        },
      },
    },
    orderBy: [{ quizDate: "asc" }, { id: "asc" }],
  });

  const quizDates = [...new Set(paperQuizzes.map((q) => q.quizDate))];
  const attendances = await prisma.attendance.findMany({
    where: { courseId, date: { in: quizDates } },
  });
  const attMap = new Map<string, string>();
  for (const a of attendances) {
    attMap.set(`${a.date}_${a.studentId}`, a.status);
  }

  const wsPaperMatrix = wb.addWorksheet("紙本測驗成績一覽");
  wsPaperMatrix.addRow([`課程：${course.name} - 紙本測驗成績總覽與全班統計`, `區間：${startDate || "不限"} ~ ${endDate || "不限"}`]);
  wsPaperMatrix.addRow([]);

  const quizCols = paperQuizzes.map((q) => {
    const subjStr = q.subject ? `[${q.subject}] ` : "";
    return `${q.quizDate}\n${subjStr}${q.title}\n(滿分:${q.maxScore}/及格:${q.passingScore})`;
  });

  wsPaperMatrix.addRow([
    "座號",
    "姓名",
    "性別",
    ...quizCols,
    "應試次數",
    "缺考次數",
    "補考次數",
    "個人平均分",
    "及格率",
  ]);

  const quizStats = paperQuizzes.map(() => ({
    scores: [] as number[],
    absentCount: 0,
    makeupCount: 0,
    passCount: 0,
  }));

  for (const s of students) {
    let studentScoredSum = 0;
    let studentScoredCount = 0;
    let studentAbsentCount = 0;
    let studentMakeupCount = 0;
    let studentPassCount = 0;

    const rowQuizValues: (number | string)[] = [];

    paperQuizzes.forEach((q, qIdx) => {
      const rec = q.records.find((r) => r.studentId === s.id);
      const attStatus = attMap.get(`${q.quizDate}_${s.id}`);
      const isUnattendedDay = Boolean(attStatus && attStatus !== "present" && attStatus !== "late");

      const allowMakeup = rec ? rec.allowMakeup === 1 : false;
      const isMakeup = rec ? rec.isMakeup === 1 : false;
      let isAbsent = rec ? rec.isAbsent === 1 : (isUnattendedDay ? true : false);
      const hasScore = rec?.score !== null && rec?.score !== undefined;

      if (allowMakeup && hasScore) {
        isAbsent = false;
      }

      if (isAbsent) {
        studentAbsentCount++;
        quizStats[qIdx].absentCount++;
        const leaveLabel = rec?.leaveType ? getLeaveLabelZh(rec.leaveType) : (isUnattendedDay ? getLeaveLabelZh(attStatus!) : "");
        rowQuizValues.push(leaveLabel ? `缺考(${leaveLabel})` : "缺考");
      } else if (hasScore) {
        const numScore = Number(rec!.score);
        studentScoredCount++;
        studentScoredSum += numScore;
        quizStats[qIdx].scores.push(numScore);

        if (numScore >= q.passingScore) {
          studentPassCount++;
          quizStats[qIdx].passCount++;
        }
        if (isMakeup) {
          studentMakeupCount++;
          quizStats[qIdx].makeupCount++;
          rowQuizValues.push(`${numScore} (補考)`);
        } else {
          rowQuizValues.push(numScore);
        }
      } else {
        rowQuizValues.push("-");
      }
    });

    const avgScore = studentScoredCount > 0 ? Math.round((studentScoredSum / studentScoredCount) * 10) / 10 : "-";
    const passRate = studentScoredCount > 0 ? `${Math.round((studentPassCount / studentScoredCount) * 1000) / 10}%` : "-";

    wsPaperMatrix.addRow([
      s.studentNumber,
      s.name,
      s.gender === "M" ? "男" : "女",
      ...rowQuizValues,
      studentScoredCount,
      studentAbsentCount,
      studentMakeupCount,
      avgScore,
      passRate,
    ]);
  }

  // 底部統計匯總列
  if (paperQuizzes.length > 0) {
    wsPaperMatrix.addRow([]);

    // 全班平均分
    const avgRowVals: (number | string)[] = ["-", "【全班平均分】", "-"];
    let totalAllScore = 0;
    let totalAllCount = 0;
    quizStats.forEach((qs) => {
      if (qs.scores.length > 0) {
        const sum = qs.scores.reduce((a, b) => a + b, 0);
        totalAllScore += sum;
        totalAllCount += qs.scores.length;
        avgRowVals.push(Math.round((sum / qs.scores.length) * 10) / 10);
      } else {
        avgRowVals.push("-");
      }
    });
    const overallAvg = totalAllCount > 0 ? Math.round((totalAllScore / totalAllCount) * 10) / 10 : "-";
    avgRowVals.push("-", "-", "-", overallAvg, "-");
    wsPaperMatrix.addRow(avgRowVals);

    // 全班及格率
    const passRateVals: (number | string)[] = ["-", "【全班及格率】", "-"];
    quizStats.forEach((qs) => {
      if (qs.scores.length > 0) {
        const rate = Math.round((qs.passCount / qs.scores.length) * 1000) / 10;
        passRateVals.push(`${rate}% (${qs.passCount}/${qs.scores.length})`);
      } else {
        passRateVals.push("-");
      }
    });
    passRateVals.push("-", "-", "-", "-", "-");
    wsPaperMatrix.addRow(passRateVals);

    // 最高分 / 最低分
    const highLowVals: (number | string)[] = ["-", "【最高/最低分】", "-"];
    quizStats.forEach((qs) => {
      if (qs.scores.length > 0) {
        highLowVals.push(`${Math.max(...qs.scores)} / ${Math.min(...qs.scores)}`);
      } else {
        highLowVals.push("-");
      }
    });
    highLowVals.push("-", "-", "-", "-", "-");
    wsPaperMatrix.addRow(highLowVals);

    // 缺考人數
    const absentVals: (number | string)[] = ["-", "【缺考總人數】", "-"];
    quizStats.forEach((qs) => {
      absentVals.push(qs.absentCount > 0 ? `${qs.absentCount} 人` : "0");
    });
    absentVals.push("-", "-", "-", "-", "-");
    wsPaperMatrix.addRow(absentVals);
  }

  // --- Sheet 6: 紙本測驗詳細明細 ---
  const wsPaperDetail = wb.addWorksheet("紙本測驗詳細明細");
  wsPaperDetail.addRow([`課程：${course.name} - 紙本測驗逐次登記與查驗明細`, `區間：${startDate || "不限"} ~ ${endDate || "不限"}`]);
  wsPaperDetail.addRow([]);
  wsPaperDetail.addRow([
    "測驗日期",
    "科目",
    "測驗名稱",
    "關聯單元",
    "滿分",
    "及格分",
    "座號",
    "學生姓名",
    "得分",
    "應試狀態",
    "假別",
    "登記來源",
    "考卷佐證查驗",
    "備註說明",
    "最後更新時間",
  ]);

  for (const q of paperQuizzes) {
    for (const s of students) {
      const rec = q.records.find((r) => r.studentId === s.id);
      const attStatus = attMap.get(`${q.quizDate}_${s.id}`);
      const isUnattendedDay = Boolean(attStatus && attStatus !== "present" && attStatus !== "late");

      const allowMakeup = rec ? rec.allowMakeup === 1 : false;
      const isMakeup = rec ? rec.isMakeup === 1 : false;
      let isAbsent = rec ? rec.isAbsent === 1 : (isUnattendedDay ? true : false);
      const hasScore = rec?.score !== null && rec?.score !== undefined;

      if (allowMakeup && hasScore) {
        isAbsent = false;
      }

      let statusStr = "未登記";
      let scoreStr: string | number = "-";
      let leaveTypeStr = "-";
      let submittedByStr = "-";
      let verifyStr = "-";

      if (isAbsent) {
        statusStr = allowMakeup ? "缺考 (開放補考中)" : "缺考";
        scoreStr = "缺考";
        const leaveLabel = rec?.leaveType ? getLeaveLabelZh(rec.leaveType) : (isUnattendedDay ? getLeaveLabelZh(attStatus!) : "");
        leaveTypeStr = leaveLabel || "曠課/未出席";
      } else if (hasScore) {
        scoreStr = Number(rec!.score);
        statusStr = isMakeup ? "補考完成" : (Number(rec!.score) >= q.passingScore ? "及格" : "不及格");
        leaveTypeStr = rec?.leaveType ? getLeaveLabelZh(rec.leaveType) : "-";
      }

      if (rec) {
        if (rec.submittedBy === "student") submittedByStr = "學生自登";
        else if (rec.submittedBy === "leader") submittedByStr = "組長代登";
        else if (rec.submittedBy === "teacher") submittedByStr = "教師登記";
        else if (rec.submittedBy === "system") submittedByStr = "系統自動標記";

        if (rec.photoUrl) {
          verifyStr = rec.isVerified === 1 ? "📷 已核准" : "📷 待審核";
        } else {
          verifyStr = "無照片佐證";
        }
      }

      wsPaperDetail.addRow([
        q.quizDate,
        q.subject || "一般",
        q.title,
        q.subUnit?.title || "-",
        q.maxScore,
        q.passingScore,
        s.studentNumber,
        s.name,
        scoreStr,
        statusStr,
        leaveTypeStr,
        submittedByStr,
        verifyStr,
        rec?.note || "",
        rec?.updatedAt || "-",
      ]);
    }
  }

  // Shared styling: title row 1, header row 3, thin borders below row 3 (except the groups sheet, styled above).
  for (const ws of [wsAtt, wsScore, wsNotes, wsPaperMatrix, wsPaperDetail]) {
    ws.getRow(1).font = titleFont;
    const headerRow = ws.getRow(3);
    headerRow.eachCell((cell) => {
      cell.fill = headerFill;
      cell.font = headerFont;
      cell.alignment = { horizontal: "center", vertical: "middle", wrapText: true };
    });
    for (let r = 4; r <= ws.rowCount; r++) {
      ws.getRow(r).eachCell((cell) => {
        if (cell.value !== null && cell.value !== undefined) cell.border = thinBorder;
      });
    }
  }
  wsGroups.getRow(1).font = titleFont;

  const buffer = await wb.xlsx.writeBuffer();
  const todayStr = getTodayStrTaipei();
  const safeCourseName = (course.name || `course_${courseId}`).replace(/[/\\?%*:|"<> ]/g, "_");
  const filenameAscii = `classroom_report_${courseId}_${todayStr}.xlsx`;
  const filenameUtf8 = encodeURIComponent(`${safeCourseName}_全班成績與課堂記錄_${todayStr}.xlsx`);

  res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
  res.setHeader(
    "Content-Disposition",
    `attachment; filename="${filenameAscii}"; filename*=UTF-8''${filenameUtf8}`
  );
  res.setHeader("Access-Control-Expose-Headers", "Content-Disposition");
  res.send(Buffer.from(buffer));
});
