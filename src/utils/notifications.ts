// 學生端「🔔 通知」：寫入通知、推播給學生自己的連線。
// 通知是「附帶功能」——寫入失敗只記警告，絕不能讓批改、核准等主要操作跟著失敗。
import { prisma } from "../db";
import { pushStudentNotification, pushTeacherNotification } from "../realtime";
import { getNowStrTaipei } from "../timezone";

/** 點擊通知後學生端要切換到的分頁（對應 student.js 的 switchTab key）。 */
export type NotificationTab = "materials" | "fileCollect" | "quizzes" | "scores";

export interface NotificationInput {
  courseId: number;
  studentId: number;
  type: string;
  title: string;
  body?: string | null;
  tab?: NotificationTab | null;
  refId?: number | null;
}

const MAX_PER_STUDENT = 100;
/** 同一單元短時間內連續新增的內容，合併成一則通知，避免老師一次建 10 筆教材時洗版。 */
const NEW_CONTENT_MERGE_MINUTES = 10;

function nowMinusMinutes(minutes: number): string {
  const asUtc = new Date(getNowStrTaipei().replace(" ", "T") + "Z");
  return new Date(asUtc.getTime() - minutes * 60 * 1000).toISOString().slice(0, 19).replace("T", " ");
}

function clip(text: string | null | undefined, max = 60): string | null {
  const t = (text ?? "").trim();
  if (!t) return null;
  return t.length > max ? `${t.slice(0, max)}…` : t;
}

async function trimOld(studentId: number): Promise<void> {
  await prisma.$executeRaw`
    DELETE FROM student_notifications
    WHERE student_id = ${studentId}
      AND id NOT IN (
        SELECT id FROM student_notifications WHERE student_id = ${studentId} ORDER BY id DESC LIMIT ${MAX_PER_STUDENT}
      )`;
}

export async function notifyStudent(input: NotificationInput): Promise<void> {
  try {
    await prisma.studentNotification.create({
      data: {
        courseId: input.courseId,
        studentId: input.studentId,
        type: input.type,
        title: input.title,
        body: clip(input.body, 120),
        tab: input.tab ?? null,
        refId: input.refId ?? null,
        createdAt: getNowStrTaipei(),
      },
    });
    await trimOld(input.studentId);
    pushStudentNotification(input.studentId, input.title);
  } catch (err) {
    console.warn("[notifications] 寫入通知失敗：", err);
  }
}

export async function notifyStudents(studentIds: number[], base: Omit<NotificationInput, "studentId">): Promise<void> {
  for (const studentId of new Set(studentIds)) {
    await notifyStudent({ ...base, studentId });
  }
}

/** 小組作業的通知對象：該組目前的所有組員。 */
export async function groupMemberIds(groupId: number): Promise<number[]> {
  const members = await prisma.groupMember.findMany({ where: { groupId }, select: { studentId: true } });
  return members.map((m) => m.studentId);
}

const CATEGORY_LABEL: Record<string, string> = { material: "新教材", assignment: "新作業", quiz: "新測驗" };

/**
 * 老師新增（或取消隱藏）一筆內容時通知全班。
 * 排除：已隱藏、或設定了「定時開放」且時間未到（時間到時不會再補通知）。
 */
export async function notifyNewContent(args: {
  courseId: number;
  unitId: number;
  unitTitle: string;
  title: string;
  category: string;
  isHidden: boolean;
  publishAt: string | null;
}): Promise<void> {
  try {
    if (args.isHidden) return;
    if (args.publishAt && args.publishAt > getNowStrTaipei()) return;

    const students = await prisma.student.findMany({
      where: { courseId: args.courseId, isActive: 1 },
      select: { id: true },
    });
    const cutoff = nowMinusMinutes(NEW_CONTENT_MERGE_MINUTES);
    const label = CATEGORY_LABEL[args.category] ?? "新內容";
    const now = getNowStrTaipei();

    for (const { id: studentId } of students) {
      const recent = await prisma.studentNotification.findFirst({
        where: { studentId, type: "new_content", refId: args.unitId, isRead: 0, createdAt: { gte: cutoff } },
        orderBy: { id: "desc" },
      });
      if (recent) {
        const count = recent.repeatCount + 1;
        const title = `「${args.unitTitle}」新增了 ${count} 個內容`;
        await prisma.studentNotification.update({
          where: { id: recent.id },
          data: { repeatCount: count, title, body: clip(`最新：${args.title}`, 120), createdAt: now },
        });
        pushStudentNotification(studentId, title);
      } else {
        await notifyStudent({
          courseId: args.courseId,
          studentId,
          type: "new_content",
          title: `${label}：${args.title}`,
          body: `單元「${args.unitTitle}」`,
          tab: "materials",
          refId: args.unitId,
        });
      }
    }
  } catch (err) {
    console.warn("[notifications] 新內容通知失敗：", err);
  }
}

/** 通知全班「有新的檔案蒐集／已開放上傳」。 */
export async function notifyCourseFileCollection(courseId: number, title: string, opened: boolean): Promise<void> {
  try {
    const students = await prisma.student.findMany({ where: { courseId, isActive: 1 }, select: { id: true } });
    await notifyStudents(
      students.map((s) => s.id),
      {
        courseId,
        type: "file_collection",
        title: opened ? `開放上傳：${title}` : `新的檔案蒐集：${title}`,
        body: "請到「檔案蒐集」交出檔案",
        tab: "fileCollect",
      }
    );
  } catch (err) {
    console.warn("[notifications] 檔案蒐集通知失敗：", err);
  }
}

// ---------------------------------------------------------------- 教師端通知

const TEACHER_MAX_ROWS = 200;

export type TeacherNotificationType = "submission" | "resubmit_request" | "question";

/**
 * 學生有動作需要老師處理時通知教師（繳交作業、申請重新繳交、發問）。
 * 同一份作業、同一種事件在 10 分鐘內且尚未讀取的，合併成一則並累加次數，避免全班一起交時洗版。
 * 與學生通知一樣屬於附帶功能：失敗只記警告，不影響學生的主要操作。
 */
export async function notifyTeacher(args: {
  courseId: number;
  type: TeacherNotificationType;
  unitId: number;
  subUnitId: number;
  subUnitTitle: string;
  who: string; // 學生姓名或小組名稱
  body?: string | null;
}): Promise<void> {
  try {
    const now = getNowStrTaipei();
    const cutoff = nowMinusMinutes(NEW_CONTENT_MERGE_MINUTES);
    const single: Record<TeacherNotificationType, string> = {
      submission: `${args.who} 繳交了「${args.subUnitTitle}」`,
      resubmit_request: `${args.who} 申請重新繳交「${args.subUnitTitle}」`,
      question: `${args.who} 在「${args.subUnitTitle}」提問`,
    };
    const merged = (n: number): string =>
      ({
        submission: `「${args.subUnitTitle}」有 ${n} 份新的繳交`,
        resubmit_request: `「${args.subUnitTitle}」有 ${n} 位同學申請重新繳交`,
        question: `「${args.subUnitTitle}」有 ${n} 則新的提問`,
      })[args.type];

    const recent = await prisma.teacherNotification.findFirst({
      where: { courseId: args.courseId, type: args.type, subUnitId: args.subUnitId, isRead: 0, createdAt: { gte: cutoff } },
      orderBy: { id: "desc" },
    });
    let title: string;
    if (recent) {
      const count = recent.repeatCount + 1;
      title = merged(count);
      await prisma.teacherNotification.update({
        where: { id: recent.id },
        data: { repeatCount: count, title, body: clip(args.body, 120), createdAt: now },
      });
    } else {
      title = single[args.type];
      await prisma.teacherNotification.create({
        data: {
          courseId: args.courseId,
          type: args.type,
          title,
          body: clip(args.body, 120),
          unitId: args.unitId,
          subUnitId: args.subUnitId,
          createdAt: now,
        },
      });
      await prisma.$executeRaw`
        DELETE FROM teacher_notifications
        WHERE id NOT IN (SELECT id FROM teacher_notifications ORDER BY id DESC LIMIT ${TEACHER_MAX_ROWS})`;
    }
    pushTeacherNotification(title);
  } catch (err) {
    console.warn("[notifications] 教師通知寫入失敗：", err);
  }
}
