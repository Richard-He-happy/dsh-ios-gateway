<#
.SYNOPSIS
  Repair a DSH profile package.json that has a UTF-8 BOM.

.DESCRIPTION
  A UTF-8 BOM at the start of <profile>/package.json makes DSH fail to start with:
    Unexpected token '' ... is not valid JSON
  This script removes the BOM, validates the JSON, and writes the file back as
  UTF-8 without BOM (with a timestamped backup).
#>
[CmdletBinding()]
param([string]$ProfileDir)

$ErrorActionPreference = 'Stop'

if (-not $ProfileDir) {
  if ($env:DSH_HOME) {
    $candidate = Join-Path $env:DSH_HOME 'profiles\desktop'
    if (Test-Path (Join-Path $candidate 'package.json')) { $ProfileDir = $candidate }
    else {
      $candidate = Join-Path $env:DSH_HOME 'profiles\default'
      if (Test-Path (Join-Path $candidate 'package.json')) { $ProfileDir = $candidate }
    }
  }
  if (-not $ProfileDir) {
    $fallback = Join-Path $env:USERPROFILE '.dsh\profiles\desktop'
    if (Test-Path (Join-Path $fallback 'package.json')) { $ProfileDir = $fallback }
  }
}
if (-not $ProfileDir) { throw 'Could not find the DSH profile. Pass -ProfileDir <path>.' }

$path = Join-Path $ProfileDir 'package.json'
$bytes = [System.IO.File]::ReadAllBytes($path)
$hasBom = $bytes.Length -ge 3 -and $bytes[0] -eq 0xEF -and $bytes[1] -eq 0xBB -and $bytes[2] -eq 0xBF
if (-not $hasBom) {
  Write-Host "No BOM found; nothing to fix: $path" -ForegroundColor Green
  exit 0
}

$stamp = Get-Date -Format 'yyyyMMdd-HHmmss'
$backup = "$path.bak-bom-$stamp"
Copy-Item $path $backup -Force
$text = [System.Text.Encoding]::UTF8.GetString($bytes, 3, $bytes.Length - 3)
$null = $text | ConvertFrom-Json
$utf8 = New-Object System.Text.UTF8Encoding($false)
[System.IO.File]::WriteAllText($path, $text, $utf8)
$check = [System.IO.File]::ReadAllBytes($path)
if ($check.Length -ge 3 -and $check[0] -eq 0xEF -and $check[1] -eq 0xBB -and $check[2] -eq 0xBF) {
  Copy-Item $backup $path -Force
  throw 'Failed to remove the BOM; original file restored.'
}
Write-Host "BOM removed and JSON validated: $path" -ForegroundColor Green
Write-Host "Backup: $backup"
