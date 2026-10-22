// Ghi file Excel (.xlsx) tối thiểu, không cần thư viện ngoài: gói ZIP kiểu "lưu không nén" + vài tệp XML.
// Chỉ đủ cho bảng đơn giản: một trang tính, chữ/số/ngày, kiểu ô có tên (xem STYLE_DEFS), gộp ô, in ngang. Kiểm thử: tests/xlsxWrite.test.mjs.

const enc = new TextEncoder();

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

export function crc32(bytes) {
  let c = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) c = CRC_TABLE[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

/** Gói các tệp vào một ZIP (lưu không nén). files = [{ name, data: string | Uint8Array }]. */
export function zipStore(files) {
  const parts = [];
  const central = [];
  let offset = 0;
  const u16 = (n) => [n & 0xff, (n >>> 8) & 0xff];
  const u32 = (n) => [n & 0xff, (n >>> 8) & 0xff, (n >>> 16) & 0xff, (n >>> 24) & 0xff];
  for (const f of files) {
    const name = enc.encode(f.name);
    const data = typeof f.data === 'string' ? enc.encode(f.data) : f.data;
    const crc = crc32(data);
    // Bit 11 = tên tệp dạng UTF-8; giờ/ngày DOS để 0 (1980-01-00) vì không ai xem.
    const local = new Uint8Array([0x50, 0x4b, 0x03, 0x04, ...u16(20), ...u16(0x0800), ...u16(0), ...u16(0), ...u16(0x21), ...u32(crc), ...u32(data.length), ...u32(data.length), ...u16(name.length), ...u16(0)]);
    parts.push(local, name, data);
    central.push(new Uint8Array([0x50, 0x4b, 0x01, 0x02, ...u16(20), ...u16(20), ...u16(0x0800), ...u16(0), ...u16(0), ...u16(0x21), ...u32(crc), ...u32(data.length), ...u32(data.length), ...u16(name.length), ...u16(0), ...u16(0), ...u16(0), ...u16(0), ...u32(0), ...u32(offset)]), name);
    offset += local.length + name.length + data.length;
  }
  const centralSize = central.reduce((s, p) => s + p.length, 0);
  const end = new Uint8Array([0x50, 0x4b, 0x05, 0x06, ...u16(0), ...u16(0), ...u16(files.length), ...u16(files.length), ...u32(centralSize), ...u32(offset), ...u16(0)]);
  const all = [...parts, ...central, end];
  const out = new Uint8Array(all.reduce((s, p) => s + p.length, 0));
  let pos = 0;
  for (const p of all) { out.set(p, pos); pos += p.length; }
  return out;
}

const xml = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '');

/** Ngày → số ngày kiểu Excel (1900), theo ngày/tháng/năm địa phương nên không lệch múi giờ. */
export function excelSerial(date) {
  return Math.round((Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()) - Date.UTC(1899, 11, 30)) / 86400000);
}

// ------------------------------------------------------------
// Kiểu ô có tên. Mỗi kiểu mô tả: font, fill (màu nền), border ({ top|bottom: [kiểu, màu] }), align, numFmt (số dựng sẵn hoặc chuỗi mã).
// Thêm hậu tố ":alt" vào tên để cùng kiểu nhưng nền xen kẽ (dòng chẵn của bảng). styles.xml chỉ ghi các kiểu thật sự dùng, kiểu 0 luôn là "normal".
// ------------------------------------------------------------
const COLOR = { em: 'FF0C4A3F', gold: 'FFB08D3C', goldDark: 'FF8A6A22', ink: 'FF12231E', muted: 'FF6A7A73', cream: 'FFF7F1DF', cream2: 'FFFBF8EF', alt: 'FFF5F8F6', line: 'FFDBE6E0', white: 'FFFFFFFF' };
const SANS = 'Calibri', SERIF = 'Cambria';
const f = (extra) => ({ name: SANS, sz: 11, color: COLOR.ink, ...extra });
const hair = ['thin', COLOR.line];
const STYLE_DEFS = {
  normal: { font: { name: SANS, sz: 11 } },
  bold: { font: f({ b: 1 }) },
  title: { font: f({ name: SERIF, b: 1, sz: 22, color: COLOR.em }), align: { h: 'center', v: 'center' } },
  org: { font: f({ b: 1, sz: 11, color: COLOR.em }), align: { v: 'center' } },
  meta: { font: f({ i: 1, sz: 10, color: COLOR.muted }), align: { h: 'right', v: 'center' } },
  rule: { border: { bottom: ['medium', COLOR.gold] } },
  section: { font: f({ b: 1, sz: 9, color: COLOR.goldDark }), border: { bottom: hair }, align: { v: 'center' } },
  plabel: { font: f({ sz: 10.5, color: COLOR.goldDark }), align: { v: 'center' } },
  pval: { font: f({ b: 1, sz: 11 }), align: { h: 'left', v: 'center', wrap: 1 } },
  tileLabel: { font: f({ b: 1, sz: 9, color: COLOR.goldDark }), fill: COLOR.cream, border: { top: ['medium', COLOR.gold] }, align: { h: 'center', v: 'center' } },
  tileValue: { font: f({ name: SERIF, b: 1, sz: 15, color: COLOR.em }), fill: COLOR.cream, align: { h: 'center', v: 'center', wrap: 1 } },
  tileSub: { font: f({ sz: 9, color: COLOR.muted }), fill: COLOR.cream, align: { h: 'center', v: 'center' } },
  head: { font: f({ b: 1, sz: 10, color: COLOR.white }), fill: COLOR.em, align: { h: 'center', v: 'center', wrap: 1 } },
  headLeft: { font: f({ b: 1, sz: 10, color: COLOR.white }), fill: COLOR.em, align: { h: 'left', v: 'center', wrap: 1, indent: 1 } },
  ky: { font: f({ b: 1 }), border: { bottom: hair }, align: { h: 'left', v: 'center', indent: 1 } },
  date: { numFmt: 'dd/mm/yyyy', border: { bottom: hair }, align: { h: 'center', v: 'center' } },
  days: { numFmt: 0, border: { bottom: hair }, align: { h: 'center', v: 'center' } },
  int: { numFmt: 3, border: { bottom: hair }, align: { h: 'right', v: 'center', indent: 1 } },
  intGreen: { font: f({ b: 1, color: COLOR.em }), numFmt: '#,##0;-#,##0;"—"', border: { bottom: hair }, align: { h: 'right', v: 'center', indent: 1 } },
  intGold: { font: f({ b: 1, color: COLOR.goldDark }), numFmt: 3, border: { bottom: hair }, align: { h: 'right', v: 'center', indent: 1 } },
  intStrong: { font: f({ b: 1 }), numFmt: 3, border: { bottom: hair }, align: { h: 'right', v: 'center', indent: 1 } },
  totalLabel: { font: f({ b: 1, color: COLOR.em }), fill: COLOR.cream, border: { top: ['thin', COLOR.gold], bottom: ['medium', COLOR.gold] }, align: { h: 'left', v: 'center', indent: 1 } },
  totalDays: { font: f({ b: 1, color: COLOR.em }), numFmt: 0, fill: COLOR.cream, border: { top: ['thin', COLOR.gold], bottom: ['medium', COLOR.gold] }, align: { h: 'center', v: 'center' } },
  totalInt: { font: f({ b: 1, color: COLOR.em }), numFmt: 3, fill: COLOR.cream, border: { top: ['thin', COLOR.gold], bottom: ['medium', COLOR.gold] }, align: { h: 'right', v: 'center', indent: 1 } },
  note: { font: f({ i: 1, sz: 9.5, color: COLOR.muted }), align: { h: 'left', v: 'top', wrap: 1 } },
  noteLine: { font: f({ i: 1, sz: 9.5, color: COLOR.muted }), align: { h: 'left', v: 'center' } },
};

function makeStyleRegistry() {
  const fonts = [], fills = [null, 'gray125'], borders = [''], numFmts = [], xfs = [], byName = new Map();
  const intern = (list, item, key = JSON.stringify) => { const k = key(item); const i = list.findIndex((x) => key(x) === k); if (i >= 0) return i; list.push(item); return list.length - 1; };
  const fontXml = (o) => `<font>${o.b ? '<b/>' : ''}${o.i ? '<i/>' : ''}<sz val="${o.sz}"/>${o.color ? `<color rgb="${o.color}"/>` : ''}<name val="${o.name}"/></font>`;
  const borderXml = (b = {}) => {
    const side = (tag, v) => (v ? `<${tag} style="${v[0]}"><color rgb="${v[1]}"/></${tag}>` : `<${tag}/>`);
    return `<border>${side('left', b.left)}${side('right', b.right)}${side('top', b.top)}${side('bottom', b.bottom)}<diagonal/></border>`;
  };
  const alignXml = (a) => `<alignment${a.h ? ` horizontal="${a.h}"` : ''}${a.v ? ` vertical="${a.v}"` : ''}${a.wrap ? ' wrapText="1"' : ''}${a.indent ? ` indent="${a.indent}"` : ''}/>`;
  fonts.push({ name: SANS, sz: 11 });
  borders[0] = {};
  const add = (name) => {
    if (byName.has(name)) return byName.get(name);
    const [baseName, variant] = name.split(':');
    const def = STYLE_DEFS[baseName];
    if (!def) { byName.set(name, 0); return 0; }
    const fill = variant === 'alt' ? (def.fill || COLOR.alt) : def.fill;
    const fontId = def.font ? intern(fonts, def.font) : 0;
    const fillId = fill ? intern(fills, fill) : 0;
    const borderId = def.border ? intern(borders, def.border) : 0;
    let numFmtId = 0;
    if (typeof def.numFmt === 'number') numFmtId = def.numFmt;
    else if (def.numFmt) numFmtId = 164 + intern(numFmts, def.numFmt, String);
    const xf = { numFmtId, fontId, fillId, borderId, align: def.align || null };
    const id = intern(xfs, xf);
    byName.set(name, id);
    return id;
  };
  add('normal');
  const toXml = () => {
    const fillXml = fills.map((x) => (x === null ? '<fill><patternFill patternType="none"/></fill>' : x === 'gray125' ? '<fill><patternFill patternType="gray125"/></fill>' : `<fill><patternFill patternType="solid"><fgColor rgb="${x}"/><bgColor indexed="64"/></patternFill></fill>`)).join('');
    const xfXml = xfs.map((x) => `<xf numFmtId="${x.numFmtId}" fontId="${x.fontId}" fillId="${x.fillId}" borderId="${x.borderId}" xfId="0"${x.numFmtId ? ' applyNumberFormat="1"' : ''}${x.fontId ? ' applyFont="1"' : ''}${x.fillId ? ' applyFill="1"' : ''}${x.borderId ? ' applyBorder="1"' : ''}${x.align ? ' applyAlignment="1">' + alignXml(x.align) + '</xf>' : '/>'}`).join('');
    return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">${numFmts.length ? `<numFmts count="${numFmts.length}">${numFmts.map((c, i) => `<numFmt numFmtId="${164 + i}" formatCode="${xml(c)}"/>`).join('')}</numFmts>` : ''}
<fonts count="${fonts.length}">${fonts.map(fontXml).join('')}</fonts>
<fills count="${fills.length}">${fillXml}</fills>
<borders count="${borders.length}">${borders.map(borderXml).join('')}</borders>
<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>
<cellXfs count="${xfs.length}">${xfXml}</cellXfs>
<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>
</styleSheet>`;
  };
  return { add, toXml };
}

function colName(index) {
  let n = index + 1, s = '';
  while (n > 0) { const m = (n - 1) % 26; s = String.fromCharCode(65 + m) + s; n = Math.floor((n - 1) / 26); }
  return s;
}

/**
 * Dựng tệp .xlsx (Uint8Array).
 * @param {object} opt
 *   rows: mỗi ô là chữ/số, hoặc { v, style } (style là tên trong STYLE_DEFS, thêm ":alt" cho nền xen kẽ), hoặc { d: Date, style } cho ngày; null/'' = ô trống.
 *   widths: độ rộng cột (ký tự). rowHeights: { số dòng (từ 1): chiều cao điểm }. merges: ['A1:E1', ...].
 *   landscape / fitWidth: in khổ A4 ngang, vừa đúng chiều ngang một trang. printTitleRows: [từ, đến] dòng lặp lại ở đầu mỗi trang in.
 *   footer: { left, center, right } chữ chân trang (center mặc định "Trang x / y"). centerH: căn giữa trang khi in.
 */
export function buildXlsx({ sheetName = 'Sheet1', widths = [], rows, rowHeights = {}, merges = [], landscape = false, fitWidth = false, printTitleRows = null, footer = null, centerH = false }) {
  const styles = makeStyleRegistry();
  const sheetRows = rows.map((row, r) => {
    const cells = row.map((cell, c) => {
      if (cell === null || cell === undefined || cell === '') return '';
      const obj = typeof cell === 'object';
      let v = obj ? (cell.d instanceof Date ? excelSerial(cell.d) : cell.v) : cell;
      const style = obj && cell.style ? styles.add(cell.style) : 0;
      const ref = `${colName(c)}${r + 1}`;
      if (v === null || v === undefined || v === '') return style ? `<c r="${ref}" s="${style}"/>` : '';
      if (typeof v === 'number' && Number.isFinite(v)) return `<c r="${ref}"${style ? ` s="${style}"` : ''}><v>${v}</v></c>`;
      return `<c r="${ref}"${style ? ` s="${style}"` : ''} t="inlineStr"><is><t xml:space="preserve">${xml(v)}</t></is></c>`;
    }).join('');
    const ht = rowHeights[r + 1];
    return `<row r="${r + 1}"${ht ? ` ht="${ht}" customHeight="1"` : ''}>${cells}</row>`;
  }).join('');
  const cols = widths.length ? `<cols>${widths.map((w, i) => `<col min="${i + 1}" max="${i + 1}" width="${w}" customWidth="1"/>`).join('')}</cols>` : '';
  const mergeXml = merges.length ? `<mergeCells count="${merges.length}">${merges.map((m) => `<mergeCell ref="${m}"/>`).join('')}</mergeCells>` : '';
  // Chữ chân trang: ký tự & là mã đặc biệt của Excel nên phải viết &&.
  const fx = (t) => xml(String(t ?? '').replace(/&/g, '&&'));
  const footerXml = footer ? `<headerFooter><oddFooter>&amp;L&amp;8${fx(footer.left)}&amp;C&amp;8${footer.center === undefined ? 'Trang &amp;P / &amp;N' : fx(footer.center)}&amp;R&amp;8${fx(footer.right)}</oddFooter></headerFooter>` : '';
  const sheet = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">${fitWidth ? '<sheetPr><pageSetUpPr fitToPage="1"/></sheetPr>' : ''}<sheetViews><sheetView workbookViewId="0" showGridLines="0"/></sheetViews><sheetFormatPr defaultRowHeight="15"/>${cols}<sheetData>${sheetRows}</sheetData>${mergeXml}${centerH ? '<printOptions horizontalCentered="1"/>' : ''}<pageMargins left="0.4" right="0.4" top="0.4" bottom="0.6" header="0.2" footer="0.28"/><pageSetup paperSize="9" orientation="${landscape ? 'landscape' : 'portrait'}"${fitWidth ? ' fitToWidth="1" fitToHeight="0"' : ' fitToHeight="0"'}/>${footerXml}</worksheet>`;
  const name = xml(sheetName).slice(0, 31);
  const titles = printTitleRows ? `<definedNames><definedName name="_xlnm.Print_Titles" localSheetId="0">'${name.replace(/'/g, "''")}'!$${printTitleRows[0]}:$${printTitleRows[1]}</definedName></definedNames>` : '';
  return zipStore([
    { name: '[Content_Types].xml', data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/></Types>` },
    { name: '_rels/.rels', data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>` },
    { name: 'xl/workbook.xml', data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="${name}" sheetId="1" r:id="rId1"/></sheets>${titles}</workbook>` },
    { name: 'xl/_rels/workbook.xml.rels', data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>` },
    { name: 'xl/styles.xml', data: styles.toXml() },
    { name: 'xl/worksheets/sheet1.xml', data: sheet },
  ]);
}

/** Tải một tệp về máy (trình duyệt). */
export function downloadBlob(bytes, fileName, mime) {
  const url = URL.createObjectURL(new Blob([bytes], { type: mime }));
  const a = document.createElement('a');
  a.href = url; a.download = fileName; a.style.display = 'none';
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}
export const XLSX_MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
