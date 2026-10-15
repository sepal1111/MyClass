import { isAccountTaken } from "../utils/studentAccount";
import fs from "fs";
import path from "path";
import { Router } from "express";
import multer from "multer";
import ExcelJS from "exceljs";
import { prisma } from "../db";
import { getBinDir } from "../paths";
import { parseTextImport } from "../utils/textImport";
import { parseCsvStudents, parseXlsxStudents } from "../utils/fileImport";
import { autoCatch } from "../asyncRoute";
import { defaultStudentAccount, defaultStudentPassword, hashPassword } from "../utils/studentPassword";
import crypto from "crypto";
import { getTodayMMDDTaipei } from "../timezone";
import { fixUploadFilename } from "../utils/upload";

export const coursesRouter = autoCatch(Router());
const photoDir = path.join(getBinDir(), "photo");
const upload = multer({ storage: multer.memoryStorage() });
const MAX_PHOTO_BYTES = 5 * 1024 * 1024;
const photoUpload = multer({ storage: multer.memoryStorage(), limits: { fileSize: MAX_PHOTO_BYTES, files: 200 } });

/** 學號會直接成為 bin/photo 下的檔名，不允許路徑字元。 */
const isSafePhotoCode = (code: string | null | undefined): code is string =>
  Boolean(code) && !/[\\/:*?"<>|]/.test(code as string) && !(code as string).includes("..");
const isJpeg = (buf: Buffer) => buf.length > 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff;
const photoPath = (code: string) => path.join(photoDir, `${code}.jpg`);
// 覆蓋或移除照片前，把舊照片留一份在 bin/photo/_backup/<學號>.jpg（每個學號只留最近一次，可在編輯視窗還原）
const backupDir = path.join(photoDir, "_backup");
const backupPath = (code: string) => path.join(backupDir, `${code}.jpg`);
function backupPhoto(code: string): void {
  if (!fs.existsSync(photoPath(code))) return;
  fs.mkdirSync(backupDir, { recursive: true });
  fs.copyFileSync(photoPath(code), backupPath(code));
}
const stripExt = (name: string) => name.replace(/\.[^.]+$/, "").trim();

// login_account is unique system-wide (see prisma schema comment). The deterministic
// default is already collision-free by construction (course_id + student_number is a
// natural key), so a collision only happens if a teacher manually claimed that exact
// string for a different student — rare, handled defensively rather than left to crash.
async function generateUniqueAccount(courseId: number, studentNumber: number): Promise<string> {
  const base = defaultStudentAccount(courseId, studentNumber);
  if (!(await isAccountTaken(base))) return base;
  return `${base}-${crypto.randomBytes(2).toString("hex")}`;
}

/** Uses an explicit account from an import row/payload if given (e.g. the CSV/Excel
 *  template's 帳號 column), otherwise falls back to the deterministic auto-generated one. */
async function resolveImportedAccount(
  explicit: string | null | undefined,
  courseId: number,
  studentNumber: number
): Promise<string> {
  const trimmed = explicit?.trim();
  if (!trimmed) return generateUniqueAccount(courseId, studentNumber);
  return (await isAccountTaken(trimmed)) ? generateUniqueAccount(courseId, studentNumber) : trimmed;
}

/** Uses an explicit password from an import row/payload if given (e.g. the CSV/Excel
 *  template's 密碼 column), otherwise falls back to the default (學號；沒有學號則座號四碼). */
function resolveImportedPassword(
  explicit: string | null | undefined,
  studentNumber: number,
  studentCode?: string | null
): string {
  return explicit?.trim() || defaultStudentPassword(studentNumber, studentCode);
}

const DEFAULT_RULES = [
  { title: "熱心助人", category: "positive", score_value: 1, icon: "🤝" },
  { title: "發言踴躍", category: "positive", score_value: 1, icon: "🙋‍♂️" },
  { title: "專心聽講", category: "positive", score_value: 1, icon: "👂" },
  { title: "作業優良", category: "positive", score_value: 2, icon: "📝" },
  { title: "團隊合作", category: "positive", score_value: 1, icon: "🌟" },
  { title: "上課吵鬧", category: "negative", score_value: -1, icon: "📢" },
  { title: "未帶用品", category: "negative", score_value: -1, icon: "🎒" },
  { title: "上課分心", category: "negative", score_value: -1, icon: "😴" },
];

coursesRouter.get("", async (_req, res) => {
  const courses = await prisma.course.findMany({ orderBy: { id: "desc" } });
  const withCounts = await Promise.all(
    courses.map(async (c) => ({
      ...c,
      student_count: await prisma.student.count({ where: { courseId: c.id, isActive: 1 } }),
    }))
  );
  res.json(withCounts);
});

coursesRouter.post("", async (req, res) => {
  const { name, teacher_type = "homeroom", description = null } = req.body ?? {};
  const course = await prisma.course.create({ data: { name, teacherType: teacher_type, description } });
  await prisma.evaluationRule.createMany({
    data: DEFAULT_RULES.map((r) => ({
      courseId: course.id,
      title: r.title,
      category: r.category,
      scoreValue: r.score_value,
      icon: r.icon,
      isDefault: 1,
    })),
  });
  res.json({ id: course.id, message: "Course created with default evaluation rules" });
});

coursesRouter.get("/:courseId", async (req, res) => {
  const course = await prisma.course.findUnique({ where: { id: Number(req.params.courseId) } });
  if (!course) {
    res.status(404).json({ detail: "Course not found" });
    return;
  }
  res.json(course);
});

coursesRouter.delete("/:courseId", async (req, res) => {
  const courseId = Number(req.params.courseId);
  const course = await prisma.course.findUnique({ where: { id: courseId } });
  if (!course) {
    res.status(404).json({ detail: "找不到該班級，可能已被刪除" });
    return;
  }

  const password = String(req.body?.password ?? req.query?.password ?? "");
  const settingRow = await prisma.systemSetting.findUnique({ where: { key: "password_prefix" } });
  const prefix = settingRow?.value || "Admin";
  const todayMmdd = getTodayMMDDTaipei();
  const expected = `${prefix}${todayMmdd}`;

  if (!password || password.trim() !== expected) {
    res.status(400).json({ detail: "系統密碼錯誤，無法刪除班級！" });
    return;
  }

  await prisma.$executeRawUnsafe("PRAGMA foreign_keys = ON;");
  await prisma.course.delete({ where: { id: courseId } });
  res.json({ success: true, message: `班級「${course.name}」已成功刪除！` });
});

// --- Evaluation Rules ---

coursesRouter.get("/:courseId/rules", async (req, res) => {
  const rules = await prisma.evaluationRule.findMany({
    where: { courseId: Number(req.params.courseId) },
    orderBy: [{ category: "desc" }, { id: "asc" }],
  });
  res.json(rules);
});

coursesRouter.post("/:courseId/rules", async (req, res) => {
  const courseId = Number(req.params.courseId);
  const { title, category = "positive", score_value, icon = "⭐" } = req.body ?? {};
  const rule = await prisma.evaluationRule.create({
    data: { courseId, title, category, scoreValue: score_value, icon },
  });
  res.json({ id: rule.id, message: "Rule created" });
});

coursesRouter.put("/:courseId/rules/:ruleId", async (req, res) => {
  const courseId = Number(req.params.courseId);
  const ruleId = Number(req.params.ruleId);
  const { title, category, score_value, icon } = req.body ?? {};
  await prisma.evaluationRule.updateMany({
    where: { id: ruleId, courseId },
    data: { title, category, scoreValue: score_value, icon },
  });
  res.json({ message: "Rule updated" });
});

coursesRouter.delete("/:courseId/rules/:ruleId", async (req, res) => {
  await prisma.evaluationRule.deleteMany({
    where: { id: Number(req.params.ruleId), courseId: Number(req.params.courseId) },
  });
  res.json({ message: "Rule deleted" });
});

coursesRouter.post("/:courseId/rules/reset_defaults", async (req, res) => {
  const courseId = Number(req.params.courseId);
  await prisma.evaluationRule.deleteMany({ where: { courseId } });
  await prisma.evaluationRule.createMany({
    data: DEFAULT_RULES.map((r) => ({
      courseId,
      title: r.title,
      category: r.category,
      scoreValue: r.score_value,
      icon: r.icon,
    })),
  });
  res.json({ message: "Default rules restored" });
});

// --- 學生管理 ---

coursesRouter.get("/:courseId/students", async (req, res) => {
  const courseId = Number(req.params.courseId);
  const students = await prisma.student.findMany({
    where: { courseId, isActive: 1 },
    orderBy: { studentNumber: "asc" },
    include: { group: { select: { groupName: true } } },
  });
  res.json(
    students.map((s) => ({
      id: s.id,
      student_number: s.studentNumber,
      student_code: s.studentCode,
      login_account: s.loginAccount,
      // 學生是否已自己設定過密碼（false＝仍是預設／老師重設後尚未自行修改）
      password_changed: s.mustChangePassword === 0,
      has_password_hint: Boolean(s.pwHintMain),
      name: s.name,
      english_name: s.englishName,
      gender: s.gender,
      group_id: s.groupId,
      group_name: s.group?.groupName ?? null,
      seat_row: s.seatRow,
      seat_col: s.seatCol,
      has_photo: Boolean(s.studentCode && fs.existsSync(path.join(photoDir, `${s.studentCode}.jpg`))),
      has_photo_backup: Boolean(isSafePhotoCode(s.studentCode) && fs.existsSync(backupPath(s.studentCode))),
    }))
  );
});

coursesRouter.post("/:courseId/students", async (req, res) => {
  const courseId = Number(req.params.courseId);
  const { student_number, name, english_name = null, gender = "M", group_id = null, student_code = null, login_account = null, password = null } =
    req.body ?? {};

  const loginAccount: string = (login_account as string | null)?.trim() || "";
  if (!loginAccount) {
    res.status(400).json({ detail: "請輸入學生登入帳號" });
    return;
  }
  if (await isAccountTaken(loginAccount)) {
    res.status(400).json({ detail: "此帳號已被使用（帳號不分大小寫），請換一個" });
    return;
  }

  const student = await prisma.student.create({
    data: {
      courseId,
      studentNumber: student_number,
      name,
      englishName: english_name,
      gender,
      groupId: group_id,
      studentCode: student_code,
      loginAccount,
      passwordHash: hashPassword(
        (password as string | null)?.trim() || defaultStudentPassword(student_number, student_code as string | null)
      ),
    },
  });
  res.json({ id: student.id, login_account: loginAccount, message: "Student created" });
});

coursesRouter.post("/:courseId/students/batch", async (req, res) => {
  const courseId = Number(req.params.courseId);
  const students: Array<{
    student_number: number;
    name: string;
    english_name?: string | null;
    gender?: string | null;
    student_code?: string | null;
    login_account?: string | null;
    password?: string | null;
  }> = req.body?.students ?? [];

  let count = 0;
  for (const item of students) {
    let gender = (item.gender || "M").toUpperCase();
    if (gender !== "M" && gender !== "F") gender = "M";
    await prisma.student.create({
      data: {
        courseId,
        studentNumber: item.student_number,
        name: item.name,
        englishName: item.english_name ?? null,
        gender,
        studentCode: item.student_code ?? null,
        loginAccount: await resolveImportedAccount(item.login_account, courseId, item.student_number),
        passwordHash: hashPassword(resolveImportedPassword(item.password, item.student_number, item.student_code)),
      },
    });
    count++;
  }
  res.json({ imported_count: count, message: `Successfully imported ${count} students` });
});

coursesRouter.post("/:courseId/students/text_import", async (req, res) => {
  const courseId = Number(req.params.courseId);
  const textContent: string = req.body?.text_content ?? "";
  const parsed = parseTextImport(textContent);

  let count = 0;
  for (const s of parsed) {
    await prisma.student.create({
      data: {
        courseId,
        studentNumber: s.student_number,
        studentCode: s.student_code,
        name: s.name,
        englishName: s.english_name,
        gender: s.gender,
        loginAccount: await resolveImportedAccount(s.login_account, courseId, s.student_number),
        passwordHash: hashPassword(resolveImportedPassword(s.password, s.student_number, s.student_code)),
      },
    });
    count++;
  }
  res.json({ imported_count: count, message: `Successfully imported ${count} students` });
});

coursesRouter.post("/:courseId/students/upload", upload.single("file"), async (req, res) => {
  const courseId = Number(req.params.courseId);
  const file = req.file;
  if (!file) {
    res.status(400).json({ detail: "Only .csv and .xlsx/.xls files are supported" });
    return;
  }
  const filename = file.originalname.toLowerCase();

  let parsed;
  if (filename.endsWith(".csv")) {
    parsed = parseCsvStudents(file.buffer.toString("utf-8"));
  } else if (filename.endsWith(".xlsx") || filename.endsWith(".xls")) {
    parsed = await parseXlsxStudents(file.buffer);
  } else {
    res.status(400).json({ detail: "Only .csv and .xlsx/.xls files are supported" });
    return;
  }

  let count = 0;
  for (const s of parsed) {
    await prisma.student.create({
      data: {
        courseId,
        studentNumber: s.student_number,
        studentCode: s.student_code,
        name: s.name,
        englishName: s.english_name,
        gender: s.gender,
        loginAccount: await resolveImportedAccount(s.login_account, courseId, s.student_number),
        passwordHash: hashPassword(resolveImportedPassword(s.password, s.student_number, s.student_code)),
      },
    });
    count++;
  }
  res.json({ imported_count: count, message: `Successfully imported ${count} students` });
});

coursesRouter.put("/:courseId/students/:studentId", async (req, res) => {
  const courseId = Number(req.params.courseId);
  const studentId = Number(req.params.studentId);
  const student = await prisma.student.findFirst({ where: { id: studentId, courseId } });
  if (!student) {
    res.status(404).json({ detail: "Student not found" });
    return;
  }
  const { student_number, student_code, name, english_name, gender, login_account } = req.body ?? {};

  let loginAccount = student.loginAccount;
  if (typeof login_account === "string") {
    const trimmed = login_account.trim();
    if (!trimmed) {
      res.status(400).json({ detail: "帳號不可留空" });
      return;
    }
    if (trimmed !== student.loginAccount) {
      if (await isAccountTaken(trimmed, studentId)) {
        res.status(400).json({ detail: "此帳號已被使用（帳號不分大小寫），請換一個" });
        return;
      }
      loginAccount = trimmed;
    }
  }

  await prisma.student.update({
    where: { id: studentId },
    data: {
      studentNumber: student_number ?? student.studentNumber,
      studentCode: student_code ?? student.studentCode,
      name: name ?? student.name,
      englishName: english_name ?? student.englishName,
      gender: gender ?? student.gender,
      loginAccount,
    },
  });
  res.json({ message: "Student updated successfully" });
});

// --- 學生照片（bin/photo/<學號>.jpg）：網頁上傳 / 更換 / 移除 ---
// 前端會先把圖片轉成 JPEG（見 app.js prepareStudentPhoto），這裡只收 JPEG。

// 批次匯入前預覽：只送檔名，回報每個檔案會「新增」「覆蓋現有照片」或「找不到學號」
coursesRouter.post("/:courseId/students/photos/preview", async (req, res) => {
  const courseId = Number(req.params.courseId);
  const names: unknown[] = Array.isArray(req.body?.names) ? req.body.names : [];
  const students = await prisma.student.findMany({
    where: { courseId, isActive: 1 },
    select: { studentCode: true, name: true, studentNumber: true, gender: true },
  });
  const byCode = new Map(students.filter((s) => s.studentCode).map((s) => [s.studentCode as string, s]));
  const items = names.map((n) => {
    const name = String(n ?? "");
    const code = stripExt(name);
    const stu = isSafePhotoCode(code) ? byCode.get(code) : undefined;
    if (!stu) return { name, code, status: "unmatched" as const };
    return {
      name,
      code,
      status: fs.existsSync(photoPath(code)) ? ("overwrite" as const) : ("new" as const),
      student_name: stu.name,
      student_number: stu.studentNumber,
      gender: stu.gender,
    };
  });
  res.json({ items });
});

// 批次匯入：檔名（不含副檔名）＝學號；同批出現相同學號時只採用最後一張。回報成功、略過的檔案
coursesRouter.post("/:courseId/students/photos", photoUpload.array("files", 200), async (req, res) => {
  const courseId = Number(req.params.courseId);
  const files = (req.files as Express.Multer.File[] | undefined) ?? [];
  if (!files.length) {
    res.status(400).json({ detail: "請選擇照片檔案" });
    return;
  }
  const students = await prisma.student.findMany({ where: { courseId, isActive: 1 }, select: { studentCode: true } });
  const codes = new Set(students.map((s) => s.studentCode).filter(Boolean) as string[]);
  fs.mkdirSync(photoDir, { recursive: true });
  const saved: string[] = [];
  const skipped: { name: string; reason: string }[] = [];
  const names = files.map((f) => fixUploadFilename(f.originalname));
  const lastIndexOf = new Map<string, number>();
  names.forEach((n, i) => lastIndexOf.set(stripExt(n), i));
  files.forEach((f, i) => {
    const name = names[i];
    const code = stripExt(name);
    if (!isJpeg(f.buffer)) skipped.push({ name, reason: "不是有效的圖片" });
    else if (!isSafePhotoCode(code) || !codes.has(code)) skipped.push({ name, reason: "找不到對應學號的學生" });
    else if (lastIndexOf.get(code) !== i) skipped.push({ name, reason: "同批有相同學號，已採用後面的檔案" });
    else {
      backupPhoto(code);
      fs.writeFileSync(photoPath(code), f.buffer);
      saved.push(code);
    }
  });
  res.json({ saved_count: saved.length, saved, skipped });
});

coursesRouter.put("/:courseId/students/:studentId/photo", photoUpload.single("file"), async (req, res) => {
  const student = await prisma.student.findFirst({
    where: { id: Number(req.params.studentId), courseId: Number(req.params.courseId) },
  });
  if (!student) {
    res.status(404).json({ detail: "Student not found" });
    return;
  }
  if (!isSafePhotoCode(student.studentCode)) {
    res.status(400).json({ detail: "請先為這位學生設定學號（照片以學號為檔名）" });
    return;
  }
  if (!req.file || !isJpeg(req.file.buffer)) {
    res.status(400).json({ detail: "不是有效的圖片檔" });
    return;
  }
  fs.mkdirSync(photoDir, { recursive: true });
  backupPhoto(student.studentCode);
  fs.writeFileSync(photoPath(student.studentCode), req.file.buffer);
  res.json({ message: "照片已更新" });
});

coursesRouter.delete("/:courseId/students/:studentId/photo", async (req, res) => {
  const student = await prisma.student.findFirst({
    where: { id: Number(req.params.studentId), courseId: Number(req.params.courseId) },
  });
  if (!student) {
    res.status(404).json({ detail: "Student not found" });
    return;
  }
  if (isSafePhotoCode(student.studentCode) && fs.existsSync(photoPath(student.studentCode))) {
    backupPhoto(student.studentCode);
    fs.unlinkSync(photoPath(student.studentCode));
  }
  res.json({ message: "照片已移除" });
});

// 還原上一張照片：與目前照片對調（目前的變成「上一張」，可再還原回來）
coursesRouter.post("/:courseId/students/:studentId/photo/restore", async (req, res) => {
  const student = await prisma.student.findFirst({
    where: { id: Number(req.params.studentId), courseId: Number(req.params.courseId) },
  });
  if (!student || !isSafePhotoCode(student.studentCode)) {
    res.status(404).json({ detail: "Student not found" });
    return;
  }
  const code = student.studentCode;
  if (!fs.existsSync(backupPath(code))) {
    res.status(404).json({ detail: "沒有可還原的上一張照片" });
    return;
  }
  const previous = fs.readFileSync(backupPath(code));
  backupPhoto(code);
  fs.writeFileSync(photoPath(code), previous);
  res.json({ message: "已還原上一張照片" });
});

coursesRouter.delete("/:courseId/students/:studentId", async (req, res) => {
  await prisma.student.deleteMany({
    where: { id: Number(req.params.studentId), courseId: Number(req.params.courseId) },
  });
  res.json({ message: "Student deleted" });
});

// --- LMS 學生登入帳密管理（教師端；學生本人登入見 src/routes/studentAuth.ts）---

coursesRouter.put("/:courseId/students/:studentId/password", async (req, res) => {
  const courseId = Number(req.params.courseId);
  const studentId = Number(req.params.studentId);
  const student = await prisma.student.findFirst({ where: { id: studentId, courseId } });
  if (!student) {
    res.status(404).json({ detail: "Student not found" });
    return;
  }

  const customPassword: string | undefined = req.body?.password;
  const effectivePassword = customPassword?.trim()
    ? customPassword.trim()
    : defaultStudentPassword(student.studentNumber, student.studentCode);

  await prisma.student.update({
    where: { id: studentId },
    // 密碼被老師重設／改過，原本學生寫的密碼提醒就不準了，一併清除
    data: {
      passwordHash: hashPassword(effectivePassword),
      mustChangePassword: 1,
      pwHintPrefix: null,
      pwHintMain: null,
      pwHintSuffix: null,
    },
  });
  res.json({
    message: customPassword
      ? "密碼已更新，學生下次登入需自行設定新密碼"
      : student.studentCode?.trim()
        ? "密碼已恢復為預設值（學號），學生下次登入需自行設定新密碼"
        : "密碼已恢復為預設值（此學生未填學號，使用座號四碼），學生下次登入需自行設定新密碼",
    password: effectivePassword,
  });
});

// --- 範本檔案下載 ---

const TEMPLATE_HEADERS = [
  "座號",
  "學號",
  "中文姓名",
  "英文姓名",
  "性別",
  "帳號 (可選，留空由系統自動產生)",
  "密碼 (可選，留空預設為學號；沒有學號則為座號四碼)",
];
const TEMPLATE_SAMPLE: (string | number)[][] = [
  [1, "112001", "王小明", "David", "男", "", ""],
  [2, "112002", "李小華", "Emily", "女", "", ""],
  [3, "112003", "張大同", "Tom", "男", "", ""],
  [4, "112004", "陳雅婷", "Grace", "女", "", ""],
  [5, "112005", "林志豪", "Leo", "男", "", ""],
];

coursesRouter.get("/template/students_excel", async (_req, res) => {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet("學生名冊匯入範例");
  ws.addRow(TEMPLATE_HEADERS);
  for (const row of [
    ...TEMPLATE_SAMPLE,
    [6, "112006", "黃美玲", "May", "女", "", ""],
    [7, "112007", "趙子龍", "Alex", "男", "", ""],
    [8, "112008", "周雅玲", "Chloe", "女", "", ""],
    [9, "112009", "孫悟空", "Sam", "男", "", ""],
    [10, "112010", "吳小雯", "Wendy", "女", "", ""],
  ]) {
    ws.addRow(row);
  }

  ws.columns = [{ width: 12 }, { width: 16 }, { width: 18 }, { width: 18 }, { width: 12 }, { width: 30 }, { width: 30 }];
  const headerRow = ws.getRow(1);
  headerRow.eachCell((cell) => {
    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF2563EB" } };
    cell.font = { name: "Microsoft JhengHei", size: 11, bold: true, color: { argb: "FFFFFFFF" } };
    cell.alignment = { horizontal: "center", vertical: "middle" };
  });
  for (let r = 2; r <= ws.rowCount; r++) {
    ws.getRow(r).eachCell((cell) => {
      cell.font = { name: "Microsoft JhengHei", size: 10 };
      cell.alignment = { horizontal: "center", vertical: "middle" };
      cell.border = {
        top: { style: "thin", color: { argb: "FFCBD5E1" } },
        left: { style: "thin", color: { argb: "FFCBD5E1" } },
        bottom: { style: "thin", color: { argb: "FFCBD5E1" } },
        right: { style: "thin", color: { argb: "FFCBD5E1" } },
      };
    });
  }

  const buffer = await wb.xlsx.writeBuffer();
  const filename = encodeURIComponent("學生名冊匯入範例.xlsx");
  res.set({
    "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    "Content-Disposition": `attachment; filename*=UTF-8''${filename}`,
  });
  res.send(Buffer.from(buffer));
});

coursesRouter.get("/template/students_csv", (_req, res) => {
  const lines = [TEMPLATE_HEADERS, ...TEMPLATE_SAMPLE].map((row) => row.join(","));
  const content = "﻿" + lines.join("\r\n") + "\r\n";
  const filename = encodeURIComponent("學生名冊匯入範例.csv");
  res.set({
    "Content-Type": "text/csv; charset=utf-8",
    "Content-Disposition": `attachment; filename*=UTF-8''${filename}`,
  });
  res.send(Buffer.from(content, "utf-8"));
});
