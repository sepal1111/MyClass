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
import { hashPassword, verifyPassword } from "../utils/studentPassword";
import {
  clearHintFailures,
  recordHintFailure,
  recordStudentLoginFailure,
  recordStudentLoginSuccess,
  shouldShowHint,
  studentLoginBlockedSeconds,
} from "../middleware/loginThrottle";
import { composeHint, validateHint } from "../utils/passwordHint";
import { requireStudentAuth, signStudentToken } from "../middleware/studentAuth";

export const studentAuthRouter = autoCatch(Router());

studentAuthRouter.post("/login_by_account", async (req, res) => {
  const account: string = (req.body?.account ?? "").trim();
  const password: string = req.body?.password ?? "";

  // 密碼多次輸入錯誤後，把這個帳號的「密碼提醒」顯示出來（帳號不存在或沒設提醒就不顯示）。
  const hintFor = async (): Promise<string | null> => {
    if (!account || !shouldShowHint(account)) return null;
    const found = (await findStudentsByAccountIgnoreCase(account))[0];
    return found ? composeHint({ prefix: found.pwHintPrefix, main: found.pwHintMain, suffix: found.pwHintSuffix }) : null;
  };

  const blocked = account ? studentLoginBlockedSeconds(req, account) : 0;
  if (blocked > 0) {
    res.setHeader("Retry-After", String(blocked));
    res.status(429).json({
      detail: `這個帳號登入失敗次數過多，請 ${Math.ceil(blocked / 60)} 分鐘後再試，或請老師協助。`,
      hint: await hintFor(),
    });
    return;
  }

  // 帳號不分大小寫（iPad 常把第一個字母自動大寫）。完全相符的優先；若有多個只差大小寫的帳號，
  // 依序以密碼驗證，第一個密碼相符的才算登入成功。
  const candidates = account ? await findStudentsByAccountIgnoreCase(account) : [];
  const student = candidates.find((s) => verifyPassword(password, s.passwordHash)) ?? null;
  if (!student) {
    if (account) {
      recordStudentLoginFailure(req, account);
      recordHintFailure(account);
    }
    res.status(401).json({ detail: "帳號或密碼錯誤，請確認後再試一次！", hint: await hintFor() });
    return;
  }
  recordStudentLoginSuccess(account);
  clearHintFailures(account);

  const token = await signStudentToken({ studentId: student.id, courseId: student.courseId });
  res.json({
    token,
    student: { id: student.id, student_number: student.studentNumber, name: student.name, course_id: student.courseId },
    must_change_password: student.mustChangePassword === 1,
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
      must_change_password: student.mustChangePassword === 1,
      has_password_hint: Boolean(student.pwHintMain),
    },
    course: { id: course.id, name: course.name },
  });
});

// 學生自行修改密碼（需已登入）。已簽發的登入憑證（30 天）不會因此失效；老師重設密碼同理。
studentAuthRouter.post("/change_password", requireStudentAuth, async (req, res) => {
  const { studentId } = req.studentAuth!;
  const current = String(req.body?.current_password ?? "");
  const next = String(req.body?.new_password ?? "");

  const student = await prisma.student.findUnique({ where: { id: studentId } });
  if (!student) {
    res.status(404).json({ detail: "找不到學生資料" });
    return;
  }
  const account = student.loginAccount ?? String(studentId);

  const blocked = studentLoginBlockedSeconds(req, account);
  if (blocked > 0) {
    res.setHeader("Retry-After", String(blocked));
    res.status(429).json({ detail: `嘗試次數過多，請 ${Math.ceil(blocked / 60)} 分鐘後再試。` });
    return;
  }
  if (!verifyPassword(current, student.passwordHash)) {
    recordStudentLoginFailure(req, account);
    res.status(400).json({ detail: "目前的密碼不正確。" });
    return;
  }
  recordStudentLoginSuccess(account);

  // 同時送來的密碼提醒先驗證（有任何一格有填才處理；全空代表不動既有提醒）
  const hintInput = {
    prefix: req.body?.hint_prefix,
    main: req.body?.hint_main,
    suffix: req.body?.hint_suffix,
  };
  const hasHintInput = [hintInput.prefix, hintInput.main, hintInput.suffix].some(
    (v) => typeof v === "string" && v.trim() !== ""
  );
  const hintCheck = hasHintInput ? validateHint(hintInput) : null;
  if (hintCheck && !hintCheck.ok) {
    res.status(400).json({ detail: hintCheck.detail });
    return;
  }

  // 新密碼沒有任何規則限制（長度、是否與帳號或預設相同都不管），只擋掉「完全空白」
  // 與不合理的超長輸入。
  if (next.length === 0) {
    res.status(400).json({ detail: "請輸入新密碼。" });
    return;
  }
  if (next.length > 200) {
    res.status(400).json({ detail: "新密碼太長了。" });
    return;
  }

  await prisma.student.update({
    where: { id: studentId },
    data: {
      passwordHash: hashPassword(next),
      mustChangePassword: 0,
      // 換了新密碼：沒有同時填新的提醒，就清掉舊提醒（舊提醒對新密碼已經沒有意義）
      ...(hintCheck && hintCheck.ok && !hintCheck.clear
        ? {
            pwHintPrefix: hintCheck.parts.prefix,
            pwHintMain: hintCheck.parts.main,
            pwHintSuffix: hintCheck.parts.suffix,
          }
        : { pwHintPrefix: null, pwHintMain: null, pwHintSuffix: null }),
    },
  });
  res.json({ message: "密碼已更新！下次登入請使用新密碼。" });
});

// ---- 密碼提醒（學生自己看、自己改；全空代表清除）。改密碼前也可以使用，所以放在 /api/auth/student 底下。

studentAuthRouter.get("/password_hint", requireStudentAuth, async (req, res) => {
  const { studentId } = req.studentAuth!;
  const s = await prisma.student.findUnique({ where: { id: studentId } });
  if (!s) {
    res.status(404).json({ detail: "找不到學生資料" });
    return;
  }
  const parts = { prefix: s.pwHintPrefix, main: s.pwHintMain, suffix: s.pwHintSuffix };
  res.json({ ...parts, hint: composeHint(parts) });
});

studentAuthRouter.put("/password_hint", requireStudentAuth, async (req, res) => {
  const { studentId } = req.studentAuth!;
  const check = validateHint({ prefix: req.body?.prefix, main: req.body?.main, suffix: req.body?.suffix });
  if (!check.ok) {
    res.status(400).json({ detail: check.detail });
    return;
  }
  const data = check.clear
    ? { pwHintPrefix: null, pwHintMain: null, pwHintSuffix: null }
    : { pwHintPrefix: check.parts.prefix, pwHintMain: check.parts.main, pwHintSuffix: check.parts.suffix };
  await prisma.student.update({ where: { id: studentId }, data });
  const parts = check.clear
    ? { prefix: null, main: null, suffix: null }
    : { prefix: check.parts.prefix, main: check.parts.main, suffix: check.parts.suffix };
  res.json({
    ...parts,
    hint: composeHint(parts),
    message: check.clear ? "密碼提醒已清除。" : "密碼提醒已儲存！",
  });
});
