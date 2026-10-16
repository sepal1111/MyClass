// Student-facing LMS authentication — a JWT-based login layered on top of the
// existing teacher "system password" gate (middleware/auth.ts), not a
// replacement for it. See node_migration_and_lms_plan.md section 3: students
// log in with 座號+密碼 or a teacher-issued classroom QR join token, never
// with the teacher's shared system password.
import jwt from "jsonwebtoken";
import type { NextFunction, Request, Response } from "express";
import { prisma } from "../db";
import { isRemoteRequest } from "../remoteGateway";

import crypto from "crypto";

const TOKEN_TTL = "30d"; // Long-lived: a student's own device, not the teacher's shared session.
// 從外網（學生專用入口）登入簽發的憑證只有 7 天；校內簽發的 30 天憑證拿到外網用，也只接受簽發後 7 天內的。
const REMOTE_TOKEN_TTL = "7d";
const REMOTE_TOKEN_MAX_AGE_SEC = 7 * 24 * 60 * 60;

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

interface DecodedStudentToken extends StudentTokenPayload {
  /** 簽發時間（秒） */
  iat?: number;
  /** 密碼版本：由當時的密碼雜湊推導。密碼一改（學生自己改或老師重設），舊憑證就對不上而失效。 */
  pwv?: string;
}

/** 由密碼雜湊推導出的短版本碼（不可逆推密碼）。 */
export function passwordVersion(passwordHash: string | null): string {
  return crypto.createHash("sha256").update(passwordHash ?? "").digest("base64url").slice(0, 16);
}

export async function signStudentToken(
  payload: StudentTokenPayload,
  opts: { passwordHash: string | null; remote?: boolean }
): Promise<string> {
  const secret = await getJwtSecret();
  return jwt.sign({ ...payload, pwv: passwordVersion(opts.passwordHash) }, secret, {
    expiresIn: opts.remote ? REMOTE_TOKEN_TTL : TOKEN_TTL,
  });
}

export async function verifyStudentToken(token: string): Promise<DecodedStudentToken | null> {
  try {
    const secret = await getJwtSecret();
    const decoded = jwt.verify(token, secret);
    if (typeof decoded === "object" && decoded && "studentId" in decoded && "courseId" in decoded) {
      return {
        studentId: Number(decoded.studentId),
        courseId: Number(decoded.courseId),
        iat: typeof decoded.iat === "number" ? decoded.iat : undefined,
        pwv: typeof decoded.pwv === "string" ? decoded.pwv : undefined,
      };
    }
    return null;
  } catch {
    return null;
  }
}

type StudentRow = NonNullable<Awaited<ReturnType<typeof prisma.student.findFirst>>>;

/** 完整驗證學生憑證：簽章、帳號仍啟用、密碼沒改過；外網（remote）另外要求簽發 7 天內，
 *  且必須是帶有密碼版本的新式憑證。API、附件、即時連線共用這一個判斷。 */
export async function authenticateStudentToken(
  token: string,
  remote: boolean
): Promise<{ payload: StudentTokenPayload; student: StudentRow } | null> {
  const decoded = await verifyStudentToken(token);
  if (!decoded) return null;
  if (remote) {
    if (!decoded.pwv || !decoded.iat) return null;
    if (Date.now() / 1000 - decoded.iat > REMOTE_TOKEN_MAX_AGE_SEC) return null;
  }
  const student = await prisma.student.findFirst({
    where: { id: decoded.studentId, courseId: decoded.courseId, isActive: 1 },
  });
  if (!student) return null;
  // 舊式憑證（沒有 pwv）只在校內接受，到期自然淘汰
  if (decoded.pwv && decoded.pwv !== passwordVersion(student.passwordHash)) return null;
  return { payload: { studentId: decoded.studentId, courseId: decoded.courseId }, student };
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
    const auth = token ? await authenticateStudentToken(token, isRemoteRequest(req)) : null;
    if (!auth) {
      res.status(401).json({ detail: "未登入或登入已逾期，請重新登入！" });
      return;
    }
    // 第一次登入（或老師重設密碼後）必須先自己設定新密碼：/api/auth/student/*（me、change_password）
    // 以外的學生 API 一律擋下，前端收到這個代碼會跳出不能關閉的改密碼視窗。
    if (auth.student.mustChangePassword === 1 && !req.originalUrl.startsWith("/api/auth/student/")) {
      res.status(403).json({ detail: "請先設定你的新密碼才能使用。", code: "PASSWORD_CHANGE_REQUIRED" });
      return;
    }
    req.studentAuth = auth.payload;
    next();
  } catch (err) {
    next(err);
  }
}
