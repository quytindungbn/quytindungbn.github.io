// Nội dung "Thông tin khoản vay" để quản trị bấm SAO CHÉP rồi dán gửi khách (Zalo OA...) — văn bản thuần, đọc gọn trên điện thoại.
// Hàm thuần (không đụng mạng/DOM) nên kiểm thử được bằng node, xem tests/loanSummary.test.mjs.
import { formatVND, formatDate, boldDigits } from '../utils.js';

// Ngắn vừa phải để không bị xuống dòng trong khung tin nhắn trên điện thoại.
const LINE = '──────────────';
// Tiêu đề mục viết HOA. Không dùng chữ đậm Unicode cho chữ tiếng Việt vì dấu bị lệch/mất trên Zalo.
const HEAD_LOAN = 'I. KHOẢN VAY';
const HEAD_INTEREST = 'II. TIỀN LÃI';

// Zalo dán vào là chữ thường, phông tỉ lệ (mỗi chữ một độ rộng) nên không canh cột bằng dấu cách thường được.
// Độ rộng chữ (1/1000 em) của phông không chân phổ biến (Arial/Roboto) để tính số khoảng trắng cần đệm cho thẳng cột.
const GLYPH_WIDTH = {
  ijl: 222, 'ftI :.,/\u00a0': 278, 'r-()': 333, '•': 350, cksvxyzJ: 500, '₫': 513,
  '0123456789abdeghnopquLđ': 556, FTZ: 611, ABEKPSVXY: 667, 'wCDHNRUĐ': 722, GOQ: 778, mM: 833, '%': 889, W: 944, '—': 1000,
};
const WIDTH_OF = {};
for (const [chars, w] of Object.entries(GLYPH_WIDTH)) for (const ch of chars) WIDTH_OF[ch] = w;
const SPACE = WIDTH_OF[' '];
const NBSP = '\u00a0'; // khoảng trắng không bị Zalo/ứng dụng gộp lại như dấu cách thường

/** Độ rộng ước lượng (1/1000 em); chữ có dấu tính bằng chữ gốc. */
export function textWidth(text) {
  let w = 0;
  for (const ch of String(text).normalize('NFD').replace(/[\u0300-\u036f]/g, '')) w += WIDTH_OF[ch] ?? 556;
  return w;
}

/** Canh phần giá trị (sau dấu ":") của các dòng thẳng một cột, đệm khoảng trắng theo độ rộng chữ. rows = [[nhãn, giá trị], ...] */
export function alignRows(rows, prefix = '') {
  const labels = rows.map(([label]) => `${prefix}${label}:`);
  const column = Math.max(...labels.map(textWidth)) + SPACE;
  return rows.map(([, value], i) => {
    const gap = Math.max(1, Math.round((column - textWidth(labels[i])) / SPACE));
    return `${labels[i]} ${NBSP.repeat(gap - 1)}${value}`;
  });
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
  loanRows.push(['Dư nợ gốc hiện tại', settled ? formatVND(0) : boldDigits(formatVND(balance))]);
  loanRows.push(['Lãi suất', `${rate}%/năm`]);
  loanRows.push(['Ngày vay', formatDate(contract.disbursedDate)]);
  loanRows.push(['Ngày đến hạn', formatDate(contract.dueDate)]);
  if (nextInstallment && Number(nextInstallment.amount) > 0) {
    loanRows.push(['Kỳ trả gốc tới', `${formatDate(nextInstallment.date)} — ${formatVND(nextInstallment.amount)}`]);
  }
  const interestRows = settled ? [] : [
    ['Đã trả lãi đến ngày', formatDate(paidUntil)],
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
