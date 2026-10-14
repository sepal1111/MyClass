// 點數卡匯入解析工具：支援 CSV 與 Excel (.xlsx) 格式
// 支援多元欄位對應（相容 kyps-scoreboard 的序列號、卡號、分數、卡片圖示等格式）
import ExcelJS from "exceljs";
import { parseCsvLine } from "./fileImport";

export interface ParsedPointCard {
  cardNo?: string;
  code: string;
  label: string;
  score: number;
  image?: string;
}

function normalizeHeader(str: string): string {
  return str.toLowerCase().replace(/[\s_\-（）\(\)\/\\:：\[\]【】]/g, "");
}

function findValue(map: Record<string, string>, matchers: string[]): string {
  // 1. 精準比對
  for (const m of matchers) {
    const normM = normalizeHeader(m);
    if (map[normM] !== undefined && map[normM] !== "") return map[normM];
  }
  // 2. 包含比對
  for (const [k, v] of Object.entries(map)) {
    if (!v) continue;
    for (const m of matchers) {
      const normM = normalizeHeader(m);
      if (k.includes(normM)) return v;
    }
  }
  return "";
}

function extractCardFromMap(data: Record<string, string>): ParsedPointCard | null {
  const normMap: Record<string, string> = {};
  for (const [k, v] of Object.entries(data)) {
    normMap[normalizeHeader(k)] = String(v ?? "").trim();
  }

  // 卡號 / Code (實際 QR Code 掃描代碼)
  const code = findValue(normMap, [
    "卡號qr碼內容",
    "qr碼內容",
    "qr內容",
    "qrcode",
    "qr碼",
    "卡號",
    "code",
    "cardcode",
    "條碼",
    "barcode",
  ]);

  // 分數 / Score / Value
  const scoreRaw = findValue(normMap, [
    "點數分數",
    "卡片分數",
    "點數值",
    "分數",
    "點數",
    "score",
    "value",
    "cardvalue",
  ]);

  if (!code || !scoreRaw || !/^-?\d+$/.test(scoreRaw)) return null;

  // 名稱 / Label
  const label = findValue(normMap, [
    "卡片名稱",
    "名稱",
    "標籤",
    "label",
    "name",
    "title",
  ]);

  // 序列號 / Card No
  const cardNo = findValue(normMap, [
    "序列號",
    "卡片編號",
    "序號",
    "編號",
    "cardno",
    "no",
  ]);

  // 卡片圖示 / Image
  const image = findValue(normMap, [
    "卡片圖示",
    "圖片",
    "圖示",
    "image",
    "cardimage",
    "icon",
  ]);

  const safeLabel = label && label.trim().toLowerCase() !== code.trim().toLowerCase() ? label.trim() : "";

  return {
    code: code.trim(),
    label: safeLabel,
    score: parseInt(scoreRaw, 10),
    cardNo: cardNo ? cardNo.trim() : undefined,
    image: image ? image.trim() : undefined,
  };
}

export function parseCsvPointCards(text: string): ParsedPointCard[] {
  const cleaned = text.replace(/^\uFEFF/, "");
  const lines = cleaned.split(/\r\n|\r|\n/);
  const out: ParsedPointCard[] = [];

  let headerMap: string[] | null = null;

  for (const line of lines) {
    if (!line.trim()) continue;
    const row = parseCsvLine(line).map((c) => c.trim());
    if (row.length < 2) continue;

    // 檢查是否為標題列（只要任一欄位包含關鍵字，即視為標題列）
    if (!headerMap) {
      const isHeader = row.some((col) => {
        const norm = normalizeHeader(col);
        return (
          norm.includes("卡號") ||
          norm.includes("qr") ||
          norm.includes("code") ||
          norm.includes("序號") ||
          norm.includes("序列號") ||
          norm.includes("名稱") ||
          norm.includes("分數") ||
          norm.includes("點數")
        );
      });
      if (isHeader) {
        headerMap = row;
        continue;
      }
    }

    if (headerMap) {
      const obj: Record<string, string> = {};
      headerMap.forEach((h, idx) => {
        obj[h] = row[idx] ?? "";
      });
      const card = extractCardFromMap(obj);
      if (card) out.push(card);
    } else {
      // 傳統 4 欄、3 欄或 2 欄格式
      if (row.length >= 4 && /^-?\d+$/.test(row[3])) {
        // [序列號, 卡號, 名稱, 分數]
        out.push({
          cardNo: row[0] || undefined,
          code: row[1],
          label: row[2] || row[1],
          score: parseInt(row[3], 10),
        });
      } else if (row.length >= 3 && /^-?\d+$/.test(row[2])) {
        // [卡號, 名稱, 分數]
        out.push({
          code: row[0],
          label: row[1] || row[0],
          score: parseInt(row[2], 10),
        });
      } else if (row.length >= 2 && /^-?\d+$/.test(row[1])) {
        // [卡號, 分數]
        out.push({
          code: row[0],
          label: row[0],
          score: parseInt(row[1], 10),
        });
      }
    }
  }

  return out;
}

function cellToString(val: unknown): string {
  if (val === null || val === undefined) return "";
  if (typeof val === "object") {
    const obj = val as Record<string, unknown>;
    if (obj.result !== undefined) return cellToString(obj.result);
    if (Array.isArray(obj.richText)) {
      return (obj.richText as Array<{ text?: string }>).map((t) => t.text ?? "").join("").trim();
    }
    if (obj.text !== undefined) return String(obj.text).trim();
  }
  return String(val).trim();
}

export async function parseExcelPointCards(buffer: Buffer): Promise<ParsedPointCard[]> {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(buffer as unknown as ExcelJS.Buffer);
  const worksheet = workbook.worksheets[0];
  if (!worksheet) return [];

  const out: ParsedPointCard[] = [];
  const rows: string[][] = [];

  worksheet.eachRow((row) => {
    const rowValues: string[] = [];
    row.eachCell({ includeEmpty: true }, (cell, colNumber) => {
      rowValues[colNumber - 1] = cellToString(cell.value);
    });
    if (rowValues.some((c) => c !== "")) {
      rows.push(rowValues);
    }
  });

  if (rows.length === 0) return [];

  let headerRowIndex = -1;
  let headers: string[] = [];

  for (let i = 0; i < Math.min(5, rows.length); i++) {
    const r = rows[i];
    const isHeader = r.some((col) => {
      const norm = normalizeHeader(col);
      return (
        norm.includes("卡號") ||
        norm.includes("qr") ||
        norm.includes("code") ||
        norm.includes("序號") ||
        norm.includes("序列號") ||
        norm.includes("名稱") ||
        norm.includes("分數") ||
        norm.includes("點數")
      );
    });
    if (isHeader) {
      headerRowIndex = i;
      headers = r;
      break;
    }
  }

  if (headerRowIndex !== -1) {
    for (let i = headerRowIndex + 1; i < rows.length; i++) {
      const r = rows[i];
      if (!r || r.length === 0) continue;
      const obj: Record<string, string> = {};
      headers.forEach((h, idx) => {
        obj[h] = r[idx] ?? "";
      });
      const card = extractCardFromMap(obj);
      if (card) out.push(card);
    }
  } else {
    // 若無明確標題，嘗試以純欄位順序解析
    for (const r of rows) {
      if (r.length >= 4 && /^-?\d+$/.test(r[3])) {
        out.push({
          cardNo: r[0] || undefined,
          code: r[1],
          label: r[2] || r[1],
          score: parseInt(r[3], 10),
        });
      } else if (r.length >= 3 && /^-?\d+$/.test(r[2])) {
        out.push({
          code: r[0],
          label: r[1] || r[0],
          score: parseInt(r[2], 10),
        });
      } else if (r.length >= 2 && /^-?\d+$/.test(r[1])) {
        out.push({
          code: r[0],
          label: r[0],
          score: parseInt(r[1], 10),
        });
      }
    }
  }

  return out;
}
