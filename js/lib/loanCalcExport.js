import { formatDate, formatVND, escapeHtml } from '../utils.js';
import { buildXlsx } from './xlsxWrite.js';

export const METHOD_LABELS = {
  equalPrincipal: 'Gốc trả đều mỗi tháng',
  annuity: 'Gốc + lãi trả đều mỗi tháng',
  bullet: 'Lãi hàng tháng, gốc cuối kỳ',
};
export const KIND_LABELS = {
  gocLai: 'Gồm cả gốc và lãi',
  goc: 'Chỉ tiền gốc, lãi cộng thêm',
};

const nf = (n) => Math.round(n).toLocaleString('vi-VN');
const pct = (n) => String(n).replace('.', ',');
export const NOTE_TEXT = 'Lãi = dư nợ × lãi suất × số ngày thực tế của kỳ ÷ 365, mỗi kỳ làm tròn đến nghìn đồng. Kết quả chỉ để tham khảo, không phải cam kết.';

export function inputLines(inputs, result) {
  const lines = [
    ['Số tiền vay', formatVND(inputs.principal)],
    ['Lãi suất', `${pct(inputs.ratePercent)}%/năm (365 ngày/năm)`],
    ['Ngày vay', formatDate(inputs.startDate)],
  ];

  const rows = result && result.rows;
  if (rows && rows.length) lines.push(['Ngày đáo hạn', formatDate(rows[rows.length - 1].to)]);
  if (inputs.tab === 'term') {

    lines.push(['Cách trả', (METHOD_LABELS[inputs.method] || '') + (inputs.fixedAmount > 0 ? `, ${formatVND(inputs.fixedAmount)}/tháng` : '')]);
  } else {
    lines.push(['Số tiền trả mỗi tháng', formatVND(inputs.payment)], ['Số tiền này là', KIND_LABELS[inputs.kind] || '']);
  }
  return lines;
}

export function summaryItems(inputs, result) {
  const T = result.totals, last = result.rows[result.rows.length - 1];
  const items = [
    { label: 'Tổng gốc', value: formatVND(T.principal) },
    { label: 'Tổng lãi', value: formatVND(T.interest) },
    { label: 'Tổng phải trả', value: formatVND(T.payment) },
    { label: inputs.tab === 'pay' ? 'Trả hết sau' : 'Thời hạn', value: `${T.months} tháng (đến ${formatDate(last.to)})` },
  ];
  return items;
}

export function summaryTiles(inputs, result) {
  const T = result.totals, last = result.rows[result.rows.length - 1];
  const principal = { label: 'Tổng gốc', value: formatVND(T.principal), sub: 'Số tiền vay' };
  const interest = { label: 'Tổng lãi', value: formatVND(T.interest), sub: `${T.days} ngày thực tế` };
  const payment = { label: 'Tổng phải trả', value: formatVND(T.payment), sub: 'Gốc + lãi' };
  const time = { label: inputs.tab === 'pay' ? 'Trả hết sau' : 'Thời hạn', value: `${T.months} tháng`, sub: `Đến ${formatDate(last.to)}` };
  return inputs.tab === 'pay'
    ? [{ ...time, hi: true }, principal, interest, payment]
    : [principal, { ...interest, hi: true }, payment, time];
}

export const TABLE_HEAD = ['Kỳ', 'Ngày trả', 'Số ngày', 'Dư nợ đầu kỳ', 'Trả gốc', 'Trả lãi', 'Phải trả', 'Còn nợ'];

export function loanCalcFileName(date = new Date(), ext = 'xlsx') {
  const p = (n) => String(n).padStart(2, '0');
  return `Tinh-lai-vay_${date.getFullYear()}${p(date.getMonth() + 1)}${p(date.getDate())}.${ext}`;
}

export function printModel({ org, inputs, result, printedOn = new Date() }) {
  const T = result.totals;
  return {
    orgName: String(org?.name || 'Quỹ tín dụng nhân dân').toUpperCase(),
    dateText: `Lập ngày ${formatDate(printedOn)}`,
    title: 'BẢNG TÍNH LÃI VAY',
    subtitle: inputs.tab === 'term' ? 'Tính theo thời hạn vay' : 'Tính theo số tiền trả hàng tháng',
    params: inputLines(inputs, result),
    tiles: summaryTiles(inputs, result),
    head: TABLE_HEAD,
    rows: result.rows.map((r) => ({
      ky: `Kỳ ${r.k}`, date: formatDate(r.to), days: String(r.days), opening: nf(r.opening),
      principal: r.principal ? nf(r.principal) : '—', interest: nf(r.interest), payment: nf(r.payment), closing: nf(r.closing),
    })),
    total: { days: String(T.days), principal: nf(T.principal), interest: nf(T.interest), payment: nf(T.payment) },
    note: NOTE_TEXT,
  };
}

const XL_WIDTHS = [10, 14, 10, 19, 18, 17, 18, 19];
const colLetter = (i) => String.fromCharCode(65 + i);
const mergedWidth = (c1, c2) => XL_WIDTHS.slice(c1, c2 + 1).reduce((s, w) => s + w, 0);

export function buildLoanCalcXlsx({ org, inputs, result, printedOn = new Date() }) {
  const m = printModel({ org, inputs, result, printedOn });
  const W = XL_WIDTHS.length;
  const rows = [], merges = [], heights = {};
  const push = (cells, ht) => {
    const row = cells.slice();
    while (row.length < W) row.push(null);
    rows.push(row);
    if (ht) heights[rows.length] = ht;
    return rows.length;
  };

  const span = (row, c1, c2, cell) => {
    const style = cell && cell.style;
    row[c1] = cell;
    for (let c = c1 + 1; c <= c2; c++) row[c] = style ? { v: '', style } : null;
    return row;
  };
  const mergeRow = (r, c1, c2) => { if (c2 > c1) merges.push(`${colLetter(c1)}${r}:${colLetter(c2)}${r}`); };

  let r = push(span(span([], 0, 4, { v: m.orgName, style: 'org' }), 5, 7, { v: m.dateText, style: 'meta' }), 20);
  mergeRow(r, 0, 4); mergeRow(r, 5, 7);
  r = push(span([], 0, 7, { v: m.title, style: 'title' }), 36); mergeRow(r, 0, 7);
  push(span([], 0, 7, { v: '', style: 'rule' }), 4);
  push([], 6);
  r = push(span([], 0, 7, { v: 'ĐIỀU KIỆN VAY', style: 'section' }), 18); mergeRow(r, 0, 7);

  const LEFT_COL = ['Số tiền vay', 'Ngày vay', 'Ngày đáo hạn'];
  const left = LEFT_COL.map((l) => m.params.find((p) => p[0] === l)).filter(Boolean), right = m.params.filter((p) => !LEFT_COL.includes(p[0]));
  for (let i = 0; i < left.length; i++) {
    const row = [];
    span(row, 0, 1, { v: left[i][0], style: 'plabel' });
    span(row, 2, 3, { v: left[i][1], style: 'pval' });
    let lines = Math.ceil(String(left[i][1]).length / (mergedWidth(2, 3) * 1.05));
    if (right[i]) {
      span(row, 4, 5, { v: right[i][0], style: 'plabel' });
      span(row, 6, 7, { v: right[i][1], style: 'pval' });
      lines = Math.max(lines, Math.ceil(String(right[i][1]).length / (mergedWidth(6, 7) * 1.05)));
    }
    if (!right[i]) { span(row, 4, 5, { v: '', style: 'plabel' }); span(row, 6, 7, { v: '', style: 'pval' }); }
    r = push(row, Math.max(19, 17 * lines + 2));
    mergeRow(r, 0, 1); mergeRow(r, 2, 3); mergeRow(r, 4, 5); mergeRow(r, 6, 7);
  }
  push([], 8);

  const tileSpans = [[0, 1], [2, 3], [4, 5], [6, 7]];
  const tileRows = ['tileLabel', 'tileValue', 'tileSub'].map((style, k) => {
    const row = [];
    m.tiles.forEach((t, i) => span(row, tileSpans[i][0], tileSpans[i][1], { v: [t.label.toUpperCase(), t.value, t.sub][k], style }));
    const rr = push(row, [18, 28, 17][k]);
    tileSpans.forEach(([a, b]) => mergeRow(rr, a, b));
    return rr;
  });
  void tileRows;
  push([], 8);

  const headRow = push(m.head.map((h, i) => ({ v: h, style: i === 0 ? 'headLeft' : 'head' })), 24);
  result.rows.forEach((row, i) => {
    const alt = i % 2 === 1 ? ':alt' : '';
    push([
      { v: `Kỳ ${row.k}`, style: `ky${alt}` }, { d: row.to, style: `date${alt}` }, { v: row.days, style: `days${alt}` },
      { v: row.opening, style: `int${alt}` }, { v: row.principal, style: `intGreen${alt}` }, { v: row.interest, style: `intGold${alt}` },
      { v: row.payment, style: `intStrong${alt}` }, { v: row.closing, style: `int${alt}` },
    ], 17);
  });
  const T = result.totals;
  push([{ v: 'Cộng', style: 'totalLabel' }, { v: '', style: 'totalLabel' }, { v: T.days, style: 'totalDays' }, { v: '', style: 'totalLabel' },
    { v: T.principal, style: 'totalInt' }, { v: T.interest, style: 'totalInt' }, { v: T.payment, style: 'totalInt' }, { v: '', style: 'totalLabel' }], 22);
  push([], 6);
  r = push(span([], 0, 7, { v: m.note, style: 'note' }), 28); mergeRow(r, 0, 7);

  return buildXlsx({
    sheetName: 'Tính lãi vay', widths: XL_WIDTHS, rows, rowHeights: heights, merges,
    landscape: true, fitWidth: true, centerH: true, printTitleRows: [headRow, headRow],
    footer: { left: m.orgName, right: m.dateText },
  });
}

export const FONTS_CSS_URL = 'https://fonts.googleapis.com/css2?family=Inter:wght@500;600;700;800&family=Source+Serif+4:ital,wght@0,400;0,600;0,700;0,800;1,400;1,600&display=swap';
export const SANS_STACK = "'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif";
export const SERIF_STACK = "'Source Serif 4', 'Noto Serif', Cambria, 'Times New Roman', serif";

const h = (v) => escapeHtml(String(v ?? ''));

const cssStr = (v) => `"${String(v ?? '').replace(/[\\"]/g, '\\$&').replace(/\n/g, ' ').replace(/</g, '\\3c ')}"`;
const COLS_MM = [22, 30, 22, 40, 38, 38, 40, 39];

export function buildLoanCalcPrintHtml({ org, inputs, result, printedOn = new Date() }) {
  const m = printModel({ org, inputs, result, printedOn });
  const params = m.params.map(([l, v]) => `<div class="prow"><span>${h(l)}</span><b>${h(v)}</b></div>`).join('');
  const tiles = m.tiles.map((t) => `<div class="tile${t.hi ? ' hi' : ''}"><small>${h(t.label)}</small><strong>${h(t.value)}</strong><em>${h(t.sub)}</em></div>`).join('');
  const body = m.rows.map((r) => `<tr><td class="l">${h(r.ky)}</td><td class="c">${h(r.date)}</td><td class="c">${r.days}</td><td>${r.opening}</td><td class="g">${r.principal}</td><td class="i">${r.interest}</td><td class="p">${r.payment}</td><td>${r.closing}</td></tr>`).join('');
  const T = m.total;
  const head = m.head.map((t, i) => `<th class="${i === 0 ? 'l' : i < 3 ? 'c' : ''}">${h(t)}</th>`).join('');
  return `<!doctype html><html lang="vi"><head><meta charset="utf-8"><title>Bảng tính lãi vay</title>
<link rel="stylesheet" href="${FONTS_CSS_URL}" data-fonts>
<style>
@page{size:A4 landscape;margin:12mm 14mm 14mm;
  @top-left{content:${cssStr(`${m.orgName} · ${m.title} (tiếp theo)`)};font:600 7pt ${SANS_STACK};letter-spacing:.08em;color:#6a7a73;vertical-align:middle}
  @bottom-left{content:${cssStr(m.dateText)};font:500 7.5pt ${SANS_STACK};color:#6a7a73}
  @bottom-right{content:"Trang " counter(page) " / " counter(pages);font:500 7.5pt ${SANS_STACK};color:#6a7a73}}
@page:first{@top-left{content:none}}
*{box-sizing:border-box}
html{-webkit-print-color-adjust:exact;print-color-adjust:exact}
body{margin:0;background:#fff;color:#12231e;font:500 9.5pt/1.4 ${SANS_STACK};font-variant-numeric:tabular-nums lining-nums}
.toolbar{padding:10px 14px;background:#eef3f0;border-bottom:1px solid #d5dfdc;display:flex;gap:12px;align-items:center;font:500 14px ${SANS_STACK}}
.toolbar button{background:#0c4a3f;color:#fff;border:0;border-radius:8px;padding:9px 22px;font:600 14px ${SANS_STACK};cursor:pointer}
.sheet{width:269mm;margin:0 auto;padding:10mm 0 14mm}
.top{display:flex;justify-content:space-between;align-items:baseline;padding-bottom:2.6mm;border-bottom:.45mm solid #b08d3c}
.org{font-weight:700;font-size:9pt;letter-spacing:.1em;color:#0c4a3f}.date{font-size:8.5pt;color:#6a7a73}
h1{margin:3.6mm 0 0;font:700 26pt/1.1 ${SERIF_STACK};letter-spacing:-.01em;color:#0c4a3f}
.sub{margin:1.5mm 0 0;font-size:9.5pt;color:#6a7a73}
.info{display:grid;grid-template-columns:142mm 1fr;gap:0 8mm;margin-top:4mm}
.params h2{margin:0;padding:0 0 1.6mm;border-bottom:.2mm solid #c9d6cf;font:700 7.5pt ${SANS_STACK};letter-spacing:.12em;text-transform:uppercase;color:#8a6a22}
.prow{display:grid;grid-template-columns:44mm 1fr;align-items:baseline;padding:1.4mm 0;border-bottom:.2mm solid #c9d6cf}
.params.dense .prow{padding:1.15mm 0}
.prow span{font-size:9pt;color:#8a6a22}.prow b{font-weight:600;font-size:9.5pt}
.tiles{display:grid;grid-template-columns:1fr 1fr;grid-auto-rows:min-content;gap:4mm}
.tile{padding:2.4mm 4mm 2.8mm;background:#f7f1df;border-top:.7mm solid #b08d3c}.tile.hi{background:#e9f3ee;border-top-color:#0c4a3f}
.tile small{display:block;font:700 7pt ${SANS_STACK};letter-spacing:.12em;text-transform:uppercase;color:#8a6a22}
.tile strong{display:block;margin-top:1.4mm;font:700 16pt/1.15 ${SERIF_STACK};color:#0c4a3f;white-space:nowrap}
.tile em{display:block;margin-top:.8mm;font-style:normal;font-size:8pt;color:#6a7a73}
table.t{width:100%;margin-top:5mm;border-collapse:collapse;table-layout:fixed;font-size:9pt}
.t th{height:8mm;padding:0 4mm;background:#0c4a3f;color:#fff;text-align:right;font:700 7pt ${SANS_STACK};letter-spacing:.1em;text-transform:uppercase}
.t td{height:6mm;padding:0 4mm;text-align:right;border-bottom:.3mm solid #a3b8ae}
.t tbody tr:nth-child(even) td{background:#f8faf8}
.t th.l,.t td.l{text-align:left;font-weight:700}.t th.c,.t td.c{text-align:center}
.t td.g{color:#0c4a3f;font-weight:600}.t td.i{color:#8a6a22;font-weight:600}.t td.p{font-weight:700}
.t tfoot td{height:7.5mm;background:#f1e7c6;color:#0c4a3f;font-weight:700;border-top:.4mm solid #b08d3c;border-bottom:.4mm solid #b08d3c}
.note{margin:3.4mm 0 0;font-size:8pt;font-style:italic;color:#6a7a73}
thead{display:table-header-group}tfoot{display:table-row-group}tr{break-inside:avoid}.info,.note{break-inside:avoid}
@media print{.toolbar{display:none}.sheet{width:auto;padding:0}}
</style></head><body><div class="toolbar"><button onclick="window.print()">In</button><span>Chọn "Lưu dưới dạng PDF" trong hộp thoại in nếu muốn lưu thành file.</span></div>
<article class="sheet"><header class="top"><span class="org">${h(m.orgName)}</span><span class="date">${h(m.dateText)}</span></header>
<h1>${h(m.title)}</h1><p class="sub">${h(m.subtitle)}</p>
<section class="info"><div class="params${m.params.length > 5 ? ' dense' : ''}"><h2>Điều kiện vay</h2>${params}</div><div class="tiles">${tiles}</div></section>
<table class="t"><colgroup>${COLS_MM.map((w) => `<col style="width:${w}mm">`).join('')}</colgroup><thead><tr>${head}</tr></thead><tbody>${body}</tbody>
<tfoot><tr><td class="l">Cộng</td><td></td><td class="c">${T.days}</td><td></td><td>${T.principal}</td><td>${T.interest}</td><td>${T.payment}</td><td></td></tr></tfoot></table>
<p class="note">${h(m.note)}</p></article></body></html>`;
}

function whenFontsReady(page) {
  const doc = page.document;
  const link = doc.querySelector('link[data-fonts]');
  const linkDone = link && !link.sheet ? new Promise((res) => { link.addEventListener('load', res); link.addEventListener('error', res); }) : Promise.resolve();
  const loaded = linkDone
    .then(() => Promise.all(['500 10px "Inter"', '600 10px "Inter"', '700 10px "Inter"', '700 20px "Source Serif 4"'].map((f) => doc.fonts.load(f).catch(() => null))))
    .then(() => doc.fonts.ready);
  return Promise.race([loaded, new Promise((res) => setTimeout(res, 3000))]);
}

export function printLoanCalc(data) {
  const page = window.open('', '_blank', 'width=1100,height=820');
  if (!page) return false;
  page.document.open();
  page.document.write(buildLoanCalcPrintHtml(data));
  page.document.close();
  page.focus();
  whenFontsReady(page).then(() => { try { page.print(); } catch {  } });
  return true;
}
