# MyClass Node.js 重構與學生互動 LMS 系統規劃書

> **實施狀態（2026-10-15 更新）**：本規劃書是專案初期的藍圖，部分內容已調整或廢除。
> - ✅ 已實施：第一至第三階段、即時互動牆、通知系統（學生端與教師端）、打包與隨身碟便攜化。
> - 🚫 **已廢除（不實施）**：主題討論區與小單元 Q&A（第五章第 3 節）、班級動態牆（第五章第 4 節）、教師視角模擬（第五章第 5 節）。課堂需求以現有的提問串、課堂公佈欄與即時互動牆即可滿足，不再投入開發。
> - ➖ 維持現況：教師身分採用單一共用的「字頭＋月日」密碼（第五章第 5 節的多角色 RBAC 不另做）。

## 一、 現有功能全面分析 (Current Feature Inventory)

目前 MyClass (國小課堂即時記錄系統) 基於 Python (FastAPI) + SQLite + HTML/JS 打造，核心定位為**教師單機隨身碟/區域網走動式管理工具**。主要功能維度如下：

| 功能維度 | 核心功能說明 | 資料庫實體 / 技術實現 |
| :--- | :--- | :--- |
| **課程與學生管理** | • 支援導師/科任模式<br>• 學生座號、學號、姓名、英文名、性別、頭像<br>• 支援 JSON 批次匯入與純文字快速貼上解析 | `courses`, `students` |
| **彈性多重分組** | • 支援多套分組模式 (Group Plans, 如常態組、實驗組)<br>• 自動分組演算法 (完全隨機、性別平衡隨機)<br>• 手動 Drag & Drop 拖拽調整組員 | `groups`, `group_plans`, `group_members` |
| **座位表與排座** | • 自訂行列 (Rows x Cols) 與黑板方位<br>• 自動隨機/性別平衡排座<br>• 手動拖拽位置交換、與缺席狀態聯動反灰 | `courses` (seat_rows/cols), `students` (seat_row/col) |
| **出缺席點名** | • 標記出席、病假、事假、公假、喪假、遲到<br>• 點名歷程與日期記錄，防缺席學生誤扣分 | `attendance` |
| **量化加減分** | • 自訂正向/負向評分規則與分數權重<br>• 支援個人單點、多選批次、整組加減分<br>• 包含 Undo 復原機制 (秒級撤銷) | `evaluation_rules`, `score_logs`, `undo_logs` |
| **質性紀錄** | • 個別學生行為表現與文字備忘錄<br>• 支援圖片與影音附件上傳 | `qualitative_notes` |
| **即時儀表板與排行榜** | • 當日累積分數、區間累計、學期累計<br>• 即時排行榜與音效引擎 (Audio Engine) | 前端 `app.js`, `toolkit.js`, `audio-engine.js` |
| **大螢幕投影與遙控** | • WebSocket 即時雙向同步<br>• 手機/平板點擊加分，大螢幕同步跳出動畫 | `ws_manager.py`, `projection.html`, `remote-control.js` |
| **報表與安全部署** | • Excel 報表匯出 (出缺席、分數明細、質性記錄)<br>• 單機隨身碟便攜部署、動態 IP 與 QR Code 免網際網絡運作 | `reports.py`, `database.py`, `run_server.py` |

---

## 二、 為何改寫為 Node.js？ (Node.js Rewrite Rationale)

1. **高併發與即時互動 (Real-time Event-Driven Architecture)**
   * 原系統僅由**教師單向操作**。未來開放全班 30~50 名學生同時在線（線上搶答、繳交作業、分組討論、留言互動），Node.js 的非同步 Event Loop 與 **Socket.io** 能以極低延遲處理數百個並列 WebSocket 連線。
2. **前後端語言同構 (Full-Stack TypeScript/JavaScript)**
   * 前後端統一使用 JS/TS 語言，大幅減少程式碼轉換成本，能共用 Data Types (如 Zod Schema 驗證)。
3. **豐富的互動與 LMS 生態系**
   * Node.js 擁有成熟的富文本處理、檔案上傳 (Multer/Busboy)、即時協同編輯 (Yjs / ShareDB) 以及強大的 ORM (Prisma / Drizzle)。

---

## 三、 關鍵架構決策 (Confirmed Architecture Decisions)

以下三項為與使用者確認過的定案方向，後續所有設計皆以此為前提：

1. **部署模式：雙軌並存 (Dual-Mode Deployment)**
   * **保留**現有「隨身碟單機 / 教室區網」核心賣點：免安裝、免網際網路，插入電腦執行單一檔案即開啟區網伺服器，教師走動式管理（點名、加減分）完全不受影響。
   * **新增**「LMS 開課模式」：當教師需要開放學生互動（作業、討論、素材瀏覽）時，同一台伺服器在**同一個區網 (LAN)** 內，讓學生用手機/平板/筆電瀏覽器連線登入即可使用，**不需要外部網際網路，也不需要另外部署雲端服務**。
   * 因此後端不拆分成教師端/學生端兩套系統，而是**同一個 Node.js 服務、同一個 SQLite 資料庫**，用角色權限 (RBAC) 區分可視範圍與可操作功能。
   * 未來若學校有需求要跨網際網路存取（如課後在家寫作業），可作為「加值選項」另外評估固定伺服器/VPN，但**不是本次改寫的必要條件**，架構上僅需保留擴充彈性（環境變數切換 CORS/Origin 即可），不需要現在就設計。

2. **帳號與檔案儲存：完全自建 (Self-Hosted, No Google Dependency)**
   * 不採用 kyps-class 的 Firebase Auth / Google Drive 生態系，避免要求每位學生都要有 Google Workspace for Education 帳號，維持 MyClass 原本「不需要學生自行申辦任何外部帳號」的低門檻優勢。
   * **教師帳號**：帳號密碼登入（bcrypt 雜湊），沿用現有系統管理員角色概念。
   * **學生帳號**：由教師在後台批次建立/匯入（座號 + 姓名 + 初始密碼，可批次產生預設密碼如生日或學號後四碼），登入方式提供：
     * 「選班級 → 選座號 → 輸入密碼」簡易登入（比照原規劃書的構想）。
     * **課堂 QR Code 免密碼登入**：教師開課時大螢幕顯示帶有一次性/限時 token 的 QR Code，學生掃碼即完成該堂課的身分綁定登入，降低低年級學生輸入帳密的操作門檻。
   * **檔案儲存**：一律存在伺服器本機檔案系統（如隨身碟內 `uploads/` 目錄），依「課程/單元/使用者」分層資料夾，比照現有 `static/avatars` 的作法延伸，不串接任何雲端 API。備份方式維持「複製整個資料夾」即可，符合原系統的可攜性精神。

3. **資料庫：SQLite + Prisma (or Drizzle) ORM**
   * 維持單一 `.db` 檔案、隨身碟可攜、複製資料夾即備份的特性。
   * 以 Prisma schema 統一管理現有的點名/評分/分組資料表與新增的 LMS 資料表，取代目前手寫 SQL (`database.py`)，並用 migration 機制取代手動 schema 演進。
   * 併發寫入風險因應：SQLite 啟用 WAL (Write-Ahead Logging) 模式因應多學生同時繳交/留言的併發寫入；單班 30-50 人的區網規模下實測應足夠，若未來擴大到全校多班同時上線，再評估是否切換 PostgreSQL（架構上用 Prisma 抽象化，屆時只需换 datasource，不需重寫商業邏輯）。

---

## 五、 未來學生互動與課程素材模組規劃 (Future Interactive LMS Blueprint)

參考 kyps-class 已上線驗證過的功能設計（見其規劃書 3.2–3.7、3.9 節），但改用**自建帳號/自建儲存**版本重新設計，共規劃 **五大全新核心模組**：

### 1. 課程素材與單元結構模組 (Course Materials & Units Module)
* **層級設計**：`課程 (Course)` ➡️ `大單元 (Module/Unit)` ➡️ `小單元/課時 (Topic/Sub-unit)`，兩層皆可拖曳排序、隱藏/公開切換（借鑑 kyps `units`/`sub_units` 設計）。
* **三種子單元類別**（借鑑 kyps 已驗證的分類）：
  * **教學素材 (material)**：上傳檔案（存本機 `uploads/`）或外部連結，YouTube 連結自動嵌入播放；追蹤每位學生的閱讀進度（首次/最後點閱時間、點擊次數），供教師檢視全班預習完成率。
  * **作業 (assignment)**：詳見模組 2。
  * **線上測驗 (quiz)**：教師出題（選擇題/是非題/簡答題，各題可配分），支援題庫 CSV 匯入匯出；學生作答時題目/選項隨機打亂，送出即自動批改鎖定，教師可設定是否即時公布正解。
* **發布控制**：支援「隱藏/公開」、「定時開放」。

### 2. 作業與小組共同作業模組 (Assignments & Group Collaboration)
* **個人作業**：學生上傳檔案 (PDF/圖片/DOCX/ZIP) 或線上填寫文字/連結（可複選繳交方式），記錄繳交時間與版本，逾期自動標記「遲交」，可設定「逾期自動鎖定」與「申請解鎖重繳 → 教師一鍵核准」流程。
* **小組共同作業**：**無縫整合現有「彈性分組系統 (Group Plans)」**——作業可指定特定分組方案；一組繳交、全組共享進度與回饋。
* **批改與加減分聯動 (Grading & Score Integration)**：教師線上批改給星級評語時，**直接觸發現有的 `score_logs` 加減分機制**，自動累計進學生課堂總分與排行榜。
* **提問串 (Submission Comments)**：每筆作業/教材皆附一對一（或對小組）提問串，**建立後不可編輯刪除**，做為師生溝通的永久稽核紀錄（借鑑 kyps `submission_comments` 設計）。

### 3. 討論區與課程留言模組 (Forums & Comments Module) 🚫 已廢除（不實施）
> 廢除原因：課堂上的師生溝通已由作業／測驗的「提問串」與教師通知涵蓋；另開討論區與按讚機制的維護成本高、使用情境少。以下內容僅保留作歷史紀錄。

* **主題討論區**：針對課程設定研討主題，學生發帖、回覆、按讚；支援「小組專屬討論板」。
* **小單元 Q&A**：學生在教材下方發問/心得，教師可標記「採納最佳解答」。
* **即時廣播**：學生張貼留言/繳交作業時，教師端與投影大螢幕透過 Socket.io 即時顯示新動態通知。

### 4. 課堂即時互動牆與班級動態 (Live Wall & Class Stream)
> 狀態：**即時互動牆 ✅ 已實施**；**班級動態牆 🚫 已廢除（不實施）**，長期留言由老師單向的「課堂公佈欄」取代。

* **即時互動牆**：教師開一個限時場次，選文字/手繪/拍照三種提交模式，可設定是否顯示姓名／匿名投影；學生每人限交一則，教師端與大螢幕即時看板呈現，可一鍵清空（借鑑 kyps `live_sessions`/`live_wall_posts`，手繪模式可重用 MyClass 現有的手寫畫板工具）。
* ~~**班級動態牆**：長期留言板，師生皆可發文/留言，僅作者本人或教師可刪除；教師發文自動通知全班。~~ 🚫 已廢除。
* 兩者皆與現有的「大螢幕投影」(`ws_manager.py` → Socket.io) 共用同一組即時連線基礎設施，不需另建通訊層。

### 5. 使用者身分、通知與角色權限 (RBAC, Notifications & Auth Module)
> 狀態：**通知系統 ✅ 已實施**（學生端鈴鐺、教師端鈴鐺）；**教師視角模擬 🚫 已廢除**；多角色 RBAC 未實施（維持單一教師共用密碼，學生以個別帳號登入）。

* **角色區分**：`Admin`（系統維護者）、`Teacher`（建課程、設單元、點名、評分、批改、管理分組）、`Student`（瀏覽素材、參與討論、繳交作業、查看個人歷程）。
* **登入機制**：JWT + HTTP-Only Cookie；學生走「選班級→選座號→密碼」或「課堂 QR Code」登入（詳見第三節架構決策）。
* **通知系統**：鈴鐺圖示顯示未讀數，觸發時機含新作業/測驗發布、批改完成、解鎖核准、新提問、班級動態新貼文；通知寫入為非阻斷式，失敗不影響主要教學操作（借鑑 kyps 3.9 節設計）。
* ~~**教師視角模擬**：教師可一鍵切換「以學生視角預覽」課程頁面，不必登出或借用學生帳號（借鑑 kyps 3.2 節設計，實作上僅需後端暫時降權處理當前 session 的檢視範圍，不需要真的切換帳號）。~~ 🚫 已廢除。

---

## 六、 Node.js 技術棧建議與系統架構 (Proposed Technology Stack)

* **Backend Framework**: Node.js + Express.js with TypeScript
* **Database / ORM**: SQLite（WAL mode）+ Prisma ORM（單一 `.db` 檔案維持隨身碟可攜性，見第三節決策）
* **Realtime Engine**: Socket.io，取代現有 `ws_manager.py`，提供三級 Rooms 隔離：`course:{id}`（全班廣播/大螢幕投影）、`group:{id}`（小組討論/共同作業）、`user:{id}`（個人通知）
* **File Uploads**: Multer，寫入本機 `uploads/{course_id}/{unit_id}/...` 分層目錄，比照現有 `static/avatars` 慣例
* **Authentication**: JWT (access token) + HTTP-Only Cookie，密碼以 bcryptjs 雜湊；學生 QR Code 登入另用短效期一次性 token
* **前端**：延續現有 Vanilla JS + HTML/CSS 風格（`app.js`/`toolkit.js`/`audio-engine.js` 平移），必要處（如作業編輯器、討論串）才局部引入輕量框架，避免整包重寫成本過高
* **打包**：以 `pkg` 或 `nexe` 將 Node.js + Express 打包成單一 Windows `.exe`，維持與現有 `build_exe.py` 相同的隨身碟部署體驗

### 資料模型草案 (Prisma Schema Sketch)

在現有 `courses` / `students` / `groups` / `group_plans` / `attendance` / `evaluation_rules` / `score_logs` / `qualitative_notes` 之外，新增以下資料表（關聯式版本，對應 kyps 的 Firestore 集合設計）：

```
users          -- 統一存放 teacher/student 帳號密碼、角色（取代現有明碼/無帳密模式）
units          -- 大單元，屬於 course，order/is_hidden
sub_units      -- 小單元，屬於 unit，category(material/assignment/quiz)、due_date、group_scheme_id
materials      -- 教材附件（檔案路徑或外部連結、YouTube embed）
reading_progress -- 學生對 material 的閱讀紀錄（first/last viewed, view_count）
quiz_questions -- 測驗題目與配分，屬於 sub_unit
submissions    -- 作業/測驗繳交紀錄，is_group_submission 區分個人/小組
submission_comments -- 提問串，僅可新增不可修改刪除
forum_threads / forum_posts -- 主題討論區
notifications  -- 站內通知
live_sessions / live_wall_posts -- 即時互動牆
class_posts / class_post_comments -- 班級動態牆
```

既有的 `score_logs`（評分紀錄）在批改作業給分時，由 `submissions` 批改動作觸發寫入，複用現有 undo/軟刪除機制，不另建平行的分數系統。

---

## 七、 重構與開發分階段時程建議 (Implementation Phases)

1. **第一階段：Node.js 基礎環境與現有功能平移 (Migration Phase)**
   * 建立 Express + TypeScript + Prisma 專案骨架，設計並 migrate 現有 9 大功能維度的資料表（含 `users` 帳密改造）。
   * 平移課程/學生管理、分組、座位表、點名、加減分、質性紀錄、Excel 報表、大螢幕投影（Socket.io 取代原生 WebSocket）。
   * 驗收標準：教師既有工作流程（走動式點名、加減分、投影）100% 平移，無需重新學習操作。
2. **第二階段：帳號體系與課程素材模組 (Auth & Materials Phase)**
   * 實作 JWT 登入、教師/學生角色、學生批次建帳號、QR Code 課堂登入。
   * 開發單元/小單元結構、教材上傳與 YouTube 嵌入、閱讀進度追蹤。
3. **第三階段：作業、測驗與小組共筆系統 (Assignments, Quiz & Collaboration Phase)**
   * 個人/小組作業繳交與批改、與加減分聯動、逾期鎖定與解鎖申請流程。
   * 線上測驗出題與自動批改。
4. **第四階段：討論、即時互動與通知 (Forums, Live Wall & Notifications Phase)** — ✅ 即時互動牆與通知系統已完成；🚫 討論區、單元 Q&A、班級動態牆已廢除
   * 討論區、單元 Q&A、即時互動牆、班級動態牆、通知系統，統一走 Socket.io 三級 Rooms。
5. **第五階段：打包與隨身碟便攜化 (Packaging & Delivery)**
   * `pkg`/`nexe` 打包單一 exe、驗證雙軌部署（純點名模式 vs. 開課互動模式）在無網路區網環境下皆正常運作、資料庫備份/還原流程驗證。
