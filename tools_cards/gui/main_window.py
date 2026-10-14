import os
import sys
from typing import Any, Dict, List, Optional
import pandas as pd
from PIL import Image

from PyQt6.QtCore import Qt, QSize
from PyQt6.QtGui import QPixmap, QImage, QIcon
from PyQt6.QtWidgets import (
    QMainWindow, QWidget, QVBoxLayout, QHBoxLayout, QLabel, QLineEdit,
    QPushButton, QFileDialog, QListWidget, QListWidgetItem, QComboBox,
    QProgressBar, QMessageBox, QSplitter, QGroupBox, QDialog, QScrollArea,
    QCheckBox
)

from card_generator.reader import read_card_data
from card_generator.background_loader import BackgroundLoader
from card_generator.qrcode_engine import QRCodeGenerator
from card_generator.dynamic_compositor import DynamicCardCompositor
from card_generator.template_manager import save_layout_template, load_layout_template
from .interactive_canvas import InteractiveCardCanvas
from .style_panel import StyleInspectorPanel
from .worker import BatchGenerateWorker


class MainWindow(QMainWindow):
    """可攜式視覺化卡片自動合成系統主視窗。"""

    def __init__(self):
        super().__init__()
        self.setWindowTitle("卡片批次自動合成系統 (可攜式版) - Batch Card Generator")
        self.resize(1280, 850)

        # 狀態資料
        self.excel_path = os.path.abspath("A系列匯入檔.xlsx") if os.path.exists("A系列匯入檔.xlsx") else ""
        self.backgrounds_dir = os.path.abspath("backgrounds") if os.path.exists("backgrounds") else ""
        self.output_dir = os.path.abspath("output_cards")
        self.records: List[Dict[str, Any]] = []
        self.columns: List[str] = []
        self.current_bg_image: Optional[Image.Image] = None
        self.worker: Optional[BatchGenerateWorker] = None

        # 版面設定快取
        self.layout_config: Dict[str, Any] = {
            "qr_code": {
                "enabled": True,
                "x": 39,
                "y": 633,
                "width": 136,
                "height": 136,
                "source_column": "card_code",
                "error_correction": "M",
            },
            "card_no_source_column": "card_no",
            "text_elements": {
                "card_code": {
                    "enabled": False,
                    "column": "card_code",
                    "x": 39,
                    "y": 780,
                    "font_size": 16,
                    "font_color": "#000000",
                    "prefix": "",
                    "replace_underscore_with_hyphen": False,
                },
                "card_no": {
                    "enabled": True,
                    "column": "card_no",
                    "x": 547,
                    "y": 755,
                    "font_size": 22,
                    "font_color": "#000000",
                    "prefix": "No.",
                    "replace_underscore_with_hyphen": True,
                }
            }
        }

        self._init_ui()
        self._load_initial_data()

    def _init_ui(self):
        central = QWidget()
        self.setCentralWidget(central)
        root_layout = QVBoxLayout(central)
        root_layout.setContentsMargins(10, 10, 10, 10)
        root_layout.setSpacing(8)

        # 1. 頂部：路徑設定列 (柔和天藍色調步驟標記)
        path_group = QGroupBox("📌 步驟 1：選擇資料與檔案路徑")
        path_group.setStyleSheet("""
            QGroupBox {
                font-weight: bold;
                font-size: 13px;
                border: 1.5px solid #BFDBFE;
                border-radius: 8px;
                margin-top: 10px;
                padding-top: 14px;
                background-color: #F8FAFF;
            }
            QGroupBox::title {
                subcontrol-origin: margin;
                left: 14px;
                padding: 2px 10px;
                color: #1E40AF;
                background-color: #DBEAFE;
                border: 1px solid #93C5FD;
                border-radius: 4px;
            }
        """)
        path_layout = QVBoxLayout(path_group)
        path_layout.setSpacing(6)

        # Excel 檔案列
        r1 = QHBoxLayout()
        lbl_excel = QLabel("Excel 資料來源:")
        lbl_excel.setStyleSheet("font-weight: bold; color: #1E3A8A;")
        r1.addWidget(lbl_excel)
        self.edit_excel = QLineEdit(self.excel_path)
        self.edit_excel.setReadOnly(True)
        r1.addWidget(self.edit_excel)
        btn_browse_excel = QPushButton("📂 選擇 Excel 檔案...")
        btn_browse_excel.setCursor(Qt.CursorShape.PointingHandCursor)
        btn_browse_excel.setStyleSheet("""
            QPushButton {
                background-color: #EFF6FF;
                color: #1D4ED8;
                border: 1.5px solid #93C5FD;
                border-radius: 5px;
                padding: 6px 14px;
                font-weight: bold;
                font-size: 12px;
            }
            QPushButton:hover {
                background-color: #DBEAFE;
                border-color: #60A5FA;
                color: #1E40AF;
            }
            QPushButton:pressed {
                background-color: #BFDBFE;
            }
        """)
        btn_browse_excel.clicked.connect(self._browse_excel)
        r1.addWidget(btn_browse_excel)
        path_layout.addLayout(r1)

        # 底圖目錄與輸出目錄列
        r2 = QHBoxLayout()
        lbl_bg = QLabel("底圖目錄:")
        lbl_bg.setStyleSheet("font-weight: bold; color: #065F46;")
        r2.addWidget(lbl_bg)
        self.edit_bg = QLineEdit(self.backgrounds_dir)
        self.edit_bg.setReadOnly(True)
        r2.addWidget(self.edit_bg)
        btn_browse_bg = QPushButton("🖼️ 選擇底圖目錄...")
        btn_browse_bg.setCursor(Qt.CursorShape.PointingHandCursor)
        btn_browse_bg.setStyleSheet("""
            QPushButton {
                background-color: #F0FDF4;
                color: #15803D;
                border: 1.5px solid #86EFAC;
                border-radius: 5px;
                padding: 6px 14px;
                font-weight: bold;
                font-size: 12px;
            }
            QPushButton:hover {
                background-color: #DCFCE7;
                border-color: #4ADE80;
                color: #166534;
            }
            QPushButton:pressed {
                background-color: #BBF7D0;
            }
        """)
        btn_browse_bg.clicked.connect(self._browse_bg)
        r2.addWidget(btn_browse_bg)

        lbl_out = QLabel("輸出目錄:")
        lbl_out.setStyleSheet("font-weight: bold; color: #92400E;")
        r2.addWidget(lbl_out)
        self.edit_out = QLineEdit(self.output_dir)
        self.edit_out.setReadOnly(True)
        r2.addWidget(self.edit_out)
        btn_browse_out = QPushButton("📁 選擇輸出目錄...")
        btn_browse_out.setCursor(Qt.CursorShape.PointingHandCursor)
        btn_browse_out.setStyleSheet("""
            QPushButton {
                background-color: #FFFBEB;
                color: #B45309;
                border: 1.5px solid #FCD34D;
                border-radius: 5px;
                padding: 6px 14px;
                font-weight: bold;
                font-size: 12px;
            }
            QPushButton:hover {
                background-color: #FEF3C7;
                border-color: #FBBF24;
                color: #92400E;
            }
            QPushButton:pressed {
                background-color: #FDE68A;
            }
        """)
        btn_browse_out.clicked.connect(self._browse_out)
        r2.addWidget(btn_browse_out)
        path_layout.addLayout(r2)

        root_layout.addWidget(path_group)

        # 2. 中部：三欄水平分割器 (欄位選取 | 互動畫布 | 樣式檢查器)
        splitter = QSplitter(Qt.Orientation.Horizontal)

        # 左欄：QR Code 來源、編號來源與欄位自選
        left_panel = QWidget()
        left_layout = QVBoxLayout(left_panel)
        left_layout.setContentsMargins(0, 0, 0, 0)
        left_layout.setSpacing(8)

        # A. QR Code 條碼來源與顯示模式設定 (柔和靛藍色調)
        qr_group = QGroupBox("🎯 步驟 2-A：QR Code 條碼設定")
        qr_group.setStyleSheet("""
            QGroupBox {
                font-weight: bold;
                font-size: 13px;
                border: 1.5px solid #C7D2FE;
                border-radius: 8px;
                margin-top: 10px;
                padding-top: 14px;
                background-color: #F8FAFF;
            }
            QGroupBox::title {
                subcontrol-origin: margin;
                left: 14px;
                padding: 2px 10px;
                color: #3730A3;
                background-color: #E0E7FF;
                border: 1px solid #C7D2FE;
                border-radius: 4px;
            }
        """)
        qr_layout = QVBoxLayout(qr_group)
        qr_layout.setSpacing(6)

        self.chk_card_code_qr = QCheckBox("在卡片上產生 QR Code")
        self.chk_card_code_qr.setChecked(True)
        self.chk_card_code_qr.setStyleSheet("font-weight: bold; color: #4338CA; font-size: 13px;")
        self.chk_card_code_qr.stateChanged.connect(self._on_card_code_mode_changed)
        qr_layout.addWidget(self.chk_card_code_qr)

        # 讓使用者自由指定任何欄位作為 QR Code 來源
        qr_source_layout = QVBoxLayout()
        lbl_qr_src = QLabel("👉 請選擇 QR Code 資料來源欄位:")
        lbl_qr_src.setStyleSheet("font-weight: bold; font-size: 12px; color: #3730A3; background-color: #EEF2FF; padding: 4px 8px; border-radius: 4px; border-left: 3px solid #6366F1;")
        qr_source_layout.addWidget(lbl_qr_src)
        self.combo_qr_source = QComboBox()
        self.combo_qr_source.setStyleSheet("""
            QComboBox {
                border: 1.5px solid #818CF8;
                border-radius: 6px;
                padding: 5px 8px;
                background-color: #FFFFFF;
                font-size: 13px;
                font-weight: bold;
                color: #1E1B4B;
                min-height: 22px;
            }
            QComboBox:hover {
                border-color: #6366F1;
                background-color: #F5F7FF;
            }
            QComboBox:focus {
                border: 2px solid #4F46E5;
            }
            QComboBox::drop-down {
                border: none;
                width: 24px;
            }
            QComboBox QAbstractItemView {
                border: 1.5px solid #818CF8;
                border-radius: 4px;
                background-color: #FFFFFF;
                selection-background-color: #EEF2FF;
                selection-color: #3730A3;
                padding: 4px;
            }
        """)
        self.combo_qr_source.currentIndexChanged.connect(self._on_qr_source_changed)
        qr_source_layout.addWidget(self.combo_qr_source)
        qr_layout.addLayout(qr_source_layout)

        # 模式二：同時直接顯示該欄位文字值
        self.chk_card_code_text = QCheckBox("同時在卡片上直接顯示該代碼文字")
        self.chk_card_code_text.setChecked(False)
        self.chk_card_code_text.setStyleSheet("font-weight: bold; color: #047857; font-size: 12px;")
        self.chk_card_code_text.stateChanged.connect(self._on_card_code_mode_changed)
        qr_layout.addWidget(self.chk_card_code_text)

        lbl_hint = QLabel("💡 支援任意 Excel 欄位名稱，不會因缺少固定欄位名稱而讀取失敗！")
        lbl_hint.setWordWrap(True)
        lbl_hint.setStyleSheet("color: #64748B; font-size: 11px; padding: 2px;")
        qr_layout.addWidget(lbl_hint)

        left_layout.addWidget(qr_group)

        # B. 卡片編號 / 檔名來源欄位群組 (柔和暖琥珀色調)
        no_group = QGroupBox("🏷️ 步驟 2-B：卡片編號與檔名設定")
        no_group.setStyleSheet("""
            QGroupBox {
                font-weight: bold;
                font-size: 13px;
                border: 1.5px solid #FDE68A;
                border-radius: 8px;
                margin-top: 10px;
                padding-top: 14px;
                background-color: #FFFDF7;
            }
            QGroupBox::title {
                subcontrol-origin: margin;
                left: 14px;
                padding: 2px 10px;
                color: #92400E;
                background-color: #FEF3C7;
                border: 1px solid #FDE68A;
                border-radius: 4px;
            }
        """)
        no_layout = QVBoxLayout(no_group)
        no_layout.setSpacing(6)
        lbl_no_src = QLabel("👉 請選擇編號/檔名來源欄位:")
        lbl_no_src.setStyleSheet("font-weight: bold; font-size: 12px; color: #92400E; background-color: #FFFBEB; padding: 4px 8px; border-radius: 4px; border-left: 3px solid #F59E0B;")
        no_layout.addWidget(lbl_no_src)
        self.combo_card_no_source = QComboBox()
        self.combo_card_no_source.setStyleSheet("""
            QComboBox {
                border: 1.5px solid #F59E0B;
                border-radius: 6px;
                padding: 5px 8px;
                background-color: #FFFFFF;
                font-size: 13px;
                font-weight: bold;
                color: #451A03;
                min-height: 22px;
            }
            QComboBox:hover {
                border-color: #D97706;
                background-color: #FFFDF5;
            }
            QComboBox:focus {
                border: 2px solid #B45309;
            }
            QComboBox::drop-down {
                border: none;
                width: 24px;
            }
            QComboBox QAbstractItemView {
                border: 1.5px solid #F59E0B;
                border-radius: 4px;
                background-color: #FFFFFF;
                selection-background-color: #FEF3C7;
                selection-color: #92400E;
                padding: 4px;
            }
        """)
        self.combo_card_no_source.currentIndexChanged.connect(self._on_card_no_source_changed)
        no_layout.addWidget(self.combo_card_no_source)
        left_layout.addWidget(no_group)

        # C. 其他文字欄位勾選群組 (柔和薄荷綠色調)
        fields_group = QGroupBox("📝 步驟 2-C：勾選卡片要顯示的文字欄位")
        fields_group.setStyleSheet("""
            QGroupBox {
                font-weight: bold;
                font-size: 13px;
                border: 1.5px solid #A7F3D0;
                border-radius: 8px;
                margin-top: 10px;
                padding-top: 14px;
                background-color: #F7FEFA;
            }
            QGroupBox::title {
                subcontrol-origin: margin;
                left: 14px;
                padding: 2px 10px;
                color: #065F46;
                background-color: #D1FAE5;
                border: 1px solid #A7F3D0;
                border-radius: 4px;
            }
        """)
        fields_layout = QVBoxLayout(fields_group)
        fields_layout.setSpacing(8)
        self.list_fields = QListWidget()
        self.list_fields.setStyleSheet("""
            QListWidget {
                border: 1.5px solid #A7F3D0;
                border-radius: 6px;
                background-color: #FFFFFF;
                padding: 4px;
                font-size: 13px;
                color: #1E293B;
            }
            QListWidget::item {
                padding: 6px 8px;
                border-radius: 4px;
                margin-bottom: 2px;
            }
            QListWidget::item:hover {
                background-color: #ECFDF5;
                color: #065F46;
            }
            QListWidget::item:selected {
                background-color: #D1FAE5;
                color: #065F46;
                font-weight: bold;
            }
        """)
        self.list_fields.itemChanged.connect(self._on_field_check_changed)
        fields_layout.addWidget(self.list_fields)

        # 範本存取按鈕 (柔和紫羅蘭色調)
        tmpl_layout = QHBoxLayout()
        btn_save_tmpl = QPushButton("💾 儲存版面範本")
        btn_save_tmpl.setCursor(Qt.CursorShape.PointingHandCursor)
        btn_save_tmpl.setStyleSheet("""
            QPushButton {
                background-color: #F5F3FF;
                color: #6D28D9;
                border: 1.5px solid #DDD6FE;
                border-radius: 5px;
                padding: 6px 12px;
                font-weight: bold;
                font-size: 12px;
            }
            QPushButton:hover {
                background-color: #EDE9FE;
                border-color: #C4B5FD;
                color: #5B21B6;
            }
            QPushButton:pressed {
                background-color: #DDD6FE;
            }
        """)
        btn_save_tmpl.clicked.connect(self._save_template)
        tmpl_layout.addWidget(btn_save_tmpl)

        btn_load_tmpl = QPushButton("📂 載入版面範本")
        btn_load_tmpl.setCursor(Qt.CursorShape.PointingHandCursor)
        btn_load_tmpl.setStyleSheet("""
            QPushButton {
                background-color: #F5F3FF;
                color: #6D28D9;
                border: 1.5px solid #DDD6FE;
                border-radius: 5px;
                padding: 6px 12px;
                font-weight: bold;
                font-size: 12px;
            }
            QPushButton:hover {
                background-color: #EDE9FE;
                border-color: #C4B5FD;
                color: #5B21B6;
            }
            QPushButton:pressed {
                background-color: #DDD6FE;
            }
        """)
        btn_load_tmpl.clicked.connect(self._load_template)
        tmpl_layout.addWidget(btn_load_tmpl)
        fields_layout.addLayout(tmpl_layout)

        left_layout.addWidget(fields_group)
        splitter.addWidget(left_panel)

        # 中欄：可互動畫布
        center_panel = QWidget()
        center_layout = QVBoxLayout(center_panel)
        center_layout.setContentsMargins(0, 0, 0, 0)
        center_layout.setSpacing(6)

        self.lbl_canvas_info = QLabel("底圖原始解析度: 偵測中...")
        self.lbl_canvas_info.setStyleSheet("color: #334155; font-weight: bold; padding: 5px 10px; background-color: #F1F5F9; border-radius: 6px; border: 1px solid #CBD5E1;")
        center_layout.addWidget(self.lbl_canvas_info)

        self.canvas = InteractiveCardCanvas(self)
        self.canvas.signals.item_selected.connect(self._on_canvas_item_selected)
        self.canvas.signals.item_geometry_changed.connect(self._on_canvas_geometry_changed)
        center_layout.addWidget(self.canvas)

        splitter.addWidget(center_panel)

        # 右欄：屬性調整面板
        self.style_panel = StyleInspectorPanel(self)
        self.style_panel.setMinimumWidth(320)
        self.style_panel.property_changed.connect(self._on_style_property_changed)
        splitter.addWidget(self.style_panel)

        splitter.setCollapsible(0, False)
        splitter.setCollapsible(1, False)
        splitter.setCollapsible(2, False)

        splitter.setStretchFactor(0, 2)
        splitter.setStretchFactor(1, 5)
        splitter.setStretchFactor(2, 3)
        root_layout.addWidget(splitter, 1)

        # 3. 底部：進度列與操作按鈕 (醒目柔和的預覽與生成按鈕)
        bottom_bar = QHBoxLayout()
        bottom_bar.setContentsMargins(4, 4, 4, 4)
        bottom_bar.setSpacing(12)

        self.lbl_status = QLabel("就緒")
        self.lbl_status.setStyleSheet("padding: 8px 14px; background-color: #F1F5F9; border-radius: 6px; border: 1px solid #CBD5E1; font-size: 12px; color: #334155; font-weight: bold;")
        bottom_bar.addWidget(self.lbl_status, 1)

        self.progress_bar = QProgressBar()
        self.progress_bar.setVisible(False)
        self.progress_bar.setStyleSheet("""
            QProgressBar {
                border: 1.5px solid #CBD5E1;
                border-radius: 6px;
                text-align: center;
                font-weight: bold;
                color: #0F172A;
                background-color: #F8FAFC;
                min-height: 24px;
            }
            QProgressBar::chunk {
                background-color: #10B981;
                border-radius: 4px;
            }
        """)
        bottom_bar.addWidget(self.progress_bar, 1)

        self.btn_preview = QPushButton("👁️ 單張快速預覽 (推薦確認)")
        self.btn_preview.setCursor(Qt.CursorShape.PointingHandCursor)
        self.btn_preview.setStyleSheet("""
            QPushButton {
                background-color: #F0FDF4;
                color: #15803D;
                border: 1.5px solid #86EFAC;
                border-radius: 6px;
                padding: 9px 20px;
                font-size: 14px;
                font-weight: bold;
            }
            QPushButton:hover {
                background-color: #DCFCE7;
                border-color: #4ADE80;
                color: #166534;
            }
            QPushButton:pressed {
                background-color: #BBF7D0;
            }
        """)
        self.btn_preview.clicked.connect(self._preview_single_card)
        bottom_bar.addWidget(self.btn_preview)

        self.btn_start = QPushButton("🚀 開始批次生成全部卡片")
        self.btn_start.setCursor(Qt.CursorShape.PointingHandCursor)
        self.btn_start.setStyleSheet("""
            QPushButton {
                background: qlineargradient(x1:0, y1:0, x2:0, y2:1, stop:0 #2563EB, stop:1 #1D4ED8);
                color: #FFFFFF;
                border: 1px solid #1E40AF;
                border-radius: 6px;
                padding: 9px 26px;
                font-size: 14px;
                font-weight: bold;
            }
            QPushButton:hover {
                background: qlineargradient(x1:0, y1:0, x2:0, y2:1, stop:0 #3B82F6, stop:1 #2563EB);
                border-color: #1D4ED8;
            }
            QPushButton:pressed {
                background-color: #1E40AF;
            }
            QPushButton:disabled {
                background-color: #94A3B8;
                border-color: #CBD5E1;
                color: #E2E8F0;
            }
        """)
        self.btn_start.clicked.connect(self._start_batch)
        bottom_bar.addWidget(self.btn_start)

        root_layout.addLayout(bottom_bar)

    def _load_initial_data(self):
        """啟動時自動載入預設 Excel 與底圖。"""
        if self.excel_path and os.path.exists(self.excel_path):
            self._load_excel(self.excel_path)
        else:
            self._load_fallback_background()

    def _browse_excel(self):
        file_path, _ = QFileDialog.getOpenFileName(
            self, "選擇卡片清單 Excel 檔案", "", "Excel 活頁簿 (*.xlsx *.xls)"
        )
        if file_path:
            self.excel_path = file_path
            self.edit_excel.setText(file_path)
            self._load_excel(file_path)

    def _browse_bg(self):
        dir_path = QFileDialog.getExistingDirectory(self, "選擇底圖目錄", self.backgrounds_dir)
        if dir_path:
            self.backgrounds_dir = dir_path
            self.edit_bg.setText(dir_path)
            self._refresh_background()

    def _browse_out(self):
        dir_path = QFileDialog.getExistingDirectory(self, "選擇輸出目錄", self.output_dir)
        if dir_path:
            self.output_dir = dir_path
            self.edit_out.setText(dir_path)

    def _load_excel(self, file_path: str):
        try:
            df = pd.read_excel(file_path)
            self.columns = [str(c).strip() for c in df.columns]
            # 支援任意自訂欄位名稱，避免欄位名稱不同時讀取失敗
            records, errors = read_card_data(file_path, allow_any_columns=True)
            self.records = [r["raw"] for r in records] if records else df.to_dict(orient="records")

            # 智慧預選 QR Code 來源欄位
            self.combo_qr_source.blockSignals(True)
            self.combo_qr_source.clear()
            self.combo_qr_source.addItems(self.columns)
            selected_qr = None
            for cand in ["card_code", "qrcode", "qr", "條碼", "條碼內容", "代碼", "code"]:
                m = next((c for c in self.columns if cand == c.lower() or cand in c.lower()), None)
                if m:
                    selected_qr = m
                    break
            if not selected_qr and len(self.columns) > 1:
                selected_qr = self.columns[1]
            elif not selected_qr and len(self.columns) > 0:
                selected_qr = self.columns[0]
            if selected_qr:
                self.combo_qr_source.setCurrentText(selected_qr)
                self.layout_config.setdefault("qr_code", {})["source_column"] = selected_qr
            self.combo_qr_source.blockSignals(False)

            # 智慧預選編號/檔名來源欄位
            self.combo_card_no_source.blockSignals(True)
            self.combo_card_no_source.clear()
            self.combo_card_no_source.addItems(self.columns)
            selected_no = None
            for cand in ["card_no", "no", "序號", "編號", "id", "卡號"]:
                m = next((c for c in self.columns if cand == c.lower() or cand in c.lower()), None)
                if m:
                    selected_no = m
                    break
            if not selected_no and len(self.columns) > 0:
                selected_no = self.columns[0]
            if selected_no:
                self.combo_card_no_source.setCurrentText(selected_no)
                self.layout_config["card_no_source_column"] = selected_no
            self.combo_card_no_source.blockSignals(False)

            # 更新其他文字欄位清單 (排除底圖欄位)
            self.list_fields.blockSignals(True)
            self.list_fields.clear()
            for col in self.columns:
                if col in ["card_image", "底圖", "image"]:
                    continue
                item = QListWidgetItem(col)
                item.setFlags(item.flags() | Qt.ItemFlag.ItemIsUserCheckable)
                # 若為編號欄位則預設打勾
                if col == selected_no:
                    item.setCheckState(Qt.CheckState.Checked)
                else:
                    item.setCheckState(Qt.CheckState.Unchecked)
                self.list_fields.addItem(item)
            self.list_fields.blockSignals(False)

            self.lbl_status.setText(f"成功讀取 Excel，共 {len(self.records)} 筆資料，QR Code 來源: [{selected_qr}]，編號來源: [{selected_no}]")
            self._refresh_background()
            self._refresh_canvas_items()

        except Exception as e:
            QMessageBox.critical(self, "讀取錯誤", f"無法解析 Excel 檔案:\n{e}")

    def _refresh_background(self):
        """自動載入第一張卡片之底圖或預設底圖，並自動偵測底圖大小。"""
        bg_loader = BackgroundLoader(backgrounds_dir=self.backgrounds_dir)
        sample_img_name = ""
        if self.records:
            # 尋找底圖欄位
            img_col = next((c for c in self.columns if "image" in c.lower() or "底圖" in c.lower()), None)
            if img_col:
                sample_img_name = str(self.records[0].get(img_col, ""))
            else:
                sample_img_name = str(self.records[0].get("card_image", ""))

        if not sample_img_name and os.path.exists("simple.jpg"):
            sample_img_name = "simple.jpg"
        elif not sample_img_name and os.path.exists(self.backgrounds_dir):
            bg_files = [f for f in os.listdir(self.backgrounds_dir) if f.lower().endswith(('.jpg', '.jpeg', '.png'))]
            if bg_files:
                sample_img_name = bg_files[0]

        bg_img = bg_loader.load_background(sample_img_name)
        self.current_bg_image = bg_img
        w, h = bg_img.size
        self.lbl_canvas_info.setText(f"底圖原始解析度: {w} × {h} 像素 (1:1 比例所見即所得)")
        self.canvas.load_background(bg_img)

    def _load_fallback_background(self):
        if os.path.exists("simple.jpg"):
            img = Image.open("simple.jpg")
        elif os.path.exists(self.backgrounds_dir):
            bg_files = [f for f in os.listdir(self.backgrounds_dir) if f.lower().endswith(('.jpg', '.jpeg', '.png'))]
            if bg_files:
                img = Image.open(os.path.join(self.backgrounds_dir, bg_files[0]))
            else:
                img = Image.new("RGBA", (561, 797), (255, 255, 255, 255))
        else:
            img = Image.new("RGBA", (561, 797), (255, 255, 255, 255))

        self.current_bg_image = img
        self.lbl_canvas_info.setText(f"底圖原始解析度: {img.width} × {img.height} 像素")
        self.canvas.load_background(img)

    def _on_card_code_mode_changed(self):
        """處理 QR Code 模式或文字模式切換。"""
        qr_enabled = self.chk_card_code_qr.isChecked()
        self.layout_config.setdefault("qr_code", {})["enabled"] = qr_enabled
        self.combo_qr_source.setEnabled(qr_enabled)

        src_col = self.combo_qr_source.currentText() or "card_code"
        text_enabled = self.chk_card_code_text.isChecked()
        text_configs = self.layout_config.setdefault("text_elements", {})
        if text_enabled:
            if src_col not in text_configs:
                text_configs[src_col] = {
                    "enabled": True,
                    "column": src_col,
                    "x": 39,
                    "y": 780,
                    "font_size": 16,
                    "font_color": "#000000",
                    "prefix": "",
                    "replace_underscore_with_hyphen": False,
                }
            else:
                text_configs[src_col]["enabled"] = True
            sample_val = str(self.records[0].get(src_col, "SAMPLE_CODE")) if self.records else "SAMPLE_CODE"
            text_configs[src_col]["sample_text"] = sample_val
        else:
            if src_col in text_configs:
                text_configs[src_col]["enabled"] = False

        self._refresh_canvas_items()

    def _on_qr_source_changed(self, index: int):
        """使用者自選 QR Code 來源欄位時立即響應。"""
        src_col = self.combo_qr_source.currentText()
        if not src_col:
            return
        self.layout_config.setdefault("qr_code", {})["source_column"] = src_col
        self._refresh_canvas_items()
        self.lbl_status.setText(f"已將 QR Code 來源指定為欄位: [{src_col}]")

    def _on_card_no_source_changed(self, index: int):
        """使用者自選卡片編號/檔名來源欄位時立即響應。"""
        no_col = self.combo_card_no_source.currentText()
        if not no_col:
            return
        self.layout_config["card_no_source_column"] = no_col
        self._refresh_canvas_items()
        self.lbl_status.setText(f"已將卡片編號/檔名來源指定為欄位: [{no_col}]")

    def _refresh_canvas_items(self):
        """依據當前欄位勾選與版面設定重新渲染畫布圖元。"""
        text_configs = self.layout_config.setdefault("text_elements", {})
        src_col = self.combo_qr_source.currentText() or "card_code"
        no_col = self.combo_card_no_source.currentText() or "card_no"

        # 1. 設置 QR Code (若啟用)
        qr_cfg = self.layout_config.get("qr_code", {})
        if self.chk_card_code_qr.isChecked():
            qr_x = qr_cfg.get("x", 39)
            qr_y = qr_cfg.get("y", 633)
            qr_size = qr_cfg.get("width", 136)

            sample_code = "SAMPLE_CODE"
            if self.records and src_col in self.records[0]:
                sample_code = str(self.records[0].get(src_col, "SAMPLE_CODE"))

            qr_engine = QRCodeGenerator()
            sample_qr_img = qr_engine.generate(sample_code, target_size=(int(qr_size), int(qr_size)))
            data = sample_qr_img.tobytes("raw", "RGBA")
            qim = QImage(data, sample_qr_img.width, sample_qr_img.height, QImage.Format.Format_RGBA8888)
            qr_pixmap = QPixmap.fromImage(qim)

            self.canvas.set_qr_code(qr_x, qr_y, qr_size, qr_pixmap)
        else:
            self.canvas.remove_qr_code()

        # 2. 設置 QR 來源純文字 (若啟用)
        if self.chk_card_code_text.isChecked():
            code_text_cfg = text_configs.get(src_col, {
                "enabled": True,
                "column": src_col,
                "x": 39,
                "y": 780,
                "font_size": 16,
                "font_color": "#000000",
                "prefix": "",
                "replace_underscore_with_hyphen": False,
            })
            sample_val = str(self.records[0].get(src_col, "SAMPLE_CODE")) if self.records else "SAMPLE_CODE"
            code_text_cfg["sample_text"] = sample_val
            text_configs[src_col] = code_text_cfg
            self.canvas.add_text_item(src_col, code_text_cfg)
        else:
            if not any(self.list_fields.item(i).text() == src_col and self.list_fields.item(i).checkState() == Qt.CheckState.Checked for i in range(self.list_fields.count())):
                self.canvas.remove_text_item(src_col)

        # 3. 設置其他文字欄位
        for i in range(self.list_fields.count()):
            item = self.list_fields.item(i)
            col_name = item.text()
            if col_name == src_col and self.chk_card_code_text.isChecked():
                continue
            if item.checkState() == Qt.CheckState.Checked:
                cfg = text_configs.get(col_name, {
                    "enabled": True,
                    "column": col_name,
                    "x": 445 if col_name == no_col else 300,
                    "y": 755 if col_name == no_col else (600 + i * 30),
                    "font_size": 22 if col_name == no_col else 20,
                    "font_color": "#000000",
                    "prefix": "No." if col_name == no_col else "",
                    "replace_underscore_with_hyphen": (col_name == no_col),
                })
                sample_val = str(self.records[0].get(col_name, col_name)) if self.records else col_name
                cfg["sample_text"] = sample_val
                text_configs[col_name] = cfg
                self.canvas.add_text_item(col_name, cfg)
            else:
                self.canvas.remove_text_item(col_name)

    def _on_field_check_changed(self, item: QListWidgetItem):
        col_name = item.text()
        text_configs = self.layout_config.setdefault("text_elements", {})
        no_col = self.combo_card_no_source.currentText()
        if item.checkState() == Qt.CheckState.Checked:
            if col_name not in text_configs:
                text_configs[col_name] = {
                    "enabled": True,
                    "column": col_name,
                    "x": 445 if col_name == no_col else 300,
                    "y": 755 if col_name == no_col else 650,
                    "font_size": 22,
                    "font_color": "#000000",
                    "prefix": "No." if col_name == no_col else "",
                    "replace_underscore_with_hyphen": (col_name == no_col),
                }
            cfg = text_configs[col_name]
            sample_val = str(self.records[0].get(col_name, col_name)) if self.records else col_name
            cfg["sample_text"] = sample_val
            self.canvas.add_text_item(col_name, cfg)
        else:
            self.canvas.remove_text_item(col_name)

    def _on_canvas_item_selected(self, element_data: Dict[str, Any]):
        self.style_panel.set_element(element_data)

    def _on_canvas_geometry_changed(self, geometry_data: Dict[str, Any]):
        elem_type = geometry_data.get("type")
        if elem_type == "qr_code":
            qr_cfg = self.layout_config.setdefault("qr_code", {})
            qr_cfg["x"] = geometry_data["x"]
            qr_cfg["y"] = geometry_data["y"]
            if "width" in geometry_data:
                qr_cfg["width"] = geometry_data["width"]
                qr_cfg["height"] = geometry_data["height"]
        else:
            col = geometry_data.get("column")
            if col in self.layout_config.setdefault("text_elements", {}):
                self.layout_config["text_elements"][col]["x"] = geometry_data["x"]
                self.layout_config["text_elements"][col]["y"] = geometry_data["y"]

        self.style_panel.update_geometry_only(geometry_data)

    def _on_style_property_changed(self, property_data: Dict[str, Any]):
        elem_type = property_data.get("type")
        if elem_type == "qr_code":
            qr_cfg = self.layout_config.setdefault("qr_code", {})
            qr_cfg.update(property_data)
            if self.canvas.qr_item:
                self.canvas.qr_item.setPos(qr_cfg["x"], qr_cfg["y"])
                self.canvas.qr_item.w = qr_cfg["width"]
                self.canvas.qr_item.h = qr_cfg["height"]
                self.canvas.qr_item.update()
        else:
            col = property_data.get("column")
            if col:
                text_cfg = self.layout_config.setdefault("text_elements", {}).setdefault(col, {})
                text_cfg.update(property_data)
                self.canvas.update_text_item_style(col, text_cfg)

    def _save_template(self):
        file_path, _ = QFileDialog.getSaveFileName(self, "儲存版面範本", "my_layout.json", "JSON 範本檔 (*.json)")
        if file_path:
            self.layout_config.setdefault("qr_code", {})["enabled"] = self.chk_card_code_qr.isChecked()
            self.layout_config["qr_code"]["source_column"] = self.combo_qr_source.currentText()
            self.layout_config["card_no_source_column"] = self.combo_card_no_source.currentText()

            if save_layout_template(file_path, self.layout_config):
                QMessageBox.information(self, "成功", f"版面範本已儲存至:\n{file_path}")

    def _load_template(self):
        file_path, _ = QFileDialog.getOpenFileName(self, "載入版面範本", "", "JSON 範本檔 (*.json)")
        if file_path:
            data = load_layout_template(file_path)
            if data:
                self.layout_config = data
                self._sync_ui_with_loaded_template()
                QMessageBox.information(self, "成功", "版面範本載入完成！")

    def _sync_ui_with_loaded_template(self):
        qr_cfg = self.layout_config.get("qr_code", {})
        self.chk_card_code_qr.blockSignals(True)
        self.chk_card_code_qr.setChecked(qr_cfg.get("enabled", True))
        self.chk_card_code_qr.blockSignals(False)

        src_col = qr_cfg.get("source_column", "card_code")
        idx = self.combo_qr_source.findText(src_col)
        if idx >= 0:
            self.combo_qr_source.setCurrentIndex(idx)

        no_col = self.layout_config.get("card_no_source_column", "card_no")
        n_idx = self.combo_card_no_source.findText(no_col)
        if n_idx >= 0:
            self.combo_card_no_source.setCurrentIndex(n_idx)

        text_configs = self.layout_config.get("text_elements", {})
        is_code_text = (src_col in text_configs and text_configs[src_col].get("enabled", False))
        self.chk_card_code_text.blockSignals(True)
        self.chk_card_code_text.setChecked(is_code_text)
        self.chk_card_code_text.blockSignals(False)

        self.list_fields.blockSignals(True)
        for i in range(self.list_fields.count()):
            item = self.list_fields.item(i)
            col = item.text()
            if col in text_configs and text_configs[col].get("enabled", True):
                item.setCheckState(Qt.CheckState.Checked)
            else:
                item.setCheckState(Qt.CheckState.Unchecked)
        self.list_fields.blockSignals(False)

        self._refresh_canvas_items()

    def _preview_single_card(self):
        if not self.records:
            QMessageBox.warning(self, "提示", "請先選擇並載入 Excel 檔案！")
            return

        item = self.records[0]
        bg_loader = BackgroundLoader(backgrounds_dir=self.backgrounds_dir)

        # 取得底圖檔名
        img_col = next((c for c in self.columns if "image" in c.lower() or "底圖" in c.lower()), None)
        sample_img_name = str(item.get(img_col, item.get("card_image", "")))
        if not sample_img_name and os.path.exists("simple.jpg"):
            sample_img_name = "simple.jpg"
        elif not sample_img_name and os.path.exists(self.backgrounds_dir):
            bg_files = [f for f in os.listdir(self.backgrounds_dir) if f.lower().endswith(('.jpg', '.jpeg', '.png'))]
            if bg_files:
                sample_img_name = bg_files[0]

        bg_img = bg_loader.load_background(sample_img_name)

        qr_cfg = dict(self.layout_config.get("qr_code", {}))
        qr_cfg["enabled"] = self.chk_card_code_qr.isChecked()
        src_col = self.combo_qr_source.currentText() or qr_cfg.get("source_column", "card_code")
        card_code = str(item.get(src_col, "PREVIEW_CODE"))

        qr_img = None
        if qr_cfg.get("enabled", True):
            qr_engine = QRCodeGenerator()
            qr_img = qr_engine.generate(card_code, target_size=(int(qr_cfg.get("width", 136)), int(qr_cfg.get("height", 136))))

        compositor = DynamicCardCompositor()
        text_elements_list = [cfg for cfg in self.layout_config.get("text_elements", {}).values() if cfg.get("enabled", True)]

        result_img = compositor.composite_card(
            base_image=bg_img,
            qr_image=qr_img,
            qr_config=qr_cfg,
            text_elements=text_elements_list,
            row_data=item,
        )

        dlg = QDialog(self)
        dlg.setWindowTitle("單張合成預覽成果")
        dlg.resize(600, 850)
        d_layout = QVBoxLayout(dlg)

        scroll = QScrollArea()
        lbl_img = QLabel()
        data = result_img.convert("RGBA").tobytes("raw", "RGBA")
        qim = QImage(data, result_img.width, result_img.height, QImage.Format.Format_RGBA8888)
        pixmap = QPixmap.fromImage(qim)
        lbl_img.setPixmap(pixmap.scaled(550, 780, Qt.AspectRatioMode.KeepAspectRatio, Qt.TransformationMode.SmoothTransformation))
        scroll.setWidget(lbl_img)
        d_layout.addWidget(scroll)

        btn_close = QPushButton("關閉")
        btn_close.clicked.connect(dlg.accept)
        d_layout.addWidget(btn_close)
        dlg.exec()

    def _start_batch(self):
        if not self.records:
            QMessageBox.warning(self, "提示", "請先選擇並載入 Excel 檔案！")
            return

        self.btn_start.setEnabled(False)
        self.btn_preview.setEnabled(False)
        self.progress_bar.setVisible(True)
        self.progress_bar.setValue(0)
        self.progress_bar.setMaximum(len(self.records))

        qr_cfg = dict(self.layout_config.get("qr_code", {}))
        qr_cfg["enabled"] = self.chk_card_code_qr.isChecked()
        qr_cfg["source_column"] = self.combo_qr_source.currentText()
        card_no_col = self.combo_card_no_source.currentText()

        text_elements_list = [cfg for cfg in self.layout_config.get("text_elements", {}).values() if cfg.get("enabled", True)]
        full_layout = {
            "qr_code": qr_cfg,
            "card_no_source_column": card_no_col,
            "text_elements": text_elements_list,
        }

        self.worker = BatchGenerateWorker(
            records=self.records,
            layout_config=full_layout,
            backgrounds_dir=self.backgrounds_dir,
            output_dir=self.output_dir,
        )
        self.worker.progress.connect(self._on_worker_progress)
        self.worker.finished_batch.connect(self._on_worker_finished)
        self.worker.log_message.connect(lambda msg: self.lbl_status.setText(msg))
        self.worker.start()

    def _on_worker_progress(self, current: int, total: int, card_no: str):
        self.progress_bar.setValue(current)
        self.lbl_status.setText(f"正在生成: [{current}/{total}] 卡片 {card_no}...")

    def _on_worker_finished(self, success: int, fail: int, elapsed: float):
        self.btn_start.setEnabled(True)
        self.btn_preview.setEnabled(True)
        self.progress_bar.setVisible(False)
        self.lbl_status.setText(f"批次完成！成功: {success} 張，失敗: {fail} 張，耗時: {elapsed:.1f} 秒")

        QMessageBox.information(
            self,
            "批次生成完成",
            f"🎉 批次任務順利完成！\n\n"
            f"• 成功生成: {success} 張\n"
            f"• 失敗筆數: {fail} 張\n"
            f"• 總共耗時: {elapsed:.2f} 秒\n"
            f"• 儲存路徑: {self.output_dir}"
        )
