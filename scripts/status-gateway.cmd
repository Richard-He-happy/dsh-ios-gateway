@echo off
setlocal
set "PORT=%DSH_MOBILE_PORT%"
if "%PORT%"=="" set "PORT=50108"
powershell -NoProfile -ExecutionPolicy Bypass -Command "$ErrorActionPreference='SilentlyContinue'; $h = Invoke-WebRequest -UseBasicParsing -TimeoutSec 4 ('http://127.0.0.1:' + $env:PORT + '/__dsh_mobile/health'); if ($h) { Write-Host 'gateway: running'; Write-Host $h.Content } else { Write-Host 'gateway: NOT running (run start-gateway.cmd)' }"
echo.
echo Tailscale status:
set "TS=%TAILSCALE_EXE%"
if "%TS%"=="" set "TS=%ProgramFiles%\Tailscale\tailscale.exe"
if not exist "%TS%" set "TS=%ProgramFiles(x86)%\Tailscale\tailscale.exe"
if not exist "%TS%" set "TS=tailscale.exe"
"%TS%" status
echo.
timeout /t 8 >nul
