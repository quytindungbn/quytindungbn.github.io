import * as S from '../../state.js';
import { pageHeader } from '../../components/shell.js';
import { icon } from '../../icons.js';
import { toast } from '../../components/toast.js';
import { formatDate, formatVND, parseViDate, maskViDate, toDateInputValue, escapeHtml } from '../../utils.js';
import { scheduleByTerm, scheduleByPayment } from '../../lib/loanCalc.js';
import { summaryItems, loanCalcFileName, buildLoanCalcXlsx, printLoanCalc } from '../../lib/loanCalcExport.js';
import { downloadBlob, XLSX_MIME } from '../../lib/xlsxWrite.js';
import { buildLoanCalcPdf, shareOrDownload, PDF_MIME } from '../../lib/loanCalcPdf.js';

// ------------------------------------------------------------
// Trang "Tính lãi vay" (menu Công cụ) — tính nhanh lãi và số gốc + lãi phải trả từng tháng cho một khoản vay, không lưu vào hợp đồng.
// Hai cách: theo THỜI HẠN vay (chọn cách trả) hoặc theo SỐ TIỀN TRẢ HÀNG THÁNG (ra số tháng). Lãi tính 365 ngày/năm theo số ngày thực tế
// từng tháng, làm tròn nghìn đồng (xem js/lib/loanCalc.js). Có nút xuất Excel và in. Ô nhập để trống (không có số liệu mẫu); kết quả CHỈ hiện
// khi bấm "Tính lãi" (hoặc Enter); sửa ô nhập thì kết quả cũ được xóa để không hiện số lệch với ô nhập, còn đổi cách trả thì giữ số liệu và tính lại ngay. Mọi ô nhập giữ nguyên khi có
// dữ liệu mới (refresh() không làm gì) và khi đổi tab.
// ------------------------------------------------------------

const DEFAULTS = () => ({
  tab: 'term',
  principal: '',
  rate: '',
  date: formatDate(new Date()),
  months: '',
  method: 'equalPrincipal',
  payment: '',
  kind: 'gocLai',
});
let st = DEFAULTS();
let lastCalc = null; // { inputs, result } của lần tính gần nhất hợp lệ — để xuất/in đúng số đang hiện
let pdfJob = null; // { calc, ready, promise }: file PDF đang/đã tạo cho đúng kết quả đang hiện — tạo sẵn ở nền ngay sau khi tính để bấm Chia sẻ là gửi liền
let warmTimer = null;

const METHODS = [
  ['equalPrincipal', 'Gốc trả đều mỗi tháng', 'Gốc bằng nhau, lãi giảm dần theo dư nợ'],
  ['annuity', 'Gốc + lãi trả đều mỗi tháng', 'Tổng phải trả mỗi tháng gần bằng nhau'],
  ['bullet', 'Lãi hàng tháng, gốc cuối kỳ', 'Mỗi tháng chỉ trả lãi, gốc trả một lần khi đến hạn'],
];
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

/** Đọc ô nhập thành số; trả { inputs } hoặc { error } nói rõ thiếu/sai ở đâu. */
function readInputs() {
  const principal = numFromMoney(st.principal);
  const ratePercent = numFromRate(st.rate);
  const startDate = parseViDate(st.date);
  if (!(principal > 0)) return { error: 'Nhập số tiền vay.' };
  if (!(ratePercent > 0) || ratePercent > 100) return { error: 'Nhập lãi suất (%/năm), từ trên 0 đến 100.' };
  if (!startDate) return { error: 'Nhập ngày vay đúng dạng ngày/tháng/năm, ví dụ 22/10/2026.' };
  if (st.tab === 'term') {
    const months = Number(digits(st.months)) || 0;
    if (months < 1 || months > 600) return { error: 'Nhập thời hạn vay từ 1 đến 600 tháng.' };
    return { inputs: { tab: 'term', principal, ratePercent, startDate, months, method: st.method } };
  }
  const payment = numFromMoney(st.payment);
  if (!(payment > 0)) return { error: 'Nhập số tiền trả mỗi tháng.' };
  return { inputs: { tab: 'pay', principal, ratePercent, startDate, payment, kind: st.kind } };
}

function calculate() {
  const read = readInputs();
  if (read.error) return { error: read.error };
  const { inputs } = read;
  const result = inputs.tab === 'term'
    ? scheduleByTerm({ principal: inputs.principal, ratePercent: inputs.ratePercent, months: inputs.months, startDate: inputs.startDate, method: inputs.method })
    : scheduleByPayment({ principal: inputs.principal, ratePercent: inputs.ratePercent, payment: inputs.payment, startDate: inputs.startDate, kind: inputs.kind });
  if (!result) return { error: 'Số liệu chưa hợp lệ, hãy kiểm tra lại.' };
  if (result.error === 'khong_du_tra_lai') return { error: `Số tiền trả mỗi tháng chưa đủ trả lãi tháng đầu (${formatVND(result.firstInterest)}). Hãy nhập số tiền lớn hơn.`, firstInterest: result.firstInterest };
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

function outHtml(calc) {
  if (calc.error) return `<div class="lc-msg" role="status">${icon('info', 'icon-sm')}<span>${escapeHtml(calc.error)}</span></div>`;
  return `
    <div class="lc-sum">${tilesHtml(calc.inputs, calc.result)}</div>
    <section class="lux-card"><h3 class="lux-h"><span>Bảng trả hàng tháng</span>
      <span class="lux-h-end lc-tools"><button type="button" class="lc-tool" id="lc-export" aria-haspopup="menu" aria-expanded="false">${icon('download', 'icon-sm')}<span>Xuất file</span>${icon('chevronDown', 'icon-sm')}</button><button type="button" class="lc-tool" id="lc-print">${icon('printer', 'icon-sm')}<span>In</span></button><button type="button" class="lc-tool" id="lc-share">${icon('share', 'icon-sm')}<span>Chia sẻ</span></button></span></h3>
      <div class="lc-tw">${tableHtml(calc.result)}</div></section>
    <p class="lc-note">Lãi tính theo số ngày thực tế của từng kỳ, 365 ngày một năm: lãi = dư nợ × lãi suất × số ngày ÷ 365, mỗi kỳ làm tròn đến nghìn đồng. Kết quả chỉ để tham khảo, không lưu vào hợp đồng.</p>`;
}

function optionsHtml(name, list, current) {
  return list.map(([value, title, desc]) => `<button type="button" role="radio" aria-checked="${value === current}" class="lc-opt${value === current ? ' on' : ''}" data-${name}="${value}"><i class="rd"></i><span class="tx"><b>${title}</b><span>${desc}</span></span></button>`).join('');
}

function pageHtml() {
  const term = st.tab === 'term';
  const field = (label, id, value, unit, extra = '', cls = '') => `<div class="lc-f ${cls}"><label for="${id}">${label}</label><div class="box"><input id="${id}" value="${escapeHtml(value)}" autocomplete="off" ${extra}>${unit ? `<i>${unit}</i>` : ''}</div></div>`;
  const dateField = `<div class="lc-f"><label for="lc-date">Ngày vay</label><div class="box"><input id="lc-date" value="${escapeHtml(st.date)}" inputmode="numeric" maxlength="10" autocomplete="off" placeholder="dd/mm/yyyy"><button type="button" class="lc-cal" id="lc-cal" aria-label="Chọn ngày trên lịch">${icon('calendar', 'icon-sm')}</button><input type="date" id="lc-date-native" tabindex="-1" aria-hidden="true"></div></div>`;
  const fields = term
    ? `<div class="lc-row c4">${field('Số tiền vay', 'lc-principal', st.principal, '₫', 'inputmode="numeric"', 'w')}${field('Lãi suất', 'lc-rate', st.rate, '%/năm', 'inputmode="decimal"')}${field('Thời hạn vay', 'lc-months', st.months, 'tháng', 'inputmode="numeric"')}${dateField}</div>
       <div class="lc-opts-wrap"><div class="lc-lab" id="lc-lab-method">Cách trả</div><div class="lc-row c3 opts" role="radiogroup" aria-labelledby="lc-lab-method">${optionsHtml('method', METHODS, st.method)}</div></div>`
    : `<div class="lc-row c4">${field('Số tiền vay', 'lc-principal', st.principal, '₫', 'inputmode="numeric"', 'w')}${field('Lãi suất', 'lc-rate', st.rate, '%/năm', 'inputmode="decimal"')}${dateField}<div class="lc-f w">${field('Số tiền trả mỗi tháng', 'lc-payment', st.payment, '₫', 'inputmode="numeric"', 'nested')}<div class="hint" id="lc-hint"></div></div></div>
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

// Ô nhập được giữ nguyên khi có dữ liệu mới từ máy chủ (xem renderApp() trong app.js) — không vẽ lại gì cả.
export function refresh() {}

let closeExportMenu = null;

/** Tải file Excel của kết quả đang hiện. */
function downloadExcel() {
  const data = exportData(); if (!data) return;
  downloadBlob(buildLoanCalcXlsx(data), loanCalcFileName(new Date(), 'xlsx'), XLSX_MIME);
  toast('Đã tải file Excel', 'success');
}

/** Tải file PDF của kết quả đang hiện (dùng file đã tạo sẵn ở nền; chưa xong thì chờ). */
async function downloadPdf() {
  if (!lastCalc) return;
  const job = pdfFor(lastCalc);
  if (!job.ready) toast('Đang tạo file PDF…');
  try {
    const bytes = await job.promise;
    downloadBlob(bytes, loanCalcFileName(new Date(), 'pdf'), PDF_MIME);
    toast('Đã tải file PDF', 'success');
  } catch (e) {
    toast('Không tạo được file PDF, hãy thử lại.', 'error');
  }
}

/** Menu nhỏ dưới nút "Xuất file": chọn tải Excel hoặc PDF. */
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

/** Việc tạo file PDF cho một kết quả (dùng lại nếu đã/đang tạo cho đúng kết quả đó). */
function pdfFor(calc) {
  if (pdfJob && pdfJob.calc === calc) return pdfJob;
  const job = { calc, ready: false, promise: null };
  job.promise = buildLoanCalcPdf(exportData(calc)).then((bytes) => { job.ready = true; return bytes; });
  job.promise.catch(() => { if (pdfJob === job) pdfJob = null; }); // lỗi thì lần bấm sau tạo lại
  pdfJob = job;
  return job;
}

/** Mở bảng chia sẻ (Zalo, Messenger, thư...) với file PDF giống bản in; máy không hỗ trợ chia sẻ tệp thì tải file về. File thường đã được tạo sẵn nên gửi ngay. */
async function sharePdf(btn) {
  if (!lastCalc || btn.disabled) return;
  const job = pdfFor(lastCalc);
  const label = btn.querySelector('span');
  if (!job.ready) { btn.disabled = true; label.textContent = 'Đang tạo…'; }
  try {
    const bytes = await job.promise;
    const result = await shareOrDownload(bytes, loanCalcFileName(new Date(), 'pdf'), 'Bảng tính lãi vay');
    if (result === 'download') toast('Đã lưu file PDF', 'success');
    else if (result === 'need-tap') toast('File PDF đã sẵn sàng. Bấm Chia sẻ lần nữa để gửi.');
  } catch (e) {
    toast('Không tạo được file PDF, hãy thử lại.', 'error');
  } finally {
    btn.disabled = false; label.textContent = 'Chia sẻ';
  }
}

// Tham số thứ hai của app.js là phần tử bộ lọc (không dùng ở trang này); chỉ { recalc: true } do chính trang này gọi lại khi đổi tab mới có nghĩa.
export function render(contentEl, opts) {
  const recalc = !!(opts && opts.recalc === true);
  contentEl.innerHTML = pageHtml();
  const out = contentEl.querySelector('#lc-out');
  lastCalc = null;
  let shown = false; // đang hiện kết quả (hoặc thông báo thiếu số liệu) sau khi bấm "Tính lãi"

  // Sửa ô nhập: xóa kết quả cũ, đợi bấm "Tính lãi" mới hiện lại. (Đổi cách trả thì giữ nguyên số liệu và tính lại ngay, xem redoIfShown.)
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

  const update = () => {
    shown = true;
    const calc = calculate();
    closeExportMenu?.();
    lastCalc = calc.error ? null : calc;
    out.innerHTML = outHtml(calc);
    // Tạo sẵn file PDF ở nền ngay sau khi tính (chờ nửa giây cho ổn định) — bấm Chia sẻ là gửi liền, không phải đợi.
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
    });
    if (sh) sh.addEventListener('click', () => sharePdf(sh));
  };
  const bindInput = (id, key, mask) => {
    const el = contentEl.querySelector(id); if (!el) return;
    el.addEventListener('input', () => {
      const before = el.value, caretFromEnd = before.length - (el.selectionStart ?? before.length);
      const next = mask(before);
      if (next !== before) { el.value = next; const pos = Math.max(0, next.length - caretFromEnd); try { el.setSelectionRange(pos, pos); } catch { /* ô không hỗ trợ con trỏ */ } }
      st[key] = el.value; clearOut();
    });
    el.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); update(); el.blur(); } });
  };
  bindInput('#lc-principal', 'principal', moneyText);
  bindInput('#lc-rate', 'rate', rateText);
  bindInput('#lc-months', 'months', (s) => digits(s).slice(0, 3));
  bindInput('#lc-payment', 'payment', moneyText);
  bindInput('#lc-date', 'date', maskViDate);

  // Ngày vay: gõ dd/mm/yyyy hoặc chọn trên lịch; điện thoại (chạm) mở thẳng lịch thay vì bàn phím.
  const dateEl = contentEl.querySelector('#lc-date'), native = contentEl.querySelector('#lc-date-native');
  const openCalendar = () => {
    const d = parseViDate(dateEl.value) || new Date();
    native.value = toDateInputValue(d);
    if (typeof native.showPicker === 'function') { try { native.showPicker(); return; } catch { /* dùng cách dự phòng */ } }
    native.focus(); native.click();
  };
  native.addEventListener('change', () => { if (!native.value) return; const [y, m, d] = native.value.split('-'); dateEl.value = `${d}/${m}/${y}`; st.date = dateEl.value; clearOut(); });
  contentEl.querySelector('#lc-cal').addEventListener('click', openCalendar);
  if (window.matchMedia('(pointer: coarse)').matches) { dateEl.readOnly = true; dateEl.addEventListener('click', openCalendar); }

  // Đã bấm "Tính lãi" rồi mà đổi cách trả: giữ nguyên số liệu đã nhập, tính lại ngay theo cách mới. Chưa bấm thì chưa hiện gì.
  const redoIfShown = () => { if (shown) update(); };
  // Đổi sang cách tính kia: số liệu dùng chung (số tiền vay, lãi suất, ngày vay) giữ nguyên; đã có kết quả thì tính lại ngay nếu đủ số liệu, thiếu thì để trống chờ nhập.
  contentEl.querySelectorAll('[data-tab]').forEach((b) => b.addEventListener('click', () => { if (st.tab !== b.dataset.tab) { const had = shown; st.tab = b.dataset.tab; render(contentEl, { recalc: had }); } }));
  contentEl.querySelectorAll('[data-method]').forEach((b) => b.addEventListener('click', () => { st.method = b.dataset.method; setChecked(contentEl, '[data-method]', 'method', st.method); redoIfShown(); }));
  contentEl.querySelectorAll('[data-kind]').forEach((b) => b.addEventListener('click', () => { st.kind = b.dataset.kind; setChecked(contentEl, '[data-kind]', 'kind', st.kind); redoIfShown(); }));
  contentEl.querySelector('#lc-reset').addEventListener('click', () => { st = { ...DEFAULTS(), tab: st.tab }; render(contentEl); });
  contentEl.querySelector('#lc-go').addEventListener('click', () => {
    update();
    if (window.matchMedia('(max-width: 899px)').matches) out.scrollIntoView({ behavior: 'smooth', block: 'start' });
  });
  if (recalc && !calculate().error) update();
}

function setChecked(root, selector, key, value) {
  root.querySelectorAll(selector).forEach((b) => { const on = b.dataset[key] === value; b.classList.toggle('on', on); b.setAttribute('aria-checked', String(on)); });
}

