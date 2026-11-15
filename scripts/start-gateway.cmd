@echo off
setlocal
cd /d "%~dp0"
if not exist "%~dp0gateway\mobile-gateway.cjs" (
  echo [ERROR] gateway\mobile-gateway.cjs not found.
  echo         Run this script from the extracted repository folder.
  pause
  exit /b 1
)
echo Starting DSH mobile gateway...
wscript "%~dp0start-gateway.vbs"
timeout /t 3 >nul
powershell -NoProfile -ExecutionPolicy Bypass -Command "$ErrorActionPreference='SilentlyContinue'; $port = if ($env:DSH_MOBILE_PORT) { $env:DSH_MOBILE_PORT } else { '50108' }; $h = Invoke-WebRequest -UseBasicParsing -TimeoutSec 4 ('http://127.0.0.1:' + $port + '/__dsh_mobile/health'); if ($h) { Write-Host ('gateway: running  ->  ' + $h.Content) } else { Write-Host 'gateway: NOT running yet (check gateway\gateway.log)'; }"
echo.
echo Open the same address from your iPhone / iPad (Tailscale connected):
echo   http://^<this-PC-Tailscale-IPv4^>:50108/
echo Get the address with:  tailscale ip -4
echo.
pause
