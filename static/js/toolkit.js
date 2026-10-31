/**
 * Classroom Teaching Toolkit (國小課堂教學輔助工具箱)
 * 1. Bulletin Board (公布欄：文字縮放、顏色、粗體、黑板主題、全螢幕投影)
 * 2. Lucky Draw (隨機抽籤：個人/小組、指定人數、排除已中籤、滾動動畫、一鍵加分)
 * 3. Timer & Stopwatch (計時器與碼錶：倒數預設、5秒警示、歸零鬧鈴、碼錶計圈、浮動迷你視窗)
 * 4. Attention Bells (課堂注意警示鈴聲：Web Audio API 晶片級原生音效合成，零外部依賴)
 *
 * 各工具的程式在 static/js/toolkit/ 底下（2026-10-30 拆分），這個檔案只負責組合與初始化，
 * 必須在 toolkit/ 的所有檔案之後載入。
 */
(function (window) {
  'use strict';


  const TK = window.ToolkitModules;
  const AudioEngine = window.AudioEngine;
  const { BulletinBoard, LuckyDraw, TimerEngine, LiveWall, FloatingClassroomDock, WordCloud, KahootGame } = TK;

  // =========================================================================
  // 8. Master Teaching Toolkit Manager
  // =========================================================================
  const TeachingToolkit = {
    audio: AudioEngine,
    bulletin: BulletinBoard,
    luckyDraw: LuckyDraw,
    timer: TimerEngine,
    liveWall: LiveWall,
    wordCloud: WordCloud,
    kahoot: KahootGame,
    floatingDock: FloatingClassroomDock,

    init() {
      this.bulletin.init();
      this.luckyDraw.init();
      this.timer.init();
      this.liveWall.init();
      this.wordCloud.init();
      this.kahoot.init();
      this.floatingDock.init();

      this.luckyDraw.updatePoolCountBadge();
      this.timer.updatePresetButtons();

      // Subtab switcher inside Toolkit pane
      document.querySelectorAll('.toolkit-subtab-btn').forEach(btn => {
        btn.addEventListener('click', (e) => {
          const subtab = e.currentTarget.dataset.toolkitTab;
          this.switchSubtab(subtab);
        });
      });

      // Synchronize toolkit elements on language switch
      window.addEventListener('languageChanged', () => {
        this.bulletin.renderPostDropdown();
        if (this.bulletin.saveStatus !== 'idle') this.bulletin.setSaveStatus(this.bulletin.saveStatus);
        this.luckyDraw.updatePoolCountBadge();
        if (!this.luckyDraw.isRolling) {
          this.luckyDraw.resetSpotlightCard();
        }
        this.timer.updatePresetButtons();
        this.timer.updateCountdownControls();
        this.timer.updateStopwatchControls();
        this.liveWall.refresh();
        if (document.getElementById('modal-livewall-history')?.classList.contains('open')) {
          this.liveWall.loadHistory();
        }
      });
    },

    switchSubtab(subtab) {
      if (this.bulletin && typeof this.bulletin.flushActivePost === 'function') {
        this.bulletin.flushActivePost();
      }
      document.querySelectorAll('.toolkit-subtab-btn').forEach(b => {
        const isActive = b.dataset.toolkitTab === subtab;
        b.classList.toggle('active', isActive);
        b.classList.toggle('btn-secondary', !isActive);
      });
      document.querySelectorAll('.toolkit-subpane').forEach(p => {
        p.style.display = p.id === `toolkit-subpane-${subtab}` ? 'block' : 'none';
      });
      if (subtab === 'bulletin') {
        const cId = this.bulletin.getCourseId();
        if (cId && (!this.bulletin.posts || this.bulletin.posts.length === 0 || this.bulletin.currentCourseId !== cId)) {
          this.bulletin.loadCourse(cId);
        }
      }
      if (subtab === 'draw') {
        this.luckyDraw.resetSpotlightCard();
      }
      if (subtab === 'timer') {
        this.timer.onEnterTimerTab();
      } else {
        this.timer.onLeaveTimerTab();
      }
      if (subtab === 'liveWall') {
        this.liveWall.onEnterLiveWallTab();
      } else {
        this.liveWall.onLeaveLiveWallTab();
      }
      if (subtab === 'wordCloud') {
        const cId = this.wordCloud.getCourseId();
        if (cId && !this.wordCloud.currentSession) {
          this.wordCloud.loadCourse(cId);
        }
      }
      if (subtab === 'kahoot') {
        const cId = this.kahoot.getCourseId();
        if (cId && this.kahoot.sets.length === 0) {
          this.kahoot.loadCourse(cId);
        }
      }
    },

    onCourseLoaded(courseId, students, groups) {
      if (this.liveWall && this.liveWall.currentSession && this.liveWall.currentSession.course_id !== courseId) {
        this.liveWall.onLeaveLiveWallTab();
      }
      this.setCourseAvailability(true);
      this.bulletin.loadCourse(courseId);
      this.luckyDraw.setStudents(students);
      this.luckyDraw.setGroups(groups);
      this.wordCloud.loadCourse(courseId);
      this.kahoot.loadCourse(courseId);
    },

    // 課堂公布欄／隨機抽籤都需要課程資料（公告存在 localStorage 的課程 key 下、抽籤池來自班級名冊），
    // 尚未建立班級時分別在這兩個子分頁裡顯示跟其他分頁一致的「尚無班級」提示卡，取代原本的內容；
    // 計時器與碼錶不受影響，維持可用。
    setCourseAvailability(hasCourse) {
      const pairs = [
        ['toolkit-bulletin-empty-notice', 'toolkit-bulletin-content'],
        ['toolkit-draw-empty-notice', 'toolkit-draw-content'],
      ];
      pairs.forEach(([noticeId, contentId]) => {
        const notice = document.getElementById(noticeId);
        const content = document.getElementById(contentId);
        if (!notice || !content) return;
        if (hasCourse) {
          notice.style.display = 'none';
          content.style.display = '';
        } else {
          if (window.renderEmptyCourseNotice) window.renderEmptyCourseNotice(notice);
          notice.style.display = 'block';
          content.style.display = 'none';
        }
      });
    }
  };

  window.addEventListener('beforeunload', () => {
    if (TeachingToolkit?.timer) {
      TeachingToolkit.timer.onLeaveTimerTab();
    }
    if (TeachingToolkit?.liveWall) {
      TeachingToolkit.liveWall.onLeaveLiveWallTab({ isUnload: true });
    }
  });

  window.addEventListener('pagehide', () => {
    if (TeachingToolkit?.timer) {
      TeachingToolkit.timer.onLeaveTimerTab();
    }
    if (TeachingToolkit?.liveWall) {
      TeachingToolkit.liveWall.onLeaveLiveWallTab({ isUnload: true });
    }
  });

  document.addEventListener('DOMContentLoaded', () => {
    TeachingToolkit.init();
  });

  window.TeachingToolkit = TeachingToolkit;

})(window);
