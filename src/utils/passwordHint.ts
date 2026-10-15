// 密碼提醒（學生自己寫，忘記密碼時顯示）。
//
// 把密碼想成三段：前綴、主要內容、後綴。主要內容必填，而且寫的是「那一段是什麼」的說明
// （例如「媽媽的電話號碼」），不是密碼本身；前綴與後綴則是密碼裡實際出現的字，至少要填一個，
// 也可以兩個都填。顯示時照順序接起來，例如前綴 xy、主要內容「媽媽的電話號碼」、後綴 sd，
// 提醒就是「xy媽媽的電話號碼sd」。
//
// 注意：前綴與後綴是密碼的真實內容，提醒會在「輸入帳號後密碼多次錯誤」時顯示給任何人看到，
// 請學生不要把整段密碼寫在這裡（介面上也有提示）。
export interface PasswordHintParts {
  prefix: string | null;
  main: string | null;
  suffix: string | null;
}

export const HINT_MAX = { prefix: 20, main: 40, suffix: 20 };

export type HintValidation =
  | { ok: true; clear: true }
  | { ok: true; clear: false; parts: { prefix: string | null; main: string; suffix: string | null } }
  | { ok: false; detail: string };

/** 驗證學生送來的提醒內容；三格全空代表「清除提醒」。 */
export function validateHint(input: { prefix?: unknown; main?: unknown; suffix?: unknown }): HintValidation {
  const clean = (v: unknown): string => (typeof v === "string" ? v.trim() : "");
  const prefix = clean(input.prefix);
  const main = clean(input.main);
  const suffix = clean(input.suffix);

  if (!prefix && !main && !suffix) return { ok: true, clear: true };
  if (!main) return { ok: false, detail: "密碼提醒的「主要內容」一定要填（例如：媽媽的電話號碼）。" };
  if (!prefix && !suffix) return { ok: false, detail: "前綴和後綴至少要填一個（也可以兩個都填）。" };
  if (prefix.length > HINT_MAX.prefix) return { ok: false, detail: `前綴最多 ${HINT_MAX.prefix} 個字。` };
  if (main.length > HINT_MAX.main) return { ok: false, detail: `主要內容最多 ${HINT_MAX.main} 個字。` };
  if (suffix.length > HINT_MAX.suffix) return { ok: false, detail: `後綴最多 ${HINT_MAX.suffix} 個字。` };
  return { ok: true, clear: false, parts: { prefix: prefix || null, main, suffix: suffix || null } };
}

/** 組合成顯示用的提醒文字；沒有設定（主要內容為空）時回傳 null。 */
export function composeHint(parts: PasswordHintParts): string | null {
  if (!parts.main) return null;
  return `${parts.prefix ?? ""}${parts.main}${parts.suffix ?? ""}`;
}
