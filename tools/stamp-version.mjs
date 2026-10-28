import { readFileSync, writeFileSync, readdirSync, statSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join, relative } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = join(fileURLToPath(import.meta.url), '..', '..');
const VERSION_JS = 'js/version.js';

function walk(dir, out = []) {
  for (const name of readdirSync(dir).sort()) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out); else out.push(relative(ROOT, p).split('\\').join('/'));
  }
  return out;
}

export function listFiles() {
  return ['index.html', 'css/styles.css', ...walk(join(ROOT, 'js'))].sort();
}

export function contentHash() {
  const h = createHash('sha1');
  for (const f of listFiles()) if (f !== VERSION_JS) h.update(f + '\0').update(readFileSync(join(ROOT, f))).update('\0');
  return h.digest('hex').slice(0, 12);
}

export function stamp(now = new Date()) {
  const v = now.toLocaleString('sv-SE', { timeZone: 'Asia/Ho_Chi_Minh' });
  writeFileSync(join(ROOT, VERSION_JS), `export const APP_VERSION = '${v}';\n`);
  writeFileSync(join(ROOT, 'version.json'), JSON.stringify({ v, h: contentHash(), files: listFiles() }, null, 1) + '\n');
  return v;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) console.log('Đã đóng dấu phiên bản', stamp());
