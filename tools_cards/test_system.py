"""
批次變動 QR Code 卡片自動生成系統 - 模組與邊界條件單元測試
"""
import os
import shutil
import tempfile
import unittest
import pandas as pd
from PIL import Image

from card_generator.reader import read_card_data
from card_generator.qrcode_engine import QRCodeGenerator
from card_generator.background_loader import BackgroundLoader
from card_generator.compositor import CardCompositor
from card_generator.file_manager import FileManager


class TestCardGeneratorSystem(unittest.TestCase):

    def setUp(self):
        self.test_dir = tempfile.mkdtemp()

    def tearDown(self):
        shutil.rmtree(self.test_dir, ignore_errors=True)

    # ---------------- 模組 1 測試：資料來源讀取 ----------------
    def test_reader_normal(self):
        """測試正常 Excel 檔案讀取。"""
        records, errors = read_card_data("A系列匯入檔.xlsx")
        self.assertGreater(len(records), 0)
        self.assertEqual(len(errors), 0)
        first = records[0]
        self.assertIn("card_no", first)
        self.assertIn("card_code", first)
        self.assertIn("card_value", first)
        self.assertIn("card_image", first)
        self.assertEqual(first["card_no"], "A_001")

    def test_reader_missing_file(self):
        """測試不存在檔案防呆，不中斷且回傳空結果。"""
        records, errors = read_card_data("non_existent_file.xlsx")
        self.assertEqual(len(records), 0)

    def test_reader_invalid_columns(self):
        """測試缺少必要欄位之防呆機制。"""
        fake_excel = os.path.join(self.test_dir, "bad.xlsx")
        df = pd.DataFrame({"wrong_col": [1, 2, 3]})
        df.to_excel(fake_excel, index=False)

        records, errors = read_card_data(fake_excel)
        self.assertEqual(len(records), 0)
        self.assertGreater(len(errors), 0)

    def test_reader_empty_and_corrupt_rows(self):
        """測試包含空列之容錯防呆。"""
        fake_excel = os.path.join(self.test_dir, "sparse.xlsx")
        df = pd.DataFrame({
            "card_no": ["C_001", None, "C_003"],
            "card_code": ["CODE001", "CODE002", None],
            "card_value": [10, 20, 30],
            "card_image": ["bg1.jpg", "bg2.jpg", "bg3.jpg"],
        })
        df.to_excel(fake_excel, index=False)

        records, errors = read_card_data(fake_excel)
        # 只有第 1 筆是有效的
        self.assertEqual(len(records), 1)
        self.assertEqual(records[0]["card_no"], "C_001")
        self.assertEqual(len(errors), 2)

    # ---------------- 模組 2 測試：動態 QR Code 產生 ----------------
    def test_qrcode_generation(self):
        """測試動態生成標準正方形高解析度黑白 QR Code。"""
        generator = QRCodeGenerator(error_correction="M", box_size=10, border=2)
        qr_img = generator.generate("TEST_CARD_CODE_12345", target_size=(250, 250))

        self.assertEqual(qr_img.size, (250, 250))
        self.assertEqual(qr_img.mode, "RGBA")

        # 測試容錯等級 H 與不同尺寸
        gen_h = QRCodeGenerator(error_correction="H")
        qr_h = gen_h.generate("ANOTHER_CODE", target_size=(300, 300))
        self.assertEqual(qr_h.size, (300, 300))

    # ---------------- 模組 3 測試：底圖載入與白底畫布防呆 ----------------
    def test_background_loader_existing(self):
        """測試正常載入現有底圖。"""
        loader = BackgroundLoader(backgrounds_dir="backgrounds")
        img = loader.load_background("score_card_A_1.jpg")
        self.assertEqual(img.size, (561, 797))
        self.assertEqual(img.mode, "RGBA")

    def test_background_loader_fallback(self):
        """測試底圖不存在時，自動建立 800x1200 純白畫布防呆。"""
        loader = BackgroundLoader(backgrounds_dir="backgrounds", default_canvas_size=(800, 1200))
        img = loader.load_background("this_file_does_not_exist_at_all.jpg")
        self.assertEqual(img.size, (800, 1200))
        self.assertEqual(img.mode, "RGBA")

        # 驗證為純白畫布 (255, 255, 255, 255)
        pixel = img.getpixel((400, 600))
        self.assertEqual(pixel, (255, 255, 255, 255))

    # ---------------- 模組 4 測試：影像合成與字型降級 ----------------
    def test_compositor_and_font_fallback(self):
        """測試影像合成與字型降級機制。"""
        cfg = {
            "qr_code": {"position": [155, 290]},
            "text_elements": {
                "card_no": {
                    "enabled": True,
                    "position": [280, 570],
                    "font_size": 20,
                    "font_family": "completely_fake_font_name.ttf",  # 測試字型降級
                    "font_color": "#000000",
                    "prefix": "No. ",
                },
                "card_value": {
                    "enabled": True,
                    "position": [280, 615],
                    "font_size": 24,
                    "font_family": "msjh.ttc",
                    "font_color": "#FF0000",
                    "prefix": "點數：",
                },
            },
        }

        compositor = CardCompositor(cfg)
        base = Image.new("RGBA", (561, 797), (200, 200, 200, 255))
        qr_gen = QRCodeGenerator()
        qr = qr_gen.generate("CODE_ABC", target_size=(250, 250))

        result = compositor.composite(base, qr, "TEST_NO_999", "100")
        self.assertEqual(result.size, (561, 797))
        self.assertEqual(result.mode, "RGBA")

    # ---------------- 模組 5 測試：檔案輸出與目錄管理 ----------------
    def test_file_manager_and_sanitization(self):
        """測試目錄自動建立與 card_{card_no}.png 命名輸出。"""
        out_dir = os.path.join(self.test_dir, "test_output")
        fm = FileManager(output_dir=out_dir)

        test_img = Image.new("RGBA", (100, 100), (255, 0, 0, 255))
        saved_path = fm.save_card(test_img, "A_001")

        self.assertIsNotNone(saved_path)
        self.assertTrue(os.path.isfile(saved_path))
        self.assertTrue(os.path.basename(saved_path) == "card_A_001.png")

        # 測試檔名特殊符號清理
        saved_path2 = fm.save_card(test_img, "B/002:X")
        self.assertIsNotNone(saved_path2)
        self.assertTrue(os.path.basename(saved_path2) == "card_B_002_X.png")


if __name__ == "__main__":
    unittest.main()
