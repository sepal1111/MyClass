// 即時互動牆（Live Wall，教師端）——開一個限時場次，學生每人限交一則文字/手繪/拍照貼文，
// 教師端與投影大螢幕即時呈現。學生端對應路由見 src/routes/studentLiveWall.ts。
import fs from "fs";
import path from "path";
import { Router } from "express";
import { prisma } from "../db";
import { autoCatch } from "../asyncRoute";
import { getNowStrTaipei } from "../timezone";
import { broadcastToCourse } from "../realtime";
import { getUploadsDir } from "../paths";

export const liveWallRouter = autoCatch(Router());

const VALID_MODES = new Set(["text", "drawing", "photo"]);

// 記錄各活躍場次最後一次收到教師心跳的時間戳 (sessionId -> timestamp)
const sessionHeartbeats = new Map<number, number>();
const HEARTBEAT_TIMEOUT_MS = 40 * 1000; // 40 秒未收到心跳即判定教師已離開或關閉視窗

// 定期檢查超時未收到心跳的場次，自動結束並廣播通知學生與大螢幕
setInterval(async () => {
  try {
    const activeSessions = await prisma.liveSession.findMany({
      where: { isActive: 1 },
      select: { id: true, courseId: true },
    });
    const now = Date.now();
    for (const session of activeSessions) {
      const lastPing = sessionHeartbeats.get(session.id);
      if (lastPing && now - lastPing > HEARTBEAT_TIMEOUT_MS) {
        sessionHeartbeats.delete(session.id);
        await prisma.liveSession.update({
          where: { id: session.id },
          data: { isActive: 0 },
        });
        broadcastToCourse(session.courseId, "live_wall_updated");
        console.log(`[LiveWall] 場次 #${session.id} 因教師已離開頁面（超過 40 秒無心跳）已自動結束。`);
      }
    }
  } catch (err) {
    // 忽略檢查錯誤
  }
}, 10 * 1000);

/** image_url 一律是 "/uploads/..." 的公開路徑，換算回磁碟實際檔案路徑好刪除。
 *  找不到檔案（例如已被手動搬走）也不擋刪除，best-effort。 */
function deleteUploadedFile(imageUrl: string | null): void {
  if (!imageUrl) return;
  const relative = imageUrl.replace(/^\/uploads\//, "");
  const filePath = path.join(getUploadsDir(), relative);
  fs.unlink(filePath, () => undefined);
}

function serializePost(p: { id: number; textContent: string | null; imageUrl: string | null; createdAt: string; student: { id: number; studentNumber: number; name: string } }) {
  return {
    id: p.id,
    student_id: p.student.id,
    student_number: p.student.studentNumber,
    student_name: p.student.name,
    text_content: p.textContent,
    image_url: p.imageUrl,
    created_at: p.createdAt,
  };
}

function serializeSession(s: { id: number; courseId: number; mode: string; title: string | null; showNames: number; createdAt: string }) {
  return {
    id: s.id,
    course_id: s.courseId,
    mode: s.mode,
    title: s.title,
    show_names: !!s.showNames,
    created_at: s.createdAt,
  };
}

// 開始新場次：自動關閉該課程既有進行中的場次，不需要老師先手動結束再開新的。
liveWallRouter.post("/courses/:courseId/start", async (req, res) => {
  const courseId = Number(req.params.courseId);
  const mode: string = req.body?.mode;
  if (!VALID_MODES.has(mode)) {
    res.status(400).json({ detail: "請選擇有效的提交模式（文字／手繪／拍照）" });
    return;
  }
  const title: string | null = (req.body?.title as string | undefined)?.trim() || null;
  const showNames = req.body?.show_names === false ? 0 : 1;

  await prisma.liveSession.updateMany({ where: { courseId, isActive: 1 }, data: { isActive: 0 } });
  const session = await prisma.liveSession.create({
    data: { courseId, mode, title, showNames, isActive: 1, createdAt: getNowStrTaipei() },
  });

  sessionHeartbeats.set(session.id, Date.now());
  broadcastToCourse(courseId, "live_wall_updated");
  res.json(serializeSession(session));
});

// 目前進行中場次＋全部貼文（教師視角一律看得到真名，匿名只影響投影/學生視角）。
liveWallRouter.get("/courses/:courseId/active", async (req, res) => {
  const courseId = Number(req.params.courseId);
  const session = await prisma.liveSession.findFirst({ where: { courseId, isActive: 1 } });
  if (!session) {
    res.json({ session: null, posts: [] });
    return;
  }
  // 教師或大螢幕正在檢視此場次，刷新心跳基線
  sessionHeartbeats.set(session.id, Date.now());

  const posts = await prisma.liveWallPost.findMany({
    where: { sessionId: session.id },
    orderBy: { id: "asc" },
    include: { student: true },
  });
  res.json({ session: serializeSession(session), posts: posts.map(serializePost) });
});

// 歷史紀錄（教師端）：依場次分組（前端呈現為「日期－活動名稱」的可展開分類），
// 與「進行中場次」的即時看板（/active）分開查詢，供瀏覽與管理刪除；一律看得到真名，
// 匿名只影響投影/學生視角。沒有任何人送出過的場次不列入（避免一堆空分類）。
liveWallRouter.get("/courses/:courseId/history", async (req, res) => {
  const courseId = Number(req.params.courseId);
  const sessions = await prisma.liveSession.findMany({
    where: { courseId },
    orderBy: { id: "desc" },
    include: { posts: { orderBy: { id: "asc" }, include: { student: true } } },
  });
  res.json(
    sessions
      .filter((s) => s.posts.length > 0)
      .map((s) => ({
        session: serializeSession(s),
        posts: s.posts.map(serializePost),
      }))
  );
});

// 一鍵清空：刪貼文＋對應的手繪/拍照檔案，場次維持開啟，學生可以重新送出一次。
liveWallRouter.post("/sessions/:sessionId/clear", async (req, res) => {
  const sessionId = Number(req.params.sessionId);
  const session = await prisma.liveSession.findUnique({ where: { id: sessionId } });
  if (!session) {
    res.status(404).json({ detail: "場次不存在" });
    return;
  }
  const posts = await prisma.liveWallPost.findMany({ where: { sessionId }, select: { imageUrl: true } });
  posts.forEach((p) => deleteUploadedFile(p.imageUrl));
  await prisma.liveWallPost.deleteMany({ where: { sessionId } });
  broadcastToCourse(session.courseId, "live_wall_updated");
  res.json({ message: "已清空所有貼文" });
});

// 刪除單筆貼文紀錄（教師端專用——學生端無對應路由，不得刪除自己的紀錄）：
// 連同對應的手繪/拍照檔案一併從磁碟刪除，不留孤兒檔案。
liveWallRouter.delete("/posts/:postId", async (req, res) => {
  const postId = Number(req.params.postId);
  const post = await prisma.liveWallPost.findUnique({ where: { id: postId }, include: { session: true } });
  if (!post) {
    res.status(404).json({ detail: "紀錄不存在" });
    return;
  }
  deleteUploadedFile(post.imageUrl);
  await prisma.liveWallPost.delete({ where: { id: postId } });
  broadcastToCourse(post.session.courseId, "live_wall_updated");
  res.json({ message: "紀錄已刪除" });
});

// 教師端互動牆心跳回報（確保教師仍停留在互動牆頁面）
liveWallRouter.post("/sessions/:sessionId/heartbeat", async (req, res) => {
  const sessionId = Number(req.params.sessionId);
  sessionHeartbeats.set(sessionId, Date.now());
  res.json({ ok: true });
});

// 結束特定場次：與「清空」是獨立動作，結束後學生端恢復成沒有進行中場次的畫面。
liveWallRouter.post("/sessions/:sessionId/close", async (req, res) => {
  const sessionId = Number(req.params.sessionId);
  sessionHeartbeats.delete(sessionId);
  const session = await prisma.liveSession.findUnique({ where: { id: sessionId } });
  if (!session) {
    res.status(404).json({ detail: "場次不存在" });
    return;
  }
  await prisma.liveSession.update({ where: { id: sessionId }, data: { isActive: 0 } });
  broadcastToCourse(session.courseId, "live_wall_updated");
  res.json({ message: "場次已結束" });
});

// 結束該課程所有進行中場次（教師離開分頁、離開視窗或切換班級時呼叫）
liveWallRouter.post("/courses/:courseId/close_active", async (req, res) => {
  const courseId = Number(req.params.courseId);
  const activeSessions = await prisma.liveSession.findMany({
    where: { courseId, isActive: 1 },
    select: { id: true },
  });
  if (activeSessions.length > 0) {
    for (const s of activeSessions) {
      sessionHeartbeats.delete(s.id);
    }
    await prisma.liveSession.updateMany({
      where: { courseId, isActive: 1 },
      data: { isActive: 0 },
    });
    broadcastToCourse(courseId, "live_wall_updated");
  }
  res.json({ message: "進行中場次已結束" });
});
