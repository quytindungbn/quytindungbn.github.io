// "Thêm lối tắt vào màn hình chính" — dùng chuẩn PWA beforeinstallprompt.
// CHỈ Android/Chrome/Edge (và Chrome/Edge trên máy tính) hỗ trợ tự động hóa
// việc này — iPhone/iPad (Safari) KHÔNG có API nào cho web tự bấm hộ được,
// đây là giới hạn CỐ Ý của Apple (không phải app thiếu sót gì), chỉ có thể
// HƯỚNG DẪN người dùng tự làm qua nút Chia sẻ. Xem docs/dong-goi-android.md.

let deferredPrompt = null;
const installableCallbacks = [];

// Bắt sự kiện SỚM NHẤT có thể (ngay lúc file này được nạp, trước khi người
// dùng kịp bấm gì) — bắt buộc gọi preventDefault() thì sau này mới tự gọi
// lại được đúng lúc người dùng bấm nút, thay vì để trình duyệt tự hiện
// thanh gợi ý mini mặc định của nó (không đẹp, không kiểm soát được lúc nào hiện).
window.addEventListener('beforeinstallprompt', (e) => {
  e.preventDefault();
  deferredPrompt = e;
  installableCallbacks.forEach((fn) => fn());
});
window.addEventListener('appinstalled', () => {
  deferredPrompt = null;
});

/**
 * Gọi `fn` ngay khi trình duyệt xác nhận "có thể cài đặt được" — nếu đã sẵn
 * có rồi thì gọi NGAY; chưa có thì chờ, gọi khi sự kiện beforeinstallprompt
 * tới (do trình duyệt tự quyết định thời điểm, không cố định).
 *
 * ⚠️ CHỈ dùng `fn` để TỰ HIỆN GIAO DIỆN CỦA APP (banner/nút riêng của app) —
 * TUYỆT ĐỐI KHÔNG gọi promptInstall()/`.prompt()` trực tiếp bên trong `fn`.
 * Trình duyệt CHỈ cho hiện hộp thoại cài đặt thật khi được gọi từ đúng 1 cú
 * bấm/chạm THẬT của người dùng (user gesture) — gọi tự động ở đây sẽ bị âm
 * thầm bỏ qua NHƯNG vẫn coi như đã "dùng" mất cơ hội đó, khiến nút bấm thật
 * sau này không còn gì để hiện nữa (lỗi đã từng gặp — xem lịch sử sửa lỗi).
 * Cách đúng: dùng `fn` để tự hiện 1 banner/nút mời cài đặt, rồi gọi
 * promptInstall() bên trong handler click của CHÍNH banner/nút đó — cú bấm
 * vào banner tự hiện đó vẫn được tính là user gesture hợp lệ.
 */
export function onInstallable(fn) {
  if (deferredPrompt) fn();
  else installableCallbacks.push(fn);
}

/** Đang chạy ở chế độ đã cài (mở từ icon màn hình chính) hay chưa. */
export function isStandalone() {
  return window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone === true;
}

/** iPhone/iPad — nơi KHÔNG có cách nào tự động thêm lối tắt được. */
export function isIOS() {
  return /iphone|ipad|ipod/i.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
}

/**
 * Bấm nút "Thêm lối tắt" — trả về:
 *   'already-installed' — đã cài sẵn rồi, không cần làm gì thêm.
 *   'accepted' — Android/Chrome/Edge, người dùng đã đồng ý, THÊM THÀNH CÔNG.
 *   'dismissed' — Android/Chrome/Edge, người dùng bấm "Không, cảm ơn".
 *   'ios-manual' — iPhone/iPad, KHÔNG tự làm được, cần tự hướng dẫn 3 bước.
 *   'unsupported' — trình duyệt khác chưa hỗ trợ (VD: Safari máy tính, Firefox).
 */
export async function promptInstall() {
  if (isStandalone()) return 'already-installed';
  if (deferredPrompt) {
    const promptEvent = deferredPrompt;
    deferredPrompt = null;
    promptEvent.prompt();
    const choice = await promptEvent.userChoice;
    return choice.outcome; // 'accepted' | 'dismissed'
  }
  if (isIOS()) return 'ios-manual';
  return 'unsupported';
}
