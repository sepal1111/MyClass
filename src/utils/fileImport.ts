// Port of app/routers/courses.py's upload_students_file() CSV/XLSX parsing.
import ExcelJS from "exceljs";
import { ParsedStudent } from "./textImport";

export function parseCsvLine(line: string): string[] {
  const cells: string[] = [];
  let cur = "";
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (inQuotes) {
      if (ch === '"') {
        if (line[i + 1] === '"') {
          cur += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        cur += ch;
      }
    } else if (ch === '"') {
      inQuotes = true;
    } else if (ch === ",") {
      cells.push(cur);
      cur = "";
    } else {
      cur += ch;
    }
  }
  cells.push(cur);
  return cells;
}

function rowToStudent(rowStr: string[]): ParsedStudent | null {
  const val0 = (rowStr[0] ?? "").trim();
  if (!/^\d+$/.test(val0)) return null;
  const num = parseInt(val0, 10);

  let code: string | null = null;
  let name = "";
  let englishName: string | null = null;
  let gender: "M" | "F" = "M";
  // Optional trailing 6th/7th columns (登入帳號／密碼) — only the structured CSV/Excel
  // template has enough columns for this to be unambiguous; shorter rows are untouched.
  const loginAccount: string | null = rowStr.length >= 6 ? rowStr[5] || null : null;
  const password: string | null = rowStr.length >= 7 ? rowStr[6] || null : null;

  const isF = (s: string) => s.toUpperCase().includes("女") || s.toUpperCase() === "F";
  const isM = (s: string) => s.toUpperCase().includes("男") || s.toUpperCase() === "M";

  if (rowStr.length >= 5) {
    code = rowStr[1] || null;
    name = rowStr[2] ?? "";
    englishName = rowStr[3] || null;
    if (isF(rowStr[4] ?? "")) gender = "F";
  } else if (rowStr.length === 4) {
    if (isF(rowStr[3] ?? "")) {
      gender = "F";
      code = rowStr[1] || null;
      name = rowStr[2] ?? "";
    } else if (isM(rowStr[3] ?? "")) {
      gender = "M";
      code = rowStr[1] || null;
      name = rowStr[2] ?? "";
    } else {
      name = rowStr[1] ?? "";
      englishName = rowStr[2] || null;
      if (isF(rowStr[3] ?? "")) gender = "F";
    }
  } else if (rowStr.length === 3) {
    name = rowStr[1] ?? "";
    if (isF(rowStr[2] ?? "")) gender = "F";
  } else {
    name = rowStr[1] ?? "";
  }

  return { student_number: num, student_code: code, name, english_name: englishName, gender, login_account: loginAccount, password };
}

export function parseCsvStudents(text: string): ParsedStudent[] {
  const cleaned = text.replace(/^﻿/, "");
  const lines = cleaned.split(/\r\n|\r|\n/);
  const out: ParsedStudent[] = [];
  for (const line of lines) {
    if (!line.trim()) continue;
    const row = parseCsvLine(line);
    if (!row || row.length < 2) continue;
    if (row[0].includes("座號") || row[1].includes("姓名") || !/^\d+$/.test(row[0].trim())) continue;
    const s = rowToStudent(row.map((c) => c.trim()));
    if (s) out.push(s);
  }
  return out;
}

export async function parseXlsxStudents(buffer: Buffer): Promise<ParsedStudent[]> {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buffer as unknown as ExcelJS.Buffer);
  const sheet = wb.worksheets[0];
  const out: ParsedStudent[] = [];
  if (!sheet) return out;

  sheet.eachRow((row) => {
    const values = row.values as unknown[];
    // ExcelJS row.values is 1-indexed (index 0 is empty); normalize to a 0-indexed array.
    const rowStr = values.slice(1).map((v) => (v === null || v === undefined ? "" : String(v).trim()));
    if (rowStr.length < 2) return;
    const s = rowToStudent(rowStr);
    if (s) out.push(s);
  });
  return out;
}
