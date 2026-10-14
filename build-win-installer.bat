@echo off
setlocal

REM This file is UTF-8: switch the console to code page 65001 so Chinese text is not garbled, and restore it on exit.
for /f "tokens=2 delims=:." %%a in ('chcp') do set "ORIG_CP=%%a"
set "ORIG_CP=%ORIG_CP: =%"
chcp 65001 >nul

echo ============================================================
echo  MyClass Windows 安裝版（含可攜版資料夾）
echo ============================================================

cd /d "%~dp0"

call npm install
if errorlevel 1 goto :error

call npm run build:installer:win
if errorlevel 1 goto :error

echo.
echo [OK] 完成：release\MyClassSetupV版本.exe 為安裝版，release\MyClassV版本\ 為可攜版。
pause
chcp %ORIG_CP% >nul
exit /b 0

:error
echo.
echo [FAIL] 建置失敗，請檢查上方錯誤訊息。（需要安裝 Inno Setup 6：https://jrsoftware.org/isdl.php）
pause
chcp %ORIG_CP% >nul
exit /b 1
