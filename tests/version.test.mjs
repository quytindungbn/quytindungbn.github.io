import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { listFiles, contentHash } from '../tools/stamp-version.mjs';

const info = JSON.parse(readFileSync(new URL('../version.json', import.meta.url), 'utf8'));

test('version.json khớp mã nguồn hiện tại (nếu lỗi: chạy npm run stamp)', () => {
  assert.equal(info.h, contentHash());
});

test('js/version.js trùng với version.json', () => {
  const js = readFileSync(new URL('../js/version.js', import.meta.url), 'utf8');
  assert.equal(js.trim(), `export const APP_VERSION = '${info.v}';`);
});

test('danh sách tệp trong version.json đầy đủ và tệp nào cũng tồn tại', () => {
  assert.deepEqual(info.files, listFiles());
  for (const f of info.files) assert.ok(existsSync(new URL('../' + f, import.meta.url)), f);
});
