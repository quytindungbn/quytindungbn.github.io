// Nội dung "Thông tin khoản vay" để quản trị bấm SAO CHÉP rồi dán gửi khách (Zalo OA...) — văn bản thuần, đọc gọn trên điện thoại.
// Hàm thuần (không đụng mạng/DOM) nên kiểm thử được bằng node, xem tests/loanSummary.test.mjs.
import { formatVND, formatDate, boldDigits } from '../utils.js';

// Ngắn vừa phải để không bị xuống dòng trong khung tin nhắn trên điện thoại.
const LINE = '──────────────';
// Tiêu đề mục viết HOA. Không dùng chữ đậm Unicode cho chữ tiếng Việt vì dấu bị lệch/mất trên Zalo.
const HEAD_LOAN = 'I. KHOẢN VAY';
const HEAD_INTEREST = 'II. TIỀN LÃI';

// Zalo dán vào là chữ thường, phông tỉ lệ (mỗi chữ một độ rộng) nên không canh cột bằng dấu cách thường được.
// Cách làm: ước lượng độ rộng chữ (1/1000 em, trung bình các phông không chân kiểu Android/Windows: Arial, Helvetica, Noto Sans)
// rồi đệm khoảng trắng có độ rộng CỐ ĐỊNH theo em (1/2, 1/3, 1/4, 1/6 em) cho phần sau dấu ":" bắt đầu cùng một cột.
const GLYPH_WIDTH = {
  il: 240, j: 250, ' .': 260, ':,': 270, 't/': 280, fI: 300, 'r-()': 330, '•': 370, s: 460, J: 470, cz: 480, xy: 490, kv: 500,
  ae: 510, '₫': 520, hnou: 530, 'bdgpqđ': 540, L: 580, F: 590, Z: 610, T: 620, PS: 630, E: 640, B: 670, VX: 680, AKY: 690,
  CR: 700, D: 710, 'wHNUĐ': 720, G: 750, OQ: 760, m: 810, M: 860, '%': 870, W: 940, '—': 1000,
};
const WIDTH_OF = {};
for (const [chars, w] of Object.entries(GLYPH_WIDTH)) for (const ch of chars) WIDTH_OF[ch] = w;
const PAD_SPACES = [['\u2002', 500], ['\u2004', 333], ['\u2005', 250], ['\u2006', 167]]; // en, 1/3, 1/4, 1/6 em
for (const [ch, w] of PAD_SPACES) WIDTH_OF[ch] = w;
const COLUMN_GAP_MIN = 330; // khoảng cách tối thiểu từ nhãn dài nhất tới giá trị
// Hiệu chỉnh độ rộng từng nhãn (1/1000 em) theo ảnh chụp thực tế trên Zalo Android: phông máy có kerning nên một số nhãn
// ("Ngày vay", "Số tiền vay"...) hẹp hơn bảng ước lượng, một số ("Dư nợ hiện tại", "Lãi suất") rộng hơn.
const LABEL_FIX = {
  'Khách hàng': -69, 'Hợp đồng số': 54, 'Tình trạng': 16,
  'Số tiền vay': -59, 'Gốc đã trả': 5, 'Dư nợ hiện tại': 71, 'Lãi suất': 52, 'Ngày vay': -120, 'Ngày đến hạn': 11,
  'Đã trả lãi đến': 14, 'Số ngày tính lãi': 16, 'Tiền lãi phải trả': 11,
};

/** Độ rộng ước lượng (1/1000 em); chữ có dấu tính bằng chữ gốc. */
export function textWidth(text) {
  let w = 0;
  for (const ch of String(text).normalize('NFD').replace(/[\u0300-\u036f]/g, '')) w += WIDTH_OF[ch] ?? 560;
  return w;
}

/** Độ rộng ước lượng của "<tiền tố><nhãn>:" kèm hiệu chỉnh theo nhãn. */
export function labelWidth(label, prefix = '') {
  return textWidth(`${prefix}${label}:`) + (LABEL_FIX[label] ?? 0);
}

/** Khoảng trắng có độ rộng gần `width` nhất (sai số nhỏ nhất, rồi ít ký tự nhất) → { text, width }. */
function padding(width) {
  let best = null;
  for (let a = 0; a <= 12; a++) for (let b = 0; b <= 2; b++) for (let c = 0; c <= 3; c++) for (let d = 0; d <= 3; d++) {
    const w = a * 500 + b * 333 + c * 250 + d * 167;
    const score = Math.abs(w - width) * 20 + a + b + c + d;
    if (!best || score < best.score) best = { score, a, b, c, d, w };
  }
  return { text: '\u2002'.repeat(best.a) + '\u2004'.repeat(best.b) + '\u2005'.repeat(best.c) + '\u2006'.repeat(best.d), width: best.w };
}

/**
 * Canh phần giá trị (sau dấu ":") của các dòng thẳng một cột. rows = [[nhãn, giá trị], ...]
 * Khoảng cách cột được chọn (trong 1/12 em) sao cho sai số làm tròn khoảng trắng của các dòng là nhỏ nhất.
 */
export function alignRows(rows, prefix = '') {
  const widths = rows.map(([label]) => labelWidth(label, prefix));
  let best = null;
  for (let gap = COLUMN_GAP_MIN; gap < COLUMN_GAP_MIN + 84; gap += 3) {
    const column = Math.max(...widths) + gap;
    const error = Math.max(...widths.map((w) => Math.abs(padding(column - w).width - (column - w))));
    if (!best || error < best.error) best = { column, error };
  }
  return rows.map(([label, value], i) => `${prefix}${label}:${padding(best.column - widths[i]).text}${value}`);
}

/** Tên khách IN HOA; có thêm người đồng vay (khác tên khách) thì nối bằng chữ "và" viết thường, chỉ 1 tên thì không có chữ "và". */
export function customerDisplay(customerName, heirName) {
  const main = String(customerName || '').trim();
  const heir = String(heirName || '').trim();
  const names = [main, heir && heir.toLowerCase() !== main.toLowerCase() ? heir : ''].filter(Boolean).map((n) => n.toUpperCase());
  return names.join(' và ');
}

/** "Trong hạn" / "Quá hạn N ngày" / "Còn N ngày đến hạn" / "Đã tất toán" — cách nói dành cho khách. */
export function loanStatusText(info) {
  if (!info) return '';
  if (info.status === 'da_tat_toan') return 'Đã tất toán';
  if (info.status === 'qua_han') return `Quá hạn ${info.days} ngày`;
  if (info.status === 'gan_den_han') return `Còn ${info.days} ngày đến hạn`;
  return 'Trong hạn';
}

/**
 * @param {object} p
 * @param {string} p.orgName      tên quỹ (VD "Quỹ Tín Dụng Nhân Dân Bình Nguyên")
 * @param {string} [p.hotline]
 * @param {string} p.customerName tên khách hàng
 * @param {string} [p.heirName]   người đồng vay/thừa kế (nếu có và khác tên khách thì ghi thêm "và <tên>")
 * @param {object} p.contract     { code, principal, balance, interestRate, disbursedDate, dueDate, interestPaidUntil }
 * @param {object} [p.info]       kết quả contractStatusInfo()
 * @param {Date}   p.asOf         "tính đến ngày" đang hiện trên màn hình
 * @param {number} p.days         số ngày tính lãi tương ứng
 * @param {number} p.accrued      tiền lãi tương ứng
 * @param {{date:(Date|string), amount:number}|null} [p.nextInstallment] kỳ trả gốc tới (hợp đồng có phân kỳ)
 */
export function buildLoanSummaryText({ orgName, hotline, customerName, heirName, contract, info, asOf, days, accrued, nextInstallment }) {
  const balance = Number(contract.balance) || 0;
  const principal = Number(contract.principal) || 0;
  const rate = String(contract.interestRate).replace('.', ',');
  const paidUntil = contract.interestPaidUntil || contract.disbursedDate;
  const settled = balance <= 0;
  const L = [];
  // Tên quỹ viết HOA làm tiêu đề. Zalo chỉ nhận chữ thường khi dán nên chỉ chữ SỐ tiền có kiểu đậm riêng (boldDigits).
  L.push(String(orgName || '').toUpperCase());
  L.push('THÔNG TIN KHOẢN VAY');
  L.push(`(tính đến ${formatDate(asOf)})`);
  L.push(LINE);
  const status = loanStatusText(info);
  L.push(...alignRows([
    ['Khách hàng', customerDisplay(customerName, heirName)],
    ['Hợp đồng số', contract.code],
    ...(status ? [['Tình trạng', status]] : []),
  ]));
  L.push('');
  // Hai mục dưới dùng chung một cột để giá trị thẳng hàng từ trên xuống.
  const loanRows = [];
  if (principal > 0) {
    loanRows.push(['Số tiền vay', formatVND(principal)]);
    loanRows.push(['Gốc đã trả', formatVND(Math.max(0, principal - balance))]);
  }
  loanRows.push(['Dư nợ hiện tại', settled ? formatVND(0) : boldDigits(formatVND(balance))]);
  loanRows.push(['Lãi suất', `${rate}%/năm`]);
  loanRows.push(['Ngày vay', formatDate(contract.disbursedDate)]);
  loanRows.push(['Ngày đến hạn', formatDate(contract.dueDate)]);
  if (nextInstallment && Number(nextInstallment.amount) > 0) {
    loanRows.push(['Kỳ trả gốc tới', `${formatDate(nextInstallment.date)} — ${formatVND(nextInstallment.amount)}`]);
  }
  const interestRows = settled ? [] : [
    ['Đã trả lãi đến', formatDate(paidUntil)],
    ['Số ngày tính lãi', `${days} ngày`],
    ['Tiền lãi phải trả', boldDigits(formatVND(accrued))],
  ];
  const aligned = alignRows([...loanRows, ...interestRows], '• ');
  L.push(HEAD_LOAN);
  L.push(...aligned.slice(0, loanRows.length));
  if (interestRows.length) {
    L.push('');
    L.push(HEAD_INTEREST);
    L.push(...aligned.slice(loanRows.length));
  }
  L.push(LINE);
  L.push('Trân trọng!');
  L.push(orgName);
  if (hotline) L.push(`Hotline: ${hotline}`);
  return L.join('\n');
}
