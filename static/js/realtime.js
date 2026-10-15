/* ==========================================================================
   國小課堂即時記錄系統 - Real-time Course Feed (Socket.io, no polling)
   Push-driven refresh: the server notifies connected clients the instant a
   teacher's action (scoring / attendance / grouping) changes a course, so
   score/leaderboard views can re-render immediately instead of polling.
   The same channel also relays toolkit remote-control actions (lucky draw,
   timer, bulletin, bells) triggered from a phone to every other connected
   browser (e.g. the projection screen) — see onToolkitAction below.

   Node.js backend note: this used to be a raw WebSocket connected to
   /api/system/ws/{course_id}; the Node/Express rewrite serves the same
   real-time channel over Socket.io instead (see server/src/realtime.ts),
   using the client bundle Socket.io auto-serves at /socket.io/socket.io.js
   (included via a <script> tag in index.html / projection.html before this
   file). Reconnection-with-backoff is handled by the Socket.io client itself.
   ========================================================================== */

// tokenOverride：學生端呼叫時傳入自己的 JWT；不傳（教師端既有呼叫方式）則沿用
// localStorage 的教師 auth_token，維持原行為不變。
// role：'desktop'（教師電腦主畫面）／'projection'（大螢幕投影）／'mobile'（教師手機頁），讓伺服器回報指令送達了誰。
function connectCourseRealtime(courseId, onUpdate, onToolkitAction, tokenOverride, role) {
  if (!courseId) return null;
  if (typeof io === 'undefined') return null;

  const token = tokenOverride !== undefined ? tokenOverride : (localStorage.getItem('auth_token') || '');
  const socket = io({
    query: { course_id: courseId, token, role: role || '' },
  });
  window.activeSocket = socket;

  socket.on('server_event', (data) => {
    if (!data) return;
    if (data.event === 'toolkit_action') {
      if (onToolkitAction) onToolkitAction(data.action, data.payload);
    } else if (data.event === 'wordcloud:new_word') {
      if (window.TeachingToolkit?.wordCloud?.onNewWord) {
        window.TeachingToolkit.wordCloud.onNewWord(data.payload);
      }
      if (window.Projection?.onWordCloudNewWord) {
        window.Projection.onWordCloudNewWord(data.payload);
      }
    } else if (data.event === 'kahoot:student_answered') {
      if (window.TeachingToolkit?.kahoot?.onStudentAnswered) {
        window.TeachingToolkit.kahoot.onStudentAnswered(data.payload);
      }
      if (window.Projection?.onKahootStudentAnswered) {
        window.Projection.onKahootStudentAnswered(data.payload);
      }
    } else if (data.event === 'kahoot:question') {
      if (window.Projection?.onKahootQuestion) {
        window.Projection.onKahootQuestion(data.payload);
      }
      if (window.StudentApp?.onKahootQuestion) {
        window.StudentApp.onKahootQuestion(data.payload);
      }
    } else if (data.event === 'kahoot:answer_revealed') {
      if (window.Projection?.onKahootAnswerRevealed) {
        window.Projection.onKahootAnswerRevealed(data.payload);
      }
      if (window.StudentApp?.onKahootAnswerRevealed) {
        window.StudentApp.onKahootAnswerRevealed(data.payload);
      }
    } else if (data.event === 'kahoot:finished') {
      if (window.Projection?.onKahootFinished) {
        window.Projection.onKahootFinished(data.payload);
      }
      if (window.StudentApp?.onKahootFinished) {
        window.StudentApp.onKahootFinished(data.payload);
      }
    } else if (data.event === 'teacher_notification:new') {
      if (window.TeacherNotify?.onNew) window.TeacherNotify.onNew(data.payload);
    } else if (data.event === 'notification:new') {
      if (window.StudentApp?.onNotification) {
        window.StudentApp.onNotification(data.payload);
      }
    } else if (data.event === 'wordcloud:start') {
      if (window.Projection?.onWordCloudStart) {
        window.Projection.onWordCloudStart(data.payload);
      }
      if (window.StudentApp?.onWordCloudStart) {
        window.StudentApp.onWordCloudStart(data.payload);
      }
    } else if (data.event === 'wordcloud:end') {
      if (window.Projection?.onWordCloudEnd) {
        window.Projection.onWordCloudEnd(data.payload);
      }
      if (window.StudentApp?.onWordCloudEnd) {
        window.StudentApp.onWordCloudEnd(data.payload);
      }
    } else {
      if (onUpdate) onUpdate(data.event);
    }
  });

  return {
    close() {
      socket.close();
    },
    // Sends a toolkit remote-control action to every other browser connected
    // to this course's channel (e.g. mobile -> projection screen).
    sendToolkitAction(action, payload) {
      if (socket.connected) {
        socket.emit('toolkit_action', { action, payload });
      }
    }
  };
}
