<#
.SYNOPSIS
  Safely install the DSH iOS Gateway plugin into the local DSH profile.

.DESCRIPTION
  - finds the DSH profile (DSH_HOME/profiles/<profile>, default profile "desktop")
  - backs up package.json before touching it
  - adds the "link:<repo>" dependency + "dsh-ios-gateway" bundle
  - writes UTF-8 WITHOUT BOM (a BOM makes DSH fail with "Unexpected token ... is not valid JSON")
  - validates the JSON before and after writing, and restores the backup on error
  - creates the node_modules junction

.NOTES
  Never edit the DSH profile package.json with Notepad / PowerShell Set-Content:
  Windows PowerShell 5.1 writes a UTF-8 BOM by default, which breaks DSH startup.
#>
[CmdletBinding()]
param(
  [string]$RepoPath = (Split-Path -Parent (Split-Path -Parent $PSScriptRoot)),
  [string]$ProfileDir
)

$ErrorActionPreference = 'Stop'

function Resolve-ProfileDir {
  param([string]$explicit)
  if ($explicit) { return $explicit }
  if ($env:DSH_HOME) {
    $candidate = Join-Path $env:DSH_HOME 'profiles\desktop'
    if (Test-Path (Join-Path $candidate 'package.json')) { return $candidate }
    $default = Join-Path $env:DSH_HOME 'profiles\default'
    if (Test-Path (Join-Path $default 'package.json')) { return $default }
  }
  $fallback = Join-Path $env:USERPROFILE '.dsh\profiles\desktop'
  if (Test-Path (Join-Path $fallback 'package.json')) { return $fallback }
  throw 'Could not find the DSH profile. Pass -ProfileDir <path> explicitly.'
}

function Read-JsonFile {
  param([string]$Path)
  $bytes = [System.IO.File]::ReadAllBytes($Path)
  $hasBom = $bytes.Length -ge 3 -and $bytes[0] -eq 0xEF -and $bytes[1] -eq 0xBB -and $bytes[2] -eq 0xBF
  $text = if ($hasBom) { [System.Text.Encoding]::UTF8.GetString($bytes, 3, $bytes.Length - 3) } else { [System.Text.Encoding]::UTF8.GetString($bytes) }
  return @{ Text = $text; HasBom = $hasBom }
}

function Write-JsonNoBom {
  param([string]$Path, [string]$Text)
  $json = $Text | ConvertFrom-Json
  $normalized = $json | ConvertTo-Json -Depth 32
  $utf8 = New-Object System.Text.UTF8Encoding($false)
  [System.IO.File]::WriteAllText($Path, $normalized + [Environment]::NewLine, $utf8)
  $check = [System.IO.File]::ReadAllBytes($Path)
  if ($check.Length -ge 3 -and $check[0] -eq 0xEF -and $check[1] -eq 0xBB -and $check[2] -eq 0xBF) {
    throw 'Refusing to leave a UTF-8 BOM in the profile package.json.'
  }
  $null = [System.Text.Encoding]::UTF8.GetString($check) | ConvertFrom-Json
}

$profileDir = Resolve-ProfileDir $ProfileDir
$packagePath = Join-Path $profileDir 'package.json'
if (-not (Test-Path $packagePath)) { throw "Profile package.json not found: $packagePath" }
if (-not (Test-Path (Join-Path $RepoPath 'package.json'))) { throw "Repository not found: $RepoPath" }

Write-Host "Profile : $profileDir"
Write-Host "Repo    : $RepoPath"

$stamp = Get-Date -Format 'yyyyMMdd-HHmmss'
$backup = "$packagePath.bak-ios-plugin-$stamp"
Copy-Item $packagePath $backup -Force
Write-Host "Backup  : $backup"

try {
  $read = Read-JsonFile $packagePath
  if ($read.HasBom) { Write-Host 'Note: existing profile package.json had a UTF-8 BOM; it will be removed.' -ForegroundColor Yellow }
  $json = $read.Text | ConvertFrom-Json

  if (-not $json.PSObject.Properties['dependencies']) {
    $json | Add-Member -NotePropertyName dependencies -NotePropertyValue ([pscustomobject]@{})
  }
  $link = 'link:' + ($RepoPath -replace '\\', '/')
  if ($json.dependencies.PSObject.Properties['dsh-ios-gateway']) {
    $json.dependencies.'dsh-ios-gateway' = $link
  } else {
    $json.dependencies | Add-Member -NotePropertyName 'dsh-ios-gateway' -NotePropertyValue $link
  }

  if (-not $json.PSObject.Properties['dsh']) { throw 'package.json has no "dsh" profile manifest.' }
  if (-not $json.dsh.PSObject.Properties['profile']) { throw 'package.json has no dsh.profile manifest.' }
  $bundles = @($json.dsh.profile.bundles)
  if ($bundles -notcontains 'dsh-ios-gateway') { $bundles += 'dsh-ios-gateway' }
  $json.dsh.profile.bundles = $bundles

  $text = $json | ConvertTo-Json -Depth 32
  $null = $text | ConvertFrom-Json   # validate before write
  Write-JsonNoBom -Path $packagePath -Text $text
  Write-Host 'package.json updated (UTF-8 no BOM, JSON validated).' -ForegroundColor Green

  $modules = Join-Path $profileDir 'node_modules'
  if (-not (Test-Path $modules)) { New-Item -ItemType Directory -Path $modules | Out-Null }
  $linkPath = Join-Path $modules 'dsh-ios-gateway'
  $expected = (Resolve-Path $RepoPath).Path
  if (Test-Path $linkPath) {
    $item = Get-Item $linkPath -Force
    if ($item.LinkType -eq 'Junction' -and $item.Target -eq $expected) {
      Write-Host "Junction already points to: $expected"
    } else {
      Write-Host "WARNING: $linkPath exists but is not the expected junction. Remove it manually if needed." -ForegroundColor Yellow
    }
  } else {
    cmd /c mklink /J "$linkPath" "$expected" | Out-Null
    Write-Host "Junction: $linkPath -> $expected"
  }
  Write-Host ''
  Write-Host 'Done. Restart DSH once; the plugin will start the mobile gateway automatically.' -ForegroundColor Green
} catch {
  Write-Host "ERROR: $($_.Exception.Message)" -ForegroundColor Red
  Copy-Item $backup $packagePath -Force
  Write-Host "Restored backup: $backup" -ForegroundColor Yellow
  exit 1
}
