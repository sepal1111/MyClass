import logging
import os
from typing import Any, Dict, List, Optional, Tuple
import pandas as pd

logger = logging.getLogger(__name__)

DEFAULT_REQUIRED_COLUMNS = ["card_no", "card_code", "card_value", "card_image"]


def read_card_data(
    file_path: str,
    required_columns: Optional[List[str]] = None,
    allow_any_columns: bool = False,
) -> Tuple[List[Dict[str, Any]], List[Dict[str, Any]]]:
    """讀取並解析 Excel 卡片清單檔案。

    Args:
        file_path: Excel (.xlsx / .xls) 檔案路徑
        required_columns: 指定必須存在的欄位名稱清單 (預設為 DEFAULT_REQUIRED_COLUMNS)。
        allow_any_columns: 若為 True，則不強制要求特定欄位名稱，支援任意格式 Excel 自選對應。

    Returns:
        Tuple[valid_records, error_records]:
            valid_records: 檢驗成功之卡片資料串列
            error_records: 異常列紀錄串列
    """
    valid_records: List[Dict[str, Any]] = []
    error_records: List[Dict[str, Any]] = []

    if not os.path.exists(file_path):
        logger.error(f"[資料讀取失敗] 找不到指定 Excel 檔案: {file_path}")
        return valid_records, error_records

    try:
        df = pd.read_excel(file_path, engine="openpyxl")
    except Exception as e:
        try:
            df = pd.read_excel(file_path)
        except Exception as e2:
            logger.error(f"[資料讀取失敗] 無法解析 Excel 檔案 ({file_path}): {e2}")
            return valid_records, error_records

    # 欄位名稱前置處理（去除多餘空白）
    df.columns = [str(col).strip() for col in df.columns]

    # 若未允許任意欄位，則檢驗必要欄位
    if not allow_any_columns:
        req_cols = required_columns if required_columns is not None else DEFAULT_REQUIRED_COLUMNS
        missing_cols = [col for col in req_cols if col not in df.columns]
        if missing_cols:
            err_msg = f"[欄位格式錯誤] 缺少必要欄位: {missing_cols}。現有欄位: {list(df.columns)}"
            logger.error(err_msg)
            error_records.append({"row": 0, "error": err_msg})
            return valid_records, error_records

    # 逐列檢查與清洗
    cols = list(df.columns)
    for idx, row in df.iterrows():
        excel_row_num = idx + 2

        if row.isna().all():
            continue

        clean_row: Dict[str, Any] = {}
        for col in cols:
            val = row.get(col)
            if pd.isna(val):
                clean_row[col] = ""
            else:
                try:
                    val_float = float(val)
                    if val_float.is_integer():
                        clean_row[col] = str(int(val_float))
                    else:
                        clean_row[col] = str(val_float)
                except (ValueError, TypeError):
                    clean_row[col] = str(val).strip()

        # 標準模式下的空值檢驗
        if not allow_any_columns:
            card_no = clean_row.get("card_no", "")
            card_code = clean_row.get("card_code", "")
            if not card_no or not card_code:
                err_msg = f"第 {excel_row_num} 列 card_no 或 card_code 為空，已略過此列。"
                logger.warning(f"[資料異常] {err_msg}")
                error_records.append({"row": excel_row_num, "error": err_msg})
                continue
        else:
            # 寬鬆模式下自動推導預設鍵名
            card_no = clean_row.get("card_no") or clean_row.get("序號") or clean_row.get("編號") or clean_row.get("ID")
            if not card_no and len(cols) > 0:
                card_no = clean_row.get(cols[0], f"card_{idx + 1}")

            card_code = clean_row.get("card_code") or clean_row.get("代碼") or clean_row.get("QR代碼") or clean_row.get("qrcode")
            if not card_code and len(cols) > 1:
                card_code = clean_row.get(cols[1], card_no)
            elif not card_code:
                card_code = card_no

        record_item = {
            "row_num": excel_row_num,
            "card_no": clean_row.get("card_no", card_no if allow_any_columns else ""),
            "card_code": clean_row.get("card_code", card_code if allow_any_columns else ""),
            "card_value": clean_row.get("card_value", ""),
            "card_image": clean_row.get("card_image", ""),
            "raw": clean_row,
        }
        record_item.update(clean_row)
        valid_records.append(record_item)

    logger.info(
        f"[資料讀取完成] 總筆數: {len(df)}, 成功解析: {len(valid_records)}, 異常略過: {len(error_records)}"
    )
    return valid_records, error_records
