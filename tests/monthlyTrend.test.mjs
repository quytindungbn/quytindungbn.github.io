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

test('mức tăng dư nợ 40 lên 44 tỷ và nợ xấu tăng nhẹ vẫn thấy rõ trên trục riêng', () => {
  const html = monthlyTrendLineChartSvg({ months: [
    { yearMonth: '2025-12', balance: 40_000_000_000, badDebt: 380_000_000 },
    { yearMonth: '2026-09', balance: 44_000_000_000, badDebt: 420_000_000 },
  ] });
  const lines = [...html.matchAll(/<polyline[^>]*points="([^"]+)"/g)];
  const verticalChange = (line) => {
    const points = line[1].split(' ').map((point) => Number(point.split(',')[1]));
    return Math.abs(points[1] - points[0]);
  };
  assert.ok(verticalChange(lines[0]) > 35, 'dư nợ phải thay đổi rõ trên desktop');
  assert.ok(verticalChange(lines[1]) > 35, 'nợ xấu phải thay đổi rõ trên desktop');
  assert.match(html, /Trục dọc rút gọn theo từng đường/);
});
