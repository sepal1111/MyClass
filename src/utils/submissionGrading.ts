// Shared helpers for wiring assignment grading (src/routes/units.ts) into the
// existing score_logs / leaderboard system, so a teacher's star-rating on a
// submission behaves exactly like a manual scores/add entry (see
// node_migration_and_lms_plan.md §5.2: "批改給分時直接觸發現有的 score_logs 機制").
import type { PrismaClient } from "@prisma/client";
import { getNowStrTaipei, getTodayStrTaipei } from "../timezone";

/** Soft-undoes every score_log id previously recorded for a submission (see scores.ts's
 *  own undo endpoint — same isUndone flag, same convention), so re-grading never double-counts. */
export async function undoScoreLogIds(prisma: PrismaClient, idsJson: string | null): Promise<void> {
  if (!idsJson) return;
  let ids: number[] = [];
  try {
    ids = JSON.parse(idsJson);
  } catch {
    return;
  }
  if (!Array.isArray(ids) || ids.length === 0) return;
  await prisma.scoreLog.updateMany({ where: { id: { in: ids } }, data: { isUndone: 1 } });
}

/** Records one score_log entry for a single student's assignment grade and returns its id. */
export async function recordGradeScoreLog(
  prisma: PrismaClient,
  params: { courseId: number; studentId: number; ruleTitle: string; score: number; groupId?: number | null; planId?: number | null }
): Promise<number> {
  const log = await prisma.scoreLog.create({
    data: {
      courseId: params.courseId,
      studentId: params.studentId,
      ruleId: null,
      ruleTitle: params.ruleTitle,
      score: params.score,
      category: params.score >= 0 ? "positive" : "negative",
      date: getTodayStrTaipei(),
      timestamp: getNowStrTaipei(),
      groupId: params.groupId ?? null,
      planId: params.planId ?? null,
    },
  });
  return log.id;
}
