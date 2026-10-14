import logging
import os
from typing import Any, Dict, Optional, Tuple
from PIL import Image, ImageDraw, ImageFont

logger = logging.getLogger(__name__)

# 常見 Windows 中文字型搜尋候選路徑
DEFAULT_FONT_CANDIDATES = [
    r"C:\Windows\Fonts\msjh.ttc",    # 微軟正黑體
    r"C:\Windows\Fonts\msjhbd.ttc",  # 微軟正黑體 粗體
    r"C:\Windows\Fonts\msjhl.ttc",   # 微軟正黑體 細體
    r"C:\Windows\Fonts\kaiu.ttf",    # 標楷體
    r"C:\Windows\Fonts\simsun.ttc",  # 宋體
    r"C:\Windows\Fonts\arial.ttf",   # Arial
]


class CardCompositor:
    """影像合成與定位模組，負責將 QR Code 與文字標記渲染至卡片底圖上。"""

    def __init__(self, config: Dict[str, Any]):
        """
        Args:
            config: 系統設定字典，包含 qr_code 與 text_elements 設定
        """
        self.config = config
        self.qr_config = config.get("qr_code", {})
        self.text_config = config.get("text_elements", {})
        self._font_cache: Dict[Tuple[str, int], ImageFont.FreeTypeFont | ImageFont.ImageFont] = {}

    def get_font(self, font_name: Optional[str], font_size: int) -> ImageFont.FreeTypeFont | ImageFont.ImageFont:
        """載入指定字型，具備多層級中文字型自動降級 (Fallback) 機制。"""
        cache_key = (font_name or "", font_size)
        if cache_key in self._font_cache:
            return self._font_cache[cache_key]

        # 1. 嘗試直接載入或自 Windows Fonts 目錄載入
        search_paths = []
        if font_name:
            search_paths.append(font_name)
            search_paths.append(os.path.join(r"C:\Windows\Fonts", font_name))

        # 加入系統預設中文備選字型
        search_paths.extend(DEFAULT_FONT_CANDIDATES)

        for path in search_paths:
            if os.path.isfile(path):
                try:
                    font = ImageFont.truetype(path, font_size)
                    self._font_cache[cache_key] = font
                    return font
                except Exception:
                    continue

        # 2. 若皆無法載入，降級使用 PIL 預設字型
        logger.warning(
            f"[字型降級] 無法載入指定字型 {font_name}，系統已自動降級使用 PIL 預設字型。"
        )
        fallback_font = ImageFont.load_default()
        self._font_cache[cache_key] = fallback_font
        return fallback_font

    def composite(
        self,
        base_image: Image.Image,
        qr_image: Image.Image,
        card_no: str,
        card_value: str = "",
        card_code: str = "",
    ) -> Image.Image:
        """合成卡片底圖、QR Code 與卡片數值/編號文字。

        Args:
            base_image: 底圖 (RGBA 模式)
            qr_image: 產生的 QR Code 影像 (RGBA 模式)
            card_no: 卡片編號 (如 A_001)
            card_value: 卡片數值 (如 1)
            card_code: QR Code 內容/卡片代碼 (如 ACFBE744)

        Returns:
            PIL.Image.Image: 合成後的最終卡片影像 (RGBA 模式)
        """
        canvas = base_image.copy()

        # 1. 貼上 QR Code (若啟用)
        if self.qr_config.get("enabled", True):
            qr_pos = tuple(self.qr_config.get("position", [39, 633]))
            # 確保在防呆白色畫布 (800x1200) 時，如果需要置中也能自適應
            if canvas.size == (800, 1200) and qr_pos == (155, 290):
                qr_pos = ((800 - qr_image.width) // 2, 450)

            # 使用 qr_image 作為 mask 支援透明通道
            canvas.paste(qr_image, qr_pos, qr_image)

        # 2. 渲染文字元素
        draw = ImageDraw.Draw(canvas)

        # 處理 card_no (位於右下)
        card_no_cfg = self.text_config.get("card_no", {})
        if card_no_cfg.get("enabled", True):
            display_no = card_no
            if card_no_cfg.get("replace_underscore_with_hyphen", False):
                display_no = display_no.replace("_", "-")

            self._render_text(
                draw=draw,
                canvas_size=canvas.size,
                text=f"{card_no_cfg.get('prefix', '')}{display_no}",
                cfg=card_no_cfg,
                default_pos=(547, 755),
            )

        # 處理 card_value
        card_val_cfg = self.text_config.get("card_value", {})
        if card_val_cfg.get("enabled", False):
            self._render_text(
                draw=draw,
                canvas_size=canvas.size,
                text=f"{card_val_cfg.get('prefix', '')}{card_value}",
                cfg=card_val_cfg,
                default_pos=(280, 615),
            )

        # 處理 card_code 文字標示 (若啟用)
        card_code_cfg = self.text_config.get("card_code_text", {})
        if card_code_cfg.get("enabled", False):
            self._render_text(
                draw=draw,
                canvas_size=canvas.size,
                text=f"{card_code_cfg.get('prefix', '')}{card_code}",
                cfg=card_code_cfg,
                default_pos=(39, 780),
            )

        return canvas

    def _render_text(
        self,
        draw: ImageDraw.ImageDraw,
        canvas_size: Tuple[int, int],
        text: str,
        cfg: Dict[str, Any],
        default_pos: Tuple[int, int],
    ):
        """渲染單一文字元素。"""
        if not text:
            return

        font_size = int(cfg.get("font_size", 24))
        font_family = cfg.get("font_family", "msjh.ttc")
        font_color = cfg.get("font_color", "#000000")
        anchor = cfg.get("anchor", "mm")  # 預設水平垂直置中

        # 若是防呆畫布 (800x1200)，微調文字位置置中
        if canvas_size == (800, 1200) and cfg.get("position") == [280, 570]:
            position = (400, default_pos[1])
        elif canvas_size == (800, 1200) and cfg.get("position") == [280, 615]:
            position = (400, default_pos[1])
        else:
            position = tuple(cfg.get("position", default_pos))

        font = self.get_font(font_family, font_size)

        draw.text(
            position,
            text,
            fill=font_color,
            font=font,
            anchor=anchor,
        )
