import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { moneyChange } from '../js/lib/moneyChange.js';

const brief = (c) => ({ tone: c.tone, sign: c.sign, num: c.num, unit: c.unit });

test('dư nợ tăng: dấu +, số tiền rút gọn và phần trăm so với tháng trước', () => {
  const c = moneyChange(5.555e9, 5.5e9);
  assert.deepEqual(brief(c), { tone: 'up', sign: '+', num: '55', unit: 'triệu đ' });
  assert.equal(c.percent.toFixed(1), '1.0');
  assert.equal(c.diff, 55e6);
});

test('dư nợ giảm: dấu − (trừ thật, không phải gạch nối), số tiền luôn dương', () => {
  const c = moneyChange(5.362e9, 5.41e9);
  assert.deepEqual(brief(c), { tone: 'down', sign: '−', num: '48', unit: 'triệu đ' });
  assert.equal(c.percent.toFixed(1), '0.9');
  assert.equal(c.diff, -48e6);
});

test('không đổi: không dấu, không phần trăm hiển thị khác 0', () => {
  const c = moneyChange(5.02e9, 5.02e9);
  assert.deepEqual(brief(c), { tone: 'flat', sign: '', num: '0', unit: 'đ' });
  assert.equal(c.percent, 0);
});

test('đơn vị rút gọn theo độ lớn: tỷ, triệu, đồng', () => {
  assert.deepEqual(brief(moneyChange(7.25e9, 6e9)), { tone: 'up', sign: '+', num: '1,25', unit: 'tỷ đ' });
  assert.deepEqual(brief(moneyChange(1_000_000, 1_850_000)), { tone: 'down', sign: '−', num: '850.000', unit: 'đ' });
});

test('chưa có số tháng trước thì không tính; tháng trước bằng 0 thì có số tiền nhưng không có phần trăm', () => {
  assert.equal(moneyChange(5e9, null), null);
  assert.equal(moneyChange(5e9, undefined), null);
  assert.equal(moneyChange(5e9, 'abc'), null);
  const c = moneyChange(5e9, 0);
  assert.equal(c.tone, 'up');
  assert.equal(c.percent, null);
});

test('Tổng quan: dư nợ không đổi thì ẩn nhãn thay đổi, không hiện chữ "Không đổi"', () => {
  const src = readFileSync(new URL('../js/views/admin/overview.js', import.meta.url), 'utf8');
  const hero = src.slice(src.indexOf('function heroChangeHtml'), src.indexOf('function heroInnerHtml'));
  assert.ok(hero.includes("if (!change || change.tone === 'flat') return '';"));
  assert.ok(!hero.includes('Không đổi'));
});
