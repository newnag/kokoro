@echo off
cd /d "%~dp0"
title Website Uptime Monitor

echo.
echo  ==========================================
echo   Website Uptime Monitor - Kokoro
echo  ==========================================
echo   Folder: %CD%
echo  ==========================================
echo.

node --version >nul 2>&1
if %errorlevel% neq 0 (
    echo  [ERROR] Node.js not found!
    echo.
    echo  Please install Node.js first:
    echo    1. Open https://nodejs.org in your browser
    echo    2. Click LTS button to download
    echo    3. Run the installer keep clicking Next
    echo    4. Close and re-open start.bat
    echo.
    pause
    exit /b 1
)

 echo  [OK] Node.js found

if not exist "node_modules\express\package.json" (
    echo.
    echo  [..] Installing packages first time 1-3 min...
    echo       Please wait do not close this window.
    echo.
    npm install
    if %errorlevel% neq 0 (
        echo.
        echo  [ERROR] npm install failed!
        echo  Check your internet and try again.
        echo.
        pause
        exit /b 1
    )
    echo.
    echo  [OK] Packages installed
)

 echo.
echo  [..] Starting server...
echo.
echo  Do NOT close this window while using the app
echo  To stop: press Ctrl+C
echo.

node src/server.js

echo.
echo  ==========================================
echo   Server stopped.
echo   Screenshot any errors before closing.
echo  ==========================================
echo.
pause
