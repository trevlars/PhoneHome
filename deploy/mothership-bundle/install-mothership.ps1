#Requires -Version 5.1
# First-run installer inside a Mothership Windows download bundle.
param(
  [string]$PhoneHomeRoot = (Split-Path -Parent $MyInvocation.MyCommand.Path)
)

$ErrorActionPreference = "Stop"
$bundledNode = Join-Path $PhoneHomeRoot "node\node.exe"
if (-not (Test-Path $bundledNode)) {
  Write-Error "Missing bundled Node at $bundledNode — use a release zip from GitHub."
}

$env:PATH = "$(Split-Path $bundledNode);$env:PATH"
$env:PHONEHOME_ROOT = $PhoneHomeRoot

Write-Host "PhoneHome Mothership installer"
Write-Host "  Folder: $PhoneHomeRoot"
Write-Host ""

& (Join-Path $PhoneHomeRoot "deploy\windows\phonehome-init.ps1") -PhoneHomeRoot $PhoneHomeRoot
& (Join-Path $PhoneHomeRoot "deploy\windows\install-service.ps1") -PhoneHomeRoot $PhoneHomeRoot

Write-Host ""
Write-Host "Done. Open your PUBLIC_BASE_URL on a phone to finish Pod setup."
