import argparse
import json
import logging
import os
import sys
import time
from typing import Any, Dict

from card_generator.reader import read_card_data
from card_generator.qrcode_engine import QRCodeGenerator
from card_generator.background_loader import BackgroundLoader
from card_generator.compositor import CardCompositor
from card_generator.file_manager import FileManager

# 確保 Windows 主控台正確顯示 UTF-8 繁體中文
if sys.platform == "win32":
    try:
        sys.stdout.reconfigure(encoding="utf-8", errors="replace")
        sys.stderr.reconfigure(encoding="utf-8", errors="replace")
    except Exception:
        pass

# 設定日誌格式
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(message)s",
    datefmt="%H:%M:%S",
    handlers=[logging.StreamHandler(sys.stdout)],
)
logger = logging.getLogger("CardGenerator")


def load_config(config_path: str) -> Dict[str, Any]:
    """載入系統設定檔，若不存在則使用預設配置。"""
    default_config = {
        "excel_path": "A系列匯入檔.xlsx",
        "backgrounds_dir": "backgrounds",
        "output_dir": "output_cards",
        "default_canvas_size": [800, 1200],
        "qr_code": {
            "enabled": True,
            "size": [136, 136],
            "position": [39, 633],
            "error_correction": "M",
            "box_size": 10,
            "border": 2,
        },
        "text_elements": {
            "card_no": {
                "enabled": True,
                "position": [547, 755],
                "font_size": 22,
                "font_color": "#000000",
                "font_family": "msjhbd.ttc",
                "anchor": "rm",
                "prefix": "No.",
                "replace_underscore_with_hyphen": True,
            },
            "card_value": {
                "enabled": False,
                "position": [280, 615],
                "font_size": 28,
                "font_color": "#C0392B",
                "font_family": "msjhbd.ttc",
                "anchor": "mm",
                "prefix": "點數：",
            },
            "card_code_text": {
                "enabled": False,
                "position": [39, 780],
                "font_size": 14,
                "font_color": "#333333",
                "font_family": "msjh.ttc",
                "anchor": "lm",
                "prefix": "",
            },
        },
    }

    if os.path.exists(config_path):
        try:
            with open(config_path, "r", encoding="utf-8") as f:
                user_config = json.load(f)
                default_config.update(user_config)
                logger.info(f"[設定載入] 成功載入設定檔: {config_path}")
        except Exception as e:
            logger.warning(f"[設定警告] 載入設定檔失敗 ({e})，使用預設配置。")
    else:
        logger.info(f"[設定提醒] 未發現設定檔 ({config_path})，使用預設配置。")

    return default_config


def run_batch_generation(
    excel_path: str,
    config: Dict[str, Any],
    preview_limit: int = 0,
    override_output_dir: str = None,
):
    """執行批次變動 QR Code 卡片生成任務。"""
    start_time = time.time()

    # 1. 決定輸出目錄與底圖目錄
    output_dir = override_output_dir or config.get("output_dir", "output_cards")
    backgrounds_dir = config.get("backgrounds_dir", "backgrounds")
    default_canvas_size = config.get("default_canvas_size", [800, 1200])

    logger.info("=" * 60)
    logger.info("批次變動 QR Code 卡片自動生成系統啟動")
    logger.info(f"資料來源 Excel: {excel_path}")
    logger.info(f"底圖目錄: {backgrounds_dir}")
    logger.info(f"產出目錄: {output_dir}")
    if preview_limit > 0:
        logger.info(f"模式: 【預覽模式】僅生成前 {preview_limit} 張卡片")
    else:
        logger.info("模式: 【全量批次產出】")
    logger.info("=" * 60)

    # 2. 讀取與驗證 Excel 資料
    records, read_errors = read_card_data(excel_path)
    if not records:
        logger.error("[任務終止] 無任何可處理的卡片資料。")
        return

    if preview_limit > 0:
        records = records[:preview_limit]

    # 3. 初始化各功能模組
    qr_cfg = config.get("qr_code", {})
    qr_engine = QRCodeGenerator(
        error_correction=qr_cfg.get("error_correction", "M"),
        box_size=qr_cfg.get("box_size", 10),
        border=qr_cfg.get("border", 2),
    )
    qr_target_size = tuple(qr_cfg.get("size", [250, 250]))

    bg_loader = BackgroundLoader(
        backgrounds_dir=backgrounds_dir,
        default_canvas_size=tuple(default_canvas_size),
    )

    compositor = CardCompositor(config=config)
    file_manager = FileManager(output_dir=output_dir)

    # 4. 批次處理與合成
    success_count = 0
    fail_count = 0
    total_count = len(records)

    logger.info(f"開始批次處理 (共 {total_count} 筆)...")

    for i, item in enumerate(records, 1):
        card_no = item["card_no"]
        card_code = item["card_code"]
        card_value = item["card_value"]
        card_image = item["card_image"]

        try:
            # 產生動態 QR Code
            qr_img = qr_engine.generate(card_code, target_size=qr_target_size)

            # 載入底圖（支援底圖不存在防呆）
            bg_img = bg_loader.load_background(card_image)

            # 合成影像與文字
            card_img = compositor.composite(
                base_image=bg_img,
                qr_image=qr_img,
                card_no=card_no,
                card_value=card_value,
                card_code=card_code,
            )

            # 儲存圖檔
            saved_path = file_manager.save_card(card_img, card_no)
            if saved_path:
                success_count += 1
                if i % 20 == 0 or i == total_count or preview_limit > 0:
                    logger.info(
                        f"進度 [{i}/{total_count}] 卡片 {card_no} 已生成 -> {os.path.basename(saved_path)}"
                    )
            else:
                fail_count += 1
                logger.error(f"進度 [{i}/{total_count}] 卡片 {card_no} 儲存失敗！")

        except Exception as e:
            fail_count += 1
            logger.error(f"進度 [{i}/{total_count}] 卡片 {card_no} 生成異常: {e}", exc_info=False)

    elapsed_time = time.time() - start_time
    logger.info("=" * 60)
    logger.info("批次卡片生成任務完成！")
    logger.info(f"總處理筆數: {total_count}")
    logger.info(f"成功生成: {success_count} 張")
    logger.info(f"失敗數: {fail_count} 張")
    if read_errors:
        logger.info(f"讀取異常略過: {len(read_errors)} 筆")
    logger.info(f"總耗時: {elapsed_time:.2f} 秒")
    logger.info(f"產出圖檔目錄: {os.path.abspath(output_dir)}")
    logger.info("=" * 60)


def main():
    parser = argparse.ArgumentParser(
        description="批次變動 QR Code 卡片自動生成系統 (Batch QR Code Card Generator)"
    )
    parser.add_argument(
        "--config",
        "-c",
        default="config.json",
        help="設定檔路徑 (預設: config.json)",
    )
    parser.add_argument(
        "--excel",
        "-e",
        default=None,
        help="輸入 Excel 檔案路徑 (若未指定則讀取 config.json 中的 excel_path)",
    )
    parser.add_argument(
        "--output",
        "-o",
        default=None,
        help="覆寫產出圖檔目錄",
    )
    parser.add_argument(
        "--preview",
        "-p",
        type=int,
        default=0,
        help="預覽模式：僅產出前 N 筆卡片供檢視 (例如: --preview 3)",
    )

    args = parser.parse_args()

    config = load_config(args.config)
    excel_path = args.excel or config.get("excel_path", "A系列匯入檔.xlsx")

    run_batch_generation(
        excel_path=excel_path,
        config=config,
        preview_limit=args.preview,
        override_output_dir=args.output,
    )


if __name__ == "__main__":
    main()
