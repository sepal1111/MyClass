// Routes for Paper Quizzes (紙本測驗成績管理)
import { Router } from "express";
import { prisma } from "../db";
import { autoCatch } from "../asyncRoute";
import { broadcastToCourse } from "../realtime";

export const paperQuizzesRouter = autoCatch(Router());

// 取得指定課程的所有紙本測驗列表與摘要統計
paperQuizzesRouter.get("/:courseId", async (req, res) => {
  const courseId = Number(req.params.courseId);
  const quizzes = await prisma.paperQuiz.findMany({
    where: { courseId },
    include: {
      subUnit: { select: { id: true, title: true } },
      records: {
        select: {
          id: true,
          studentId: true,
          score: true,
          isAbsent: true,
          photoUrl: true,
          isVerified: true,
          submittedBy: true,
          allowMakeup: true,
          isMakeup: true,
        },
      },
    },
    orderBy: [{ quizDate: "desc" }, { id: "desc" }],
  });

  const totalActiveStudents = await prisma.student.count({
    where: { courseId, isActive: 1 },
  });

  const serialized = quizzes.map((q) => {
    const records = q.records;
    const scoredRecords = records.filter(
      (r) => (!r.isAbsent || (r.allowMakeup === 1 && r.score !== null)) && r.score !== null
    );
    const absentCount = records.filter(
      (r) => r.isAbsent === 1 && (r.allowMakeup !== 1 || r.score === null)
    ).length;
    const makeupCount = records.filter((r) => r.allowMakeup === 1).length;
    const passCount = scoredRecords.filter((r) => (r.score ?? 0) >= q.passingScore).length;
    const failCount = scoredRecords.filter((r) => (r.score ?? 0) < q.passingScore).length;
    const pendingVerifyCount = records.filter((r) => r.photoUrl && r.isVerified === 0).length;

    let avgScore: number | null = null;
    let maxScoreActual: number | null = null;
    let minScoreActual: number | null = null;

    if (scoredRecords.length > 0) {
      const sum = scoredRecords.reduce((acc, r) => acc + (r.score ?? 0), 0);
      avgScore = Math.round((sum / scoredRecords.length) * 10) / 10;
      const scores = scoredRecords.map((r) => r.score ?? 0);
      maxScoreActual = Math.max(...scores);
      minScoreActual = Math.min(...scores);
    }

    const passRate = scoredRecords.length > 0 ? Math.round((passCount / scoredRecords.length) * 1000) / 10 : 0;

    return {
      id: q.id,
      course_id: q.courseId,
      title: q.title,
      subject: q.subject || "",
      quiz_date: q.quizDate,
      max_score: q.maxScore,
      passing_score: q.passingScore,
      sub_unit_id: q.subUnitId,
      sub_unit_title: q.subUnit?.title ?? null,
      allow_self_entry: q.allowSelfEntry === 1,
      allow_leader_entry: q.allowLeaderEntry === 1,
      created_at: q.createdAt,
      stats: {
        total_students: totalActiveStudents,
        recorded_count: scoredRecords.length + absentCount,
        scored_count: scoredRecords.length,
        absent_count: absentCount,
        makeup_count: makeupCount,
        pass_count: passCount,
        fail_count: failCount,
        pass_rate: passRate,
        average_score: avgScore,
        max_score_actual: maxScoreActual,
        min_score_actual: minScoreActual,
        pending_verify_count: pendingVerifyCount,
      },
    };
  });

  res.json({ quizzes: serialized });
});

// 取得紙本測驗成績總覽（支援科目與日期區間篩選，僅列出學生成績、平均與及格率，供教師快速即時觀看）
paperQuizzesRouter.get("/:courseId/overview", async (req, res) => {
  const courseId = Number(req.params.courseId);
  const { subject, start_date, end_date } = req.query;

  const quizWhere: Record<string, unknown> = { courseId };
  if (subject && String(subject).trim() !== "") {
    quizWhere.subject = String(subject).trim();
  }
  if (start_date || end_date) {
    const dateFilter: Record<string, string> = {};
    if (start_date) dateFilter.gte = String(start_date);
    if (end_date) dateFilter.lte = String(end_date);
    quizWhere.quizDate = dateFilter;
  }

  // 1. 取得符合條件的紙本測驗（依日期正序排列，便於橫向觀看歷程）
  const paperQuizzes = await prisma.paperQuiz.findMany({
    where: quizWhere,
    include: {
      subUnit: { select: { title: true } },
      records: {
        select: {
          studentId: true,
          score: true,
          isAbsent: true,
          leaveType: true,
          allowMakeup: true,
          isMakeup: true,
        },
      },
    },
    orderBy: [{ quizDate: "asc" }, { id: "asc" }],
  });

  // 2. 取得班級所有作用中的學生
  const students = await prisma.student.findMany({
    where: { courseId, isActive: 1 },
    orderBy: { studentNumber: "asc" },
  });

  // 3. 勾稽學生在各測驗日期的出席狀況 (Attendance)
  const quizDates = Array.from(new Set(paperQuizzes.map((q) => q.quizDate)));
  const attendances = await prisma.attendance.findMany({
    where: { courseId, date: { in: quizDates } },
  });
  const attMap = new Map<string, string>();
  for (const a of attendances) {
    attMap.set(`${a.date}_${a.studentId}`, a.status);
  }

  // 4. 測驗欄位定義與各測驗統計
  const quizzesMeta = paperQuizzes.map((q) => {
    const scoredList: number[] = [];
    let absentCnt = 0;
    let passCnt = 0;

    for (const s of students) {
      const rec = q.records.find((r) => r.studentId === s.id);
      const attStatus = attMap.get(`${q.quizDate}_${s.id}`);
      const isUnattendedDay = Boolean(attStatus && attStatus !== "present" && attStatus !== "late");

      const allowMakeup = rec ? rec.allowMakeup === 1 : false;
      let isAbsent = rec ? rec.isAbsent === 1 : (isUnattendedDay ? true : false);
      const hasScore = rec?.score !== null && rec?.score !== undefined;

      if (allowMakeup && hasScore) {
        isAbsent = false;
      }

      if (isAbsent) {
        absentCnt++;
      } else if (hasScore) {
        const sc = Number(rec!.score);
        scoredList.push(sc);
        if (sc >= q.passingScore) passCnt++;
      }
    }

    const avg = scoredList.length > 0
      ? Math.round((scoredList.reduce((a, b) => a + b, 0) / scoredList.length) * 10) / 10
      : null;
    const passRate = scoredList.length > 0
      ? Math.round((passCnt / scoredList.length) * 1000) / 10
      : null;

    return {
      id: q.id,
      title: q.title,
      subject: q.subject || "",
      quiz_date: q.quizDate,
      max_score: q.maxScore,
      passing_score: q.passingScore,
      sub_unit_title: q.subUnit?.title || null,
      stats: {
        scored_count: scoredList.length,
        absent_count: absentCnt,
        pass_count: passCnt,
        average_score: avg,
        pass_rate: passRate,
        max_score_actual: scoredList.length > 0 ? Math.max(...scoredList) : null,
        min_score_actual: scoredList.length > 0 ? Math.min(...scoredList) : null,
      },
    };
  });

  // 5. 逐位學生建構橫向成績列
  const studentRows = students.map((s) => {
    let sumScore = 0;
    let scoredCount = 0;
    let absentCount = 0;
    let passCount = 0;

    const scoresMap: Record<number, {
      score: number | null;
      is_absent: boolean;
      status_text: string;
      is_makeup: boolean;
      is_pass: boolean;
    }> = {};

    paperQuizzes.forEach((q) => {
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
        absentCount++;
        scoresMap[q.id] = {
          score: null,
          is_absent: true,
          status_text: "缺考",
          is_makeup: false,
          is_pass: false,
        };
      } else if (hasScore) {
        const sc = Number(rec!.score);
        sumScore += sc;
        scoredCount++;
        const isPass = sc >= q.passingScore;
        if (isPass) passCount++;

        scoresMap[q.id] = {
          score: sc,
          is_absent: false,
          status_text: String(sc),
          is_makeup: isMakeup,
          is_pass: isPass,
        };
      } else {
        scoresMap[q.id] = {
          score: null,
          is_absent: false,
          status_text: "-",
          is_makeup: false,
          is_pass: false,
        };
      }
    });

    const personalAvg = scoredCount > 0 ? Math.round((sumScore / scoredCount) * 10) / 10 : null;
    const personalPassRate = scoredCount > 0 ? Math.round((passCount / scoredCount) * 1000) / 10 : null;

    return {
      student_id: s.id,
      student_number: s.studentNumber,
      name: s.name,
      gender: s.gender,
      scores: scoresMap,
      summary: {
        scored_count: scoredCount,
        absent_count: absentCount,
        pass_count: passCount,
        average_score: personalAvg,
        pass_rate: personalPassRate,
      },
    };
  });

  res.json({
    quizzes: quizzesMeta,
    students: studentRows,
    total_quizzes: paperQuizzes.length,
    total_students: students.length,
  });
});

export function getLeaveLabelZh(status: string): string {
  switch (status) {
    case "sick_leave":
    case "absent":
      return "病假";
    case "personal_leave":
      return "事假";
    case "official_leave":
      return "公假";
    case "bereavement_leave":
      return "喪假";
    default:
      return "未出席";
  }
}

// 建立新紙本測驗
paperQuizzesRouter.post("/:courseId", async (req, res) => {
  const courseId = Number(req.params.courseId);
  const {
    title,
    subject = "",
    quiz_date,
    max_score = 100,
    passing_score = 60,
    sub_unit_id = null,
    allow_self_entry = 1,
    allow_leader_entry = 1,
  } = req.body ?? {};

  if (!title || !String(title).trim()) {
    res.status(400).json({ detail: "請輸入測驗名稱" });
    return;
  }
  if (!quiz_date) {
    res.status(400).json({ detail: "請選擇測驗日期" });
    return;
  }

  const quiz = await prisma.paperQuiz.create({
    data: {
      courseId,
      title: String(title).trim(),
      subject: subject ? String(subject).trim() : "",
      quizDate: String(quiz_date),
      maxScore: Number(max_score) || 100,
      passingScore: Number(passing_score) || 60,
      subUnitId: sub_unit_id ? Number(sub_unit_id) : null,
      allowSelfEntry: allow_self_entry ? 1 : 0,
      allowLeaderEntry: allow_leader_entry ? 1 : 0,
      createdAt: new Date().toISOString(),
    },
  });

  // 勾稽學生當天出席狀況：若當天未出席（請假/缺席），自動列為缺考並標示假別
  const attendances = await prisma.attendance.findMany({
    where: {
      courseId,
      date: String(quiz_date),
    },
  });

  const nowIso = new Date().toISOString();
  for (const att of attendances) {
    if (att.status !== "present" && att.status !== "late") {
      const leaveLabel = getLeaveLabelZh(att.status);
      await prisma.paperQuizRecord
        .create({
          data: {
            quizId: quiz.id,
            studentId: att.studentId,
            score: null,
            isAbsent: 1,
            leaveType: att.status,
            allowMakeup: 0,
            isMakeup: 0,
            submittedBy: "system",
            note: `當日${leaveLabel}未出席`,
            updatedAt: nowIso,
          },
        })
        .catch(() => {});
    }
  }

  broadcastToCourse(courseId, "paper_quizzes_updated");
  res.json({ message: "紙本測驗建立成功，已自動勾稽當日出席狀況！", quiz });
});

// 修改紙本測驗設定
paperQuizzesRouter.put("/:quizId", async (req, res) => {
  const quizId = Number(req.params.quizId);
  const quiz = await prisma.paperQuiz.findUnique({ where: { id: quizId } });
  if (!quiz) {
    res.status(404).json({ detail: "測驗不存在" });
    return;
  }

  const {
    title,
    subject,
    quiz_date,
    max_score,
    passing_score,
    sub_unit_id,
    allow_self_entry,
    allow_leader_entry,
  } = req.body ?? {};

  const data: Record<string, unknown> = {};
  if (title !== undefined) data.title = String(title).trim();
  if (subject !== undefined) data.subject = String(subject).trim();
  if (quiz_date !== undefined) data.quizDate = String(quiz_date);
  if (max_score !== undefined) data.maxScore = Number(max_score);
  if (passing_score !== undefined) data.passingScore = Number(passing_score);
  if (sub_unit_id !== undefined) data.subUnitId = sub_unit_id ? Number(sub_unit_id) : null;
  if (allow_self_entry !== undefined) data.allowSelfEntry = allow_self_entry ? 1 : 0;
  if (allow_leader_entry !== undefined) data.allowLeaderEntry = allow_leader_entry ? 1 : 0;

  const updated = await prisma.paperQuiz.update({
    where: { id: quizId },
    data,
  });

  broadcastToCourse(quiz.courseId, "paper_quizzes_updated");
  res.json({ message: "紙本測驗更新成功！", quiz: updated });
});

// 刪除紙本測驗
paperQuizzesRouter.delete("/:quizId", async (req, res) => {
  const quizId = Number(req.params.quizId);
  const quiz = await prisma.paperQuiz.findUnique({ where: { id: quizId } });
  if (!quiz) {
    res.status(404).json({ detail: "測驗不存在" });
    return;
  }

  await prisma.paperQuiz.delete({ where: { id: quizId } });
  broadcastToCourse(quiz.courseId, "paper_quizzes_updated");
  res.json({ message: "紙本測驗及所有登記成績已刪除！" });
});

// 取得該測驗的全班成績矩陣與統計分析
paperQuizzesRouter.get("/:quizId/matrix", async (req, res) => {
  const quizId = Number(req.params.quizId);
  const quiz = await prisma.paperQuiz.findUnique({
    where: { id: quizId },
    include: { subUnit: { select: { id: true, title: true } } },
  });
  if (!quiz) {
    res.status(404).json({ detail: "測驗不存在" });
    return;
  }

  const courseId = quiz.courseId;
  const students = await prisma.student.findMany({
    where: { courseId, isActive: 1 },
    orderBy: { studentNumber: "asc" },
  });

  // 取得目前作用中的分組方案與小組名稱
  const activePlan = await prisma.groupPlan.findFirst({
    where: { courseId, isActive: 1 },
    include: {
      groups: {
        include: {
          members: true,
        },
      },
    },
  });

  const studentGroupMap = new Map<number, { groupId: number; groupName: string; isLeader: boolean }>();
  if (activePlan) {
    for (const g of activePlan.groups) {
      for (const m of g.members) {
        studentGroupMap.set(m.studentId, {
          groupId: g.id,
          groupName: g.groupName,
          isLeader: m.isLeader === 1,
        });
      }
    }
  }

  // 取得所有登記記錄
  const records = await prisma.paperQuizRecord.findMany({
    where: { quizId },
  });
  const recordMap = new Map<number, typeof records[0]>();
  for (const r of records) {
    recordMap.set(r.studentId, r);
  }

  // 取得該測驗當天的出席紀錄 (Attendance)
  const attendances = await prisma.attendance.findMany({
    where: { courseId, date: quiz.quizDate },
  });
  const attendanceMap = new Map<number, string>();
  for (const a of attendances) {
    attendanceMap.set(a.studentId, a.status);
  }

  // 整合學生名冊與成績
  const studentRows = students.map((s) => {
    const groupInfo = studentGroupMap.get(s.id);
    const rec = recordMap.get(s.id);

    const attStatus = attendanceMap.get(s.id);
    const isUnattendedDay = !!(attStatus && attStatus !== "present" && attStatus !== "late");

    const isAbsent = rec ? rec.isAbsent === 1 : (isUnattendedDay ? true : false);
    const leaveType = rec?.leaveType || (isUnattendedDay ? (attStatus || "") : "");
    const leaveLabel = leaveType ? getLeaveLabelZh(leaveType) : "";
    const allowMakeup = rec ? rec.allowMakeup === 1 : false;
    const isMakeup = rec ? rec.isMakeup === 1 : false;
    const noteText = rec?.note ?? (isUnattendedDay && !rec ? `當日${leaveLabel}未出席` : "");

    return {
      student_id: s.id,
      student_number: s.studentNumber,
      student_code: s.studentCode,
      name: s.name,
      english_name: s.englishName,
      gender: s.gender,
      group_id: groupInfo?.groupId ?? null,
      group_name: groupInfo?.groupName ?? "未分組",
      is_leader: groupInfo?.isLeader ?? false,
      score: rec?.score ?? null,
      is_absent: isAbsent,
      leave_type: leaveType,
      leave_label: leaveLabel,
      allow_makeup: allowMakeup,
      is_makeup: isMakeup,
      makeup_score: rec?.makeupScore ?? null,
      photo_url: rec?.photoUrl ?? null,
      submitted_by: rec?.submittedBy ?? (isUnattendedDay && !rec ? "system" : null),
      submitted_by_id: rec?.submittedById ?? null,
      is_verified: rec?.isVerified === 1,
      note: noteText,
      updated_at: rec?.updatedAt ?? null,
    };
  });

  // 計算統計指標
  const scoredList = studentRows
    .filter((r) => !r.is_absent && r.score !== null)
    .map((r) => r.score as number)
    .sort((a, b) => a - b);

  const absentCount = studentRows.filter((r) => r.is_absent).length;
  const makeupCount = studentRows.filter((r) => r.allow_makeup).length;
  const passCount = scoredList.filter((s) => s >= quiz.passingScore).length;
  const failCount = scoredList.filter((s) => s < quiz.passingScore).length;
  const pendingVerifyCount = studentRows.filter((r) => r.photo_url && !r.is_verified).length;

  let averageScore: number | null = null;
  let medianScore: number | null = null;
  let maxScoreActual: number | null = null;
  let minScoreActual: number | null = null;

  if (scoredList.length > 0) {
    const sum = scoredList.reduce((acc, v) => acc + v, 0);
    averageScore = Math.round((sum / scoredList.length) * 10) / 10;
    maxScoreActual = scoredList[scoredList.length - 1];
    minScoreActual = scoredList[0];

    const mid = Math.floor(scoredList.length / 2);
    medianScore =
      scoredList.length % 2 !== 0
        ? scoredList[mid]
        : Math.round(((scoredList[mid - 1] + scoredList[mid]) / 2) * 10) / 10;
  }

  // 級距分佈
  const distribution = {
    range_90_100: scoredList.filter((s) => s >= 90).length,
    range_80_89: scoredList.filter((s) => s >= 80 && s < 90).length,
    range_70_79: scoredList.filter((s) => s >= 70 && s < 80).length,
    range_60_69: scoredList.filter((s) => s >= 60 && s < 70).length,
    range_below_60: scoredList.filter((s) => s < 60).length,
  };

  const passRate =
    scoredList.length > 0 ? Math.round((passCount / scoredList.length) * 1000) / 10 : 0;

  const stats = {
    total_students: students.length,
    submitted_count: records.length,
    scored_count: scoredList.length,
    absent_count: absentCount,
    makeup_count: makeupCount,
    pass_count: passCount,
    fail_count: failCount,
    pass_rate: passRate,
    average_score: averageScore,
    median_score: medianScore,
    max_score_actual: maxScoreActual,
    min_score_actual: minScoreActual,
    pending_verify_count: pendingVerifyCount,
    distribution,
  };

  res.json({
    quiz: {
      id: quiz.id,
      course_id: quiz.courseId,
      title: quiz.title,
      subject: quiz.subject || "",
      quiz_date: quiz.quizDate,
      max_score: quiz.maxScore,
      passing_score: quiz.passingScore,
      sub_unit_id: quiz.subUnitId,
      sub_unit_title: quiz.subUnit?.title ?? null,
      allow_self_entry: quiz.allowSelfEntry === 1,
      allow_leader_entry: quiz.allowLeaderEntry === 1,
    },
    stats,
    students: studentRows,
  });
});

// 教師開關學生補考權限
paperQuizzesRouter.post("/:quizId/makeup/:studentId", async (req, res) => {
  const quizId = Number(req.params.quizId);
  const studentId = Number(req.params.studentId);
  const { allow_makeup } = req.body ?? {};

  const quiz = await prisma.paperQuiz.findUnique({ where: { id: quizId } });
  if (!quiz) {
    res.status(404).json({ detail: "測驗不存在" });
    return;
  }

  const allowVal = allow_makeup ? 1 : 0;
  const now = new Date().toISOString();

  const record = await prisma.paperQuizRecord.upsert({
    where: { quizId_studentId: { quizId, studentId } },
    update: {
      allowMakeup: allowVal,
      updatedAt: now,
    },
    create: {
      quizId,
      studentId,
      score: null,
      isAbsent: 1,
      allowMakeup: allowVal,
      isMakeup: 0,
      submittedBy: "teacher",
      updatedAt: now,
    },
  });

  broadcastToCourse(quiz.courseId, "paper_quizzes_updated");
  res.json({
    message: allowVal ? "已為該生開啟補考！" : "已關閉該生補考！",
    record,
  });
});

// 教師批量儲存成績
paperQuizzesRouter.post("/:quizId/batch-save", async (req, res) => {
  const quizId = Number(req.params.quizId);
  const quiz = await prisma.paperQuiz.findUnique({ where: { id: quizId } });
  if (!quiz) {
    res.status(404).json({ detail: "測驗不存在" });
    return;
  }

  const { records } = req.body ?? {};
  if (!Array.isArray(records)) {
    res.status(400).json({ detail: "請提供成績記錄陣列 records" });
    return;
  }

  const now = new Date().toISOString();

  for (const item of records) {
    const studentId = Number(item.student_id);
    if (!studentId) continue;

    let isAbsent = item.is_absent ? 1 : 0;
    const allowMakeup = item.allow_makeup !== undefined ? (item.allow_makeup ? 1 : 0) : undefined;
    const hasScore = item.score !== null && item.score !== undefined && item.score !== "";
    if (allowMakeup && hasScore) {
      isAbsent = 0;
    }
    const scoreVal =
      isAbsent || !hasScore
        ? null
        : Math.min(Number(item.score), quiz.maxScore);

    const note = item.note !== undefined ? String(item.note) : undefined;
    const isVerified = item.is_verified !== undefined ? (item.is_verified ? 1 : 0) : undefined;
    const leaveType = item.leave_type !== undefined ? String(item.leave_type) : undefined;
    const isMakeup = item.is_makeup !== undefined ? (item.is_makeup ? 1 : 0) : (scoreVal !== null && allowMakeup ? 1 : undefined);

    await prisma.paperQuizRecord.upsert({
      where: { quizId_studentId: { quizId, studentId } },
      update: {
        score: scoreVal,
        isAbsent,
        ...(leaveType !== undefined ? { leaveType } : {}),
        ...(allowMakeup !== undefined ? { allowMakeup } : {}),
        ...(isMakeup !== undefined ? { isMakeup } : {}),
        ...(note !== undefined ? { note } : {}),
        ...(isVerified !== undefined ? { isVerified } : {}),
        submittedBy: item.submitted_by || "teacher",
        updatedAt: now,
      },
      create: {
        quizId,
        studentId,
        score: scoreVal,
        isAbsent,
        leaveType: leaveType ?? "",
        allowMakeup: allowMakeup ?? 0,
        isMakeup: isMakeup ?? 0,
        note: note ?? null,
        isVerified: isVerified ?? 1, // 教師手動登入預設視為已驗證
        submittedBy: "teacher",
        updatedAt: now,
      },
    });
  }

  broadcastToCourse(quiz.courseId, "paper_quizzes_updated");
  res.json({ message: "紙本測驗成績儲存成功！", count: records.length });
});

// 教師審核照片佐證
paperQuizzesRouter.post("/:quizId/verify/:studentId", async (req, res) => {
  const quizId = Number(req.params.quizId);
  const studentId = Number(req.params.studentId);
  const { is_verified = 1 } = req.body ?? {};

  const quiz = await prisma.paperQuiz.findUnique({ where: { id: quizId } });
  if (!quiz) {
    res.status(404).json({ detail: "測驗不存在" });
    return;
  }

  await prisma.paperQuizRecord.updateMany({
    where: { quizId, studentId },
    data: { isVerified: is_verified ? 1 : 0 },
  });

  broadcastToCourse(quiz.courseId, "paper_quizzes_updated");
  res.json({ message: is_verified ? "已核准考卷佐證照片！" : "已取消核准狀態" });
});
