// Faithful port of app/routers/courses.py's text_import_students() parsing heuristics.
export interface ParsedStudent {
  student_number: number;
  student_code: string | null;
  name: string;
  english_name: string | null;
  gender: "M" | "F";
  // Only ever set by the structured CSV/Excel column parser (fileImport.ts) — the free-text
  // paste heuristics below stay 5-token-max, positional account/password strings would be too
  // ambiguous to parse reliably. Null means "let courses.ts auto-generate one".
  login_account?: string | null;
  password?: string | null;
}

function isGenderToken(token: string): boolean {
  const u = token.toUpperCase();
  return u.includes("女") || u === "F" || u === "M" || token.includes("男");
}
function isFemale(token: string): boolean {
  const u = token.toUpperCase();
  return u.includes("女") || u === "F";
}

export function parseTextImport(textContent: string): ParsedStudent[] {
  const lines = textContent.trim().split("\n");
  const imported: ParsedStudent[] = [];
  let autoNum = 1;

  for (let rawLine of lines) {
    const line = rawLine.trim();
    if (!line) continue;
    const parts = line
      .replace(/,/g, " ")
      .replace(/\t/g, " ")
      .split(/\s+/)
      .map((p) => p.trim())
      .filter(Boolean);
    if (parts.length === 0) continue;

    let num: number | null = null;
    let code: string | null = null;
    let name = "";
    let englishName: string | null = null;
    let gender: "M" | "F" = "M";

    if (/^\d+$/.test(parts[0])) {
      num = parseInt(parts[0], 10);
      if (parts.length >= 5) {
        // 座號 學號 中文姓名 英文姓名 性別
        code = parts[1];
        name = parts[2];
        englishName = parts[3];
        if (isFemale(parts[4])) gender = "F";
      } else if (parts.length === 4) {
        const lastIsGender = isGenderToken(parts[3]);
        if (lastIsGender) {
          if (isFemale(parts[3])) gender = "F";
          if (/^\d+$/.test(parts[1]) && parts[1].length >= 4) {
            code = parts[1];
            name = parts[2];
          } else {
            name = parts[1];
            englishName = parts[2];
          }
        } else {
          code = parts[1];
          name = parts[2];
          englishName = parts[3];
        }
      } else if (parts.length === 3) {
        name = parts[1];
        if (isFemale(parts[2])) {
          gender = "F";
        } else if (parts[2].toUpperCase() === "M" || parts[2].includes("男")) {
          gender = "M";
        } else {
          englishName = parts[2];
        }
      } else {
        name = parts.length > 1 ? parts[1] : `學生${num}`;
      }
    } else {
      num = autoNum;
      name = parts[0];
      if (parts.length >= 3) {
        englishName = parts[1];
        if (isFemale(parts[2])) gender = "F";
      } else if (parts.length >= 2) {
        if (isFemale(parts[1])) {
          gender = "F";
        } else {
          englishName = parts[1];
        }
      }
    }

    autoNum = Math.max(autoNum, (num ?? 0) + 1);
    imported.push({ student_number: num as number, student_code: code, name, english_name: englishName, gender });
  }

  return imported;
}
