import * as S from '../state.js';
import { icon } from '../icons.js';
import { pageHeader, bindHeaderActions } from '../components/shell.js';
import { statusBadge, installmentNextBoxHtml, bindInstallmentNextBox } from '../components/ui.js';
import { openModal } from '../components/modal.js';
import { formatVND, formatDate, formatNumber, stripDiacritics, debounce } from '../utils.js';
import { toast } from '../components/toast.js';
import { drawVietQrCard, drawVietQrCompact } from '../lib/vietQrLocal.js';
import { transferContent } from '../lib/transferContent.js';

export function renderHeader(headerEl) {
  headerEl.innerHTML = pageHeader({ title: 'Chi tiết hợp đồng', back: true });
  bindHeaderActions(headerEl, { back: () => history.back() });
}

export function render(contentEl, filterEl, params) {
  const contract = S.getContract(params.id);
  if (!contract) { contentEl.innerHTML = `<div class="card card-pad"><p>Không tìm thấy hợp đồng.</p></div>`; return; }
  const customer = S.getCustomer(contract.customerId);
  // Trạng thái + dòng cảnh báo xét CẢ ngày đáo hạn hợp đồng gốc LẪN "Kỳ tới"
  // của phân kỳ trả nợ (nếu có) — xem S.contractStatusInfo(). Hợp đồng
  // không có phân kỳ thì kết quả y hệt như trước giờ.
  const info = S.contractStatusInfo(contract);
  const interestPaidUntil = contract.interestPaidUntil || contract.disbursedDate;
  const interestDays = S.interestDaysAccrued(contract);
  const accrued = S.accruedInterest(contract);
  const canPay = S.effectiveContractStatus(contract) !== 'da_tat_toan';

  contentEl.innerHTML = `
    <div class="card card-pad mb-16">
      <div class="flex justify-between items-center mb-10">
        <span class="fw-700" style="font-size:15px">Hợp đồng ${contract.code}</span>
        ${statusBadge(info)}
      </div>
      <div class="oc-line"><span>Số tiền vay ban đầu</span><b>${formatVND(contract.principal)}</b></div>
      <div class="oc-line"><span>Dư nợ hiện tại</span><b style="color:var(--color-primary)">${formatVND(contract.balance)}</b></div>
      <div class="oc-line"><span>Lãi suất</span><b>${contract.interestRate}%/năm</b></div>
      <div class="oc-line"><span>Ngày giải ngân</span><b>${formatDate(contract.disbursedDate)}</b></div>
      <div class="oc-line"><span>Ngày đến hạn</span><b>${formatDate(contract.dueDate)}</b></div>
      <div class="oc-line"><span>Đã trả lãi đến ngày</span><b>${formatDate(interestPaidUntil)}</b></div>
      ${installmentNextBoxHtml(contract)}
      ${canPay ? `
      <div class="oc-line" style="padding-top:8px;border-top:1px dashed var(--border);margin-top:6px">
        <span class="fw-700">Lãi đến nay</span>
        <b style="color:var(--warning)">${formatVND(accrued)}</b>
      </div>
      <div class="field-hint">(${formatVND(contract.balance)} × ${interestDays} ngày × ${contract.interestRate}%/năm ÷ 365)</div>
      ` : ''}
      ${canPay && info.source !== 'installment' ? `
      <div class="field-hint ${info.status === 'qua_han' ? 'text-danger' : ''}" style="${info.status === 'gan_den_han' ? 'color:var(--warning)' : ''}margin-top:8px;font-size:13px">
        ${info.status === 'qua_han' ? `${icon('alert', 'icon-sm')} Hợp đồng đã quá hạn ${info.days} ngày`
          : info.status === 'gan_den_han' ? `${icon('alert', 'icon-sm')} Còn ${info.days} ngày đến hạn thanh toán`
          : `Còn ${info.days} ngày đến hạn thanh toán`}
      </div>` : ''}
    </div>

    ${canPay ? `<button class="btn btn-primary btn-block mb-10" id="btn-thanh-toan">${icon('wallet', 'icon-sm')} Thanh toán</button>` : ''}

    <a href="#/yeu-cau-tu-van?hop_dong=${contract.code}" class="btn btn-outline btn-block">
      ${icon('phone', 'icon-sm')} Liên hệ tư vấn về hợp đồng này
    </a>

    ${canPay ? `
    <div class="card card-pad mt-16 text-sm text-danger fw-700" style="text-align:center">
      ${icon('alert', 'icon-sm')} Khi đã thanh toán, vui lòng chờ đợi một thời gian sẽ được cập nhật thông tin (không chuyển khoản lại lần nữa).
    </div>` : ''}
  `;

  const btnPay = contentEl.querySelector('#btn-thanh-toan');
  if (btnPay) btnPay.addEventListener('click', () => openPaymentModal(contract, customer, accrued));
  bindInstallmentNextBox(contentEl, contract);
}

export function buildVietQrUrl({ bin, accountNo, amount, content, accountName, displayContent, displayAccountName }) {
  const info = encodeURIComponent(content);
  const name = encodeURIComponent(accountName);
  const url = `https://img.vietqr.io/image/${bin}-${accountNo}-compact2.png?amount=${Math.round(amount)}&addInfo=${info}&accountName=${name}`;
  // Ghi nhớ thông tin của link này để tự vẽ ảnh QR ngay trên máy (xem qrImageSrc / localQrFile).
  const org = S.getOrg() || {};
  qrParams.set(new URL(url, location.href).href, { bin, accountNo, amount, content, accountName, displayContent, displayAccountName, bankName: org.bankName, orgName: org.name });
  trimMap(qrParams, 40);
  // Chuẩn bị sẵn file PNG THẬT ngay từ lúc dựng link (xem getQrPngFile) để lúc
  // bấm "Chia sẻ"/"Tải ảnh" có ngay.
  prefetchQrPng(url);
  return url;
}

const qrParams = new Map(); // link QR chuẩn hóa -> thông tin tạo QR
const qrCards = new Map(); // link QR chuẩn hóa -> canvas "thẻ QR" đã vẽ
/** Cắt bỏ phần viền trắng quanh logo để logo hiện to rõ trong ô nhỏ giữa mã QR. */
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
let qrLogo = null; // logo quỹ (icons/icon-192.png) — tải sẵn lúc mở app để đặt giữa mã QR
if (typeof Image === 'function') {
  const img = new Image();
  img.onload = () => { qrLogo = trimBlank(img); qrCards.clear(); qrPngCache.clear(); }; // đã có logo: các ảnh vẽ trước đó (nếu có) vẽ lại cho có logo
  img.src = new URL('icons/icon-192.png', document.baseURI).href;
}
const qrDataKeys = new Map(); // data URL ảnh đã hiện trong popup -> link QR gốc (để Chia sẻ/Tải ảnh tìm lại đúng thông tin)
const QR_FETCH_TIMEOUT_MS = 8000; // chỉ dùng khi phải lấy ảnh từ dịch vụ ngoài (dự phòng)
const normQrUrl = (u) => qrDataKeys.get(u) || new URL(u, location.href).href;
const trimMap = (m, max) => { while (m.size > max) m.delete(m.keys().next().value); };

/** "Thẻ QR" (tên quỹ, mã QR, ngân hàng, số tài khoản, số tiền, nội dung) tự vẽ ngay trên máy — không cần mạng. */
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

/**
 * Ảnh để hiện trong ô QR của popup — luôn tự vẽ ngay trên máy (nhanh, không phụ thuộc img.vietqr.io,
 * giống hệt ảnh khi Chia sẻ/Tải). `compact`: khung gọn (mã QR có logo quỹ ở giữa + vài dòng thông tin), dùng cho ô nhỏ. Lỗi bất ngờ thì trả lại link ảnh VietQR như cũ.
 * Truyền kết quả này (img.src) cho shareQrImage/downloadQrImage như bình thường.
 */
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

/** Thẻ QR tự vẽ dạng file PNG. */
function localQrFile(url) {
  return new Promise((resolve, reject) => {
    qrCardCanvas(url).toBlob((b) => (b ? resolve(new File([b], 'qr-thanh-toan.png', { type: 'image/png' })) : reject(new Error('toBlob failed'))), 'image/png');
  });
}

// Bộ nhớ đệm file PNG theo từng link QR — dùng chung cho Chia sẻ lẫn Tải ảnh.
const qrPngCache = new Map(); // url -> { promise, file }

/**
 * (Dự phòng) Lấy ảnh QR của img.vietqr.io về dạng file PNG THẬT. img.vietqr.io có lúc trả về ảnh SVG (dù
 * link đuôi .png) — tải nguyên bản sẽ ra file ".png.svg" không mở được, và
 * trình duyệt điện thoại không cho chia sẻ file SVG qua Web Share. Vì vậy luôn
 * vẽ lại ảnh lên canvas (nền trắng) rồi xuất PNG — dùng được dù nguồn trả về
 * PNG hay SVG. fetch trước (đã chứng minh được phép tải khác nguồn), tạo blob
 * URL cùng nguồn rồi mới vẽ nên canvas không bị chặn "tainted".
 */
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
    const scale = Math.max(1, Math.min(2, 800 / Math.max(w, h))); // ảnh nhỏ thì phóng lên cho nét, tối đa 800px
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
  const url = normQrUrl(rawUrl); // chuẩn hóa — img.src trả về dạng đã chuẩn hóa / data URL, phải khớp khóa lúc dựng link
  let entry = qrPngCache.get(url);
  if (!entry) {
    // Ưu tiên ảnh tự vẽ trên máy (không cần mạng nên không bao giờ lỗi); chỉ khi không vẽ được mới lấy ảnh từ img.vietqr.io.
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
  try { getQrPngFile(url).promise.catch(() => {}); } catch (e) { /* bỏ qua — chỉ là chuẩn bị trước */ }
}

/**
 * Tải ảnh QR về máy dưới dạng file PNG thật (xem rasterizeQrToPng). Nếu không
 * xử lý được thì mở ảnh gốc ở tab mới để khách tự nhấn giữ ảnh chọn "Lưu ảnh".
 */
let qrDownloading = false; // chặn bấm liên tiếp — mỗi lần bấm thêm là 1 lượt tải nữa chồng lên thanh tiến trình của trình duyệt
export async function downloadQrImage(url, filename) {
  if (qrDownloading) return;
  qrDownloading = true;
  try {
    const file = await getQrPngFile(url).promise;
    const objUrl = URL.createObjectURL(file);
    const a = document.createElement('a');
    a.href = objUrl; a.download = filename || 'qr-thanh-toan.png';
    document.body.appendChild(a); a.click(); a.remove();
    // Giữ link tạm đủ lâu để trình duyệt điện thoại ghi xong file; thu hồi quá sớm làm lượt tải "chạy mãi" không kết thúc.
    setTimeout(() => URL.revokeObjectURL(objUrl), 60000);
    toast('Đã tải ảnh QR về máy', 'success');
  } catch (e) {
    // Chỉ còn trường hợp hiếm (cả ảnh tự vẽ cũng không tạo được): mở ảnh gốc để khách tự lưu.
    window.open(url, '_blank');
    toast('Không tải trực tiếp được — đã mở ảnh, giữ tay lên ảnh và chọn "Lưu ảnh" để tải về.', 'info');
  } finally {
    setTimeout(() => { qrDownloading = false; }, 1500);
  }
}

/**
 * Chia sẻ ảnh QR (file PNG thật) qua Web Share API — trên điện thoại mở đúng
 * bảng chọn app của hệ điều hành. File đã được chuẩn bị sẵn từ lúc hiện QR
 * (prefetchQrPng) nên navigator.share() được gọi NGAY trong lúc còn "thao tác
 * bấm" của khách — nếu phải chờ tải ảnh rồi mới gọi, trình duyệt điện thoại
 * sẽ từ chối (NotAllowedError) và báo "không hỗ trợ chia sẻ".
 */
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
    if (e && e.name === 'AbortError') return; // khách tự đóng bảng chọn, không phải lỗi
  }
  // Máy không chia sẻ được file: thử chia sẻ nội dung chuyển khoản dạng chữ,
  // rồi cuối cùng mới tải ảnh về để khách tự gửi.
  if (file) {
    toast('Máy này không chia sẻ trực tiếp ảnh được — đang tải ảnh QR về để bạn gửi qua app khác.', 'info');
    await downloadQrImage(url, 'qr-thanh-toan.png');
    return;
  }
  toast('Chưa lấy được ảnh QR — kiểm tra mạng rồi thử lại, hoặc dùng nút "Tải ảnh QR".', 'info');
}

/**
 * Ô nhập số tiền hiển thị có dấu chấm ngăn cách hàng nghìn (VD: 1.500.000)
 * khi gõ. `max` (tùy chọn) tự chặn không cho gõ vượt quá — VD: số tiền trả
 * gốc không được vượt dư nợ còn lại.
 */
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
  // Nếu đang có 1 KỲ (phân kỳ trả nợ) gần đến hạn/quá hạn (S.contractStatusInfo()
  // trả source:'installment') -> tự chọn sẵn "Trả gốc" + điền sẵn đúng số
  // tiền của kỳ đó, đỡ phải tự gõ tay. Hợp đồng thường (không có phân kỳ,
  // hoặc cảnh báo đến từ NGÀY ĐÁO HẠN hợp đồng gốc) vẫn mặc định "Trả lãi"
  // như trước giờ.
  const statusInfo = S.contractStatusInfo(contract);
  const prefillGoc = statusInfo.source === 'installment';
  let payType = prefillGoc ? 'goc' : 'lai'; // 'goc' | 'lai' | 'tat_toan'
  let principalAmount = prefillGoc ? Math.min(statusInfo.dueAmount, contract.balance) : 0;
  let interestAmount = accrued;

  const close = openModal({
    title: 'Thanh toán khoản vay',
    bodyHtml: `<div id="pay-body"></div>`,
    onMount(sheet) {
      const body = sheet.querySelector('#pay-body');

      // `text` = nội dung KHÔNG DẤU nằm trong mã QR (đúng yêu cầu ngân hàng); `shown` = cùng nội dung có dấu để người xem đọc cho dễ.
      function content() {
        if (payType === 'tat_toan') {
          const total = contract.balance + accrued;
          return { total, ...transferContent('tat_toan', contract, customer) };
        }
        const total = payType === 'goc' ? principalAmount + accrued : interestAmount;
        // Không nhúng số tiền vào nội dung — số tiền đã có ở dòng riêng + mã QR, tránh trùng lặp.
        return { total, ...transferContent(payType === 'goc' ? 'goc' : 'lai', contract, customer) };
      }

      const hasBank = org.bankBin && org.bankAccountNo;

      /** Cập nhật phần số tiền/nội dung chữ — luôn tức thì, không phụ thuộc mạng. */
      function updateAmountText() {
        // Bảng thông tin ngân hàng chỉ còn khi chưa có mã QR (khách tự chuyển khoản tay) — lúc đó hiện nội dung KHÔNG DẤU để gõ vào app ngân hàng.
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
      // Ảnh QR tải từ dịch vụ ngoài (img.vietqr.io) — mỗi lần đổi src là 1
      // request mạng render ảnh mới, gọi thẳng theo từng phím gõ (VD: gõ 9
      // chữ số tiền = 9 request liên tiếp) làm popup nặng/giật. Debounce lại,
      // chỉ tải ảnh mới khi người dùng NGƯNG gõ 400ms — số tiền/nội dung chữ
      // (updateAmountText()) vẫn cập nhật tức thì, chỉ ảnh QR trễ chút.
      const updateQrDebounced = debounce(updateQrNow, 400);
      /** Dùng khi vẽ lại toàn bộ (mở popup, đổi loại thanh toán) — cần QR đúng ngay, không debounce. */
      function updateSummary() { updateAmountText(); updateQrNow(); }
      /** Dùng khi người dùng đang gõ số tiền — chữ tức thì, ảnh QR debounce để đỡ giật. */
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
            <div style="text-align:center">
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
