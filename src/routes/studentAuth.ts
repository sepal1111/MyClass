// Student-facing login endpoints — public (no teacher session required), the
// counterpart to the account-management endpoints in routes/courses.ts.
// Single way in: 帳號 + 密碼 (見 prisma schema Student.loginAccount 註解). Earlier
// revisions also had 座號+密碼 login and a classroom QR join flow; both were removed
// once every student got a dedicated login_account, since account+password alone
// already identifies the student (and therefore the course) without picking one first.
import { findStudentsByAccountIgnoreCase } from "../utils/studentAccount";
import { Router } from "express";
import { prisma } from "../db";
import { autoCatch } from "../asyncRoute";
import { verifyPassword } from "../utils/studentPassword";
import { requireStudentAuth, signStudentToken } from "../middleware/studentAuth";

export const studentAuthRouter = autoCatch(Router());

studentAuthRouter.post("/login_by_account", async (req, res) => {
  const account: string = (req.body?.account ?? "").trim();
  const password: string = req.body?.password ?? "";

  // 帳號不分大小寫（iPad 常把第一個字母自動大寫）。完全相符的優先；若有多個只差大小寫的帳號，
  // 依序以密碼驗證，第一個密碼相符的才算登入成功。
  const candidates = account ? await findStudentsByAccountIgnoreCase(account) : [];
  const student = candidates.find((s) => verifyPassword(password, s.passwordHash)) ?? null;
  if (!student) {
    res.status(401).json({ detail: "帳號或密碼錯誤，請確認後再試一次！" });
    return;
  }

  const token = await signStudentToken({ studentId: student.id, courseId: student.courseId });
  res.json({
    token,
    student: { id: student.id, student_number: student.studentNumber, name: student.name, course_id: student.courseId },
  });
});

studentAuthRouter.get("/me", requireStudentAuth, async (req, res) => {
  const { studentId, courseId } = req.studentAuth!;
  const student = await prisma.student.findUnique({ where: { id: studentId } });
  const course = await prisma.course.findUnique({ where: { id: courseId } });
  if (!student || !course) {
    res.status(404).json({ detail: "Student or course not found" });
    return;
  }
  res.json({
    student: {
      id: student.id,
      student_number: student.studentNumber,
      name: student.name,
      english_name: student.englishName,
      gender: student.gender,
      login_account: student.loginAccount,
    },
    course: { id: course.id, name: course.name },
  });
});
