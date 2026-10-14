/**
 * ==========================================================================
 * MyClass 實體卡片視覺化排版與批次列印工作室 (Card Designer Studio)
 * 完全移植並超越原 tools_cards (PyQt6) 之功能
 * ==========================================================================
 */

(function () {
  "use strict";

  // 預設標準版面配置 (與 tools_cards/default_layout.json 完美一致)
  const DEFAULT_LAYOUT = {
    canvas_width: 800,
    canvas_height: 1200,
    background_theme: "custom",
    custom_background_url: null,
    // 可自由新增多個裝飾形狀（矩形／圓形／正三角形），每個形狀邊緣皆具備毛玻璃霧化效果
    shapes: [],
    qr_code: {
      enabled: true,
      x: 39,
      y: 633,
      width: 136,
      height: 136,
      error_correction: "M"
    },
    text_elements: {
      card_no: {
        enabled: true,
        x: 547,
        y: 755,
        font_size: 24,
        font_color: "#000000",
        font_weight: "bold",
        anchor: "right", // left, center, right
        prefix: "No.",
        replace_underscore_with_hyphen: true
      },
      card_value: {
        enabled: false,
        x: 280,
        y: 615,
        font_size: 28,
        font_color: "#C0392B",
        font_weight: "bold",
        anchor: "center",
        prefix: "點數："
      },
      card_label: {
        enabled: false,
        x: 400,
        y: 540,
        font_size: 26,
        font_color: "#1E293B",
        font_weight: "bold",
        anchor: "center",
        prefix: ""
      },
      card_code_text: {
        enabled: false,
        x: 39,
        y: 780,
        font_size: 14,
        font_color: "#333333",
        font_weight: "normal",
        anchor: "left",
        prefix: ""
      }
    }
  };

  // 各形狀類型的預設樣式參數
  const SHAPE_TYPE_LABELS = {
    rectangle: "⬛ 矩形",
    circle: "⚪ 圓形",
    triangle: "🔺 正三角形"
  };

  let shapeIdCounter = 0;
  function generateShapeId() {
    shapeIdCounter += 1;
    return `shape_${Date.now()}_${shapeIdCounter}`;
  }

  /** 建立一個新形狀的預設設定值 */
  function createDefaultShape(type) {
    const base = {
      id: generateShapeId(),
      type: type === "circle" || type === "triangle" ? type : "rectangle",
      enabled: true,
      x: 30,
      y: 620,
      width: 154,
      height: 154,
      radius: 12,
      fill_color: "#FFFFFF",
      fill_opacity: 0.85,
      border_color: "#CBD5E1",
      border_width: 2,
      edge_blur: 10 // 邊緣霧化（毛玻璃）強度，單位 px
    };
    if (base.type === "triangle") {
      // 正三角形以寬度做為邊長，高度依等邊三角形比例自動換算
      base.height = Math.round(base.width * (Math.sqrt(3) / 2));
    }
    return base;
  }

  /** 相容舊版單一圓角矩形（layout.rectangle）資料，遷移為 shapes 陣列 */
  function migrateLayoutShapes(layout) {
    if (!layout) return layout;
    if (!Array.isArray(layout.shapes)) {
      layout.shapes = [];
    }
    if (layout.rectangle && typeof layout.rectangle === "object") {
      const r = layout.rectangle;
      layout.shapes.push({
        id: generateShapeId(),
        type: "rectangle",
        enabled: r.enabled !== false,
        x: r.x !== undefined ? r.x : 30,
        y: r.y !== undefined ? r.y : 620,
        width: r.width !== undefined ? r.width : 154,
        height: r.height !== undefined ? r.height : 154,
        radius: r.radius !== undefined ? r.radius : 12,
        fill_color: r.fill_color || "#FFFFFF",
        fill_opacity: r.fill_opacity !== undefined ? r.fill_opacity : 0.9,
        border_color: r.border_color || "#CBD5E1",
        border_width: r.border_width !== undefined ? r.border_width : 2,
        edge_blur: 10
      });
      delete layout.rectangle;
    }
    layout.shapes.forEach((s) => {
      if (!s.id) s.id = generateShapeId();
      if (!s.type) s.type = "rectangle";
      if (s.edge_blur === undefined) s.edge_blur = 0;
    });
    return layout;
  }

  // 迷你 CRC32 與 Store 模式 Zip 生成器 (零依賴、純 JS、離線可執行)
  class SimpleZip {
    constructor() {
      this.files = [];
      this.crcTable = SimpleZip.makeCrcTable();
    }

    static makeCrcTable() {
      const table = new Uint32Array(256);
      for (let n = 0; n < 256; n++) {
        let c = n;
        for (let k = 0; k < 8; k++) {
          c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
        }
        table[n] = c;
      }
      return table;
    }

    calcCrc32(uint8Array) {
      let crc = 0 ^ -1;
      const table = this.crcTable;
      for (let i = 0; i < uint8Array.length; i++) {
        crc = (crc >>> 8) ^ table[(crc ^ uint8Array[i]) & 0xff];
      }
      return (crc ^ -1) >>> 0;
    }

    addFile(name, uint8Array) {
      this.files.push({
        name,
        data: uint8Array,
        crc: this.calcCrc32(uint8Array),
        size: uint8Array.length
      });
    }

    generateBlob() {
      const parts = [];
      const centralDir = [];
      let offset = 0;
      const encoder = new TextEncoder();

      for (const file of this.files) {
        const nameBytes = encoder.encode(file.name);
        const nameLen = nameBytes.length;

        // Local file header (30 bytes)
        const localHeader = new Uint8Array(30 + nameLen);
        const lView = new DataView(localHeader.buffer);
        lView.setUint32(0, 0x04034b50, true); // Local header signature
        lView.setUint16(4, 20, true); // Version needed
        lView.setUint16(6, 0x0800, true); // Flags (UTF-8)
        lView.setUint16(8, 0, true); // Compression: Store
        lView.setUint16(10, 0, true); // Mod time
        lView.setUint16(12, 0, true); // Mod date
        lView.setUint32(14, file.crc, true); // CRC32
        lView.setUint32(18, file.size, true); // Compressed size
        lView.setUint32(22, file.size, true); // Uncompressed size
        lView.setUint16(26, nameLen, true); // Filename length
        lView.setUint16(28, 0, true); // Extra length
        localHeader.set(nameBytes, 30);

        parts.push(localHeader);
        parts.push(file.data);

        // Central Directory Entry (46 bytes)
        const cdEntry = new Uint8Array(46 + nameLen);
        const cView = new DataView(cdEntry.buffer);
        cView.setUint32(0, 0x02014b50, true); // Central directory signature
        cView.setUint16(4, 20, true); // Made by
        cView.setUint16(6, 20, true); // Version needed
        cView.setUint16(8, 0x0800, true); // Flags (UTF-8)
        cView.setUint16(10, 0, true); // Compression: Store
        cView.setUint16(12, 0, true); // Mod time
        cView.setUint16(14, 0, true); // Mod date
        cView.setUint32(16, file.crc, true); // CRC32
        cView.setUint32(20, file.size, true); // Compressed size
        cView.setUint32(24, file.size, true); // Uncompressed size
        cView.setUint16(28, nameLen, true); // Filename length
        cView.setUint16(30, 0, true); // Extra length
        cView.setUint16(32, 0, true); // Comment length
        cView.setUint16(34, 0, true); // Disk start
        cView.setUint16(36, 0, true); // Internal attrs
        cView.setUint32(38, 0, true); // External attrs
        cView.setUint32(42, offset, true); // Relative offset of local header
        cdEntry.set(nameBytes, 46);

        centralDir.push(cdEntry);
        offset += localHeader.length + file.size;
      }

      let cdSize = 0;
      for (const entry of centralDir) {
        parts.push(entry);
        cdSize += entry.length;
      }

      // End of central directory record (22 bytes)
      const eocd = new Uint8Array(22);
      const eView = new DataView(eocd.buffer);
      eView.setUint32(0, 0x06054b50, true);
      eView.setUint16(4, 0, true);
      eView.setUint16(6, 0, true);
      eView.setUint16(8, this.files.length, true);
      eView.setUint16(10, this.files.length, true);
      eView.setUint32(12, cdSize, true);
      eView.setUint32(16, offset, true);
      eView.setUint16(20, 0, true);
      parts.push(eocd);

      return new Blob(parts, { type: "application/zip" });
    }
  }

  // CardDesignerStudio 主控制器
  const CardDesignerStudio = {
    isOpen: false,
    courseId: null,
    seriesList: [],
    currentSeriesId: null,
    cardsList: [],
    currentIndex: 0,
    layout: JSON.parse(JSON.stringify(DEFAULT_LAYOUT)),

    // Canvas 狀態
    canvas: null,
    ctx: null,
    zoomScale: 0.5, // 顯示縮放比
    activeElementKey: "qr_code", // "qr_code" | "card_no" | "card_value" | "card_label" | "card_code_text" | "shape:<id>"
    isDragging: false,
    dragStartX: 0,
    dragStartY: 0,
    elementOrigX: 0,
    elementOrigY: 0,

    // 快取圖檔
    bgImageCache: new Map(),
    qrCache: new Map(),

    init() {
      this.bindModalEvents();
      this.bindInspectorEvents();
      this.bindCanvasMouseEvents();
    },

    /** 開啟設計器並載入指定班級與系列資料 */
    async open(courseId = null, targetSeriesId = null) {
      if (!courseId) {
        if (window.AppState && window.AppState.currentCourseId) {
          courseId = Number(window.AppState.currentCourseId);
        } else {
          const select = document.getElementById("course-select");
          if (select && select.value) courseId = Number(select.value);
        }
      }

      this.courseId = courseId;
      this.isOpen = true;

      const modal = document.getElementById("modal-card-designer-studio");
      if (modal) {
        modal.classList.add("open");
        modal.style.display = "flex";
      }
      if (typeof window.openModal === "function") {
        window.openModal("modal-card-designer-studio");
      }

      this.canvas = document.getElementById("card-designer-canvas");
      if (this.canvas) {
        this.ctx = this.canvas.getContext("2d");
      }

      await this.loadSeriesAndCards(targetSeriesId);
      this.fitCanvasToContainer();
      this.render();

      // 再次延遲計算，等待 CSS 動畫與 DOM 佈局完全展開
      setTimeout(() => {
        this.fitCanvasToContainer();
        this.render();
      }, 80);
    },

    close() {
      this.isOpen = false;
      const modal = document.getElementById("modal-card-designer-studio");
      if (modal) {
        modal.classList.remove("open");
        modal.style.display = "none";
      }
      if (typeof window.closeModal === "function") {
        window.closeModal("modal-card-designer-studio");
      }
    },

    /** 讀取系列清單與點數卡資料 */
    async loadSeriesAndCards(targetSeriesId = null) {
      if (!this.courseId) {
        this.seriesList = [];
        this.allCardsData = [];
        this.populateSeriesSelect();
        this.onSeriesChanged();
        return;
      }

      try {
        const [seriesRes, cardsRes] = await Promise.all([
          fetch(`/api/point-cards/${this.courseId}/series`),
          fetch(`/api/point-cards/${this.courseId}`)
        ]);

        if (seriesRes.ok) {
          const sData = await seriesRes.json();
          this.seriesList = sData.series || [];
          this.populateSeriesSelect();
        }

        if (cardsRes.ok) {
          const allCards = await cardsRes.json();
          this.allCardsData = allCards;
        }

        // 決定當前選取的系列
        if (targetSeriesId && this.seriesList.some((s) => s.id === Number(targetSeriesId))) {
          this.currentSeriesId = Number(targetSeriesId);
        } else if (this.seriesList.length > 0) {
          this.currentSeriesId = this.seriesList[0].id;
        } else {
          this.currentSeriesId = null;
        }

        const selectEl = document.getElementById("studio-series-select");
        if (selectEl) {
          selectEl.value = this.currentSeriesId ? String(this.currentSeriesId) : "all";
        }

        this.onSeriesChanged();
      } catch (err) {
        console.error("[CardDesigner] 載入卡片資料失敗:", err);
      }
    },

    populateSeriesSelect() {
      const select = document.getElementById("studio-series-select");
      if (!select) return;
      select.innerHTML = `<option value="all">📦 全部卡片 (${this.allCardsData?.length || 0})</option>`;
      this.seriesList.forEach((s) => {
        const opt = document.createElement("option");
        opt.value = String(s.id);
        opt.textContent = `🏷️ ${s.name} (${s.card_count || 0})`;
        select.appendChild(opt);
      });
    },

    onSeriesChanged() {
      const select = document.getElementById("studio-series-select");
      const val = select ? select.value : "all";

      if (val === "all") {
        this.currentSeriesId = null;
        this.cardsList = this.allCardsData || [];
        this.loadLayoutForSeries(null);
      } else {
        this.currentSeriesId = Number(val);
        this.cardsList = (this.allCardsData || []).filter((c) => c.series_id === this.currentSeriesId);
        const seriesObj = this.seriesList.find((s) => s.id === this.currentSeriesId);
        this.loadLayoutForSeries(seriesObj);
      }

      this.currentIndex = 0;
      this.updatePagerUI();
      this.renderShapeTabs();
      this.syncInspectorFromLayout();
      this.render();
    },

    /** 載入該系列的版面設定（若有已存版面則套用，否則使用預設並帶入系列主題） */
    loadLayoutForSeries(seriesObj) {
      if (seriesObj && seriesObj.layout_config) {
        this.layout = JSON.parse(JSON.stringify(seriesObj.layout_config));
      } else {
        // 嘗試從 localStorage 讀取
        const saved = localStorage.getItem(`teachsys_card_layout_${this.currentSeriesId || "default"}`);
        if (saved) {
          try {
            this.layout = JSON.parse(saved);
          } catch {
            this.layout = JSON.parse(JSON.stringify(DEFAULT_LAYOUT));
            this.layout.background_theme = "custom";
          }
        } else {
          this.layout = JSON.parse(JSON.stringify(DEFAULT_LAYOUT));
          this.layout.background_theme = "custom";
        }
      }
      migrateLayoutShapes(this.layout);
    },

    /** 儲存版面設定至伺服器資料庫與本機快取 */
    async saveLayout() {
      const btnSave = document.getElementById("btn-studio-save-layout");
      if (btnSave) {
        btnSave.disabled = true;
        btnSave.textContent = "💾 儲存中...";
      }

      try {
        localStorage.setItem(`teachsys_card_layout_${this.currentSeriesId || "default"}`, JSON.stringify(this.layout));

        if (this.currentSeriesId) {
          const res = await fetch(`/api/point-cards/series/${this.currentSeriesId}/layout`, {
            method: "PUT",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ layout_config: this.layout })
          });
          if (!res.ok) throw new Error("儲存失敗");
        }

        if (window.showToast) {
          window.showToast("✅ 卡片排版設定已成功儲存！", "success");
        } else {
          alert("卡片排版設定已成功儲存！");
        }
      } catch (err) {
        console.error("[CardDesigner] 儲存失敗:", err);
        alert("儲存排版設定時發生錯誤，請稍後再試。");
      } finally {
        if (btnSave) {
          btnSave.disabled = false;
          btnSave.innerHTML = "💾 <span>儲存排版</span>";
        }
      }
    },

    /** 重設回預設版面 */
    async resetLayout() {
      const confirmed = window.showConfirmModal
        ? await window.showConfirmModal({ icon: "🔄", title: "確定要重設目前系列的卡片版面為系統預設值嗎？" })
        : confirm("確定要重設目前系列的卡片版面為系統預設值嗎？");
      if (!confirmed) return;
      this.layout = JSON.parse(JSON.stringify(DEFAULT_LAYOUT));
      this.layout.background_theme = "custom";
      this.activeElementKey = "qr_code";
      this.renderShapeTabs();
      this.syncInspectorFromLayout();
      this.render();
      if (window.showToast) window.showToast("已還原預設版面設定", "info");
    },

    // ------------------------------------------------------------------------
    // 繪圖核心與 HTML5 Canvas
    // ------------------------------------------------------------------------

    /** 自動計算適當縮放比讓卡片完整適配舞台 */
    fitCanvasToContainer() {
      const stage = document.querySelector(".studio-canvas-stage");
      let stageWidth = stage ? stage.clientWidth - 60 : 0;
      let stageHeight = stage ? stage.clientHeight - 60 : 0;

      if (stageWidth <= 100 || stageHeight <= 100) {
        stageWidth = Math.max(320, (window.innerWidth || 1024) * 0.45);
        stageHeight = Math.max(400, (window.innerHeight || 768) * 0.7);
      }

      const cw = this.layout.canvas_width || 800;
      const ch = this.layout.canvas_height || 1200;

      const scaleX = stageWidth / cw;
      const scaleY = stageHeight / ch;
      this.zoomScale = Math.max(0.25, Math.min(scaleX, scaleY, 0.75));
      this.updateZoomDisplay();
    },

    updateZoomDisplay() {
      const textEl = document.getElementById("studio-zoom-text");
      if (textEl) {
        textEl.textContent = `${Math.round(this.zoomScale * 100)}%`;
      }
      this.applyCanvasCssSize();
    },

    applyCanvasCssSize() {
      if (!this.canvas) return;
      const cw = this.layout.canvas_width || 800;
      const ch = this.layout.canvas_height || 1200;
      this.canvas.width = cw;
      this.canvas.height = ch;
      this.canvas.style.width = `${cw * this.zoomScale}px`;
      this.canvas.style.height = `${ch * this.zoomScale}px`;
    },

    getCurrentCard() {
      if (!this.cardsList || this.cardsList.length === 0) {
        return {
          card_no: "A-001",
          code: "CARD-DEMO-0001",
          label: "認真發言",
          score: 2,
          image: null
        };
      }
      return this.cardsList[this.currentIndex] || this.cardsList[0];
    },

    /** 取得當前卡片底圖 URL (完全由使用者自訂上傳) */
    resolveCardBgUrl(card) {
      if (this.layout.custom_background_url) {
        return this.layout.custom_background_url;
      }
      const currentSeries = this.seriesList.find((s) => s.id === (card?.series_id || this.currentSeriesId));
      const customImages = currentSeries?.custom_images || card?.series_custom_images;
      if (customImages && typeof customImages === "object") {
        const scoreKey = String(card?.score ?? 1);
        const absKey = String(Math.abs(card?.score ?? 1));
        if (customImages[scoreKey]) return customImages[scoreKey];
        if (customImages[absKey]) return customImages[absKey];
        if (customImages["default"]) return customImages["default"];
        const firstVal = Object.values(customImages).find((v) => typeof v === "string" && v.length > 0);
        if (firstVal) return firstVal;
      }

      if (card && card.image && (card.image.startsWith("/") || card.image.startsWith("http://") || card.image.startsWith("https://") || card.image.startsWith("data:"))) {
        return card.image;
      }
      return null;
    },

    /** 非同步載入圖檔快取 */
    loadImage(url) {
      if (!url) return Promise.resolve(null);
      if (this.bgImageCache.has(url)) {
        return Promise.resolve(this.bgImageCache.get(url));
      }
      return new Promise((resolve) => {
        const img = new Image();
        img.crossOrigin = "anonymous";
        img.onload = () => {
          this.bgImageCache.set(url, img);
          resolve(img);
        };
        img.onerror = () => {
          resolve(null);
        };
        img.src = url;
      });
    },

    /** 取得或產生 QR Code Data URL */
    async loadQrCodeDataUrl(text) {
      if (!text) return null;
      if (this.qrCache.has(text)) {
        return this.qrCache.get(text);
      }
      try {
        const res = await fetch(`/api/point-cards/tools/qrcode?text=${encodeURIComponent(text)}`);
        if (res.ok) {
          const data = await res.json();
          this.qrCache.set(text, data.dataUrl);
          return data.dataUrl;
        }
      } catch (e) {
        console.warn("[CardDesigner] 後端 QR Code 生成失敗:", e);
      }
      return null;
    },

    /** 核心繪製流程 */
    async render() {
      if (!this.canvas || !this.ctx) return;
      const ctx = this.ctx;
      const cw = this.layout.canvas_width || 800;
      const ch = this.layout.canvas_height || 1200;

      ctx.clearRect(0, 0, cw, ch);

      const card = this.getCurrentCard();
      const bgUrl = this.resolveCardBgUrl(card);

      // 1. 繪製底圖
      const bgImg = await this.loadImage(bgUrl);
      if (bgImg) {
        ctx.drawImage(bgImg, 0, 0, cw, ch);
      } else {
        // Fallback 未上傳專屬風格底圖時之柔和卡片背景與提示
        const grad = ctx.createLinearGradient(0, 0, cw, ch);
        grad.addColorStop(0, "#f8fafc");
        grad.addColorStop(1, "#e2e8f0");
        ctx.fillStyle = grad;
        ctx.fillRect(0, 0, cw, ch);

        ctx.save();
        ctx.strokeStyle = "#cbd5e1";
        ctx.lineWidth = 4;
        ctx.setLineDash([12, 8]);
        ctx.strokeRect(24, 24, cw - 48, ch - 48);
        ctx.restore();

        ctx.save();
        ctx.fillStyle = "#94a3b8";
        ctx.font = "bold 26px sans-serif";
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.fillText("🎨 請於右側面板上傳卡片風格底圖", cw / 2, ch / 2 - 40);
        ctx.font = "20px sans-serif";
        ctx.fillStyle = "#64748b";
        ctx.fillText(`(當前卡片分數：${card.score >= 0 ? "+" : ""}${card.score} 分)`, cw / 2, ch / 2);
        ctx.restore();
      }

      // 1.5. 繪製自訂裝飾形狀（矩形／圓形／正三角形，具毛玻璃霧化邊緣）
      const shapesConf = this.layout.shapes;
      if (Array.isArray(shapesConf)) {
        for (const shapeConf of shapesConf) {
          if (shapeConf && shapeConf.enabled) {
            this.drawShape(ctx, shapeConf, this.canvas);
          }
        }
      }

      // 2. 繪製 QR Code
      const qrConf = this.layout.qr_code;
      if (qrConf && qrConf.enabled) {
        const qrDataUrl = await this.loadQrCodeDataUrl(card.code || "CARD-SAMPLE");
        if (qrDataUrl) {
          const qrImg = await this.loadImage(qrDataUrl);
          if (qrImg) {
            ctx.drawImage(qrImg, qrConf.x, qrConf.y, qrConf.width, qrConf.height);
          }
        } else {
          // 佔位框
          ctx.fillStyle = "#ffffff";
          ctx.fillRect(qrConf.x, qrConf.y, qrConf.width, qrConf.height);
          ctx.strokeStyle = "#3b82f6";
          ctx.lineWidth = 2;
          ctx.strokeRect(qrConf.x, qrConf.y, qrConf.width, qrConf.height);
        }
      }

      // 3. 繪製文字元素
      const texts = this.layout.text_elements;
      if (texts) {
        // 卡號 No.
        if (texts.card_no && texts.card_no.enabled) {
          let noText = card.card_no || "A-001";
          if (texts.card_no.replace_underscore_with_hyphen) {
            noText = noText.replace(/_/g, "-");
          }
          const fullText = (texts.card_no.prefix || "") + noText;
          this.drawTextElement(ctx, texts.card_no, fullText);
        }

        // 點數分數
        if (texts.card_value && texts.card_value.enabled) {
          const scoreVal = card.score !== undefined ? card.score : 2;
          const fullText = (texts.card_value.prefix || "") + (scoreVal > 0 ? `+${scoreVal}` : scoreVal);
          this.drawTextElement(ctx, texts.card_value, fullText);
        }

        // 卡片名稱
        if (texts.card_label && texts.card_label.enabled) {
          const fullText = (texts.card_label.prefix || "") + (card.label || "榮譽點數卡");
          this.drawTextElement(ctx, texts.card_label, fullText);
        }

        // 卡號內容純文字 (條碼代碼)
        if (texts.card_code_text && texts.card_code_text.enabled) {
          const fullText = (texts.card_code_text.prefix || "") + (card.code || "CARD-0001");
          this.drawTextElement(ctx, texts.card_code_text, fullText);
        }
      }

      // 4. 繪製當前選取中的元素高亮虛線外框與錨點控制項
      this.drawActiveElementHighlight(ctx);
    },

    /** 依形狀類型建立繪製路徑：矩形（可圓角）／圓形／正三角形 */
    buildShapePath(type, x, y, w, h, radius) {
      const path = new Path2D();
      const width = Math.max(0, w || 0);
      const height = Math.max(0, h || 0);

      if (type === "circle") {
        const cx = x + width / 2;
        const cy = y + height / 2;
        path.ellipse(cx, cy, width / 2, height / 2, 0, 0, Math.PI * 2);
        path.closePath();
      } else if (type === "triangle") {
        // 正三角形：頂點朝上，底邊寬度即為畫布上之外框寬度
        const topX = x + width / 2;
        path.moveTo(topX, y);
        path.lineTo(x + width, y + height);
        path.lineTo(x, y + height);
        path.closePath();
      } else {
        const r = Math.max(0, Math.min(radius !== undefined ? radius : 12, width / 2, height / 2));
        if (typeof path.roundRect === "function") {
          path.roundRect(x, y, width, height, r);
        } else {
          path.moveTo(x + r, y);
          path.lineTo(x + width - r, y);
          path.quadraticCurveTo(x + width, y, x + width, y + r);
          path.lineTo(x + width, y + height - r);
          path.quadraticCurveTo(x + width, y + height, x + width - r, y + height);
          path.lineTo(x + r, y + height);
          path.quadraticCurveTo(x, y + height, x, y + height - r);
          path.lineTo(x, y + r);
          path.quadraticCurveTo(x, y, x + r, y);
          path.closePath();
        }
      }
      return path;
    },

    /** 繪製單一裝飾形狀（矩形／圓形／正三角形），並套用毛玻璃霧化邊緣效果 */
    drawShape(ctx, conf, sourceCanvas) {
      if (!conf) return;
      const type = conf.type === "circle" || conf.type === "triangle" ? conf.type : "rectangle";
      const x = conf.x || 0;
      const y = conf.y || 0;
      const w = conf.width || 100;
      const h = conf.height || 100;
      const fillOpacity = conf.fill_opacity !== undefined ? Math.max(0, Math.min(1, conf.fill_opacity)) : 1;
      const fillColor = conf.fill_color || "#FFFFFF";
      const borderWidth = conf.border_width !== undefined ? conf.border_width : 0;
      const borderColor = conf.border_color || "#CBD5E1";
      const edgeBlur = Math.max(0, conf.edge_blur !== undefined ? conf.edge_blur : 0);

      const path = this.buildShapePath(type, x, y, w, h, conf.radius);

      // 1. 半透明填色（形狀內部基礎玻璃色調）
      if (fillColor && fillColor !== "none" && fillOpacity > 0) {
        ctx.save();
        ctx.globalAlpha = fillOpacity;
        ctx.fillStyle = fillColor;
        ctx.fill(path);
        ctx.restore();
      }

      // 2. 邊框（先繪製一圈實邊界定形狀輪廓）
      if (borderWidth > 0 && borderColor && borderColor !== "none") {
        ctx.save();
        ctx.lineWidth = borderWidth;
        ctx.strokeStyle = borderColor;
        ctx.stroke(path);
        ctx.restore();
      }

      // 3. 邊緣霧化：沿形狀邊界（跨越邊框內外側）擷取既有畫面內容模糊化後疊加，
      //    使邊框/邊界呈現真正的毛玻璃霧化質感，而非僅剩一條清晰邊線
      if (edgeBlur > 0 && sourceCanvas) {
        this.drawFrostedEdgeRing(ctx, path, sourceCanvas, x, y, w, h, borderWidth, borderColor, edgeBlur);
      }
    },

    /**
     * 沿形狀邊界建立一圈毛玻璃霧化環：擷取邊界周圍（跨越邊框內外側）既有畫面內容、
     * 模糊化後僅保留貼齊邊界的環狀範圍並疊加回畫布，讓邊框本身呈現霧化質感。
     */
    drawFrostedEdgeRing(ctx, path, sourceCanvas, x, y, w, h, borderWidth, borderColor, edgeBlur) {
      const pad = edgeBlur + borderWidth + 4;
      const sx = Math.max(0, Math.floor(x - pad));
      const sy = Math.max(0, Math.floor(y - pad));
      const ex = Math.min(sourceCanvas.width, Math.ceil(x + w + pad));
      const ey = Math.min(sourceCanvas.height, Math.ceil(y + h + pad));
      const sw = ex - sx;
      const sh = ey - sy;
      if (sw <= 0 || sh <= 0) return;

      const off = document.createElement("canvas");
      off.width = sw;
      off.height = sh;
      const octx = off.getContext("2d");

      try {
        // 3a. 擷取形狀邊界周圍畫面內容並模糊化
        octx.filter = `blur(${edgeBlur}px)`;
        octx.drawImage(sourceCanvas, sx, sy, sw, sh, 0, 0, sw, sh);
        octx.filter = "none";

        // 3b. 僅保留貼齊形狀邊界、跨越邊框內外側的環狀範圍（其餘裁除為透明）
        octx.globalCompositeOperation = "destination-in";
        octx.translate(-sx, -sy);
        octx.lineWidth = Math.max(borderWidth, 2) + edgeBlur;
        octx.strokeStyle = "#000";
        octx.stroke(path);
        octx.setTransform(1, 0, 0, 1, 0, 0);

        // 3c. 以邊框顏色淡淡染色，使霧化環與使用者設定之邊框顏色協調一致
        if (borderColor && borderColor !== "none") {
          octx.globalCompositeOperation = "source-atop";
          octx.globalAlpha = 0.35;
          octx.fillStyle = borderColor;
          octx.fillRect(0, 0, sw, sh);
        }

        ctx.save();
        ctx.globalAlpha = 0.85;
        ctx.drawImage(off, sx, sy);
        ctx.restore();
      } catch (e) {
        // 部分舊版瀏覽器不支援 canvas filter，靜默略過毛玻璃霧化邊緣效果即可
      }
    },

    drawTextElement(ctx, conf, text) {
      ctx.save();
      const fontSize = conf.font_size || 22;
      const fontWeight = conf.font_weight || "bold";
      ctx.font = `${fontWeight} ${fontSize}px "Segoe UI", "Microsoft JhengHei UI", sans-serif`;
      ctx.fillStyle = conf.font_color || "#000000";
      ctx.textBaseline = "middle";

      let textAlign = "left";
      if (conf.anchor === "center" || conf.anchor === "mm") textAlign = "center";
      if (conf.anchor === "right" || conf.anchor === "rm") textAlign = "right";
      ctx.textAlign = textAlign;

      ctx.fillText(text, conf.x, conf.y);
      ctx.restore();
    },

    /** 繪製選取框與移動十字錨點 */
    drawActiveElementHighlight(ctx) {
      const bbox = this.getElementBoundingBox(this.activeElementKey);
      if (!bbox) return;

      ctx.save();
      ctx.strokeStyle = "#4f46e5";
      ctx.lineWidth = 2.5;
      ctx.setLineDash([6, 4]);
      ctx.strokeRect(bbox.x - 4, bbox.y - 4, bbox.width + 8, bbox.height + 8);

      // 四個頂角小控制方塊
      ctx.setLineDash([]);
      ctx.fillStyle = "#ffffff";
      ctx.strokeStyle = "#4f46e5";
      ctx.lineWidth = 2;
      const cornerSize = 7;
      const corners = [
        [bbox.x - 4, bbox.y - 4],
        [bbox.x + bbox.width + 4, bbox.y - 4],
        [bbox.x - 4, bbox.y + bbox.height + 4],
        [bbox.x + bbox.width + 4, bbox.y + bbox.height + 4]
      ];
      for (const [cx, cy] of corners) {
        ctx.fillRect(cx - cornerSize / 2, cy - cornerSize / 2, cornerSize, cornerSize);
        ctx.strokeRect(cx - cornerSize / 2, cy - cornerSize / 2, cornerSize, cornerSize);
      }
      ctx.restore();
    },

    /** 計算元素的包圍盒 (Bounding Box) 用於滑鼠點擊偵測與選取框 */
    getElementBoundingBox(key) {
      if (!this.ctx) return null;
      const card = this.getCurrentCard();

      if (key === "qr_code") {
        const qr = this.layout.qr_code;
        if (!qr || !qr.enabled) return null;
        return { x: qr.x, y: qr.y, width: qr.width, height: qr.height };
      }

      if (typeof key === "string" && key.indexOf("shape:") === 0) {
        const shapeId = key.slice(6);
        const shape = (this.layout.shapes || []).find((s) => s.id === shapeId);
        if (!shape || !shape.enabled) return null;
        return { x: shape.x, y: shape.y, width: shape.width, height: shape.height };
      }

      const txtConf = this.layout.text_elements?.[key];
      if (!txtConf || !txtConf.enabled) return null;

      let text = "";
      if (key === "card_no") {
        let noText = card.card_no || "A-001";
        if (txtConf.replace_underscore_with_hyphen) noText = noText.replace(/_/g, "-");
        text = (txtConf.prefix || "") + noText;
      } else if (key === "card_value") {
        text = (txtConf.prefix || "") + (card.score !== undefined ? card.score : "+2");
      } else if (key === "card_label") {
        text = (txtConf.prefix || "") + (card.label || "榮譽點數卡");
      } else if (key === "card_code_text") {
        text = (txtConf.prefix || "") + (card.code || "CARD-0001");
      }

      this.ctx.save();
      const fontSize = txtConf.font_size || 22;
      this.ctx.font = `bold ${fontSize}px "Microsoft JhengHei UI", sans-serif`;
      const metrics = this.ctx.measureText(text);
      const textWidth = metrics.width;
      const textHeight = fontSize * 1.2;
      this.ctx.restore();

      let x = txtConf.x;
      if (txtConf.anchor === "center" || txtConf.anchor === "mm") {
        x = txtConf.x - textWidth / 2;
      } else if (txtConf.anchor === "right" || txtConf.anchor === "rm") {
        x = txtConf.x - textWidth;
      }

      const y = txtConf.y - textHeight / 2;
      return { x, y, width: textWidth, height: textHeight };
    },

    // ------------------------------------------------------------------------
    // 畫布滑鼠互動（拖拉定位、點擊選取）
    // ------------------------------------------------------------------------

    bindCanvasMouseEvents() {
      const container = document.querySelector(".studio-canvas-container");
      if (!container) return;

      const getCanvasPos = (e) => {
        const rect = this.canvas.getBoundingClientRect();
        return {
          x: (e.clientX - rect.left) / this.zoomScale,
          y: (e.clientY - rect.top) / this.zoomScale
        };
      };

      container.addEventListener("mousedown", (e) => {
        const pos = getCanvasPos(e);

        // 偵測點擊到了哪個元素（由前景至後景；形狀彼此間則後繪製者優先，即由上層往下層偵測）
        const shapeKeys = (this.layout.shapes || []).map((s) => `shape:${s.id}`).reverse();
        const keys = ["card_no", "card_value", "card_label", "card_code_text", "qr_code", ...shapeKeys];
        let hitKey = null;

        for (const k of keys) {
          const bbox = this.getElementBoundingBox(k);
          if (
            bbox &&
            pos.x >= bbox.x - 8 &&
            pos.x <= bbox.x + bbox.width + 8 &&
            pos.y >= bbox.y - 8 &&
            pos.y <= bbox.y + bbox.height + 8
          ) {
            hitKey = k;
            break;
          }
        }

        if (hitKey) {
          this.activeElementKey = hitKey;
          this.syncElementTab();
          this.syncInspectorFromLayout();

          this.isDragging = true;
          this.dragStartX = pos.x;
          this.dragStartY = pos.y;

          const elem = this.getActiveElementConfig();
          this.elementOrigX = elem?.x || 0;
          this.elementOrigY = elem?.y || 0;

          this.canvas.style.cursor = "grabbing";
          this.render();
        }
      });

      window.addEventListener("mousemove", (e) => {
        if (!this.isDragging || !this.activeElementKey) return;
        const pos = getCanvasPos(e);
        const dx = Math.round(pos.x - this.dragStartX);
        const dy = Math.round(pos.y - this.dragStartY);

        const elem = this.getActiveElementConfig();

        if (elem) {
          elem.x = Math.max(0, Math.min(this.layout.canvas_width, this.elementOrigX + dx));
          elem.y = Math.max(0, Math.min(this.layout.canvas_height, this.elementOrigY + dy));
          this.syncPositionInputs();
          this.render();
        }
      });

      window.addEventListener("mouseup", () => {
        if (this.isDragging) {
          this.isDragging = false;
          if (this.canvas) this.canvas.style.cursor = "default";
        }
      });
    },

    // ------------------------------------------------------------------------
    // 右側檢查面板微調與雙向連動
    // ------------------------------------------------------------------------

    bindInspectorEvents() {
      // 元素標籤點擊切換
      document.querySelectorAll(".element-tab-btn").forEach((btn) => {
        btn.addEventListener("click", () => {
          this.activeElementKey = btn.getAttribute("data-element");
          this.syncElementTab();
          this.syncInspectorFromLayout();
          this.render();
        });
      });

      // 元素開關 Toggle
      const chkEnabled = document.getElementById("studio-elem-enabled");
      if (chkEnabled) {
        chkEnabled.addEventListener("change", (e) => {
          const elem = this.getActiveElementConfig();
          if (elem) {
            elem.enabled = e.target.checked;
            this.render();
          }
        });
      }

      // 座標 X / Y 步進與數值輸入
      this.bindStepInput("studio-pos-x", (val) => {
        const elem = this.getActiveElementConfig();
        if (elem) {
          elem.x = val;
          this.render();
        }
      });

      this.bindStepInput("studio-pos-y", (val) => {
        const elem = this.getActiveElementConfig();
        if (elem) {
          elem.y = val;
          this.render();
        }
      });

      // QR Code 尺寸步進與數值輸入
      this.bindStepInput("studio-qr-size", (val) => {
        if (this.layout.qr_code) {
          this.layout.qr_code.width = val;
          this.layout.qr_code.height = val;
          this.render();
        }
      });

      // 字型大小步進與數值輸入
      this.bindStepInput("studio-font-size", (val) => {
        const elem = this.getActiveElementConfig();
        if (elem && elem !== this.layout.qr_code) {
          elem.font_size = val;
          this.render();
        }
      });

      // 文字顏色 (Color Picker + Hex Text)
      const colorPicker = document.getElementById("studio-font-color");
      const colorText = document.getElementById("studio-font-color-hex");
      if (colorPicker && colorText) {
        colorPicker.addEventListener("input", (e) => {
          colorText.value = e.target.value.toUpperCase();
          const elem = this.getActiveElementConfig();
          if (elem && elem !== this.layout.qr_code) {
            elem.font_color = e.target.value;
            this.render();
          }
        });
        colorText.addEventListener("input", (e) => {
          const val = e.target.value.trim();
          if (/^#[0-9A-Fa-f]{6}$/.test(val)) {
            colorPicker.value = val;
            const elem = this.getActiveElementConfig();
            if (elem && elem !== this.layout.qr_code) {
              elem.font_color = val;
              this.render();
            }
          }
        });
      }

      // 形狀類型切換（矩形／圓形／正三角形互相轉換）
      const shapeTypeSelect = document.getElementById("studio-shape-type");
      if (shapeTypeSelect) {
        shapeTypeSelect.addEventListener("change", (e) => {
          const shape = this.getActiveShape();
          if (shape) {
            shape.type = e.target.value;
            if (shape.type === "triangle") {
              shape.height = Math.round((shape.width || 100) * (Math.sqrt(3) / 2));
            }
            this.renderShapeTabs();
            this.syncInspectorFromLayout();
            this.render();
          }
        });
      }

      // 形狀寬度、高度、圓角半徑、透明度、邊框粗細、邊緣霧化強度
      this.bindStepInput("studio-shape-w", (val) => {
        const shape = this.getActiveShape();
        if (shape) {
          shape.width = val;
          if (shape.type === "triangle") {
            shape.height = Math.round(val * (Math.sqrt(3) / 2));
          }
          this.render();
        }
      });
      this.bindStepInput("studio-shape-h", (val) => {
        const shape = this.getActiveShape();
        if (shape) {
          shape.height = val;
          this.render();
        }
      });
      this.bindStepInput("studio-shape-radius", (val) => {
        const shape = this.getActiveShape();
        if (shape) {
          shape.radius = val;
          this.render();
        }
      });
      this.bindStepInput("studio-shape-opacity", (val) => {
        const shape = this.getActiveShape();
        if (shape) {
          shape.fill_opacity = val / 100;
          this.render();
        }
      });
      this.bindStepInput("studio-shape-border-width", (val) => {
        const shape = this.getActiveShape();
        if (shape) {
          shape.border_width = val;
          this.render();
        }
      });
      this.bindStepInput("studio-shape-blur", (val) => {
        const shape = this.getActiveShape();
        if (shape) {
          shape.edge_blur = val;
          this.render();
        }
      });

      // 形狀填滿顏色
      const shapeFillColor = document.getElementById("studio-shape-fill-color");
      const shapeFillText = document.getElementById("studio-shape-fill-color-hex");
      if (shapeFillColor && shapeFillText) {
        shapeFillColor.addEventListener("input", (e) => {
          shapeFillText.value = e.target.value.toUpperCase();
          const shape = this.getActiveShape();
          if (shape) {
            shape.fill_color = e.target.value;
            this.render();
          }
        });
        shapeFillText.addEventListener("input", (e) => {
          const val = e.target.value.trim();
          if (/^#[0-9A-Fa-f]{6}$/.test(val)) {
            shapeFillColor.value = val;
            const shape = this.getActiveShape();
            if (shape) {
              shape.fill_color = val;
              this.render();
            }
          }
        });
      }

      // 形狀邊框顏色
      const shapeBorderColor = document.getElementById("studio-shape-border-color");
      const shapeBorderText = document.getElementById("studio-shape-border-color-hex");
      if (shapeBorderColor && shapeBorderText) {
        shapeBorderColor.addEventListener("input", (e) => {
          shapeBorderText.value = e.target.value.toUpperCase();
          const shape = this.getActiveShape();
          if (shape) {
            shape.border_color = e.target.value;
            this.render();
          }
        });
        shapeBorderText.addEventListener("input", (e) => {
          const val = e.target.value.trim();
          if (/^#[0-9A-Fa-f]{6}$/.test(val)) {
            shapeBorderColor.value = val;
            const shape = this.getActiveShape();
            if (shape) {
              shape.border_color = val;
              this.render();
            }
          }
        });
      }

      // 新增形狀（矩形／圓形／正三角形）
      document.querySelectorAll(".shape-add-btn").forEach((btn) => {
        btn.addEventListener("click", () => {
          const type = btn.getAttribute("data-shape-type");
          if (!Array.isArray(this.layout.shapes)) this.layout.shapes = [];
          const newShape = createDefaultShape(type);
          this.layout.shapes.push(newShape);
          this.activeElementKey = `shape:${newShape.id}`;
          this.renderShapeTabs();
          this.syncElementTab();
          this.syncInspectorFromLayout();
          this.render();
        });
      });

      // 刪除目前選取中的形狀
      const btnDeleteShape = document.getElementById("btn-studio-shape-delete");
      if (btnDeleteShape) {
        btnDeleteShape.addEventListener("click", async () => {
          const shape = this.getActiveShape();
          if (!shape) return;
          const confirmed = window.showConfirmModal
            ? await window.showConfirmModal({ icon: "🗑️", title: "確定要刪除此形狀嗎？", danger: true })
            : confirm("確定要刪除此形狀嗎？");
          if (!confirmed) return;
          this.layout.shapes = (this.layout.shapes || []).filter((s) => s.id !== shape.id);
          this.activeElementKey = "qr_code";
          this.renderShapeTabs();
          this.syncElementTab();
          this.syncInspectorFromLayout();
          this.render();
        });
      }

      // 前綴詞 Prefix
      const prefixInput = document.getElementById("studio-text-prefix");
      if (prefixInput) {
        prefixInput.addEventListener("input", (e) => {
          if (this.isActiveElementTextKey()) {
            const elem = this.getActiveElementConfig();
            elem.prefix = e.target.value;
            this.render();
          }
        });
      }

      // 對齊方式 Anchor
      document.querySelectorAll(".align-btn").forEach((btn) => {
        btn.addEventListener("click", () => {
          document.querySelectorAll(".align-btn").forEach((b) => b.classList.remove("active"));
          btn.classList.add("active");
          const align = btn.getAttribute("data-align");
          if (this.isActiveElementTextKey()) {
            const elem = this.getActiveElementConfig();
            elem.anchor = align;
            this.render();
          }
        });
      });

      // 底線替換連字號
      const chkHyphen = document.getElementById("studio-replace-underscore");
      if (chkHyphen) {
        chkHyphen.addEventListener("change", (e) => {
          if (this.layout.text_elements.card_no) {
            this.layout.text_elements.card_no.replace_underscore_with_hyphen = e.target.checked;
            this.render();
          }
        });
      }

      // 上傳此分數專屬風格底圖
      const btnUploadScoreImg = document.getElementById("btn-studio-upload-score-img");
      const scoreImgInput = document.getElementById("studio-score-img-upload-input");

      if (btnUploadScoreImg && scoreImgInput) {
        btnUploadScoreImg.addEventListener("click", () => {
          scoreImgInput.value = "";
          scoreImgInput.click();
        });

        scoreImgInput.addEventListener("change", async (e) => {
          const file = e.target.files?.[0];
          if (!file) return;
          const card = this.getCurrentCard();
          const score = card?.score ?? 1;
          let currentSeries = this.seriesList.find((s) => s.id === (card?.series_id || this.currentSeriesId));
          if (!currentSeries && this.seriesList.length > 0) {
            currentSeries = this.seriesList[0];
            this.currentSeriesId = currentSeries.id;
          }
          if (!currentSeries) {
            alert("請先建立或選取圖卡系列！");
            return;
          }

          const formData = new FormData();
          formData.append("image", file);
          try {
            const res = await fetch("/api/point-cards/upload-card-image", {
              method: "POST",
              body: formData,
            });
            if (!res.ok) throw new Error("上傳失敗");
            const data = await res.json();

            if (!currentSeries.custom_images) currentSeries.custom_images = {};
            currentSeries.custom_images[String(score)] = data.url;

            // 即時儲存至後端系列
            await fetch(`/api/point-cards/${this.courseId}/series`, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                id: currentSeries.id,
                name: currentSeries.name,
                card_theme: "custom",
                allowed_course_ids: currentSeries.allowed_course_ids,
                custom_images: currentSeries.custom_images,
              }),
            });

            this.bgImageCache.clear();
            this.layout.background_theme = "custom";
            this.layout.custom_background_url = null;
            this.syncInspectorFromLayout();
            this.render();
            if (window.showToast) window.showToast(`已成功設定 ${score >= 0 ? "+" : ""}${score} 分專屬卡片風格！`, "success");
          } catch (err) {
            console.error("[CardDesigner] 上傳圖卡失敗:", err);
            alert("上傳失敗：" + err.message);
          }
        });
      }

      // 開啟系列管理彈窗
      const btnOpenSeriesMgr = document.getElementById("btn-studio-open-series-mgr");
      if (btnOpenSeriesMgr) {
        btnOpenSeriesMgr.addEventListener("click", () => {
          if (window.PointCardsManager && typeof window.PointCardsManager.openSeriesManager === "function") {
            window.PointCardsManager.openSeriesManager(this.currentSeriesId);
          }
        });
      }

      // 上傳全域固定自訂底圖
      const fileInput = document.getElementById("studio-bg-upload-input");
      if (fileInput) {
        fileInput.addEventListener("change", async (e) => {
          const file = e.target.files?.[0];
          if (!file) return;
          const formData = new FormData();
          formData.append("image", file);
          try {
            const res = await fetch("/api/point-cards/upload-background", {
              method: "POST",
              body: formData,
            });
            if (res.ok) {
              const data = await res.json();
              this.layout.custom_background_url = data.url;
              this.syncInspectorFromLayout();
              this.render();
              if (window.showToast) window.showToast("已成功套用全域固定底圖！", "success");
            }
          } catch (err) {
            console.error("[CardDesigner] 底圖上傳失敗:", err);
            alert("底圖上傳失敗，請確認檔案為圖片格式。");
          }
        });
      }

      // 清除全域固定自訂底圖
      const btnClearCustomBg = document.getElementById("btn-studio-clear-custom-bg");
      if (btnClearCustomBg) {
        btnClearCustomBg.addEventListener("click", () => {
          this.layout.custom_background_url = null;
          btnClearCustomBg.style.display = "none";
          this.syncInspectorFromLayout();
          this.render();
          if (window.showToast) window.showToast("已清除固定底圖，恢復依分數呈現底圖", "info");
        });
      }
    },

    bindStepInput(prefixId, onChange) {
      const input = document.getElementById(prefixId);
      const btnMinus = document.getElementById(`${prefixId}-minus`);
      const btnPlus = document.getElementById(`${prefixId}-plus`);
      if (!input) return;

      const step = Number(input.getAttribute("data-step") || 5);

      const updateVal = (newVal) => {
        const min = Number(input.getAttribute("min") || 0);
        const max = Number(input.getAttribute("max") || 9999);
        const clamped = Math.max(min, Math.min(max, newVal));
        input.value = clamped;
        onChange(clamped);
      };

      input.addEventListener("input", () => {
        const v = parseInt(input.value, 10);
        if (!isNaN(v)) updateVal(v);
      });

      if (btnMinus) {
        btnMinus.addEventListener("click", () => {
          const curr = parseInt(input.value, 10) || 0;
          updateVal(curr - step);
        });
      }

      if (btnPlus) {
        btnPlus.addEventListener("click", () => {
          const curr = parseInt(input.value, 10) || 0;
          updateVal(curr + step);
        });
      }
    },

    getActiveElementConfig() {
      if (this.activeElementKey === "qr_code") {
        return this.layout.qr_code;
      }
      if (typeof this.activeElementKey === "string" && this.activeElementKey.indexOf("shape:") === 0) {
        const shapeId = this.activeElementKey.slice(6);
        return (this.layout.shapes || []).find((s) => s.id === shapeId) || null;
      }
      return this.layout.text_elements?.[this.activeElementKey] || null;
    },

    /** 僅在目前選取項目為形狀時回傳其設定，否則回傳 null */
    getActiveShape() {
      if (typeof this.activeElementKey === "string" && this.activeElementKey.indexOf("shape:") === 0) {
        return this.getActiveElementConfig();
      }
      return null;
    },

    /** 判斷目前選取項目是否為文字類元素（卡號／點數分數／卡片名稱／代碼文字） */
    isActiveElementTextKey() {
      return !!(this.layout.text_elements && this.layout.text_elements[this.activeElementKey]);
    },

    /** 依目前 layout.shapes 動態重建右側「自訂形狀」標籤按鈕列表 */
    renderShapeTabs() {
      const container = document.getElementById("shape-tabs-list");
      if (!container) return;
      container.innerHTML = "";
      const shapes = this.layout.shapes || [];
      if (shapes.length === 0) {
        const empty = document.createElement("div");
        empty.className = "shape-tabs-empty";
        empty.textContent = "尚未新增任何形狀，請點擊上方按鈕新增矩形／圓形／正三角形裝飾";
        container.appendChild(empty);
        return;
      }
      shapes.forEach((shape, idx) => {
        const btn = document.createElement("button");
        btn.type = "button";
        btn.className = "element-tab-btn shape-tab-btn";
        btn.setAttribute("data-element", `shape:${shape.id}`);
        const label = SHAPE_TYPE_LABELS[shape.type] || SHAPE_TYPE_LABELS.rectangle;
        btn.innerHTML = `<span>${label} ${idx + 1}</span>`;
        btn.addEventListener("click", () => {
          this.activeElementKey = `shape:${shape.id}`;
          this.syncElementTab();
          this.syncInspectorFromLayout();
          this.render();
        });
        container.appendChild(btn);
      });
      this.syncElementTab();
    },

    syncElementTab() {
      document.querySelectorAll(".element-tab-btn").forEach((btn) => {
        if (btn.getAttribute("data-element") === this.activeElementKey) {
          btn.classList.add("active");
        } else {
          btn.classList.remove("active");
        }
      });
    },

    syncPositionInputs() {
      const elem = this.getActiveElementConfig();
      if (!elem) return;
      const inpX = document.getElementById("studio-pos-x");
      const inpY = document.getElementById("studio-pos-y");
      if (inpX) inpX.value = elem.x;
      if (inpY) inpY.value = elem.y;
    },

    syncInspectorFromLayout() {
      this.syncElementTab();
      const elem = this.getActiveElementConfig();
      if (!elem) return;

      // 1. 開關
      const chkEnabled = document.getElementById("studio-elem-enabled");
      if (chkEnabled) chkEnabled.checked = elem.enabled !== false;

      // 2. 座標
      this.syncPositionInputs();

      // 3. 元素專屬面板 (QR Code vs. 自訂形狀 vs. 文字)
      const qrSection = document.getElementById("inspector-qr-section");
      const shapeSection = document.getElementById("inspector-shape-section");
      const textSection = document.getElementById("inspector-text-section");
      const isShape = typeof this.activeElementKey === "string" && this.activeElementKey.indexOf("shape:") === 0;

      if (this.activeElementKey === "qr_code") {
        if (qrSection) qrSection.style.display = "block";
        if (shapeSection) shapeSection.style.display = "none";
        if (textSection) textSection.style.display = "none";

        const inpSize = document.getElementById("studio-qr-size");
        if (inpSize) inpSize.value = elem.width || 136;
      } else if (isShape) {
        if (qrSection) qrSection.style.display = "none";
        if (shapeSection) shapeSection.style.display = "block";
        if (textSection) textSection.style.display = "none";

        const shapeType = elem.type === "circle" || elem.type === "triangle" ? elem.type : "rectangle";

        const typeSelect = document.getElementById("studio-shape-type");
        const inpW = document.getElementById("studio-shape-w");
        const inpH = document.getElementById("studio-shape-h");
        const inpR = document.getElementById("studio-shape-radius");
        const inpOp = document.getElementById("studio-shape-opacity");
        const inpBw = document.getElementById("studio-shape-border-width");
        const inpBlur = document.getElementById("studio-shape-blur");
        const colFill = document.getElementById("studio-shape-fill-color");
        const hexFill = document.getElementById("studio-shape-fill-color-hex");
        const colBrd = document.getElementById("studio-shape-border-color");
        const hexBrd = document.getElementById("studio-shape-border-color-hex");
        const rowRadius = document.getElementById("studio-shape-radius-row");
        const rowHeight = document.getElementById("studio-shape-h-row");

        if (typeSelect) typeSelect.value = shapeType;
        if (inpW) inpW.value = elem.width || 154;
        if (inpH) inpH.value = elem.height || 154;
        if (inpR) inpR.value = elem.radius !== undefined ? elem.radius : 12;
        if (inpOp) inpOp.value = Math.round((elem.fill_opacity !== undefined ? elem.fill_opacity : 0.9) * 100);
        if (inpBw) inpBw.value = elem.border_width !== undefined ? elem.border_width : 2;
        if (inpBlur) inpBlur.value = elem.edge_blur !== undefined ? elem.edge_blur : 10;

        // 圓角半徑僅矩形適用；正三角形以等邊比例自動換算高度，故隱藏高度欄位
        if (rowRadius) rowRadius.style.display = shapeType === "rectangle" ? "flex" : "none";
        if (rowHeight) rowHeight.style.display = shapeType === "triangle" ? "none" : "flex";

        const fColor = elem.fill_color || "#FFFFFF";
        if (colFill) colFill.value = fColor;
        if (hexFill) hexFill.value = fColor.toUpperCase();

        const bColor = elem.border_color || "#CBD5E1";
        if (colBrd) colBrd.value = bColor;
        if (hexBrd) hexBrd.value = bColor.toUpperCase();
      } else {
        if (qrSection) qrSection.style.display = "none";
        if (shapeSection) shapeSection.style.display = "none";
        if (textSection) textSection.style.display = "block";

        const inpFontSize = document.getElementById("studio-font-size");
        if (inpFontSize) inpFontSize.value = elem.font_size || 22;

        const colorPicker = document.getElementById("studio-font-color");
        const colorText = document.getElementById("studio-font-color-hex");
        const colorVal = elem.font_color || "#000000";
        if (colorPicker) colorPicker.value = colorVal;
        if (colorText) colorText.value = colorVal.toUpperCase();

        const prefixInput = document.getElementById("studio-text-prefix");
        if (prefixInput) prefixInput.value = elem.prefix || "";

        document.querySelectorAll(".align-btn").forEach((btn) => {
          btn.classList.toggle("active", btn.getAttribute("data-align") === (elem.anchor || "left"));
        });

        // 底線連字號特例 (僅 card_no 顯示)
        const hyphenRow = document.getElementById("studio-hyphen-row");
        if (hyphenRow) {
          hyphenRow.style.display = this.activeElementKey === "card_no" ? "flex" : "none";
        }
      }

      // 依當前卡片分數顯示使用者自訂風格底圖狀態
      const card = this.getCurrentCard();
      const currentSeries = this.seriesList.find((s) => s.id === (card?.series_id || this.currentSeriesId));

      const customScoreBox = document.getElementById("studio-custom-score-box");
      const customScoreBadge = document.getElementById("studio-custom-score-badge");
      const customScoreStatus = document.getElementById("studio-custom-score-status");
      const btnClearCustomBg = document.getElementById("btn-studio-clear-custom-bg");

      if (customScoreBox) {
        customScoreBox.style.display = "block";
        const score = card?.score ?? 1;
        if (customScoreBadge) {
          customScoreBadge.textContent = `${score >= 0 ? "+" : ""}${score} 分`;
        }
        const customImages = currentSeries?.custom_images || card?.series_custom_images || {};
        const scoreImg = customImages[String(score)] || customImages[String(Math.abs(score))];
        if (customScoreStatus) {
          if (scoreImg) {
            customScoreStatus.innerHTML = `
              <div style="display: flex; align-items: center; gap: 8px;">
                <img src="${scoreImg}" style="width: 38px; height: 38px; object-fit: cover; border-radius: 6px; border: 1.5px solid var(--accent-positive);" />
                <div>
                  <div style="color: var(--accent-positive); font-weight: 800; font-size: 0.82rem;">✅ 已設定專屬風格底圖</div>
                  <div style="font-size: 0.72rem; color: var(--text-muted);">${score >= 0 ? "+" : ""}${score} 分專用卡面</div>
                </div>
              </div>`;
          } else if (customImages["default"]) {
            customScoreStatus.innerHTML = `
              <div style="display: flex; align-items: center; gap: 8px;">
                <img src="${customImages["default"]}" style="width: 38px; height: 38px; object-fit: cover; border-radius: 6px; border: 1.5px solid var(--primary);" />
                <div>
                  <div style="color: var(--primary); font-weight: 800; font-size: 0.82rem;">🌟 套用系列通用底圖</div>
                  <div style="font-size: 0.72rem; color: var(--text-muted);">尚未上傳此特定分數圖</div>
                </div>
              </div>`;
          } else {
            customScoreStatus.innerHTML = `
              <div style="color: var(--text-muted); font-size: 0.76rem;">
                ⚠️ 尚未上傳此分數的風格底圖<br>
                <span style="font-size: 0.72rem; color: var(--text-muted);">點擊下方按鈕上傳專屬外觀</span>
              </div>`;
          }
        }
      }

      if (btnClearCustomBg) {
        btnClearCustomBg.style.display = this.layout.custom_background_url ? "block" : "none";
      }
    },

    // ------------------------------------------------------------------------
    // 頂部導覽、卡片切換輪播與縮放
    // ------------------------------------------------------------------------

    bindModalEvents() {
      // 關閉按鈕
      document.querySelectorAll(".btn-close-card-studio").forEach((btn) => {
        btn.addEventListener("click", () => this.close());
      });

      // 系列下拉選單
      const select = document.getElementById("studio-series-select");
      if (select) {
        select.addEventListener("change", () => this.onSeriesChanged());
      }

      // 上一張 / 下一張
      const btnPrev = document.getElementById("studio-pager-prev");
      const btnNext = document.getElementById("studio-pager-next");
      if (btnPrev) {
        btnPrev.addEventListener("click", () => {
          if (this.currentIndex > 0) {
            this.currentIndex--;
            this.updatePagerUI();
            this.syncInspectorFromLayout();
            this.render();
          }
        });
      }
      if (btnNext) {
        btnNext.addEventListener("click", () => {
          if (this.currentIndex < this.cardsList.length - 1) {
            this.currentIndex++;
            this.updatePagerUI();
            this.syncInspectorFromLayout();
            this.render();
          }
        });
      }

      // 儲存與重設
      const btnSave = document.getElementById("btn-studio-save-layout");
      if (btnSave) btnSave.addEventListener("click", () => this.saveLayout());

      const btnReset = document.getElementById("btn-studio-reset-layout");
      if (btnReset) btnReset.addEventListener("click", () => this.resetLayout());

      // 縮放按鈕
      const btnZoomIn = document.getElementById("studio-zoom-in");
      const btnZoomOut = document.getElementById("studio-zoom-out");
      const btnZoomFit = document.getElementById("studio-zoom-fit");

      if (btnZoomIn) {
        btnZoomIn.addEventListener("click", () => {
          this.zoomScale = Math.min(1.5, this.zoomScale + 0.1);
          this.updateZoomDisplay();
        });
      }
      if (btnZoomOut) {
        btnZoomOut.addEventListener("click", () => {
          this.zoomScale = Math.max(0.2, this.zoomScale - 0.1);
          this.updateZoomDisplay();
        });
      }
      if (btnZoomFit) {
        btnZoomFit.addEventListener("click", () => {
          this.fitCanvasToContainer();
        });
      }

      // 匯出按鈕：A4 列印
      const btnPrint = document.getElementById("btn-studio-print-a4");
      if (btnPrint) btnPrint.addEventListener("click", () => this.printA4Batch());

      // 匯出按鈕：打包下載 ZIP
      const btnZip = document.getElementById("btn-studio-download-zip");
      if (btnZip) btnZip.addEventListener("click", () => this.downloadZipBatch());
    },

    updatePagerUI() {
      const total = this.cardsList.length;
      const cur = total > 0 ? this.currentIndex + 1 : 0;

      const infoEl = document.getElementById("studio-pager-info");
      if (infoEl) infoEl.textContent = `第 ${cur} / ${total} 張`;

      const btnPrev = document.getElementById("studio-pager-prev");
      const btnNext = document.getElementById("studio-pager-next");
      if (btnPrev) btnPrev.disabled = this.currentIndex <= 0;
      if (btnNext) btnNext.disabled = this.currentIndex >= total - 1;

      // 更新卡片詳情 Badge
      const badgeEl = document.getElementById("studio-card-details-badge");
      if (badgeEl) {
        const card = this.getCurrentCard();
        if (card) {
          badgeEl.textContent = `序號: ${card.card_no || "無"} | 分數: ${card.score || 0} | 代碼: ${card.code || "無"}`;
        }
      }
    },

    // ------------------------------------------------------------------------
    // 批次輸出：A4 拼模列印 (含裁切輔助線)
    // ------------------------------------------------------------------------

    async printA4Batch() {
      if (!this.cardsList || this.cardsList.length === 0) {
        alert("目前選取的系列沒有任何點數卡可供列印！");
        return;
      }

      const btnPrint = document.getElementById("btn-studio-print-a4");
      if (btnPrint) {
        btnPrint.disabled = true;
        btnPrint.textContent = "⏳ 正在合成列印圖檔...";
      }

      try {
        let printArea = document.getElementById("card-print-area");
        if (!printArea) {
          printArea = document.createElement("div");
          printArea.id = "card-print-area";
          document.body.appendChild(printArea);
        }
        printArea.innerHTML = "";

        const cards = this.cardsList;
        const CARDS_PER_PAGE = 9; // A4 3x3 九宮格排版
        const totalPages = Math.ceil(cards.length / CARDS_PER_PAGE);

        for (let p = 0; p < totalPages; p++) {
          const pageEl = document.createElement("div");
          pageEl.className = "a4-print-page";

          const pageCards = cards.slice(p * CARDS_PER_PAGE, (p + 1) * CARDS_PER_PAGE);

          for (const card of pageCards) {
            const cell = document.createElement("div");
            cell.className = "a4-card-cell";

            // 離線生成高解析 Canvas
            const dataUrl = await this.renderCardToDataUrl(card);
            const img = document.createElement("img");
            img.className = "a4-card-img";
            img.src = dataUrl;
            cell.appendChild(img);
            pageEl.appendChild(cell);
          }

          // 填補該頁不足 9 張的空格，保持格子大小齊整
          for (let empty = pageCards.length; empty < CARDS_PER_PAGE; empty++) {
            const emptyCell = document.createElement("div");
            emptyCell.className = "a4-card-cell";
            emptyCell.style.border = "none";
            pageEl.appendChild(emptyCell);
          }

          printArea.appendChild(pageEl);
        }

        // 呼叫原生列印
        window.print();
      } catch (err) {
        console.error("[CardDesigner] 列印準備失敗:", err);
        alert("合成列印頁面時發生錯誤。");
      } finally {
        if (btnPrint) {
          btnPrint.disabled = false;
          btnPrint.innerHTML = "🖨️ <span>A4 拼模列印</span>";
        }
      }
    },

    // ------------------------------------------------------------------------
    // 批次輸出：打包下載 ZIP (全部高解析度 PNG)
    // ------------------------------------------------------------------------

    async downloadZipBatch() {
      if (!this.cardsList || this.cardsList.length === 0) {
        alert("目前選取的系列沒有任何點數卡可供匯出！");
        return;
      }

      const btnZip = document.getElementById("btn-studio-download-zip");
      if (btnZip) {
        btnZip.disabled = true;
        btnZip.textContent = "📦 正在打包 ZIP...";
      }

      try {
        const zip = new SimpleZip();
        const cards = this.cardsList;
        const seriesName =
          this.seriesList.find((s) => s.id === this.currentSeriesId)?.name || "全部點數卡";

        for (let i = 0; i < cards.length; i++) {
          const card = cards[i];
          if (btnZip) btnZip.textContent = `📦 打包中 (${i + 1}/${cards.length})...`;

          const dataUrl = await this.renderCardToDataUrl(card);
          // 將 DataURL 轉為 Uint8Array
          const byteString = atob(dataUrl.split(",")[1]);
          const u8 = new Uint8Array(byteString.length);
          for (let b = 0; b < byteString.length; b++) {
            u8[b] = byteString.charCodeAt(b);
          }

          const rawNo = card.card_no || `CARD_${i + 1}`;
          const safeNo = rawNo.replace(/[\\/:*?"<>|]/g, "_");
          const fileName = `${safeNo}_${card.score || 0}pt.png`;
          zip.addFile(fileName, u8);
        }

        const blob = zip.generateBlob();
        const downloadUrl = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = downloadUrl;
        a.download = `實體點數卡_${seriesName}.zip`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(downloadUrl);

        if (window.showToast) {
          window.showToast(`✅ 已成功下載 ${cards.length} 張卡片壓縮檔！`, "success");
        }
      } catch (err) {
        console.error("[CardDesigner] ZIP 打包失敗:", err);
        alert("打包下載時發生錯誤，請稍後再試。");
      } finally {
        if (btnZip) {
          btnZip.disabled = false;
          btnZip.innerHTML = "📦 <span>打包下載 PNG</span>";
        }
      }
    },

    /** 在離線 Canvas 完整合成單張卡片並產出 PNG DataURL */
    async renderCardToDataUrl(card) {
      const cw = this.layout.canvas_width || 800;
      const ch = this.layout.canvas_height || 1200;

      const offCanvas = document.createElement("canvas");
      offCanvas.width = cw;
      offCanvas.height = ch;
      const ctx = offCanvas.getContext("2d");

      // 1. 底圖
      const bgUrl = this.resolveCardBgUrl(card);
      const bgImg = await this.loadImage(bgUrl);
      if (bgImg) {
        ctx.drawImage(bgImg, 0, 0, cw, ch);
      } else {
        const grad = ctx.createLinearGradient(0, 0, cw, ch);
        grad.addColorStop(0, "#f8fafc");
        grad.addColorStop(1, "#e2e8f0");
        ctx.fillStyle = grad;
        ctx.fillRect(0, 0, cw, ch);
      }

      // 1.5. 自訂裝飾形狀（矩形／圓形／正三角形，具毛玻璃霧化邊緣）
      const shapesConf = this.layout.shapes;
      if (Array.isArray(shapesConf)) {
        for (const shapeConf of shapesConf) {
          if (shapeConf && shapeConf.enabled) {
            this.drawShape(ctx, shapeConf, offCanvas);
          }
        }
      }

      // 2. QR Code
      const qrConf = this.layout.qr_code;
      if (qrConf && qrConf.enabled) {
        const qrDataUrl = await this.loadQrCodeDataUrl(card.code || "CARD-SAMPLE");
        if (qrDataUrl) {
          const qrImg = await this.loadImage(qrDataUrl);
          if (qrImg) {
            ctx.drawImage(qrImg, qrConf.x, qrConf.y, qrConf.width, qrConf.height);
          }
        }
      }

      // 3. 文字
      const texts = this.layout.text_elements;
      if (texts) {
        if (texts.card_no && texts.card_no.enabled) {
          let noText = card.card_no || "A-001";
          if (texts.card_no.replace_underscore_with_hyphen) noText = noText.replace(/_/g, "-");
          this.drawTextElement(ctx, texts.card_no, (texts.card_no.prefix || "") + noText);
        }
        if (texts.card_value && texts.card_value.enabled) {
          const s = card.score !== undefined ? card.score : 2;
          this.drawTextElement(
            ctx,
            texts.card_value,
            (texts.card_value.prefix || "") + (s > 0 ? `+${s}` : s)
          );
        }
        if (texts.card_label && texts.card_label.enabled) {
          this.drawTextElement(
            ctx,
            texts.card_label,
            (texts.card_label.prefix || "") + (card.label || "榮譽點數卡")
          );
        }
        if (texts.card_code_text && texts.card_code_text.enabled) {
          this.drawTextElement(
            ctx,
            texts.card_code_text,
            (texts.card_code_text.prefix || "") + (card.code || "CARD-0001")
          );
        }
      }

      return offCanvas.toDataURL("image/png");
    }
  };

  window.CardDesignerStudio = CardDesignerStudio;

  // 當 DOM 載入完畢時自動初始化
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", () => CardDesignerStudio.init());
  } else {
    CardDesignerStudio.init();
  }
})();
