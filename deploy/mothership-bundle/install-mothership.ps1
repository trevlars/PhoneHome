#Requires -Version 5.1
# First-run installer inside a Mothership Windows download bundle.
param(
  [string]$PhoneHomeRoot = (Split-Path -Parent $MyInvocation.MyCommand.Path)
)

$ErrorActionPreference = "Stop"
$bundledNode = Join-Path $PhoneHomeRoot "node\node.exe"
if (-not (Test-Path $bundledNode)) {
  Write-Error "Missing bundled Node — download from GitHub Releases."
}

$env:PATH = "$(Split-Path $bundledNode);$env:PATH"
$env:PHONEHOME_ROOT = $PhoneHomeRoot

Write-Host ""
Write-Host "PhoneHome Mothership installer"
Write-Host "  Folder: $PhoneHomeRoot"
Write-Host ""

& (Join-Path $PhoneHomeRoot "deploy\mothership-bundle\phonehome-bundle-init.ps1")
& (Join-Path $PhoneHomeRoot "deploy\windows\install-service.ps1") -PhoneHomeRoot $PhoneHomeRoot

$dataDir = Join-Path $env:USERPROFILE ".phonehome"
Write-Host ""
Write-Host "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
Write-Host "  ✓ Mothership is running"
Write-Host "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
Write-Host ""
Write-Host "  On this computer:  http://127.0.0.1:8787"
Write-Host "  Config / logs:     $dataDir"
Write-Host ""
Write-Host "  First boot prints a setup code — check phonehome.log or HOST_CODE.txt"
Write-Host ""
Read-Host "Press Enter to close"
