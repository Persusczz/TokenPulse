@echo off
setlocal
cd /d "%~dp0"
set "ELECTRON_RUN_AS_NODE="
echo [1/2] Installing dependencies...
call npm install --include=dev --no-audit --no-fund
if errorlevel 1 (
  pause
  exit /b 1
)
echo [2/2] Starting development server...
call npm run dev
if errorlevel 1 (
  pause
  exit /b 1
)
pause
