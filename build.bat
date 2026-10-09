@echo off
setlocal
cd /d "%~dp0"
set "ELECTRON_RUN_AS_NODE="
echo [1/4] Installing dependencies...
call npm install --include=dev --no-audit --no-fund
if errorlevel 1 goto failed
echo [2/4] Checking types...
call npm run typecheck
if errorlevel 1 goto failed
echo [3/4] Running tests...
call npm test -- --maxWorkers=2
if errorlevel 1 goto failed
echo [4/4] Building local installer and portable app...
call npm run dist
if errorlevel 1 goto failed
echo Build complete. Files are in "%~dp0dist". Nothing was published.
pause
exit /b 0

:failed
echo Build failed. See the error above.
pause
exit /b 1
