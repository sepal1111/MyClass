import fs from "fs";
import path from "path";
import { Router } from "express";
import multer from "multer";
import ExcelJS from "exceljs";
import QRCode from "qrcode";
import { prisma } from "../db";
import { autoCatch } from "../asyncRoute";
import { getNowStrTaipei } from "../timezone";
import { getUploadsDir } from "../paths";
import { parseCsvPointCards, parseExcelPointCards, ParsedPointCard } from "../utils/pointCardImport";
import { resolveCardImage } from "./studentPointCards";

export const pointCardsRouter = autoCatch(Router());
const upload = multer({ storage: multer.memoryStorage() });

// 0-1. 卡片排版工具支援：QR Code 生成
pointCardsRouter.get("/tools/qrcode", async (req, res) => {
  const text = String(req.query.text || "").trim();
  if (!text) {
    res.status(400).json({ detail: "text 參數不可為空" });
    return;
  }
  const dataUrl = await QRCode.toDataURL(text, {
    errorCorrectionLevel: (req.query.ec as "L" | "M" | "Q" | "H") || "M",
    margin: Number(req.query.margin ?? 1),
    scale: Number(req.query.scale ?? 8),
  });
  res.json({ dataUrl });
});

// 0-2. 卡片排版工具支援：上傳自訂卡片背景底圖 / 指定分數圖卡
pointCardsRouter.post("/upload-background", upload.single("image"), async (req, res) => {
  const file = req.file;
  if (!file) {
    res.status(400).json({ detail: "請選擇圖片檔案" });
    return;
  }
  const ext = path.extname(file.originalname).toLowerCase() || ".png";
  if (![".jpg", ".jpeg", ".png", ".webp"].includes(ext)) {
    res.status(400).json({ detail: "僅支援 JPG, PNG, WEBP 圖片格式" });
    return;
  }
  const filename = `bg_card_${Date.now()}_${Math.random().toString(36).substring(2, 8)}${ext}`;
  const uploadDir = path.join(getUploadsDir(), "card_backgrounds");
  fs.mkdirSync(uploadDir, { recursive: true });
  fs.writeFileSync(path.join(uploadDir, filename), file.buffer);
  const url = `/uploads/card_backgrounds/${filename}`;
  res.json({ url, filename });
});

pointCardsRouter.post("/upload-card-image", upload.single("image"), async (req, res) => {
  const file = req.file;
  if (!file) {
    res.status(400).json({ detail: "請選擇圖片檔案" });
    return;
  }
  const ext = path.extname(file.originalname).toLowerCase() || ".png";
  if (![".jpg", ".jpeg", ".png", ".webp"].includes(ext)) {
    res.status(400).json({ detail: "僅支援 JPG, PNG, WEBP 圖片格式" });
    return;
  }
  const filename = `card_${Date.now()}_${Math.random().toString(36).substring(2, 8)}${ext}`;
  const uploadDir = path.join(getUploadsDir(), "card_backgrounds");
  fs.mkdirSync(uploadDir, { recursive: true });
  fs.writeFileSync(path.join(uploadDir, filename), file.buffer);
  const url = `/uploads/card_backgrounds/${filename}`;
  res.json({ url, filename });
});

// 0-3. 取得系列專屬排版設定
pointCardsRouter.get("/series/:seriesId/layout", async (req, res) => {
  const seriesId = Number(req.params.seriesId);
  const series = await prisma.pointCardSeries.findUnique({
    where: { id: seriesId },
    select: { id: true, name: true, cardTheme: true, layoutConfig: true, customImagesJson: true },
  });
  if (!series) {
    res.status(404).json({ detail: "找不到指定系列" });
    return;
  }
  let parsedLayout = null;
  if (series.layoutConfig) {
    try {
      parsedLayout = JSON.parse(series.layoutConfig);
    } catch {
      /* fallback null */
    }
  }
  let parsedCustomImages = {};
  if (series.customImagesJson) {
    try {
      parsedCustomImages = JSON.parse(series.customImagesJson);
    } catch {
      /* fallback */
    }
  }
  res.json({
    series_id: series.id,
    series_name: series.name,
    card_theme: series.cardTheme,
    layout_config: parsedLayout,
    custom_images: parsedCustomImages,
  });
});

// 0-4. 儲存系列專屬排版設定
pointCardsRouter.put("/series/:seriesId/layout", async (req, res) => {
  const seriesId = Number(req.params.seriesId);
  const layoutConfig = req.body?.layout_config;
  const configStr = typeof layoutConfig === "string" ? layoutConfig : JSON.stringify(layoutConfig ?? {});
  const updated = await prisma.pointCardSeries.update({
    where: { id: seriesId },
    data: { layoutConfig: configStr },
  });
  res.json({ message: "排版設定已儲存", series_id: updated.id });
});

// 0. 範本下載 (必須放在 /:courseId 之前，避免被捕獲)
pointCardsRouter.get("/template/csv", (_req, res) => {
  const headers = ["序列號", "卡號", "名稱", "分數"];
  const sample = [
    ["A-001", "CARD-0001", "認真發言", 2],
    ["A-002", "CARD-0002", "熱心助人", 1],
    ["A-003", "CARD-0003", "作業特優", 5],
    ["A-004", "CARD-0004", "上課吵鬧", -1],
  ];
  const lines = [headers, ...sample].map((row) => row.join(","));
  const content = "\uFEFF" + lines.join("\r\n") + "\r\n";
  const filename = encodeURIComponent("實體點數卡匯入範例.csv");
  res.set({
    "Content-Type": "text/csv; charset=utf-8",
    "Content-Disposition": `attachment; filename*=UTF-8''${filename}`,
  });
  res.send(Buffer.from(content, "utf-8"));
});

pointCardsRouter.get("/template/excel", async (_req, res) => {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet("點數卡名單");

  sheet.columns = [
    { header: "序列號", key: "card_no", width: 14 },
    { header: "卡號 (QR碼內容)", key: "code", width: 22 },
    { header: "卡片名稱", key: "label", width: 20 },
    { header: "點數分數", key: "score", width: 14 },
  ];

  sheet.addRow({ card_no: "A-001", code: "CARD-0001", label: "認真發言", score: 2 });
  sheet.addRow({ card_no: "A-002", code: "CARD-0002", label: "熱心助人", score: 1 });
  sheet.addRow({ card_no: "A-003", code: "CARD-0003", label: "作業特優", score: 5 });
  sheet.addRow({ card_no: "A-004", code: "CARD-0004", label: "課堂表現優良", score: 10 });
  sheet.addRow({ card_no: "A-005", code: "CARD-0005", label: "上課分心", score: -1 });

  // Header styling
  const headerRow = sheet.getRow(1);
  headerRow.font = { bold: true, color: { argb: "FFFFFFFF" } };
  headerRow.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF5B7CD6" } };

  const buffer = await workbook.xlsx.writeBuffer();
  const filename = encodeURIComponent("實體點數卡匯入範例.xlsx");
  res.set({
    "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    "Content-Disposition": `attachment; filename*=UTF-8''${filename}`,
  });
  res.send(Buffer.from(buffer));
});

// 1. 取得課程點數卡清單（含所屬系列與兌換次數）
pointCardsRouter.get("/:courseId", async (req, res) => {
  const courseId = Number(req.params.courseId);
  if (isNaN(courseId)) {
    res.status(400).json({ detail: "無效的課程 ID" });
    return;
  }
  const cards = await prisma.pointCard.findMany({
    where: { courseId },
    include: {
      series: true,
      _count: { select: { redemptions: true } },
    },
    orderBy: [{ seriesId: "asc" }, { id: "asc" }],
  });

  const formatted = cards.map((c) => ({
    id: c.id,
    course_id: c.courseId,
    series_id: c.seriesId,
    series_name: c.series?.name ?? "未分類",
    card_theme: c.series?.cardTheme ?? "custom",
    card_no: c.cardNo ?? "",
    code: c.code,
    label: c.label,
    score: c.score,
    image: resolveCardImage(
      c.series?.cardTheme ?? "custom",
      c.score,
      c.image,
      c.series?.customImagesJson
    ),
    series_custom_images: c.series?.customImagesJson ? JSON.parse(c.series.customImagesJson) : null,
    created_at: c.createdAt,
    redemption_count: c._count.redemptions,
  }));

  res.json(formatted);
});

// 2. 批次匯入點數卡（支援 Excel .xlsx / .xls 與 .csv）
pointCardsRouter.post("/:courseId/upload", upload.single("file"), async (req, res) => {
  const courseId = Number(req.params.courseId);
  if (isNaN(courseId) || courseId <= 0) {
    res.status(400).json({ detail: "無效的班級 ID，請先選擇班級" });
    return;
  }
  const file = req.file;
  if (!file) {
    res.status(400).json({ detail: "請選擇要上傳的 Excel 或 CSV 檔案" });
    return;
  }

  const fileName = file.originalname.toLowerCase();
  let rows: ParsedPointCard[] = [];

  if (fileName.endsWith(".xlsx") || fileName.endsWith(".xls")) {
    rows = await parseExcelPointCards(file.buffer);
  } else if (fileName.endsWith(".csv")) {
    rows = parseCsvPointCards(file.buffer.toString("utf-8"));
  } else {
    res.status(400).json({ detail: "僅支援 .xlsx, .xls 或 .csv 檔案格式" });
    return;
  }

  if (rows.length === 0) {
    res.status(400).json({ detail: "檔案中未找到有效的點數卡資料，請確認包含卡號與分數欄位" });
    return;
  }

  // 檢查序列號 (cardNo) 是否重複
  const cardNoMap = new Map<string, number>();
  const fileDuplicates = new Set<string>();

  for (let i = 0; i < rows.length; i++) {
    const rawNo = (rows[i].cardNo || "").trim();
    if (!rawNo) continue;
    const norm = rawNo.toLowerCase();
    if (cardNoMap.has(norm)) {
      fileDuplicates.add(rawNo);
    } else {
      cardNoMap.set(norm, i + 1);
    }
  }

  if (fileDuplicates.size > 0) {
    const dupList = Array.from(fileDuplicates).slice(0, 10).join(", ");
    const more = fileDuplicates.size > 10 ? ` 等共 ${fileDuplicates.size} 個` : "";
    res.status(400).json({
      detail: `匯入檔案中包含重複的序列號：[${dupList}${more}]，每張卡片的序列號必須唯一，請修正後再重新上傳！`,
    });
    return;
  }

  // 檢查是否與班級既有卡片的序列號衝突（同 QR 碼視為更新，不同 QR 碼但同序列號視為衝突）
  const incomingNos = Array.from(
    new Set(rows.map((r) => (r.cardNo || "").trim()).filter(Boolean))
  );

  if (incomingNos.length > 0) {
    const existingSameNos = await prisma.pointCard.findMany({
      where: {
        courseId,
        cardNo: { in: incomingNos },
      },
      select: { code: true, cardNo: true },
    });

    const dbConflictNos = new Set<string>();
    const codeByIncomingNo = new Map<string, string>();
    for (const r of rows) {
      if (r.cardNo && r.cardNo.trim()) {
        codeByIncomingNo.set(r.cardNo.trim().toLowerCase(), r.code.trim().toLowerCase());
      }
    }

    for (const ex of existingSameNos) {
      if (!ex.cardNo) continue;
      const incomingCode = codeByIncomingNo.get(ex.cardNo.trim().toLowerCase());
      if (incomingCode && incomingCode !== ex.code.trim().toLowerCase()) {
        dbConflictNos.add(ex.cardNo.trim());
      }
    }

    if (dbConflictNos.size > 0) {
      const dupList = Array.from(dbConflictNos).slice(0, 10).join(", ");
      const more = dbConflictNos.size > 10 ? ` 等共 ${dbConflictNos.size} 個` : "";
      res.status(400).json({
        detail: `匯入失敗：序列號與本班既有卡片衝突！以下序列號已被其他卡片使用：[${dupList}${more}]，請確認後重新匯入。`,
      });
      return;
    }
  }

  // 檢查是否指定或自動建立系列
  let seriesId: number | null = null;
  const seriesIdParam = req.body?.series_id;
  const newSeriesName = String(req.body?.new_series_name ?? "").trim();
  const cardTheme = String(req.body?.card_theme ?? "custom").trim();

  const now = getNowStrTaipei();

  if (newSeriesName) {
    let existingSeries = await prisma.pointCardSeries.findFirst({
      where: {
        name: newSeriesName,
        OR: [{ courseId }, { courseId: null }],
      },
    });
    if (!existingSeries) {
      existingSeries = await prisma.pointCardSeries.create({
        data: {
          courseId,
          name: newSeriesName,
          cardTheme: cardTheme || "custom",
          allowedCourseIds: String(courseId),
          createdAt: now,
        },
      });
    }
    seriesId = existingSeries.id;
  } else if (seriesIdParam && seriesIdParam !== "uncategorized" && seriesIdParam !== "none") {
    const parsedSid = Number(seriesIdParam);
    seriesId = !isNaN(parsedSid) && parsedSid > 0 ? parsedSid : null;
  }

  let createdCount = 0;
  let updatedCount = 0;

  for (const row of rows) {
    const existing = await prisma.pointCard.findUnique({
      where: { courseId_code: { courseId, code: row.code } },
    });

    // 只有當 row.image 是真正自訂上傳的完整網址或路徑時才儲存，忽略舊式 Excel 範本檔名 (如 score_card_A_1.jpg)
    const cleanImage =
      row.image && (row.image.startsWith("/uploads/") || row.image.startsWith("http://") || row.image.startsWith("https://") || row.image.startsWith("data:"))
        ? row.image.trim()
        : null;

    await prisma.pointCard.upsert({
      where: { courseId_code: { courseId, code: row.code } },
      update: {
        label: row.label,
        score: row.score,
        cardNo: row.cardNo ?? existing?.cardNo ?? null,
        image: cleanImage ?? (existing?.image && !existing.image.startsWith("score_card_") ? existing.image : null),
        ...(seriesId != null ? { seriesId } : {}),
      },
      create: {
        courseId,
        seriesId,
        cardNo: row.cardNo ?? null,
        code: row.code,
        label: row.label,
        score: row.score,
        image: cleanImage,
        createdAt: now,
      },
    });

    if (existing) updatedCount++;
    else createdCount++;
  }

  res.json({
    created_count: createdCount,
    updated_count: updatedCount,
    series_id: seriesId,
    message: `匯入完成：新增 ${createdCount} 張、更新 ${updatedCount} 張點數卡`,
  });
});

// 3. 系列管理 API (完全由使用者建立，不自動生成內建系列)
pointCardsRouter.get("/:courseId/series", async (req, res) => {
  const courseId = Number(req.params.courseId);
  if (isNaN(courseId) || courseId <= 0) {
    res.status(400).json({ detail: "無效的班級 ID，請先選擇班級" });
    return;
  }

  const series = await prisma.pointCardSeries.findMany({
    where: {
      OR: [
        { courseId },
        { courseId: null },
        { allowedCourseIds: "" },
        { allowedCourseIds: { contains: String(courseId) } },
      ],
    },
    include: {
      _count: { select: { cards: true } },
    },
    orderBy: { id: "asc" },
  });

  const allCourses = await prisma.course.findMany({
    select: { id: true, name: true },
    orderBy: { id: "asc" },
  });

  const formatted = series.map((s) => {
    const allowedIds = s.allowedCourseIds
      ? s.allowedCourseIds.split(",").map((x) => Number(x.trim())).filter((x) => !isNaN(x))
      : [];
    let parsedLayout = null;
    if (s.layoutConfig) {
      try {
        parsedLayout = JSON.parse(s.layoutConfig);
      } catch {
        /* fallback null */
      }
    }
    let parsedCustomImages: Record<string, string> = {};
    if (s.customImagesJson) {
      try {
        parsedCustomImages = JSON.parse(s.customImagesJson);
      } catch {
        /* fallback empty */
      }
    }
    return {
      id: s.id,
      name: s.name,
      card_theme: s.cardTheme,
      allowed_course_ids: allowedIds,
      layout_config: parsedLayout,
      custom_images: parsedCustomImages,
      card_count: s._count.cards,
      created_at: s.createdAt,
    };
  });

  res.json({ series: formatted, courses: allCourses });
});

// 新增或更新系列
pointCardsRouter.post("/:courseId/series", async (req, res) => {
  const courseId = Number(req.params.courseId);
  if (isNaN(courseId) || courseId <= 0) {
    res.status(400).json({ detail: "無效的班級 ID，請先選擇班級" });
    return;
  }
  const { id, name, card_theme, allowed_course_ids, custom_images } = req.body;

  if (!name || !String(name).trim()) {
    res.status(400).json({ detail: "系列名稱不可為空" });
    return;
  }

  const allowedStr = Array.isArray(allowed_course_ids)
    ? allowed_course_ids.join(",")
    : String(allowed_course_ids ?? courseId);

  const theme = String(card_theme || "custom");
  const now = getNowStrTaipei();

  let customImagesJson: string | null = null;
  if (custom_images !== undefined) {
    if (typeof custom_images === "string") {
      customImagesJson = custom_images;
    } else if (typeof custom_images === "object" && custom_images !== null) {
      customImagesJson = JSON.stringify(custom_images);
    }
  }

  if (id) {
    const dataToUpdate: any = {
      name: String(name).trim(),
      cardTheme: theme,
      allowedCourseIds: allowedStr,
    };
    if (custom_images !== undefined) {
      dataToUpdate.customImagesJson = customImagesJson;
    }

    const updated = await prisma.pointCardSeries.update({
      where: { id: Number(id) },
      data: dataToUpdate,
    });
    res.json({ message: "系列已更新", series: updated });
  } else {
    // 若已存在相同名稱系列，則更新該系列風格與授權
    const existing = await prisma.pointCardSeries.findFirst({
      where: {
        name: String(name).trim(),
        OR: [{ courseId }, { courseId: null }],
      },
    });
    if (existing) {
      const dataToUpdate: any = {
        cardTheme: theme,
        allowedCourseIds: allowedStr,
      };
      if (custom_images !== undefined) {
        dataToUpdate.customImagesJson = customImagesJson;
      }
      const updated = await prisma.pointCardSeries.update({
        where: { id: existing.id },
        data: dataToUpdate,
      });
      res.json({ message: "系列已存在並更新設定", series: updated });
      return;
    }

    const created = await prisma.pointCardSeries.create({
      data: {
        courseId,
        name: String(name).trim(),
        cardTheme: theme,
        allowedCourseIds: allowedStr,
        customImagesJson,
        createdAt: now,
      },
    });
    res.json({ message: "系列已建立", series: created });
  }
});

// 刪除系列（卡片轉為未分類）
pointCardsRouter.delete("/:courseId/series/:seriesId", async (req, res) => {
  const seriesId = Number(req.params.seriesId);
  await prisma.pointCard.updateMany({
    where: { seriesId },
    data: { seriesId: null },
  });
  await prisma.pointCardSeries.delete({ where: { id: seriesId } });
  res.json({ message: "系列已刪除，原卡片已轉為未分類" });
});

// 4. 批次操作
// 批次移動卡片所屬系列
pointCardsRouter.post("/:courseId/batch-move", async (req, res) => {
  const courseId = Number(req.params.courseId);
  const cardIds: number[] = Array.isArray(req.body?.card_ids) ? req.body.card_ids.map(Number) : [];
  const targetSeriesId = req.body?.target_series_id ? Number(req.body.target_series_id) : null;

  if (cardIds.length === 0) {
    res.status(400).json({ detail: "請選擇要移動的卡片" });
    return;
  }

  await prisma.pointCard.updateMany({
    where: { courseId, id: { in: cardIds } },
    data: { seriesId: targetSeriesId },
  });

  res.json({ message: `成功將 ${cardIds.length} 張卡片移動至指定系列` });
});

// 批次刪除卡片
pointCardsRouter.post("/:courseId/batch-delete", async (req, res) => {
  const courseId = Number(req.params.courseId);
  const cardIds: number[] = Array.isArray(req.body?.card_ids) ? req.body.card_ids.map(Number) : [];

  if (cardIds.length === 0) {
    res.status(400).json({ detail: "請選擇要刪除的卡片" });
    return;
  }

  await prisma.pointCard.deleteMany({
    where: { courseId, id: { in: cardIds } },
  });

  res.json({ message: `成功刪除 ${cardIds.length} 張點數卡` });
});

// 清空全部點數卡
pointCardsRouter.delete("/:courseId/clear", async (req, res) => {
  const courseId = Number(req.params.courseId);
  await prisma.pointCard.deleteMany({ where: { courseId } });
  res.json({ message: "已清空全部點數卡" });
});

// 刪除單張點數卡
pointCardsRouter.delete("/:courseId/:cardId", async (req, res) => {
  await prisma.pointCard.deleteMany({
    where: { id: Number(req.params.cardId), courseId: Number(req.params.courseId) },
  });
  res.json({ message: "點數卡已刪除" });
});

// 5. 點數卡使用統計
pointCardsRouter.get("/:courseId/stats", async (req, res) => {
  const courseId = Number(req.params.courseId);
  const totalCards = await prisma.pointCard.count({ where: { courseId } });
  const redemptions = await prisma.pointCardRedemption.findMany({
    where: { pointCard: { courseId } },
    include: {
      pointCard: true,
      student: true,
    },
  });

  const totalRedeemed = redemptions.length;
  const cardStatsMap = new Map<number, { label: string; card_no: string | null; score: number; count: number }>();
  const studentStatsMap = new Map<number, { name: string; seat_number: number; total_score: number; count: number }>();

  for (const r of redemptions) {
    // 卡片使用次數
    const cStat = cardStatsMap.get(r.pointCardId) ?? {
      label: r.pointCard.label,
      card_no: r.pointCard.cardNo,
      score: r.pointCard.score,
      count: 0,
    };
    cStat.count++;
    cardStatsMap.set(r.pointCardId, cStat);

    // 學生兌換排行
    const sStat = studentStatsMap.get(r.studentId) ?? {
      name: r.student.name,
      seat_number: r.student.studentNumber,
      total_score: 0,
      count: 0,
    };
    sStat.count++;
    sStat.total_score += r.pointCard.score;
    studentStatsMap.set(r.studentId, sStat);
  }

  const topCards = Array.from(cardStatsMap.values()).sort((a, b) => b.count - a.count).slice(0, 10);
  const topStudents = Array.from(studentStatsMap.values()).sort((a, b) => b.total_score - a.total_score).slice(0, 10);

  res.json({
    total_cards: totalCards,
    total_redeemed: totalRedeemed,
    top_cards: topCards,
    top_students: topStudents,
  });
});

