import fs from "fs";
import path from "path";
import { Router } from "express";
import multer from "multer";
import { prisma } from "../db";
import { getUploadsDir } from "../paths";
import { broadcastToCourse } from "../realtime";
import { autoCatch } from "../asyncRoute";
import { getNowStrTaipei, getTodayStrTaipei } from "../timezone";

export const rewardsRouter = autoCatch(Router());
const upload = multer({ storage: multer.memoryStorage() });

// 1. 取得指定班級的獎勵品項列表 (教師端管理用)
rewardsRouter.get("/:courseId", async (req, res) => {
  const courseId = Number(req.params.courseId);
  const items = await prisma.rewardItem.findMany({
    where: { courseId },
    include: {
      _count: {
        select: {
          redemptions: true,
        },
      },
    },
    orderBy: [{ orderIndex: "asc" }, { id: "desc" }],
  });

  res.json({ items });
});

// 2. 新增獎勵品項 (支援圖檔上傳)
rewardsRouter.post("/:courseId", upload.single("image"), async (req, res) => {
  const courseId = Number(req.params.courseId);
  const { name, description, rewardType, pointsCost, stock, cardSeries, isActive, orderIndex } = req.body;

  if (!name || !name.trim()) {
    res.status(400).json({ detail: "請輸入獎勵品項名稱" });
    return;
  }

  const cost = parseInt(pointsCost, 10);
  if (isNaN(cost) || cost <= 0) {
    res.status(400).json({ detail: "所需點數必須為大於 0 的整數" });
    return;
  }

  const type = String(rewardType || "badge").toLowerCase();
  if (!["badge", "collectible_card", "physical"].includes(type)) {
    res.status(400).json({ detail: "不支援的獎勵類型" });
    return;
  }

  // 強制要求上傳品項圖檔或照片，不可使用系統內建圖
  if (!req.file) {
    res.status(400).json({ detail: "新增獎勵品項必須上傳自訂品項圖檔或照片，不可使用預設圖！" });
    return;
  }

  const ext = path.extname(req.file.originalname).toLowerCase();
  if (![".jpg", ".jpeg", ".png", ".gif", ".webp", ".svg"].includes(ext)) {
    res.status(400).json({ detail: "僅支援 JPG、PNG、GIF、WEBP 或 SVG 格式圖檔" });
    return;
  }
  const rewardsDir = path.join(getUploadsDir(), "rewards");
  fs.mkdirSync(rewardsDir, { recursive: true });
  const filename = `reward_${courseId}_${Date.now()}_${Math.floor(Math.random() * 1000)}${ext}`;
  fs.writeFileSync(path.join(rewardsDir, filename), req.file.buffer);
  const imageUrl = `/uploads/rewards/${filename}`;

  const parsedStock = stock !== undefined && stock !== "" ? parseInt(stock, 10) : -1;
  const now = getNowStrTaipei();

  const item = await prisma.rewardItem.create({
    data: {
      courseId,
      name: name.trim(),
      description: description ? description.trim() : null,
      rewardType: type,
      pointsCost: cost,
      stock: isNaN(parsedStock) ? -1 : parsedStock,
      imageUrl,
      cardSeries: cardSeries && cardSeries.trim() ? cardSeries.trim() : null,
      isActive: isActive === "0" || isActive === 0 || isActive === false ? 0 : 1,
      orderIndex: !isNaN(parseInt(orderIndex, 10)) ? parseInt(orderIndex, 10) : 0,
      createdAt: now,
      updatedAt: now,
    },
  });

  broadcastToCourse(courseId, "rewards_updated");
  res.status(201).json(item);
});

// 3. 修改獎勵品項
rewardsRouter.put("/:courseId/:id", upload.single("image"), async (req, res) => {
  const courseId = Number(req.params.courseId);
  const id = Number(req.params.id);

  const existing = await prisma.rewardItem.findFirst({ where: { id, courseId } });
  if (!existing) {
    res.status(404).json({ detail: "找不到該獎勵品項" });
    return;
  }

  const { name, description, rewardType, pointsCost, stock, cardSeries, isActive, orderIndex } = req.body;

  let imageUrl = existing.imageUrl;
  if (req.file) {
    const ext = path.extname(req.file.originalname).toLowerCase();
    if (![".jpg", ".jpeg", ".png", ".gif", ".webp", ".svg"].includes(ext)) {
      res.status(400).json({ detail: "僅支援 JPG、PNG、GIF、WEBP 或 SVG 格式圖檔" });
      return;
    }
    const rewardsDir = path.join(getUploadsDir(), "rewards");
    fs.mkdirSync(rewardsDir, { recursive: true });
    const filename = `reward_${courseId}_${Date.now()}_${Math.floor(Math.random() * 1000)}${ext}`;
    fs.writeFileSync(path.join(rewardsDir, filename), req.file.buffer);
    imageUrl = `/uploads/rewards/${filename}`;
  } else if (req.body.imageUrl && req.body.imageUrl.trim()) {
    imageUrl = req.body.imageUrl.trim();
  }

  const cost = pointsCost !== undefined ? parseInt(pointsCost, 10) : existing.pointsCost;
  const parsedStock = stock !== undefined && stock !== "" ? parseInt(stock, 10) : existing.stock;
  const now = getNowStrTaipei();

  const updated = await prisma.rewardItem.update({
    where: { id },
    data: {
      name: name !== undefined ? name.trim() : existing.name,
      description: description !== undefined ? (description ? description.trim() : null) : existing.description,
      rewardType: rewardType !== undefined ? String(rewardType).toLowerCase() : existing.rewardType,
      pointsCost: !isNaN(cost) && cost > 0 ? cost : existing.pointsCost,
      stock: !isNaN(parsedStock) ? parsedStock : existing.stock,
      imageUrl,
      cardSeries: cardSeries !== undefined ? (cardSeries ? cardSeries.trim() : null) : existing.cardSeries,
      isActive: isActive !== undefined ? (isActive === "0" || isActive === 0 || isActive === false ? 0 : 1) : existing.isActive,
      orderIndex: orderIndex !== undefined && !isNaN(parseInt(orderIndex, 10)) ? parseInt(orderIndex, 10) : existing.orderIndex,
      updatedAt: now,
    },
  });

  broadcastToCourse(courseId, "rewards_updated");
  res.json(updated);
});

// 4. 刪除獎勵品項 (若有歷史兌換則軟刪除/下架)
rewardsRouter.delete("/:courseId/:id", async (req, res) => {
  const courseId = Number(req.params.courseId);
  const id = Number(req.params.id);

  const existing = await prisma.rewardItem.findFirst({
    where: { id, courseId },
    include: { _count: { select: { redemptions: true } } },
  });

  if (!existing) {
    res.status(404).json({ detail: "找不到該獎勵品項" });
    return;
  }

  if (existing._count.redemptions > 0) {
    // 軟刪除：下架避免破壞歷史兌換外鍵
    await prisma.rewardItem.update({
      where: { id },
      data: { isActive: 0, updatedAt: getNowStrTaipei() },
    });
    broadcastToCourse(courseId, "rewards_updated");
    res.json({ message: "該品項已有學生兌換紀錄，已自動轉為下架隱藏狀態" });
  } else {
    await prisma.rewardItem.delete({ where: { id } });
    broadcastToCourse(courseId, "rewards_updated");
    res.json({ message: "獎勵品項已完全刪除" });
  }
});

// 5. 取得班級實體兌換申請與發放清單 (教師審核台)
rewardsRouter.get("/:courseId/redemptions", async (req, res) => {
  const courseId = Number(req.params.courseId);
  const status = (req.query.status as string) || "all";

  const where: Record<string, unknown> = { courseId };
  if (status !== "all") {
    where.status = status;
  }

  const redemptions = await prisma.rewardRedemption.findMany({
    where,
    include: {
      student: {
        select: {
          id: true,
          studentNumber: true,
          name: true,
          englishName: true,
        },
      },
      reward: {
        select: {
          id: true,
          name: true,
          rewardType: true,
          pointsCost: true,
          imageUrl: true,
          stock: true,
        },
      },
    },
    orderBy: [{ id: "desc" }],
  });

  res.json({ redemptions });
});

// 6. 教師審核核准實體獎品申請 (暫時預扣點數並保留庫存)
rewardsRouter.post("/:courseId/redemptions/:id/approve", async (req, res) => {
  const courseId = Number(req.params.courseId);
  const id = Number(req.params.id);

  const redemption = await prisma.rewardRedemption.findFirst({
    where: { id, courseId },
    include: { reward: true, student: true },
  });

  if (!redemption) {
    res.status(404).json({ detail: "找不到此兌換紀錄" });
    return;
  }

  if (redemption.status !== "requested") {
    res.status(400).json({ detail: `目前狀態為【${redemption.status}】，無法執行核准` });
    return;
  }

  const now = getNowStrTaipei();

  await prisma.$transaction(async (tx) => {
    // 檢查庫存
    if (redemption.reward.stock > 0) {
      await tx.rewardItem.update({
        where: { id: redemption.rewardId },
        data: { stock: { decrement: 1 }, updatedAt: now },
      });
    } else if (redemption.reward.stock === 0) {
      throw new Error("此獎品目前已無庫存，無法核准發放！");
    }

    await tx.rewardRedemption.update({
      where: { id },
      data: {
        status: "approved_held", // 狀態轉為已核准待發放 (點數列入預扣)
        approvedAt: now,
        teacherNote: req.body?.teacherNote || null,
      },
    });
  });

  broadcastToCourse(courseId, "score_updated");
  broadcastToCourse(courseId, "rewards_updated");
  res.json({ message: "申請已核准！點數已暫時預扣，請等候學生至講台領取。" });
});

// 7. 教師確認交件發放 (實體獎品真實扣點結案)
rewardsRouter.post("/:courseId/redemptions/:id/fulfill", async (req, res) => {
  const courseId = Number(req.params.courseId);
  const id = Number(req.params.id);

  const redemption = await prisma.rewardRedemption.findFirst({
    where: { id, courseId },
    include: { reward: true, student: true },
  });

  if (!redemption) {
    res.status(404).json({ detail: "找不到此兌換紀錄" });
    return;
  }

  if (redemption.status !== "approved_held") {
    res.status(400).json({ detail: "必須先經審核核准（預扣點數）後，才能確認發放交件！" });
    return;
  }

  const today = getTodayStrTaipei();
  const now = getNowStrTaipei();

  await prisma.$transaction(async (tx) => {
    // 正式寫入真實扣點日誌 ScoreLog
    const scoreLog = await tx.scoreLog.create({
      data: {
        courseId,
        studentId: redemption.studentId,
        ruleId: null,
        ruleTitle: `🎁 實體獎品：${redemption.reward.name}`,
        score: -Math.abs(redemption.pointsSpent),
        category: "negative",
        date: today,
        timestamp: now,
      },
    });

    // 更新兌換記錄為已完成
    await tx.rewardRedemption.update({
      where: { id },
      data: {
        status: "completed",
        scoreLogId: scoreLog.id,
        fulfilledAt: now,
      },
    });
  });

  broadcastToCourse(courseId, "score_updated");
  broadcastToCourse(courseId, "rewards_updated");
  res.json({ message: "實體獎品已確認交件，點數已正式扣除！" });
});

// 8. 教師駁回實體獎品申請 (未扣點)
rewardsRouter.post("/:courseId/redemptions/:id/reject", async (req, res) => {
  const courseId = Number(req.params.courseId);
  const id = Number(req.params.id);

  const redemption = await prisma.rewardRedemption.findFirst({
    where: { id, courseId },
  });

  if (!redemption) {
    res.status(404).json({ detail: "找不到此兌換紀錄" });
    return;
  }

  if (redemption.status !== "requested") {
    res.status(400).json({ detail: "僅能駁回等待審核中的申請" });
    return;
  }

  await prisma.rewardRedemption.update({
    where: { id },
    data: {
      status: "rejected",
      teacherNote: req.body?.teacherNote || "教師已駁回此申請",
    },
  });

  broadcastToCourse(courseId, "rewards_updated");
  res.json({ message: "已駁回該兌換申請。" });
});

// 9. 取消已核准之申請 (釋放預扣點數並歸還庫存)
rewardsRouter.post("/:courseId/redemptions/:id/cancel", async (req, res) => {
  const courseId = Number(req.params.courseId);
  const id = Number(req.params.id);

  const redemption = await prisma.rewardRedemption.findFirst({
    where: { id, courseId },
    include: { reward: true },
  });

  if (!redemption) {
    res.status(404).json({ detail: "找不到此兌換紀錄" });
    return;
  }

  if (redemption.status !== "approved_held") {
    res.status(400).json({ detail: "僅能取消處於【審核通過預扣中】的兌換紀錄" });
    return;
  }

  const now = getNowStrTaipei();

  await prisma.$transaction(async (tx) => {
    // 若原先有扣庫存，還原庫存
    if (redemption.reward.stock >= 0) {
      await tx.rewardItem.update({
        where: { id: redemption.rewardId },
        data: { stock: { increment: 1 }, updatedAt: now },
      });
    }

    await tx.rewardRedemption.update({
      where: { id },
      data: {
        status: "cancelled",
        teacherNote: req.body?.teacherNote || "教師已取消發放並釋放預扣點數",
      },
    });
  });

  broadcastToCourse(courseId, "score_updated");
  broadcastToCourse(courseId, "rewards_updated");
  res.json({ message: "已取消該發放，預扣點數已退還給學生，庫存已歸還。" });
});
