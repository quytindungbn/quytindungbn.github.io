// Nội dung "Thông tin khoản vay" để quản trị bấm SAO CHÉP rồi dán gửi khách (Zalo OA...) — văn bản thuần, đọc gọn trên điện thoại.
// Hàm thuần (không đụng mạng/DOM) nên kiểm thử được bằng node, xem tests/loanSummary.test.mjs.
import { formatVND, formatDate, boldDigits, boldText } from '../utils.js';

const LINE = '────────────────────────';
// Tiêu đề mục: số La Mã + tên mục in ĐẬM (kiểu chữ đậm Unicode, xem boldText()).
const HEAD_LOAN = `${boldText('I')}. ${boldText('KHOẢN VAY')}`;
const HEAD_INTEREST = `${boldText('II')}. ${boldText('TIỀN LÃI')}`;

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
  // Tên quỹ viết HOA làm tiêu đề. Zalo chỉ nhận chữ thường khi dán nên không in đậm thật được chữ tiếng Việt; chỉ chữ SỐ tiền có kiểu đậm riêng.
  L.push(String(orgName || '').toUpperCase());
  L.push('THÔNG TIN KHOẢN VAY');
  L.push(`(tính đến ${formatDate(asOf)})`);
  L.push(LINE);
  L.push(`Khách hàng: ${customerDisplay(customerName, heirName)}`);
  L.push(`Hợp đồng số: ${contract.code}`);
  const status = loanStatusText(info);
  if (status) L.push(`Tình trạng: ${status}`);
  L.push('');
  L.push(HEAD_LOAN);
  if (principal > 0) {
    L.push(`• Số tiền vay ban đầu: ${formatVND(principal)}`);
    L.push(`• Gốc đã trả: ${formatVND(Math.max(0, principal - balance))}`);
  }
  L.push(`• Dư nợ gốc hiện tại: ${settled ? formatVND(0) : boldDigits(formatVND(balance))}`);
  L.push(`• Lãi suất: ${rate}%/năm`);
  L.push(`• Ngày vay: ${formatDate(contract.disbursedDate)}`);
  L.push(`• Ngày đến hạn: ${formatDate(contract.dueDate)}`);
  if (nextInstallment && Number(nextInstallment.amount) > 0) {
    L.push(`• Kỳ trả gốc tới: ${formatDate(nextInstallment.date)} — ${formatVND(nextInstallment.amount)}`);
  }
  if (!settled) {
    L.push('');
    L.push(HEAD_INTEREST);
    L.push(`• Đã trả lãi đến ngày: ${formatDate(paidUntil)}`);
    L.push(`• Số ngày tính lãi: ${days} ngày`);
    L.push(`• Tiền lãi phải trả: ${boldDigits(formatVND(accrued))}`);
  }
  L.push(LINE);
  L.push('Trân trọng!');
  L.push(orgName);
  if (hotline) L.push(`Hotline: ${hotline}`);
  return L.join('\n');
}
