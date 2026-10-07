import test from 'node:test';
import assert from 'node:assert/strict';
import { monthlyTrendLineChartSvg } from '../js/components/charts.js';

test('biểu đồ đường giữ đủ lịch sử, mỗi khung thấy 12 hoặc 6 tháng và hiện số tỷ đồng', () => {
  const months = Array.from({ length: 18 }, (_, i) => ({
    yearMonth: `${2025 + Math.floor(i / 12)}-${String(i % 12 + 1).padStart(2, '0')}`,
    balance: 40_000_000_000 + i * 1_000_000_000,
    badDebt: 800_000_000 + i * 10_000_000,
  }));
  const html = monthlyTrendLineChartSvg({ months, selectedYm: months.at(-1).yearMonth });
  assert.match(html, /monthly-trend-desktop/);
  assert.match(html, /monthly-trend-mobile/);
  assert.equal((html.match(/data-month="/g) || []).length, 36);
  assert.match(html, /<polyline/);
  assert.doesNotMatch(html, /<rect[^>]+height="[\d.]+"[^>]+fill="var\(--color-primary\)"/);
  assert.match(html, />40</);
  assert.match(html, /Nợ xấu \(trục riêng\)/);
  assert.match(html, /width:1[0-9]{2}\.[0-9]+%/);
  assert.match(html, /width:2[0-9]{2}\.[0-9]+%/);
});
