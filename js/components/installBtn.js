// "Cài ứng dụng" — UI dùng CHUNG cho cả trang đăng nhập (login.js) lẫn bên
// trong app khi đã đăng nhập (sidebar/menu "Thêm" ở shell.js), vì phần lớn
// khách hàng ở lại đăng nhập sẵn (phiên lưu trong localStorage) nên hiếm khi
// thấy lại trang đăng nhập — cần có lối vào ở cả 2 chỗ. Logic thật (bắt sự
// kiện beforeinstallprompt, biết Android hay iOS...) nằm ở lib/installPwa.js.
import { icon } from '../icons.js';
import { openModal } from './modal.js';
import { toast } from './toast.js';
import { promptInstall, isIOS } from '../lib/installPwa.js';

const IOS_PROMPT_SEEN_KEY = 'qtd_install_ios_seen';

/** Gắn hành vi bấm cho 1 nút "Cài ứng dụng" có sẵn trong DOM. */
export function bindInstallButton(btn) {
  btn.addEventListener('click', () => runInstallFlow(btn));
}

/**
 * Chạy luồng cài đặt thật — BẮT BUỘC chỉ gọi từ đúng 1 handler click (user
 * gesture) — trình duyệt CHỈ cho hiện hộp thoại cài đặt thật khi được gọi từ
 * đúng 1 cú bấm/chạm thật; tự động gọi sẽ bị âm thầm bỏ qua NHƯNG vẫn coi
 * như đã "dùng" mất cơ hội đó, khiến nút bấm sau này không còn gì để hiện.
 */
async function runInstallFlow(btn) {
  btn.disabled = true;
  try {
    const outcome = await promptInstall();
    if (outcome === 'accepted') {
      toast('Đã cài ứng dụng thành công!', 'success');
      btn.remove();
    } else if (outcome === 'already-installed') {
      toast('Bạn đã cài ứng dụng này rồi.', 'success');
      btn.remove();
    } else if (outcome === 'dismissed') {
      toast('Bạn đã bỏ qua — có thể bấm lại nút này bất cứ lúc nào.', 'info');
    } else if (outcome === 'ios-manual') {
      openIosInstallGuide();
    } else {
      toast('Trình duyệt chưa sẵn sàng để cài đặt — thử tải lại trang, hoặc mở bằng Chrome (Android)/Safari (iPhone).', 'error');
    }
  } finally {
    btn.disabled = false;
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

/**
 * Tự mở hướng dẫn cho iPhone/iPad — CHỈ 1 LẦN DUY NHẤT trên mỗi máy/trình
 * duyệt (nhớ bằng localStorage), khỏi làm phiền khách quen mỗi lần vào lại.
 * Gọi ở cả trang đăng nhập lẫn lúc dựng khung app (shell.js) — bên nào hiện
 * trước thì bên đó tự đánh dấu "đã thấy", không bị hiện trùng ở bên còn lại.
 */
export function maybeAutoShowIosGuide() {
  if (isIOS() && !localStorage.getItem(IOS_PROMPT_SEEN_KEY)) {
    localStorage.setItem(IOS_PROMPT_SEEN_KEY, '1');
    openIosInstallGuide();
  }
}
