import test from 'node:test';
import assert from 'node:assert/strict';
import { compactParts, formatCompact } from '../js/utils.js';

test('số tiền rút gọn: bỏ ",00" khi tròn, tối đa 2 số lẻ, có đơn vị đ', () => {
  const show = (v) => { const { num, unit } = compactParts(v); return `${num} ${unit}`; };
  assert.equal(show(429_000_000), '429 triệu đ');
  assert.equal(show(429_500_000), '429,5 triệu đ');
  assert.equal(show(236_480_000), '236,48 triệu đ');
  assert.equal(show(95_610_000_000), '95,61 tỷ đ');
  assert.equal(show(48_000_000_000), '48 tỷ đ');
  assert.equal(show(999_999_999), '1 tỷ đ');
  assert.equal(show(950_000), '950.000 đ');
  assert.equal(show(0), '0 đ');
  assert.equal(show(-350_000_000), '-350 triệu đ');
});

test('formatCompact (nhãn biểu đồ): có "đ" từ 1 triệu trở lên, dưới đó giữ số đầy đủ', () => {
  assert.equal(formatCompact(429_000_000), '429 triệu đ');
  assert.equal(formatCompact(70_500_000_000), '70,5 tỷ đ');
  assert.equal(formatCompact(0), '0');
});
