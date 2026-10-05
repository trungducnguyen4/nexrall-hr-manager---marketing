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

Write-Host "1. Dang xuat toan bo co so du lieu Cloudflare D1 Remote qua script exporter..." -ForegroundColor Yellow
node scripts/export-d1.mjs

if ($LASTEXITCODE -eq 0) {
    Write-Host ""
    Write-Host "==========================================================" -ForegroundColor Green
    Write-Host "   SAO LUU THANH CONG!                                    " -ForegroundColor Green
    Write-Host "==========================================================" -ForegroundColor Green
    Write-Host "Kiem tra thu muc 'backups' de xem cac file sao luu moi nhat." -ForegroundColor Gray
} else {
    Write-Host "   [LOI] Khong the xuat file SQL tu D1 database!" -ForegroundColor Red
    exit 1
}
