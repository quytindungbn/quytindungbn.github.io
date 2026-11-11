import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { translateZaloError } from '../js/lib/zaloErrors.js';

test('lỗi Zalo "OA does not have permission to use this feature" được dịch sang tiếng Việt', () => {
  assert.equal(translateZaloError('OA does not have permission to use this feature'), 'OA không có quyền sử dụng tính năng này');
  assert.equal(translateZaloError('  oa DOES not have   permission to use this feature.'), 'OA không có quyền sử dụng tính năng này');
  assert.equal(translateZaloError('{"error":-1,"message":"OA does not have permission to use this feature"}'), 'OA không có quyền sử dụng tính năng này');
});

test('lỗi "account not exist" vẫn dịch như cũ', () => {
  assert.equal(translateZaloError('Account not exist'), 'Số điện thoại này chưa đăng ký Zalo');
});

test('thông báo khác hoặc rỗng giữ nguyên, không làm hỏng', () => {
  assert.equal(translateZaloError('Access token invalid'), 'Access token invalid');
  assert.equal(translateZaloError('Chưa chọn mẫu tin Zalo'), 'Chưa chọn mẫu tin Zalo');
  assert.equal(translateZaloError(''), '');
  assert.equal(translateZaloError(null), null);
  assert.equal(translateZaloError(undefined), undefined);
});

test('lịch sử gửi và gửi tay đều đi qua bản dịch lỗi Zalo', () => {
  const src = readFileSync(new URL('../js/state.js', import.meta.url), 'utf8');
  assert.ok(src.includes("import { translateZaloError } from './lib/zaloErrors.js';"));
  const mapper = src.slice(src.indexOf('function mapZaloSendLogRow'), src.indexOf('function mapAdminRow'));
  assert.ok(mapper.includes('translateZaloError(row.error_message)'));
  const manual = src.slice(src.indexOf('export async function sendZaloManual'), src.indexOf('export async function deleteCustomer'));
  assert.ok(manual.includes('translateZaloError(res.reason)'));
});
