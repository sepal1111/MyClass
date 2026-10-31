@echo off
setlocal

REM ============================================================
REM  MyClass v4.5.0 發佈：測試 -> 確認 -> commit -> 標籤 -> push -> 打包
REM  這個檔案是 UTF-8：先切換主控台字碼頁，結束時還原。
REM  用完之後可以把這個檔案和 release-v4.5.0-commit-message.txt 刪掉（它們不會被提交）。
REM ============================================================
for /f "tokens=2 delims=:." %%a in ('chcp') do set "ORIG_CP=%%a"
set "ORIG_CP=%ORIG_CP: =%"
chcp 65001 >nul

cd /d "%~dp0"
set "VER=v4.5.0"
set "MSGFILE=release-v4.5.0-commit-message.txt"

echo ============================================================
echo  MyClass %VER% 發佈
echo ============================================================
echo.

echo [1/6] 檢查 git 狀態...
where git >nul 2>nul || (echo [FAIL] 找不到 git 指令。 & goto :error)
if not exist "%MSGFILE%" (echo [FAIL] 找不到 %MSGFILE% 。 & goto :error)
for /f %%b in ('git rev-parse --abbrev-ref HEAD') do set "BRANCH=%%b"
if /i not "%BRANCH%"=="main" (echo [FAIL] 目前在 %BRANCH% 分支，請先切換到 main。 & goto :error)
git rev-parse -q --verify "refs/tags/%VER%" >nul && (echo [FAIL] 標籤 %VER% 已經存在。 & goto :error)
git fetch origin --tags || (echo [FAIL] 無法連線到 GitHub。 & goto :error)
for /f %%n in ('git rev-list --count HEAD..origin/main') do set "BEHIND=%%n"
if not "%BEHIND%"=="0" (echo [FAIL] GitHub 上有 %BEHIND% 個本機沒有的提交，請先 git pull 再執行。 & goto :error)
echo       main 分支、標籤 %VER% 尚未使用、與 GitHub 同步：OK
echo.

echo [2/6] 安裝套件並執行自動化測試...
call npm install || (echo [FAIL] npm install 失敗。 & goto :error)
call npm test || (echo [FAIL] 自動化測試沒有通過，已停止，沒有做任何提交。 & goto :error)
echo       測試通過
echo.

echo [3/6] 準備要提交的檔案...
git add -A -- . ":(exclude)release-v4.5.0.bat" ":(exclude)%MSGFILE%" || goto :error
git diff --cached --name-only | findstr /i /r /c:"^bin/" /c:"\.db$" /c:"\.db-wal$" /c:"\.key$" /c:"\.pem$" >nul && (
  echo [FAIL] 要提交的檔案裡有學生資料或金鑰（bin/、資料庫、憑證），已取消。
  git reset -q
  goto :error
)
echo.
echo 以下是這次要提交的變更（M=修改  A=新增  D=刪除）：
echo ------------------------------------------------------------
git status --short
echo ------------------------------------------------------------
echo.
echo 按 Y：commit、上標籤 %VER%、push 到 GitHub，然後打包。
echo 按 N：取消（不會提交任何東西）。
choice /c YN /n /m "繼續嗎？[Y/N] "
if errorlevel 2 (
  git reset -q
  echo 已取消，沒有做任何提交。
  goto :end
)
echo.

echo [4/6] commit 並上標籤 %VER%...
git commit -F "%MSGFILE%" || (echo [FAIL] commit 失敗。 & goto :error)
git tag -a %VER% -m "%VER%" || (echo [FAIL] 上標籤失敗。 & goto :error)
echo.

echo [5/6] push 到 GitHub...
git push origin main || (echo [FAIL] push main 失敗：commit 與標籤已在本機完成，可稍後重新 push。 & goto :error)
git push origin %VER% || (echo [FAIL] push 標籤失敗：可稍後執行 git push origin %VER% 。 & goto :error)
echo.

echo [6/6] 打包 Windows 可攜版（需要幾分鐘）...
call npm run build:exe:win || (echo [FAIL] 打包失敗：commit、標籤與 push 都已完成，修正後再執行 build-win.bat 即可。 & goto :error)
echo.
echo ============================================================
echo  [OK] %VER% 完成：已 commit、上標籤、push，並打包到 release\
echo ============================================================
dir /b release
goto :end

:error
echo.
echo 發佈沒有完成，請檢查上方訊息。
pause
chcp %ORIG_CP% >nul
exit /b 1

:end
echo.
pause
chcp %ORIG_CP% >nul
exit /b 0
