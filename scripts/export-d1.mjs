import { execSync } from 'child_process';
import fs from 'fs';
import path from 'path';

console.log('=== NETVIET HR - D1 FULL DATABASE EXPORTER ===');

const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
const backupDir = path.resolve('backups', `backup_${timestamp}`);
fs.mkdirSync(backupDir, { recursive: true });
const outputFile = path.join(backupDir, 'database_d1.sql');

console.log(`1. Lay danh sach tat ca cac bang trong D1 Remote...`);
const listCmd = 'npx wrangler d1 execute nexrall-hr-manager-local --remote --json --command="SELECT name, sql FROM sqlite_master WHERE type=\'table\' AND name NOT LIKE \'_cf_%\' AND name != \'sqlite_sequence\' ORDER BY name"';

let tablesRaw;
try {
  tablesRaw = execSync(listCmd, { encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'] });
} catch (e) {
  console.error('Loi khi ket noi D1 Remote:', e.message);
  process.exit(1);
}

const parsed = JSON.parse(tablesRaw);
const tables = parsed[0]?.results || [];
console.log(`   -> Tim thay ${tables.length} bang.`);

const outStream = fs.createWriteStream(outputFile, { encoding: 'utf-8' });
outStream.write(`-- NETVIET HR FULL D1 BACKUP\n-- Thoi gian: ${new Date().toLocaleString('vi-VN')}\n-- Database: nexrall-hr-manager-local\n\nPRAGMA foreign_keys = OFF;\n\n`);

let totalRowsExported = 0;

for (let i = 0; i < tables.length; i++) {
  const t = tables[i];
  console.log(`[${i + 1}/${tables.length}] Dang sao luu bang: ${t.name}...`);
  outStream.write(`-- Table: ${t.name}\n`);
  outStream.write(`DROP TABLE IF EXISTS "${t.name}";\n`);
  outStream.write(`${t.sql};\n\n`);

  try {
    const dataCmd = `npx wrangler d1 execute nexrall-hr-manager-local --remote --json --command="SELECT * FROM \\"${t.name}\\""`;
    const dataRaw = execSync(dataCmd, { encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'], maxBuffer: 50 * 1024 * 1024 });
    const dataJson = JSON.parse(dataRaw);
    const rows = dataJson[0]?.results || [];

    if (rows.length > 0) {
      totalRowsExported += rows.length;
      for (const row of rows) {
        const cols = Object.keys(row).map(k => `"${k}"`).join(', ');
        const vals = Object.values(row).map(v => {
          if (v === null || v === undefined) return 'NULL';
          if (typeof v === 'number') return v;
          if (typeof v === 'boolean') return v ? 1 : 0;
          return `'${String(v).replace(/'/g, "''")}'`;
        }).join(', ');
        outStream.write(`INSERT INTO "${t.name}" (${cols}) VALUES (${vals});\n`);
      }
      outStream.write('\n');
    }
  } catch (err) {
    console.warn(`   [Canh bao] Loi khi doc du lieu bang ${t.name}:`, err.message);
  }
}

outStream.write(`\nPRAGMA foreign_keys = ON;\n`);
await new Promise((resolve, reject) => {
  outStream.on('finish', resolve);
  outStream.on('error', reject);
  outStream.end();
});

const stat = fs.statSync(outputFile);
const mb = (stat.size / (1024 * 1024)).toFixed(2);
console.log(`\n=== SAO LUU HOAN TAT! ===`);
console.log(`- File luu: ${outputFile}`);
console.log(`- Tong so bang: ${tables.length}`);
console.log(`- Tong so ban ghi: ${totalRowsExported}`);
console.log(`- Kich thuoc file: ${mb} MB`);

fs.writeFileSync(path.join(backupDir, 'manifest.json'), JSON.stringify({
  app_name: 'NetViet HR Marketing Pro',
  backup_created_at: new Date().toISOString(),
  table_count: tables.length,
  total_rows: totalRowsExported,
  file_name: 'database_d1.sql',
  file_size_bytes: stat.size,
  file_size_mb: mb
}, null, 2), 'utf-8');
