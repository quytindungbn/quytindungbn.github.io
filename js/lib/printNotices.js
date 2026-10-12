import { formatDate, formatVND, escapeHtml } from '../utils.js';

const DIGITS = ['không', 'một', 'hai', 'ba', 'bốn', 'năm', 'sáu', 'bảy', 'tám', 'chín'];
const UNITS = ['', 'nghìn', 'triệu', 'tỷ'];

function readTriplet(value, hasHigherGroup) {
  const hundreds = Math.floor(value / 100);
  const tens = Math.floor((value % 100) / 10);
  const ones = value % 10;
  const words = [];
  if (hundreds) words.push(`${DIGITS[hundreds]} trăm`);
  else if (hasHigherGroup) words.push('không trăm');
  if (tens > 1) words.push(`${DIGITS[tens]} mươi`);
  else if (tens === 1) words.push('mười');
  else if (ones && (hundreds || hasHigherGroup)) words.push('lẻ');
  if (ones) {
    if (tens > 1 && ones === 1) words.push('mốt');
    else if (tens > 1 && ones === 5) words.push('lăm');
    else if (tens === 1 && ones === 5) words.push('lăm');
    else words.push(DIGITS[ones]);
  }
  return words.join(' ');
}

/** Đọc số đồng nguyên, dùng cho giấy báo in; không làm tròn lại số tiền. */
export function amountInWords(amount) {
  const number = Number(amount);
  if (!Number.isSafeInteger(number) || number < 0) return '';
  if (number === 0) return 'Không đồng';
  const groups = [];
  let remaining = number;
  while (remaining > 0) {
    groups.unshift(remaining % 1000);
    remaining = Math.floor(remaining / 1000);
  }
  const words = groups.map((group, index) => {
    if (!group) return '';
    const hasHigherGroup = index > 0 && groups.slice(0, index).some(Boolean);
    return `${readTriplet(group, hasHigherGroup)} ${UNITS[groups.length - index - 1] || ''}`.trim();
  }).filter(Boolean).join(' ');
  return `${words.charAt(0).toUpperCase()}${words.slice(1)} đồng chẵn`;
}

const h = (value) => escapeHtml(String(value ?? ''));

/** Tạo đúng một trang A4; mọi trường lấy từ hợp đồng đang được chọn. */
export function buildNoticeHtml({ type, contract, customer, org, interest, asOf = new Date() }) {
  if (!['interest', 'due'].includes(type) || !contract || !customer) throw new Error('Thiếu dữ liệu giấy báo');
  const name = h(customer.name || '');
  const address = h(customer.address || [customer.xom, customer.thon, customer.tinh].filter(Boolean).join(', ') || '........................................................');
  const code = h(contract.code || '');
  const orgName = h(org?.name || 'Quỹ tín dụng Nhân dân Bình Nguyên');
  const loanBalance = Number(contract.balance) || 0;
  const accrued = Number(interest) || 0;
  const amount = type === 'due' ? loanBalance + accrued : accrued;
  const date = formatDate(asOf);
  const [day, month, year] = date.split('/');
  const title = type === 'due' ? 'GIẤY BÁO HỢP ĐỒNG ĐẾN HẠN' : 'THÔNG BÁO NỘP LÃI';
  const contractRows = `
    <div><span>Số HĐTD</span><strong>${code}</strong></div>
    <div><span>Lãi suất</span><strong>${h(contract.interestRate)}%/năm</strong></div>
    <div><span>Dư nợ hiện tại</span><strong>${h(formatVND(loanBalance))}</strong></div>
    <div><span>Ngày đến hạn HĐ</span><strong>${h(formatDate(contract.dueDate))}</strong></div>`;
  const amountRows = type === 'due' ? `
    <div class="amount-box"><div><span>Nợ gốc còn phải trả</span><strong>${h(formatVND(loanBalance))}</strong></div>
      <div><span>Lãi tính đến ${h(date)}</span><strong>${h(formatVND(accrued))}</strong></div>
      <div class="total"><span>Tổng gốc và lãi</span><strong>${h(formatVND(amount))}</strong></div></div>
    <p><strong>Bằng chữ: <em>${h(amountInWords(amount))}.</em></strong></p>` : `
    <p>${orgName} thông báo cho ông/bà số tiền lãi phải thanh toán cho Quỹ tín dụng là:</p>
    <p class="indent"><strong>Số tiền lãi: ${h(formatVND(accrued))}.</strong> <strong><em>(Bằng chữ: ${h(amountInWords(accrued))}.)</em></strong><br>
    <em>(Lãi tính từ ngày: ${h(formatDate(contract.interestPaidUntil || contract.disbursedDate))} đến ngày: ${h(date)}).</em></p>`;
  const body = type === 'due' ? `
    <p>Yêu cầu Ông/Bà chậm nhất đến ngày…… tháng…… năm………… phải có mặt tại ${orgName} để thực hiện nghĩa vụ thanh toán toàn bộ nợ gốc và lãi vay theo quy định.</p>
    <p>Quá thời hạn nêu trên, khoản vay sẽ bị chuyển sang nợ quá hạn, đồng thời Ông/Bà phải chịu lãi suất quá hạn, các khoản phí phạt phát sinh và các biện pháp xử lý theo quy định của pháp luật và điều lệ của Quỹ. Mọi hậu quả phát sinh do việc chậm trễ thanh toán, Ông/Bà hoàn toàn chịu trách nhiệm.</p>
    <p>Chúng tôi xin trân trọng cảm ơn sự hợp tác của ông/bà.</p>` : `
    <p>Đề nghị ông/bà trước <strong>ngày..........tháng.........năm ${h(year)}</strong> phải thực hiện thanh toán lãi tiền vay cho Quỹ tín dụng nhân dân Bình Nguyên. Nếu không chấp hành Quỹ tín dụng sẽ tiến hành thu hồi nợ trước hạn theo quy định và ông/bà sẽ bồi thường thiệt hại cho Quỹ (nếu có).</p>
    <p>Nếu ông/bà không chấp hành sẽ chịu hoàn toàn trước pháp luật của Nhà nước và QTDND Bình Nguyên. Chúng tôi xin trân trọng cảm ơn sự hợp tác của ông/bà.</p>`;
  return `<!doctype html><html lang="vi"><head><meta charset="utf-8"><title>${h(title)} - HĐTD ${code}</title>
    <style>
      @page{size:A4;margin:18mm 18mm 16mm}*{box-sizing:border-box}body{margin:0;color:#202020;background:#fff;font:13pt/1.48 "Times New Roman",Times,serif}
      .toolbar{font:14px Arial,sans-serif;padding:12px 18mm;background:#f3f6f5;border-bottom:1px solid #d5dfdc;display:flex;gap:12px;align-items:center}
      .toolbar button{background:#0c6253;color:#fff;border:0;border-radius:6px;padding:8px 18px;cursor:pointer}.sheet{max-width:174mm;margin:0 auto;padding:16mm 0}
      header{border-bottom:1px solid #252525;padding-bottom:8px;display:flex;justify-content:space-between;align-items:baseline;font-size:10pt}header strong{text-transform:uppercase;font-size:11pt}
      .date{text-align:right;font-style:italic;margin:16px 0 26px;font-size:11pt}h1{text-align:center;font-size:17pt;margin:0 0 3px}h2{text-align:center;font-size:11pt;font-weight:400;margin:0 0 24px}
      .recipient{font-weight:700;margin:0 0 2px}.address{margin:0 0 15px;font-size:11.5pt}.contract{background:#f3f8f5;border:1px solid #d5e2dc;border-radius:8px;padding:12px 15px;display:grid;grid-template-columns:1fr 1fr;gap:7px 18px;font-size:10.5pt}
      .contract-label{grid-column:1/-1;color:#0c6253;font-weight:700;font-size:9pt}.contract>div:not(.contract-label){display:flex;justify-content:space-between;gap:6px}.contract span{color:#5d5d5d}.contract strong{white-space:nowrap}
      main{margin-top:18px;text-align:justify}p{margin:0 0 13px}.indent{margin-left:18px}.amount-box{background:#f7f9f8;border:1px solid #d5e2dc;border-radius:8px;padding:9px 15px;margin-bottom:11px;font-size:11.5pt}.amount-box>div{display:flex;justify-content:space-between;gap:16px;padding:4px 0}.amount-box .total{border-top:1px solid #cbd9d3;margin-top:4px;padding-top:8px;font-weight:700}
      .signatures{display:grid;grid-template-columns:1fr 1fr;margin-top:32px;text-align:center;font-size:11pt;break-inside:avoid}.signatures small{display:block;font-style:italic;font-size:9pt}
      @media print{.toolbar{display:none}.sheet{padding:0;max-width:none}body{-webkit-print-color-adjust:exact;print-color-adjust:exact}}
    </style></head><body><div class="toolbar"><button onclick="window.print()">In giấy báo</button><span>Kiểm tra số liệu và ngày yêu cầu trước khi phát hành.</span></div><article class="sheet">
      <header><strong>${orgName}</strong><span>Số: ............................</span></header>
      <div class="date">Bình Sơn, ngày ${h(day)} tháng ${h(month)} năm ${h(year)}</div>
      <h1>${h(title)}</h1><h2>Hợp đồng tín dụng số ${code}</h2>
      <div class="recipient">Kính gửi: Ông/Bà ${name}</div>
      <div class="address">Địa chỉ: ${address}</div>
      <section class="contract"><div class="contract-label">THÔNG TIN HỢP ĐỒNG</div>${contractRows}</section>
      <main>${amountRows}${body}</main>
      <footer class="signatures"><div><strong>CÁN BỘ TÍN DỤNG</strong><small>(Ký, ghi rõ họ tên)</small></div><div><strong>ĐẠI DIỆN QUỸ</strong><small>(Ký, đóng dấu nếu phát hành)</small></div></footer>
    </article></body></html>`;
}

export function printNotice(data) {
  const page = window.open('', '_blank', 'width=900,height=900');
  if (!page) return false;
  page.document.open();
  page.document.write(buildNoticeHtml(data));
  page.document.close();
  page.focus();
  page.setTimeout(() => page.print(), 350);
  return true;
}
