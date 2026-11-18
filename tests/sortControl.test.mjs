import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const view = readFileSync(new URL('../js/views/admin/customers.js', import.meta.url), 'utf8');
const css = readFileSync(new URL('../css/styles.css', import.meta.url), 'utf8');
const icons = readFileSync(new URL('../js/icons.js', import.meta.url), 'utf8');
const control = view.slice(view.indexOf('const SORT_FIELDS'), view.indexOf('const COLLATERAL_NAMES'));
const rule = (selector) => (css.match(new RegExp(`(?:^|\\n)${selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')} \\{([^}]*)\\}`)) || [])[1] || '';

test('Sắp xếp: khung chọn có Mặc định + hai hàng Gốc, Lãi, mỗi hàng hai nút đúng giá trị sắp xếp', () => {
  for (const v of ['principal-asc', 'principal-desc', 'interest-asc', 'interest-desc']) assert.ok(control.includes(`'${v}'`), v);
  assert.ok(control.includes('data-sort="default"'));
  assert.ok(control.includes("'Thấp → Cao', 'sortAsc'") && control.includes("'Cao → Thấp', 'sortDesc'"));
  assert.ok(control.includes('aria-pressed=') && control.includes('role="group"'));
  for (const name of ['sortAsc', 'sortDesc', 'percent']) assert.ok(icons.includes(`  ${name}: '`), name);
});

test('Sắp xếp: máy tính và điện thoại dùng chung một khung chọn và một hàm áp dụng; điện thoại không còn danh sách chữ', () => {
  assert.equal(view.split('sortControlHtml(sortMode)').length - 1, 4);
  assert.equal(view.split('applySort(').length - 1, 3);
  assert.ok(view.includes('function openSortSheet()') && view.includes('setTimeout(closeSheet, 160)'));
  assert.ok(view.includes('matchMedia(\'(max-width: 899px)\').matches) openSortSheet(); else openSortDialog();'));
  assert.ok(!/openPicker\(\{\s*title: 'Sắp xếp theo'/.test(view));
  assert.ok(view.includes("S.logAdminAction('filter-customers', { filterDesc: `Sắp xếp: **${SORT_LABEL[sortMode]}**` })"));
});

test('Sắp xếp: nhãn trên thanh lọc và trong Nhật ký vẫn lấy từ SORT_OPTIONS (không đổi chữ)', () => {
  for (const label of ['Gốc: Thấp → Cao', 'Gốc: Cao → Thấp', 'Lãi: Thấp → Cao', 'Lãi: Cao → Thấp']) assert.ok(view.includes(`label: '${label}'`), label);
  assert.ok(view.includes('const SORT_LABEL = Object.fromEntries(SORT_OPTIONS.map'));
});

test('Sắp xếp: khi chưa chọn mỗi nút là nút trắng có viền riêng (không còn thanh nền chung); khi chọn tô xanh đậm', () => {
  const seg = rule('.sortdlg-seg');
  assert.match(seg, /border: 1px solid #c9dcd2/);
  assert.match(seg, /background: #fff/);
  assert.match(seg, /box-shadow: 0 1px 2px/);
  const segs = rule('.sortdlg-segs');
  assert.match(segs, /gap: 8px/);
  assert.ok(!/background|padding|border/.test(segs), segs);
  assert.match(rule('.sortdlg-row'), /background: #f6faf8/);
  assert.ok(css.includes('.sortdlg-seg.is-on, .sortdlg-def.is-on {'));
  assert.ok(css.includes('background: linear-gradient(180deg, #14806f 0%, #0c4a3f 100%)'));
  assert.match(css, /\.sortdlg-seg\.is-on svg \{ color: #f3e1ac; \}/);
  assert.ok(!css.includes('.sortdlg-opt '));
});
