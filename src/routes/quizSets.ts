// 課堂答題競賽（Kahoot-style Quiz Set）：
// 支援題庫管理（題幹、選項、計時、分值、解析）及賽後一鍵加分獎勵
import { Router } from "express";
import { prisma } from "../db";
import { getNowStrTaipei } from "../timezone";
import { autoCatch } from "../asyncRoute";

export const quizSetsRouter = autoCatch(Router());

// 取得課程所有的測驗題庫
quizSetsRouter.get("/:courseId", async (req, res) => {
  const courseId = Number(req.params.courseId);
  const sets = await prisma.quizSet.findMany({
    where: { courseId },
    include: {
      questions: {
        orderBy: { orderIndex: "asc" },
      },
    },
    orderBy: { id: "desc" },
  });

  res.json(
    sets.map((s) => ({
      id: s.id,
      course_id: s.courseId,
      title: s.title,
      description: s.description || "",
      category: s.category || "課堂測驗",
      question_count: s.questions.length,
      questions: s.questions.map((q) => ({
        id: q.id,
        quiz_set_id: q.quizSetId,
        order_index: q.orderIndex,
        prompt: q.prompt,
        question_type: q.questionType,
        options: JSON.parse(q.options || "[]"),
        time_limit_sec: q.timeLimitSec,
        points: q.points,
        image_url: q.imageUrl,
        explanation: q.explanation || "",
      })),
      created_at: s.createdAt,
      updated_at: s.updatedAt,
    }))
  );
});

// 取得課程中所有 LMS 線上測驗小單元及其題目
quizSetsRouter.get("/:courseId/lms-quizzes", async (req, res) => {
  const courseId = Number(req.params.courseId);
  const units = await prisma.unit.findMany({
    where: { courseId },
    orderBy: [{ orderIndex: "asc" }, { id: "asc" }],
    include: {
      subUnits: {
        where: { category: "quiz" },
        orderBy: [{ orderIndex: "asc" }, { id: "asc" }],
      },
    },
  });

  const list = [];
  for (const u of units) {
    for (const su of u.subUnits) {
      let rawQuestions: any[] = [];
      try {
        rawQuestions = su.quizQuestions ? JSON.parse(su.quizQuestions) : [];
      } catch {}

      list.push({
        sub_unit_id: su.id,
        unit_id: u.id,
        unit_title: u.title,
        quiz_title: su.title,
        question_count: rawQuestions.length,
        questions: rawQuestions.map((q: any, idx: number) => ({
          id: q.id || `lms_q_${idx}`,
          type: q.type || (Array.isArray(q.options) && q.options.length > 0 ? "multiple_choice" : "true_false"),
          question_text: q.question_text || q.prompt || "",
          options: Array.isArray(q.options) ? q.options : [],
          correct_answer: String(q.correct_answer ?? ""),
          points: Number(q.points) || 10,
        })),
      });
    }
  }

  res.json(list);
});

// 批次匯入題目（支援建立新題庫或附加至既有題庫）
quizSetsRouter.post("/:courseId/import", async (req, res) => {
  const courseId = Number(req.params.courseId);
  const targetSetId = req.body?.target_set_id ? Number(req.body.target_set_id) : null;
  const title = (req.body?.title ?? "").trim() || "匯入測驗題庫";
  const incomingQuestions = Array.isArray(req.body?.questions) ? req.body.questions : [];

  if (incomingQuestions.length === 0) {
    res.status(400).json({ detail: "請提供至少一道要匯入的題目" });
    return;
  }

  const now = getNowStrTaipei();
  let quizSet;

  if (targetSetId) {
    quizSet = await prisma.quizSet.findFirst({ where: { id: targetSetId, courseId } });
    if (!quizSet) {
      res.status(404).json({ detail: "指定的目標題庫不存在" });
      return;
    }
  } else {
    quizSet = await prisma.quizSet.create({
      data: {
        courseId,
        title,
        description: req.body?.description || "由 LMS 線上測驗或檔案匯入",
        category: "課堂測驗",
        createdAt: now,
        updatedAt: now,
      },
    });
  }

  const lastQ = await prisma.quizQuestion.findFirst({
    where: { quizSetId: quizSet.id },
    orderBy: { orderIndex: "desc" },
  });
  let startIndex = (lastQ?.orderIndex ?? -1) + 1;

  const createdList = [];
  for (const q of incomingQuestions) {
    const prompt = (q.prompt || q.question_text || "").trim();
    if (!prompt) continue;

    let optionsArr: { id: string; text: string; isCorrect: boolean }[] = [];
    const qType = q.type || q.question_type || "multiple_choice";

    if (Array.isArray(q.options) && q.options.length > 0) {
      if (typeof q.options[0] === "object" && q.options[0] !== null && "text" in q.options[0]) {
        optionsArr = q.options;
      } else {
        const correctAnsStr = String(q.correct_answer ?? "").trim();
        optionsArr = q.options.map((optText: unknown, oi: number) => {
          const str = String(optText ?? "").trim();
          const isMatch = correctAnsStr === String(oi) || correctAnsStr === str;
          return {
            id: ["A", "B", "C", "D"][oi] || String(oi + 1),
            text: str,
            isCorrect: isMatch,
          };
        });
        if (!optionsArr.some((o) => o.isCorrect)) {
          const num = parseInt(correctAnsStr, 10);
          if (!isNaN(num) && num >= 1 && num <= optionsArr.length) {
            optionsArr[num - 1].isCorrect = true;
          } else if (optionsArr.length > 0) {
            optionsArr[0].isCorrect = true;
          }
        }
      }
    } else if (qType === "true_false") {
      const ca = String(q.correct_answer ?? "").toLowerCase().trim();
      const isTrue = ca === "true" || ca === "1" || ca === "o" || ca === "正確" || ca === "是";
      optionsArr = [
        { id: "A", text: "⭕ 正確", isCorrect: isTrue },
        { id: "B", text: "❌ 錯誤", isCorrect: !isTrue },
      ];
    }

    if (optionsArr.length < 2) continue;

    const created = await prisma.quizQuestion.create({
      data: {
        quizSetId: quizSet.id,
        orderIndex: startIndex++,
        prompt,
        questionType: optionsArr.length === 2 ? "true_false" : "single",
        options: JSON.stringify(optionsArr),
        timeLimitSec: Number(q.time_limit_sec) || 20,
        points: Number(q.points) || 1000,
        imageUrl: q.image_url || null,
        explanation: q.explanation || null,
      },
    });
    createdList.push(created);
  }

  await prisma.quizSet.update({
    where: { id: quizSet.id },
    data: { updatedAt: now },
  });

  res.json({
    message: `已成功匯入 ${createdList.length} 道題目`,
    quiz_set_id: quizSet.id,
    title: quizSet.title,
    count: createdList.length,
  });
});

// 新增測驗題庫
quizSetsRouter.post("/:courseId", async (req, res) => {
  const courseId = Number(req.params.courseId);
  const title = (req.body?.title ?? "").trim();
  if (!title) {
    res.status(400).json({ detail: "請填寫題庫名稱" });
    return;
  }
  const description = typeof req.body?.description === "string" ? req.body.description.trim() : null;
  const category = typeof req.body?.category === "string" ? req.body.category.trim() : "課堂測驗";
  const now = getNowStrTaipei();

  const newSet = await prisma.quizSet.create({
    data: {
      courseId,
      title,
      description,
      category,
      createdAt: now,
      updatedAt: now,
    },
  });

  res.json({
    id: newSet.id,
    course_id: newSet.courseId,
    title: newSet.title,
    description: newSet.description || "",
    category: newSet.category || "課堂測驗",
    question_count: 0,
    questions: [],
    created_at: newSet.createdAt,
    updated_at: newSet.updatedAt,
  });
});

// 修改測驗題庫資訊
quizSetsRouter.put("/:courseId/:id", async (req, res) => {
  const courseId = Number(req.params.courseId);
  const id = Number(req.params.id);
  if (isNaN(courseId) || isNaN(id)) {
    res.status(400).json({ detail: "無效的 ID 參數" });
    return;
  }
  const data: Record<string, unknown> = {};

  if (typeof req.body?.title === "string" && req.body.title.trim()) {
    data.title = req.body.title.trim();
  }
  if (typeof req.body?.description === "string") {
    data.description = req.body.description.trim();
  }
  if (typeof req.body?.category === "string") {
    data.category = req.body.category.trim();
  }
  data.updatedAt = getNowStrTaipei();

  const result = await prisma.quizSet.updateMany({
    where: { id, courseId },
    data,
  });
  if (result.count === 0) {
    res.status(404).json({ detail: "找不到指定的題庫" });
    return;
  }
  res.json({ message: "題庫已更新" });
});

// 刪除測驗題庫
quizSetsRouter.delete("/:courseId/:id", async (req, res) => {
  const courseId = Number(req.params.courseId);
  const id = Number(req.params.id);
  if (isNaN(courseId) || isNaN(id)) {
    res.status(400).json({ detail: "無效的 ID 參數" });
    return;
  }
  await prisma.quizSet.deleteMany({
    where: { id, courseId },
  });
  res.json({ message: "題庫已刪除" });
});

// 取得單個題庫內所有題目
quizSetsRouter.get("/:courseId/:id/questions", async (req, res) => {
  const courseId = Number(req.params.courseId);
  const id = Number(req.params.id);
  if (isNaN(courseId) || isNaN(id)) {
    res.status(400).json({ detail: "無效的 ID 參數" });
    return;
  }
  const quizSet = await prisma.quizSet.findFirst({
    where: { id, courseId },
    include: {
      questions: {
        orderBy: { orderIndex: "asc" },
      },
    },
  });
  if (!quizSet) {
    res.status(404).json({ detail: "題庫不存在" });
    return;
  }
  res.json(
    quizSet.questions.map((q) => ({
      id: q.id,
      quiz_set_id: q.quizSetId,
      order_index: q.orderIndex,
      prompt: q.prompt,
      question_type: q.questionType,
      options: JSON.parse(q.options || "[]"),
      time_limit_sec: q.timeLimitSec,
      points: q.points,
      image_url: q.imageUrl,
      explanation: q.explanation || "",
    }))
  );
});

// 新增題目到題庫
quizSetsRouter.post("/:courseId/:id/questions", async (req, res) => {
  const courseId = Number(req.params.courseId);
  const quizSetId = Number(req.params.id);

  const quizSet = await prisma.quizSet.findFirst({ where: { id: quizSetId, courseId } });
  if (!quizSet) {
    res.status(404).json({ detail: "題庫不存在" });
    return;
  }

  const prompt = (req.body?.prompt ?? "").trim();
  if (!prompt) {
    res.status(400).json({ detail: "請填寫題目內容" });
    return;
  }

  const optionsArr = Array.isArray(req.body?.options) ? req.body.options : [];
  if (optionsArr.length < 2) {
    res.status(400).json({ detail: "題目至少需要 2 個選項" });
    return;
  }

  const timeLimitSec = Number(req.body?.time_limit_sec) || 20;
  const points = Number(req.body?.points) || 1000;
  const questionType = req.body?.question_type || "single";
  const imageUrl = req.body?.image_url || null;
  const explanation = req.body?.explanation || null;

  const lastQ = await prisma.quizQuestion.findFirst({
    where: { quizSetId },
    orderBy: { orderIndex: "desc" },
  });
  const orderIndex = (lastQ?.orderIndex ?? -1) + 1;

  const created = await prisma.quizQuestion.create({
    data: {
      quizSetId,
      orderIndex,
      prompt,
      questionType,
      options: JSON.stringify(optionsArr),
      timeLimitSec,
      points,
      imageUrl,
      explanation,
    },
  });

  // 更新題庫的 updatedAt
  await prisma.quizSet.update({
    where: { id: quizSetId },
    data: { updatedAt: getNowStrTaipei() },
  });

  res.json({
    id: created.id,
    quiz_set_id: created.quizSetId,
    order_index: created.orderIndex,
    prompt: created.prompt,
    question_type: created.questionType,
    options: optionsArr,
    time_limit_sec: created.timeLimitSec,
    points: created.points,
    image_url: created.imageUrl,
    explanation: created.explanation || "",
  });
});

// 修改題目
quizSetsRouter.put("/:courseId/:id/questions/:qId", async (req, res) => {
  const qId = Number(req.params.qId);
  const data: Record<string, unknown> = {};

  if (typeof req.body?.prompt === "string" && req.body.prompt.trim()) {
    data.prompt = req.body.prompt.trim();
  }
  if (Array.isArray(req.body?.options)) {
    data.options = JSON.stringify(req.body.options);
  }
  if (req.body?.time_limit_sec !== undefined) {
    data.timeLimitSec = Number(req.body.time_limit_sec) || 20;
  }
  if (req.body?.points !== undefined) {
    data.points = Number(req.body.points) || 1000;
  }
  if (req.body?.question_type !== undefined) {
    data.questionType = String(req.body.question_type);
  }
  if (req.body?.image_url !== undefined) {
    data.imageUrl = req.body.image_url;
  }
  if (req.body?.explanation !== undefined) {
    data.explanation = req.body.explanation;
  }
  if (req.body?.order_index !== undefined) {
    data.orderIndex = Number(req.body.order_index);
  }

  await prisma.quizQuestion.update({
    where: { id: qId },
    data,
  });

  res.json({ message: "題目已更新" });
});

// 刪除題目
quizSetsRouter.delete("/:courseId/:id/questions/:qId", async (req, res) => {
  const qId = Number(req.params.qId);
  await prisma.quizQuestion.delete({
    where: { id: qId },
  });
  res.json({ message: "題目已刪除" });
});

// 答題競賽獲勝者一鍵發放獎勵加分到 ScoreLog
quizSetsRouter.post("/:courseId/award-scores", async (req, res) => {
  const courseId = Number(req.params.courseId);
  const rewards = req.body?.rewards; // Array of { studentId: number, score: number, reason: string, groupId?: number }
  if (!Array.isArray(rewards) || rewards.length === 0) {
    res.status(400).json({ detail: "無獎勵名單" });
    return;
  }

  const now = getNowStrTaipei();
  const today = now.slice(0, 10);
  const createdLogs = [];

  for (const r of rewards) {
    if (!r.studentId || !r.score) continue;
    const scoreVal = Number(r.score);
    const log = await prisma.scoreLog.create({
      data: {
        courseId,
        studentId: Number(r.studentId),
        ruleTitle: r.reason || "答題競賽優勝獎勵",
        score: scoreVal,
        category: scoreVal >= 0 ? "positive" : "negative",
        date: today,
        timestamp: now,
        groupId: r.groupId ? Number(r.groupId) : null,
      },
    });
    createdLogs.push(log);
  }

  // 通知前端即時更新分數排行榜
  import("../realtime").then(({ broadcastToCourse }) => {
    broadcastToCourse(courseId, "score_updated");
  });

  res.json({
    message: `成功發放 ${createdLogs.length} 筆獎勵分數`,
    count: createdLogs.length,
  });
});
