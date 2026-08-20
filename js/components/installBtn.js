// "Cài ứng dụng" — UI dùng CHUNG cho trang đăng nhập (login.js), sidebar/menu
// "Thêm" khi đã đăng nhập (shell.js), VÀ 1 banner tự động hiện lên ngay khi
// vào app trên máy CHƯA cài (initAutoInstallPrompt(), gọi 1 LẦN DUY NHẤT lúc
// khởi động app — xem app.js). Logic thật (bắt sự kiện beforeinstallprompt,
// biết Android hay iOS...) nằm ở lib/installPwa.js.
import { icon } from '../icons.js';
import { openModal } from './modal.js';
import { toast } from './toast.js';
import { promptInstall, isIOS, isStandalone, onInstallable } from '../lib/installPwa.js';

const IOS_PROMPT_SEEN_KEY = 'qtd_install_ios_seen';

/** Gắn hành vi bấm cho 1 nút "Cài ứng dụng" có sẵn trong DOM (sidebar, menu Thêm, trang đăng nhập...). */
export function bindInstallButton(btn) {
  btn.addEventListener('click', () => runInstallFlow(btn));
}

/**
 * Chạy luồng cài đặt thật — BẮT BUỘC chỉ gọi từ đúng 1 handler click (user
 * gesture) — trình duyệt CHỈ cho hiện hộp thoại cài đặt thật khi được gọi từ
 * đúng 1 cú bấm/chạm thật; tự động gọi sẽ bị âm thầm bỏ qua NHƯNG vẫn coi
 * như đã "dùng" mất cơ hội đó, khiến nút bấm sau này không còn gì để hiện.
 * `btn` không bắt buộc (banner tự đóng lại trước khi gọi, không có nút để giữ trạng thái).
 */
async function runInstallFlow(btn) {
  if (btn) btn.disabled = true;
  try {
    const outcome = await promptInstall();
    if (outcome === 'accepted') {
      toast('Đã cài ứng dụng thành công!', 'success');
      if (btn) btn.remove();
    } else if (outcome === 'already-installed') {
      toast('Bạn đã cài ứng dụng này rồi.', 'success');
      if (btn) btn.remove();
    } else if (outcome === 'dismissed') {
      toast('Bạn đã bỏ qua — có thể bấm lại nút này bất cứ lúc nào.', 'info');
    } else if (outcome === 'ios-manual') {
      openIosInstallGuide();
    } else {
      toast('Trình duyệt chưa sẵn sàng để cài đặt — thử tải lại trang, hoặc mở bằng Chrome (Android)/Safari (iPhone).', 'error');
    }
  } finally {
    if (btn) btn.disabled = false;
  }
}

/**
 * iPhone/iPad (Safari) KHÔNG có API nào cho web tự cài đặt được — đây là
 * giới hạn cố ý của Apple, chỉ hướng dẫn người dùng tự làm qua nút Chia sẻ.
 * Popup này là UI CỦA CHÍNH APP (không phải API trình duyệt) nên tự mở
 * được, an toàn, không bị giới hạn "user gesture" như promptInstall().
 */
export function openIosInstallGuide() {
  openModal({
    title: 'Cài ứng dụng',
    bodyHtml: `
      <p class="text-sm text-muted mb-8">Trên iPhone/iPad, trình duyệt không cho web tự động cài đặt được — bạn tự làm theo 3 bước sau (nhớ mở bằng <b>Safari</b>):</p>
      <div class="oc-line"><span>Bước 1</span><b style="text-align:right">Bấm nút <b>Chia sẻ</b> ${icon('wallet', 'icon-sm')} (hình vuông có mũi tên đi lên) ở thanh dưới màn hình</b></div>
      <div class="oc-line"><span>Bước 2</span><b style="text-align:right">Cuộn xuống, chọn <b>"Thêm vào MH chính"</b> (Add to Home Screen)</b></div>
      <div class="oc-line"><span>Bước 3</span><b style="text-align:right">Bấm <b>"Thêm"</b> ở góc trên bên phải</b></div>
      <p class="text-sm text-muted mt-8">Xong là có icon riêng ngoài màn hình chính, mở lên dùng như 1 app thật.</p>
    `,
  });
}

let bannerEl = null;

/**
 * Hiện 1 banner nhỏ NỔI Ở DƯỚI MÀN HÌNH mời cài đặt — đây là UI CỦA CHÍNH
 * APP (không phải hộp thoại thật của trình duyệt) nên tự hiện lên được, an
 * toàn. Bấm nút "Cài đặt" TRÊN BANNER này mới là lúc gọi hộp thoại thật —
 * cú bấm đó tính là user gesture hợp lệ, không vi phạm giới hạn của trình
 * duyệt (khác với việc tự gọi thẳng promptInstall() mà không qua cú bấm nào).
 */
function showInstallBanner(onGo, onClose) {
  if (bannerEl || isStandalone()) return;
  bannerEl = document.createElement('div');
  bannerEl.style.cssText = 'position:fixed;left:12px;right:12px;bottom:12px;z-index:50;max-width:420px;margin:0 auto;background:var(--surface);border:1px solid var(--border-strong);border-radius:14px;box-shadow:var(--shadow-lg);padding:10px 10px 10px 14px;display:flex;align-items:center;gap:10px';
  bannerEl.innerHTML = `
    <div style="width:36px;height:36px;border-radius:10px;background:linear-gradient(135deg,var(--color-primary),#22a68f);display:flex;align-items:center;justify-content:center;color:#fff;flex-shrink:0">${icon('download', 'icon-sm')}</div>
    <div style="flex:1;font-size:12.5px;line-height:1.35;min-width:0">
      <div style="font-weight:700;font-size:13.5px">Cài ứng dụng</div>
      <div style="color:var(--text-muted)">Dùng nhanh hơn, nhận thông báo đầy đủ</div>
    </div>
    <button id="qtd-install-banner-go" class="btn btn-primary btn-sm" style="flex-shrink:0">Cài đặt</button>
    <button id="qtd-install-banner-x" class="icon-btn" aria-label="Đóng" style="flex-shrink:0">${icon('x')}</button>
  `;
  document.body.appendChild(bannerEl);
  bannerEl.querySelector('#qtd-install-banner-go').addEventListener('click', () => {
    closeBanner();
    onGo();
  });
  bannerEl.querySelector('#qtd-install-banner-x').addEventListener('click', () => {
    closeBanner();
    if (onClose) onClose();
  });
}
function closeBanner() {
  if (bannerEl) { bannerEl.remove(); bannerEl = null; }
}

/**
 * Điểm vào DUY NHẤT để tự động mời cài đặt ngay khi vừa vào app trên máy
 * CHƯA cài — gọi 1 LẦN lúc khởi động app (xem app.js), không gọi lại ở từng
 * trang riêng lẻ (tránh hiện banner trùng nhiều lần).
 *   - Android/Chrome/Edge: tự hiện banner ngay khi trình duyệt xác nhận "có
 *     thể cài" (không cố định, do trình duyệt tự quyết định thời điểm) —
 *     bấm "Cài đặt" trên banner mới thật sự gọi hộp thoại cài đặt của
 *     trình duyệt (đúng chuẩn, không vi phạm giới hạn user gesture).
 *   - iPhone/iPad: tự hiện banner ngay (không cần đợi sự kiện nào, vì
 *     iOS không có beforeinstallprompt) — CHỈ 1 LẦN DUY NHẤT trên mỗi
 *     máy/trình duyệt (nhớ bằng localStorage), khỏi làm phiền khách quen đã
 *     từng thấy/bỏ qua rồi. Bấm "Cài đặt" trên banner mở popup hướng dẫn
 *     3 bước (Apple không cho tự động hoàn toàn, xem openIosInstallGuide()).
 * Nút "Cài ứng dụng" ở sidebar/menu Thêm/trang đăng nhập vẫn luôn có sẵn để
 * khách tự mở lại bất cứ lúc nào nếu đã lỡ đóng banner này.
 */
export function initAutoInstallPrompt() {
  if (isStandalone()) return;
  if (isIOS()) {
    if (!localStorage.getItem(IOS_PROMPT_SEEN_KEY)) {
      showInstallBanner(
        () => { localStorage.setItem(IOS_PROMPT_SEEN_KEY, '1'); openIosInstallGuide(); },
        () => localStorage.setItem(IOS_PROMPT_SEEN_KEY, '1')
      );
    }
    return;
  }
  onInstallable(() => showInstallBanner(() => runInstallFlow(null)));
}
