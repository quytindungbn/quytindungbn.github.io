import test from 'node:test';
import assert from 'node:assert/strict';
import { crc32 } from '../js/lib/xlsxWrite.js';
import { zipStore, buildXlsx } from '../js/lib/xlsxWrite.js';
import zlib from 'node:zlib';

const readZip = (bytes) => {
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const entries = {};
  let eocd = bytes.length - 22;
  assert.equal(dv.getUint32(eocd, true), 0x06054b50, 'có bản ghi kết thúc ZIP');
  const count = dv.getUint16(eocd + 10, true);
  let p = dv.getUint32(eocd + 16, true);
  for (let i = 0; i < count; i++) {
    assert.equal(dv.getUint32(p, true), 0x02014b50);
    const crc = dv.getUint32(p + 16, true), size = dv.getUint32(p + 24, true);
    const nameLen = dv.getUint16(p + 28, true), extra = dv.getUint16(p + 30, true), comment = dv.getUint16(p + 32, true);
    const local = dv.getUint32(p + 42, true);
    const name = new TextDecoder().decode(bytes.subarray(p + 46, p + 46 + nameLen));
    assert.equal(dv.getUint32(local, true), 0x04034b50);
    const lnLen = dv.getUint16(local + 26, true), lxLen = dv.getUint16(local + 28, true);
    const data = bytes.subarray(local + 30 + lnLen + lxLen, local + 30 + lnLen + lxLen + size);
    entries[name] = { data, crc };
    p += 46 + nameLen + extra + comment;
  }
  return entries;
};

test('crc32 khớp thư viện chuẩn của node', () => {
  const data = new TextEncoder().encode('Tính lãi vay 365 ngày — 200.000.000 ₫');
  assert.equal(crc32(data), zlib.crc32(data));
  assert.equal(crc32(new Uint8Array(0)), 0);
});

test('zipStore: đọc lại đúng tên, nội dung và CRC từng tệp', () => {
  const zip = zipStore([{ name: 'a.txt', data: 'xin chào' }, { name: 'thu-muc/b.bin', data: new Uint8Array([1, 2, 3, 250]) }]);
  const e = readZip(zip);
  assert.deepEqual(Object.keys(e), ['a.txt', 'thu-muc/b.bin']);
  assert.equal(new TextDecoder().decode(e['a.txt'].data), 'xin chào');
  assert.deepEqual([...e['thu-muc/b.bin'].data], [1, 2, 3, 250]);
  for (const f of Object.values(e)) assert.equal(crc32(f.data), f.crc);
});

test('buildXlsx: đủ các phần của một sổ Excel, số là số và chữ có dấu/ký tự đặc biệt được thoát đúng', () => {
  const x = buildXlsx({ sheetName: 'Tính lãi & vay', widths: [10, 20], rows: [
    [{ v: 'Tiêu đề <A>', style: 'title' }],
    ['Kỳ', { v: 18423000, style: 'int' }, { v: 10.34, style: 'decimal' }, null, { v: 'Cộng', style: 'labelTotal' }],
  ] });
  const e = readZip(x);
  for (const n of ['[Content_Types].xml', '_rels/.rels', 'xl/workbook.xml', 'xl/_rels/workbook.xml.rels', 'xl/styles.xml', 'xl/worksheets/sheet1.xml']) assert.ok(e[n], n);
  const sheet = new TextDecoder().decode(e['xl/worksheets/sheet1.xml'].data);
  assert.ok(sheet.includes('Tiêu đề &lt;A&gt;'));
  assert.ok(sheet.includes('<c r="B2" s="4"><v>18423000</v></c>'));
  assert.ok(sheet.includes('<c r="C2" s="8"><v>10.34</v></c>'));
  assert.ok(sheet.includes('<c r="E2" s="6" t="inlineStr">'));
  assert.ok(!sheet.includes('r="D2"'), 'ô trống không ghi');
  assert.ok(sheet.includes('<col min="2" max="2" width="20" customWidth="1"/>'));
  assert.ok(new TextDecoder().decode(e['xl/workbook.xml'].data).includes('name="Tính lãi &amp; vay"'));
});
