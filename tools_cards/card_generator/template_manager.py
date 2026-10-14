import json
import logging
import os
from typing import Any, Dict

logger = logging.getLogger(__name__)


def save_layout_template(file_path: str, layout_data: Dict[str, Any]) -> bool:
    """將版面設定儲存為 JSON 範本檔。"""
    try:
        os.makedirs(os.path.dirname(os.path.abspath(file_path)), exist_ok=True)
        with open(file_path, "w", encoding="utf-8") as f:
            json.dump(layout_data, f, ensure_ascii=False, indent=2)
        logger.info(f"[範本儲存] 成功儲存範本至: {file_path}")
        return True
    except Exception as e:
        logger.error(f"[範本儲存失敗] {e}")
        return False


def load_layout_template(file_path: str) -> Dict[str, Any]:
    """載入版面 JSON 範本檔。"""
    if not os.path.exists(file_path):
        logger.warning(f"[範本載入] 檔案不存在: {file_path}")
        return {}
    try:
        with open(file_path, "r", encoding="utf-8") as f:
            data = json.load(f)
        logger.info(f"[範本載入] 成功載入範本: {file_path}")
        return data
    except Exception as e:
        logger.error(f"[範本載入失敗] {e}")
        return {}
