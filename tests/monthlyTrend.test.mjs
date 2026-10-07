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
  assert.match(html, /Dư nợ: tỷ đồng \(trục rút gọn\) · Nợ xấu: triệu đồng \(trục từ 0\)/);
  assert.match(html, /44,76/);
});

test('dư nợ vẫn thấy rõ biến động nhỏ, nợ xấu giữ đúng tỷ lệ với mốc 0', () => {
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
  assert.ok(verticalChange(lines[1]) < 10, 'nợ xấu tăng nhẹ không được phóng đại');
  assert.match(html, /Nợ xấu: triệu đồng \(trục từ 0\)/);
});

test('nợ xấu giảm mạnh hoặc về 0 dốc hơn giảm nhẹ và luôn nằm trong khung', () => {
  const drop = (lastBadDebt) => {
    const html = monthlyTrendLineChartSvg({ months: [
      { yearMonth: '2026-08', balance: 44_000_000_000, badDebt: 500_000_000 },
      { yearMonth: '2026-09', balance: 44_000_000_000, badDebt: lastBadDebt },
    ] });
    // Mỗi khung có đường dư nợ trước, sau đó là đường nợ xấu.
    return [...html.matchAll(/<polyline[^>]*points="([^"]+)"/g)]
      .filter((_, i) => i % 2 === 1)
      .map((line) => line[1].split(' ').map((point) => Number(point.split(',')[1])));
  };
  const slight = drop(429_000_000);
  const steep = drop(100_000_000);
  const cleared = drop(0);
  for (let i = 0; i < 2; i++) {
    const [top, bottom] = i === 0 ? [147, 220] : [125, 185];
    const change = (points) => Math.abs(points[1] - points[0]);
    assert.ok(change(slight[i]) < change(steep[i]) / 4);
    assert.ok(change(steep[i]) < change(cleared[i]));
    for (const points of [slight[i], steep[i], cleared[i]]) {
      assert.ok(points.every((y) => y >= top && y <= bottom));
    }
    assert.equal(cleared[i][1], bottom, '0 phải nằm ở đáy khung nợ xấu');
  }
});
