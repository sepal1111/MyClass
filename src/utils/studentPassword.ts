// 預設密碼 = 學號（student_code）。沒有填學號的學生，退而使用四位數座號（座號 1 -> "0001"），
// 這樣每位學生在老師匯入名冊的當下就有可用的登入密碼，不需要額外步驟。
// 學生第一次登入時必須自己改成新密碼（見 routes/studentAuth.ts）。
import bcrypt from "bcryptjs";

// 在家（外網）登入的密碼門檻：至少 8 個字，且同時包含英文字母與數字。
// 校內登入不受此限制；只是太簡單的密碼只能在學校使用。
export const REMOTE_PASSWORD_RULE = "至少 8 個字，並且同時包含英文字母和數字";

export function isStrongEnoughForRemote(password: string): boolean {
  return password.length >= 8 && /[A-Za-z]/.test(password) && /[0-9]/.test(password);
}

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
