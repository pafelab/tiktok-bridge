@echo off
setlocal
title Black Swan - TikTok gift bridge
chcp 65001 >nul
cd /d "%~dp0"

where node >nul 2>nul
if errorlevel 1 (
    echo.
    echo   Node.js is not installed.
    echo   Get the LTS installer from https://nodejs.org and run this again.
    echo.
    pause
    exit /b 1
)

if not exist "node_modules\ws\package.json" (
    echo.
    echo   First run - downloading the TikTok libraries. This takes a minute.
    echo.
    call npm install --no-audit --no-fund
    if errorlevel 1 (
        echo.
        echo   npm install failed. Check your internet connection and try again.
        echo.
        pause
        exit /b 1
    )
)

node server.js
echo.
pause
