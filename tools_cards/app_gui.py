import sys
import os
from PyQt6.QtWidgets import QApplication
from PyQt6.QtCore import Qt
from gui.main_window import MainWindow

# 啟用高 DPI 縮放支援
if hasattr(Qt.ApplicationAttribute, "AA_EnableHighDpiScaling"):
    QApplication.setAttribute(Qt.ApplicationAttribute.AA_EnableHighDpiScaling, True)
if hasattr(Qt.ApplicationAttribute, "AA_UseHighDpiPixmaps"):
    QApplication.setAttribute(Qt.ApplicationAttribute.AA_UseHighDpiPixmaps, True)


def main():
    app = QApplication(sys.argv)
    app.setStyle("Fusion")  # 跨平台一致且現代的 Fusion 風格

    # 設置簡約專業且適合教學與行政老師使用的柔和現代風樣式
    app.setStyleSheet("""
        * {
            font-family: 'Segoe UI', 'Microsoft JhengHei UI', 'PingFang TC', sans-serif;
        }
        QMainWindow {
            background-color: #F8FAFC;
        }
        QLineEdit {
            border: 1.5px solid #CBD5E1;
            border-radius: 5px;
            padding: 5px 8px;
            background-color: #FFFFFF;
            color: #1E293B;
            font-size: 12px;
        }
        QLineEdit:focus {
            border: 1.5px solid #3B82F6;
        }
        QLineEdit:read-only {
            background-color: #F8FAFC;
            color: #475569;
        }
        QSpinBox {
            border: 1.5px solid #CBD5E1;
            border-radius: 4px;
            padding: 2px 6px;
            background-color: #FFFFFF;
            color: #0F172A;
            font-size: 13px;
            font-weight: bold;
            min-height: 26px;
        }
        QSpinBox:focus {
            border: 1.5px solid #3B82F6;
        }
        QSpinBox::up-button, QSpinBox::down-button {
            width: 0px;
            height: 0px;
            border: none;
        }
        QScrollBar:vertical {
            border: none;
            background: #F1F5F9;
            width: 8px;
            border-radius: 4px;
        }
        QScrollBar::handle:vertical {
            background: #CBD5E1;
            border-radius: 4px;
            min-height: 20px;
        }
        QScrollBar::handle:vertical:hover {
            background: #94A3B8;
        }
    """)

    window = MainWindow()
    window.show()
    sys.exit(app.exec())


if __name__ == "__main__":
    main()
