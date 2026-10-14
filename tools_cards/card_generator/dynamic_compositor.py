import logging
import os
from typing import Any, Dict, List, Optional, Tuple
from PIL import Image, ImageDraw, ImageFont

logger = logging.getLogger(__name__)

# Windows 常用中文字型候選
FONT_CANDIDATES = [
    r"C:\Windows\Fonts\msjhbd.ttc",  # 微軟正黑體 粗體
    r"C:\Windows\Fonts\msjh.ttc",    # 微軟正黑體
    r"C:\Windows\Fonts\kaiu.ttf",    # 標楷體
    r"C:\Windows\Fonts\simsun.ttc",  # 宋體
    r"C:\Windows\Fonts\arial.ttf",   # Arial
]


class DynamicCardCompositor:
    """動態多欄位卡片合成器，支援任意自訂欄位、動態背景尺寸與精確座標定位。"""

    def __init__(self):
        self._font_cache: Dict[Tuple[str, int], Any] = {}

    def get_font(self, font_name: Optional[str], font_size: int) -> ImageFont.FreeTypeFont | ImageFont.ImageFont:
        """取得指定大小之字型，支援自動 Fallback 機制。"""
        cache_key = (font_name or "", font_size)
        if cache_key in self._font_cache:
            return self._font_cache[cache_key]

        search_paths = []
        if font_name:
            search_paths.append(font_name)
            search_paths.append(os.path.join(r"C:\Windows\Fonts", font_name))

        search_paths.extend(FONT_CANDIDATES)

        for path in search_paths:
            if os.path.isfile(path):
                try:
                    font = ImageFont.truetype(path, font_size)
                    self._font_cache[cache_key] = font
                    return font
                except Exception:
                    continue

        fallback = ImageFont.load_default()
        self._font_cache[cache_key] = fallback
        return fallback

    def composite_card(
        self,
        base_image: Image.Image,
        qr_image: Optional[Image.Image],
        qr_config: Dict[str, Any],
        text_elements: List[Dict[str, Any]],
        row_data: Dict[str, Any],
    ) -> Image.Image:
        """依據動態配置將 QR Code 與自訂勾選文字欄位合成至底圖上。

        Args:
            base_image: 原始底圖 (RGBA 模式，保留底圖原始大小)
            qr_image: 產生的 QR Code 影像 (若為 None 則不貼)
            qr_config: QR Code 相關配置 (包含 position, size 等)
            text_elements: 要繪製的文字欄位設定清單
            row_data: 當前資料列的原始鍵值字典

        Returns:
            PIL.Image.Image: 合成後的最終卡片圖檔 (RGBA)
        """
        canvas = base_image.copy()
        if canvas.mode != "RGBA":
            canvas = canvas.convert("RGBA")

        # 1. 繪製 QR Code
        if qr_image and qr_config.get("enabled", True):
            qr_x = int(qr_config.get("x", 39))
            qr_y = int(qr_config.get("y", 633))
            qr_w = int(qr_config.get("width", 136))
            qr_h = int(qr_config.get("height", 136))

            # 若尺寸不同則重採樣
            if (qr_image.width, qr_image.height) != (qr_w, qr_h):
                qr_resized = qr_image.resize((qr_w, qr_h), Image.Resampling.LANCZOS)
            else:
                qr_resized = qr_image

            canvas.paste(qr_resized, (qr_x, qr_y), qr_resized)

        # 2. 繪製自選文字欄位
        draw = ImageDraw.Draw(canvas)
        for elem in text_elements:
            if not elem.get("enabled", True):
                continue

            col_name = elem.get("column", "")
            raw_val = row_data.get(col_name, "")
            if raw_val is None:
                raw_val = ""

            val_str = str(raw_val).strip()

            # 處理浮點數如 1.0 -> 1
            try:
                val_float = float(val_str)
                if val_float.is_integer():
                    val_str = str(int(val_float))
            except (ValueError, TypeError):
                pass

            # 支援底線替換為連字號 (例如 A_001 -> A-001)
            if elem.get("replace_underscore_with_hyphen", False):
                val_str = val_str.replace("_", "-")

            prefix = elem.get("prefix", "")
            suffix = elem.get("suffix", "")
            display_text = f"{prefix}{val_str}{suffix}"
            if not display_text:
                continue

            x = int(elem.get("x", 100))
            y = int(elem.get("y", 100))
            font_size = int(elem.get("font_size", 22))
            font_color = elem.get("font_color", "#000000")
            font_family = elem.get("font_family", "msjhbd.ttc")
            anchor = elem.get("anchor", "la")  # 'la': 左上, 'rm': 右中, 'mm': 正中, 'ra': 右上

            font = self.get_font(font_family, font_size)

            try:
                draw.text(
                    (x, y),
                    display_text,
                    fill=font_color,
                    font=font,
                    anchor=anchor,
                )
            except Exception as e:
                logger.warning(f"繪製文字 '{display_text}' 發生異常: {e}")

        return canvas
