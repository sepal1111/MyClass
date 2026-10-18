#!/bin/bash
# ============================================================
#  MyClass macOS 封裝批次檔 (支援 Finder 雙擊執行)
# ============================================================
set -e
cd "$(dirname "$0")"

# 載入常見的環境變數路徑，確保 GUI 雙擊啟動時能找到 node / npm
export PATH="/opt/homebrew/bin:/usr/local/bin:$HOME/.nvm/versions/node/$(ls $HOME/.nvm/versions/node 2>/dev/null | tail -n 1)/bin:$PATH"

echo "============================================================"
echo " MyClass macOS 封裝 (Apple Silicon / Intel Mac)"
echo "============================================================"
echo

# 檢查 Node.js 與 npm
if ! command -v npm &> /dev/null; then
  echo "[FAIL] 找不到 npm 指令！"
  echo "請確認此 Mac 已安裝 Node.js (https://nodejs.org/) 並已加入 PATH。"
  echo
  if [ -t 0 ]; then
    read -n 1 -s -r -p "按任意鍵關閉視窗..."
    echo
  fi
  exit 1
fi

echo "[1/2] 正在檢查並安裝專案依賴 (npm install)..."
npm install

echo
echo "[2/2] 正在進行 macOS 原生執行檔打包 (npm run build:exe:mac)..."
npm run build:exe:mac

echo
echo "============================================================"
echo " [OK] macOS 封裝完成！"
echo " 輸出：release/ 內的 MyClass*-Mac*.zip（解壓縮後使用）"
echo " 啟動方式：解壓縮後雙擊資料夾內的 MyClass（MyClass.app），選單列會出現圖示。"
echo "============================================================"
echo

if [ -t 0 ]; then
  read -n 1 -s -r -p "按任意鍵關閉視窗..."
  echo
fi
