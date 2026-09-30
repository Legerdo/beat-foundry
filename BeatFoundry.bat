@echo off
setlocal
title BEAT FOUNDRY
cd /d "%~dp0"

where node >nul 2>nul
if errorlevel 1 (
  echo Node.js was not found. Install Node.js 20 or newer from https://nodejs.org and run this file again.
  pause
  exit /b 1
)

if not exist "node_modules\" (
  echo Installing dependencies...
  call npm install --no-fund --no-audit
  if errorlevel 1 goto :fail
)

rem Rebuild when there is no build yet, or when "BeatFoundry.bat rebuild" is used.
if /i "%~1"=="rebuild" if exist "dist\" rmdir /s /q "dist"
if not exist "dist\index.html" (
  echo Building the game...
  call npm run build
  if errorlevel 1 goto :fail
)

echo.
echo BEAT FOUNDRY is running. Your browser will open shortly.
echo Close this window or press Ctrl+C to stop the server.
echo.
rem Vite picks the next free port if 4390 is taken.
call npx vite preview --port 4390 --open
exit /b 0

:fail
echo.
echo Something went wrong. See the messages above.
pause
exit /b 1
