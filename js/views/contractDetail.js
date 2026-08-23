import * as S from '../state.js';
import { icon } from '../icons.js';
import { pageHeader, bindHeaderActions } from '../components/shell.js';
import { statusBadge } from '../components/ui.js';
import { openModal } from '../components/modal.js';
import { formatVND, formatDate, formatNumber, daysUntil, stripDiacritics, debounce } from '../utils.js';
import { toast } from '../components/toast.js';

export function renderHeader(headerEl) {
  headerEl.innerHTML = pageHeader({ title: 'Chi tiết hợp đồng', back: true });
  bindHeaderActions(headerEl, { back: () => history.back() });
}

export function render(contentEl, filterEl, params) {
  const contract = S.getContract(params.id);
  if (!contract) { contentEl.innerHTML = `<div class="card card-pad"><p>Không tìm thấy hợp đồng.</p></div>`; return; }
  const customer = S.getCustomer(contract.customerId);
  const status = S.CONTRACT_STATUS_MAP[S.effectiveContractStatus(contract)];
  const d = daysUntil(contract.dueDate);
  const interestPaidUntil = contract.interestPaidUntil || contract.disbursedDate;
  const interestDays = S.interestDaysAccrued(contract);
  const accrued = S.accruedInterest(contract);
  const canPay = S.effectiveContractStatus(contract) !== 'da_tat_toan';

  contentEl.innerHTML = `
    <div class="card card-pad mb-16">
      <div class="flex justify-between items-center mb-10">
        <span class="fw-700" style="font-size:15px">Hợp đồng ${contract.code}</span>
        ${statusBadge(status)}
      </div>
      <div class="oc-line"><span>Số tiền vay ban đầu</span><b>${formatVND(contract.principal)}</b></div>
      <div class="oc-line"><span>Dư nợ hiện tại</span><b style="color:var(--color-primary)">${formatVND(contract.balance)}</b></div>
      <div class="oc-line"><span>Lãi suất</span><b>${contract.interestRate}%/năm</b></div>
      <div class="oc-line"><span>Ngày giải ngân</span><b>${formatDate(contract.disbursedDate)}</b></div>
      <div class="oc-line"><span>Ngày đến hạn</span><b>${formatDate(contract.dueDate)}</b></div>
      <div class="oc-line"><span>Đã trả lãi đến ngày</span><b>${formatDate(interestPaidUntil)}</b></div>
      ${canPay ? `
      <div class="oc-line" style="padding-top:8px;border-top:1px dashed var(--border);margin-top:6px">
        <span class="fw-700">Lãi đến nay</span>
        <b style="color:var(--warning)">${formatVND(accrued)}</b>
      </div>
      <div class="field-hint">(${formatVND(contract.balance)} × ${interestDays} ngày × ${contract.interestRate}%/năm ÷ 365)</div>
      ` : ''}
      ${canPay ? `
      <div class="field-hint ${d < 0 ? 'text-danger' : ''}" style="margin-top:8px;font-size:13px">
        ${d < 0 ? `${icon('alert', 'icon-sm')} Hợp đồng đã quá hạn ${Math.abs(d)} ngày` : `Còn ${d} ngày đến hạn thanh toán`}
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
}

export function buildVietQrUrl({ bin, accountNo, amount, content, accountName }) {
  const info = encodeURIComponent(content);
  const name = encodeURIComponent(accountName);
  return `https://img.vietqr.io/image/${bin}-${accountNo}-compact2.png?amount=${Math.round(amount)}&addInfo=${info}&accountName=${name}`;
}

/**
 * Tải ảnh QR về máy. img.vietqr.io là ảnh khác nguồn (cross-origin) nên thử
 * tải qua fetch+blob trước (tải file thật); nếu bị chặn CORS thì mở ảnh ở
 * tab mới để khách tự nhấn giữ ảnh (long-press) chọn "Lưu ảnh" — luôn dùng
 * được trên điện thoại dù fetch thất bại.
 */
export async function downloadQrImage(url, filename) {
  try {
    const res = await fetch(url);
    if (!res.ok) throw new Error('fetch failed');
    const blob = await res.blob();
    const objUrl = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = objUrl; a.download = filename;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(objUrl), 2000);
    toast('Đã tải ảnh QR về máy', 'success');
  } catch (e) {
    window.open(url, '_blank');
    toast('Không tải trực tiếp được — đã mở ảnh, giữ tay lên ảnh và chọn "Lưu ảnh" để tải về.', 'info');
  }
}

/**
 * Chia sẻ ảnh QR qua Web Share API — trên điện thoại sẽ mở đúng bảng chọn
 * app có sẵn của hệ điều hành (giống khi chia sẻ từ Zalo/Ảnh...), khách
 * chọn ứng dụng ngân hàng/ví nào hỗ trợ nhận ảnh để quét là xong. Đây là
 * API chuẩn của trình duyệt — không đi qua dịch vụ ngoài nào. Máy tính/trình
 * duyệt không hỗ trợ chia sẻ sẽ tự chuyển sang tải ảnh về.
 */
export async function shareQrImage(url, text) {
  try {
    const res = await fetch(url);
    const blob = await res.blob();
    const file = new File([blob], 'qr-thanh-toan.png', { type: blob.type || 'image/png' });
    if (navigator.canShare && navigator.canShare({ files: [file] })) {
      await navigator.share({ files: [file], title: 'Mã QR chuyển khoản', text });
      return;
    }
  } catch (e) {
    if (e && e.name === 'AbortError') return; // khách tự đóng bảng chọn, không phải lỗi
  }
  if (navigator.share) {
    try { await navigator.share({ title: 'Mã QR chuyển khoản', text, url }); return; }
    catch (e) { if (e && e.name === 'AbortError') return; }
  }
  toast('Trình duyệt này không hỗ trợ chia sẻ trực tiếp — dùng nút "Tải ảnh QR" rồi mở app ngân hàng để quét từ ảnh.', 'info');
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
  let payType = 'lai'; // 'goc' | 'lai' | 'tat_toan'
  let principalAmount = 0;
  let interestAmount = accrued;

  const close = openModal({
    title: 'Thanh toán khoản vay',
    bodyHtml: `<div id="pay-body"></div>`,
    onMount(sheet) {
      const body = sheet.querySelector('#pay-body');

      function content() {
        if (payType === 'tat_toan') {
          const total = contract.balance + accrued;
          const text = stripDiacritics(`TAT TOAN HDTD ${contract.code} ${customer.name}`);
          return { total, text };
        }
        const total = payType === 'goc' ? principalAmount + accrued : interestAmount;
        const loai = payType === 'goc' ? 'GOC' : 'LAI';
        // Không nhúng số tiền vào nội dung — số tiền đã có ở dòng riêng + mã QR, tránh trùng lặp.
        // "THANH TOAN..." đứng trước, Tên khách ghép sau. stripDiacritics() áp
        // dụng cho CẢ CHUỖI (không chỉ riêng tên) để tự thay mọi ký tự đặc biệt
        // (VD: dấu "/" trong mã hợp đồng) bằng dấu cách — nội dung chuyển
        // khoản không nên có ký tự lạ, dễ gây lỗi khi ngân hàng xử lý.
        const text = stripDiacritics(`THANH TOAN ${loai} HDTD ${contract.code} ${customer.name}`);
        return { total, text };
      }

      const hasBank = org.bankBin && org.bankAccountNo;

      /** Cập nhật phần số tiền/nội dung chữ — luôn tức thì, không phụ thuộc mạng. */
      function updateAmountText() {
        const { total, text } = content();
        body.querySelector('#sum-amount').textContent = formatVND(total);
        body.querySelector('#sum-content').textContent = text;
      }
      function updateQrNow() {
        if (!hasBank) return;
        const img = body.querySelector('#qr-img');
        if (!img) return;
        const { total, text } = content();
        img.src = buildVietQrUrl({ bin: org.bankBin, accountNo: org.bankAccountNo, amount: total, content: text, accountName: org.bankAccountName });
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
          <div class="card card-pad mb-16" style="background:var(--surface-alt)">
            <div class="oc-line"><span>Ngân hàng</span><b>${org.bankName || '—'}</b></div>
            <div class="oc-line"><span>Số tài khoản</span><b>${org.bankAccountNo || '—'}</b></div>
            <div class="oc-line"><span>Chủ tài khoản</span><b>${org.bankAccountName || '—'}</b></div>
            <div class="oc-line"><span>Số tiền</span><b id="sum-amount" style="color:var(--color-primary)"></b></div>
            <div class="oc-line" style="align-items:flex-start"><span>Nội dung</span><b id="sum-content" style="text-align:right;max-width:65%"></b></div>
          </div>
          ${hasBank ? `
            <div style="text-align:center">
              <button type="button" class="btn btn-outline btn-block mb-8" id="btn-download-qr">${icon('download', 'icon-sm')} Tải ảnh mã QR</button>
              <img id="qr-img" alt="Mã QR chuyển khoản" style="max-width:220px;width:100%;border:1px solid var(--border);border-radius:12px"/>
              <div class="fw-700 mt-8 mb-12" style="font-size:15px">Quét mã QR này để thanh toán</div>
              <button type="button" class="btn btn-outline btn-block" id="btn-share-qr">${icon('wallet', 'icon-sm')} Chia sẻ ảnh QR</button>
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
          const { text } = content();
          shareQrImage(body.querySelector('#qr-img').src, text);
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
