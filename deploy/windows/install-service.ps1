#Requires -Version 5.1
<#
.SYNOPSIS
  Install PhoneHome as a background task on Windows (runs at logon).

.DESCRIPTION
  Creates a Scheduled Task that runs deploy/phonehome-supervisor.mjs.
  Run from an elevated or normal PowerShell after phonehome-init.sh equivalent setup.

.PARAMETER PhoneHomeRoot
  Path to the PhoneHome repo clone.

.PARAMETER DataDir
  Data directory (default: %USERPROFILE%\.phonehome)
#>
param(
  [string]$PhoneHomeRoot = (Resolve-Path (Join-Path $PSScriptRoot "..\..")).Path,
  [string]$DataDir = (Join-Path $env:USERPROFILE ".phonehome")
)

$ErrorActionPreference = "Stop"

$bundledNode = Join-Path $PhoneHomeRoot "node\node.exe"
if (Test-Path $bundledNode) {
  $nodeExe = $bundledNode
} else {
  $nodeCmd = Get-Command node -ErrorAction SilentlyContinue
  if (-not $nodeCmd) {
    Write-Error "Node.js not found. Use a Mothership download bundle or install Node.js 20+ from https://nodejs.org/"
  }
  $nodeExe = $nodeCmd.Source
}

$supervisor = Join-Path $PhoneHomeRoot "deploy\phonehome-supervisor.mjs"
if (-not (Test-Path $supervisor)) {
  Write-Error "Missing $supervisor"
}

New-Item -ItemType Directory -Force -Path $DataDir | Out-Null

$taskName = "PhoneHome"
$logOut = Join-Path $DataDir "phonehome.log"
$logErr = Join-Path $DataDir "phonehome.err.log"

# Wrapper batch so Scheduled Task has a stable command line.
$nodeDir = Split-Path $nodeExe
$wrapper = Join-Path $DataDir "phonehome-run.cmd"
@"
@echo off
set DATA_DIR=$DataDir
set PATH=$nodeDir;%PATH%
cd /d "$PhoneHomeRoot"
"$nodeExe" "$supervisor" >> "$logOut" 2>> "$logErr"
"@ | Set-Content -Encoding ASCII $wrapper

$action = New-ScheduledTaskAction -Execute $wrapper
$trigger = New-ScheduledTaskTrigger -AtLogOn -User $env:USERNAME
$settings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -RestartCount 3 -RestartInterval (New-TimeSpan -Minutes 1)

Unregister-ScheduledTask -TaskName $taskName -Confirm:$false -ErrorAction SilentlyContinue
Register-ScheduledTask -TaskName $taskName -Action $action -Trigger $trigger -Settings $settings -Description "PhoneHome family voice hub" | Out-Null

Start-ScheduledTask -TaskName $taskName

Write-Host "Installed Windows Scheduled Task: $taskName"
Write-Host "Data:   $DataDir"
Write-Host "Logs:   $logOut"
Write-Host "Stop:   Stop-ScheduledTask -TaskName $taskName"
Write-Host "Remove: Unregister-ScheduledTask -TaskName $taskName"

Start-Sleep -Seconds 3
try {
  Invoke-RestMethod -Uri "http://127.0.0.1:8787/api/health" -TimeoutSec 5
  Write-Host "Hub health: OK"
} catch {
  Write-Host "Hub not responding yet — check $logErr"
}
