# NetViet HR - Script Phuc hoi Du lieu He thong (Disaster Recovery)
param(
    [string]$SqlFile = ""
)

Write-Host "==========================================================" -ForegroundColor Red
Write-Host "   KHOI PHUC DU LIEU NETVIET HR (DISASTER RECOVERY)       " -ForegroundColor Red
Write-Host "==========================================================" -ForegroundColor Red

if (-not $SqlFile) {
    # Tim ban sao luu gan nhat trong thu muc backups
    $latestBackup = Get-ChildItem -Path "backups\*\database_d1.sql" -ErrorAction SilentlyContinue | Sort-Object LastWriteTime -Descending | Select-Object -First 1
    if ($latestBackup) {
        $SqlFile = $latestBackup.FullName
        Write-Host "Phat hien ban sao luu gan nhat: $SqlFile" -ForegroundColor Cyan
    } else {
        Write-Host "[LOI] Khong tim thay file sao luu nao trong thu muc backups/!" -ForegroundColor Red
        Write-Host "Cach dung: .\restore.ps1 -SqlFile 'backups\backup_YYYYMMDD_HHmmss\database_d1.sql'" -ForegroundColor Yellow
        exit 1
    }
}

if (-not (Test-Path $SqlFile)) {
    Write-Host "[LOI] File '$SqlFile' khong ton tai!" -ForegroundColor Red
    exit 1
}

Write-Host ""
Write-Host "CANH BAO QUAN TRONG:" -ForegroundColor Yellow
Write-Host "Thao tac nay se nap lai toan bo du lieu tu file vao Cloudflare D1 Remote." -ForegroundColor Yellow
Write-Host "File se phuc hoi: $SqlFile" -ForegroundColor Cyan
Write-Host ""
$confirm = Read-Host "Ban co chac chan muon tien hanh phuc hoi khong? (Nhap 'YES' de xac nhan)"

if ($confirm -ne "YES") {
    Write-Host "Da huy thao tac phuc hoi." -ForegroundColor Gray
    exit 0
}

Write-Host "Dang thuc thi phuc hoi du lieu len Cloudflare D1 Remote..." -ForegroundColor Yellow
npx wrangler d1 execute nexrall-hr-manager-local --remote --file=$SqlFile

Write-Host "==========================================================" -ForegroundColor Green
Write-Host "   KHOI PHUC DU LIEU HOAN TAT!                            " -ForegroundColor Green
Write-Host "==========================================================" -ForegroundColor Green
