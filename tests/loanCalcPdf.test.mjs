import test from 'node:test';
import assert from 'node:assert/strict';
import { planPages, buildPdf, GEO, COLS_MM } from '../js/lib/loanCalcPdf.js';

test('bảng 12 kỳ vừa một trang (có cả dòng Cộng và ghi chú)', () => {
  const p = planPages(12);
  assert.equal(p.length, 1);
  assert.deepEqual({ from: p[0].from, to: p[0].to, first: p[0].first, last: p[0].last }, { from: 0, to: 12, first: true, last: true });
});

test('nhiều kỳ: các trang liền nhau, đủ mọi dòng, không dòng nào bị mất hay trùng', () => {
  for (const n of [1, 13, 14, 15, 16, 30, 44, 45, 60, 100, 120, 361, 600]) {
    const plans = planPages(n);
    assert.equal(plans[0].from, 0, `n=${n}`);
    assert.equal(plans[plans.length - 1].to, n, `n=${n}`);
    plans.forEach((p, i) => {
      assert.equal(p.index, i);
      assert.equal(p.first, i === 0);
      assert.equal(p.last, i === plans.length - 1);
      if (i > 0) assert.equal(p.from, plans[i - 1].to, `n=${n} trang ${i}`);
    });
  }
});

test('mỗi trang không vượt quá chiều cao cho phép, dòng Cộng + ghi chú luôn có chỗ ở trang cuối', () => {
  for (const n of [1, 12, 13, 14, 15, 16, 17, 28, 29, 30, 31, 42, 43, 44, 45, 46, 60, 120, 600]) {
    const plans = planPages(n);
    for (const p of plans) {
      const top = p.first ? GEO.firstTableTop : 12;
      const tail = p.last ? GEO.totalH + GEO.noteGap + GEO.noteH : 0;
      const bottom = top + GEO.headH + (p.to - p.from) * GEO.rowH + tail;
      assert.ok(bottom <= 196 + 1e-9, `n=${n} trang ${p.index + 1}: ${bottom}`);
    }
  }
});

test('cột bảng cộng đúng bề ngang vùng in (269 mm)', () => {
  assert.equal(COLS_MM.reduce((s, w) => s + w, 0), 269);
});

test('buildPdf: tệp PDF hợp lệ — đầu/cuối tệp, bảng xref trỏ đúng từng đối tượng, mỗi trang là một ảnh JPEG khổ A4 ngang', () => {
  const jpeg = (n) => new Uint8Array([0xff, 0xd8, ...Array.from({ length: n }, (_, i) => i % 251), 0xff, 0xd9]);
  const pages = [{ jpeg: jpeg(50), width: 1000, height: 707 }, { jpeg: jpeg(80), width: 1000, height: 707 }];
  const pdf = buildPdf(pages, { title: 'Bảng tính lãi vay' });
  const latin = new TextDecoder('latin1').decode(pdf);
  assert.ok(latin.startsWith('%PDF-1.4'));
  assert.ok(latin.trimEnd().endsWith('%%EOF'));
  assert.match(latin, /\/Count 2 \/Kids \[4 0 R 7 0 R\]/);
  assert.match(latin, /\/MediaBox \[0 0 841\.89 595\.28\]/);
  assert.equal((latin.match(/\/Filter \/DCTDecode/g) || []).length, 2);
  const startxref = Number(/startxref\n(\d+)\n%%EOF/.exec(latin)[1]);
  assert.equal(latin.slice(startxref, startxref + 4), 'xref');
  const total = 3 + pages.length * 3;
  const entries = latin.slice(startxref).split('\n').slice(3, 3 + total);
  assert.equal(entries.length, total);
  entries.forEach((line, k) => {
    const off = Number(line.slice(0, 10));
    assert.equal(latin.slice(off, off + `${k + 1} 0 obj`.length), `${k + 1} 0 obj`, `đối tượng ${k + 1}`);
  });
  // Độ dài luồng ảnh khai báo khớp byte thật, nội dung JPEG nguyên vẹn
  const m = /\/Length (\d+) >>\nstream\n/.exec(latin.slice(latin.indexOf('/Subtype /Image')));
  assert.equal(Number(m[1]), pages[0].jpeg.length);
  const at = latin.indexOf('stream\n', latin.indexOf('/Subtype /Image')) + 7;
  assert.deepEqual([...pdf.subarray(at, at + pages[0].jpeg.length)], [...pages[0].jpeg]);
  assert.match(latin, /\/Title <FEFF[0-9a-f]+>/, 'tên tệp tiếng Việt ghi dạng UTF-16');
});
