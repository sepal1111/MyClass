import time
import logging
from typing import Any, Dict, List
from PyQt6.QtCore import QThread, pyqtSignal
from PIL import Image

from card_generator.dynamic_compositor import DynamicCardCompositor
from card_generator.qrcode_engine import QRCodeGenerator
from card_generator.background_loader import BackgroundLoader
from card_generator.file_manager import FileManager

logger = logging.getLogger(__name__)


class BatchGenerateWorker(QThread):
    """背景批次卡片生成執行緒。"""

    progress = pyqtSignal(int, int, str)  # current, total, card_no
    finished_batch = pyqtSignal(int, int, float)  # success_count, fail_count, elapsed_seconds
    log_message = pyqtSignal(str)

    def __init__(
        self,
        records: List[Dict[str, Any]],
        layout_config: Dict[str, Any],
        backgrounds_dir: str,
        output_dir: str,
    ):
        super().__init__()
        self.records = records
        self.layout_config = layout_config
        self.backgrounds_dir = backgrounds_dir
        self.output_dir = output_dir
        self._is_cancelled = False

    def cancel(self):
        self._is_cancelled = True

    def run(self):
        start_time = time.time()
        total = len(self.records)
        success_count = 0
        fail_count = 0

        bg_loader = BackgroundLoader(backgrounds_dir=self.backgrounds_dir)
        qr_engine = QRCodeGenerator(
            error_correction=self.layout_config.get("qr_code", {}).get("error_correction", "M"),
            box_size=10,
            border=2,
        )
        compositor = DynamicCardCompositor()
        file_manager = FileManager(output_dir=self.output_dir)

        qr_cfg = self.layout_config.get("qr_code", {})
        qr_src_col = qr_cfg.get("source_column", "card_code")
        card_no_col = self.layout_config.get("card_no_source_column", "card_no")
        text_elements = self.layout_config.get("text_elements", [])

        for i, item in enumerate(self.records, 1):
            if self._is_cancelled:
                self.log_message.emit("使用者已取消批次任務。")
                break

            card_no = str(item.get(card_no_col, item.get("card_no", f"card_{i}")))
            card_image = str(item.get("card_image", item.get("底圖", "")))
            card_code = str(item.get(qr_src_col, item.get("card_code", "")))

            try:
                # 1. 產生 QR Code (若啟用)
                qr_img = None
                if qr_cfg.get("enabled", True):
                    qr_target_size = (int(qr_cfg.get("width", 136)), int(qr_cfg.get("height", 136)))
                    qr_img = qr_engine.generate(card_code, target_size=qr_target_size)

                # 2. 載入底圖
                bg_img = bg_loader.load_background(card_image)

                # 3. 動態合成
                card_img = compositor.composite_card(
                    base_image=bg_img,
                    qr_image=qr_img,
                    qr_config=qr_cfg,
                    text_elements=text_elements,
                    row_data=item,
                )

                # 4. 儲存圖檔
                saved_path = file_manager.save_card(card_img, card_no)
                if saved_path:
                    success_count += 1
                else:
                    fail_count += 1

            except Exception as e:
                fail_count += 1
                self.log_message.emit(f"處理卡片 {card_no} 發生異常: {e}")

            self.progress.emit(i, total, card_no)

        elapsed = time.time() - start_time
        self.finished_batch.emit(success_count, fail_count, elapsed)
