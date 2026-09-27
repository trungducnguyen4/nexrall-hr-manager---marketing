# NetViet HR - Script Sao lưu Toàn bộ Dữ liệu Hệ thống (D1 Database & Metadata)
$ErrorActionPreference = "Stop"

$timestamp = Get-Date -Format "yyyyMMdd_HHmmss"
$readableTime = Get-Date -Format "dd/MM/yyyy HH:mm:ss"
$backupDir = "backups\backup_$timestamp"

Write-Host "==========================================================" -ForegroundColor Cyan
Write-Host "   TIEN HANH SAO LUU DU LIEU NETVIET HR ($readableTime)  " -ForegroundColor Cyan
Write-Host "==========================================================" -ForegroundColor Cyan

if (-not (Test-Path "backups")) {
    New-Item -ItemType Directory -Path "backups" | Out-Null
}

New-Item -ItemType Directory -Path $backupDir | Out-Null
$sqlFile = "$backupDir\database_d1.sql"

Write-Host "1. Dang xuat toan bo co so du lieu Cloudflare D1 Remote..." -ForegroundColor Yellow
npx wrangler d1 export nexrall-hr-manager-local --remote --output=$sqlFile -y

if (Test-Path $sqlFile) {
    $item = Get-Item $sqlFile
    $sizeMB = [math]::Round($item.Length / 1MB, 2)
    Write-Host "   -> Thanh cong! Kich thuoc co so du lieu: $sizeMB MB ($($item.Length) bytes)" -ForegroundColor Green

    # Tao file manifest thong tin ban sao luu
    $manifest = @{
        app_name = "NetViet HR Marketing Pro"
        backup_created_at = (Get-Date).ToString("o")
        readable_created_at = $readableTime
        database_name = "nexrall-hr-manager-local"
        database_id = "1e0eeebd-82fa-4c10-a079-97d35308a58b"
        sql_file = "database_d1.sql"
        size_bytes = $item.Length
        size_mb = $sizeMB
        status = "COMPLETED"
    } | ConvertTo-Json -Depth 4

    Set-Content -Path "$backupDir\manifest.json" -Value $manifest -Encoding UTF8

    Write-Host ""
    Write-Host "==========================================================" -ForegroundColor Green
    Write-Host "   SAO LUU THANH CONG!                                    " -ForegroundColor Green
    Write-Host "   Thu muc ban luu: $backupDir                            " -ForegroundColor Green
    Write-Host "   File SQL:        $sqlFile                              " -ForegroundColor Green
    Write-Host "==========================================================" -ForegroundColor Green
    Write-Host ""
    Write-Host "Luu y an toan: Ban co the copy thu muc '$backupDir' len Google Drive hoac o cung ngoai de du phong." -ForegroundColor Gray
} else {
    Write-Host "   [LOI] Khong the xuat file SQL tu D1 database!" -ForegroundColor Red
    exit 1
}
