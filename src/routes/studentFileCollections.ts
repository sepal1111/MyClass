// Student-facing file collections (uploading, listing, renaming, deleting).
// Strictly scoped to req.studentAuth.courseId and req.studentAuth.studentId.
// Enforces hard lock on upload, rename, and delete when allow_upload === 0.
import fs from "fs";
import path from "path";
import { Router, Request, Response, NextFunction } from "express";
import multer from "multer";
import { prisma } from "../db";
import { autoCatch } from "../asyncRoute";
import { requireStudentAuth } from "../middleware/studentAuth";
import { getNowStrTaipei } from "../timezone";
import { getUploadsDir } from "../paths";
import { fixUploadFilename, sanitizeFolderSegment } from "../utils/upload";
import { broadcastToCourse } from "../realtime";

export const studentFileCollectionsRouter = autoCatch(Router());
studentFileCollectionsRouter.use(requireStudentAuth);

function safeDeleteUploadedFile(fileUrl: string): void {
  try {
    const rel = fileUrl.replace(/^\/uploads\//, "");
    const fullPath = path.join(getUploadsDir(), rel);
    if (fs.existsSync(fullPath) && fs.statSync(fullPath).isFile()) {
      fs.unlinkSync(fullPath);
    }
  } catch (err) {
    console.error("[StudentFileCollections] Failed to delete file:", fileUrl, err);
  }
}

// 1. 取得學生所在班級的所有檔案蒐集主題與自己上傳的檔案
studentFileCollectionsRouter.get("/", async (req, res) => {
  const { courseId, studentId } = req.studentAuth!;

  const collections = await prisma.fileCollection.findMany({
    where: { courseId },
    orderBy: [{ orderIndex: "asc" }, { id: "desc" }],
    include: {
      items: {
        where: { studentId },
        orderBy: [{ uploadedAt: "desc" }],
      },
    },
  });

  const response = collections.map((c) => ({
    id: c.id,
    title: c.title,
    description: c.description,
    allowed_extensions: c.allowedExtensions,
    allow_upload: c.allowUpload,
    created_at: c.createdAt,
    my_files: c.items.map((item) => ({
      id: item.id,
      original_filename: item.originalFilename,
      display_name: item.displayName,
      file_url: item.fileUrl,
      file_size: item.fileSize,
      mime_type: item.mimeType,
      uploaded_at: item.uploadedAt,
      updated_at: item.updatedAt,
    })),
  }));

  res.json(response);
});

// Multer 磁碟存儲配置：依據 班級名稱\蒐集項目名稱\學生班級-座號(2碼)\ 資料夾結構儲存
const diskStorage = multer.diskStorage({
  destination: (req, _file, cb) => {
    const meta = (req as unknown as { uploadMeta?: { targetDir: string } }).uploadMeta;
    if (meta && meta.targetDir) {
      cb(null, meta.targetDir);
    } else {
      const fallback = path.join(getUploadsDir(), "collections", "temp");
      fs.mkdirSync(fallback, { recursive: true });
      cb(null, fallback);
    }
  },
  filename: (req, file, cb) => {
    const meta = (req as unknown as { uploadMeta?: { targetDir: string } }).uploadMeta;
    const originalName = fixUploadFilename(file.originalname);
    const ext = path.extname(originalName);
    const base = path.basename(originalName, ext).replace(/[\\/*?:"<>|]/g, "_").trim() || "file";

    let finalName = `${base}${ext}`;
    if (meta?.targetDir) {
      let counter = 1;
      while (fs.existsSync(path.join(meta.targetDir, finalName))) {
        finalName = `${base}_(${counter})${ext}`;
        counter++;
      }
    }
    cb(null, finalName);
  },
});

const upload = multer({
  storage: diskStorage,
  limits: { fileSize: 250 * 1024 * 1024 }, // 250MB per file
});

// 2. 檔案上傳前置防護中介軟體：先驗證該主題是否存在、是否允許上傳，並計算目標目錄路徑
async function guardAllowUpload(req: Request, res: Response, next: NextFunction): Promise<void> {
  const { courseId, studentId } = req.studentAuth!;
  const collectionId = Number(req.params.collectionId);

  const collection = await prisma.fileCollection.findFirst({
    where: { id: collectionId, courseId },
    include: { course: true },
  });

  if (!collection) {
    res.status(404).json({ detail: "蒐集主題不存在" });
    return;
  }

  // 關鍵防護：若教師已停止上傳，在 Multer 寫入任何位元組前立即攔截拒絕
  if (!collection.allowUpload) {
    res.status(400).json({ detail: "教師目前已停止上傳，無法繳交檔案。" });
    return;
  }

  const student = await prisma.student.findUnique({
    where: { id: studentId },
    select: { studentNumber: true, name: true },
  });

  const seatNo = student?.studentNumber ?? 1;
  const padSeatNo = String(seatNo).padStart(2, "0");

  // 依規格：bin\uploads\collections\班級名稱\蒐集項目名稱\學生班級-座號(2碼)\
  const safeCourseName = sanitizeFolderSegment(collection.course.name, `course_${courseId}`);
  const safeTopicTitle = sanitizeFolderSegment(collection.title, `topic_${collectionId}`);
  const safeStudentFolder = `${safeCourseName}-${padSeatNo}`;

  const targetDir = path.join(getUploadsDir(), "collections", safeCourseName, safeTopicTitle, safeStudentFolder);
  fs.mkdirSync(targetDir, { recursive: true });

  (req as unknown as {
    loadedCollection: typeof collection;
    uploadMeta: {
      safeCourseName: string;
      safeTopicTitle: string;
      safeStudentFolder: string;
      targetDir: string;
    };
  }).loadedCollection = collection;

  (req as unknown as {
    uploadMeta: {
      safeCourseName: string;
      safeTopicTitle: string;
      safeStudentFolder: string;
      targetDir: string;
    };
  }).uploadMeta = {
    safeCourseName,
    safeTopicTitle,
    safeStudentFolder,
    targetDir,
  };

  next();
}

// 2. 學生上傳檔案 (支援單次上傳多個檔案，上限 10 個)
studentFileCollectionsRouter.post(
  "/:collectionId/upload",
  guardAllowUpload,
  upload.array("files", 10),
  async (req, res) => {
    const { courseId, studentId } = req.studentAuth!;
    const collectionId = Number(req.params.collectionId);
    const collection = (req as unknown as { loadedCollection?: { allowedExtensions: string | null } }).loadedCollection;
    const meta = (req as unknown as {
      uploadMeta: {
        safeCourseName: string;
        safeTopicTitle: string;
        safeStudentFolder: string;
        targetDir: string;
      };
    }).uploadMeta;

    const files = (req.files as Express.Multer.File[] | undefined) ?? [];
    if (!files.length) {
      res.status(400).json({ detail: "請選擇要上傳的檔案" });
      return;
    }

    // 若主題有設定允許副檔名，檢查副檔名
    if (collection?.allowedExtensions) {
      const allowedList = collection.allowedExtensions
        .split(",")
        .map((ext) => ext.trim().toLowerCase().replace(/^\./, ""))
        .filter(Boolean);

      if (allowedList.length > 0) {
        for (const file of files) {
          const originalName = fixUploadFilename(file.originalname);
          const ext = path.extname(originalName).toLowerCase().replace(/^\./, "");
          if (!allowedList.includes(ext)) {
            // 清理已寫入磁碟的檔案
            for (const f of files) {
              if (fs.existsSync(f.path)) fs.unlinkSync(f.path);
            }
            res.status(400).json({
              detail: `檔案「${originalName}」格式不符合規定。僅接受副檔名：${allowedList.join(", ")}`,
            });
            return;
          }
        }
      }
    }

    const now = getNowStrTaipei();
    const createdRecords = [];

    for (const file of files) {
      const originalName = fixUploadFilename(file.originalname);
      const fileUrl = `/uploads/collections/${meta.safeCourseName}/${meta.safeTopicTitle}/${meta.safeStudentFolder}/${file.filename}`;

      const item = await prisma.fileCollectionItem.create({
        data: {
          collectionId,
          studentId,
          courseId,
          originalFilename: originalName,
          displayName: originalName,
          fileUrl,
          fileSize: file.size,
          mimeType: file.mimetype || null,
          uploadedAt: now,
          updatedAt: now,
        },
      });
      createdRecords.push(item);
    }

    broadcastToCourse(courseId, "file_collection_updated");
    res.status(201).json({
      message: `成功上傳 ${createdRecords.length} 個檔案`,
      files: createdRecords,
    });
  }
);

// 3. 學生重新命名檔案（同步更新磁碟實體檔名與資料庫紀錄）
studentFileCollectionsRouter.put("/:collectionId/items/:itemId/rename", async (req, res) => {
  const { courseId, studentId } = req.studentAuth!;
  const collectionId = Number(req.params.collectionId);
  const itemId = Number(req.params.itemId);

  const collection = await prisma.fileCollection.findFirst({
    where: { id: collectionId, courseId },
  });
  if (!collection) {
    res.status(404).json({ detail: "蒐集主題不存在" });
    return;
  }

  // 關鍵防護：當教師停止上傳時，學生不得進行重新命名
  if (!collection.allowUpload) {
    res.status(400).json({ detail: "教師已停止上傳，不得進行重新命名與修改。" });
    return;
  }

  const item = await prisma.fileCollectionItem.findFirst({
    where: { id: itemId, collectionId, studentId },
  });
  if (!item) {
    res.status(404).json({ detail: "找不到該檔案或無修改權限" });
    return;
  }

  let newName = typeof req.body?.display_name === "string" ? req.body.display_name.trim() : "";
  if (!newName) {
    res.status(400).json({ detail: "檔案名稱不能為空" });
    return;
  }

  // 保留原有副檔名（若使用者未輸入副檔名）
  const origExt = path.extname(item.originalFilename);
  if (origExt && !newName.toLowerCase().endsWith(origExt.toLowerCase())) {
    newName = `${newName}${origExt}`;
  }

  // 同步重新命名磁碟上的實體檔案
  let newFileUrl = item.fileUrl;
  try {
    const oldRel = item.fileUrl.replace(/^\/uploads\//, "");
    const oldFullPath = path.join(getUploadsDir(), oldRel);
    if (fs.existsSync(oldFullPath)) {
      const dir = path.dirname(oldFullPath);
      const safeNewBase = path.basename(newName, origExt).replace(/[\\/*?:"<>|]/g, "_").trim();
      let diskFilename = `${safeNewBase}${origExt}`;
      let counter = 1;
      while (fs.existsSync(path.join(dir, diskFilename)) && path.join(dir, diskFilename) !== oldFullPath) {
        diskFilename = `${safeNewBase}_(${counter})${origExt}`;
        counter++;
      }
      const newFullPath = path.join(dir, diskFilename);
      fs.renameSync(oldFullPath, newFullPath);

      const urlDir = path.dirname(item.fileUrl).replace(/\\/g, "/");
      newFileUrl = `${urlDir}/${diskFilename}`;
    }
  } catch (err) {
    console.error("[StudentFileCollections] Rename on disk failed:", err);
  }

  const updated = await prisma.fileCollectionItem.update({
    where: { id: itemId },
    data: {
      displayName: newName,
      fileUrl: newFileUrl,
      updatedAt: getNowStrTaipei(),
    },
  });

  broadcastToCourse(courseId, "file_collection_updated");
  res.json({
    message: "檔案名稱已更新",
    item: updated,
  });
});

// 4. 學生刪除自己上傳的檔案
studentFileCollectionsRouter.delete("/:collectionId/items/:itemId", async (req, res) => {
  const { courseId, studentId } = req.studentAuth!;
  const collectionId = Number(req.params.collectionId);
  const itemId = Number(req.params.itemId);

  const collection = await prisma.fileCollection.findFirst({
    where: { id: collectionId, courseId },
  });
  if (!collection) {
    res.status(404).json({ detail: "蒐集主題不存在" });
    return;
  }

  // 關鍵防護：當教師停止上傳時，學生不得刪除檔案
  if (!collection.allowUpload) {
    res.status(400).json({ detail: "教師已停止上傳，不得刪除檔案。" });
    return;
  }

  const item = await prisma.fileCollectionItem.findFirst({
    where: { id: itemId, collectionId, studentId },
  });
  if (!item) {
    res.status(404).json({ detail: "找不到該檔案或無刪除權限" });
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

  broadcastToCourse(courseId, "file_collection_updated");
  res.json({ message: "檔案已刪除" });
});

