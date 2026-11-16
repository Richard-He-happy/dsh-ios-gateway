// Validate repository manifests:
//   - no UTF-8 BOM in any tracked text file
//   - valid JSON for .json / .webmanifest
// Run: node scripts/check-manifests.cjs
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const invalid = [];
let checked = 0;
const skipDirs = new Set(['node_modules', '.git', 'docs']);
const textExt = /\.(json|jsonc|webmanifest|md|ya?ml|js|cjs|mjs|cmd|vbs|ps1|css|html|txt|gitignore|editorconfig|gitattributes)$/i;

function walk(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (skipDirs.has(entry.name)) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      walk(full);
      continue;
    }
    if (!textExt.test(entry.name)) continue;
    checked += 1;
    const rel = path.relative(root, full);
    const bytes = fs.readFileSync(full);
    const hasBom = bytes.length >= 3 && bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf;
    if (hasBom) invalid.push(`${rel}: UTF-8 BOM`);
    if (/\.(json|jsonc|webmanifest)$/i.test(entry.name)) {
      try {
        JSON.parse(bytes.toString('utf8').replace(/^\uFEFF/, ''));
      } catch (error) {
        invalid.push(`${rel}: ${error.message}`);
      }
    }
  }
}

walk(root);
if (invalid.length > 0) {
  console.error('Manifest validation failed:');
  for (const line of invalid) console.error(' - ' + line);
  process.exit(1);
}
console.log(`Manifest validation passed (${checked} text files, no BOM; JSON valid).`);
