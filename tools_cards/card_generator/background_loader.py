import logging
import os
from typing import Tuple
from PIL import Image

logger = logging.getLogger(__name__)


class BackgroundLoader:
    """底圖管理與載入模組，具備不存在時自動降級為預設純白畫布的防呆機制。"""

    def __init__(
        self,
        backgrounds_dir: str = "backgrounds",
        default_canvas_size: Tuple[int, int] = (800, 1200),
    ):
        """
        Args:
            backgrounds_dir: 底圖存放目錄
            default_canvas_size: 底圖缺失時之預設畫布尺寸 (寬, 高)，預設 (800, 1200)
        """
        self.backgrounds_dir = backgrounds_dir
        self.default_canvas_size = tuple(default_canvas_size)

    def load_background(self, image_name: str) -> Image.Image:
        """根據底圖檔名載入底圖，若檔案不存在或損壞則自動建立純白畫布。

        Args:
            image_name: 底圖檔名 (例如 score_card_A_1.jpg)

        Returns:
            PIL.Image.Image: RGBA 模式之底圖影像
        """
        # 若檔名為空或檔案不存在
        if not image_name:
            logger.warning("[底圖缺失] 未指定底圖檔名，建立預設 800x1200 純白畫布。")
            return self.create_default_canvas()

        # 先檢查 backgrounds 目錄，再檢查當前工作目錄或絕對路徑
        image_path = os.path.join(self.backgrounds_dir, image_name)
        if not os.path.isfile(image_path):
            if os.path.isfile(image_name):
                image_path = image_name
            else:
                logger.warning(
                    f"[底圖缺失] 找不到底圖檔案: {image_path}，已自動建立預設 800x1200 純白畫布繼續執行。"
                )
                return self.create_default_canvas()

        try:
            with Image.open(image_path) as img:
                # 複製轉換至 RGBA 模式以確保獨立記憶體與支援透明通道合成
                return img.convert("RGBA")
        except Exception as e:
            logger.error(
                f"[底圖載入錯誤] 讀取底圖 {image_path} 發生異常: {e}，已改用預設 800x1200 純白畫布。"
            )
            return self.create_default_canvas()

    def create_default_canvas(self) -> Image.Image:
        """建立尺寸為 default_canvas_size 之純白背景畫布。"""
        return Image.new("RGBA", self.default_canvas_size, (255, 255, 255, 255))
