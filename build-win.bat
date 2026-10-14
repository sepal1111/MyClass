@echo off
setlocal

REM This file is UTF-8: switch the console to code page 65001 so Chinese text is not garbled, and restore it on exit.
for /f "tokens=2 delims=:." %%a in ('chcp') do set "ORIG_CP=%%a"
set "ORIG_CP=%ORIG_CP: =%"
chcp 65001 >nul

echo ============================================================
echo  MyClass Windows 封裝
echo ============================================================

cd /d "%~dp0"

call npm install
if errorlevel 1 goto :error

call npm run build:exe:win
if errorlevel 1 goto :error

echo.
echo [OK] 封裝完成：請到 release\ 資料夾取得執行檔。
pause
chcp %ORIG_CP% >nul
exit /b 0

:error
echo.
echo [FAIL] 封裝失敗，請檢查上方錯誤訊息。
pause
chcp %ORIG_CP% >nul
exit /b 1
