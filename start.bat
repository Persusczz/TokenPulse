@echo off
setlocal
cd /d "%~dp0"
echo [1/2] Installing dependencies...
call npm ci
if errorlevel 1 (
  pause
  exit /b 1
)
echo [2/2] Starting development server...
call npm run dev
pause
