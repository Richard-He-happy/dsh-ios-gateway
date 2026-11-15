@echo off
set "DST=%APPDATA%\Microsoft\Windows\Start Menu\Programs\Startup\dsh-mobile-gateway.vbs"
if exist "%DST%" del /F /Q "%DST%"
echo Autostart removed (the gateway keeps running until you run stop-gateway.cmd).
timeout /t 3 >nul
