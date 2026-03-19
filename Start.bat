@echo off
title BC Container Manager

:: Auto-elevate to Administrator
net session >nul 2>&1
if errorlevel 1 (
    echo Requesting Administrator privileges...
    powershell -NoProfile -Command "Start-Process '%~f0' -Verb RunAs"
    exit /b
)

cd /d "%~dp0"

echo.
echo  =============================================
echo   BC Container Manager  (Administrator)
echo  =============================================
echo.

node --version >nul 2>&1
if errorlevel 1 (
    echo  Node.js not found. Installing...
    powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0install-node.ps1"
    set "PATH=%ProgramFiles%\nodejs;%PATH%"
)

if not exist "node_modules\" (
    echo  Installing dependencies...
    npm install
)

echo.
echo  Starting server...
echo  Keep this window open. Close it to stop.
echo.
start http://localhost:3000
node server.js
pause
