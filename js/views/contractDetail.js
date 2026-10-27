import * as S from '../state.js';
import { icon } from '../icons.js';
import { pageHeader, bindHeaderActions } from '../components/shell.js';
import { installmentNextBoxHtml, bindInstallmentNextBox } from '../components/ui.js';
import { cwChip, cwTermPercent } from '../components/customerHero.js';
import { openModal } from '../components/modal.js';
import { formatVND, formatDate, formatNumber, stripDiacritics, debounce, escapeHtml } from '../utils.js';
import { toast } from '../components/toast.js';
import { drawVietQrCard, drawVietQrCompact } from '../lib/vietQrLocal.js';
import { transferContent } from '../lib/transferContent.js';

export function renderHeader(headerEl) {
  headerEl.classList.add('cw-off');
  headerEl.innerHTML = pageHeader({ title: 'Chi tiết hợp đồng', back: true });
  bindHeaderActions(headerEl, { back: () => history.back() });
}

export function render(contentEl, filterEl, params) {
  const contract = S.getContract(params.id);
  contentEl.classList.add('cw-on');
  if (!contract) { contentEl.innerHTML = `<div class="cw"><div class="cw-empty"><b>Không tìm thấy hợp đồng.</b><a href="#/">Về trang chủ</a></div></div>`; return; }
  const customer = S.getCustomer(contract.customerId);

  const info = S.contractStatusInfo(contract);
  const interestPaidUntil = contract.interestPaidUntil || contract.disbursedDate;
  const interestDays = S.interestDaysAccrued(contract);
  const accrued = S.accruedInterest(contract);
  const canPay = S.effectiveContractStatus(contract) !== 'da_tat_toan';
  const row = (label, value) => `<div class="cw-sl"><span>${label}</span><em></em><b>${value}</b></div>`;
  const alertHtml = canPay && info.source !== 'installment'
    ? (info.status === 'qua_han' ? `<span class="al bad">${icon('alert', 'icon-sm')}Hợp đồng đã quá hạn ${info.days} ngày</span>`
      : info.status === 'gan_den_han' ? `<span class="al">${icon('alert', 'icon-sm')}Còn ${info.days} ngày đến hạn thanh toán</span>`
        : `<span class="al mut">Còn ${info.days} ngày đến hạn thanh toán</span>`)
    : '';

  contentEl.innerHTML = `
  <div class="cw"><div class="cw-wrap">
    <header class="cw-hero d">
      <div class="cw-top"><span style="display:flex;align-items:center;gap:12px"><button type="button" class="cw-back" id="btn-back-cw" aria-label="Quay lại">${icon('arrowLeft')}</button><span class="cw-eb">Chi tiết hợp đồng</span></span></div>
      <div class="row2">
        <div><h1 class="cw-code">Hợp đồng ${escapeHtml(contract.code)}</h1>${cwChip(info)}</div>
        <div>
          <div class="cw-amt"><small>Dư nợ hiện tại</small><strong class="foil">${formatVND(contract.balance)}</strong></div>
          <div class="cw-line" style="--p:${cwTermPercent(contract, !canPay)}%"><b></b><i></i></div>
          <div class="cw-dates"><span>Ngày giải ngân<b>${formatDate(contract.disbursedDate)}</b></span><span>Ngày đến hạn<b>${formatDate(contract.dueDate)}</b></span></div>
        </div>
      </div>
    </header>
    <div class="cw-split">
      <div class="cw-c1">
        <section class="cw-statement">
          ${row('Số tiền vay ban đầu', formatVND(contract.principal))}
          ${row('Lãi suất', `${contract.interestRate}%/năm`)}
          ${row('Ngày giải ngân', formatDate(contract.disbursedDate))}
          ${row('Ngày đến hạn', formatDate(contract.dueDate))}
          ${row('Đã trả lãi đến ngày', formatDate(interestPaidUntil))}
        </section>
        <div class="cw-inst">${installmentNextBoxHtml(contract)}</div>
        <div class="cw-act a2"><a href="#/yeu-cau-tu-van?hop_dong=${contract.code}" class="cw-btn sec">${icon('phone', 'icon-sm')} Liên hệ tư vấn về hợp đồng này</a></div>
      </div>
      <div class="cw-c2">
        ${canPay ? `
        <section class="cw-intp">
          <div class="row"><span>Lãi đến nay</span><strong>${formatVND(accrued)}</strong></div>
          <p>(${formatVND(contract.balance)} × ${interestDays} ngày × ${contract.interestRate}%/năm ÷ 365)</p>
          ${alertHtml}
        </section>
        <div class="cw-act a1"><button type="button" class="cw-btn pri" id="btn-thanh-toan">${icon('wallet', 'icon-sm')} Thanh toán</button></div>
        <div class="cw-note">${icon('alert', 'icon-sm')}<span>Khi đã thanh toán, vui lòng chờ đợi một thời gian sẽ được cập nhật thông tin (không chuyển khoản lại lần nữa).</span></div>` : ''}
      </div>
    </div>
  </div></div>`;

  const btnPay = contentEl.querySelector('#btn-thanh-toan');
  if (btnPay) btnPay.addEventListener('click', () => openPaymentModal(contract, customer, accrued));
  contentEl.querySelector('#btn-back-cw').addEventListener('click', () => history.back());
  bindInstallmentNextBox(contentEl, contract);
}

export function buildVietQrUrl({ bin, accountNo, amount, content, accountName, displayContent, displayAccountName }) {
  const info = encodeURIComponent(content);
  const name = encodeURIComponent(accountName);
  const url = `https://img.vietqr.io/image/${bin}-${accountNo}-compact2.png?amount=${Math.round(amount)}&addInfo=${info}&accountName=${name}`;

  const org = S.getOrg() || {};
  qrParams.set(new URL(url, location.href).href, { bin, accountNo, amount, content, accountName, displayContent, displayAccountName, bankName: org.bankName, orgName: org.name });
  trimMap(qrParams, 40);

  prefetchQrPng(url);
  return url;
}

const qrParams = new Map();
const qrCards = new Map();

function trimBlank(img) {
  try {
    const w = img.naturalWidth, h = img.naturalHeight;
    const c = document.createElement('canvas'); c.width = w; c.height = h;
    const ctx = c.getContext('2d'); ctx.drawImage(img, 0, 0);
    const d = ctx.getImageData(0, 0, w, h).data;
    let x0 = w, y0 = h, x1 = -1, y1 = -1;
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4;
      if (d[i + 3] > 20 && (d[i] < 245 || d[i + 1] < 245 || d[i + 2] < 245)) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
    }
    if (x1 < 0) return img;
    const o = document.createElement('canvas'); o.width = x1 - x0 + 1; o.height = y1 - y0 + 1;
    o.getContext('2d').drawImage(c, x0, y0, o.width, o.height, 0, 0, o.width, o.height);
    return o;
  } catch (e) {
    return img;
  }
}
let qrLogo = null;
if (typeof Image === 'function') {
  const img = new Image();
  img.onload = () => { qrLogo = trimBlank(img); qrCards.clear(); qrPngCache.clear(); };
  img.src = new URL('icons/logo-pcf.png', document.baseURI).href;
}
const qrDataKeys = new Map();
const QR_FETCH_TIMEOUT_MS = 8000;
const normQrUrl = (u) => qrDataKeys.get(u) || new URL(u, location.href).href;
const trimMap = (m, max) => { while (m.size > max) m.delete(m.keys().next().value); };

function qrCardCanvas(url) {
  let canvas = qrCards.get(url);
  if (!canvas) {
    const p = qrParams.get(url);
    if (!p) throw new Error('no qr params');
    canvas = drawVietQrCard(p, { logo: qrLogo });
    qrCards.set(url, canvas); trimMap(qrCards, 20);
  }
  return canvas;
}

export function qrImageSrc(rawUrl, { compact = false } = {}) {
  try {
    const url = normQrUrl(rawUrl);
    const p = qrParams.get(url);
    if (!p) return rawUrl;
    const dataUrl = (compact ? drawVietQrCompact(p, { logo: qrLogo }) : qrCardCanvas(url)).toDataURL('image/png');
    qrDataKeys.set(dataUrl, url); trimMap(qrDataKeys, 20);
    return dataUrl;
  } catch (e) {
    return rawUrl;
  }
}

function localQrFile(url) {
  return new Promise((resolve, reject) => {
    qrCardCanvas(url).toBlob((b) => (b ? resolve(new File([b], 'qr-thanh-toan.png', { type: 'image/png' })) : reject(new Error('toBlob failed'))), 'image/png');
  });
}

const qrPngCache = new Map();

async function rasterizeQrToPng(url) {
  const ctl = typeof AbortController === 'function' ? new AbortController() : null;
  const timer = ctl ? setTimeout(() => ctl.abort(), QR_FETCH_TIMEOUT_MS) : 0;
  let res;
  try { res = await fetch(url, ctl ? { signal: ctl.signal } : undefined); } finally { clearTimeout(timer); }
  if (!res.ok) throw new Error('fetch failed');
  const srcBlob = await res.blob();
  const objUrl = URL.createObjectURL(srcBlob);
  try {
    const img = new Image();
    await new Promise((resolve, reject) => { img.onload = resolve; img.onerror = () => reject(new Error('decode failed')); img.src = objUrl; });
    const w = img.naturalWidth || 600;
    const h = img.naturalHeight || w;
    const scale = Math.max(1, Math.min(2, 800 / Math.max(w, h)));
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(w * scale); canvas.height = Math.round(h * scale);
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
    const pngBlob = await new Promise((resolve, reject) => canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('toBlob failed'))), 'image/png'));
    return new File([pngBlob], 'qr-thanh-toan.png', { type: 'image/png' });
  } finally {
    URL.revokeObjectURL(objUrl);
  }
}

function getQrPngFile(rawUrl) {
  const url = normQrUrl(rawUrl);
  let entry = qrPngCache.get(url);
  if (!entry) {

    entry = { file: null, promise: null };
    entry.promise = localQrFile(url)
      .catch(() => rasterizeQrToPng(url))
      .then((f) => { entry.file = f; return f; })
      .catch((e) => { qrPngCache.delete(url); throw e; });
    qrPngCache.set(url, entry); trimMap(qrPngCache, 20);
  }
  return entry;
}
function prefetchQrPng(url) {
  try { getQrPngFile(url).promise.catch(() => {}); } catch (e) {  }
}

let qrDownloading = false;
export async function downloadQrImage(url, filename) {
  if (qrDownloading) return;
  qrDownloading = true;
  try {
    const file = await getQrPngFile(url).promise;
    const objUrl = URL.createObjectURL(file);
    const a = document.createElement('a');
    a.href = objUrl; a.download = filename || 'qr-thanh-toan.png';
    document.body.appendChild(a); a.click(); a.remove();

    setTimeout(() => URL.revokeObjectURL(objUrl), 60000);
    toast('Đã tải ảnh QR về máy', 'success');
  } catch (e) {

    window.open(url, '_blank');
    toast('Không tải trực tiếp được — đã mở ảnh, giữ tay lên ảnh và chọn "Lưu ảnh" để tải về.', 'info');
  } finally {
    setTimeout(() => { qrDownloading = false; }, 1500);
  }
}

export async function shareQrImage(url, text) {
  const entry = getQrPngFile(url);
  let file = entry.file;
  try {
    if (!file) file = await entry.promise;
    if (navigator.canShare && navigator.canShare({ files: [file] })) {
      await navigator.share({ files: [file], title: 'Mã QR chuyển khoản', text });
      return;
    }
  } catch (e) {
    if (e && e.name === 'AbortError') return;
  }

  if (file) {
    toast('Máy này không chia sẻ trực tiếp ảnh được — đang tải ảnh QR về để bạn gửi qua app khác.', 'info');
    await downloadQrImage(url, 'qr-thanh-toan.png');
    return;
  }
  toast('Chưa lấy được ảnh QR — kiểm tra mạng rồi thử lại, hoặc dùng nút "Tải ảnh QR".', 'info');
}

export function bindMoneyInput(inputEl, initial, onChange, max) {
  inputEl.value = initial ? formatNumber(initial) : '';
  inputEl.addEventListener('input', () => {
    let raw = Number(inputEl.value.replace(/\D/g, '')) || 0;
    if (max != null && raw > max) raw = max;
    inputEl.value = raw ? formatNumber(raw) : '';
    onChange(raw);
  });
}

function openPaymentModal(contract, customer, accrued) {
  const org = S.getOrg();

  const statusInfo = S.contractStatusInfo(contract);
  const prefillGoc = statusInfo.source === 'installment';
  let payType = prefillGoc ? 'goc' : 'lai';
  let principalAmount = prefillGoc ? Math.min(statusInfo.dueAmount, contract.balance) : 0;
  let interestAmount = accrued;

  const close = openModal({
    title: 'Thanh toán khoản vay',
    sheetClass: 'cw-paysheet',
    bodyHtml: `<div id="pay-body"></div>`,
    onMount(sheet) {
      const body = sheet.querySelector('#pay-body');

      function content() {
        if (payType === 'tat_toan') {
          const total = contract.balance + accrued;
          return { total, ...transferContent('tat_toan', contract, customer) };
        }
        const total = payType === 'goc' ? principalAmount + accrued : interestAmount;

        return { total, ...transferContent(payType === 'goc' ? 'goc' : 'lai', contract, customer) };
      }

      const hasBank = org.bankBin && org.bankAccountNo;

      function updateAmountText() {

        const { total, text } = content();
        const amountEl = body.querySelector('#sum-amount');
        const contentEl = body.querySelector('#sum-content');
        if (amountEl) amountEl.textContent = formatVND(total);
        if (contentEl) contentEl.textContent = text;
      }
      function updateQrNow() {
        if (!hasBank) return;
        const img = body.querySelector('#qr-img');
        if (!img) return;
        const { total, text, shown } = content();
        img.src = qrImageSrc(buildVietQrUrl({ bin: org.bankBin, accountNo: org.bankAccountNo, amount: total, content: text, accountName: org.bankAccountName, displayContent: shown, displayAccountName: org.bankAccountDisplayName }));
      }

      const updateQrDebounced = debounce(updateQrNow, 400);

      function updateSummary() { updateAmountText(); updateQrNow(); }

      function updateSummaryTyping() { updateAmountText(); updateQrDebounced(); }

      function draw() {
        body.innerHTML = `
          <div class="field">
            <label>Chọn loại thanh toán</label>
            <div class="radio-row">
              <div class="radio-opt ${payType === 'goc' ? 'active' : ''}" data-type="goc">Trả gốc</div>
              <div class="radio-opt ${payType === 'lai' ? 'active' : ''}" data-type="lai">Trả lãi</div>
              <div class="radio-opt ${payType === 'tat_toan' ? 'active' : ''}" data-type="tat_toan">Tất toán</div>
            </div>
          </div>
          ${payType === 'goc' ? `
            <div class="field-hint mb-8">Tiền lãi tính đúng theo hợp đồng (không đổi được): <b>${formatVND(accrued)}</b></div>
            <div class="field"><label>Số tiền gốc muốn trả</label><input type="text" inputmode="numeric" id="principal-input"/></div>
          ` : payType === 'lai' ? `
            <div class="field"><label>Số tiền lãi</label><input type="text" inputmode="numeric" id="interest-input"/></div>
            <div class="field-hint mb-8">Mặc định lấy theo lãi phát sinh đến hôm nay, bạn có thể sửa lại nếu cần.</div>
          ` : `
            <div class="card card-pad mb-16" style="background:var(--surface-alt)">
              <div class="oc-line"><span>Trả gốc</span><b>${formatVND(contract.balance)}</b></div>
              <div class="oc-line"><span>Trả lãi</span><b>${formatVND(accrued)}</b></div>
            </div>
          `}
          ${hasBank ? '' : `
          <div class="card card-pad mb-16" style="background:var(--surface-alt)">
            <div class="oc-line"><span>Ngân hàng</span><b>${org.bankName || '—'}</b></div>
            <div class="oc-line"><span>Số tài khoản</span><b>${org.bankAccountNo || '—'}</b></div>
            <div class="oc-line"><span>Chủ tài khoản</span><b>${org.bankAccountDisplayName || org.bankAccountName || '—'}</b></div>
            <div class="oc-line"><span>Số tiền</span><b id="sum-amount" style="color:var(--color-primary)"></b></div>
            <div class="oc-line" style="align-items:flex-start"><span>Nội dung</span><b id="sum-content" style="text-align:right;max-width:65%"></b></div>
          </div>
          `}
          ${hasBank ? `
            <div class="pay-qr" style="text-align:center">
              <button type="button" class="btn btn-outline btn-block btn-qr-pay mb-8" id="btn-download-qr">${icon('download', 'icon-sm')} Tải mã QR này để thực hiện thanh toán</button>
              <img id="qr-img" alt="Mã QR chuyển khoản" style="max-width:320px;width:100%;border:1px solid var(--border);border-radius:12px"/>
              <button type="button" class="btn btn-outline btn-block mt-8" id="btn-share-qr">${icon('wallet', 'icon-sm')} Chia sẻ ảnh QR</button>
            </div>
          ` : `
            <div class="field-hint text-danger">Quỹ chưa cấu hình mã QR (mã ngân hàng). Vui lòng chuyển khoản thủ công theo thông tin ở trên, hoặc liên hệ quầy giao dịch.</div>
          `}
        `;
        body.querySelectorAll('[data-type]').forEach((opt) => {
          opt.addEventListener('click', () => { payType = opt.dataset.type; draw(); });
        });
        const pInput = body.querySelector('#principal-input');
        if (pInput) bindMoneyInput(pInput, principalAmount, (v) => { principalAmount = v; updateSummaryTyping(); }, contract.balance);
        const iInput = body.querySelector('#interest-input');
        if (iInput) bindMoneyInput(iInput, interestAmount, (v) => { interestAmount = v; updateSummaryTyping(); });
        const shareBtn = body.querySelector('#btn-share-qr');
        if (shareBtn) shareBtn.addEventListener('click', () => {
          const { shown } = content();
          shareQrImage(body.querySelector('#qr-img').src, shown);
        });
        const downloadBtn = body.querySelector('#btn-download-qr');
        if (downloadBtn) downloadBtn.addEventListener('click', () => {
          downloadQrImage(body.querySelector('#qr-img').src, `qr-thanh-toan-${contract.code}.png`);
        });
        updateSummary();
      }
      draw();
    },
  });
  return close;
}
