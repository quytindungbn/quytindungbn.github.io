// Xuất / in kết quả "Tính lãi vay": dựng nội dung bảng cho file Excel (.xlsx) và trang HTML in A4 — phần thuần, kiểm thử bằng node
// (tests/loanCalcExport.test.mjs). Dữ liệu vào là `inputs` (xem js/views/admin/loanCalc.js) và kết quả của js/lib/loanCalc.js.
import { formatDate, formatVND, escapeHtml } from '../utils.js';
import { buildXlsx } from './xlsxWrite.js';

export const METHOD_LABELS = {
  equalPrincipal: 'Gốc trả đều mỗi tháng (lãi giảm dần theo dư nợ)',
  annuity: 'Gốc + lãi trả đều mỗi tháng',
  bullet: 'Lãi hàng tháng, gốc cuối kỳ',
};
export const KIND_LABELS = {
  gocLai: 'Số tiền trả mỗi tháng gồm cả gốc và lãi',
  goc: 'Số tiền trả mỗi tháng là tiền gốc, lãi cộng thêm',
};

const nf = (n) => Math.round(n).toLocaleString('vi-VN');
const pct = (n) => String(n).replace('.', ',');

/** Các dòng "nhãn: giá trị" mô tả điều kiện đã nhập (dùng cho cả Excel và bản in). */
export function inputLines(inputs, result) {
  const lines = [
    ['Số tiền vay', formatVND(inputs.principal)],
    ['Lãi suất', `${pct(inputs.ratePercent)}%/năm (365 ngày/năm)`],
    ['Ngày vay', formatDate(inputs.startDate)],
  ];
  if (inputs.tab === 'term') {
    lines.push(['Thời hạn vay', `${inputs.months} tháng`], ['Cách trả', METHOD_LABELS[inputs.method] || '']);
  } else {
    lines.push(['Số tiền trả mỗi tháng', formatVND(inputs.payment)], ['Số tiền này là', KIND_LABELS[inputs.kind] || '']);
  }
  void result;
  return lines;
}

/** Bốn ô tổng giống màn hình: [{ label, value }]. */
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

export const TABLE_HEAD = ['Kỳ', 'Ngày trả', 'Số ngày', 'Dư nợ đầu kỳ', 'Trả gốc', 'Trả lãi', 'Phải trả', 'Còn nợ'];

export function loanCalcFileName(date = new Date(), ext = 'xlsx') {
  const p = (n) => String(n).padStart(2, '0');
  return `Tinh-lai-vay_${date.getFullYear()}${p(date.getMonth() + 1)}${p(date.getDate())}.${ext}`;
}

/** Tệp Excel: tiêu đề, điều kiện đã nhập, bốn ô tổng, rồi bảng từng kỳ có dòng cộng. */
export function buildLoanCalcXlsx({ org, inputs, result, printedOn = new Date() }) {
  const rows = [];
  rows.push([{ v: String(org?.name || 'Quỹ tín dụng nhân dân').toUpperCase(), style: 'bold' }]);
  rows.push([{ v: 'BẢNG TÍNH LÃI VAY', style: 'title' }]);
  rows.push([]);
  for (const [label, value] of inputLines(inputs, result)) rows.push([{ v: label, style: 'bold' }, value]);
  rows.push([]);
  for (const s of summaryItems(inputs, result)) rows.push([{ v: s.label, style: 'bold' }, s.value]);
  rows.push([]);
  rows.push(TABLE_HEAD.map((h, i) => ({ v: h, style: i === 0 ? 'headLeft' : 'head' })));
  for (const r of result.rows) {
    rows.push([`Kỳ ${r.k}`, formatDate(r.to), r.days, { v: r.opening, style: 'int' }, { v: r.principal, style: 'int' }, { v: r.interest, style: 'int' }, { v: r.payment, style: 'int' }, { v: r.closing, style: 'int' }]);
  }
  const T = result.totals;
  rows.push([{ v: 'Cộng', style: 'labelTotal' }, { v: '', style: 'labelTotal' }, { v: T.days, style: 'intTotal' }, { v: '', style: 'labelTotal' }, { v: T.principal, style: 'intTotal' }, { v: T.interest, style: 'intTotal' }, { v: T.payment, style: 'intTotal' }, { v: '', style: 'labelTotal' }]);
  rows.push([]);
  rows.push([{ v: 'Lãi = dư nợ × lãi suất × số ngày thực tế của kỳ ÷ 365, mỗi kỳ làm tròn đến nghìn đồng. Kết quả chỉ để tham khảo.', style: 'muted' }]);
  rows.push([{ v: `Xuất ngày ${formatDate(printedOn)}`, style: 'muted' }]);
  return buildXlsx({ sheetName: 'Tính lãi vay', widths: [24, 14, 9, 17, 16, 14, 16, 17], rows });
}

const h = (v) => escapeHtml(String(v ?? ''));

/** Trang HTML in A4 (mở trong cửa sổ mới rồi gọi in). */
export function buildLoanCalcPrintHtml({ org, inputs, result, printedOn = new Date() }) {
  const orgName = h(String(org?.name || 'Quỹ tín dụng nhân dân').toUpperCase());
  const params = inputLines(inputs, result).map(([l, v]) => `<tr><th>${h(l)}</th><td>${h(v)}</td></tr>`).join('');
  const sums = summaryItems(inputs, result).map((s) => `<div><span>${h(s.label)}</span><strong>${h(s.value)}</strong></div>`).join('');
  const body = result.rows.map((r) => `<tr><td class="l">Kỳ ${r.k}</td><td>${h(formatDate(r.to))}</td><td>${r.days}</td><td>${nf(r.opening)}</td><td class="g">${r.principal ? nf(r.principal) : '—'}</td><td class="i">${nf(r.interest)}</td><td class="p">${nf(r.payment)}</td><td>${nf(r.closing)}</td></tr>`).join('');
  const T = result.totals;
  return `<!doctype html><html lang="vi"><head><meta charset="utf-8"><title>Bảng tính lãi vay</title>
<style>
@page{size:A4;margin:12mm}*{box-sizing:border-box}body{margin:0;color:#1d2b26;background:#fff;font:10.5pt/1.45 "Segoe UI",Roboto,Arial,sans-serif}
.toolbar{padding:10px 14px;background:#f3f6f5;border-bottom:1px solid #d5dfdc;display:flex;gap:12px;align-items:center;font-size:14px}.toolbar button{background:#0c6253;color:#fff;border:0;border-radius:6px;padding:8px 18px;cursor:pointer}
.sheet{max-width:186mm;margin:0 auto;padding:10mm 0}
.org{font-weight:700;font-size:10.5pt;letter-spacing:.02em;border-bottom:1px solid #1d2b26;padding-bottom:6px}
h1{margin:14px 0 10px;text-align:center;font-size:17pt;color:#0c4a3f;letter-spacing:.03em}
.params{width:100%;border-collapse:collapse;margin-bottom:10px}.params th{width:36%;padding:3px 8px 3px 0;text-align:left;font-weight:600;color:#6b5a1f;vertical-align:top}.params td{padding:3px 0}
.sum{display:grid;grid-template-columns:repeat(4,1fr);gap:8px;margin:6px 0 12px}.sum div{border:1px solid #cfe0d8;border-radius:6px;padding:6px 9px;background:#f4faf7}.sum span{display:block;font-size:8pt;text-transform:uppercase;letter-spacing:.06em;color:#8a6a22}.sum strong{display:block;margin-top:2px;font-size:10.5pt}
table.t{width:100%;border-collapse:collapse;font-size:9pt;font-variant-numeric:tabular-nums}
.t th{padding:5px 6px;text-align:right;font-size:7.5pt;text-transform:uppercase;letter-spacing:.04em;color:#6b5a1f;background:#f1e7c6;border-bottom:1px solid #b08d3c}.t th.l,.t td.l{text-align:left}
.t td{padding:4px 6px;text-align:right;border-bottom:1px solid #e3ebe7}.t td.g{color:#0c4a3f;font-weight:600}.t td.i{color:#8a6a22;font-weight:600}.t td.p{font-weight:700}
.t tfoot td{background:#fbf8ef;font-weight:700;border-top:1px solid #b08d3c}
.note{margin-top:10px;font-size:8.5pt;color:#5d6b65}.foot{margin-top:4px;font-size:8.5pt;color:#5d6b65}
thead{display:table-header-group}tr{break-inside:avoid}
@media print{.toolbar{display:none}.sheet{padding:0;max-width:none}body{-webkit-print-color-adjust:exact;print-color-adjust:exact}}
</style></head><body><div class="toolbar"><button onclick="window.print()">In</button><span>Có thể chọn "Lưu dưới dạng PDF" trong hộp thoại in.</span></div>
<article class="sheet"><div class="org">${orgName}</div><h1>BẢNG TÍNH LÃI VAY</h1>
<table class="params">${params}</table><div class="sum">${sums}</div>
<table class="t"><thead><tr><th class="l">Kỳ</th><th>Ngày trả</th><th>Số ngày</th><th>Dư nợ đầu kỳ</th><th>Trả gốc</th><th>Trả lãi</th><th>Phải trả</th><th>Còn nợ</th></tr></thead><tbody>${body}</tbody>
<tfoot><tr><td class="l">Cộng</td><td></td><td>${T.days}</td><td></td><td>${nf(T.principal)}</td><td>${nf(T.interest)}</td><td>${nf(T.payment)}</td><td></td></tr></tfoot></table>
<p class="note">Lãi = dư nợ × lãi suất × số ngày thực tế của kỳ ÷ 365, mỗi kỳ làm tròn đến nghìn đồng. Kết quả chỉ để tham khảo, không phải cam kết.</p>
<p class="foot">In ngày ${h(formatDate(printedOn))}</p></article></body></html>`;
}

/** Mở cửa sổ mới và in; trả false nếu trình duyệt chặn cửa sổ bật lên. */
export function printLoanCalc(data) {
  const page = window.open('', '_blank', 'width=900,height=900');
  if (!page) return false;
  page.document.open();
  page.document.write(buildLoanCalcPrintHtml(data));
  page.document.close();
  page.focus();
  page.setTimeout(() => page.print(), 350);
  return true;
}
