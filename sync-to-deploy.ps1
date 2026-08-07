# ============================================================================
# sync-to-deploy.ps1
# Dong bo code tu nguon (src/, styles/, index.html, favicon.png, manifest,
# sw.js, icon pwa) sang thu muc deploy (.local-public/) roi deploy len
# Cloudflare Workers.
#
# Cach dung:
#   .\sync-to-deploy.ps1             # sync + deploy
#   .\sync-to-deploy.ps1 -NoDeploy   # chi sync, khong deploy
#   .\sync-to-deploy.ps1 -DryRun     # chi in danh sach file se copy
#
# LUU Y: Script dung ASCII (khong dau) trong output de tranh loi encoding
#        tren PowerShell 5.1 (Windows).
# ============================================================================

param(
    [switch]$NoDeploy,
    [switch]$DryRun
)

$ErrorActionPreference = 'Stop'
$root   = $PSScriptRoot
$src    = Join-Path $root 'src'
$styles = Join-Path $root 'styles'
$pub    = Join-Path $root '.local-public'

# --- Kiem tra thu muc nguon ------------------------------------------------
foreach ($dir in @($src, $styles)) {
    if (-not (Test-Path $dir)) { Write-Error "Khong tim thay thu muc: $dir"; exit 1 }
}
if (-not (Test-Path $pub)) {
    Write-Host "Tao thu muc deploy .local-public ..." -ForegroundColor Yellow
    New-Item -ItemType Directory -Path $pub -Force | Out-Null
}

function Copy-Dir {
    param([string]$From, [string]$To)
    $files = @(Get-ChildItem $From -Recurse -File)
    foreach ($f in $files) {
        $rel = $f.FullName.Substring($From.Length + 1)
        $dest = Join-Path $To $rel
        $destDir = Split-Path $dest -Parent
        if ($DryRun) {
            Write-Host "  [DRY] $rel" -ForegroundColor DarkGray
            continue
        }
        if (-not (Test-Path $destDir)) { New-Item -ItemType Directory -Path $destDir -Force | Out-Null }
        Copy-Item $f.FullName $dest -Force
    }
    Write-Host "  -> $($files.Count) file: $From" -ForegroundColor Cyan
}

function Copy-File {
    param([string]$File)
    $name = Split-Path $File -Leaf
    $dest = Join-Path $pub $name
    if ($DryRun) {
        if (Test-Path $File) { Write-Host "  [DRY] $name" -ForegroundColor DarkGray }
        return
    }
    if (Test-Path $File) {
        Copy-Item $File $dest -Force
        Write-Host "  -> $name" -ForegroundColor Cyan
    }
}

Write-Host "=== SYNC -> .local-public ===" -ForegroundColor Green

# 1. Code JS (src/)
Write-Host "Copy src/ ..."
Copy-Dir $src (Join-Path $pub 'src')

# 2. CSS (styles/)
Write-Host "Copy styles/ ..."
Copy-Dir $styles (Join-Path $pub 'styles')

# 3. File root
Write-Host "Copy root files ..."
Copy-File (Join-Path $root 'index.html')
Copy-File (Join-Path $root 'favicon.png')
Copy-File (Join-Path $root 'manifest.webmanifest')
Copy-File (Join-Path $root 'sw.js')
Copy-File (Join-Path $root 'icon-192.png')
Copy-File (Join-Path $root 'icon-512.png')
Copy-File (Join-Path $root 'apple-touch-icon.png')

# 4. Xac nhan
$pubCount = @(Get-ChildItem (Join-Path $pub 'src') -Recurse -File).Count
Write-Host ""
Write-Host "=== DONE: .local-public/src co $pubCount file ===" -ForegroundColor Green

# --- Deploy ----------------------------------------------------------------
if ($DryRun) {
    Write-Host "DRY RUN - khong deploy. Chay lai khong co -DryRun de deploy." -ForegroundColor Yellow
    exit 0
}
if ($NoDeploy) {
    Write-Host "Da sync xong (khong deploy, -NoDeploy). Chay 'wrangler deploy' khi san sang." -ForegroundColor Yellow
    exit 0
}

Write-Host ""
Write-Host "=== Deploy len Cloudflare Workers ... ===" -ForegroundColor Green
Push-Location $root
try {
    npx wrangler deploy
    if ($LASTEXITCODE -ne 0) { Write-Error "Deploy that bai (exit code $LASTEXITCODE)"; exit $LASTEXITCODE }
    Write-Host "=== DEPLOY THANH CONG ===" -ForegroundColor Green
}
finally {
    Pop-Location
}
