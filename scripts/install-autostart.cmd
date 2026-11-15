@echo off
rem Install (or re-install) the gateway into the current user's Startup folder,
rem so it starts automatically at every login. No administrator rights needed.
setlocal
set "DIR=%~dp0"
set "DST=%APPDATA%\Microsoft\Windows\Start Menu\Programs\Startup\dsh-mobile-gateway.vbs"

> "%DST%" echo ' Auto-generated launcher for the DSH mobile gateway.
>>"%DST%" echo Set sh = CreateObject("WScript.Shell")
>>"%DST%" echo sh.Run """" ^& "%DIR%start-gateway.vbs" ^& """", 0, False

if exist "%DST%" (
  echo OK: autostart installed:
  echo   %DST%
  echo.
  echo Starting the gateway now...
  wscript "%DIR%start-gateway.vbs"
) else (
  echo FAILED: could not write the startup script.
)
echo.
pause
