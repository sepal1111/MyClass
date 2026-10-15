// 教師端通知 API（/api/teacher-notifications，需教師登入）。
// 教師是單一共用身分，通知不分班級一起列出（附班級名稱），已讀狀態全體共用。
import { Router } from "express";
import { prisma } from "../db";
import { autoCatch } from "../asyncRoute";

export const teacherNotificationsRouter = autoCatch(Router());

const LIST_LIMIT = 50;

teacherNotificationsRouter.get("/", async (_req, res) => {
  const [items, unread] = await Promise.all([
    prisma.teacherNotification.findMany({ orderBy: { id: "desc" }, take: LIST_LIMIT }),
    prisma.teacherNotification.count({ where: { isRead: 0 } }),
  ]);
  const courses = await prisma.course.findMany({
    where: { id: { in: [...new Set(items.map((n) => n.courseId))] } },
    select: { id: true, name: true },
  });
  const courseName = new Map(courses.map((c) => [c.id, c.name]));
  res.json({
    unread_count: unread,
    items: items.map((n) => ({
      id: n.id,
      type: n.type,
      title: n.title,
      body: n.body,
      course_id: n.courseId,
      course_name: courseName.get(n.courseId) ?? "",
      unit_id: n.unitId,
      sub_unit_id: n.subUnitId,
      is_read: n.isRead === 1,
      created_at: n.createdAt,
    })),
  });
});

// 標記已讀：{ ids: number[] } 或 { all: true }
teacherNotificationsRouter.post("/read", async (req, res) => {
  const all = req.body?.all === true;
  const ids: number[] = Array.isArray(req.body?.ids)
    ? req.body.ids.map((x: unknown) => Number(x)).filter((n: number) => Number.isInteger(n))
    : [];
  if (!all && ids.length === 0) {
    res.status(400).json({ detail: "請指定要標記的通知" });
    return;
  }
  await prisma.teacherNotification.updateMany({
    where: { isRead: 0, ...(all ? {} : { id: { in: ids } }) },
    data: { isRead: 1 },
  });
  res.json({ unread_count: await prisma.teacherNotification.count({ where: { isRead: 0 } }) });
});
