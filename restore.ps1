# NetViet HR - Script Phuc Hoi Co So Du Lieu D1 (Restore)
param (
    [Parameter(Mandatory=$false)]
    [string]$DatabaseName = "nexrall-hr-manager-prod",

    [Parameter(Mandatory=$false)]
    [string]$SqlFile = ""
)

$ErrorActionPreference = "Stop"

Write-Host "==========================================================" -ForegroundColor Cyan
Write-Host "   TIEN HANH PHUC HOI DU LIEU NETVIET HR VAO D1 REMOTE    " -ForegroundColor Cyan
Write-Host "==========================================================" -ForegroundColor Cyan

if ($SqlFile) {
    node scripts/restore-d1.mjs $DatabaseName $SqlFile
} else {
    node scripts/restore-d1.mjs $DatabaseName
}

if ($LASTEXITCODE -eq 0) {
    Write-Host ""
    Write-Host "==========================================================" -ForegroundColor Green
    Write-Host "   PHUC HOI DU LIEU HOAN TAT THANH CONG!                  " -ForegroundColor Green
    Write-Host "==========================================================" -ForegroundColor Green
} else {
    Write-Host "   [LOI] Co loi xay ra trong qua trinh phuc hoi!" -ForegroundColor Red
    exit 1
}
