import logging
import os
import re
from typing import Optional
from PIL import Image

logger = logging.getLogger(__name__)


class FileManager:
    """檔案輸出與目錄管理模組。"""

    def __init__(self, output_dir: str = "output_cards"):
        """
        Args:
            output_dir: 卡片產出圖檔儲存目錄
        """
        self.output_dir = output_dir
        self.ensure_directory()

    def ensure_directory(self) -> None:
        """自動檢查並建立輸出資料夾。"""
        if not os.path.exists(self.output_dir):
            os.makedirs(self.output_dir, exist_ok=True)
            logger.info(f"[目錄建立] 成功建立輸出資料夾: {self.output_dir}")

    def sanitize_filename(self, filename: str) -> str:
        """過濾 Windows 檔名非法字元。"""
        return re.sub(r'[\\/*?:"<>|]', "_", str(filename)).strip()

    def save_card(self, image: Image.Image, card_no: str) -> Optional[str]:
        """依 card_{card_no}.png 命名規則將卡片圖檔儲存至輸出資料夾。

        Args:
            image: 合成完成之 PIL Image 物件
            card_no: 卡片編號 (如 A_001)

        Returns:
            str: 成功儲存的檔案絕對路徑，若失敗則回傳 None
        """
        safe_card_no = self.sanitize_filename(card_no)
        file_name = f"card_{safe_card_no}.png"
        output_path = os.path.join(self.output_dir, file_name)

        try:
            # 確保目錄存在
            self.ensure_directory()
            # 儲存為高品質 PNG
            image.save(output_path, format="PNG", optimize=True)
            return output_path
        except Exception as e:
            logger.error(f"[儲存失敗] 無法儲存卡片圖檔至 {output_path}: {e}")
            return None
