// Port of app/routers/scores.py
import { Router } from "express";
import { prisma } from "../db";
import { getNowStrTaipei, getTodayStrTaipei } from "../timezone";
import { broadcastToCourse } from "../realtime";
import { autoCatch } from "../asyncRoute";

export const scoresRouter = autoCatch(Router());

const DEFAULT_RULES = [
  { title: "熱心助人", category: "positive", score_value: 1, icon: "🤝" },
  { title: "發言踴躍", category: "positive", score_value: 1, icon: "🙋‍♂️" },
  { title: "專心聽講", category: "positive", score_value: 1, icon: "👂" },
  { title: "作業優良", category: "positive", score_value: 2, icon: "📝" },
  { title: "團隊合作", category: "positive", score_value: 1, icon: "🌟" },
  { title: "上課吵鬧", category: "negative", score_value: -1, icon: "📢" },
  { title: "未帶用品", category: "negative", score_value: -1, icon: "🎒" },
  { title: "上課分心", category: "negative", score_value: -1, icon: "😴" },
];

scoresRouter.get("/:courseId/rules", async (req, res) => {
  const rules = await prisma.evaluationRule.findMany({
    where: { courseId: Number(req.params.courseId) },
    orderBy: [{ category: "desc" }, { id: "asc" }],
  });
  // Prisma returns camelCase (scoreValue, courseId, isDefault) but the frontend
  // reads snake_case everywhere (rule.score_value) — without this mapping every
  // rule button/badge shows "undefined" and awarding points via a rule crashes
  // (score is silently dropped from the JSON body). Matches the snake_case
  // convention other endpoints (e.g. courses.ts's student list) already follow.
  res.json(
    rules.map((r) => ({
      id: r.id,
      course_id: r.courseId,
      title: r.title,
      category: r.category,
      score_value: r.scoreValue,
      icon: r.icon,
      is_default: r.isDefault,
    }))
  );
});

scoresRouter.post("/:courseId/rules", async (req, res) => {
  const courseId = Number(req.params.courseId);
  const { title, category = "positive", score_value, icon = "⭐" } = req.body ?? {};
  const rule = await prisma.evaluationRule.create({ data: { courseId, title, category, scoreValue: score_value, icon } });
  res.json({ id: rule.id, message: "Rule created" });
});

scoresRouter.put("/:courseId/rules/:ruleId", async (req, res) => {
  const { title, category, score_value, icon } = req.body ?? {};
  await prisma.evaluationRule.updateMany({
    where: { id: Number(req.params.ruleId), courseId: Number(req.params.courseId) },
    data: { title, category, scoreValue: score_value, icon },
  });
  res.json({ message: "Rule updated" });
});

scoresRouter.post("/:courseId/rules/reset_defaults", async (req, res) => {
  const courseId = Number(req.params.courseId);
  await prisma.evaluationRule.deleteMany({ where: { courseId } });
  await prisma.evaluationRule.createMany({
    data: DEFAULT_RULES.map((r) => ({ courseId, title: r.title, category: r.category, scoreValue: r.score_value, icon: r.icon })),
  });
  res.json({ message: "Default rules restored" });
});

scoresRouter.post("/:courseId/add", async (req, res) => {
  const courseId = Number(req.params.courseId);
  const { student_ids, rule_id = null, rule_title, score, category = "positive", date, plan_id, group_id } =
    req.body ?? {};
  const scoreDate: string = date || getTodayStrTaipei();
  const nowTimestamp = getNowStrTaipei();

  let targetPlanId: number | null = plan_id ?? null;
  if (targetPlanId === null && group_id != null) {
    const g = await prisma.group.findUnique({ where: { id: group_id } });
    if (g?.planId) {
      targetPlanId = g.planId;
    } else {
      const p = await prisma.groupPlan.findFirst({ where: { courseId, isActive: 1 } });
      if (p) targetPlanId = p.id;
    }
  }

  const insertedIds: number[] = [];
  for (const sid of student_ids as number[]) {
    const log = await prisma.scoreLog.create({
      data: {
        courseId,
        studentId: sid,
        ruleId: rule_id,
        ruleTitle: rule_title,
        score,
        category,
        date: scoreDate,
        timestamp: nowTimestamp,
        planId: targetPlanId,
        groupId: group_id ?? null,
      },
    });
    insertedIds.push(log.id);
  }

  const undoPayload = JSON.stringify({
    score_log_ids: insertedIds,
    course_id: courseId,
    score,
    rule_title,
    count: (student_ids as number[]).length,
  });
  const undoLog = await prisma.undoLog.create({
    data: { actionType: "score", targetId: courseId, payloadJson: undoPayload, createdAt: nowTimestamp },
  });

  broadcastToCourse(courseId, "score_updated");
  res.json({
    message: `Successfully applied ${score} points (${rule_title}) to ${(student_ids as number[]).length} students`,
    undo_id: undoLog.id,
  });
});

scoresRouter.post("/:courseId/batch", async (req, res) => {
  const courseId = Number(req.params.courseId);
  const { updates, date } = req.body ?? {};
  if (!Array.isArray(updates) || updates.length === 0) {
    res.json({ message: "No updates provided", count: 0 });
    return;
  }

  const scoreDate: string = date || getTodayStrTaipei();
  const nowTimestamp = getNowStrTaipei();
  const insertedIds: number[] = [];

  for (const item of updates) {
    const sid = Number(item.student_id);
    const scoreVal = Number(item.score);
    if (!sid || isNaN(scoreVal) || scoreVal === 0) continue;

    const defaultTitle = scoreVal > 0 ? "快速加分" : "快速扣分";
    const ruleTitle = item.rule_title || defaultTitle;
    const category = scoreVal > 0 ? "positive" : "negative";

    const log = await prisma.scoreLog.create({
      data: {
        courseId,
        studentId: sid,
        ruleId: null,
        ruleTitle,
        score: scoreVal,
        category,
        date: scoreDate,
        timestamp: nowTimestamp,
        planId: null,
        groupId: null,
      },
    });
    insertedIds.push(log.id);
  }

  if (insertedIds.length === 0) {
    res.json({ message: "No valid scores applied", count: 0 });
    return;
  }

  const undoPayload = JSON.stringify({
    score_log_ids: insertedIds,
    course_id: courseId,
    rule_title: "快速加減分",
    count: insertedIds.length,
    batch: true,
  });
  const undoLog = await prisma.undoLog.create({
    data: { actionType: "score", targetId: courseId, payloadJson: undoPayload, createdAt: nowTimestamp },
  });

  broadcastToCourse(courseId, "score_updated");
  res.json({
    message: `Successfully applied batch scores to ${insertedIds.length} students`,
    count: insertedIds.length,
    undo_id: undoLog.id,
  });
});

scoresRouter.post("/undo", async (req, res) => {
  const undoId: number = req.body?.undo_id;
  const undoEntry = await prisma.undoLog.findFirst({ where: { id: undoId, isUndone: 0 } });
  if (!undoEntry) {
    res.status(404).json({ detail: "Undo record not found or already undone" });
    return;
  }
  const payload = JSON.parse(undoEntry.payloadJson);

  if (undoEntry.actionType === "score") {
    const ids: number[] = payload.score_log_ids ?? [];
    if (ids.length) {
      await prisma.scoreLog.updateMany({ where: { id: { in: ids } }, data: { isUndone: 1 } });
    }
  } else if (undoEntry.actionType === "attendance") {
    const courseId: number = payload.course_id;
    const targetDate: string = payload.date;
    const oldRecords: Array<{ student_id: number; status: string }> = payload.old_records ?? [];

    await prisma.attendance.deleteMany({ where: { courseId, date: targetDate } });
    for (const rec of oldRecords) {
      await prisma.attendance.create({
        data: { courseId, studentId: rec.student_id, date: targetDate, status: rec.status, updatedAt: getNowStrTaipei() },
      });
    }
  }

  await prisma.undoLog.update({ where: { id: undoId }, data: { isUndone: 1 } });
  broadcastToCourse(payload.course_id, "score_updated");
  res.json({ message: "Undo executed successfully" });
});

scoresRouter.get("/:courseId/student/:studentId/logs", async (req, res) => {
  const courseId = Number(req.params.courseId);
  const studentId = Number(req.params.studentId);
  const { start_date, end_date, include_undone = "true" } = req.query as Record<string, string>;

  const where: Record<string, unknown> = { courseId, studentId };
  if (include_undone === "false") where.isUndone = 0;
  if (start_date) where.date = { ...(where.date as object), gte: start_date };
  if (end_date) where.date = { ...(where.date as object), lte: end_date };

  const logs = await prisma.scoreLog.findMany({
    where,
    orderBy: [{ timestamp: "desc" }, { id: "desc" }],
    include: { course: false },
  });

  const planIds = [...new Set(logs.map((l) => l.planId).filter((v): v is number => v != null))];
  const groupIds = [...new Set(logs.map((l) => l.groupId).filter((v): v is number => v != null))];
  const plans = await prisma.groupPlan.findMany({ where: { id: { in: planIds } } });
  const groups = await prisma.group.findMany({ where: { id: { in: groupIds } } });
  const planNameMap = new Map(plans.map((p) => [p.id, p.name]));
  const groupNameMap = new Map(groups.map((g) => [g.id, g.groupName]));

  const enriched = logs.map((l) => ({
    id: l.id,
    course_id: l.courseId,
    student_id: l.studentId,
    rule_id: l.ruleId,
    rule_title: l.ruleTitle,
    score: l.score,
    category: l.category,
    date: l.date,
    timestamp: l.timestamp,
    is_undone: l.isUndone,
    plan_id: l.planId,
    group_id: l.groupId,
    plan_name: l.planId != null ? planNameMap.get(l.planId) ?? null : null,
    group_name: l.groupId != null ? groupNameMap.get(l.groupId) ?? null : null,
  }));

  const activeLogs = enriched.filter((l) => l.is_undone === 0);
  const posSum = activeLogs.filter((l) => l.score > 0).reduce((sum, l) => sum + l.score, 0);
  const negSum = activeLogs.filter((l) => l.score < 0).reduce((sum, l) => sum + l.score, 0);
  const totalScore = activeLogs.reduce((sum, l) => sum + l.score, 0);

  res.json({ student_id: studentId, total_score: totalScore, positive_score: posSum, negative_score: negSum, logs: enriched });
});

scoresRouter.delete("/:courseId/logs/:logId", async (req, res) => {
  const courseId = Number(req.params.courseId);
  const result = await prisma.scoreLog.updateMany({
    where: { id: Number(req.params.logId), courseId },
    data: { isUndone: 1 },
  });
  if (result.count === 0) {
    res.status(404).json({ detail: "Score log not found" });
    return;
  }
  broadcastToCourse(courseId, "score_updated");
  res.json({ message: "Score record deleted successfully" });
});

scoresRouter.post("/:courseId/logs/:logId/restore", async (req, res) => {
  const courseId = Number(req.params.courseId);
  const result = await prisma.scoreLog.updateMany({
    where: { id: Number(req.params.logId), courseId },
    data: { isUndone: 0 },
  });
  if (result.count === 0) {
    res.status(404).json({ detail: "Score log not found" });
    return;
  }
  broadcastToCourse(courseId, "score_updated");
  res.json({ message: "Score record restored successfully" });
});
