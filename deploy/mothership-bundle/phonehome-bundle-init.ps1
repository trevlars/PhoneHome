#Requires -Version 5.1
# Short first-run setup for Windows download bundles.
param(
  [string]$PhoneHomeRoot = (Split-Path -Parent (Split-Path -Parent $PSScriptRoot)),
  [string]$DataDir = (Join-Path $env:USERPROFILE ".phonehome")
)

$ErrorActionPreference = "Stop"
New-Item -ItemType Directory -Force -Path $DataDir | Out-Null

$envFile = Join-Path $DataDir "phonehome.env"
$bridgeFile = Join-Path $DataDir "bridge.env"

Write-Host ""
Write-Host "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
Write-Host "  PhoneHome Mothership — quick setup"
Write-Host "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
Write-Host ""
Write-Host "  Config folder: $DataDir"
Write-Host ""

Write-Host "Step 1 — Public HTTPS URL (for phones)"
Write-Host ""
Write-Host "  Easiest: cloudflared tunnel --url http://127.0.0.1:8787"
Write-Host ""
$publicUrl = Read-Host "Paste HTTPS URL now, or press Enter to skip for later"
if ($publicUrl -and $publicUrl -notmatch '^https://') {
  Write-Host "URL must start with https:// — skipping for now."
  $publicUrl = ""
}

$sipHost = "phonehome.local"
if ($publicUrl) {
  $sipHost = ([Uri]$publicUrl).Host
}

Write-Host ""
Write-Host "Step 2 — Analog landline (Grandstream HT801)?"
$analog = Read-Host "Setting up a house phone adapter? [y/N]"
$ataPush = if ($analog -match '^[Yy]') { "1" } else { "0" }
$sipServer = "127.0.0.1"
$extMedia = "127.0.0.1"
if ($analog -match '^[Yy]') {
  $sipIn = Read-Host "FreePBX IP on your LAN [$sipServer]"
  if ($sipIn) { $sipServer = $sipIn }
}

@"
# PhoneHome Mothership — edit and restart if you change these.
PUBLIC_BASE_URL=$publicUrl
SIP_PUBLIC_HOST=$sipHost
PORT=8787
DATA_DIR=$DataDir
NODE_ENV=production
SIP_SERVER=$sipServer
BRIDGE_URL=http://127.0.0.1:8790
ATA_LAN_PUSH=$ataPush
"@ | Set-Content -Encoding UTF8 $envFile

if (Test-Path $bridgeFile) {
  $secret = (Select-String -Path $bridgeFile -Pattern '^BRIDGE_SECRET=').Line -replace '^BRIDGE_SECRET=', ''
} else {
  $secret = -join ((48..57) + (65..90) + (97..122) | Get-Random -Count 40 | ForEach-Object { [char]$_ })
}
$ariPass = -join ((48..57) + (65..90) + (97..122) | Get-Random -Count 24 | ForEach-Object { [char]$_ })

@"
BRIDGE_SECRET=$secret
PHONEHOME_URL=http://127.0.0.1:8787
PHONEHOME_WS=ws://127.0.0.1:8787/ws
ARI_URL=http://${sipServer}:8088
ARI_USER=phonehome
ARI_PASS=$ariPass
ARI_APP=phonehome
EXT_MEDIA_HOST=$extMedia
EXT_MEDIA_PORT_BASE=14000
BRIDGE_HTTP_PORT=8790
BRIDGE_HTTP_BIND=0.0.0.0
"@ | Set-Content -Encoding UTF8 $bridgeFile

Write-Host ""
Write-Host "✓ Wrote $envFile"
Write-Host "✓ Wrote $bridgeFile"

if (-not $publicUrl) {
  Write-Host ""
  Write-Host "  No HTTPS URL yet — edit $envFile after you have a tunnel URL."
}
