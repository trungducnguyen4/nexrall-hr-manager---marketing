import { execSync } from 'child_process';
import fs from 'fs';
import path from 'path';

console.log('=== NETVIET HR - D1 DATABASE RESTORER ===');

const targetDb = process.argv[2];
const sqlFileArg = process.argv[3];

if (!targetDb) {
  console.error('Su dung: node scripts/restore-d1.mjs <TARGET_DATABASE_NAME> [PATH_TO_SQL_FILE]');
  console.error('Vi du: node scripts/restore-d1.mjs nexrall-hr-manager-prod');
  process.exit(1);
}

// Tim file SQL
let sqlPath = sqlFileArg;
if (!sqlPath) {
  const backupsDir = path.resolve('backups');
  if (!fs.existsSync(backupsDir)) {
    console.error('Khong tim thay thu muc backups!');
    process.exit(1);
  }
  const folders = fs.readdirSync(backupsDir)
    .filter(f => f.startsWith('backup_'))
    .map(f => ({ name: f, mtime: fs.statSync(path.join(backupsDir, f)).mtimeMs }))
    .sort((a, b) => b.mtime - a.mtime);
  if (folders.length === 0) {
    console.error('Chua co ban backup nao trong thu muc backups!');
    process.exit(1);
  }
  for (const item of folders) {
    const candidate = path.join(backupsDir, item.name, 'database_d1.sql');
    if (fs.existsSync(candidate) && fs.statSync(candidate).size > 1000) {
      sqlPath = candidate;
      break;
    }
  }
  if (!sqlPath) {
    console.error('Khong tim thay file database_d1.sql hop le trong cac thu muc backup!');
    process.exit(1);
  }
}

if (!fs.existsSync(sqlPath)) {
  console.error(`Khong tim thay file SQL: ${sqlPath}`);
  process.exit(1);
}

console.log(`Target Database : ${targetDb}`);
console.log(`Source SQL File : ${sqlPath}`);
const stat = fs.statSync(sqlPath);
console.log(`File Size       : ${(stat.size / (1024 * 1024)).toFixed(2)} MB`);

console.log('\n1. Dang doc va phan tich file SQL...');
const sqlContent = fs.readFileSync(sqlPath, 'utf-8');

// Tach cac cau lenh SQL theo dau ; ket thuc dong
const rawStatements = sqlContent.split(/;\s*[\r\n]+/);
const statements = rawStatements.map(s => s.trim()).filter(s => s.length > 0 && !s.startsWith('--'));

console.log(`   -> Tim thay tong cong ${statements.length} cau lenh SQL.`);

// Chia batch de tranh vuot nguong Cloudflare D1 payload
const BATCH_SIZE = 50;
const totalBatches = Math.ceil(statements.length / BATCH_SIZE);
console.log(`2. Dang phuc hoi vao D1 Remote theo ${totalBatches} batch (moi batch toi da ${BATCH_SIZE} cau lenh)...`);

const tempDir = path.resolve('.temp_restore');
fs.mkdirSync(tempDir, { recursive: true });
const tempSqlFile = path.join(tempDir, 'chunk.sql');

for (let b = 0; b < totalBatches; b++) {
  const chunk = statements.slice(b * BATCH_SIZE, (b + 1) * BATCH_SIZE);
  const chunkContent = 'PRAGMA foreign_keys = OFF;\n' + chunk.join(';\n') + ';\n';
  fs.writeFileSync(tempSqlFile, chunkContent, 'utf-8');

  process.stdout.write(`   [Batch ${b + 1}/${totalBatches}] Dang thuc thi ${chunk.length} cau lenh... `);
  try {
    const cmd = `npx wrangler d1 execute "${targetDb}" --remote --file="${tempSqlFile}" -y`;
    execSync(cmd, { stdio: ['pipe', 'pipe', 'pipe'] });
    console.log('OK');
  } catch (err) {
    console.error(`\n[LOI o Batch ${b + 1}]:`, err.message);
    if (fs.existsSync(tempSqlFile)) fs.unlinkSync(tempSqlFile);
    process.exit(1);
  }
}

if (fs.existsSync(tempSqlFile)) fs.unlinkSync(tempSqlFile);
try { fs.rmdirSync(tempDir); } catch (_) {}

console.log('\n=== PHUC HOI DU LIEU HOAN TAT 100%! ===');
console.log(`Da phuc hoi thanh cong ${statements.length} cau lenh vao database [${targetDb}].`);
