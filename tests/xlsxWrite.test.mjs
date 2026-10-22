import test from 'node:test';
import assert from 'node:assert/strict';
import { crc32 } from '../js/lib/xlsxWrite.js';
import { zipStore, buildXlsx, excelSerial } from '../js/lib/xlsxWrite.js';
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

const text = (e, name) => new TextDecoder().decode(e[name].data);

test('buildXlsx: đủ các phần của một sổ Excel, số là số và chữ có dấu/ký tự đặc biệt được thoát đúng', () => {
  const x = buildXlsx({ sheetName: 'Tính lãi & vay', widths: [10, 20], rows: [
    [{ v: 'Tiêu đề <A>', style: 'title' }],
    ['Kỳ', { v: 18423000, style: 'int' }, { v: 10.34, style: 'days' }, null, { v: 'Cộng', style: 'totalLabel' }],
  ] });
  const e = readZip(x);
  for (const n of ['[Content_Types].xml', '_rels/.rels', 'xl/workbook.xml', 'xl/_rels/workbook.xml.rels', 'xl/styles.xml', 'xl/worksheets/sheet1.xml']) assert.ok(e[n], n);
  const sheet = text(e, 'xl/worksheets/sheet1.xml');
  assert.ok(sheet.includes('Tiêu đề &lt;A&gt;'));
  assert.match(sheet, /<c r="B2" s="\d+"><v>18423000<\/v><\/c>/);
  assert.match(sheet, /<c r="C2" s="\d+"><v>10\.34<\/v><\/c>/);
  assert.match(sheet, /<c r="E2" s="\d+" t="inlineStr">/);
  assert.ok(!sheet.includes('r="D2"'), 'ô trống không ghi');
  assert.ok(sheet.includes('<col min="2" max="2" width="20" customWidth="1"/>'));
  assert.ok(text(e, 'xl/workbook.xml').includes('name="Tính lãi &amp; vay"'));
});

test('kiểu ô: mỗi tên kiểu ra một kiểu riêng trong styles.xml, kiểu dùng lại thì dùng chung, kiểu 0 luôn là mặc định', () => {
  const x = buildXlsx({ rows: [[{ v: 1, style: 'int' }, { v: 2, style: 'int' }, { v: 3, style: 'int:alt' }, { v: 'x', style: 'head' }, { v: 'y', style: 'khongCo' }, 'z']] });
  const e = readZip(x);
  const sheet = text(e, 'xl/worksheets/sheet1.xml');
  const styleOf = (ref) => Number(new RegExp(`<c r="${ref}"[^>]*? s="(\\d+)"`).exec(sheet)?.[1] ?? 0);
  assert.equal(styleOf('A1'), styleOf('B1'), 'cùng kiểu dùng chung');
  assert.notEqual(styleOf('A1'), styleOf('C1'), 'nền xen kẽ là kiểu khác');
  assert.equal(styleOf('E1'), 0, 'tên lạ rơi về kiểu mặc định');
  const styles = text(e, 'xl/styles.xml');
  const count = Number(/<cellXfs count="(\d+)"/.exec(styles)[1]);
  assert.equal((styles.match(/<xf numFmtId="\d+" fontId/g) || []).length, count + 1, 'số kiểu khớp (cộng 1 kiểu gốc cellStyleXfs)');
  assert.ok(styles.includes('numFmtId="3"'), 'số có dấu phân cách hàng nghìn');
  assert.ok(styles.includes('horizontal="right"'));
});

test('ngày: ghi thành số ngày của Excel với định dạng dd/mm/yyyy, không lệch múi giờ', () => {
  assert.equal(excelSerial(new Date(2026, 9, 22)), 46317);
  assert.equal(excelSerial(new Date(1900, 2, 1)), 61);
  const e = readZip(buildXlsx({ rows: [[{ d: new Date(2026, 9, 22), style: 'date' }]] }));
  assert.match(text(e, 'xl/worksheets/sheet1.xml'), /<c r="A1" s="\d+"><v>46317<\/v><\/c>/);
  assert.ok(text(e, 'xl/styles.xml').includes('formatCode="dd/mm/yyyy"'));
});

test('in ngang: A4 ngang, vừa chiều ngang, căn giữa, lặp dòng tiêu đề, chân trang có số trang, ô gộp và độ cao dòng', () => {
  const e = readZip(buildXlsx({
    sheetName: "Tính 'lãi'", widths: [10, 10], rows: [['a'], ['b']], rowHeights: { 2: 30 }, merges: ['A1:B1'],
    landscape: true, fitWidth: true, centerH: true, printTitleRows: [2, 2], footer: { left: 'Quỹ & Bạn', right: 'Lập ngày 22/10/2026' },
  }));
  const sheet = text(e, 'xl/worksheets/sheet1.xml');
  assert.ok(sheet.includes('<pageSetUpPr fitToPage="1"/>'));
  assert.ok(sheet.includes('orientation="landscape" fitToWidth="1" fitToHeight="0"'));
  assert.ok(sheet.includes('<printOptions horizontalCentered="1"/>'));
  assert.ok(sheet.includes('<mergeCells count="1"><mergeCell ref="A1:B1"/></mergeCells>'));
  assert.ok(sheet.includes('<row r="2" ht="30" customHeight="1">'));
  assert.ok(sheet.includes('<oddFooter>&amp;L&amp;8Quỹ &amp;&amp; Bạn&amp;C&amp;8Trang &amp;P / &amp;N&amp;R&amp;8Lập ngày 22/10/2026</oddFooter>'), 'dấu & trong chân trang được viết đôi');
  assert.ok(sheet.indexOf('</sheetData>') < sheet.indexOf('<mergeCells') && sheet.indexOf('<mergeCells') < sheet.indexOf('<printOptions') && sheet.indexOf('<pageSetup') < sheet.indexOf('<headerFooter'), 'đúng thứ tự phần tử theo chuẩn');
  assert.ok(text(e, 'xl/workbook.xml').includes(`<definedName name="_xlnm.Print_Titles" localSheetId="0">'Tính ''lãi'''!$2:$2</definedName>`), 'dòng lặp ở đầu mỗi trang in, tên trang tính có dấu nháy được viết đôi');
  const plain = text(readZip(buildXlsx({ rows: [['a']] })), 'xl/worksheets/sheet1.xml');
  assert.ok(plain.includes('orientation="portrait"') && !plain.includes('printOptions'));
});
