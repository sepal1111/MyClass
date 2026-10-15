// Teacher-side course materials & units management (Course -> Unit -> SubUnit -> Material).
// Mounted behind requireAuth (teacher system session) — see src/routes/studentContent.ts
// for the read-only, JWT-guarded student-facing counterpart.
import { groupMemberIds, notifyNewContent, notifyStudent, notifyStudents } from "../utils/notifications";
import fs from "fs";
import path from "path";
import { exec } from "child_process";
import { Router } from "express";
import multer from "multer";
import { prisma } from "../db";
import { autoCatch } from "../asyncRoute";
import { getUploadsDir } from "../paths";
import { getNowStrTaipei } from "../timezone";
import { recordGradeScoreLog, undoScoreLogIds } from "../utils/submissionGrading";
import { listSubmissionComments, createSubmissionComment } from "../utils/submissionComments";
import { fixUploadFilename } from "../utils/upload";

export const unitsRouter = autoCatch(Router());
const upload = multer({ storage: multer.memoryStorage() });

/** "file,text,link" (as stored) <-> ["file","text","link"] (as sent/returned over the API). */
function parseSubmissionTypes(csv: string | null): string[] {
  return csv ? csv.split(",").filter(Boolean) : [];
}
function serializeSubmissionTypes(types: unknown): string | null {
  if (!Array.isArray(types)) return null;
  const clean = types.filter((t) => typeof t === "string" && t.trim());
  return clean.length ? clean.join(",") : null;
}

function withAssignmentFields<T extends { submissionTypes: string | null; quizQuestions: string | null }>(su: T) {
  return {
    ...su,
    submissionTypes: parseSubmissionTypes(su.submissionTypes),
    quizQuestions: su.quizQuestions ? JSON.parse(su.quizQuestions) : [],
  };
}

interface QuizQuestion {
  id: string;
  type: "multiple_choice" | "true_false" | "short_answer";
  question_text: string;
  options: string[];
  correct_answer: string;
  points: number;
}

const QUESTION_TYPES = new Set(["multiple_choice", "true_false", "short_answer"]);

/** Light validation/coercion of teacher-submitted quiz questions — trusts shape but
 *  never trusts types, since this JSON round-trips straight into the DB (and, unlike
 *  material/assignment fields, gets served back to students verbatim minus correct_answer). */
function sanitizeQuizQuestions(raw: unknown): QuizQuestion[] | null {
  if (!Array.isArray(raw) || raw.length === 0) return null;
  const out: QuizQuestion[] = [];
  for (const item of raw) {
    if (!item || typeof item !== "object") continue;
    const q = item as Record<string, unknown>;
    const type = QUESTION_TYPES.has(q.type as string) ? (q.type as QuizQuestion["type"]) : "multiple_choice";
    const questionText = typeof q.question_text === "string" ? q.question_text.trim() : "";
    if (!questionText) continue;
    const options =
      type === "multiple_choice" && Array.isArray(q.options)
        ? q.options.filter((o): o is string => typeof o === "string" && o.trim() !== "")
        : [];
    const correctAnswer = typeof q.correct_answer === "string" ? q.correct_answer.trim() : "";
    const points = Number(q.points) > 0 ? Math.round(Number(q.points)) : 10;
    const id = typeof q.id === "string" && q.id ? q.id : `q_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    out.push({ id, type, question_text: questionText, options, correct_answer: correctAnswer, points });
  }
  return out.length ? out : null;
}

async function fetchUnitsTree(courseId: number) {
  const units = await prisma.unit.findMany({
    where: { courseId },
    orderBy: [{ orderIndex: "asc" }, { id: "asc" }],
    include: {
      subUnits: {
        orderBy: [{ orderIndex: "asc" }, { id: "asc" }],
        include: { materials: { orderBy: [{ orderIndex: "asc" }, { id: "asc" }] } },
      },
    },
  });
  return units.map((u) => ({ ...u, subUnits: u.subUnits.map(withAssignmentFields) }));
}

// --- Units ---

unitsRouter.get("/:courseId", async (req, res) => {
  res.json(await fetchUnitsTree(Number(req.params.courseId)));
});

unitsRouter.post("/:courseId", async (req, res) => {
  const courseId = Number(req.params.courseId);
  const title: string = (req.body?.title ?? "").trim();
  if (!title) {
    res.status(400).json({ detail: "請輸入單元標題" });
    return;
  }
  const maxOrder = await prisma.unit.aggregate({ where: { courseId }, _max: { orderIndex: true } });
  const unit = await prisma.unit.create({
    data: { courseId, title, orderIndex: (maxOrder._max.orderIndex ?? 0) + 1 },
  });
  res.json({ id: unit.id, message: "單元建立成功！" });
});

unitsRouter.put("/:courseId/reorder", async (req, res) => {
  const courseId = Number(req.params.courseId);
  const unitIds: number[] = req.body?.unit_ids ?? [];
  for (let i = 0; i < unitIds.length; i++) {
    await prisma.unit.updateMany({ where: { id: unitIds[i], courseId }, data: { orderIndex: i } });
  }
  res.json({ message: "單元順序已更新" });
});

unitsRouter.put("/:courseId/:unitId", async (req, res) => {
  const courseId = Number(req.params.courseId);
  const unitId = Number(req.params.unitId);
  const data: Record<string, unknown> = {};
  if (typeof req.body?.title === "string") data.title = req.body.title.trim();
  if (typeof req.body?.is_hidden === "boolean") data.isHidden = req.body.is_hidden ? 1 : 0;
  if (typeof req.body?.order_index === "number") data.orderIndex = req.body.order_index;

  const result = await prisma.unit.updateMany({ where: { id: unitId, courseId }, data });
  if (result.count === 0) {
    res.status(404).json({ detail: "Unit not found" });
    return;
  }
  res.json({ message: "單元已更新" });
});

unitsRouter.delete("/:courseId/:unitId", async (req, res) => {
  await prisma.unit.deleteMany({ where: { id: Number(req.params.unitId), courseId: Number(req.params.courseId) } });
  res.json({ message: "單元已刪除" });
});

// 開啟本機教材資料夾（教師端 LMS 頁「📁 開啟班級雲端資料夾」按鈕）——MyClass 純本機儲存、無雲端，
// 這裡實際是在「伺服器主機」上跳出檔案總管，多數情況下伺服器就是老師自己的電腦，
// 但若老師透過手機/平板遠端連線操作，資料夾只會顯示在伺服器電腦上（前端會提示這點）。
unitsRouter.post("/:courseId/open_materials_folder", async (req, res) => {
  const courseId = Number(req.params.courseId);
  const dir = path.join(getUploadsDir(), "materials", String(courseId));
  fs.mkdirSync(dir, { recursive: true });
  const cmd =
    process.platform === "win32" ? `start "" "${dir}"` : process.platform === "darwin" ? `open "${dir}"` : `xdg-open "${dir}"`;
  exec(cmd, () => undefined);
  res.json({ message: "已在伺服器主機開啟資料夾", path: dir });
});

// --- Sub-units ---

unitsRouter.post("/:courseId/:unitId/subunits", async (req, res) => {
  const courseId = Number(req.params.courseId);
  const unitId = Number(req.params.unitId);
  const unit = await prisma.unit.findFirst({ where: { id: unitId, courseId } });
  if (!unit) {
    res.status(404).json({ detail: "Unit not found" });
    return;
  }
  const title: string = (req.body?.title ?? "").trim();
  if (!title) {
    res.status(400).json({ detail: "請輸入小單元標題" });
    return;
  }
  const category: string = req.body?.category ?? "material";
  const description: string | null = req.body?.description ?? null;
  const publishAtRaw = (req.body?.publish_at as string | undefined)?.trim();

  const data: Record<string, unknown> = {
    unitId,
    title,
    category,
    description,
    publishAt: publishAtRaw ? publishAtRaw.replace("T", " ") : null,
  };
  if (category === "assignment") {
    const assignmentType: string = req.body?.assignment_type === "group" ? "group" : "individual";
    let groupPlanId: number | null = null;
    if (assignmentType === "group") {
      groupPlanId = Number(req.body?.group_plan_id) || null;
      if (!groupPlanId || !(await prisma.groupPlan.findFirst({ where: { id: groupPlanId, courseId } }))) {
        res.status(400).json({ detail: "小組作業請指定有效的分組方案" });
        return;
      }
    }
    data.submissionTypes = serializeSubmissionTypes(req.body?.submission_types) ?? "file";
    data.assignmentType = assignmentType;
    data.groupPlanId = groupPlanId;
    data.dueDate = (req.body?.due_date as string | undefined)?.trim() || null;
    data.autoLockOverdue = req.body?.auto_lock_overdue ? 1 : 0;
  } else if (category === "quiz") {
    const questions = sanitizeQuizQuestions(req.body?.quiz_questions);
    if (!questions) {
      res.status(400).json({ detail: "請至少新增一道測驗題目" });
      return;
    }
    data.quizQuestions = JSON.stringify(questions);
    data.revealAnswersAfterSubmit = req.body?.reveal_answers_after_submit === false ? 0 : 1;
    data.dueDate = (req.body?.due_date as string | undefined)?.trim() || null;
    data.autoLockOverdue = req.body?.auto_lock_overdue ? 1 : 0;
  }

  const maxOrder = await prisma.subUnit.aggregate({ where: { unitId }, _max: { orderIndex: true } });
  const subUnit = await prisma.subUnit.create({
    data: { ...data, orderIndex: (maxOrder._max.orderIndex ?? 0) + 1 } as Parameters<typeof prisma.subUnit.create>[0]["data"],
  });
  void notifyNewContent({
    courseId,
    unitId,
    unitTitle: unit.title,
    title,
    category,
    isHidden: false,
    publishAt: (data.publishAt as string | null) ?? null,
  });
  res.json({ id: subUnit.id, message: "小單元建立成功！" });
});

unitsRouter.put("/:courseId/:unitId/subunits/reorder", async (req, res) => {
  const unitId = Number(req.params.unitId);
  const subUnitIds: number[] = req.body?.sub_unit_ids ?? [];
  for (let i = 0; i < subUnitIds.length; i++) {
    await prisma.subUnit.updateMany({ where: { id: subUnitIds[i], unitId }, data: { orderIndex: i } });
  }
  res.json({ message: "小單元順序已更新" });
});

unitsRouter.put("/:courseId/:unitId/subunits/:subUnitId", async (req, res) => {
  const courseId = Number(req.params.courseId);
  const unitId = Number(req.params.unitId);
  const subUnitId = Number(req.params.subUnitId);
  const data: Record<string, unknown> = {};
  if (typeof req.body?.title === "string") data.title = req.body.title.trim();
  if (typeof req.body?.description === "string") data.description = req.body.description;
  if (typeof req.body?.is_hidden === "boolean") data.isHidden = req.body.is_hidden ? 1 : 0;
  if (typeof req.body?.order_index === "number") data.orderIndex = req.body.order_index;
  if (typeof req.body?.publish_at === "string") data.publishAt = req.body.publish_at.trim() ? req.body.publish_at.trim().replace("T", " ") : null;
  if (Array.isArray(req.body?.submission_types)) data.submissionTypes = serializeSubmissionTypes(req.body.submission_types);
  if (req.body?.assignment_type === "individual" || req.body?.assignment_type === "group") {
    data.assignmentType = req.body.assignment_type;
  }
  if (req.body?.group_plan_id !== undefined) {
    const groupPlanId = Number(req.body.group_plan_id) || null;
    if (groupPlanId && !(await prisma.groupPlan.findFirst({ where: { id: groupPlanId, courseId } }))) {
      res.status(400).json({ detail: "指定的分組方案不存在" });
      return;
    }
    data.groupPlanId = groupPlanId;
  }
  if (typeof req.body?.due_date === "string") data.dueDate = req.body.due_date.trim() || null;
  if (typeof req.body?.auto_lock_overdue === "boolean") data.autoLockOverdue = req.body.auto_lock_overdue ? 1 : 0;
  if (req.body?.quiz_questions !== undefined) {
    const questions = sanitizeQuizQuestions(req.body.quiz_questions);
    if (!questions) {
      res.status(400).json({ detail: "請至少保留一道測驗題目" });
      return;
    }
    data.quizQuestions = JSON.stringify(questions);
  }
  if (typeof req.body?.reveal_answers_after_submit === "boolean") {
    data.revealAnswersAfterSubmit = req.body.reveal_answers_after_submit ? 1 : 0;
  }

  const before =
    data.isHidden === 0
      ? await prisma.subUnit.findFirst({ where: { id: subUnitId, unitId }, include: { unit: true } })
      : null;
  const result = await prisma.subUnit.updateMany({ where: { id: subUnitId, unitId }, data });
  if (result.count === 0) {
    res.status(404).json({ detail: "Sub-unit not found" });
    return;
  }
  // 從「隱藏」改為「顯示」＝對學生而言是新內容，通知全班
  if (before && before.isHidden === 1) {
    const after = await prisma.subUnit.findUnique({ where: { id: subUnitId } });
    if (after) {
      void notifyNewContent({
        courseId,
        unitId,
        unitTitle: before.unit.title,
        title: after.title,
        category: after.category,
        isHidden: after.isHidden === 1,
        publishAt: after.publishAt,
      });
    }
  }
  res.json({ message: "小單元已更新" });
});

unitsRouter.delete("/:courseId/:unitId/subunits/:subUnitId", async (req, res) => {
  await prisma.subUnit.deleteMany({ where: { id: Number(req.params.subUnitId), unitId: Number(req.params.unitId) } });
  res.json({ message: "小單元已刪除" });
});

// --- Materials ---

unitsRouter.post(
  "/:courseId/:unitId/subunits/:subUnitId/materials",
  upload.single("file"),
  async (req, res) => {
    const courseId = Number(req.params.courseId);
    const unitId = Number(req.params.unitId);
    const subUnitId = Number(req.params.subUnitId);
    const subUnit = await prisma.subUnit.findFirst({ where: { id: subUnitId, unitId } });
    if (!subUnit) {
      res.status(404).json({ detail: "Sub-unit not found" });
      return;
    }

    const type: string = req.body?.type ?? (req.file ? "file" : "link");
    let url: string;
    let title: string;

    if (type === "file") {
      const file = req.file;
      if (!file) {
        res.status(400).json({ detail: "請選擇要上傳的檔案" });
        return;
      }
      file.originalname = fixUploadFilename(file.originalname);
      const materialsDir = path.join(getUploadsDir(), "materials", String(courseId), String(unitId));
      fs.mkdirSync(materialsDir, { recursive: true });
      const ext = path.extname(file.originalname);
      const filename = `${Date.now()}_${Math.random().toString(36).slice(2, 8)}${ext}`;
      fs.writeFileSync(path.join(materialsDir, filename), file.buffer);
      url = `/uploads/materials/${courseId}/${unitId}/${filename}`;
      title = (req.body?.title as string | undefined)?.trim() || file.originalname;
    } else {
      url = (req.body?.url ?? "").trim();
      if (!url) {
        res.status(400).json({ detail: "請輸入連結網址" });
        return;
      }
      title = (req.body?.title as string | undefined)?.trim() || url;
    }

    const maxOrder = await prisma.material.aggregate({ where: { subUnitId }, _max: { orderIndex: true } });
    const material = await prisma.material.create({
      data: { subUnitId, type, title, url, orderIndex: (maxOrder._max.orderIndex ?? 0) + 1 },
    });
    res.json({ id: material.id, url, message: "教材新增成功！" });
  }
);

unitsRouter.delete("/:courseId/:unitId/subunits/:subUnitId/materials/:materialId", async (req, res) => {
  await prisma.material.deleteMany({
    where: { id: Number(req.params.materialId), subUnitId: Number(req.params.subUnitId) },
  });
  res.json({ message: "教材已刪除" });
});

// --- 閱讀進度總覽（教師端） ---

unitsRouter.get("/:courseId/reading_progress", async (req, res) => {
  const courseId = Number(req.params.courseId);
  const totalStudents = await prisma.student.count({ where: { courseId, isActive: 1 } });

  const subUnits = await prisma.subUnit.findMany({
    where: { unit: { courseId } },
    orderBy: [{ unitId: "asc" }, { orderIndex: "asc" }],
    include: { unit: { select: { id: true, title: true } }, readingProgress: true },
  });

  res.json(
    subUnits.map((su) => ({
      sub_unit_id: su.id,
      sub_unit_title: su.title,
      unit_id: su.unit.id,
      unit_title: su.unit.title,
      total_students: totalStudents,
      viewed_count: su.readingProgress.length,
      details: su.readingProgress.map((rp) => ({
        student_id: rp.studentId,
        first_viewed_at: rp.firstViewedAt,
        last_viewed_at: rp.lastViewedAt,
        view_count: rp.viewCount,
      })),
    }))
  );
});

// 作業/測驗完成度彙總（教師端 LMS 頁小單元卡片上的「✅ 已完成 X／未完成 Y」徽章）。
// 小組作業的「應繳」對象是組數而非人數，個人作業/測驗則以學生人數為準，
// 與既有 renderGradingList()（modal-lms-grading）isGroup ? data.groups : data.students 的口徑一致。
unitsRouter.get("/:courseId/submission_progress", async (req, res) => {
  const courseId = Number(req.params.courseId);
  const totalStudents = await prisma.student.count({ where: { courseId, isActive: 1 } });

  const subUnits = await prisma.subUnit.findMany({
    where: { unit: { courseId }, category: { in: ["assignment", "quiz"] } },
  });

  const result = await Promise.all(
    subUnits.map(async (su) => {
      const turnedInCount = await prisma.submission.count({ where: { subUnitId: su.id, turnedIn: 1 } });
      let total = totalStudents;
      if (su.category === "assignment" && su.assignmentType === "group" && su.groupPlanId) {
        total = await prisma.group.count({ where: { planId: su.groupPlanId } });
      }
      return { sub_unit_id: su.id, total, turned_in_count: turnedInCount };
    })
  );
  res.json(result);
});

// --- 作業繳交與評分（教師端） ---
// Phase 3: node_migration_and_lms_plan.md 模組 2「作業與小組共同作業」。個人與小組
// 兩條路徑都經過 recordGradeScoreLog()/undoScoreLogIds()，讓評分直接觸發 score_logs，
// 與現有排行榜/儀表板共用同一份資料，重新評分不會重複累計（見 utils/submissionGrading.ts）。

type SubmissionRow = Awaited<ReturnType<typeof prisma.submission.findFirst>>;

function serializeSubmission(s: SubmissionRow) {
  if (!s) return null;
  return {
    id: s.id,
    files: s.filesJson ? (JSON.parse(s.filesJson) as unknown[]) : [],
    link: s.link,
    text_content: s.textContent,
    submitted_at: s.submittedAt,
    is_late: !!s.isLate,
    turned_in: !!s.turnedIn,
    locked: !!s.locked,
    teacher_reopened: !!s.teacherReopened,
    resubmit_requested: !!s.resubmitRequested,
    score: s.score,
    feedback: s.feedback,
    member_scores: s.memberScoresJson ? JSON.parse(s.memberScoresJson) : {},
    graded_at: s.gradedAt,
    answers: s.answersJson ? JSON.parse(s.answersJson) : null,
    max_score: s.maxScore,
  };
}

/** Both assignment and quiz sub-units share the submissions list/grade/lock endpoints below —
 *  quiz submissions just arrive pre-graded (see studentContent.ts's /submit_quiz auto-grading). */
async function loadAssignment(courseId: number, unitId: number, subUnitId: number) {
  const subUnit = await prisma.subUnit.findFirst({ where: { id: subUnitId, unitId, unit: { courseId } } });
  return subUnit && (subUnit.category === "assignment" || subUnit.category === "quiz") ? subUnit : null;
}

unitsRouter.get("/:courseId/:unitId/subunits/:subUnitId/submissions", async (req, res) => {
  const courseId = Number(req.params.courseId);
  const unitId = Number(req.params.unitId);
  const subUnitId = Number(req.params.subUnitId);
  const subUnit = await loadAssignment(courseId, unitId, subUnitId);
  if (!subUnit) {
    res.status(404).json({ detail: "Assignment not found" });
    return;
  }

  const submissions = await prisma.submission.findMany({ where: { subUnitId } });
  const isQuiz = subUnit.category === "quiz";
  const base = {
    category: subUnit.category,
    assignment_type: subUnit.assignmentType,
    due_date: subUnit.dueDate,
    submission_types: parseSubmissionTypes(subUnit.submissionTypes),
    auto_lock_overdue: !!subUnit.autoLockOverdue,
    ...(isQuiz ? { quiz_questions: subUnit.quizQuestions ? JSON.parse(subUnit.quizQuestions) : [] } : {}),
  };

  // 提問串數量：讓評分清單能顯示「💬 3」徽章，不用逐筆展開才知道有沒有新提問。
  const commentGroups = await prisma.submissionComment.groupBy({ by: ["studentId", "groupId"], where: { subUnitId }, _count: { id: true } });
  const commentCountByStudent = new Map<number, number>();
  const commentCountByGroup = new Map<number, number>();
  for (const g of commentGroups) {
    if (g.studentId != null) commentCountByStudent.set(g.studentId, g._count.id);
    if (g.groupId != null) commentCountByGroup.set(g.groupId, g._count.id);
  }

  if (subUnit.assignmentType === "group") {
    const groups = await prisma.group.findMany({
      where: { planId: subUnit.groupPlanId ?? -1 },
      orderBy: [{ orderIndex: "asc" }, { id: "asc" }],
      include: { members: { include: { student: true } } },
    });
    res.json({
      ...base,
      groups: groups.map((g) => ({
        group_id: g.id,
        group_name: g.groupName,
        member_names: g.members.map((m) => m.student.name),
        submission: serializeSubmission(submissions.find((s) => s.groupId === g.id) ?? null),
        comment_count: commentCountByGroup.get(g.id) ?? 0,
      })),
    });
    return;
  }

  const students = await prisma.student.findMany({ where: { courseId, isActive: 1 }, orderBy: { studentNumber: "asc" } });
  res.json({
    ...base,
    students: students.map((s) => ({
      student_id: s.id,
      student_number: s.studentNumber,
      name: s.name,
      submission: serializeSubmission(submissions.find((sub) => sub.studentId === s.id) ?? null),
      comment_count: commentCountByStudent.get(s.id) ?? 0,
    })),
  });
});

unitsRouter.post("/:courseId/:unitId/subunits/:subUnitId/submissions/:studentId/grade", async (req, res) => {
  const courseId = Number(req.params.courseId);
  const unitId = Number(req.params.unitId);
  const subUnitId = Number(req.params.subUnitId);
  const studentId = Number(req.params.studentId);
  const subUnit = await loadAssignment(courseId, unitId, subUnitId);
  if (!subUnit) {
    res.status(404).json({ detail: "Assignment not found" });
    return;
  }

  const { score, feedback } = req.body ?? {};
  const hasScore = score !== undefined && score !== null && String(score).trim() !== "";

  const existing = await prisma.submission.findUnique({ where: { subUnitId_studentId: { subUnitId, studentId } } });
  await undoScoreLogIds(prisma, existing?.scoreLogIdsJson ?? null);

  let scoreLogIdsJson: string | null = null;
  if (hasScore) {
    const logId = await recordGradeScoreLog(prisma, {
      courseId,
      studentId,
      ruleTitle: `作業評分：${subUnit.title}`,
      score: Number(score),
    });
    scoreLogIdsJson = JSON.stringify([logId]);
  }

  await prisma.submission.upsert({
    where: { subUnitId_studentId: { subUnitId, studentId } },
    create: {
      subUnitId,
      studentId,
      score: hasScore ? Number(score) : null,
      feedback: feedback || null,
      gradedAt: getNowStrTaipei(),
      scoreLogIdsJson,
      locked: hasScore ? 1 : 0,
    },
    update: {
      score: hasScore ? Number(score) : null,
      feedback: feedback || null,
      gradedAt: getNowStrTaipei(),
      scoreLogIdsJson,
      ...(hasScore ? { locked: 1 } : {}),
    },
  });

  if (hasScore) {
    await notifyStudent({
      courseId,
      studentId,
      type: "graded",
      title: `「${subUnit.title}」已評分：${Number(score)} 分`,
      body: feedback || null,
      tab: "materials",
    });
  } else if (typeof feedback === "string" && feedback.trim()) {
    await notifyStudent({
      courseId,
      studentId,
      type: "feedback",
      title: `老師在「${subUnit.title}」留下評語`,
      body: feedback,
      tab: "materials",
    });
  }

  res.json({ message: "評分已送出" });
});

unitsRouter.put("/:courseId/:unitId/subunits/:subUnitId/submissions/:studentId/lock", async (req, res) => {
  const subUnitId = Number(req.params.subUnitId);
  const studentId = Number(req.params.studentId);
  const locked = !!req.body?.locked;
  await prisma.submission.upsert({
    where: { subUnitId_studentId: { subUnitId, studentId } },
    create: { subUnitId, studentId, locked: locked ? 1 : 0, ...(locked ? {} : { teacherReopened: 1, resubmitRequested: 0 }) },
    update: { locked: locked ? 1 : 0, ...(locked ? {} : { teacherReopened: 1, resubmitRequested: 0 }) },
  });
  if (!locked) {
    const subUnit = await prisma.subUnit.findUnique({ where: { id: subUnitId } });
    if (subUnit) {
      await notifyStudent({
        courseId: Number(req.params.courseId),
        studentId,
        type: "reopened",
        title: `老師開放你重新繳交「${subUnit.title}」`,
        tab: "materials",
      });
    }
  }
  res.json({ message: locked ? "作業已鎖定" : "作業已解鎖，學生可重新繳交" });
});

// --- 提問串（Submission Comments，教師端，個人作業/測驗）---

unitsRouter.get("/:courseId/:unitId/subunits/:subUnitId/submissions/:studentId/comments", async (req, res) => {
  const courseId = Number(req.params.courseId);
  const unitId = Number(req.params.unitId);
  const subUnitId = Number(req.params.subUnitId);
  const studentId = Number(req.params.studentId);
  const subUnit = await loadAssignment(courseId, unitId, subUnitId);
  if (!subUnit) {
    res.status(404).json({ detail: "Assignment not found" });
    return;
  }
  res.json(await listSubmissionComments(prisma, { subUnitId, studentId }));
});

unitsRouter.post("/:courseId/:unitId/subunits/:subUnitId/submissions/:studentId/comments", async (req, res) => {
  const courseId = Number(req.params.courseId);
  const unitId = Number(req.params.unitId);
  const subUnitId = Number(req.params.subUnitId);
  const studentId = Number(req.params.studentId);
  const subUnit = await loadAssignment(courseId, unitId, subUnitId);
  if (!subUnit) {
    res.status(404).json({ detail: "Assignment not found" });
    return;
  }
  const message = typeof req.body?.message === "string" ? req.body.message.trim() : "";
  if (!message) {
    res.status(400).json({ detail: "請輸入訊息內容" });
    return;
  }
  await createSubmissionComment(prisma, { subUnitId, studentId }, "teacher", null, message, getNowStrTaipei());
  await notifyStudent({
    courseId,
    studentId,
    type: "reply",
    title: `老師回覆了你在「${subUnit.title}」的提問`,
    body: message,
    tab: "materials",
  });
  res.json(await listSubmissionComments(prisma, { subUnitId, studentId }));
});

unitsRouter.post("/:courseId/:unitId/subunits/:subUnitId/submissions/batch_request_resubmit", async (req, res) => {
  const subUnitId = Number(req.params.subUnitId);
  const studentIds: number[] = req.body?.student_ids ?? [];
  const feedback: string = (req.body?.feedback as string | undefined)?.trim() || "";

  for (const studentId of studentIds) {
    const existing = await prisma.submission.findUnique({ where: { subUnitId_studentId: { subUnitId, studentId } } });
    await undoScoreLogIds(prisma, existing?.scoreLogIdsJson ?? null);
    await prisma.submission.upsert({
      where: { subUnitId_studentId: { subUnitId, studentId } },
      create: {
        subUnitId,
        studentId,
        locked: 0,
        teacherReopened: 1,
        resubmitRequested: 0,
        turnedIn: 0,
        score: null,
        scoreLogIdsJson: null,
        feedback: feedback || null,
      },
      update: {
        locked: 0,
        teacherReopened: 1,
        resubmitRequested: 0,
        turnedIn: 0,
        score: null,
        scoreLogIdsJson: null,
        ...(feedback ? { feedback } : {}),
      },
    });
  }
  const returned = await prisma.subUnit.findUnique({ where: { id: subUnitId } });
  if (returned) {
    await notifyStudents(studentIds, {
      courseId: Number(req.params.courseId),
      type: "reopened",
      title: `老師請你重新繳交「${returned.title}」`,
      body: feedback || null,
      tab: "materials",
    });
  }
  res.json({ message: `已退回 ${studentIds.length} 份作業，學生可重新繳交` });
});

unitsRouter.post("/:courseId/:unitId/subunits/:subUnitId/submissions/group/:groupId/grade", async (req, res) => {
  const courseId = Number(req.params.courseId);
  const unitId = Number(req.params.unitId);
  const subUnitId = Number(req.params.subUnitId);
  const groupId = Number(req.params.groupId);
  const subUnit = await loadAssignment(courseId, unitId, subUnitId);
  if (!subUnit) {
    res.status(404).json({ detail: "Assignment not found" });
    return;
  }

  const { score, feedback, member_scores } = req.body ?? {};
  const hasScore = score !== undefined && score !== null && String(score).trim() !== "";
  const memberScoreMap: Record<string, number> = member_scores && typeof member_scores === "object" ? member_scores : {};

  const existing = await prisma.submission.findUnique({ where: { subUnitId_groupId: { subUnitId, groupId } } });
  await undoScoreLogIds(prisma, existing?.scoreLogIdsJson ?? null);

  let scoreLogIdsJson: string | null = null;
  if (hasScore) {
    const members = await prisma.groupMember.findMany({ where: { groupId } });
    const logIds: number[] = [];
    for (const m of members) {
      const override = memberScoreMap[String(m.studentId)];
      const finalScore = override !== undefined && String(override).trim() !== "" ? Number(override) : Number(score);
      const logId = await recordGradeScoreLog(prisma, {
        courseId,
        studentId: m.studentId,
        ruleTitle: `小組作業評分：${subUnit.title}`,
        score: finalScore,
        groupId,
      });
      logIds.push(logId);
    }
    scoreLogIdsJson = JSON.stringify(logIds);
  }

  await prisma.submission.upsert({
    where: { subUnitId_groupId: { subUnitId, groupId } },
    create: {
      subUnitId,
      groupId,
      score: hasScore ? Number(score) : null,
      feedback: feedback || null,
      memberScoresJson: Object.keys(memberScoreMap).length ? JSON.stringify(memberScoreMap) : null,
      gradedAt: getNowStrTaipei(),
      scoreLogIdsJson,
      locked: hasScore ? 1 : 0,
    },
    update: {
      score: hasScore ? Number(score) : null,
      feedback: feedback || null,
      memberScoresJson: Object.keys(memberScoreMap).length ? JSON.stringify(memberScoreMap) : null,
      gradedAt: getNowStrTaipei(),
      scoreLogIdsJson,
      ...(hasScore ? { locked: 1 } : {}),
    },
  });

  if (hasScore) {
    for (const memberId of await groupMemberIds(groupId)) {
      const override = memberScoreMap[String(memberId)];
      const finalScore = override !== undefined && String(override).trim() !== "" ? Number(override) : Number(score);
      await notifyStudent({
        courseId,
        studentId: memberId,
        type: "graded",
        title: `小組作業「${subUnit.title}」已評分：${finalScore} 分`,
        body: feedback || null,
        tab: "materials",
      });
    }
  } else if (typeof feedback === "string" && feedback.trim()) {
    await notifyStudents(await groupMemberIds(groupId), {
      courseId,
      type: "feedback",
      title: `老師在小組作業「${subUnit.title}」留下評語`,
      body: feedback,
      tab: "materials",
    });
  }

  res.json({ message: "評分已送出" });
});

unitsRouter.put("/:courseId/:unitId/subunits/:subUnitId/submissions/group/:groupId/lock", async (req, res) => {
  const subUnitId = Number(req.params.subUnitId);
  const groupId = Number(req.params.groupId);
  const locked = !!req.body?.locked;
  await prisma.submission.upsert({
    where: { subUnitId_groupId: { subUnitId, groupId } },
    create: { subUnitId, groupId, locked: locked ? 1 : 0, ...(locked ? {} : { teacherReopened: 1, resubmitRequested: 0 }) },
    update: { locked: locked ? 1 : 0, ...(locked ? {} : { teacherReopened: 1, resubmitRequested: 0 }) },
  });
  if (!locked) {
    const subUnit = await prisma.subUnit.findUnique({ where: { id: subUnitId } });
    if (subUnit) {
      await notifyStudents(await groupMemberIds(groupId), {
        courseId: Number(req.params.courseId),
        type: "reopened",
        title: `老師開放你的小組重新繳交「${subUnit.title}」`,
        tab: "materials",
      });
    }
  }
  res.json({ message: locked ? "小組作業已鎖定" : "小組作業已解鎖" });
});

// --- 提問串（Submission Comments，教師端，小組作業）---

unitsRouter.get("/:courseId/:unitId/subunits/:subUnitId/submissions/group/:groupId/comments", async (req, res) => {
  const courseId = Number(req.params.courseId);
  const unitId = Number(req.params.unitId);
  const subUnitId = Number(req.params.subUnitId);
  const groupId = Number(req.params.groupId);
  const subUnit = await loadAssignment(courseId, unitId, subUnitId);
  if (!subUnit) {
    res.status(404).json({ detail: "Assignment not found" });
    return;
  }
  res.json(await listSubmissionComments(prisma, { subUnitId, groupId }));
});

unitsRouter.post("/:courseId/:unitId/subunits/:subUnitId/submissions/group/:groupId/comments", async (req, res) => {
  const courseId = Number(req.params.courseId);
  const unitId = Number(req.params.unitId);
  const subUnitId = Number(req.params.subUnitId);
  const groupId = Number(req.params.groupId);
  const subUnit = await loadAssignment(courseId, unitId, subUnitId);
  if (!subUnit) {
    res.status(404).json({ detail: "Assignment not found" });
    return;
  }
  const message = typeof req.body?.message === "string" ? req.body.message.trim() : "";
  if (!message) {
    res.status(400).json({ detail: "請輸入訊息內容" });
    return;
  }
  await createSubmissionComment(prisma, { subUnitId, groupId }, "teacher", null, message, getNowStrTaipei());
  await notifyStudents(await groupMemberIds(groupId), {
    courseId,
    type: "reply",
    title: `老師回覆了你們小組在「${subUnit.title}」的提問`,
    body: message,
    tab: "materials",
  });
  res.json(await listSubmissionComments(prisma, { subUnitId, groupId }));
});
