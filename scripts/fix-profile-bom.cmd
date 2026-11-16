@echo off
setlocal
rem Repair "Unexpected token ... is not valid JSON" caused by a UTF-8 BOM in
rem the DSH profile package.json.
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0fix-profile-bom.ps1" %*
echo.
pause
