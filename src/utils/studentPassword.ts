// 預設密碼 = 學號（student_code）。沒有填學號的學生，退而使用四位數座號（座號 1 -> "0001"），
// 這樣每位學生在老師匯入名冊的當下就有可用的登入密碼，不需要額外步驟。
// 學生第一次登入時必須自己改成新密碼（見 routes/studentAuth.ts）。
import bcrypt from "bcryptjs";

export function defaultStudentPassword(studentNumber: number, studentCode?: string | null): string {
  const code = (studentCode ?? "").trim();
  return code || String(studentNumber).padStart(4, "0");
}

// Default login account: {course_id}-{4-digit padded student number}. Deterministic and
// collision-free across courses in the same deployment (login_account is unique system-wide,
// not per-course, so it doubles as the "which course" lookup — see routes/studentAuth.ts
// login_by_account). Teachers can still override it with anything memorable per student.
export function defaultStudentAccount(courseId: number, studentNumber: number): string {
  return `${courseId}-${String(studentNumber).padStart(4, "0")}`;
}

export function hashPassword(plain: string): string {
  return bcrypt.hashSync(plain, 10);
}

export function verifyPassword(plain: string, hash: string | null): boolean {
  if (!hash) return false;
  return bcrypt.compareSync(plain, hash);
}
