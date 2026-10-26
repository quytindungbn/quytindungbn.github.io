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

function localCalendarDate(value) {
  if (typeof value === 'string') {
    const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
    if (match) return new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
  }
  const date = new Date(value);
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

export function nextNoticePaymentDate(from) {
  const date = localCalendarDate(from);
  const daysUntilDeadline = [5, 4, 3, 5, 5, 5, 6][date.getDay()];
  date.setDate(date.getDate() + daysUntilDeadline);
  return date;
}

function writtenDate(date) {
  return `ngày ${date.getDate()} tháng ${date.getMonth() + 1} năm ${date.getFullYear()}`;
}

export function noticeDeadlineDate(type, dueDate, asOf) {
  const printedOn = localCalendarDate(asOf);
  const maturity = localCalendarDate(dueDate);
  if (type === 'due' && !Number.isNaN(maturity.getTime()) && maturity >= printedOn) {
    return maturity;
  }
  return nextNoticePaymentDate(printedOn);
}

const FONTS_CSS_URL = 'https://fonts.googleapis.com/css2?family=Inter:wght@500;600;700&family=Source+Serif+4:ital,wght@0,400;0,600;0,700;1,400;1,600&display=swap';
const SERIF = "'Source Serif 4','Noto Serif',Cambria,'Times New Roman',serif";
const SANS = "'Inter',-apple-system,'Segoe UI',Roboto,Helvetica,Arial,sans-serif";

export function buildNoticeHtml({ type, contract, customer, org, interest, asOf = new Date(), logoUrl = '' }) {
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
  const deadline = `<strong>${h(writtenDate(noticeDeadlineDate(type, contract.dueDate, asOf)))}</strong>`;
  const contactLine = [org?.address ? h(org.address) : '', org?.hotline ? `Hotline: ${h(org.hotline)}` : ''].filter(Boolean).join('  ·  ');
  const rateText = `${h(contract.interestRate)}%/năm`;
  const contractRows = `
    <div><span>Số HĐTD</span><strong>${code}</strong></div>
    <div><span>Dư nợ hiện tại</span><strong>${h(formatVND(loanBalance))}</strong></div>
    <div><span>Ngày đến hạn HĐ</span><strong>${h(formatDate(contract.dueDate))}</strong></div>
    <div><span>Lãi suất</span><strong>${rateText}</strong></div>`;
  const amountRows = type === 'due' ? `
    <section class="statement">
      <div class="line"><span>Nợ gốc còn phải trả</span><i></i><strong>${h(formatVND(loanBalance))}</strong></div>
      <div class="line"><span>Lãi tạm tính đến ngày ${h(date)}</span><i></i><strong>${h(formatVND(accrued))}</strong></div>
      <div class="line total"><span>Tổng gốc và lãi tạm tính</span><i></i><strong>${h(formatVND(amount))}</strong></div>
      <div class="line words"><strong>Bằng chữ: <em>${h(amountInWords(amount))}.</em></strong></div>
    </section>` : `
    <section class="statement single">
      <div class="line total"><span>Lãi tạm tính đến ngày ${h(date)}</span><i></i><strong>${h(formatVND(accrued))}</strong></div>
      <div class="line words"><strong>Bằng chữ: <em>${h(amountInWords(accrued))}.</em></strong></div>
    </section>`;
  const body = type === 'due' ? `
    <p>Yêu cầu ông/bà trước ${deadline} phải thanh toán gốc và lãi phát sinh theo hợp đồng tín dụng đã cam kết cho Quỹ tín dụng Nhân dân Bình Nguyên.</p>
    <p>Quá thời hạn nêu trên, khoản vay sẽ bị chuyển sang nợ quá hạn, đồng thời Ông/Bà phải chịu lãi suất quá hạn, các khoản phí phạt phát sinh và các biện pháp xử lý theo quy định của pháp luật và điều lệ của Quỹ. Mọi hậu quả phát sinh do việc chậm trễ thanh toán, Ông/Bà hoàn toàn chịu trách nhiệm.</p>
    <p>Chúng tôi xin trân trọng cảm ơn sự hợp tác của ông/bà.</p>` : `
    <p>Đề nghị ông/bà thanh toán lãi phát sinh cho Quỹ tín dụng nhân dân Bình Nguyên trước ${deadline}, theo đúng cam kết tại hợp đồng tín dụng.</p>
    <p>Nếu quá thời hạn trên mà Quỹ chưa nhận được khoản thanh toán, Quỹ sẽ thực hiện các biện pháp xử lý nợ theo hợp đồng tín dụng và quy định pháp luật, bao gồm xem xét thu hồi nợ trước hạn khi đủ điều kiện. Lãi chậm trả và các nghĩa vụ phát sinh (nếu có) được xác định theo thỏa thuận đã ký.</p>
    <p>Đề nghị ông/bà nghiêm túc thực hiện. Quỹ trân trọng cảm ơn sự hợp tác của ông/bà.</p>`;
  return `<!doctype html><html lang="vi"><head><meta charset="utf-8"><title>${h(title)} - HĐTD ${code}</title>
    <link data-fonts rel="stylesheet" href="${FONTS_CSS_URL}">
    <style>
      :root{--ink:#161616;--mut:#5a5a5a;--rule:#9a9a9a}
      @page{size:A4;margin:0}*{box-sizing:border-box}
      body{margin:0;color:var(--ink);background:#e9ebea;font:11pt/1.58 ${SERIF};font-variant-numeric:lining-nums tabular-nums;-webkit-font-smoothing:antialiased}
      .toolbar{font:600 13px ${SANS};padding:11px 18px;background:#fff;border-bottom:1px solid #d5dfdc;display:flex;gap:12px;align-items:center;color:#41524c}
      .toolbar button{background:#222;color:#fff;border:0;border-radius:8px;padding:9px 20px;font:700 13px ${SANS};cursor:pointer}
      .sheet{position:relative;width:210mm;min-height:297mm;margin:16px auto;background:#fff;padding:18mm 22mm 14mm;box-shadow:0 2px 14px rgba(0,0,0,.16)}
      .head{display:grid;grid-template-columns:auto 1fr;gap:5mm;align-items:center;padding-bottom:4.2mm;border-bottom:1pt solid var(--ink);position:relative}
      .head::after{content:"";position:absolute;left:0;right:0;bottom:-1.5mm;border-bottom:.35pt solid var(--ink)}
      .logo{width:16mm;height:16mm;object-fit:contain;display:block}.logo[hidden]{display:none}
      .org{font:700 14pt/1.25 ${SERIF};letter-spacing:.06em;text-transform:uppercase}
      .contact{font:400 9pt/1.4 ${SERIF};color:var(--mut);margin-top:1.2mm}
      .meta{display:flex;justify-content:space-between;align-items:baseline;margin:8mm 0 7mm;font-size:10.6pt}.meta .no{color:var(--mut)}.meta .when{font-style:italic}
      .title{text-align:center;margin-bottom:7mm}
      h1{margin:0;font:700 16.5pt/1.3 ${SERIF};letter-spacing:.12em}
      h2{margin:2mm 0 0;font:400 11.5pt ${SERIF};font-style:italic;color:#333}
      .to{margin:0 0 5mm}.to .who{font-weight:700;margin:0 0 .6mm}.to .addr{margin:0}
      .contract{display:grid;grid-template-columns:1fr 1.25fr 1.2fr 1fr;border-top:.5pt solid var(--rule);border-bottom:.5pt solid var(--rule);padding:3mm 0;margin-bottom:6mm}
      .contract>div{padding:0 3.5mm;border-left:.4pt solid #cfcfcf}.contract>div:first-child{padding-left:0;border-left:0}
      .contract span{display:block;font-size:8.8pt;letter-spacing:.06em;text-transform:uppercase;color:var(--mut);margin-bottom:.8mm}.contract strong{font-weight:700;font-size:11.5pt;white-space:nowrap}
      main{text-align:justify}p{margin:0 0 3.6mm;text-wrap:pretty}
      .statement{margin:0 0 3.4mm}
      .line{display:flex;justify-content:space-between;align-items:baseline;gap:6mm;padding:1.3mm 0;line-height:1.35;border-bottom:.4pt solid #cfcfcf;font-size:11pt}.line i{display:none}.line strong{font-weight:700}
      .line.total{padding:1.7mm 0 1.5mm;font-weight:700}.line.total strong{font-size:14pt}
      .line.words{display:block;border-bottom:1pt double var(--ink);padding:1.5mm 0 1.7mm;font-size:10.8pt;text-align:left}
      .sign{display:grid;grid-template-columns:1fr 1fr;margin-top:8mm;text-align:center;break-inside:avoid}
      .sign strong{display:block;font:700 10.5pt ${SERIF};letter-spacing:.1em;text-transform:uppercase}.sign small{display:block;font-style:italic;font-size:10pt;color:var(--mut);margin-top:.6mm}
      .sign div{height:36mm}
      @media print{body{background:#fff}.toolbar{display:none}.sheet{margin:0;box-shadow:none;width:210mm;height:296.5mm;min-height:0}body{-webkit-print-color-adjust:exact;print-color-adjust:exact}}
    </style></head><body><div class="toolbar"><button onclick="window.print()">In giấy báo</button><span>Kiểm tra số liệu và ngày yêu cầu trước khi phát hành.</span></div><article class="sheet">
      <header class="head">${logoUrl ? `<img class="logo" src="${h(logoUrl)}" alt="" onerror="this.hidden=true">` : '<span></span>'}<div><div class="org">${orgName}</div>${contactLine ? `<div class="contact">${contactLine}</div>` : ''}</div></header>
      <div class="meta"><span class="no">Số: ............................</span><span class="when">Bình Sơn, ngày ${h(day)} tháng ${h(month)} năm ${h(year)}</span></div>
      <div class="title"><h1>${h(title)}</h1><h2>Hợp đồng tín dụng số ${code}</h2></div>
      <div class="to"><div class="who">Kính gửi: Ông/Bà ${name}</div><div class="addr">Địa chỉ: ${address}</div></div>
      <section class="contract">${contractRows}</section>
      <main>${amountRows}${body}</main>
      <footer class="sign"><div><strong>CÁN BỘ TÍN DỤNG</strong><small>(Ký, ghi rõ họ tên)</small></div><div><strong>GIÁM ĐỐC</strong><small>(Ký, đóng dấu)</small></div></footer>
    </article></body></html>`;
}

let logoDataUrl = '';
let logoLoading = false;
function preloadNoticeLogo() {
  if (logoDataUrl || logoLoading || typeof document === 'undefined' || typeof fetch !== 'function' || typeof FileReader !== 'function') return;
  logoLoading = true;
  fetch(new URL('icons/logo-pcf.png', document.baseURI).href)
    .then((res) => (res.ok ? res.blob() : null))
    .then((blob) => {
      if (!blob) { logoLoading = false; return; }
      const reader = new FileReader();
      reader.onload = () => { logoDataUrl = String(reader.result || ''); logoLoading = false; };
      reader.onerror = () => { logoLoading = false; };
      reader.readAsDataURL(blob);
    })
    .catch(() => { logoLoading = false; });
}
preloadNoticeLogo();

function whenFontsReady(page) {
  const doc = page.document;
  const link = doc.querySelector('link[data-fonts]');
  const linkDone = link && !link.sheet ? new Promise((res) => { link.addEventListener('load', res); link.addEventListener('error', res); }) : Promise.resolve();
  const logo = doc.querySelector('img.logo');
  const logoDone = logo && !logo.complete ? new Promise((res) => { logo.addEventListener('load', res); logo.addEventListener('error', res); }) : Promise.resolve();
  const loaded = Promise.all([logoDone, linkDone
    .then(() => Promise.all(['600 10px "Inter"', '700 10px "Inter"', '400 10px "Source Serif 4"', '700 20px "Source Serif 4"', 'italic 400 10px "Source Serif 4"'].map((f) => doc.fonts.load(f).catch(() => null))))
    .then(() => doc.fonts.ready)]);
  return Promise.race([loaded, new Promise((res) => setTimeout(res, 3000))]);
}

export function printNotice(data) {
  const page = window.open('', '_blank', 'width=900,height=900');
  if (!page) return false;
  let logoUrl = logoDataUrl;
  if (!logoUrl) {
    preloadNoticeLogo();
    try { logoUrl = new URL('icons/logo-pcf.png', document.baseURI).href; } catch {  }
  }
  page.document.open();
  page.document.write(buildNoticeHtml({ ...data, logoUrl }));
  page.document.close();
  page.focus();
  whenFontsReady(page).then(() => { try { page.print(); } catch {  } });
  return true;
}
