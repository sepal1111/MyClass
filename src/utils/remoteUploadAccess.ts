// 從外網（學生專用入口）讀取 /uploads/* 的權限：只能讀「自己班級的教材」與「自己的作業」。
// 校內的存取規則不受影響（見 src/index.ts 的 /uploads/* 路由）。
//
// 依 bin/uploads 底下的目錄判斷（各目錄的寫入位置見對應的 routes/*.ts）：
//   materials/{courseId}/...                       教材 ➜ 同班才可讀
//   live_wall/{courseId}/...                       即時互動牆 ➜ 同班才可讀
//   submissions/{courseId}/{subUnitId}/{owner}/... 作業 ➜ 同班，且 owner 是自己（student_{id}）或自己所屬的組（group_{id}）
//   quizzes/quiz_{quizId}_stu_{studentId}_...      紙本小考照片 ➜ 只有自己的
//   collections/...                                檔案蒐集 ➜ 資料庫查得到「自己上傳的」那一筆
//   其他（notes 觀察紀錄、journal 日誌…）            ➜ 一律拒絕
import { prisma } from "../db";

export async function remoteStudentCanReadUpload(
  rel: string,
  student: { studentId: number; courseId: number }
): Promise<boolean> {
  const clean = rel.replace(/\\/g, "/");
  const parts = clean.split("/").filter(Boolean);
  if (parts.length < 2 || parts.some((p) => p === "." || p === "..")) return false;
  const [top, second] = parts;
  const sameCourse = second === String(student.courseId);

  switch (top) {
    case "materials":
    case "live_wall":
      return sameCourse;

    case "submissions": {
      if (!sameCourse || parts.length < 5) return false;
      const owner = parts[3];
      if (owner === `student_${student.studentId}`) return true;
      const m = /^group_(\d+)$/.exec(owner);
      if (!m) return false;
      const member = await prisma.groupMember.findFirst({
        where: { studentId: student.studentId, groupId: Number(m[1]) },
        select: { id: true },
      });
      return Boolean(member);
    }

    case "quizzes":
      return parts.length === 2 && new RegExp(`^quiz_\\d+_stu_${student.studentId}_`).test(second);

    case "collections": {
      const item = await prisma.fileCollectionItem.findFirst({
        where: {
          studentId: student.studentId,
          courseId: student.courseId,
          fileUrl: { in: [`/uploads/${clean}`, clean] },
        },
        select: { id: true },
      });
      return Boolean(item);
    }

    default:
      return false;
  }
}
