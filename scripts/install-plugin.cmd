@echo off
setlocal
rem Safe installer: backs up the DSH profile package.json, adds the plugin,
rem writes UTF-8 WITHOUT BOM and validates the JSON.
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0install-plugin.ps1" %*
if errorlevel 1 (
  echo.
  echo [ERROR] Plugin install failed. See the messages above.
  pause
  exit /b 1
)
echo.
echo Done. Restart DSH once.
pause
