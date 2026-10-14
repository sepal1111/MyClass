// Shared helpers for 提問串 (Submission Comments) — a per-submission thread between a student
// (or their group) and the teacher, immutable once posted (no edit/delete endpoints exist by
// design, see node_migration_and_lms_plan.md §5.2: "建立後不可編輯刪除...做為永久稽核紀錄").
// Used by both routes/studentContent.ts (student side) and routes/units.ts (teacher side) so the
// two views of the same thread can never drift apart.
import type { PrismaClient } from "@prisma/client";

export type CommentThreadScope = { subUnitId: number; studentId: number } | { subUnitId: number; groupId: number };

function threadWhere(scope: CommentThreadScope) {
  return "studentId" in scope
    ? { subUnitId: scope.subUnitId, studentId: scope.studentId }
    : { subUnitId: scope.subUnitId, groupId: scope.groupId };
}

/** Resolves author_name server-side (teacher has no per-account identity in this system; a
 *  student's real name is looked up so the reader — teacher or the student's groupmates — can
 *  tell who actually asked/replied without the client needing its own roster lookup). */
export async function listSubmissionComments(prisma: PrismaClient, scope: CommentThreadScope) {
  const comments = await prisma.submissionComment.findMany({ where: threadWhere(scope), orderBy: { id: "asc" } });

  const studentIds = [...new Set(comments.filter((c) => c.authorRole === "student" && c.authorId != null).map((c) => c.authorId as number))];
  const students = studentIds.length ? await prisma.student.findMany({ where: { id: { in: studentIds } } }) : [];
  const nameMap = new Map(students.map((s) => [s.id, s.name]));

  return comments.map((c) => ({
    id: c.id,
    author_role: c.authorRole,
    author_name: c.authorRole === "teacher" ? "老師" : nameMap.get(c.authorId ?? -1) ?? "同學",
    message: c.message,
    created_at: c.createdAt,
  }));
}

export async function createSubmissionComment(
  prisma: PrismaClient,
  scope: CommentThreadScope,
  authorRole: "teacher" | "student",
  authorId: number | null,
  message: string,
  createdAt: string
) {
  await prisma.submissionComment.create({
    data: {
      subUnitId: scope.subUnitId,
      studentId: "studentId" in scope ? scope.studentId : null,
      groupId: "groupId" in scope ? scope.groupId : null,
      authorRole,
      authorId,
      message,
      createdAt,
    },
  });
}
