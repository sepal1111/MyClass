// Multer (via busboy) decodes multipart Content-Disposition filenames as latin1 by
// default — that's the HTTP header spec, but every modern browser actually sends the
// filename as raw UTF-8 bytes. Left undecoded, a Traditional Chinese filename like
// "填單.docx" round-trips through latin1 and comes out as mojibake ("å¡«å–®.docx").
export function fixUploadFilename(name: string): string {
  // 若已含有 U+00FF 以上的字元，代表上游已經正確解成 UTF-8（例如日後 multer／busboy 改了預設），
  // 不能再當成 latin1 重新解碼，否則會變成亂碼。
  if (/[Ā-￿]/.test(name)) return name;
  return Buffer.from(name, "latin1").toString("utf8");
}

/** Strips filesystem-unsafe characters so a course/class name can be used as a folder
 *  segment (same rule as notes.ts's buildMediaFilename, kept here for the live wall's
 *  "課程名稱-座號" upload folder — see studentLiveWall.ts). */
export function sanitizeFilenamePart(text: string): string {
  const cleaned = text.replace(/[\\/*?:"<>|]/g, "").replace(/\s/g, "");
  return cleaned || "課程";
}

/** Strips Windows & Unix illegal path characters so text can be safely used as a folder segment. */
export function sanitizeFolderSegment(text: string, fallback = "folder"): string {
  const cleaned = text.replace(/[\\/*?:"<>|]/g, "_").trim();
  return cleaned || fallback;
}

/** 學生上傳單一檔案的大小上限（作業、紙本小考照片、即時互動牆；在家上傳檔案蒐集也套用）。
 *  這些上傳多半先整個放進記憶體，沒有上限時幾個超大檔案就可能把整個伺服器（含上課中的教師端）拖垮。 */
export const STUDENT_UPLOAD_LIMIT_MB = 50;
export const STUDENT_UPLOAD_LIMIT_BYTES = STUDENT_UPLOAD_LIMIT_MB * 1024 * 1024;
