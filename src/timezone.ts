// Port of app/timezone.py — all date/time strings the app writes to the DB or
// returns to the client are Asia/Taipei local time, formatted identically to
// the Python version so exports and undo/date-range comparisons behave the same.

const TAIPEI_TZ = "Asia/Taipei";

function taipeiParts(date: Date) {
  const fmt = new Intl.DateTimeFormat("en-CA", {
    timeZone: TAIPEI_TZ,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  });
  const parts = Object.fromEntries(fmt.formatToParts(date).map((p) => [p.type, p.value]));
  return parts as Record<"year" | "month" | "day" | "hour" | "minute" | "second", string>;
}

/** Returns current date string (YYYY-MM-DD) in Taiwan timezone. */
export function getTodayStrTaipei(): string {
  const p = taipeiParts(new Date());
  return `${p.year}-${p.month}-${p.day}`;
}

/** Returns current timestamp string (YYYY-MM-DD HH:MM:SS) in Taiwan timezone. */
export function getNowStrTaipei(): string {
  const p = taipeiParts(new Date());
  return `${p.year}-${p.month}-${p.day} ${p.hour}:${p.minute}:${p.second}`;
}

/** Returns today's MMDD string in Taiwan timezone (for password calculation). */
export function getTodayMMDDTaipei(): string {
  const p = taipeiParts(new Date());
  return `${p.month}${p.day}`;
}

/** Returns a JS Date representing "now" shifted so its UTC fields equal Taipei wall-clock fields
 *  (useful for date-range arithmetic that mirrors Python's `date.today()` in Taipei time). */
export function getTodayTaipei(): { year: number; month: number; day: number; weekday: number } {
  const p = taipeiParts(new Date());
  const asUtc = new Date(Date.UTC(Number(p.year), Number(p.month) - 1, Number(p.day)));
  // Monday=0 ... Sunday=6, matching Python's date.weekday()
  const jsDay = asUtc.getUTCDay(); // Sunday=0 ... Saturday=6
  const weekday = (jsDay + 6) % 7;
  return { year: Number(p.year), month: Number(p.month), day: Number(p.day), weekday };
}
