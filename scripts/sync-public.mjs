import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const root = path.resolve(__dirname, '..');
const pub = path.join(root, '.local-public');

console.log('=== SYNC ASSETS -> .local-public ===');

// Ensure destination folder exists
if (!fs.existsSync(pub)) {
  fs.mkdirSync(pub, { recursive: true });
}

// 1. Copy directories (src, styles)
const dirsToCopy = ['src', 'styles'];
for (const dirName of dirsToCopy) {
  const srcDir = path.join(root, dirName);
  const destDir = path.join(pub, dirName);
  if (fs.existsSync(srcDir)) {
    fs.cpSync(srcDir, destDir, { recursive: true, force: true });
    console.log(`  -> Copied directory: ${dirName}/`);
  } else {
    console.warn(`  [WARN] Source directory not found: ${dirName}`);
  }
}

// 2. Copy root asset files
const filesToCopy = [
  'index.html',
  'favicon.png',
  'manifest.webmanifest',
  'sw.js',
  'icon-192.png',
  'icon-512.png',
  'apple-touch-icon.png',
];

for (const fileName of filesToCopy) {
  const srcFile = path.join(root, fileName);
  const destFile = path.join(pub, fileName);
  if (fs.existsSync(srcFile)) {
    fs.copyFileSync(srcFile, destFile);
    console.log(`  -> Copied file: ${fileName}`);
  } else {
    console.warn(`  [WARN] File not found: ${fileName}`);
  }
}

const fileCount = countFiles(pub);
console.log(`=== SYNC COMPLETE: ${fileCount} files in .local-public ===\n`);

function countFiles(dir) {
  let count = 0;
  if (!fs.existsSync(dir)) return 0;
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    if (entry.isDirectory()) {
      count += countFiles(path.join(dir, entry.name));
    } else {
      count++;
    }
  }
  return count;
}
