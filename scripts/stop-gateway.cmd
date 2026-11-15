@echo off
powershell -NoProfile -ExecutionPolicy Bypass -Command "Get-CimInstance Win32_Process | Where-Object { $_.CommandLine -like '*mobile-gateway.cjs*' } | ForEach-Object { Write-Host ('stopping PID ' + $_.ProcessId); Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }"
echo DSH mobile gateway stopped (if it was running).
timeout /t 3 >nul
