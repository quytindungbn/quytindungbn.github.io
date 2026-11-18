import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const view = readFileSync(new URL('../js/views/admin/balanceSheet.js', import.meta.url), 'utf8');
const chart = view.slice(view.indexOf('function profitSvg'), view.indexOf('function profitSection'));
const section = view.slice(view.indexOf('function profitSection'), view.indexOf('let trendScrollLeft'));
const FRAME = 'fill="#b08d3c" opacity=".1"';

test('Lợi nhuận: chọn một tháng chỉ tô khung tháng đó, cột luôn đúng màu của nó (dương xanh, âm đỏ)', () => {
  assert.equal(chart.split(FRAME).length - 1, 1);
  assert.match(chart, /rx="2" fill="\$\{loss \? '#b4372d' : '#4f9d86'\}"/);
  assert.ok(!/i === selected \?/.test(chart));
});

test('Lợi nhuận: số trên cột, chấm và số trên đường lũy kế giữ màu thường, không phụ thuộc tháng đang chọn', () => {
  assert.ok(chart.includes("trieu(monthly[i]), loss ? '#b4372d' : '#0c4a3f')"));
  assert.ok(chart.includes('r="${mobile ? 3.5 : 5}" fill="#0c4a3f"'));
  assert.ok(chart.includes("trieu(cumulative[i]), '#0c4a3f')"));
  assert.ok(!chart.includes('#8a6a22'));
  assert.ok(!chart.replace(FRAME, '').includes('#b08d3c'));
});

test('Lợi nhuận: câu chú thích nói khung tháng đang chọn tô vàng', () => {
  assert.ok(section.includes('Khung tháng đang chọn tô vàng. Bấm vào một tháng để xem số liệu tháng đó.'));
});
