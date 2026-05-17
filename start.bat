@echo off
title Nexus AI
color 0A

echo.
echo  NEXUS AI - Neural Engine v4.0
echo  -------------------------------------------------------------------
echo  Architecture:
echo    Tunnel  ^> Express :3002  (API + built frontend, no Vite issues)
echo    Local   ^> Vite    :3000  (dev server with fast refresh)
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
    echo  [SETUP] Installing dependencies...
    call npm install
    if errorlevel 1 ( echo  [ERROR] npm install failed. & pause & exit /b 1 )
    echo.
)

:: [1/4] Build frontend for Express to serve via tunnel
echo  [1/4] Building frontend for tunnel...
call npm run build
if errorlevel 1 (
    echo  [ERROR] Frontend build failed. Fix the error above and retry.
    pause
    exit /b 1
)
echo  [1/4] Build complete!
echo.

:: [2/4] Backend - Express serves API + built dist/ frontend
:: Tunnel points here (port 3002), not to Vite, so no host-security rejections.
echo  [2/4] Starting backend on http://127.0.0.1:3002
start "Nexus Backend" cmd /k "color 0B & title Nexus Backend & npx tsx watch server/index.ts"

echo  [2/4] Waiting for backend to be ready...
:backend_wait
timeout /t 2 /nobreak >nul
curl -s -o nul -m 2 http://127.0.0.1:3002/ping 2>nul
if errorlevel 1 goto backend_wait
echo  [2/4] Backend is ready!
echo.

:: [3/4] Vite dev server - LOCAL only, NOT used by the tunnel
echo  [3/4] Starting Vite dev server on http://127.0.0.1:3000 (local only)
start "Nexus Frontend" cmd /k "set DISABLE_HMR=true & color 0C & title Nexus Frontend & npm run dev"

echo  [3/4] Waiting for Vite to be ready...
:vite_wait
timeout /t 1 /nobreak >nul
curl -s -o nul -m 1 http://127.0.0.1:3000/ 2>nul
if errorlevel 1 goto vite_wait
echo  [3/4] Vite is ready!
echo.

:: [4/4] Cloudflare tunnel - points to port 3002 (Express), NOT 3000 (Vite)
:: Express has no host-security middleware so any tunnel domain is accepted.
echo  [4/4] Starting Cloudflare tunnel...

set "CF_EXE="
if exist "C:\tmp\cloudflared.exe"        set "CF_EXE=C:\tmp\cloudflared.exe"
if exist "%~dp0cloudflared.exe"          set "CF_EXE=%~dp0cloudflared.exe"
if exist "%USERPROFILE%\cloudflared.exe" set "CF_EXE=%USERPROFILE%\cloudflared.exe"
if "%CF_EXE%"=="" (
    where cloudflared >nul 2>&1
    if not errorlevel 1 set "CF_EXE=cloudflared"
)

if "%CF_EXE%"=="" goto :no_cloudflared

echo  [RUN] Tunnel starting - URL appears in the Nexus Tunnel window
start "Nexus Tunnel" cmd /k "%CF_EXE% tunnel --url http://127.0.0.1:3002 --protocol http2"
goto :done

:no_cloudflared
echo  [SKIP] cloudflared.exe not found.
echo         Download to C:\tmp\ from:
echo         https://github.com/cloudflare/cloudflared/releases/latest

:done
echo.
echo  -------------------------------------------------------------------
echo  Local dev   : http://localhost:3000  (Vite, fast refresh)
echo  Tunnel URL  : see the Nexus Tunnel window  (Express, stable)
echo  Backend API : http://localhost:3002
echo  Health      : http://localhost:3002/ping
echo  -------------------------------------------------------------------
echo.
echo  FIRST VISIT: Cloudflare shows a warning page at the tunnel URL.
echo              Click the blue PROCEED button - the app then loads normally.
echo              After clicking once, the warning never appears again for
echo              this tunnel URL in your browser.
echo.
echo  NOTE: Share the tunnel URL, NOT localhost:3000.
echo        Frontend changes require a rebuild - run start.bat again.
echo.
echo  Press any key to open the local dev server in your browser...
pause >nul
start "" "http://localhost:3000"
exit /b 0
