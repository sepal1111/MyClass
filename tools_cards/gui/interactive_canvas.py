from typing import Callable, Optional, Dict, Any
from PyQt6.QtCore import Qt, QRectF, QPointF, pyqtSignal, QObject
from PyQt6.QtGui import (
    QBrush, QColor, QFont, QPainter, QPen, QPixmap, QImage, QCursor
)
from PyQt6.QtWidgets import (
    QGraphicsView, QGraphicsScene, QGraphicsItem, QGraphicsRectItem,
    QGraphicsPixmapItem, QGraphicsTextItem
)
from PIL import Image


class CanvasSignals(QObject):
    item_selected = pyqtSignal(dict)       # 當圖元被點選時觸發 (傳遞 element 資料)
    item_geometry_changed = pyqtSignal(dict) # 當圖元拖曳移動或縮放時觸發


class DraggableQRItem(QGraphicsItem):
    """可拖曳與縮放之 QR Code 圖元。"""

    HANDLE_SIZE = 10

    def __init__(self, x: float, y: float, size: float, qr_pixmap: Optional[QPixmap] = None):
        super().__init__()
        self.setPos(x, y)
        self.w = float(size)
        self.h = float(size)
        self.qr_pixmap = qr_pixmap
        self.is_resizing = False
        self.is_selected = False
        self.signals: Optional[CanvasSignals] = None

        self.setFlags(
            QGraphicsItem.GraphicsItemFlag.ItemIsMovable |
            QGraphicsItem.GraphicsItemFlag.ItemIsSelectable |
            QGraphicsItem.GraphicsItemFlag.ItemSendsGeometryChanges
        )
        self.setAcceptHoverEvents(True)

    def boundingRect(self) -> QRectF:
        # 包含縮放把手的邊界
        return QRectF(0, 0, self.w + self.HANDLE_SIZE, self.h + self.HANDLE_SIZE)

    def paint(self, painter: QPainter, option, widget=None):
        rect = QRectF(0, 0, self.w, self.h)

        # 繪製白色底底與 QR 縮圖
        painter.fillRect(rect, QBrush(QColor(255, 255, 255, 230)))
        if self.qr_pixmap and not self.qr_pixmap.isNull():
            painter.drawPixmap(rect.toRect(), self.qr_pixmap)
        else:
            # 預設黑白 QR 示意符號
            painter.setPen(QPen(QColor(0, 0, 0), 2))
            painter.drawRect(rect)
            painter.drawText(rect, Qt.AlignmentFlag.AlignCenter, "QR CODE")

        # 選取框樣式
        if self.isSelected() or self.is_selected:
            pen = QPen(QColor(0, 122, 255), 2, Qt.PenStyle.DashLine)
            painter.setPen(pen)
            painter.setBrush(Qt.BrushStyle.NoBrush)
            painter.drawRect(rect)

            # 繪製右下角縮放把手
            handle_rect = QRectF(self.w - 2, self.h - 2, self.HANDLE_SIZE, self.HANDLE_SIZE)
            painter.fillRect(handle_rect, QColor(0, 122, 255))
            painter.setPen(QPen(QColor(255, 255, 255), 1))
            painter.drawRect(handle_rect)

    def hoverMoveEvent(self, event):
        # 若滑鼠移至右下角把手，改變游標為縮放游標
        pos = event.pos()
        if pos.x() >= self.w - 5 and pos.y() >= self.h - 5:
            self.setCursor(QCursor(Qt.CursorShape.SizeFDiagCursor))
        else:
            self.setCursor(QCursor(Qt.CursorShape.SizeAllCursor))
        super().hoverMoveEvent(event)

    def mousePressEvent(self, event):
        pos = event.pos()
        if event.button() == Qt.MouseButton.LeftButton:
            if pos.x() >= self.w - 5 and pos.y() >= self.h - 5:
                self.is_resizing = True
                event.accept()
                return
        self.is_resizing = False
        super().mousePressEvent(event)
        if self.signals:
            self.signals.item_selected.emit({
                "type": "qr_code",
                "x": int(self.x()),
                "y": int(self.y()),
                "width": int(self.w),
                "height": int(self.h),
            })

    def mouseMoveEvent(self, event):
        if self.is_resizing:
            new_size = max(50.0, min(event.pos().x(), event.pos().y()))
            self.prepareGeometryChange()
            self.w = new_size
            self.h = new_size
            self.update()
            if self.signals:
                self.signals.item_geometry_changed.emit({
                    "type": "qr_code",
                    "x": int(self.x()),
                    "y": int(self.y()),
                    "width": int(self.w),
                    "height": int(self.h),
                })
            event.accept()
        else:
            super().mouseMoveEvent(event)
            if self.signals:
                self.signals.item_geometry_changed.emit({
                    "type": "qr_code",
                    "x": int(self.x()),
                    "y": int(self.y()),
                    "width": int(self.w),
                    "height": int(self.h),
                })

    def mouseReleaseEvent(self, event):
        self.is_resizing = False
        super().mouseReleaseEvent(event)
        if self.signals:
            self.signals.item_geometry_changed.emit({
                "type": "qr_code",
                "x": int(self.x()),
                "y": int(self.y()),
                "width": int(self.w),
                "height": int(self.h),
            })


class DraggableTextItem(QGraphicsItem):
    """可拖曳、即時預覽文字字型、色彩與大小之文字圖元。"""

    def __init__(self, column_name: str, config: Dict[str, Any]):
        super().__init__()
        self.column_name = column_name
        self.config = config
        self.setPos(float(config.get("x", 100)), float(config.get("y", 100)))
        self.signals: Optional[CanvasSignals] = None

        self.setFlags(
            QGraphicsItem.GraphicsItemFlag.ItemIsMovable |
            QGraphicsItem.GraphicsItemFlag.ItemIsSelectable |
            QGraphicsItem.GraphicsItemFlag.ItemSendsGeometryChanges
        )
        self.setCursor(QCursor(Qt.CursorShape.SizeAllCursor))

    def get_display_text(self) -> str:
        prefix = self.config.get("prefix", "")
        suffix = self.config.get("suffix", "")
        sample = self.config.get("sample_text", self.column_name)
        if self.config.get("replace_underscore_with_hyphen", False):
            sample = str(sample).replace("_", "-")
        return f"{prefix}{sample}{suffix}"

    def boundingRect(self) -> QRectF:
        font = QFont(self.config.get("font_family", "Microsoft JhengHei"), int(self.config.get("font_size", 22)))
        font.setBold(True)
        from PyQt6.QtGui import QFontMetrics
        fm = QFontMetrics(font)
        text = self.get_display_text()
        rect = fm.boundingRect(text)
        # 加上微小邊距便於拖曳點擊
        margin = 4
        return QRectF(rect.x() - margin, rect.y() - margin, rect.width() + margin * 2, rect.height() + margin * 2)

    def paint(self, painter: QPainter, option, widget=None):
        text = self.get_display_text()
        font_size = int(self.config.get("font_size", 22))
        font_color = QColor(self.config.get("font_color", "#000000"))

        font = QFont(self.config.get("font_family", "Microsoft JhengHei"), font_size)
        font.setBold(True)
        painter.setFont(font)

        # 選取或滑鼠經過外框
        b_rect = self.boundingRect()
        if self.isSelected():
            painter.fillRect(b_rect, QColor(0, 122, 255, 30))
            painter.setPen(QPen(QColor(0, 122, 255), 1.5, Qt.PenStyle.DashLine))
            painter.drawRect(b_rect)
        else:
            painter.fillRect(b_rect, QColor(255, 255, 255, 70))
            painter.setPen(QPen(QColor(180, 180, 180, 100), 1, Qt.PenStyle.DotLine))
            painter.drawRect(b_rect)

        painter.setPen(QPen(font_color))
        painter.drawText(0, 0, text)

    def mousePressEvent(self, event):
        super().mousePressEvent(event)
        if self.signals:
            self.signals.item_selected.emit({
                "type": "text",
                "column": self.column_name,
                "x": int(self.x()),
                "y": int(self.y()),
                "font_size": int(self.config.get("font_size", 22)),
                "font_color": self.config.get("font_color", "#000000"),
                "prefix": self.config.get("prefix", ""),
                "replace_underscore_with_hyphen": self.config.get("replace_underscore_with_hyphen", False),
            })

    def mouseMoveEvent(self, event):
        super().mouseMoveEvent(event)
        if self.signals:
            self.signals.item_geometry_changed.emit({
                "type": "text",
                "column": self.column_name,
                "x": int(self.x()),
                "y": int(self.y()),
            })

    def mouseReleaseEvent(self, event):
        super().mouseReleaseEvent(event)
        if self.signals:
            self.signals.item_geometry_changed.emit({
                "type": "text",
                "column": self.column_name,
                "x": int(self.x()),
                "y": int(self.y()),
            })


class InteractiveCardCanvas(QGraphicsView):
    """所見即所得可互動卡片畫布。"""

    def __init__(self, parent=None):
        super().__init__(parent)
        self.scene = QGraphicsScene(self)
        self.setScene(self.scene)
        self.signals = CanvasSignals()

        self.bg_item: Optional[QGraphicsPixmapItem] = None
        self.qr_item: Optional[DraggableQRItem] = None
        self.text_items: Dict[str, DraggableTextItem] = {}

        self.canvas_width = 561
        self.canvas_height = 797

        # 視窗樣式設定 (抗鋸齒與平滑縮放)
        self.setRenderHint(QPainter.RenderHint.Antialiasing)
        self.setRenderHint(QPainter.RenderHint.SmoothPixmapTransform)
        self.setBackgroundBrush(QBrush(QColor(240, 242, 245)))
        self.setDragMode(QGraphicsView.DragMode.NoDrag)

    def load_background(self, pil_image: Image.Image):
        """載入底圖並自動偵測尺寸調適畫布大小。"""
        self.canvas_width, self.canvas_height = pil_image.size
        self.scene.setSceneRect(0, 0, self.canvas_width, self.canvas_height)

        # 轉換 PIL Image 為 QPixmap
        img_rgba = pil_image.convert("RGBA")
        data = img_rgba.tobytes("raw", "RGBA")
        qim = QImage(data, img_rgba.width, img_rgba.height, QImage.Format.Format_RGBA8888)
        pixmap = QPixmap.fromImage(qim)

        if self.bg_item is None:
            self.bg_item = QGraphicsPixmapItem(pixmap)
            self.bg_item.setZValue(-100)  # 底層
            self.scene.addItem(self.bg_item)
        else:
            self.bg_item.setPixmap(pixmap)

        self.fitInView(self.scene.sceneRect(), Qt.AspectRatioMode.KeepAspectRatio)

    def set_qr_code(self, x: int, y: int, size: int, qr_pixmap: Optional[QPixmap] = None):
        """新增或更新 QR Code 圖元。"""
        if self.qr_item is not None:
            self.scene.removeItem(self.qr_item)

        self.qr_item = DraggableQRItem(x, y, size, qr_pixmap)
        self.qr_item.signals = self.signals
        self.qr_item.setZValue(10)
        self.scene.addItem(self.qr_item)

    def remove_qr_code(self):
        """移除 QR Code 圖元。"""
        if self.qr_item is not None:
            self.scene.removeItem(self.qr_item)
            self.qr_item = None

    def add_text_item(self, column_name: str, config: Dict[str, Any]):
        """新增或更新文字圖元。"""
        if column_name in self.text_items:
            self.scene.removeItem(self.text_items[column_name])

        item = DraggableTextItem(column_name, config)
        item.signals = self.signals
        item.setZValue(20)
        self.scene.addItem(item)
        self.text_items[column_name] = item

    def remove_text_item(self, column_name: str):
        """移除指定文字圖元。"""
        if column_name in self.text_items:
            self.scene.removeItem(self.text_items[column_name])
            del self.text_items[column_name]

    def update_text_item_style(self, column_name: str, config: Dict[str, Any]):
        """即時更新文字圖元樣式。"""
        if column_name in self.text_items:
            item = self.text_items[column_name]
            item.config.update(config)
            item.prepareGeometryChange()
            item.setPos(float(item.config.get("x", item.x())), float(item.config.get("y", item.y())))
            item.update()

    def resizeEvent(self, event):
        super().resizeEvent(event)
        if self.scene.sceneRect().isValid():
            self.fitInView(self.scene.sceneRect(), Qt.AspectRatioMode.KeepAspectRatio)
