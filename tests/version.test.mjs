import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { listFiles, contentHash, nextVersion } from '../tools/stamp-version.mjs';

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

test('số phiên bản dạng MAJOR.MINOR.BẢN-DỰNG, hai số đầu khớp package.json', () => {
  const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
  assert.match(info.v, /^\d+\.\d+\.\d+$/);
  assert.equal(info.v.split('.').slice(0, 2).join('.'), pkg.version.split('.').slice(0, 2).join('.'));
});

test('nextVersion: nội dung không đổi thì giữ số, đổi thì +1, đổi số lớn/nhỏ hoặc bản cũ kiểu ngày giờ thì về .1', () => {
  assert.equal(nextVersion('1.0', { v: '1.0.7', h: 'a' }, 'a'), '1.0.7');
  assert.equal(nextVersion('1.0', { v: '1.0.7', h: 'a' }, 'b'), '1.0.8');
  assert.equal(nextVersion('1.1', { v: '1.0.7', h: 'a' }, 'b'), '1.1.1');
  assert.equal(nextVersion('1.0', { v: '2026-10-28 22:12:24', h: 'a' }, 'b'), '1.0.1');
  assert.equal(nextVersion('1.0', null, 'b'), '1.0.1');
});
