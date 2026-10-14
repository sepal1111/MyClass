// Multer (via busboy) decodes multipart Content-Disposition filenames as latin1 by
// default — that's the HTTP header spec, but every modern browser actually sends the
// filename as raw UTF-8 bytes. Left undecoded, a Traditional Chinese filename like
// "填單.docx" round-trips through latin1 and comes out as mojibake ("å¡«å–®.docx").
export function fixUploadFilename(name: string): string {
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

