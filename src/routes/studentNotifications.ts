// 學生端通知 API（/api/student/notifications）：只能看與標記「自己」的通知。
import { Router } from "express";
import { prisma } from "../db";
import { autoCatch } from "../asyncRoute";
import { requireStudentAuth } from "../middleware/studentAuth";

export const studentNotificationsRouter = autoCatch(Router());
studentNotificationsRouter.use(requireStudentAuth);

const LIST_LIMIT = 50;

// 清單（最新在前）與未讀數
studentNotificationsRouter.get("/", async (req, res) => {
  const { studentId } = req.studentAuth!;
  const [items, unread] = await Promise.all([
    prisma.studentNotification.findMany({
      where: { studentId },
      orderBy: { id: "desc" },
      take: LIST_LIMIT,
    }),
    prisma.studentNotification.count({ where: { studentId, isRead: 0 } }),
  ]);
  res.json({
    unread_count: unread,
    items: items.map((n) => ({
      id: n.id,
      type: n.type,
      title: n.title,
      body: n.body,
      tab: n.tab,
      is_read: n.isRead === 1,
      created_at: n.createdAt,
    })),
  });
});

// 標記已讀：{ ids: number[] } 或 { all: true }
studentNotificationsRouter.post("/read", async (req, res) => {
  const { studentId } = req.studentAuth!;
  const all = req.body?.all === true;
  const ids: number[] = Array.isArray(req.body?.ids)
    ? req.body.ids.map((x: unknown) => Number(x)).filter((n: number) => Number.isInteger(n))
    : [];
  if (!all && ids.length === 0) {
    res.status(400).json({ detail: "請指定要標記的通知" });
    return;
  }
  await prisma.studentNotification.updateMany({
    where: { studentId, isRead: 0, ...(all ? {} : { id: { in: ids } }) },
    data: { isRead: 1 },
  });
  const unread = await prisma.studentNotification.count({ where: { studentId, isRead: 0 } });
  res.json({ unread_count: unread });
});
