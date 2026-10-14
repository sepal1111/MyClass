import logging
from typing import Optional, Tuple
from PIL import Image
import qrcode
from qrcode.constants import (
    ERROR_CORRECT_L,
    ERROR_CORRECT_M,
    ERROR_CORRECT_Q,
    ERROR_CORRECT_H,
)

logger = logging.getLogger(__name__)

ERROR_CORRECTION_MAP = {
    "L": ERROR_CORRECT_L,
    "M": ERROR_CORRECT_M,
    "Q": ERROR_CORRECT_Q,
    "H": ERROR_CORRECT_H,
}


class QRCodeGenerator:
    """動態 QR Code 產生模組。"""

    def __init__(
        self,
        error_correction: str = "M",
        box_size: int = 10,
        border: int = 2,
    ):
        """初始化 QR Code 產生器設定。

        Args:
            error_correction: 容錯率等級 ('L', 'M', 'Q', 'H'，預設 'M')
            box_size: 每個模組的像素大小 (預設 10)
            border: 邊框模組數量 (預設 2)
        """
        ec_key = error_correction.upper()
        self.error_correction = ERROR_CORRECTION_MAP.get(ec_key, ERROR_CORRECT_M)
        self.box_size = box_size
        self.border = border

    def generate(
        self,
        data: str,
        target_size: Optional[Tuple[int, int]] = (250, 250),
    ) -> Image.Image:
        """接收字串內容，生成標準正方形高解析度黑白 QR Code。

        Args:
            data: QR Code 編碼內容字串 (如 card_code)
            target_size: 目標縮放尺寸 (寬, 高)，若為 None 則保持原始尺寸

        Returns:
            PIL.Image.Image: 產生的黑白 QR Code 影像 (RGBA 模式)
        """
        qr = qrcode.QRCode(
            version=None,  # 自動適應內容大小
            error_correction=self.error_correction,
            box_size=self.box_size,
            border=self.border,
        )
        qr.add_data(str(data))
        qr.make(fit=True)

        # 產生清晰黑白影像
        img = qr.make_image(fill_color="black", back_color="white").convert("RGBA")

        # 若指定目標尺寸，使用高品質 LANCZOS 演算法縮放
        if target_size and len(target_size) == 2:
            target_w, target_h = target_size
            if (img.width, img.height) != (target_w, target_h):
                img = img.resize((target_w, target_h), Image.Resampling.LANCZOS)

        return img
