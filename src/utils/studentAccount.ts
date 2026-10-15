// 學生登入帳號的比對：不分大小寫。
// 資料庫的 UNIQUE 索引區分大小寫，所以新增／修改帳號時要自己檢查「只差大小寫」的重複，
// 登入時也要把「只差大小寫」的帳號都找出來（SQLite 的 lower() 只處理 ASCII，帳號本來就是英數字）。
import { prisma } from "../db";

/** 找出帳號相同（不分大小寫）且啟用中的學生；完全相符者排在最前面。 */
export async function findStudentsByAccountIgnoreCase(account: string) {
  const ids = await prisma.$queryRaw<{ id: number }[]>`
    SELECT id FROM students
    WHERE lower(login_account) = lower(${account}) AND is_active = 1`;
  if (ids.length === 0) return [];
  const rows = await prisma.student.findMany({ where: { id: { in: ids.map((r) => r.id) } } });
  return rows.sort((a, b) => Number(b.loginAccount === account) - Number(a.loginAccount === account));
}

/** 帳號是否已被使用（不分大小寫）。`exceptStudentId` 用於編輯學生時排除自己。 */
export async function isAccountTaken(account: string, exceptStudentId?: number): Promise<boolean> {
  const rows = await prisma.$queryRaw<{ id: number }[]>`
    SELECT id FROM students WHERE lower(login_account) = lower(${account})`;
  return rows.some((r) => r.id !== exceptStudentId);
}
