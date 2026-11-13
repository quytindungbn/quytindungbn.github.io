import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const view = readFileSync(new URL('../js/views/admin/zaloOA.js', import.meta.url), 'utf8');
const css = readFileSync(new URL('../css/styles.css', import.meta.url), 'utf8');
const rowFn = view.slice(view.indexOf('function logRowHtml'), view.indexOf('function drawLogTab'));
const tabFn = view.slice(view.indexOf('function drawLogTab'), view.indexOf('function drawConfigTab'));

test('Lịch sử gửi: dòng có hợp đồng hoặc khách thì bấm / Enter được và có nhãn trợ năng', () => {
  assert.ok(rowFn.includes('is-link'));
  assert.ok(rowFn.includes('data-contract='));
  assert.ok(rowFn.includes('data-customer='));
  assert.ok(rowFn.includes('role="button" tabindex="0"'));
  assert.ok(rowFn.includes('Xem chi tiết hợp đồng'));
  assert.ok(rowFn.includes('!contract && !customer'));
});

test('Lịch sử gửi: bấm dòng mở chi tiết hợp đồng; không còn hợp đồng thì mở hồ sơ khách; không còn gì thì báo', () => {
  assert.ok(tabFn.includes("closest('.lg-row.is-link')"));
  assert.ok(tabFn.includes('openContractView(row.dataset.customer, contract, { readOnly: true })'));
  assert.ok(tabFn.includes('openCustomerDetail(row.dataset.customer'));
  assert.ok(tabFn.includes('Không tìm thấy hợp đồng này'));
  assert.ok(tabFn.includes("e.key === 'Enter' || e.key === ' '"));
  assert.ok(tabFn.includes('window.getSelection'));
});

test('Lịch sử gửi: gắn sự kiện bấm một lần cho cả danh sách, không gắn lại mỗi lần vẽ', () => {
  const bind = tabFn.indexOf("logListEl.addEventListener('click'");
  assert.ok(bind > 0 && bind < tabFn.indexOf('function drawList'));
  assert.equal(tabFn.split("addEventListener('click', (e) => {\n    const row = e.target.closest('.lg-row.is-link')").length, 2);
});

test('Lịch sử gửi: dòng bấm được chỉ đổi màu nền khi rê chuột, không có khung viền khi bấm và không đổi bố cục', () => {
  const rules = [...css.matchAll(/\.lg-row\.is-link[^{]*\{[^}]*\}/g)].map((m) => m[0]);
  assert.equal(rules.length, 3);
  assert.match(css, /\.lg-row\.is-link \{ cursor: pointer; outline: none;/);
  assert.match(css, /@media \(hover: hover\) \{\s*\.lg-row\.is-link:hover \{[^}]*background: #eef6f2/);
  assert.match(css, /\.lg-row\.is-link:focus-visible \{[^}]*background: #eef6f2/);
  for (const rule of rules) assert.ok(!/outline:\s*(?!none)\S/.test(rule) && !/border:|text-decoration|:active/.test(rule), rule);
  assert.ok(!rules.some((rule) => /(padding|margin|display|width|height)\s*:/.test(rule)));
});
