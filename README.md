# MyClass 課堂即時記錄系統

給國小教師使用的課堂管理工具：點名、加減分、分組、座位表、作業與測驗、即時互動牆，一套搭配大螢幕投影與學生手機／平板的區網系統。整個系統以單一 Node.js 伺服器執行，資料存在本機的 SQLite，不需要連到任何雲端服務，也可以打包成免安裝的隨身碟版或 Windows 安裝版。

## 功能

**教師端**
- 課程與學生名冊：導師／科任模式、文字貼上／CSV／Excel 匯入、學生照片
- 出缺席點名：出席、病假、事假、公假、喪假、遲到，保留點名歷程
- 量化加減分與排行榜：自訂評分規則、個人／多選／整組批次加分，當日、區間、學期累計
- 彈性分組：多套分組方案、自動分組；座位表與自動排座（隨機／性別平衡）
- 質性紀錄：文字備忘錄與圖片、影音附件；教學日誌、班級佈告欄
- 大螢幕投影：Socket.io 即時同步，手機／平板遙控加分，隨堂工具（倒數計時等）
- 課程素材：單元／小單元／教材（檔案、連結、YouTube），閱讀進度統計
- 作業與線上測驗：個人或小組繳交、評分、鎖定／退回；測驗自動批改、CSV 題庫匯入
- 即時互動：互動牆、文字雲、檔案收集、學生去向、點數卡與獎勵兌換
- 課表提醒、紙本測驗、題庫與報表（Excel 匯出）
- 作業掃描登記：僅限教師本機使用

**學生端**
- 以帳號與密碼登入，從手機或平板瀏覽教材、繳交作業、線上測驗、參與互動牆與兌換獎勵

## 技術

Node.js 22、Express、Socket.io、TypeScript、Prisma（SQLite）、純 HTML／JavaScript 前端（不依賴前端框架）。

## 快速開始（開發）

```bash
npm install
npm run dev
```

`npm run dev` 會自動尋找從 8000 起算的可用連接埠、建立或更新 SQLite 資料庫（`bin/classroom_record.db`）、產生自簽 TLS 憑證，並在伺服器就緒後開啟瀏覽器，同時在終端機印出供學生掃描的 QR Code。

需要正式編譯時：

```bash
npm run build   # prisma generate + tsc
npm start       # node dist/index.js
```

## 登入與安全設定

- 教師登入密碼為「**字頭 + 當天月日**」，例如字頭是 `MyPrefix`、今天是 10 月 14 日，密碼就是 `MyPrefix1014`。
- 全新安裝的預設字頭為 `Admin`，**第一次登入後系統會強制要求修改字頭**，改完才能使用其他功能。新字頭至少 4 碼且不可為 `Admin`。
- 「忘記密碼」的重置只能在教師本機操作，區網內其他裝置無法使用。
- 學生以個別帳號登入，預設密碼為座號四碼（例如 5 號為 `0005`），教師可在學生資料中自訂。
- 預設監聽所有網卡，讓區網內的學生裝置能連入。若只在教師本機使用，可設定環境變數 `MYCLASS_HOST=127.0.0.1`，伺服器就只接受本機連線。
- 跨來源請求（CORS）僅允許同源；所有資料（資料庫、照片、上傳檔、憑證）都在程式旁的 `bin/`，不會上傳到外部。
- 首次啟動時會在 `bin/certs/` 為本機自動產生自簽憑證，每份安裝各自獨立，**不要把 `bin/` 提交到版本控制或隨程式散布**（已列於 `.gitignore`）。

## 打包

| | Windows 可攜版 | Windows 安裝版 | macOS 可攜版 |
|---|---|---|---|
| 建置 | `build-win.bat`（`npm run build:exe:win`） | `build-win-installer.bat`（`npm run build:installer:win`） | `build-mac.command` 或 `build-mac.sh`（`npm run build:mac`） |
| 輸出 | `release\MyClassV版本\` | `release\MyClassSetupV版本.exe` | `release/MyClassV版本-Mac/` |
| 啟動 | 雙擊執行檔，開啟主控台並自動開啟瀏覽器 | 開始功能表／桌面捷徑，背景執行並在通知區顯示圖示 | 雙擊資料夾內的 `.command` |
| 資料位置 | 資料夾內 `bin\` | 預設 `C:\MyClass\bin\` | 資料夾內 `bin/` |

- 安裝版使用 Inno Setup 6（<https://jrsoftware.org/isdl.php>，或用環境變數 `ISCC_PATH` 指定 `ISCC.exe`），需要管理員身分以加入防火牆規則，區網內的學生裝置才連得進來。
- 通知區托盤程式（`tools/tray/MyClassTray.cs`）以 Windows 內建的 `csc.exe` 編譯，不需另外安裝 SDK。它負責隱藏啟動伺服器、意外結束時自動重啟，並提供開啟系統、複製學生連線網址、開機自動啟動等選項。
- 升級時只覆蓋程式檔，不動 `bin/`。每次程式版本改變後的第一次啟動，會先把資料庫備份到 `bin/backups/`（保留最近 10 份）。
- 同一份資料已有伺服器在執行時，再次啟動只會開啟既有網址，不會同時開兩個程序寫同一個資料庫。

## 專案結構

```
src/
  index.ts            Express + Socket.io 進入點、頁面與靜態檔路由
  db.ts               Prisma 初始化與等冪的資料表／欄位遷移
  paths.ts            可攜路徑（bin/、uploads/、photo/）
  runtime.ts          單一執行個體、背景模式與安全關閉
  backup.ts           升級前自動備份資料庫
  tls.ts              自簽憑證產生
  realtime.ts         Socket.io 房間與即時廣播
  middleware/         教師 session、學生 JWT、僅限本機的閘門
  routes/             各功能模組的 REST API
  utils/              匯入解析、評分、上傳等共用工具
prisma/schema.prisma  資料模型
static/               前端頁面、腳本、樣式與素材
scripts/              Windows／macOS 打包與圖示產生腳本
installer/            Inno Setup 安裝程式腳本
tools/tray/           Windows 通知區托盤程式
tools_cards/          點數卡片批次產生工具（Python，獨立使用）
```

## 常見問題

**iPhone 連不上，但平板可以？**
iPhone 同時有 Wi-Fi 與行動數據時，iOS 可能把流量送往行動網路，導致到不了校內伺服器（常見於伺服器是公開 IP、學生裝置經 NAT 連入的校園網路）。請先**關閉行動數據**，只用 Wi-Fi；也可以在「設定 → 行動服務 → Wi-Fi 輔助」關閉。

**第一次連線出現「此連線不是私人連線」？**
伺服器使用自簽憑證。點「顯示詳細資訊 → 造訪此網站」即可。憑證重新產生（換 IP 或到期更新）後需再確認一次。

## 已知限制

- 目前沒有自動化測試。
- `multer@1.x` 在安裝時有已知安全性警告，之後會評估升級。
- 全新安裝在教師第一次登入並修改字頭之前，預設密碼仍是 `Admin` 加當天月日。請在安裝後盡快完成第一次登入。
- 教師端目前沒有拖曳排序單元的介面，單元依建立順序排列。

## 素材來源

- 背景音樂（`static/music/`）取自 [Pixabay](https://pixabay.com/)，依其內容授權使用。
- 專案中的圖像、頭像與卡片背景由 AI 生成。

## 授權

本專案以 [PolyForm Noncommercial License 1.0.0](LICENSE) 授權：

- **可以**：個人、學校、教育機構與非營利組織使用、修改與散布，教師可自由用於教學。
- **不可以**：任何商業用途，包括販售、收費服務或納入商業產品。
- 散布時需附上授權條款與 `LICENSE` 內的 `Required Notice:` 行。

這是「原始碼公開、限制商業使用」的授權，依 OSI 定義不屬於開放原始碼授權。若需商業授權，請與作者聯繫。
