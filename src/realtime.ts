// Socket.io replacement for app/ws_manager.py + the /api/system/ws/{course_id}
// endpoint. Each course gets its own room (`course:{id}`); joining requires the
// same session-cookie/token auth as every REST call.
// Supports:
//   - Teacher/system events: score/attendance/groups changed
//   - Toolkit remote-control: lucky draw, timer, bulletin, etc.
//   - Real-time Word Cloud (文字雲) submissions and sync
//   - Real-time Kahoot-style Quiz competition (個人與小組答題競賽)
import type { Server as HttpServer } from "http";
import type { Server as HttpsServer } from "https";
import { Server, Socket } from "socket.io";
import { prisma } from "./db";
import { getNowStrTaipei } from "./timezone";
import { validateSessionToken } from "./middleware/auth";
import { authenticateStudentToken } from "./middleware/studentAuth";
import { REMOTE_HEADER } from "./remoteGateway";

let io: Server | undefined;

function courseRoom(courseId: number): string {
  return `course:${courseId}`;
}

function studentRoom(studentId: number): string {
  return `student:${studentId}`;
}

/** 所有已登入的教師連線（電腦主畫面、手機、投影）。教師是共用身分，通知不分班級都送給大家。 */
const TEACHERS_ROOM = "teachers";

export interface ActiveKahootQuestion {
  courseId: number;
  quizSetId: number;
  questionId: number;
  questionIndex: number;
  totalQuestions: number;
  prompt: string;
  questionType: string;
  options: { id: string; text: string }[];
  correctOptionIndex: number;
  timeLimitSec: number;
  points: number;
  imageUrl?: string | null;
  explanation?: string | null;
  mode: "individual" | "group";
  startedAt: number;
  revealed: boolean;
  answers: Map<
    number,
    {
      studentId: number;
      studentName: string;
      studentNumber: number;
      groupId: number | null;
      groupName: string | null;
      optionIndex: number;
      timeMsRemaining: number;
      isCorrect: boolean;
      pointsAwarded: number;
    }
  >;
}

// Course ID -> Active Kahoot Question
const activeKahootMap = new Map<number, ActiveKahootQuestion>();

// Course ID -> Active Word Cloud Session
const activeWordCloudMap = new Map<
  number,
  {
    sessionId: number;
    title: string;
    allowDuplicate: number;
    maxWordsPerUser: number;
  }
>();

export function setupRealtime(httpServer: HttpServer | HttpsServer): Server {
  io = new Server(httpServer, {
    // 同源才放行（頁面與 Socket.io 同一個主機）；沒有 Origin 的連線（非瀏覽器）照常。
    allowRequest: (req, callback) => {
      const origin = req.headers.origin;
      if (!origin) return callback(null, true);
      try {
        callback(null, new URL(origin).host === req.headers.host);
      } catch {
        callback(null, false);
      }
    },
  });

  io.on("connection", async (socket: Socket) => {
    const token =
      (socket.handshake.query.token as string | undefined) ||
      parseCookieToken(socket.handshake.headers.cookie);

    if (!token) {
      socket.disconnect(true);
      return;
    }

    // --- 學生連線處理（外網連線另外要求 7 天內簽發；密碼改過的舊憑證一律不接受） ---
    const remote = socket.handshake.headers[REMOTE_HEADER] !== undefined;
    const studentPayload = (await authenticateStudentToken(token, remote))?.payload;
    if (studentPayload) {
      const courseId = studentPayload.courseId;
      const studentId = studentPayload.studentId;
      socket.join(courseRoom(courseId));
      socket.join(studentRoom(studentId)); // 個人通知用，只有這位學生的連線會收到

      // 若目前該課程有正在進行中的文字雲活動，推送給剛上線的學生
      const activeWordCloud = activeWordCloudMap.get(courseId);
      if (activeWordCloud) {
        socket.emit("server_event", {
          event: "wordcloud:start",
          payload: activeWordCloud,
        });
      }

      // 若目前該課程有正在進行中的題目，推送給剛上線的學生
      const activeKahoot = activeKahootMap.get(courseId);
      if (activeKahoot && !activeKahoot.revealed) {
        const hasAnswered = activeKahoot.answers.has(studentId);
        const elapsedSec = Math.floor((Date.now() - activeKahoot.startedAt) / 1000);
        const remainingSec = Math.max(0, activeKahoot.timeLimitSec - elapsedSec);

        socket.emit("server_event", {
          event: "kahoot:question",
          payload: {
            courseId: activeKahoot.courseId,
            quizSetId: activeKahoot.quizSetId,
            questionId: activeKahoot.questionId,
            questionIndex: activeKahoot.questionIndex,
            totalQuestions: activeKahoot.totalQuestions,
            prompt: activeKahoot.prompt,
            questionType: activeKahoot.questionType,
            options: activeKahoot.options,
            timeLimitSec: remainingSec,
            points: activeKahoot.points,
            imageUrl: activeKahoot.imageUrl,
            mode: activeKahoot.mode,
            alreadyAnswered: hasAnswered,
          },
        });
      }

      // 學生提交文字雲詞彙
      socket.on("wordcloud:submit", async (data: { sessionId?: number; word?: string }) => {
        try {
          const sessionId = Number(data?.sessionId);
          const rawWord = (data?.word || "").trim();
          if (!sessionId || !rawWord) return;

          const word = rawWord.slice(0, 20); // 限制長度上限 20 字

          const session = await prisma.wordCloudSession.findFirst({
            where: { id: sessionId, courseId },
          });
          if (!session || session.status !== "active") return;

          const student = await prisma.student.findUnique({
            where: { id: studentId },
            select: { id: true, name: true, studentNumber: true },
          });
          if (!student) return;

          type WordEntry = {
            word: string;
            studentId: number;
            studentName: string;
            studentNumber: number;
            createdAt: string;
          };
          let words: WordEntry[] = [];
          try {
            words = JSON.parse(session.wordsData || "[]");
          } catch {
            words = [];
          }

          const myWords = words.filter((w) => w.studentId === studentId);
          if (myWords.length >= session.maxWordsPerUser) {
            socket.emit("server_event", {
              event: "wordcloud:error",
              payload: { message: `已達提交上限（最多 ${session.maxWordsPerUser} 個詞）` },
            });
            return;
          }

          if (session.allowDuplicate === 0 && myWords.some((w) => w.word.toLowerCase() === word.toLowerCase())) {
            socket.emit("server_event", {
              event: "wordcloud:error",
              payload: { message: "你已經提交過這個詞囉！" },
            });
            return;
          }

          const now = getNowStrTaipei();
          const newEntry: WordEntry = {
            word,
            studentId: student.id,
            studentName: student.name,
            studentNumber: student.studentNumber,
            createdAt: now,
          };
          words.push(newEntry);

          await prisma.wordCloudSession.update({
            where: { id: sessionId },
            data: {
              wordsData: JSON.stringify(words),
              updatedAt: now,
            },
          });

          // 計算詞頻統計
          const freqMap: Record<string, number> = {};
          words.forEach((w) => {
            freqMap[w.word] = (freqMap[w.word] || 0) + 1;
          });

          const wordList = Object.entries(freqMap)
            .map(([text, count]) => ({ text, count }))
            .sort((a, b) => b.count - a.count);

          // 廣播給全班
          io?.to(courseRoom(courseId)).emit("server_event", {
            event: "wordcloud:new_word",
            payload: {
              sessionId,
              word,
              studentName: student.name,
              totalWords: words.length,
              wordList,
            },
          });

          socket.emit("server_event", {
            event: "wordcloud:submitted",
            payload: { success: true, word, myCount: myWords.length + 1 },
          });
        } catch (err) {
          console.error("[Realtime] wordcloud:submit error:", err);
        }
      });

      // 學生送出測驗答題
      socket.on(
        "kahoot:answer",
        async (data: { questionId?: number; optionIndex?: number; timeMsRemaining?: number }) => {
          try {
            const questionId = Number(data?.questionId);
            const optionIndex = Number(data?.optionIndex);
            const timeMsRemaining = Number(data?.timeMsRemaining) || 0;

            const active = activeKahootMap.get(courseId);
            if (!active || active.questionId !== questionId || active.revealed) return;

            // 檢查是否已作答過
            if (active.answers.has(studentId)) return;

            const student = await prisma.student.findUnique({
              where: { id: studentId },
              include: { group: true },
            });
            if (!student) return;

            const isCorrect = optionIndex === active.correctOptionIndex;
            let pointsAwarded = 0;
            if (isCorrect) {
              const ratio = Math.max(0, Math.min(1, timeMsRemaining / (active.timeLimitSec * 1000)));
              // 分數公式：基礎 50% + 速度加權 50%
              pointsAwarded = Math.round(active.points * (0.5 + 0.5 * ratio));
            }

            active.answers.set(studentId, {
              studentId: student.id,
              studentName: student.name,
              studentNumber: student.studentNumber,
              groupId: student.groupId,
              groupName: student.group?.groupName || null,
              optionIndex,
              timeMsRemaining,
              isCorrect,
              pointsAwarded,
            });

            // 廣播給教師與投影幕（不向其他學生透露誰選了什麼，只透露作答總人數）
            io?.to(courseRoom(courseId)).emit("server_event", {
              event: "kahoot:student_answered",
              payload: {
                questionId,
                studentId: student.id,
                studentName: student.name,
                studentNumber: student.studentNumber,
                groupId: student.groupId,
                groupName: student.group?.groupName || null,
                answeredCount: active.answers.size,
                optionIndex,
                timeMsRemaining,
              },
            });

            // 回傳給該學生確認已收到
            socket.emit("server_event", {
              event: "kahoot:answer_received",
              payload: { success: true, questionId, optionIndex },
            });
          } catch (err) {
            console.error("[Realtime] kahoot:answer error:", err);
          }
        }
      );

      return;
    }

    // --- 教師端連線處理（經由學生專用入口從外網進來的連線不接受教師身分） ---
    const courseId = Number(socket.handshake.query.course_id);
    if (
      remote ||
      !Number.isInteger(courseId) ||
      !(await validateSessionToken(token))
    ) {
      socket.disconnect(true);
      return;
    }

    socket.join(courseRoom(courseId));
    socket.join(TEACHERS_ROOM);
    // 連線角色：desktop（教師電腦主畫面）／projection（大螢幕投影頁）／mobile（教師手機頁）
    const role = String(socket.handshake.query.role ?? "");
    socket.data.role = role;

    // 工具箱遙控（Lucky Draw、Timer、鈴聲等）。轉發給同一班級的其他畫面，並回報送達了哪些角色，
    // 讓手機知道教師電腦是不是真的有開著這個班級。
    socket.on("toolkit_action", async (data: { action?: string; payload?: unknown }) => {
      if (!data || !data.action) return;
      socket.to(courseRoom(courseId)).emit("server_event", {
        event: "toolkit_action",
        action: data.action,
        payload: data.payload ?? null,
      });
      try {
        const peers = (await io?.in(courseRoom(courseId)).fetchSockets()) ?? [];
        const receivers = { desktop: 0, projection: 0, mobile: 0 };
        for (const p of peers) {
          if (p.id === socket.id) continue;
          const r = String(p.data?.role ?? "");
          if (r === "desktop" || r === "projection" || r === "mobile") receivers[r] += 1;
        }
        socket.emit("server_event", { event: "toolkit_ack", action: data.action, receivers });
      } catch {
        /* 回報失敗不影響轉發 */
      }
    });

    // 教師啟動文字雲
    socket.on(
      "wordcloud:start",
      (data: { sessionId: number; title: string; allowDuplicate: number; maxWordsPerUser: number }) => {
        if (!data?.sessionId) return;
        activeWordCloudMap.set(courseId, {
          sessionId: data.sessionId,
          title: data.title,
          allowDuplicate: data.allowDuplicate,
          maxWordsPerUser: data.maxWordsPerUser,
        });

        io?.to(courseRoom(courseId)).emit("server_event", {
          event: "wordcloud:start",
          payload: data,
        });
      }
    );

    // 教師結束文字雲
    socket.on("wordcloud:end", (data: { sessionId: number }) => {
      activeWordCloudMap.delete(courseId);
      io?.to(courseRoom(courseId)).emit("server_event", {
        event: "wordcloud:end",
        payload: data,
      });
    });

    // 教師開始一題測驗題
    socket.on(
      "kahoot:start_question",
      async (data: {
        quizSetId: number;
        questionId: number;
        questionIndex: number;
        totalQuestions: number;
        mode?: "individual" | "group";
      }) => {
        try {
          const question = await prisma.quizQuestion.findUnique({
            where: { id: Number(data?.questionId) },
          });
          if (!question) return;

          let rawOptions: Array<{ id: string; text: string; isCorrect?: boolean }> = [];
          try {
            rawOptions = JSON.parse(question.options || "[]");
          } catch {
            rawOptions = [];
          }

          const correctOptionIndex = rawOptions.findIndex((o) => o.isCorrect === true);

          // 清理選項（移除 isCorrect，避免學生透過網路封包查看答案）
          const cleanOptions = rawOptions.map((o) => ({ id: o.id, text: o.text }));

          const activeQ: ActiveKahootQuestion = {
            courseId,
            quizSetId: Number(data.quizSetId),
            questionId: question.id,
            questionIndex: data.questionIndex || 1,
            totalQuestions: data.totalQuestions || 1,
            prompt: question.prompt,
            questionType: question.questionType,
            options: cleanOptions,
            correctOptionIndex: correctOptionIndex >= 0 ? correctOptionIndex : 0,
            timeLimitSec: question.timeLimitSec,
            points: question.points,
            imageUrl: question.imageUrl,
            explanation: question.explanation,
            mode: data.mode === "group" ? "group" : "individual",
            startedAt: Date.now(),
            revealed: false,
            answers: new Map(),
          };

          activeKahootMap.set(courseId, activeQ);

          io?.to(courseRoom(courseId)).emit("server_event", {
            event: "kahoot:question",
            payload: {
              courseId,
              quizSetId: activeQ.quizSetId,
              questionId: activeQ.questionId,
              questionIndex: activeQ.questionIndex,
              totalQuestions: activeQ.totalQuestions,
              prompt: activeQ.prompt,
              questionType: activeQ.questionType,
              options: activeQ.options,
              timeLimitSec: activeQ.timeLimitSec,
              points: activeQ.points,
              imageUrl: activeQ.imageUrl,
              mode: activeQ.mode,
            },
          });
        } catch (err) {
          console.error("[Realtime] kahoot:start_question error:", err);
        }
      }
    );

    // 教師公佈本題答案
    socket.on("kahoot:reveal_answer", (data: { questionId: number }) => {
      const active = activeKahootMap.get(courseId);
      if (!active || active.questionId !== Number(data?.questionId)) return;

      active.revealed = true;

      // 統計選項分佈
      const optionStats = new Array(active.options.length).fill(0);
      active.answers.forEach((ans) => {
        if (ans.optionIndex >= 0 && ans.optionIndex < optionStats.length) {
          optionStats[ans.optionIndex]++;
        }
      });

      const answersList = Array.from(active.answers.values());

      io?.to(courseRoom(courseId)).emit("server_event", {
        event: "kahoot:answer_revealed",
        payload: {
          questionId: active.questionId,
          correctOptionIndex: active.correctOptionIndex,
          explanation: active.explanation || "",
          optionStats,
          answersList,
        },
      });
    });

    // 教師結束整場測驗或展示頒獎台
    socket.on("kahoot:finished", (data: { quizSetId: number; leaderboard: unknown; groupLeaderboard?: unknown }) => {
      activeKahootMap.delete(courseId);
      io?.to(courseRoom(courseId)).emit("server_event", {
        event: "kahoot:finished",
        payload: data,
      });
    });
  });

  return io;
}

function parseCookieToken(cookieHeader?: string): string | undefined {
  if (!cookieHeader) return undefined;
  const match = cookieHeader.split(";").map((c) => c.trim()).find((c) => c.startsWith("auth_session="));
  return match ? decodeURIComponent(match.split("=").slice(1).join("=")) : undefined;
}

/** Broadcasts a named event to every client subscribed to this course's room
 *  (score/attendance/group changes, etc.) — call after every mutating write. */
export function broadcastToCourse(courseId: number, event: string): void {
  io?.to(courseRoom(courseId)).emit("server_event", { event, course_id: courseId });
}

/** 通知這位學生「有新通知」（只推給他自己的連線；內容由學生端再向 API 取得）。 */
export function pushStudentNotification(studentId: number, title: string): void {
  io?.to(studentRoom(studentId)).emit("server_event", { event: "notification:new", payload: { title } });
}

/** 通知教師端「有新通知」（內容由教師端再向 API 取得；這裡只帶標題供提示用）。 */
export function pushTeacherNotification(title: string): void {
  io?.to(TEACHERS_ROOM).emit("server_event", { event: "teacher_notification:new", payload: { title } });
}
