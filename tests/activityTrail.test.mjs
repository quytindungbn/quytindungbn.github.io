import test from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const jsDir = fileURLToPath(new URL('../js', import.meta.url));
const serverFile = fileURLToPath(new URL('../supabase/functions/create-account/index.ts', import.meta.url));

function jsFiles(dir) {
  return readdirSync(dir).flatMap((name) => {
    const full = join(dir, name);
    return statSync(full).isDirectory() ? jsFiles(full) : full.endsWith('.js') ? [full] : [];
  });
}

const sources = jsFiles(jsDir).map((file) => ({ file, src: readFileSync(file, 'utf8') }));
const viewSource = (name) => sources.find(({ file }) => file.endsWith(join('views', 'admin', name))).src;

test('mọi loại thao tác ghi Nhật ký đều đúng quy định của máy chủ (a-z, 0-9, gạch nối, tối đa 40 ký tự)', () => {
  const kinds = new Set();
  for (const { src } of sources) {
    for (const m of src.matchAll(/(?:logUiAction|oaLog)\(\s*'([^']+)'/g)) kinds.add(m[1]);
    for (const m of src.matchAll(/logUiActionLater\(\s*(?:'[^']*'|`[^`]*`)\s*,\s*'([^']+)'/g)) kinds.add(m[1]);
  }
  assert.ok(kinds.size >= 15, `chỉ tìm thấy ${kinds.size} loại`);
  for (const kind of kinds) assert.match(kind, /^[a-z0-9-]{1,40}$/, kind);
});

test('quy định loại thao tác phía máy chủ vẫn đúng như phía web đang dùng', () => {
  assert.ok(readFileSync(serverFile, 'utf8').includes('/^[a-z0-9-]{1,40}$/.test(kind)'));
});

test('Quản lý OA: mỗi chức năng đều có ghi Nhật ký (tab, tìm kiếm, lọc, mở cửa sổ, lịch sử gửi)', () => {
  const src = viewSource('zaloOA.js');
  for (const kind of ['oa-tab', 'oa-view', 'oa-open', 'oa-filter']) assert.ok(src.includes(`oaLog('${kind}'`), kind);
  assert.ok(src.includes('oaSearch('));
  for (const where of ["'Danh sách OA'", "'Gửi tự động'", "'Lịch sử gửi'", "'Thêm khách hàng vào OA'"]) assert.ok(src.includes(where), where);
  assert.ok(src.includes('S.logCall('));
});

test('lưu số liệu bảng cân đối (ghi thẳng vào cơ sở dữ liệu từ trình duyệt) có ghi Nhật ký', () => {
  const src = viewSource('balanceSheet.js');
  const upsert = src.indexOf(".from('balance_sheet_reports').upsert(");
  const log = src.indexOf("logUiAction('bs-import', `Quản trị: lưu số liệu");
  assert.ok(upsert > 0 && log > upsert);
});

test('chuyển từ Hợp đồng sang Hồ sơ khách (và ngược lại) vẫn ghi "xem" nhưng không ghi lặp khi lật qua lại', () => {
  const src = viewSource('customers.js');
  assert.ok(src.includes("logViewPage('view-customer', customerId, { customerId }, reopen)"));
  assert.ok(src.includes("logViewPage('view-contract', contract.id, { contractId: contract.id }, reopen)"));
  assert.ok(src.includes('if (reopen && Date.now() - (viewLoggedAt.get(key) || 0) < 600000) return;'));
  assert.ok(!src.includes("if (!reopen) S.logAdminAction('view-"));
});
