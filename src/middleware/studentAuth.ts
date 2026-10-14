// Student-facing LMS authentication — a JWT-based login layered on top of the
// existing teacher "system password" gate (middleware/auth.ts), not a
// replacement for it. See node_migration_and_lms_plan.md section 3: students
// log in with 座號+密碼 or a teacher-issued classroom QR join token, never
// with the teacher's shared system password.
import jwt from "jsonwebtoken";
import type { NextFunction, Request, Response } from "express";
import { prisma } from "../db";

const TOKEN_TTL = "30d"; // Long-lived: a student's own device, not the teacher's shared session.

let cachedSecret: string | undefined;

async function getJwtSecret(): Promise<string> {
  if (cachedSecret) return cachedSecret;
  const row = await prisma.systemSetting.findUnique({ where: { key: "jwt_secret" } });
  if (!row) throw new Error("jwt_secret is not initialized — initSchema() must run before any student auth call");
  cachedSecret = row.value;
  return cachedSecret;
}

export interface StudentTokenPayload {
  studentId: number;
  courseId: number;
}

export async function signStudentToken(payload: StudentTokenPayload): Promise<string> {
  const secret = await getJwtSecret();
  return jwt.sign(payload, secret, { expiresIn: TOKEN_TTL });
}

export async function verifyStudentToken(token: string): Promise<StudentTokenPayload | null> {
  try {
    const secret = await getJwtSecret();
    const decoded = jwt.verify(token, secret);
    if (typeof decoded === "object" && decoded && "studentId" in decoded && "courseId" in decoded) {
      return { studentId: Number(decoded.studentId), courseId: Number(decoded.courseId) };
    }
    return null;
  } catch {
    return null;
  }
}

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      studentAuth?: StudentTokenPayload;
    }
  }
}

export function getBearerToken(req: Request): string | undefined {
  const header = req.headers.authorization;
  if (header?.startsWith("Bearer ")) return header.slice(7).trim();
  return undefined;
}

/** Express middleware requiring a valid student JWT; attaches `req.studentAuth`. */
export async function requireStudentAuth(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const token = getBearerToken(req);
    const payload = token ? await verifyStudentToken(token) : null;
    if (!payload) {
      res.status(401).json({ detail: "未登入或登入已逾期，請重新登入！" });
      return;
    }
    const student = await prisma.student.findFirst({
      where: { id: payload.studentId, courseId: payload.courseId, isActive: 1 },
    });
    if (!student) {
      res.status(401).json({ detail: "帳號不存在或已停用，請重新登入！" });
      return;
    }
    req.studentAuth = payload;
    next();
  } catch (err) {
    next(err);
  }
}
