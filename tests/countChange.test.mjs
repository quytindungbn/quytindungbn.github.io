import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { countChange } from '../js/lib/countChange.js';

const overview = readFileSync(new URL('../js/views/admin/overview.js', import.meta.url), 'utf8');
const css = readFileSync(new URL('../css/styles.css', import.meta.url), 'utf8');
const trio = overview.slice(overview.indexOf('function trioChanges'), overview.indexOf('const ATTN_HINTS'));
const rule = (selector) => (css.match(new RegExp(`(?:^|\\n)${selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')} \\{([^}]*)\\}`)) || [])[1] || '';

test('Số lượng tăng: tam giác lên, màu tốt; giảm: tam giác xuống, màu xấu; chênh lệch luôn dương', () => {
  assert.deepEqual(countChange(216, 214), { dir: 'up', tone: 'good', diff: 2 });
  assert.deepEqual(countChange(209, 214), { dir: 'down', tone: 'bad', diff: 5 });
});

test('Không đổi: dir flat, tone flat, chênh lệch 0', () => {
  assert.deepEqual(countChange(214, 214), { dir: 'flat', tone: 'flat', diff: 0 });
});

test('Nợ xấu (worseWhenUp): tăng là xấu (đỏ), giảm là tốt (xanh)', () => {
  assert.deepEqual(countChange(1.5, 1.2, { worseWhenUp: true, decimals: 1 }), { dir: 'up', tone: 'bad', diff: 0.3 });
  assert.deepEqual(countChange(0, 1.5, { worseWhenUp: true, decimals: 1 }), { dir: 'down', tone: 'good', diff: 1.5 });
});

test('So theo số đang hiển thị: 0,04% và 0,03% cùng hiện "0,0%" nên coi là không đổi; 0,26 → 0,3 so với 0,24 → 0,2 là tăng 0,1', () => {
  assert.equal(countChange(0.04, 0.03, { worseWhenUp: true, decimals: 1 }).dir, 'flat');
  assert.deepEqual(countChange(0.26, 0.24, { worseWhenUp: true, decimals: 1 }), { dir: 'up', tone: 'bad', diff: 0.1 });
  assert.equal(countChange(0.30000000000000004, 0.3, { decimals: 1 }).dir, 'flat');
});

test('Thiếu số liệu tháng trước (hoặc số hiện tại) thì không so sánh: trả null, không phải "không đổi"', () => {
  for (const bad of [null, undefined, NaN, 'abc']) {
    assert.equal(countChange(5, bad), null);
    assert.equal(countChange(bad, 5), null);
  }
  assert.equal(countChange(0, 0).dir, 'flat');
});

test('Khung Tổng dư nợ: Khách hàng, Hợp đồng, Nợ xấu đều có tam giác so với tháng trước', () => {
  assert.ok(overview.includes("import { countChange } from '../../lib/countChange.js';"));
  assert.ok(overview.includes('<span class="lux-eyebrow">Khách hàng</span><b>${customers}${trioMarkHtml(trend.customers'));
  assert.ok(overview.includes('<span class="lux-eyebrow">Hợp đồng</span><b>${contractCount}${trioMarkHtml(trend.contracts'));
  assert.ok(overview.includes("${formatPercent(m.badDebtRatio || 0)}${trioMarkHtml(trend.bad"));
});

test('Quy tắc so sánh: Nợ xấu tăng là xấu theo đúng số %, số lượng chỉ so khi tháng trước có chi tiết hợp đồng, nhân viên ở tháng hiện tại không so (số liệu riêng so với số chốt toàn quỹ)', () => {
  assert.ok(trio.includes('countChange(m.badDebtRatio || 0, prev.badDebtRatio, { worseWhenUp: true, decimals: 1 })'));
  assert.ok(trio.includes('before.hasDetail && (useLive ? !ctx.live.isStaff : snap.hasDetail)'));
  assert.ok(trio.includes('if (!prev) return {};'));
  assert.ok(trio.includes('aria-label="${text}" title="${text}"'));
  assert.ok(trio.includes("'Không đổi'") && trio.includes("'Tăng'") && trio.includes("'Giảm'"));
});

test('Tam giác: xanh #0f7a5c / đỏ #b4372d giống ô thay đổi dư nợ, không đổi là gạch xám, không xuống dòng', () => {
  assert.match(rule('.lux-tm.good'), /color: #0f7a5c;/);
  assert.match(rule('.lux-tm.bad'), /color: #b4372d;/);
  assert.match(rule('.lux-tm.flat'), /background: #a3b0aa;/);
  assert.match(rule('.lux-tm.down'), /border-width: 11px 6px 0;/);
  assert.match(rule('.lux-trio b'), /white-space: nowrap;/);
  assert.match(rule('.lux-chg.up'), /color: #0f7a5c;/);
  assert.match(rule('.lux-chg.down'), /color: #b4372d;/);
});
