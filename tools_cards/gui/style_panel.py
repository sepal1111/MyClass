from typing import Dict, Any, Optional
from PyQt6.QtCore import pyqtSignal, Qt
from PyQt6.QtGui import QColor
from PyQt6.QtWidgets import (
    QWidget, QVBoxLayout, QHBoxLayout, QGridLayout, QLabel, QSpinBox, QLineEdit,
    QPushButton, QColorDialog, QCheckBox, QGroupBox
)


class StyleInspectorPanel(QWidget):
    """屬性檢查與樣式調整面板。"""

    property_changed = pyqtSignal(dict)

    def __init__(self, parent=None):
        super().__init__(parent)
        self.current_element: Optional[Dict[str, Any]] = None
        self._is_updating = False

        self.setMinimumWidth(310)
        self._init_ui()

    def _create_step_button(self, text: str, callback) -> QPushButton:
        """建立清晰顯眼的 [+] 與 [-] 調整按鈕。"""
        btn = QPushButton(text)
        btn.setFixedSize(30, 28)
        btn.setCursor(Qt.CursorShape.PointingHandCursor)
        btn.setStyleSheet("""
            QPushButton {
                background-color: #EEF2F6;
                color: #1E293B;
                font-size: 16px;
                font-weight: bold;
                border: 1px solid #CBD5E1;
                border-radius: 4px;
                padding: 0px;
                margin: 0px;
            }
            QPushButton:hover {
                background-color: #E2E8F0;
                color: #0F172A;
                border-color: #94A3B8;
            }
            QPushButton:pressed {
                background-color: #CBD5E1;
            }
        """)
        btn.clicked.connect(callback)
        return btn

    def _create_clean_spinbox(self, min_val: int, max_val: int, suffix: str = "") -> QSpinBox:
        """建立移除上下按鈕的純淨數值輸入框。"""
        spin = QSpinBox()
        spin.setRange(min_val, max_val)
        spin.setMinimumHeight(28)
        # 徹底移除上下箭頭按鈕
        spin.setButtonSymbols(QSpinBox.ButtonSymbols.NoButtons)
        spin.setAlignment(Qt.AlignmentFlag.AlignCenter)
        if suffix:
            spin.setSuffix(suffix)
        spin.setStyleSheet("""
            QSpinBox {
                border: 1px solid #CBD5E1;
                border-radius: 4px;
                padding: 2px 6px;
                background-color: #FFFFFF;
                color: #0F172A;
                font-size: 13px;
                font-weight: bold;
            }
            QSpinBox:focus {
                border: 1px solid #0066CC;
            }
        """)
        spin.valueChanged.connect(self._on_value_changed)
        return spin

    def _init_ui(self):
        layout = QVBoxLayout(self)
        layout.setContentsMargins(8, 8, 8, 8)
        layout.setSpacing(10)

        # 標題群組 (柔和丁香紫/石板灰色調)
        self.group = QGroupBox("🎨 步驟 3：微調元素屬性與樣式")
        self.group.setStyleSheet("""
            QGroupBox {
                font-weight: bold;
                font-size: 13px;
                border: 1.5px solid #E2E8F0;
                border-radius: 8px;
                margin-top: 10px;
                padding-top: 14px;
                background-color: #FAFBFD;
            }
            QGroupBox::title {
                subcontrol-origin: margin;
                left: 14px;
                padding: 2px 10px;
                color: #475569;
                background-color: #F1F5F9;
                border: 1px solid #CBD5E1;
                border-radius: 4px;
            }
        """)
        group_layout = QVBoxLayout(self.group)
        group_layout.setContentsMargins(12, 16, 12, 14)
        group_layout.setSpacing(12)

        # 元素名稱標籤
        self.lbl_target = QLabel("💡 請在中間畫布點選任一文字或條碼進行微調")
        self.lbl_target.setWordWrap(True)
        self.lbl_target.setStyleSheet("font-weight: bold; font-size: 12px; color: #6D28D9; background-color: #F5F3FF; border: 1px solid #DDD6FE; border-radius: 6px; padding: 6px 10px;")
        group_layout.addWidget(self.lbl_target)

        # 1. 座標控制 (X, Y) - 移除上下箭頭，改以 [+] 與 [-] 調整
        coord_box = QGroupBox("📍 位置座標 (像素)")
        coord_box.setStyleSheet("""
            QGroupBox {
                font-weight: bold;
                border: 1px solid #E2E8F0;
                border-radius: 6px;
                margin-top: 8px;
                padding-top: 12px;
                background-color: #FFFFFF;
            }
            QGroupBox::title {
                subcontrol-origin: margin;
                left: 10px;
                padding: 1px 6px;
                color: #475569;
            }
        """)
        coord_layout = QGridLayout(coord_box)
        coord_layout.setContentsMargins(10, 14, 10, 10)
        coord_layout.setSpacing(8)

        # X 軸控制
        lbl_x = QLabel("X:")
        lbl_x.setStyleSheet("font-weight: bold; font-size: 13px;")
        coord_layout.addWidget(lbl_x, 0, 0)

        self.spin_x = self._create_clean_spinbox(0, 9999)
        btn_x_minus = self._create_step_button("-", lambda: self._step_spinbox(self.spin_x, -5))
        btn_x_plus = self._create_step_button("+", lambda: self._step_spinbox(self.spin_x, 5))

        coord_layout.addWidget(btn_x_minus, 0, 1)
        coord_layout.addWidget(self.spin_x, 0, 2)
        coord_layout.addWidget(btn_x_plus, 0, 3)

        # Y 軸控制
        lbl_y = QLabel("Y:")
        lbl_y.setStyleSheet("font-weight: bold; font-size: 13px;")
        coord_layout.addWidget(lbl_y, 1, 0)

        self.spin_y = self._create_clean_spinbox(0, 9999)
        btn_y_minus = self._create_step_button("-", lambda: self._step_spinbox(self.spin_y, -5))
        btn_y_plus = self._create_step_button("+", lambda: self._step_spinbox(self.spin_y, 5))

        coord_layout.addWidget(btn_y_minus, 1, 1)
        coord_layout.addWidget(self.spin_y, 1, 2)
        coord_layout.addWidget(btn_y_plus, 1, 3)

        coord_layout.setColumnStretch(2, 1)
        group_layout.addWidget(coord_box)

        # 2. 尺寸控制 (用於 QR Code) - 移除上下箭頭，改以 [+] 與 [-] 調整
        self.size_widget = QGroupBox("📐 QR Code 尺寸調整")
        self.size_widget.setStyleSheet("""
            QGroupBox {
                font-weight: bold;
                border: 1px solid #E2E8F0;
                border-radius: 6px;
                margin-top: 8px;
                padding-top: 12px;
                background-color: #FFFFFF;
            }
            QGroupBox::title {
                subcontrol-origin: margin;
                left: 10px;
                padding: 1px 6px;
                color: #475569;
            }
        """)
        size_layout = QHBoxLayout(self.size_widget)
        size_layout.setContentsMargins(10, 14, 10, 10)
        size_layout.setSpacing(8)

        lbl_size = QLabel("尺寸:")
        lbl_size.setStyleSheet("font-weight: bold; font-size: 13px;")
        size_layout.addWidget(lbl_size)

        self.spin_size = self._create_clean_spinbox(30, 2000, suffix=" px")
        self.spin_size.setValue(136)
        btn_size_minus = self._create_step_button("-", lambda: self._step_spinbox(self.spin_size, -10))
        btn_size_plus = self._create_step_button("+", lambda: self._step_spinbox(self.spin_size, 10))

        size_layout.addWidget(btn_size_minus)
        size_layout.addWidget(self.spin_size, 1)
        size_layout.addWidget(btn_size_plus)

        group_layout.addWidget(self.size_widget)

        # 3. 文字相關控制區 (用於文字欄位) - 移除上下箭頭，改以 [+] 與 [-] 調整
        self.text_widget = QGroupBox("🔤 文字樣式調整")
        self.text_widget.setStyleSheet("""
            QGroupBox {
                font-weight: bold;
                border: 1px solid #E2E8F0;
                border-radius: 6px;
                margin-top: 8px;
                padding-top: 12px;
                background-color: #FFFFFF;
            }
            QGroupBox::title {
                subcontrol-origin: margin;
                left: 10px;
                padding: 1px 6px;
                color: #475569;
            }
        """)
        text_layout = QVBoxLayout(self.text_widget)
        text_layout.setContentsMargins(10, 14, 10, 10)
        text_layout.setSpacing(10)

        # 字型大小與調整按鈕
        font_box = QHBoxLayout()
        font_box.setSpacing(8)
        lbl_font = QLabel("字型大小:")
        lbl_font.setStyleSheet("font-weight: bold; font-size: 13px;")
        font_box.addWidget(lbl_font)

        self.spin_font_size = self._create_clean_spinbox(8, 200, suffix=" pt")
        self.spin_font_size.setValue(22)
        btn_font_minus = self._create_step_button("-", lambda: self._step_spinbox(self.spin_font_size, -1))
        btn_font_plus = self._create_step_button("+", lambda: self._step_spinbox(self.spin_font_size, 1))

        font_box.addWidget(btn_font_minus)
        font_box.addWidget(self.spin_font_size, 1)
        font_box.addWidget(btn_font_plus)

        text_layout.addLayout(font_box)

        # 色彩選擇器 (柔和顯眼的按鈕標記)
        color_layout = QHBoxLayout()
        lbl_color = QLabel("文字顏色:")
        lbl_color.setStyleSheet("font-weight: bold; font-size: 13px;")
        color_layout.addWidget(lbl_color)

        self.btn_color = QPushButton("🎨 選擇文字顏色")
        self.btn_color.setMinimumHeight(30)
        self.btn_color.setCursor(Qt.CursorShape.PointingHandCursor)
        self.current_color = "#000000"
        self._update_color_button(self.current_color)
        self.btn_color.clicked.connect(self._choose_color)
        color_layout.addWidget(self.btn_color, 1)
        text_layout.addLayout(color_layout)

        # 前綴字元
        prefix_layout = QHBoxLayout()
        lbl_prefix = QLabel("前綴文字:")
        lbl_prefix.setStyleSheet("font-weight: bold; font-size: 13px;")
        prefix_layout.addWidget(lbl_prefix)

        self.edit_prefix = QLineEdit()
        self.edit_prefix.setMinimumHeight(28)
        self.edit_prefix.setPlaceholderText("例如: No.")
        self.edit_prefix.setStyleSheet("""
            QLineEdit {
                border: 1.5px solid #CBD5E1;
                border-radius: 4px;
                padding: 2px 6px;
                background-color: #FFFFFF;
                color: #0F172A;
            }
            QLineEdit:focus {
                border: 1.5px solid #3B82F6;
            }
        """)
        self.edit_prefix.textChanged.connect(self._on_value_changed)
        prefix_layout.addWidget(self.edit_prefix, 1)
        text_layout.addLayout(prefix_layout)

        # 底線替換連字號核取
        self.chk_hyphen = QCheckBox("將底線 '_' 轉為連字號 '-'")
        self.chk_hyphen.setChecked(True)
        self.chk_hyphen.stateChanged.connect(self._on_value_changed)
        text_layout.addWidget(self.chk_hyphen)

        group_layout.addWidget(self.text_widget)
        layout.addWidget(self.group)
        layout.addStretch()

        self.setEnabled(False)

    def _step_spinbox(self, spin: QSpinBox, delta: int):
        """提供 [+] 與 [-] 按鈕快速加減數值。"""
        val = spin.value() + delta
        spin.setValue(max(spin.minimum(), min(spin.maximum(), val)))

    def _update_color_button(self, hex_code: str):
        is_dark = QColor(hex_code).lightness() < 128
        text_color = "#FFFFFF" if is_dark else "#0F172A"
        border_color = "#64748B" if is_dark else "#94A3B8"
        self.btn_color.setStyleSheet(f"""
            QPushButton {{
                background-color: {hex_code};
                color: {text_color};
                font-weight: bold;
                font-size: 13px;
                border: 2px solid {border_color};
                border-radius: 6px;
                padding: 5px 12px;
            }}
            QPushButton:hover {{
                border-color: #3B82F6;
            }}
        """)
        self.btn_color.setText(f"🎨 選擇文字顏色 ({hex_code})")

    def _choose_color(self):
        initial = QColor(self.current_color)
        color = QColorDialog.getColor(initial, self, "選擇文字顏色")
        if color.isValid():
            self.current_color = color.name()
            self._update_color_button(self.current_color)
            self._on_value_changed()

    def set_element(self, element_data: Dict[str, Any]):
        """載入選取圖元之屬性至檢查器。"""
        self._is_updating = True
        self.current_element = dict(element_data)
        self.setEnabled(True)

        elem_type = element_data.get("type", "")
        self.spin_x.setValue(int(element_data.get("x", 0)))
        self.spin_y.setValue(int(element_data.get("y", 0)))

        if elem_type == "qr_code":
            self.lbl_target.setText("🎯 已選取：【QR Code 條碼圖元】")
            self.lbl_target.setStyleSheet("font-weight: bold; font-size: 12px; color: #1D4ED8; background-color: #EFF6FF; border: 1px solid #BFDBFE; border-radius: 6px; padding: 6px 10px;")
            self.size_widget.setVisible(True)
            self.text_widget.setVisible(False)
            self.spin_size.setValue(int(element_data.get("width", 136)))
        else:
            col_name = element_data.get("column", "")
            self.lbl_target.setText(f"🎯 已選取：【文字欄位: {col_name}】")
            self.lbl_target.setStyleSheet("font-weight: bold; font-size: 12px; color: #047857; background-color: #ECFDF5; border: 1px solid #A7F3D0; border-radius: 6px; padding: 6px 10px;")
            self.size_widget.setVisible(False)
            self.text_widget.setVisible(True)
            self.spin_font_size.setValue(int(element_data.get("font_size", 22)))
            self.current_color = element_data.get("font_color", "#000000")
            self._update_color_button(self.current_color)
            self.edit_prefix.setText(element_data.get("prefix", ""))
            self.chk_hyphen.setChecked(element_data.get("replace_underscore_with_hyphen", False))

        self._is_updating = False


    def update_geometry_only(self, geometry_data: Dict[str, Any]):
        """僅同步座標與大小，不重複重載整個面板。"""
        self._is_updating = True
        self.spin_x.setValue(int(geometry_data.get("x", 0)))
        self.spin_y.setValue(int(geometry_data.get("y", 0)))
        if geometry_data.get("type") == "qr_code" and "width" in geometry_data:
            self.spin_size.setValue(int(geometry_data.get("width", 136)))
        self._is_updating = False

    def _on_value_changed(self):
        if self._is_updating or not self.current_element:
            return

        elem_type = self.current_element.get("type")
        data = {
            "type": elem_type,
            "x": self.spin_x.value(),
            "y": self.spin_y.value(),
        }

        if elem_type == "qr_code":
            data["width"] = self.spin_size.value()
            data["height"] = self.spin_size.value()
        else:
            data["column"] = self.current_element.get("column")
            data["font_size"] = self.spin_font_size.value()
            data["font_color"] = self.current_color
            data["prefix"] = self.edit_prefix.text()
            data["replace_underscore_with_hyphen"] = self.chk_hyphen.isChecked()

        self.current_element.update(data)
        self.property_changed.emit(data)
