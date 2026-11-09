#Requires -Version 5.1
<#
.SYNOPSIS
  Interactive Mothership config for Windows (writes %USERPROFILE%\.phonehome\*.env).
#>
param(
  [string]$PhoneHomeRoot = (Resolve-Path (Join-Path $PSScriptRoot "..\..")).Path,
  [string]$DataDir = (Join-Path $env:USERPROFILE ".phonehome")
)

$ErrorActionPreference = "Stop"
New-Item -ItemType Directory -Force -Path $DataDir | Out-Null

$envFile = Join-Path $DataDir "phonehome.env"
$bridgeFile = Join-Path $DataDir "bridge.env"

Write-Host "==> PhoneHome Mothership setup"
Write-Host "    Data: $DataDir"
Write-Host ""

$publicUrl = Read-Host "PUBLIC_BASE_URL (https://...)"
if ($publicUrl -notmatch '^https://') { throw "PUBLIC_BASE_URL must start with https://" }
$uri = [Uri]$publicUrl
$sipHost = Read-Host "SIP_PUBLIC_HOST [$($uri.Host)]"
if (-not $sipHost) { $sipHost = $uri.Host }
$sipServer = Read-Host "FreePBX LAN IP (SIP_SERVER) [127.0.0.1]"
if (-not $sipServer) { $sipServer = "127.0.0.1" }
$extMedia = Read-Host "EXT_MEDIA_HOST (this PC LAN IP) [127.0.0.1]"
if (-not $extMedia) { $extMedia = "127.0.0.1" }

@"
PUBLIC_BASE_URL=$publicUrl
SIP_PUBLIC_HOST=$sipHost
PORT=8787
DATA_DIR=$DataDir
NODE_ENV=production
SIP_SERVER=$sipServer
BRIDGE_URL=http://127.0.0.1:8790
ATA_LAN_PUSH=1
"@ | Set-Content -Encoding UTF8 $envFile

if (Test-Path $bridgeFile) {
  $secret = (Select-String -Path $bridgeFile -Pattern '^BRIDGE_SECRET=').Line -replace '^BRIDGE_SECRET=', ''
} else {
  $secret = -join ((48..57) + (65..90) + (97..122) | Get-Random -Count 40 | ForEach-Object { [char]$_ })
}
$ariPass = Read-Host "ARI password (FreePBX) [random]"
if (-not $ariPass) {
  $ariPass = -join ((48..57) + (65..90) + (97..122) | Get-Random -Count 24 | ForEach-Object { [char]$_ })
  Write-Host "    (generated)"
}

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
Write-Host "Wrote $envFile"
Write-Host "Wrote $bridgeFile"
