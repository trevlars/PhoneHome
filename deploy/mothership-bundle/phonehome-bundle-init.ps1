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

function Normalize-DuckDomain([string]$raw) {
  $d = ($raw ?? "").Trim().ToLowerInvariant()
  $d = $d -replace '^https?://', ''
  $d = $d -replace '/.*$', ''
  $d = $d -replace ':.*$', ''
  $d = $d -replace '\.duckdns\.org$', ''
  if ($d -match '^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?$') { return $d }
  return ""
}

Write-Host ""
Write-Host "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
Write-Host "  PhoneHome Mothership — quick setup"
Write-Host "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
Write-Host ""
Write-Host "  Config folder: $DataDir"
Write-Host ""

$existingPub = ""
$existingDuck = ""
$existingToken = ""
$existingPort = "8443"
if (Test-Path $envFile) {
  Get-Content $envFile | ForEach-Object {
    if ($_ -match '^PUBLIC_BASE_URL=(.*)$') { $existingPub = $Matches[1] }
    if ($_ -match '^DUCKDNS_DOMAIN=(.*)$') { $existingDuck = $Matches[1] }
    if ($_ -match '^DUCKDNS_TOKEN=(.*)$') { $existingToken = $Matches[1] }
    if ($_ -match '^DUCKDNS_HTTPS_PORT=(.*)$') { $existingPort = $Matches[1] }
  }
}

Write-Host "Step 1 — Public hostname (phones need HTTPS)"
Write-Host ""
Write-Host "  Recommended: DuckDNS — https://www.duckdns.org"
Write-Host "  Create a subdomain, copy the token, enter below."
Write-Host "  Mothership keeps DNS updated; forward TCP $existingPort to this PC."
Write-Host "  Other options: Cloudflare Tunnel / own domain (INSTALL.md)."
Write-Host ""

$duckPrompt = if ($existingDuck) { $existingDuck } else { "skip" }
$duckIn = Read-Host "DuckDNS subdomain [$duckPrompt]"
if (-not $duckIn) { $duckIn = $existingDuck }
$duckDomain = Normalize-DuckDomain $duckIn
$duckToken = ""
$duckPort = $existingPort
$publicUrl = ""
$sipHost = "phonehome.local"

if ($duckDomain) {
  $tokPrompt = if ($existingToken) { "saved" } else { "" }
  $tokIn = Read-Host "DuckDNS token [$tokPrompt]"
  $duckToken = if ($tokIn) { $tokIn } else { $existingToken }
  if (-not $duckToken) {
    Write-Host "No token — DuckDNS skipped for now."
    $duckDomain = ""
  } else {
    $portIn = Read-Host "HTTPS port on DuckDNS hostname [$existingPort]"
    if ($portIn) { $duckPort = $portIn }
    if (-not $duckPort) { $duckPort = "8443" }
    if ($duckPort -eq "443") {
      $publicUrl = "https://$duckDomain.duckdns.org"
    } else {
      $publicUrl = "https://$duckDomain.duckdns.org:$duckPort"
    }
    $sipHost = "$duckDomain.duckdns.org"
    Write-Host ""
    Write-Host "  Updating DuckDNS…"
    try {
      $uri = "https://www.duckdns.org/update?domains=$duckDomain&token=$duckToken&ip="
      $body = (Invoke-WebRequest -Uri $uri -UseBasicParsing -TimeoutSec 20).Content.Trim()
      if ($body -like "OK*") {
        Write-Host "  ✓ DuckDNS OK — $duckDomain.duckdns.org"
      } else {
        Write-Host "  ! DuckDNS responded: $body (continuing)"
      }
    } catch {
      Write-Host "  ! Could not reach DuckDNS (updater retries when Mothership runs)"
    }
  }
}

if (-not $publicUrl) {
  Write-Host ""
  Write-Host "  Optional: paste an existing HTTPS URL, or Enter to skip."
  $publicUrl = Read-Host "HTTPS URL [$existingPub]"
  if (-not $publicUrl) { $publicUrl = $existingPub }
  if ($publicUrl -and $publicUrl -notmatch '^https://') {
    Write-Host "URL must start with https:// — skipping for now."
    $publicUrl = ""
  }
  if ($publicUrl) {
    $sipHost = ([Uri]$publicUrl).Host
  }
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
DUCKDNS_DOMAIN=$duckDomain
DUCKDNS_TOKEN=$duckToken
DUCKDNS_HTTPS_PORT=$duckPort
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

if ($duckDomain) {
  Write-Host ""
  Write-Host "  DuckDNS: $duckDomain.duckdns.org (updater runs with Mothership)"
  Write-Host "  Phones:  $publicUrl"
} elseif (-not $publicUrl) {
  Write-Host ""
  Write-Host "  No public URL yet — edit $envFile with DUCKDNS_* or PUBLIC_BASE_URL."
}
