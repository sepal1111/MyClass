// Port of app/routers/groups.py
import fs from "fs";
import path from "path";
import { Router } from "express";
import multer from "multer";
import { prisma } from "../db";
import { getUploadsDir } from "../paths";
import { broadcastToCourse } from "../realtime";
import { autoCatch } from "../asyncRoute";

export const groupsRouter = autoCatch(Router());
const upload = multer({ storage: multer.memoryStorage() });

const ANIMAL_ICONS = [
  "/static/pic/animals/penguin.png",
  "/static/pic/animals/rabbit.png",
  "/static/pic/animals/hedgehog.png",
  "/static/pic/animals/polar_bear.png",
  "/static/pic/animals/formosan_black_bear.png",
  "/static/pic/animals/elephant.png",
  "/static/pic/animals/guinea_pig.png",
  "/static/pic/animals/dog.png",
  "/static/pic/animals/squirrel.png",
  "/static/pic/animals/sika_deer.png",
  "/static/pic/animals/hippo.png",
  "/static/pic/animals/raccoon.png",
  "/static/pic/animals/sea_otter.png",
  "/static/pic/animals/dolphin.png",
  "/static/pic/animals/turtle.png",
  "/static/pic/animals/koala.png",
  "/static/pic/animals/panda.png",
  "/static/pic/animals/fox.png",
  "/static/pic/animals/lion.png",
  "/static/pic/animals/cheetah.png",
  "/static/pic/animals/tiger.png",
  "/static/pic/animals/snake.png",
  "/static/pic/animals/owl.png",
  "/static/pic/animals/giraffe.png",
  "/static/pic/animals/sparrow.png",
];

function shuffled<T>(arr: T[]): T[] {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

async function getOrCreateActivePlan(courseId: number, requestedPlanId?: number | null) {
  if (typeof requestedPlanId === "number") {
    const plan = await prisma.groupPlan.findFirst({ where: { id: requestedPlanId, courseId } });
    if (plan) return plan;
  }

  let plan = await prisma.groupPlan.findFirst({ where: { courseId, isActive: 1 } });
  if (plan) return plan;

  plan = await prisma.groupPlan.findFirst({ where: { courseId } });
  if (plan) {
    return prisma.groupPlan.update({ where: { id: plan.id }, data: { isActive: 1 } });
  }

  return prisma.groupPlan.create({ data: { courseId, name: "常態分組", isActive: 1 } });
}

async function syncActivePlanToStudents(courseId: number, planId: number) {
  const members = await prisma.groupMember.findMany({ where: { planId }, select: { studentId: true, groupId: true } });
  const byStudent = new Map(members.map((m) => [m.studentId, m.groupId]));

  await prisma.student.updateMany({ where: { courseId }, data: { groupId: null } });
  for (const [studentId, groupId] of byStudent) {
    await prisma.student.updateMany({ where: { id: studentId, courseId }, data: { groupId } });
  }
}

/** Prisma 回傳的欄位是 camelCase（如 groupName、isActive），但前端一律用 snake_case 讀取
 *  （沿用原 Python/FastAPI 版本的慣例），這裡手動轉換，否則前端會讀到 undefined
 *  （例如小組篩選按鈕顯示「undefined」、分組管理頁的⭐生效方案標記失效）。 */
function serializeGroup<T extends { id: number; courseId: number; groupName: string; iconUrl: string | null; orderIndex: number; planId: number | null }>(
  g: T,
  students: unknown
) {
  return {
    id: g.id,
    course_id: g.courseId,
    group_name: g.groupName,
    icon_url: g.iconUrl,
    order_index: g.orderIndex,
    plan_id: g.planId,
    students,
  };
}

function serializePlan<T extends { id: number; courseId: number; name: string; isActive: number; createdAt: string | null }>(p: T) {
  return {
    id: p.id,
    course_id: p.courseId,
    name: p.name,
    is_active: !!p.isActive,
    created_at: p.createdAt,
  };
}

async function buildCourseGroupsPayload(courseId: number, planId?: number | null) {
  const plans = await prisma.groupPlan.findMany({ where: { courseId }, orderBy: { id: "asc" } });
  const currentPlan = await getOrCreateActivePlan(courseId, planId ?? undefined);
  const targetPlanId = currentPlan.id;
  const finalPlans = plans.length ? plans : await prisma.groupPlan.findMany({ where: { courseId }, orderBy: { id: "asc" } });

  const groupRows = await prisma.group.findMany({
    where: { courseId, planId: targetPlanId },
    orderBy: [{ orderIndex: "asc" }, { id: "asc" }],
  });

  const groups = await Promise.all(
    groupRows.map(async (g) => {
      const members = await prisma.groupMember.findMany({
        where: { planId: targetPlanId, groupId: g.id },
        include: { student: true },
      });
      const students = members
        .filter((m) => m.student.courseId === courseId && m.student.isActive === 1)
        .sort((a, b) => a.student.studentNumber - b.student.studentNumber)
        .map((m) => ({
          id: m.student.id,
          student_number: m.student.studentNumber,
          student_code: m.student.studentCode,
          name: m.student.name,
          english_name: m.student.englishName,
          gender: m.student.gender,
          group_id: g.id,
          is_leader: m.isLeader === 1,
        }));
      return serializeGroup(g, students);
    })
  );

  const assignedIds = new Set(
    (await prisma.groupMember.findMany({ where: { planId: targetPlanId } })).map((m) => m.studentId)
  );
  const allActive = await prisma.student.findMany({
    where: { courseId, isActive: 1 },
    orderBy: { studentNumber: "asc" },
  });
  const unassigned = allActive
    .filter((s) => !assignedIds.has(s.id))
    .map((s) => ({
      id: s.id,
      student_number: s.studentNumber,
      student_code: s.studentCode,
      name: s.name,
      english_name: s.englishName,
      gender: s.gender,
      group_id: null,
    }));

  return { plans: finalPlans.map(serializePlan), current_plan: serializePlan(currentPlan), groups, unassigned };
}

groupsRouter.get("/:courseId", async (req, res) => {
  const courseId = Number(req.params.courseId);
  const planId = req.query.plan_id ? Number(req.query.plan_id) : undefined;
  res.json(await buildCourseGroupsPayload(courseId, planId));
});

// --- Group Plans Management ---

groupsRouter.post("/:courseId/plans", async (req, res) => {
  const courseId = Number(req.params.courseId);
  const planName = (req.body?.name ?? "").trim() || "新分組模式";
  const copyFromPlanId: number | undefined = req.body?.copy_from_plan_id ?? undefined;

  const newPlan = await prisma.groupPlan.create({ data: { courseId, name: planName, isActive: 0 } });

  if (copyFromPlanId) {
    const sourceGroups = await prisma.group.findMany({
      where: { courseId, planId: copyFromPlanId },
      orderBy: [{ orderIndex: "asc" }, { id: "asc" }],
    });
    const idMap = new Map<number, number>();
    for (const sg of sourceGroups) {
      const created = await prisma.group.create({
        data: { courseId, planId: newPlan.id, groupName: sg.groupName, iconUrl: sg.iconUrl, orderIndex: sg.orderIndex },
      });
      idMap.set(sg.id, created.id);
    }
    const sourceMembers = await prisma.groupMember.findMany({ where: { planId: copyFromPlanId } });
    for (const sm of sourceMembers) {
      const newGid = idMap.get(sm.groupId);
      if (newGid) {
        await prisma.groupMember
          .create({ data: { planId: newPlan.id, groupId: newGid, studentId: sm.studentId } })
          .catch(() => undefined);
      }
    }
  }

  broadcastToCourse(courseId, "groups_updated");
  res.json({ id: newPlan.id, name: planName, message: `分組模式「${planName}」建立成功！` });
});

groupsRouter.put("/:courseId/plans/:planId", async (req, res) => {
  const courseId = Number(req.params.courseId);
  const planId = Number(req.params.planId);
  const plan = await prisma.groupPlan.findFirst({ where: { id: planId, courseId } });
  if (!plan) {
    res.status(404).json({ detail: "分組模式不存在" });
    return;
  }

  if (typeof req.body?.name === "string") {
    await prisma.groupPlan.update({ where: { id: planId }, data: { name: req.body.name.trim() } });
  }
  if (req.body?.is_active === true) {
    await prisma.groupPlan.updateMany({ where: { courseId }, data: { isActive: 0 } });
    await prisma.groupPlan.update({ where: { id: planId }, data: { isActive: 1 } });
    await syncActivePlanToStudents(courseId, planId);
  }

  broadcastToCourse(courseId, "groups_updated");
  res.json({ message: "分組模式已更新！" });
});

groupsRouter.delete("/:courseId/plans/:planId", async (req, res) => {
  const courseId = Number(req.params.courseId);
  const planId = Number(req.params.planId);
  const plan = await prisma.groupPlan.findFirst({ where: { id: planId, courseId } });
  if (!plan) {
    res.status(404).json({ detail: "分組模式不存在" });
    return;
  }

  const totalPlans = await prisma.groupPlan.count({ where: { courseId } });
  if (totalPlans <= 1) {
    res.status(400).json({ detail: "至少需保留一個分組模式，無法刪除最後一個模式！" });
    return;
  }

  const wasActive = plan.isActive === 1;
  await prisma.groupMember.deleteMany({ where: { planId } });
  await prisma.group.deleteMany({ where: { courseId, planId } });
  await prisma.groupPlan.delete({ where: { id: planId } });

  if (wasActive) {
    const first = await prisma.groupPlan.findFirst({ where: { courseId }, orderBy: { id: "asc" } });
    if (first) {
      await prisma.groupPlan.update({ where: { id: first.id }, data: { isActive: 1 } });
      await syncActivePlanToStudents(courseId, first.id);
    }
  }

  broadcastToCourse(courseId, "groups_updated");
  res.json({ message: `分組模式「${plan.name}」已刪除！` });
});

// --- Auto Grouping & Dragging ---

groupsRouter.post("/:courseId/auto", async (req, res) => {
  const courseId = Number(req.params.courseId);
  const { plan_id, num_groups, students_per_group, mode = "random" } = req.body ?? {};

  const currentPlan = await getOrCreateActivePlan(courseId, plan_id ?? undefined);
  const targetPlanId = currentPlan.id;

  const students = await prisma.student.findMany({ where: { courseId, isActive: 1 } });
  if (students.length === 0) {
    res.status(400).json({ detail: "課程內尚無學生可供分組" });
    return;
  }

  let numGroups: number;
  if (students_per_group && students_per_group >= 1) {
    numGroups = Math.ceil(students.length / students_per_group);
  } else if (num_groups && num_groups >= 1) {
    numGroups = num_groups;
  } else {
    numGroups = 6;
  }
  if (numGroups < 1) {
    res.status(400).json({ detail: "計算組數必須大於等於 1" });
    return;
  }

  await prisma.groupMember.deleteMany({ where: { planId: targetPlanId } });
  await prisma.group.deleteMany({ where: { courseId, planId: targetPlanId } });

  const icons = shuffled(ANIMAL_ICONS);
  const groupIds: number[] = [];
  for (let i = 1; i <= numGroups; i++) {
    const g = await prisma.group.create({
      data: {
        courseId,
        planId: targetPlanId,
        groupName: `第 ${i} 組`,
        iconUrl: icons[(i - 1) % icons.length],
        orderIndex: i,
      },
    });
    groupIds.push(g.id);
  }

  const assign = async (studentId: number, groupId: number) =>
    prisma.groupMember.create({ data: { planId: targetPlanId, groupId, studentId } });

  if (mode === "gender_balanced") {
    const males = shuffled(students.filter((s) => s.gender === "M"));
    const females = shuffled(students.filter((s) => s.gender === "F"));
    const others = shuffled(students.filter((s) => s.gender !== "M" && s.gender !== "F"));

    for (let idx = 0; idx < males.length; idx++) await assign(males[idx].id, groupIds[idx % numGroups]);
    for (let idx = 0; idx < females.length; idx++) await assign(females[idx].id, groupIds[(idx + 1) % numGroups]);
    for (let idx = 0; idx < others.length; idx++) await assign(others[idx].id, groupIds[idx % numGroups]);
  } else {
    const shuffledStudents = shuffled(students);
    for (let idx = 0; idx < shuffledStudents.length; idx++) {
      await assign(shuffledStudents[idx].id, groupIds[idx % numGroups]);
    }
  }

  if (currentPlan.isActive) {
    await syncActivePlanToStudents(courseId, targetPlanId);
  }

  broadcastToCourse(courseId, "groups_updated");
  res.json(await buildCourseGroupsPayload(courseId, targetPlanId));
});

groupsRouter.put("/:courseId/drag", async (req, res) => {
  const courseId = Number(req.params.courseId);
  const { plan_id, student_id, group_id } = req.body ?? {};
  const currentPlan = await getOrCreateActivePlan(courseId, plan_id ?? undefined);
  const targetPlanId = currentPlan.id;

  if (group_id === null || group_id === undefined || group_id === 0) {
    await prisma.groupMember.deleteMany({ where: { planId: targetPlanId, studentId: student_id } });
  } else {
    await prisma.groupMember.upsert({
      where: { planId_studentId: { planId: targetPlanId, studentId: student_id } },
      update: { groupId: group_id },
      create: { planId: targetPlanId, groupId: group_id, studentId: student_id },
    });
  }

  if (currentPlan.isActive) {
    await syncActivePlanToStudents(courseId, targetPlanId);
  }

  broadcastToCourse(courseId, "groups_updated");
  res.json({ message: "Group updated successfully" });
});

groupsRouter.post("/:courseId/set-leader", async (req, res) => {
  const courseId = Number(req.params.courseId);
  const { plan_id, group_id, student_id } = req.body ?? {};
  const currentPlan = await getOrCreateActivePlan(courseId, plan_id ?? undefined);
  const targetPlanId = currentPlan.id;

  const targetGroupId = Number(group_id);
  // 先清除該方案中該組目前的組長
  await prisma.groupMember.updateMany({
    where: { planId: targetPlanId, groupId: targetGroupId },
    data: { isLeader: 0 },
  });

  // 若指定了 student_id，則將其設為組長 (isLeader = 1)
  if (student_id) {
    const targetStudentId = Number(student_id);
    await prisma.groupMember.updateMany({
      where: { planId: targetPlanId, groupId: targetGroupId, studentId: targetStudentId },
      data: { isLeader: 1 },
    });
  }

  broadcastToCourse(courseId, "groups_updated");
  res.json({ message: "小組長設定成功！" });
});

groupsRouter.post("/:courseId", async (req, res) => {
  const courseId = Number(req.params.courseId);
  const { plan_id, group_name, icon_url, order_index } = req.body ?? {};
  const currentPlan = await getOrCreateActivePlan(courseId, plan_id ?? undefined);
  const targetPlanId = currentPlan.id;

  const maxOrderRow = await prisma.group.aggregate({
    where: { courseId, planId: targetPlanId },
    _max: { orderIndex: true },
  });
  const order = order_index || (maxOrderRow._max.orderIndex ?? 0) + 1;

  let iconUrl = icon_url;
  if (!iconUrl) {
    const used = new Set(
      (await prisma.group.findMany({ where: { courseId, planId: targetPlanId }, select: { iconUrl: true } }))
        .map((r) => r.iconUrl)
        .filter(Boolean)
    );
    const unused = ANIMAL_ICONS.filter((url) => !used.has(url));
    iconUrl = unused.length ? unused[Math.floor(Math.random() * unused.length)] : ANIMAL_ICONS[Math.floor(Math.random() * ANIMAL_ICONS.length)];
  }

  const group = await prisma.group.create({
    data: { courseId, planId: targetPlanId, groupName: String(group_name).trim(), iconUrl, orderIndex: order },
  });
  broadcastToCourse(courseId, "groups_updated");
  res.json({ id: group.id, message: `小組「${group_name}」建立成功！` });
});

groupsRouter.put("/:courseId/:groupId", async (req, res) => {
  const courseId = Number(req.params.courseId);
  const groupId = Number(req.params.groupId);
  const group = await prisma.group.findFirst({ where: { id: groupId, courseId } });
  if (!group) {
    res.status(404).json({ detail: "Group not found" });
    return;
  }

  const data: Record<string, unknown> = {};
  if (req.body?.group_name !== undefined && req.body.group_name !== null) data.groupName = String(req.body.group_name).trim();
  if (req.body?.icon_url !== undefined && req.body.icon_url !== null) data.iconUrl = req.body.icon_url;
  if (req.body?.order_index !== undefined && req.body.order_index !== null) data.orderIndex = req.body.order_index;

  if (Object.keys(data).length) {
    await prisma.group.update({ where: { id: groupId }, data });
    broadcastToCourse(courseId, "groups_updated");
  }
  res.json({ message: "小組資料更新成功！" });
});

groupsRouter.post("/:courseId/:groupId/upload_icon", upload.single("file"), async (req, res) => {
  const courseId = Number(req.params.courseId);
  const groupId = Number(req.params.groupId);
  const group = await prisma.group.findFirst({ where: { id: groupId, courseId } });
  if (!group) {
    res.status(404).json({ detail: "Group not found" });
    return;
  }
  const file = req.file;
  if (!file) {
    res.status(400).json({ detail: "請選擇要上傳的圖檔" });
    return;
  }
  const ext = path.extname(file.originalname).toLowerCase();
  if (![".jpg", ".jpeg", ".png", ".gif", ".webp", ".svg"].includes(ext)) {
    res.status(400).json({ detail: "僅支援 JPG、PNG、GIF、WEBP 或 SVG 格式圖檔" });
    return;
  }

  const groupsDir = path.join(getUploadsDir(), "groups");
  fs.mkdirSync(groupsDir, { recursive: true });
  const filename = `group_${courseId}_${groupId}_${Date.now()}${ext}`;
  fs.writeFileSync(path.join(groupsDir, filename), file.buffer);

  const iconUrl = `/uploads/groups/${filename}`;
  await prisma.group.update({ where: { id: groupId }, data: { iconUrl } });
  broadcastToCourse(courseId, "groups_updated");
  res.json({ message: "小組圖示上傳成功！", icon_url: iconUrl });
});

groupsRouter.delete("/:courseId/:groupId/icon", async (req, res) => {
  const courseId = Number(req.params.courseId);
  const groupId = Number(req.params.groupId);
  await prisma.group.updateMany({ where: { id: groupId, courseId }, data: { iconUrl: null } });
  broadcastToCourse(courseId, "groups_updated");
  res.json({ message: "小組圖示已恢復預設！" });
});

groupsRouter.delete("/:courseId/:groupId", async (req, res) => {
  const courseId = Number(req.params.courseId);
  const groupId = Number(req.params.groupId);
  const group = await prisma.group.findFirst({ where: { id: groupId, courseId } });
  const planId = group?.planId ?? null;

  await prisma.groupMember.deleteMany({ where: { groupId } });
  await prisma.group.deleteMany({ where: { id: groupId, courseId } });

  if (planId) {
    const plan = await prisma.groupPlan.findUnique({ where: { id: planId } });
    if (plan?.isActive) {
      await syncActivePlanToStudents(courseId, planId);
    }
  }

  broadcastToCourse(courseId, "groups_updated");
  res.json({ message: "小組已刪除，組內成員已移至未分組！" });
});

groupsRouter.get("/:courseId/discussions", async (req, res) => {
  const courseId = Number(req.params.courseId);
  const discussions = await prisma.groupDiscussionLog.findMany({
    where: { courseId },
    include: {
      group: { select: { id: true, groupName: true, iconUrl: true } },
      leader: { select: { id: true, studentNumber: true, name: true } },
    },
    orderBy: [{ date: "desc" }, { id: "desc" }],
  });
  res.json({
    discussions: discussions.map((d) => ({
      id: d.id,
      group_id: d.groupId,
      group_name: d.group.groupName,
      icon_url: d.group.iconUrl,
      leader_name: d.leader?.name ?? "小組長",
      leader_number: d.leader?.studentNumber ?? null,
      title: d.title,
      content: d.content,
      date: d.date,
      created_at: d.createdAt,
    })),
  });
});
