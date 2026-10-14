import { Router } from "express";
import { prisma } from "../db";
import { broadcastToCourse } from "../realtime";
import { autoCatch } from "../asyncRoute";
import { getNowStrTaipei, getTodayStrTaipei } from "../timezone";

export const studentRewardsRouter = autoCatch(Router());

// 輔助函式：計算學生可用點數與預扣點數
async function getStudentPointStatus(courseId: number, studentId: number) {
  // 1. 歷史有效總分
  const logs = await prisma.scoreLog.findMany({
    where: { courseId, studentId, isUndone: 0 },
    select: { score: true },
  });
  const totalScore = logs.reduce((sum, l) => sum + l.score, 0);

  // 2. 審核通過但尚未確認發放的實體獎品「預扣點數」
  const heldRedemptions = await prisma.rewardRedemption.findMany({
    where: { studentId, courseId, status: "approved_held" },
    select: { pointsSpent: true },
  });
  const heldPoints = heldRedemptions.reduce((sum, r) => sum + r.pointsSpent, 0);

  const availablePoints = totalScore - heldPoints;

  return { totalScore, heldPoints, availablePoints };
}

// 1. 取得商城可兌換之獎勵品項列表
studentRewardsRouter.get("/items", async (req, res) => {
  const { courseId, studentId } = req.studentAuth!;

  const { totalScore, heldPoints, availablePoints } = await getStudentPointStatus(courseId, studentId);

  // 取得該班級所有上架中的品項
  const items = await prisma.rewardItem.findMany({
    where: { courseId, isActive: 1 },
    orderBy: [{ orderIndex: "asc" }, { id: "desc" }],
  });

  // 取得學生已獲得的榮譽徽章 ID 清單 (避免重複兌換)
  const myBadges = await prisma.rewardRedemption.findMany({
    where: {
      studentId,
      courseId,
      status: "completed",
      reward: { rewardType: "badge" },
    },
    select: { rewardId: true },
  });
  const ownedBadgeIds = new Set(myBadges.map((b) => b.rewardId));

  const itemsEnriched = items.map((item) => ({
    id: item.id,
    name: item.name,
    description: item.description,
    reward_type: item.rewardType,
    points_cost: item.pointsCost,
    stock: item.stock,
    image_url: item.imageUrl,
    card_series: item.cardSeries,
    already_owned: item.rewardType === "badge" ? ownedBadgeIds.has(item.id) : false,
    can_afford: availablePoints >= item.pointsCost,
    is_out_of_stock: item.stock === 0,
  }));

  res.json({
    total_score: totalScore,
    held_points: heldPoints,
    available_points: availablePoints,
    items: itemsEnriched,
  });
});

// 2. 學生送出兌換請求 (虛擬立即兌換扣點 / 實體進入審核流程)
studentRewardsRouter.post("/redeem", async (req, res) => {
  const { courseId, studentId } = req.studentAuth!;
  const rewardId = Number(req.body?.reward_id);
  const requestNote = (req.body?.request_note as string | undefined)?.trim() || null;

  if (isNaN(rewardId) || rewardId <= 0) {
    res.status(400).json({ detail: "請指定要兌換的獎勵品項" });
    return;
  }

  const reward = await prisma.rewardItem.findFirst({
    where: { id: rewardId, courseId, isActive: 1 },
  });

  if (!reward) {
    res.status(404).json({ detail: "此獎勵品項不存在或已下架" });
    return;
  }

  // 檢查庫存
  if (reward.stock === 0) {
    res.status(400).json({ detail: "很抱歉，此品項已無庫存囉！" });
    return;
  }

  // 檢查可用點數 (總分扣除目前預扣中之點數)
  const { availablePoints } = await getStudentPointStatus(courseId, studentId);
  if (availablePoints < reward.pointsCost) {
    res.status(400).json({
      detail: `點數不足！兌換需要 ${reward.pointsCost} 點，您目前可用點數為 ${availablePoints} 點。`,
    });
    return;
  }

  const now = getNowStrTaipei();
  const today = getTodayStrTaipei();

  // 分支 A: 實體獎品/特權 -> 提出申請，進入三階段審核流程 (requested)
  if (reward.rewardType === "physical") {
    // 檢查是否已有相同獎品正在申請中 (避免連點重複送出)
    const existingPending = await prisma.rewardRedemption.findFirst({
      where: {
        rewardId,
        studentId,
        status: { in: ["requested", "approved_held"] },
      },
    });
    if (existingPending) {
      res.status(400).json({
        detail: "您已經提出過此品項的兌換申請，目前正等待老師審核發放中！",
      });
      return;
    }

    const redemption = await prisma.rewardRedemption.create({
      data: {
        rewardId: reward.id,
        studentId,
        courseId,
        pointsSpent: reward.pointsCost,
        status: "requested", // 狀態：待教師審核
        requestNote,
        createdAt: now,
      },
    });

    broadcastToCourse(courseId, "rewards_updated");

    res.status(201).json({
      success: true,
      reward_type: "physical",
      status: "requested",
      message: `已送出「${reward.name}」的兌換申請！請等候老師審核，審核通過後點數將會暫時預扣。`,
      redemption_id: redemption.id,
    });
    return;
  }

  // 分支 B: 虛擬功能 (榮譽徽章 或 特殊圖卡) -> 即時完成扣點並收錄
  if (reward.rewardType === "badge") {
    // 徽章每款限兌換一次
    const alreadyHad = await prisma.rewardRedemption.findFirst({
      where: { rewardId, studentId, status: "completed" },
    });
    if (alreadyHad) {
      res.status(400).json({ detail: "您已經擁有這枚榮譽徽章囉！" });
      return;
    }
  }

  const prefix = reward.rewardType === "badge" ? "🏅 榮譽徽章" : "🎴 特殊圖卡";

  await prisma.$transaction(async (tx) => {
    // 庫存若非無限制 (-1)，扣減 1
    if (reward.stock > 0) {
      await tx.rewardItem.update({
        where: { id: reward.id },
        data: { stock: { decrement: 1 }, updatedAt: now },
      });
    }

    // 寫入真實扣點日誌 ScoreLog
    const log = await tx.scoreLog.create({
      data: {
        courseId,
        studentId,
        ruleId: null,
        ruleTitle: `${prefix}：${reward.name}`,
        score: -Math.abs(reward.pointsCost),
        category: "negative",
        date: today,
        timestamp: now,
      },
    });

    // 建立兌換紀錄 (即時 completed)
    await tx.rewardRedemption.create({
      data: {
        rewardId: reward.id,
        studentId,
        courseId,
        pointsSpent: reward.pointsCost,
        status: "completed",
        scoreLogId: log.id,
        createdAt: now,
        fulfilledAt: now,
      },
    });
  });

  broadcastToCourse(courseId, "score_updated");
  broadcastToCourse(courseId, "rewards_updated");

  res.status(201).json({
    success: true,
    reward_type: reward.rewardType,
    status: "completed",
    message: `恭喜成功兌換「${reward.name}」！已收錄至您的個人收藏館。`,
  });
});

// 3. 取得學生個人獎勵收藏庫 (徽章牆、特殊圖卡圖鑑冊、實體獎品領取進度)
studentRewardsRouter.get("/my-collection", async (req, res) => {
  const { courseId, studentId } = req.studentAuth!;

  const { totalScore, heldPoints, availablePoints } = await getStudentPointStatus(courseId, studentId);

  const redemptions = await prisma.rewardRedemption.findMany({
    where: { studentId, courseId },
    include: {
      reward: true,
    },
    orderBy: [{ id: "desc" }],
  });

  // 分類拆分
  const badges = redemptions
    .filter((r) => r.reward.rewardType === "badge" && r.status === "completed")
    .map((r) => ({
      id: r.id,
      name: r.reward.name,
      description: r.reward.description,
      image_url: r.reward.imageUrl,
      points_spent: r.pointsSpent,
      acquired_at: r.fulfilledAt || r.createdAt,
    }));

  const cards = redemptions
    .filter((r) => r.reward.rewardType === "collectible_card" && r.status === "completed")
    .map((r) => ({
      id: r.id,
      name: r.reward.name,
      description: r.reward.description,
      image_url: r.reward.imageUrl,
      card_series: r.reward.cardSeries || "特別典藏",
      points_spent: r.pointsSpent,
      acquired_at: r.fulfilledAt || r.createdAt,
    }));

  const physical = redemptions
    .filter((r) => r.reward.rewardType === "physical")
    .map((r) => ({
      id: r.id,
      name: r.reward.name,
      description: r.reward.description,
      image_url: r.reward.imageUrl,
      points_spent: r.pointsSpent,
      status: r.status, // "requested" | "approved_held" | "completed" | "rejected" | "cancelled"
      request_note: r.requestNote,
      teacher_note: r.teacherNote,
      created_at: r.createdAt,
      approved_at: r.approvedAt,
      fulfilled_at: r.fulfilledAt,
    }));

  res.json({
    total_score: totalScore,
    held_points: heldPoints,
    available_points: availablePoints,
    badges,
    cards,
    physical,
  });
});
