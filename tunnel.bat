@echo off
title Nexus AI - Tunnel Mode
color 0A

echo.
echo  NEXUS AI  -  Tunnel Mode
echo  Builds frontend, serves everything from Express on :3002, creates public tunnel
echo  No Vite dev server - no HMR - no chrome-error issues
echo  -------------------------------------------------------------------
echo.

:: Check Node.js
where node >nul 2>&1
if errorlevel 1 (
    echo  [ERROR] Node.js not found. Install from https://nodejs.org
    pause
    exit /b 1
)

:: Create .env if missing
if not exist ".env" (
    if exist ".env.example" (
        copy ".env.example" ".env" >nul
        echo  [SETUP] Created .env from .env.example
    ) else (
        echo  [ERROR] No .env file found. Create one with JWT_SECRET set.
        pause
        exit /b 1
    )
)

:: Install dependencies if missing
if not exist "node_modules" (
    echo  [SETUP] Installing dependencies - please wait...
    call npm install
    if errorlevel 1 (
        echo  [ERROR] npm install failed.
        pause
        exit /b 1
    )
    echo.
)

:: ── [1/3] Build frontend ───────────────────────────────────────────────────────
echo  [1/3] Building frontend for production...
call npm run build
if errorlevel 1 (
    echo  [ERROR] Build failed. Check output above.
    pause
    exit /b 1
)
echo  [1/3] Build complete!
echo.

:: ── [2/3] Backend (serves built dist/ automatically) ──────────────────────────
echo  [2/3] Starting backend on http://127.0.0.1:3002
start "Nexus Backend" cmd /k "color 0B & title Nexus Backend & npx tsx watch server/index.ts"

:: Wait until backend is actually responding
echo  [2/3] Waiting for backend to be ready...
:backend_wait
timeout /t 2 /nobreak >nul
curl -s -o nul -m 2 http://127.0.0.1:3002/ping 2>nul
if errorlevel 1 goto backend_wait
echo  [2/3] Backend ready!
echo.

:: ── [3/3] Cloudflare tunnel on port 3002 ──────────────────────────────────────
echo  [3/3] Starting Cloudflare tunnel on port 3002...

set "CF_EXE="
if exist "C:\tmp\cloudflared.exe"        set "CF_EXE=C:\tmp\cloudflared.exe"
if exist "%~dp0cloudflared.exe"          set "CF_EXE=%~dp0cloudflared.exe"
if exist "%USERPROFILE%\cloudflared.exe" set "CF_EXE=%USERPROFILE%\cloudflared.exe"
if "%CF_EXE%"=="" (
    where cloudflared >nul 2>&1
    if not errorlevel 1 set "CF_EXE=cloudflared"
)

if "%CF_EXE%"=="" goto :no_cloudflared

echo  [RUN] cloudflared found: %CF_EXE%
start "Nexus Tunnel" cmd /k "color 0D & title Nexus Tunnel & echo. & echo Shareable URL appears below: & echo. & %CF_EXE% tunnel --url http://127.0.0.1:3002 --protocol http2"
goto :tunnel_done

:no_cloudflared
echo  [WARN] cloudflared not found. Falling back to localtunnel.
echo  [HINT] Download cloudflared.exe to C:\tmp\ from:
echo         https://github.com/cloudflare/cloudflared/releases/latest
echo.
start "Nexus Tunnel" cmd /k "color 0D & title Nexus Tunnel & echo. & echo YOUR SHAREABLE URL IS ON THE NEXT LINE: & echo. & npx localtunnel --port 3002"

:tunnel_done
echo.
echo  -------------------------------------------------------------------
echo  Local app   : http://localhost:3002
echo  Backend API : http://localhost:3002/api
echo  Health      : http://localhost:3002/ping
echo  Public URL  : see the "Nexus Tunnel" window
echo  -------------------------------------------------------------------
echo.
echo  Press any key to open the LOCAL app in your browser...
pause >nul
start "" "http://localhost:3002"
exit /b 0
