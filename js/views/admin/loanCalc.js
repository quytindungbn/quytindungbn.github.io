import * as S from '../../state.js';
import { pageHeader } from '../../components/shell.js';
import { icon } from '../../icons.js';
import { toast } from '../../components/toast.js';
import { formatDate, formatVND, parseViDate, maskViDate, toDateInputValue, escapeHtml } from '../../utils.js';
import { scheduleByTerm, scheduleByPayment, addMonths, periodsUntil } from '../../lib/loanCalc.js';
import { typeIntoViDate, deleteFromViDate, caretAfterDigits } from '../../lib/dateInput.js';
import { summaryItems, loanCalcFileName, buildLoanCalcXlsx, printLoanCalc } from '../../lib/loanCalcExport.js';
import { downloadBlob, XLSX_MIME } from '../../lib/xlsxWrite.js';
import { buildLoanCalcPdf, shareOrDownload, PDF_MIME } from '../../lib/loanCalcPdf.js';
import { describeLoanCalc } from '../../lib/activityLabels.js';

const DEFAULTS = () => ({
  tab: 'term',
  principal: '',
  rate: '',
  date: formatDate(new Date()),
  months: '',
  method: 'equalPrincipal',
  payment: '',
  kind: 'gocLai',

  due: '',
  dueManual: false,

  open_equalPrincipal: false, fixed_equalPrincipal: '',
  open_annuity: false, fixed_annuity: '',
});
let st = DEFAULTS();
let lastCalc = null;
let pdfJob = null;
let warmTimer = null;

const METHODS = [
  ['equalPrincipal', 'Gốc trả đều mỗi tháng', 'Gốc bằng nhau, lãi giảm dần theo dư nợ'],
  ['annuity', 'Gốc + lãi trả đều mỗi tháng', 'Tổng phải trả mỗi tháng gần bằng nhau'],
  ['bullet', 'Lãi hàng tháng, gốc cuối kỳ', 'Mỗi tháng chỉ trả lãi, gốc trả một lần khi đến hạn'],
];

const CUSTOM = {
  equalPrincipal: { label: 'Gốc trả mỗi tháng', note: 'Từ kỳ 1 đến kỳ áp chót trả đúng số này (lãi cộng thêm), phần gốc còn lại trả hết ở kỳ cuối. Để trống thì chia đều như bình thường.' },
  annuity: { label: 'Gốc + lãi trả mỗi tháng', note: 'Từ kỳ 1 đến kỳ áp chót trả đúng số này (gồm cả gốc và lãi), phần còn lại trả hết ở kỳ cuối. Để trống thì tính như bình thường.' },
};
const DUE_NOTE = {
  term: 'Ngày đáo hạn tự tính theo Thời hạn vay. Khi cần (ví dụ đổi lãi suất giữa chừng), nhập thẳng ngày đáo hạn — thời hạn tự tính lại theo ngày đó.',
  pay: 'Ngày đáo hạn tự tính theo số tiền trả mỗi tháng. Khi cần (ví dụ đổi lãi suất giữa chừng), nhập thẳng ngày đáo hạn — đến ngày đó trả nốt phần còn lại.',
};
const KINDS = [
  ['gocLai', 'Gốc + lãi', 'Mỗi tháng trả đúng số tiền này, gồm cả gốc và lãi'],
  ['goc', 'Chỉ tiền gốc', 'Lãi tính thêm theo dư nợ còn lại, tổng trả giảm dần'],
];

const digits = (s) => String(s ?? '').replace(/\D/g, '');
const moneyText = (s) => { const d = digits(s).slice(0, 13).replace(/^0+(?=\d)/, ''); return d.replace(/\B(?=(\d{3})+(?!\d))/g, '.'); };
const rateText = (s) => {
  const t = String(s ?? '').replace(/[^\d.,]/g, '').replace('.', ',');
  const i = t.indexOf(',');
  return (i < 0 ? t : t.slice(0, i + 1) + t.slice(i + 1).replace(/,/g, '')).slice(0, 7);
};
const numFromMoney = (s) => Number(digits(s)) || 0;
const numFromRate = (s) => { const n = parseFloat(String(s).replace(',', '.')); return Number.isFinite(n) ? n : 0; };

function readInputs() {
  const principal = numFromMoney(st.principal);
  const ratePercent = numFromRate(st.rate);
  const startDate = parseViDate(st.date);
  if (!(principal > 0)) return { error: 'Nhập số tiền vay.' };
  if (!(ratePercent > 0) || ratePercent > 100) return { error: 'Nhập lãi suất (%/năm), từ trên 0 đến 100.' };
  if (!startDate) return { error: 'Nhập ngày vay đúng dạng ngày/tháng/năm, ví dụ 22/10/2026.' };

  const dueText = st.dueManual ? String(st.due || '').trim() : '';
  let endDate = null;
  if (dueText) {
    endDate = parseViDate(dueText);
    if (!endDate) return { error: 'Nhập ngày đáo hạn đúng dạng ngày/tháng/năm, ví dụ 22/10/2028.' };
    if (!(endDate.getTime() > startDate.getTime())) return { error: 'Ngày đáo hạn phải sau Ngày vay.' };
    if (endDate.getTime() > addMonths(startDate, 600).getTime()) return { error: 'Ngày đáo hạn quá xa: tối đa 600 tháng kể từ Ngày vay.' };
  }
  if (st.tab === 'term') {
    const months = endDate ? 0 : Number(digits(st.months)) || 0;
    if (!endDate && (months < 1 || months > 600)) return { error: 'Nhập thời hạn vay từ 1 đến 600 tháng.' };
    const inputs = { tab: 'term', principal, ratePercent, startDate, months, method: st.method };
    if (endDate) inputs.endDate = endDate;
    if (CUSTOM[st.method] && st[`open_${st.method}`]) {
      const fixedAmount = numFromMoney(st[`fixed_${st.method}`]);
      if (fixedAmount > 0) inputs.fixedAmount = fixedAmount;
    }
    return { inputs };
  }
  const payment = numFromMoney(st.payment);
  if (!(payment > 0)) return { error: 'Nhập số tiền trả mỗi tháng.' };
  const inputs = { tab: 'pay', principal, ratePercent, startDate, payment, kind: st.kind };
  if (endDate) inputs.endDate = endDate;
  return { inputs };
}

function calculate() {
  const read = readInputs();
  if (read.error) return { error: read.error };
  const { inputs } = read;
  const result = inputs.tab === 'term'
    ? scheduleByTerm({ principal: inputs.principal, ratePercent: inputs.ratePercent, months: inputs.months, startDate: inputs.startDate, method: inputs.method, fixedAmount: inputs.fixedAmount, endDate: inputs.endDate })
    : scheduleByPayment({ principal: inputs.principal, ratePercent: inputs.ratePercent, payment: inputs.payment, startDate: inputs.startDate, kind: inputs.kind, endDate: inputs.endDate });
  if (!result) return { error: 'Số liệu chưa hợp lệ, hãy kiểm tra lại.' };
  if (inputs.endDate && result.rows) inputs.months = result.rows.length;
  if (result.error === 'khong_du_tra_lai') return { error: `Số tiền trả mỗi tháng chưa đủ trả lãi tháng đầu (${formatVND(result.firstInterest)}). Hãy nhập số tiền lớn hơn.`, firstInterest: result.firstInterest };
  if (result.error === 'tra_het_truoc_han') {
    return { error: inputs.method === 'annuity'
      ? 'Số tiền gốc + lãi trả mỗi tháng quá lớn: khoản vay sẽ trả hết trước kỳ cuối. Hãy nhập số nhỏ hơn, hoặc dùng tab "Theo số tiền trả hàng tháng".'
      : `Gốc trả mỗi tháng quá lớn: khoản vay sẽ trả hết trước kỳ cuối. Với thời hạn này, hãy nhập số không quá ${formatVND(Math.floor((result.maxAmount || 0) / 1000) * 1000)}.` };
  }
  if (result.error === 'qua_dai') return { error: 'Với số tiền trả mỗi tháng này, phải trả hơn 600 tháng. Hãy tăng số tiền trả mỗi tháng.' };
  return { inputs, result };
}

const nf = (n) => Math.round(n).toLocaleString('vi-VN');

function tilesHtml(inputs, result) {
  const items = summaryItems(inputs, result);
  const T = result.totals, last = result.rows[result.rows.length - 1];
  const [gốc, lãi, phải, time] = items;
  const tile = (label, value, sub, hi) => `<div class="lc-tile${hi ? ' hi' : ''}"><small>${escapeHtml(label)}</small><strong>${escapeHtml(value)}</strong><span>${escapeHtml(sub)}</span></div>`;
  const dueText = `Đến ${formatDate(last.to)}`;
  const months = `${T.months} tháng`;
  return inputs.tab === 'term'
    ? tile(gốc.label, formatVND(T.principal), 'Số tiền vay') + tile(lãi.label, formatVND(T.interest), `${T.days} ngày thực tế`, true) + tile(phải.label, formatVND(T.payment), 'Gốc + lãi') + tile(time.label, months, dueText)
    : tile(time.label, months, dueText, true) + tile(gốc.label, formatVND(T.principal), 'Số tiền vay') + tile(lãi.label, formatVND(T.interest), `${T.days} ngày thực tế`) + tile(phải.label, formatVND(T.payment), 'Gốc + lãi');
}

function tableHtml(result) {
  const T = result.totals;
  const short = (d) => { const t = formatDate(d); return `${t.slice(0, 6)}${t.slice(8)}`; };
  const body = result.rows.map((r, i) => `<tr class="${i === result.rows.length - 1 ? 'last' : ''}"><td>Kỳ ${r.k}<div class="c2d m">${short(r.to)}</div></td><td class="dk m">${formatDate(r.to)}</td><td class="dk m">${r.days}</td><td class="dk m">${nf(r.opening)}</td><td class="g">${r.principal ? nf(r.principal) : '—'}</td><td class="i">${nf(r.interest)}</td><td class="p">${nf(r.payment)}</td><td class="dk m">${nf(r.closing)}</td></tr>`).join('');
  return `<table class="lc-t"><thead><tr><th>Kỳ</th><th class="dk">Ngày trả</th><th class="dk">Số ngày</th><th class="dk">Dư nợ đầu kỳ</th><th>Trả gốc</th><th>Trả lãi</th><th>Phải trả</th><th class="dk">Còn nợ</th></tr></thead><tbody>${body}</tbody>
    <tfoot><tr><td>Cộng</td><td class="dk"></td><td class="dk">${T.days}</td><td class="dk"></td><td>${nf(T.principal)}</td><td>${nf(T.interest)}</td><td>${nf(T.payment)}</td><td class="dk"></td></tr></tfoot></table>`;
}

function fixedNoteHtml(inputs, result) {
  if (!(inputs.fixedAmount > 0) || result.rows.length < 2) return '';
  const last = result.rows[result.rows.length - 1], n = result.rows.length;
  const text = inputs.method === 'annuity'
    ? `Kỳ 1 đến kỳ ${n - 1}: trả ${formatVND(inputs.fixedAmount)} mỗi tháng (gồm gốc và lãi). Kỳ ${n} (kỳ cuối): trả nốt ${formatVND(last.payment)}, gồm gốc còn lại ${formatVND(last.principal)} và lãi kỳ này.`
    : `Kỳ 1 đến kỳ ${n - 1}: trả gốc ${formatVND(inputs.fixedAmount)} mỗi tháng. Kỳ ${n} (kỳ cuối): trả nốt gốc còn lại ${formatVND(last.principal)} cùng lãi kỳ này.`;
  return `<div class="lc-callout">${icon('info', 'icon-sm')}<span>${escapeHtml(text)}</span></div>`;
}

function payDueNoteHtml(inputs, result) {
  if (inputs.tab !== 'pay' || !inputs.endDate) return '';
  const n = result.rows.length, last = result.rows[n - 1], due = formatDate(inputs.endDate);
  let text = '';
  if (last.to.getTime() < inputs.endDate.getTime()) text = `Với số tiền này, khoản vay trả hết vào ngày ${formatDate(last.to)}, sớm hơn ngày đáo hạn ${due}.`;
  else if (n >= 2) {
    text = inputs.kind === 'goc'
      ? `Kỳ 1 đến kỳ ${n - 1}: trả gốc ${formatVND(inputs.payment)} mỗi tháng. Kỳ ${n} (kỳ cuối, đến ngày đáo hạn ${due}): trả nốt gốc còn lại ${formatVND(last.principal)} cùng lãi kỳ này.`
      : `Kỳ 1 đến kỳ ${n - 1}: trả ${formatVND(inputs.payment)} mỗi tháng (gồm gốc và lãi). Kỳ ${n} (kỳ cuối, đến ngày đáo hạn ${due}): trả nốt ${formatVND(last.payment)}, gồm gốc còn lại ${formatVND(last.principal)} và lãi kỳ này.`;
  }
  return text ? `<div class="lc-callout">${icon('info', 'icon-sm')}<span>${escapeHtml(text)}</span></div>` : '';
}

function outHtml(calc) {
  if (calc.error) return `<div class="lc-msg" role="status">${icon('info', 'icon-sm')}<span>${escapeHtml(calc.error)}</span></div>`;
  return `
    <div class="lc-sum">${tilesHtml(calc.inputs, calc.result)}</div>${fixedNoteHtml(calc.inputs, calc.result)}${payDueNoteHtml(calc.inputs, calc.result)}
    <section class="lux-card"><h3 class="lux-h"><span>Bảng trả hàng tháng</span>
      <span class="lux-h-end lc-tools"><button type="button" class="lc-tool" id="lc-export" aria-haspopup="menu" aria-expanded="false">${icon('download', 'icon-sm')}<span>Xuất file</span>${icon('chevronDown', 'icon-sm')}</button><button type="button" class="lc-tool" id="lc-print">${icon('printer', 'icon-sm')}<span>In</span></button><button type="button" class="lc-tool" id="lc-share">${icon('share', 'icon-sm')}<span>Chia sẻ</span></button></span></h3>
      <div class="lc-tw">${tableHtml(calc.result)}</div></section>
    <p class="lc-note">Lãi tính theo số ngày thực tế của từng kỳ, 365 ngày một năm: lãi = dư nợ × lãi suất × số ngày ÷ 365, mỗi kỳ làm tròn đến nghìn đồng. Kết quả chỉ để tham khảo, không lưu vào hợp đồng.</p>`;
}

function optionsHtml(name, list, current) {
  return list.map(([value, title, desc]) => `<button type="button" role="radio" aria-checked="${value === current}" class="lc-opt${value === current ? ' on' : ''}" data-${name}="${value}"><i class="rd"></i><span class="tx"><b>${title}</b><span>${desc}</span></span></button>`).join('');
}

const moreLabel = (m, open) => `${open ? 'Đóng' : 'Mở'} ô nhập số tiền trả mỗi tháng — ${METHODS.find((x) => x[0] === m)[1]}`;

function methodOptionsHtml() {
  return METHODS.map(([value, title, desc]) => {
    const opt = `<button type="button" role="radio" aria-checked="${value === st.method}" class="lc-opt${value === st.method ? ' on' : ''}" data-method="${value}"><i class="rd"></i><span class="tx"><b>${title}</b><span>${desc}</span></span></button>`;
    const custom = CUSTOM[value];
    if (!custom) return opt;
    const open = !!st[`open_${value}`];

    const panel = `<div class="lc-panelw" id="lc-panel-${value}"><div class="lc-panelin"><div class="lc-panel"><div class="lc-f"><label for="lc-fixed-${value}">${custom.label}</label><div class="box"><input id="lc-fixed-${value}" value="${escapeHtml(st[`fixed_${value}`])}" autocomplete="off" inputmode="numeric" placeholder="Ví dụ: 5.000.000"><i>₫</i></div></div><p class="lc-panel-note">${custom.note}</p></div></div></div>`;
    return `<div class="lc-optw${open ? ' open' : ''}" data-m="${value}">${opt}<button type="button" class="lc-more" data-more="${value}" aria-expanded="${open}" aria-controls="lc-panel-${value}" aria-label="${moreLabel(value, open)}" title="Tự nhập số tiền trả mỗi tháng">${icon('chevronDown', 'icon-sm')}</button>${panel}</div>`;
  }).join('');
}

function pageHtml() {
  const term = st.tab === 'term';
  const field = (label, id, value, unit, extra = '', cls = '') => `<div class="lc-f ${cls}"><label for="${id}">${label}</label><div class="box"><input id="${id}" value="${escapeHtml(value)}" autocomplete="off" ${extra}>${unit ? `<i>${unit}</i>` : ''}</div></div>`;
  const dateField = `<div class="lc-f dt"><label for="lc-date">Ngày vay</label><div class="box"><input id="lc-date" value="${escapeHtml(st.date)}" inputmode="numeric" maxlength="10" autocomplete="off" placeholder="dd/mm/yyyy"><button type="button" class="lc-cal" id="lc-cal" aria-label="Chọn ngày trên lịch">${icon('calendar', 'icon-sm')}</button><input type="date" id="lc-date-native" tabindex="-1" aria-hidden="true"></div></div>`;
  const dueField = `<div class="lc-f dt due${st.dueManual || !st.due ? '' : ' auto'}"><label for="lc-due">Ngày đáo hạn</label><div class="box"><input id="lc-due" value="${escapeHtml(st.due)}" inputmode="numeric" maxlength="10" autocomplete="off" placeholder="dd/mm/yyyy"><button type="button" class="lc-cal" id="lc-cal-due" aria-label="Chọn ngày đáo hạn trên lịch">${icon('calendar', 'icon-sm')}</button><input type="date" id="lc-due-native" tabindex="-1" aria-hidden="true"></div></div>`;
  const fields = term
    ? `<div class="lc-row c5 q">${field('Số tiền vay', 'lc-principal', st.principal, '₫', 'inputmode="numeric"', 'w')}${field('Lãi suất', 'lc-rate', st.rate, '%/năm', 'inputmode="decimal"')}${field('Thời hạn vay', 'lc-months', st.months, 'tháng', 'inputmode="numeric"')}${dateField}${dueField}</div>
       <p class="lc-hint-row">${DUE_NOTE.term}</p>
       <div class="lc-opts-wrap"><div class="lc-lab" id="lc-lab-method">Cách trả</div><div class="lc-row c3 opts" role="radiogroup" aria-labelledby="lc-lab-method">${methodOptionsHtml()}</div></div>`
    : `<div class="lc-row c5 q pay">${field('Số tiền vay', 'lc-principal', st.principal, '₫', 'inputmode="numeric"', 'w')}${field('Lãi suất', 'lc-rate', st.rate, '%/năm', 'inputmode="decimal"')}<div class="lc-f pw">${field('Số tiền trả mỗi tháng', 'lc-payment', st.payment, '₫', 'inputmode="numeric"', 'nested')}<div class="hint" id="lc-hint"></div></div>${dateField}${dueField}</div>
       <p class="lc-hint-row">${DUE_NOTE.pay}</p>
       <div class="lc-opts-wrap"><div class="lc-lab" id="lc-lab-kind">Số tiền trả mỗi tháng là</div><div class="lc-row c2 opts" role="radiogroup" aria-labelledby="lc-lab-kind">${optionsHtml('kind', KINDS, st.kind)}</div></div>`;
  return `
    <div class="lux-root lc">
      <div class="lc-tabs" role="tablist"><button type="button" role="tab" aria-selected="${term}" class="${term ? 'on' : ''}" data-tab="term">Theo thời hạn vay</button><button type="button" role="tab" aria-selected="${!term}" class="${!term ? 'on' : ''}" data-tab="pay">Theo số tiền trả hàng tháng</button></div>
      <section class="lux-card"><h3 class="lux-h"><span>Thông tin khoản vay</span></h3>${fields}
        <div class="lc-act"><button type="button" class="rs" id="lc-reset">Nhập lại</button><button type="button" class="go" id="lc-go">Tính lãi</button></div></section>
      <div id="lc-out"></div>
    </div>`;
}

function exportData(calc = lastCalc) {
  if (!calc) return null;
  return { org: S.getOrg(), inputs: calc.inputs, result: calc.result, printedOn: new Date() };
}

export function renderHeader(headerEl) {
  headerEl.innerHTML = pageHeader({ title: 'Tính lãi vay' });
  const avatar = headerEl.querySelector('.avatar');
  if (avatar) avatar.innerHTML = icon('calculator', 'icon-sm');
}

export function refresh() {}

let closeExportMenu = null;

function downloadExcel() {
  const data = exportData(); if (!data) return;
  downloadBlob(buildLoanCalcXlsx(data), loanCalcFileName(new Date(), 'xlsx'), XLSX_MIME);
  S.logUiAction('loan-calc-export', 'Tải file **Excel** bảng tính lãi vay');
  toast('Đã tải file Excel', 'success');
}

async function downloadPdf() {
  if (!lastCalc) return;
  const job = pdfFor(lastCalc);
  if (!job.ready) toast('Đang tạo file PDF…');
  try {
    const bytes = await job.promise;
    downloadBlob(bytes, loanCalcFileName(new Date(), 'pdf'), PDF_MIME);
    S.logUiAction('loan-calc-export', 'Tải file **PDF** bảng tính lãi vay');
    toast('Đã tải file PDF', 'success');
  } catch (e) {
    toast('Không tạo được file PDF, hãy thử lại.', 'error');
  }
}

function openExportMenu(btn) {
  closeExportMenu?.();
  const menu = document.createElement('div');
  menu.className = 'customer-notice-menu from-button lc-menu';
  menu.setAttribute('role', 'menu');
  menu.setAttribute('aria-label', 'Chọn định dạng file tải xuống');
  menu.innerHTML = `
    <div class="customer-notice-menu-heading">Tải xuống</div>
    <button type="button" role="menuitem" data-fmt="xlsx">${icon('fileSheet')}<span><b>Excel (.xlsx)</b><small>Bảng tính, sửa được</small></span></button>
    <button type="button" role="menuitem" data-fmt="pdf">${icon('filePdf')}<span><b>PDF</b><small>Giống bản in, để lưu và gửi</small></span></button>`;
  document.body.append(menu);
  const r = btn.getBoundingClientRect(), b = menu.getBoundingClientRect();
  menu.style.left = `${Math.max(8, Math.min(r.left, window.innerWidth - b.width - 8))}px`;
  menu.style.top = `${Math.max(8, Math.min(r.bottom + 6, window.innerHeight - b.height - 8))}px`;
  const close = () => {
    menu.remove();
    btn.classList.remove('is-open'); btn.setAttribute('aria-expanded', 'false');
    document.removeEventListener('pointerdown', outside);
    document.removeEventListener('keydown', escape);
    window.removeEventListener('scroll', close, true);
    window.removeEventListener('resize', close);
    if (closeExportMenu === close) closeExportMenu = null;
  };
  const outside = (e) => { if (!menu.contains(e.target) && !btn.contains(e.target)) close(); };
  const escape = (e) => { if (e.key === 'Escape') { e.stopPropagation(); close(); btn.focus(); } };
  closeExportMenu = close;
  btn.classList.add('is-open'); btn.setAttribute('aria-expanded', 'true');
  document.addEventListener('pointerdown', outside);
  document.addEventListener('keydown', escape);
  window.addEventListener('scroll', close, true);
  window.addEventListener('resize', close);
  menu.querySelectorAll('[data-fmt]').forEach((item) => item.addEventListener('click', () => {
    const fmt = item.dataset.fmt;
    close();
    if (fmt === 'xlsx') downloadExcel(); else downloadPdf();
  }));
  menu.querySelector('button')?.focus();
}

function pdfFor(calc) {
  if (pdfJob && pdfJob.calc === calc) return pdfJob;
  const job = { calc, ready: false, promise: null };
  job.promise = buildLoanCalcPdf(exportData(calc)).then((bytes) => { job.ready = true; return bytes; });
  job.promise.catch(() => { if (pdfJob === job) pdfJob = null; });
  pdfJob = job;
  return job;
}

async function sharePdf(btn) {
  if (!lastCalc || btn.disabled) return;
  const job = pdfFor(lastCalc);
  const label = btn.querySelector('span');
  if (!job.ready) { btn.disabled = true; label.textContent = 'Đang tạo…'; }
  try {
    const bytes = await job.promise;
    const result = await shareOrDownload(bytes, loanCalcFileName(new Date(), 'pdf'), 'Bảng tính lãi vay');
    if (result !== 'need-tap') S.logUiAction('loan-calc-share', 'Chia sẻ bảng tính lãi vay (file PDF)');
    if (result === 'download') toast('Đã lưu file PDF', 'success');
    else if (result === 'need-tap') toast('File PDF đã sẵn sàng. Bấm Chia sẻ lần nữa để gửi.');
  } catch (e) {
    toast('Không tạo được file PDF, hãy thử lại.', 'error');
  } finally {
    btn.disabled = false; label.textContent = 'Chia sẻ';
  }
}

function fitInput(el) {
  if (!el || !el.clientWidth) return;
  el.style.fontSize = '';
  let size = 16;
  while (size > 9 && el.scrollWidth > el.clientWidth) { size -= 0.5; el.style.fontSize = `${size}px`; }
}
const fitAll = (root = document) => root.querySelectorAll('.lc-f .box input:not([type="date"])').forEach(fitInput);
let fitBound = false;

function derivedDue() {
  const start = parseViDate(st.date);
  if (!start) return '';
  if (st.tab === 'term') {
    const n = Number(digits(st.months)) || 0;
    return n >= 1 && n <= 600 ? formatDate(addMonths(start, n)) : '';
  }
  const principal = numFromMoney(st.principal), ratePercent = numFromRate(st.rate), payment = numFromMoney(st.payment);
  if (!(principal > 0) || !(ratePercent > 0 && ratePercent <= 100) || !(payment > 0)) return '';
  const r = scheduleByPayment({ principal, ratePercent, payment, startDate: start, kind: st.kind });
  return r && r.rows ? formatDate(r.rows[r.rows.length - 1].to) : '';
}

export function render(contentEl, opts) {
  const recalc = !!(opts && opts.recalc === true);
  if (!st.dueManual) st.due = derivedDue();
  contentEl.innerHTML = pageHtml();
  const out = contentEl.querySelector('#lc-out');
  lastCalc = null;
  let shown = false;

  const clearOut = () => {
    shown = false;
    lastCalc = null;
    clearTimeout(warmTimer);
    pdfJob = null;
    closeExportMenu?.();
    out.innerHTML = '';
    const hint = contentEl.querySelector('#lc-hint');
    if (hint) hint.textContent = '';
  };

  const pressCalc = () => { update(); S.logUiAction('loan-calc', describeLoanCalc(lastCalc ? lastCalc.inputs : null)); };
  const update = () => {
    shown = true;
    const calc = calculate();
    closeExportMenu?.();
    lastCalc = calc.error ? null : calc;
    out.innerHTML = outHtml(calc);

    clearTimeout(warmTimer);
    if (lastCalc) { const mine = lastCalc; warmTimer = setTimeout(() => { if (lastCalc === mine) pdfFor(mine).promise.catch(() => {}); }, 500); }
    const hint = contentEl.querySelector('#lc-hint');
    if (hint) {
      const first = calc.firstInterest ?? (calc.result && calc.result.firstInterest);
      hint.textContent = first ? `Phải lớn hơn lãi tháng đầu: ${formatVND(first)}` : '';
    }
    const x = out.querySelector('#lc-export'), p = out.querySelector('#lc-print'), sh = out.querySelector('#lc-share');
    if (x) x.addEventListener('click', () => (x.classList.contains('is-open') ? closeExportMenu?.() : openExportMenu(x)));
    if (p) p.addEventListener('click', () => {
      const data = exportData(); if (!data) return;
      if (!printLoanCalc(data)) toast('Trình duyệt đang chặn cửa sổ in. Hãy cho phép cửa sổ bật lên rồi thử lại.', 'error');
      else S.logUiAction('loan-calc-print', 'In bảng tính lãi vay');
    });
    if (sh) sh.addEventListener('click', () => sharePdf(sh));
  };

  const setVal = (id, v) => { const el = contentEl.querySelector(id); if (el) { el.value = v; fitInput(el); } };
  const markDue = () => { const f = contentEl.querySelector('#lc-due')?.closest('.lc-f'); if (f) f.classList.toggle('auto', !st.dueManual && !!st.due); };
  const syncMonthsFromDue = () => {
    const start = parseViDate(st.date), end = parseViDate(st.due);
    const n = start && end ? periodsUntil(start, end) : 0;
    if (n) { st.months = String(n); setVal('#lc-months', st.months); }
  };
  const refreshDue = () => {
    if (st.dueManual) { if (st.tab === 'term') syncMonthsFromDue(); }
    else { st.due = derivedDue(); setVal('#lc-due', st.due); }
    markDue();
  };
  const onMonths = () => { st.dueManual = false; refreshDue(); };
  const onDue = () => { st.dueManual = st.due.trim() !== ''; if (st.dueManual && st.tab === 'term') syncMonthsFromDue(); markDue(); };

  const bindInput = (id, key, mask, after, caretOf) => {
    const el = contentEl.querySelector(id); if (!el) return;
    el.addEventListener('input', () => {
      const before = el.value, selStart = el.selectionStart ?? before.length;
      const next = mask(before);
      if (next !== before) {
        el.value = next;
        const pos = caretOf ? caretOf(before, selStart, next) : Math.max(0, next.length - (before.length - selStart));
        try { el.setSelectionRange(pos, pos); } catch {  }
      }
      st[key] = el.value; after?.(); fitInput(el); clearOut();
    });
    el.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); pressCalc(); el.blur(); } });
  };

  const bindDateInput = (id, key, after) => {
    bindInput(id, key, maskViDate, after, (before, selStart, next) => caretAfterDigits(next, before.slice(0, selStart).replace(/\D/g, '').length));
    const el = contentEl.querySelector(id); if (!el) return;
    el.addEventListener('beforeinput', (e) => {
      if (el.readOnly || e.isComposing) return;
      const a = el.selectionStart ?? 0, b = el.selectionEnd ?? a;
      let r = null;
      if (e.inputType === 'insertText') r = typeIntoViDate(el.value, a, b, e.data);
      else if (e.inputType === 'deleteContentBackward') r = deleteFromViDate(el.value, a, b, false);
      else if (e.inputType === 'deleteContentForward') r = deleteFromViDate(el.value, a, b, true);
      if (!r) return;
      e.preventDefault();
      const changed = r.value !== el.value;
      el.value = r.value;
      try { el.setSelectionRange(r.caret, r.caret); } catch {  }
      if (changed) { st[key] = el.value; after?.(); fitInput(el); clearOut(); }
    });
  };
  bindInput('#lc-principal', 'principal', moneyText, refreshDue);
  bindInput('#lc-rate', 'rate', rateText, refreshDue);
  bindInput('#lc-months', 'months', (s) => digits(s).slice(0, 3), onMonths);
  bindInput('#lc-payment', 'payment', moneyText, onMonths);
  for (const m of Object.keys(CUSTOM)) bindInput(`#lc-fixed-${m}`, `fixed_${m}`, moneyText);
  bindDateInput('#lc-date', 'date', refreshDue);
  bindDateInput('#lc-due', 'due', onDue);

  contentEl.querySelector('#lc-due')?.addEventListener('change', () => { if (!st.due.trim()) { st.dueManual = false; refreshDue(); } });

  const bindDatePicker = (dateEl, native, calBtn, key, after) => {
    if (!dateEl || !native || !calBtn) return;
    const openCalendar = () => {
      const d = parseViDate(dateEl.value) || new Date();
      native.value = toDateInputValue(d);
      if (typeof native.showPicker === 'function') { try { native.showPicker(); return; } catch {  } }
      native.focus(); native.click();
    };
    native.addEventListener('change', () => { if (!native.value) return; const [y, m, d] = native.value.split('-'); dateEl.value = `${d}/${m}/${y}`; st[key] = dateEl.value; after?.(); fitInput(dateEl); clearOut(); });
    calBtn.addEventListener('click', openCalendar);
    if (window.matchMedia('(pointer: coarse)').matches) { dateEl.readOnly = true; dateEl.addEventListener('click', openCalendar); }
  };
  bindDatePicker(contentEl.querySelector('#lc-date'), contentEl.querySelector('#lc-date-native'), contentEl.querySelector('#lc-cal'), 'date', refreshDue);
  bindDatePicker(contentEl.querySelector('#lc-due'), contentEl.querySelector('#lc-due-native'), contentEl.querySelector('#lc-cal-due'), 'due', onDue);

  const redoIfShown = () => { if (shown) update(); };

  contentEl.querySelectorAll('[data-tab]').forEach((b) => b.addEventListener('click', () => { if (st.tab !== b.dataset.tab) { const had = shown; st.tab = b.dataset.tab; render(contentEl, { recalc: had }); } }));

  const setOpen = (m, open) => {
    st[`open_${m}`] = open;
    const w = contentEl.querySelector(`.lc-optw[data-m="${m}"]`); if (!w) return;
    w.classList.toggle('open', open);
    const more = w.querySelector('[data-more]');
    if (more) { more.setAttribute('aria-expanded', String(open)); more.setAttribute('aria-label', moreLabel(m, open)); }
  };
  const closeOthers = (keep) => { for (const m of Object.keys(CUSTOM)) if (m !== keep && st[`open_${m}`]) setOpen(m, false); };
  contentEl.querySelectorAll('[data-method]').forEach((b) => b.addEventListener('click', () => { st.method = b.dataset.method; closeOthers(st.method); setChecked(contentEl, '[data-method]', 'method', st.method); redoIfShown(); }));

  contentEl.querySelectorAll('[data-more]').forEach((b) => b.addEventListener('click', () => {
    const m = b.dataset.more, willOpen = !st[`open_${m}`];
    if (willOpen) { st.method = m; closeOthers(m); setChecked(contentEl, '[data-method]', 'method', m); }
    setOpen(m, willOpen);
    if (shown) { if (calculate().error) clearOut(); else update(); }
    if (willOpen) contentEl.querySelector(`#lc-fixed-${m}`)?.focus({ preventScroll: true });
  }));
  contentEl.querySelectorAll('[data-kind]').forEach((b) => b.addEventListener('click', () => { st.kind = b.dataset.kind; setChecked(contentEl, '[data-kind]', 'kind', st.kind); refreshDue(); redoIfShown(); }));
  contentEl.querySelector('#lc-reset').addEventListener('click', () => { st = { ...DEFAULTS(), tab: st.tab }; render(contentEl); });
  contentEl.querySelector('#lc-go').addEventListener('click', () => {
    pressCalc();
    if (window.matchMedia('(max-width: 899px)').matches) out.scrollIntoView({ behavior: 'smooth', block: 'start' });
  });
  if (recalc && !calculate().error) update();
  fitAll(contentEl);
  if (!fitBound) { fitBound = true; window.addEventListener('resize', () => fitAll()); }
}

function setChecked(root, selector, key, value) {
  root.querySelectorAll(selector).forEach((b) => { const on = b.dataset[key] === value; b.classList.toggle('on', on); b.setAttribute('aria-checked', String(on)); });
}
