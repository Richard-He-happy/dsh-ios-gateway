@echo off
rem Add an inbound Windows Firewall rule for the gateway port so that other
rem devices on your tailnet (iPhone / iPad) can reach this PC.
rem Requires administrator: the script re-launches itself with a UAC prompt.
setlocal
set "PORT=%DSH_MOBILE_PORT%"
if "%PORT%"=="" set "PORT=50108"

net session >nul 2>&1
if %errorlevel% neq 0 (
  echo Requesting administrator privileges...
  powershell -NoProfile -Command "Start-Process -FilePath '%~f0' -Verb RunAs"
  exit /b
)

set "RULE=DSH iOS Gateway TCP %PORT%"
netsh advfirewall firewall delete rule name="%RULE%" >nul 2>&1
netsh advfirewall firewall add rule name="%RULE%" dir=in action=allow protocol=TCP localport=%PORT% profile=any enable=yes
echo.
netsh advfirewall firewall show rule name="%RULE%"
echo.
echo If the rule above is listed, devices on the same tailnet can reach:
echo   http://^<this-PC-Tailscale-IPv4^>:%PORT%/
echo.
pause
