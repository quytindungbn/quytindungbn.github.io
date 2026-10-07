import test from 'node:test';
import assert from 'node:assert/strict';
import { formatTrieuDong, monthlyTrendLineChartSvg } from '../js/components/charts.js';

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

test('nhãn nợ xấu hiển thị triệu đồng và làm tròn như số tiền thực', () => {
  assert.equal(formatTrieuDong(387_977_597), '388tr');
  const html = monthlyTrendLineChartSvg({
    months: [{ yearMonth: '2026-09', balance: 44_756_443_000, badDebt: 387_977_597 }],
  });
  assert.equal((html.match(/>388tr<\/text>/g) || []).length, 2);
  assert.match(html, /Dư nợ: tỷ đồng · Nợ xấu: triệu đồng/);
  assert.match(html, /44,76/);
});
