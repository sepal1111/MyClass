// File collections management (Teacher-side): topics CRUD, allowUpload toggle,
// list files with preview metadata, item deletion, and ZIP archive download.
import fs from "fs";
import path from "path";
import os from "os";
import { execFile } from "child_process";
import { promisify } from "util";
import { Router } from "express";
import { prisma } from "../db";
import { autoCatch } from "../asyncRoute";
import { getNowStrTaipei } from "../timezone";
import { getUploadsDir } from "../paths";
import { broadcastToCourse } from "../realtime";
import { sanitizeFolderSegment } from "../utils/upload";

const execFileAsync = promisify(execFile);

export const fileCollectionsRouter = autoCatch(Router());

function safeDeleteUploadedFile(fileUrl: string): void {
  try {
    const rel = fileUrl.replace(/^\/uploads\//, "");
    const fullPath = path.join(getUploadsDir(), rel);
    if (fs.existsSync(fullPath) && fs.statSync(fullPath).isFile()) {
      fs.unlinkSync(fullPath);
    }
  } catch (err) {
    console.error("[FileCollections] Failed to delete file:", fileUrl, err);
  }
}

// 1. 取得課程所有檔案蒐集主題清單（含收件人數與檔案總數）
fileCollectionsRouter.get("/courses/:courseId", async (req, res) => {
  const courseId = Number(req.params.courseId);
  const collections = await prisma.fileCollection.findMany({
    where: { courseId },
    orderBy: [{ orderIndex: "asc" }, { id: "desc" }],
    include: {
      items: {
        select: {
          id: true,
          studentId: true,
          fileSize: true,
        },
      },
    },
  });

  const totalStudents = await prisma.student.count({
    where: { courseId, isActive: 1 },
  });

  const enriched = collections.map((c) => {
    const uniqueStudents = new Set(c.items.map((i) => i.studentId)).size;
    const totalFiles = c.items.length;
    const totalBytes = c.items.reduce((sum, i) => sum + i.fileSize, 0);

    return {
      id: c.id,
      course_id: c.courseId,
      title: c.title,
      description: c.description,
      allowed_extensions: c.allowedExtensions,
      allow_upload: c.allowUpload,
      order_index: c.orderIndex,
      created_at: c.createdAt,
      updated_at: c.updatedAt,
      student_count: uniqueStudents,
      total_students: totalStudents,
      file_count: totalFiles,
      total_bytes: totalBytes,
    };
  });

  res.json(enriched);
});

// 2. 建立新主題
fileCollectionsRouter.post("/courses/:courseId", async (req, res) => {
  const courseId = Number(req.params.courseId);
  const title = typeof req.body?.title === "string" ? req.body.title.trim() : "";
  if (!title) {
    res.status(400).json({ detail: "請提供蒐集主題名稱" });
    return;
  }

  const description = typeof req.body?.description === "string" ? req.body.description.trim() : null;
  const allowedExtensions =
    typeof req.body?.allowed_extensions === "string" ? req.body.allowed_extensions.trim() : null;
  const allowUpload = req.body?.allow_upload === 0 || req.body?.allow_upload === false ? 0 : 1;

  const now = getNowStrTaipei();
  const created = await prisma.fileCollection.create({
    data: {
      courseId,
      title,
      description,
      allowedExtensions,
      allowUpload,
      createdAt: now,
      updatedAt: now,
    },
  });

  broadcastToCourse(courseId, "file_collection_updated");
  res.status(201).json(created);
});

// 3. 修改主題資訊
fileCollectionsRouter.put("/:id", async (req, res) => {
  const id = Number(req.params.id);
  const existing = await prisma.fileCollection.findUnique({ where: { id } });
  if (!existing) {
    res.status(404).json({ detail: "蒐集主題不存在" });
    return;
  }

  const title = typeof req.body?.title === "string" ? req.body.title.trim() : existing.title;
  if (!title) {
    res.status(400).json({ detail: "標題不能為空" });
    return;
  }

  const description =
    req.body?.description !== undefined
      ? typeof req.body.description === "string"
        ? req.body.description.trim()
        : null
      : existing.description;

  const allowedExtensions =
    req.body?.allowed_extensions !== undefined
      ? typeof req.body.allowed_extensions === "string"
        ? req.body.allowed_extensions.trim()
        : null
      : existing.allowedExtensions;

  const allowUpload =
    req.body?.allow_upload !== undefined
      ? req.body.allow_upload
        ? 1
        : 0
      : existing.allowUpload;

  const updated = await prisma.fileCollection.update({
    where: { id },
    data: {
      title,
      description,
      allowedExtensions,
      allowUpload,
      updatedAt: getNowStrTaipei(),
    },
  });

  broadcastToCourse(existing.courseId, "file_collection_updated");
  res.json(updated);
});

// 4. 一鍵切換上傳開關 (toggle allow_upload)
fileCollectionsRouter.patch("/:id/toggle_upload", async (req, res) => {
  const id = Number(req.params.id);
  const existing = await prisma.fileCollection.findUnique({ where: { id } });
  if (!existing) {
    res.status(404).json({ detail: "蒐集主題不存在" });
    return;
  }

  const nextState = existing.allowUpload === 1 ? 0 : 1;
  const updated = await prisma.fileCollection.update({
    where: { id },
    data: {
      allowUpload: nextState,
      updatedAt: getNowStrTaipei(),
    },
  });

  broadcastToCourse(existing.courseId, "file_collection_updated");
  res.json({
    id: updated.id,
    allow_upload: updated.allowUpload,
    message: updated.allowUpload === 1 ? "已開啟上傳功能" : "已停止上傳功能",
  });
});

// 5. 刪除整個主題（連同磁碟檔案與所有項目）
fileCollectionsRouter.delete("/:id", async (req, res) => {
  const id = Number(req.params.id);
  const existing = await prisma.fileCollection.findUnique({
    where: { id },
    include: {
      course: true,
      items: true,
    },
  });
  if (!existing) {
    res.status(404).json({ detail: "蒐集主題不存在" });
    return;
  }

  // 刪除磁碟上所有相關檔案
  for (const item of existing.items) {
    safeDeleteUploadedFile(item.fileUrl);
  }

  // 移除項目專屬資料夾 (包含新結構與舊結構)
  try {
    const safeCourseName = sanitizeFolderSegment(
      existing.course?.name || `course_${existing.courseId}`,
      `course_${existing.courseId}`
    );
    const safeTopicTitle = sanitizeFolderSegment(existing.title, `topic_${existing.id}`);

    // 新目錄結構: collections/<safeCourseName>/<safeTopicTitle>
    const newTopicDir = path.join(getUploadsDir(), "collections", safeCourseName, safeTopicTitle);
    if (fs.existsSync(newTopicDir)) {
      fs.rmSync(newTopicDir, { recursive: true, force: true });
    }

    // 若班級資料夾為空，一併清理
    const classDir = path.join(getUploadsDir(), "collections", safeCourseName);
    if (fs.existsSync(classDir) && fs.readdirSync(classDir).length === 0) {
      fs.rmdirSync(classDir);
    }

    // 舊目錄結構兼容清理: collections/<courseId>/<id>
    const legacyDir = path.join(getUploadsDir(), "collections", String(existing.courseId), String(existing.id));
    if (fs.existsSync(legacyDir)) {
      fs.rmSync(legacyDir, { recursive: true, force: true });
    }
  } catch (e) {
    console.error("[FileCollections] Error removing collection directory:", e);
  }

  await prisma.fileCollection.delete({ where: { id } });

  broadcastToCourse(existing.courseId, "file_collection_updated");
  res.json({ message: "蒐集主題已成功刪除" });
});

// 6. 取得主題下所有學生上傳檔案（含學生座號、姓名，供預覽檢視）
fileCollectionsRouter.get("/:id/items", async (req, res) => {
  const id = Number(req.params.id);
  const collection = await prisma.fileCollection.findUnique({
    where: { id },
    include: {
      items: {
        include: {
          student: {
            select: {
              id: true,
              studentNumber: true,
              name: true,
              studentCode: true,
              gender: true,
            },
          },
        },
        orderBy: [{ uploadedAt: "desc" }],
      },
    },
  });

  if (!collection) {
    res.status(404).json({ detail: "蒐集主題不存在" });
    return;
  }

  const items = collection.items.map((item) => ({
    id: item.id,
    collection_id: item.collectionId,
    student_id: item.studentId,
    student_number: item.student.studentNumber,
    student_name: item.student.name,
    student_code: item.student.studentCode,
    gender: item.student.gender,
    original_filename: item.originalFilename,
    display_name: item.displayName,
    file_url: item.fileUrl,
    file_size: item.fileSize,
    mime_type: item.mimeType,
    uploaded_at: item.uploadedAt,
    updated_at: item.updatedAt,
  }));

  // 排序：先依學生座號排序，同座號依上傳時間降冪
  items.sort((a, b) => {
    if (a.student_number !== b.student_number) {
      return a.student_number - b.student_number;
    }
    return (b.uploaded_at || "").localeCompare(a.uploaded_at || "");
  });

  res.json({
    collection: {
      id: collection.id,
      course_id: collection.courseId,
      title: collection.title,
      description: collection.description,
      allowed_extensions: collection.allowedExtensions,
      allow_upload: collection.allowUpload,
      created_at: collection.createdAt,
    },
    items,
  });
});

// 7. 教師刪除單一檔案
fileCollectionsRouter.delete("/:id/items/:itemId", async (req, res) => {
  const id = Number(req.params.id);
  const itemId = Number(req.params.itemId);

  const item = await prisma.fileCollectionItem.findFirst({
    where: { id: itemId, collectionId: id },
    include: { collection: true },
  });

  if (!item) {
    res.status(404).json({ detail: "找不到該檔案" });
    return;
  }

  safeDeleteUploadedFile(item.fileUrl);

  // 若學生資料夾已無其他檔案，清理空資料夾
  try {
    const rel = item.fileUrl.replace(/^\/uploads\//, "");
    const studentDir = path.dirname(path.join(getUploadsDir(), rel));
    if (fs.existsSync(studentDir) && fs.readdirSync(studentDir).length === 0) {
      fs.rmdirSync(studentDir);
    }
  } catch {}

  await prisma.fileCollectionItem.delete({ where: { id: itemId } });

  broadcastToCourse(item.collection.courseId, "file_collection_updated");
  res.json({ message: "檔案已刪除" });
});

// 8. 打包下載該主題下所有學生檔案為 ZIP (維持「學生班級-座號(2碼)/檔名」結構)
fileCollectionsRouter.get("/:id/download_zip", async (req, res) => {
  const id = Number(req.params.id);
  const collection = await prisma.fileCollection.findUnique({
    where: { id },
    include: {
      course: true,
      items: {
        include: {
          student: true,
        },
      },
    },
  });

  if (!collection) {
    res.status(404).json({ detail: "蒐集主題不存在" });
    return;
  }

  if (collection.items.length === 0) {
    res.status(400).json({ detail: "目前尚無學生上傳檔案，無法打包下載。" });
    return;
  }

  // 建立暫存目錄，依據「學生班級-座號(2碼)/檔名」組織學生檔案
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "myclass-zip-"));
  const stagingDir = path.join(tempDir, "files");
  fs.mkdirSync(stagingDir, { recursive: true });

  const zipPath = path.join(tempDir, "archive.zip");

  try {
    const safeCourseName = sanitizeFolderSegment(
      collection.course?.name || `course_${collection.courseId}`,
      `course_${collection.courseId}`
    );
    const usedNamesByFolder = new Map<string, Set<string>>();
    let totalAdded = 0;

    for (const item of collection.items) {
      const rel = item.fileUrl.replace(/^\/uploads\//, "");
      const srcPath = path.join(getUploadsDir(), rel);
      if (!fs.existsSync(srcPath)) continue;

      const padSeatNo = String(item.student.studentNumber).padStart(2, "0");
      const studentFolder = `${safeCourseName}-${padSeatNo}`;
      const studentTargetDir = path.join(stagingDir, studentFolder);
      if (!fs.existsSync(studentTargetDir)) {
        fs.mkdirSync(studentTargetDir, { recursive: true });
      }

      if (!usedNamesByFolder.has(studentFolder)) {
        usedNamesByFolder.set(studentFolder, new Set<string>());
      }
      const folderUsedNames = usedNamesByFolder.get(studentFolder)!;

      const ext = path.extname(srcPath);
      const rawDisplay = item.displayName || item.originalFilename || "file";
      const cleanDisplay = rawDisplay.replace(/[\\/*?:"<>|]/g, "_").trim() || "file";
      const baseName = ext && cleanDisplay.toLowerCase().endsWith(ext.toLowerCase())
        ? cleanDisplay
        : `${cleanDisplay}${ext}`;

      let stagedFilename = baseName;
      let counter = 1;
      while (folderUsedNames.has(stagedFilename)) {
        const withoutExt = path.basename(stagedFilename, ext);
        stagedFilename = `${withoutExt}_(${counter})${ext}`;
        counter++;
      }
      folderUsedNames.add(stagedFilename);

      fs.copyFileSync(srcPath, path.join(studentTargetDir, stagedFilename));
      totalAdded++;
    }

    if (totalAdded === 0) {
      res.status(400).json({ detail: "未找到有效的實體檔案供打包" });
      return;
    }

    // 透過系統內建 tar.exe 壓縮為標準 ZIP 檔案
    await execFileAsync("tar.exe", ["-a", "-c", "-f", zipPath, "*"], {
      cwd: stagingDir,
      windowsHide: true,
    });

    const downloadFilename = `${collection.course.name}_${collection.title}_成果檔案.zip`.replace(/[\\/*?:"<>|]/g, "_");
    res.setHeader("Content-Disposition", `attachment; filename*=UTF-8''${encodeURIComponent(downloadFilename)}`);
    res.setHeader("Content-Type", "application/zip");

    const stream = fs.createReadStream(zipPath);
    stream.pipe(res);
    stream.on("close", () => {
      // 清理暫存資料夾
      try {
        fs.rmSync(tempDir, { recursive: true, force: true });
      } catch {}
    });
  } catch (err) {
    try {
      fs.rmSync(tempDir, { recursive: true, force: true });
    } catch {}
    console.error("[FileCollections] Zip generation failed:", err);
    res.status(500).json({ detail: "打包下載失敗，請直接在介面中個別下載檔案。" });
  }
});
