@echo off
rem Optional: put Tailscale Serve in front of the gateway so the phone can use a
rem URL WITHOUT a port, e.g. https://your-pc.your-tailnet.ts.net/
rem
rem One-time prerequisites in the Tailscale admin console:
rem   1) enable "Serve" for your tailnet
rem   2) enable "HTTPS Certificates" (DNS page)
rem
rem The script auto-detects your machine's MagicDNS name from the local CLI.
setlocal
set "PORT=%DSH_MOBILE_PORT%"
if "%PORT%"=="" set "PORT=50108"

set "TS=%TAILSCALE_EXE%"
if "%TS%"=="" set "TS=%ProgramFiles%\Tailscale\tailscale.exe"
if not exist "%TS%" set "TS=%ProgramFiles(x86)%\Tailscale\tailscale.exe"
if not exist "%TS%" set "TS=tailscale.exe"

for /f "delims=" %%D in ('powershell -NoProfile -Command "$ErrorActionPreference='Stop'; $j = & \"%TS%\" status --json | ConvertFrom-Json; ($j.Self.DNSName -replace '\\.$','')"') do set "DNS=%%D"

if "%DNS%"=="" (
  echo [ERROR] Could not detect the MagicDNS name. Is Tailscale installed and logged in?
  pause
  exit /b 1
)

echo Configuring Tailscale Serve for %DNS% ...
echo (HTTPS 443 and HTTP 80 -> http://127.0.0.1:%PORT%)
"%TS%" serve --bg --https=443 http://127.0.0.1:%PORT%
"%TS%" serve --bg --http=80 http://127.0.0.1:%PORT%
echo.
"%TS%" serve status
echo.
echo URLs:
echo   https://%DNS%/
echo   http://%DNS%/
echo.
echo If the commands above ask you to enable Serve / HTTPS Certificates, open the
echo printed link, enable them, then run this script again.
pause
