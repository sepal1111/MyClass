// Default student password formula: zero-padded 4-digit student number (e.g. 座號 1 -> "0001").
// Deterministic and always available (unlike student_code/生日, which aren't always collected),
// so every student has a working login the moment a teacher imports the roster — no extra step.
import bcrypt from "bcryptjs";

export function defaultStudentPassword(studentNumber: number): string {
  return String(studentNumber).padStart(4, "0");
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
