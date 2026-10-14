"""
PyInstaller 自動編譯打包腳本 - 製作免安裝獨立可執行檔 (.exe)
"""
import os
import sys
import subprocess


def build():
    print("=" * 60)
    print("開始打包可攜式卡片自動生成系統...")
    print("=" * 60)

    dist_dir = os.path.abspath("dist")
    build_dir = os.path.abspath("build")

    # PyInstaller 指令參數
    cmd = [
        sys.executable,
        "-m",
        "PyInstaller",
        "--noconfirm",
        "--onedir",  # 建立獨立資料夾型態可攜式應用 (啟動最快，且可自由放入範本與底圖)
        "--windowed", # 不顯示命令列黑視窗
        "--name=卡片批次生成器",
        "--add-data=backgrounds;backgrounds",
        "--add-data=config.json;.",
        "--add-data=simple.jpg;.",
        "--hidden-import=openpyxl",
        "--hidden-import=pandas",
        "--hidden-import=PIL",
        "--hidden-import=qrcode",
        "--hidden-import=PyQt6",
        "app_gui.py",
    ]

    print("執行指令:", " ".join(cmd))
    result = subprocess.run(cmd)

    if result.returncode == 0:
        print("\n" + "=" * 60)
        print("[完成] 可攜式版本打包成功！")
        print(f"可攜式目錄: {os.path.join(dist_dir, '卡片批次生成器')}")
        print(f"主執行檔: {os.path.join(dist_dir, '卡片批次生成器', '卡片批次生成器.exe')}")
        print("=" * 60)
    else:
        print("\n[錯誤] 打包失敗，請檢查錯誤訊息。")


if __name__ == "__main__":
    build()
