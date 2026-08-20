// Đăng ký nhận thông báo đẩy (Web Push) — khách hàng/quản trị viên tự bật ở
// trang "Tài khoản"/"Đổi mật khẩu" để nhận nhắc lịch đến hạn dù không mở app.
// Xem docs/supabase-migration.md mục "Thông báo đẩy (Push)" để biết đầy đủ
// kiến trúc (Service Worker + Supabase Edge Function gửi định kỳ) + cách deploy.
import { callCreateAccountFunction } from './supabaseClient.js';

// Khóa CÔNG KHAI VAPID — an toàn để lộ ở trình duyệt (giống anon key, đúng
// thiết kế của chuẩn Web Push). Khóa RIÊNG (private) chỉ nằm trên server
// (Edge Function secret), KHÔNG bao giờ đặt trong file chạy ở trình duyệt.
const VAPID_PUBLIC_KEY = 'BMyPkXt6tCGPIsTxIam468K-qWhgNrgunKImUOc3-JN0SlBhydDT6J5JUUw7ys_Pjh3uxoavHWBqlBS_bxakGi4';

function urlBase64ToUint8Array(base64String) {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const raw = atob(base64);
  return Uint8Array.from([...raw].map((c) => c.charCodeAt(0)));
}

export function isPushSupported() {
  return 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;
}

/** Đăng ký Service Worker — gọi 1 lần lúc khởi động app (js/app.js), không cần đăng nhập. */
export function registerServiceWorker() {
  if (!('serviceWorker' in navigator)) return Promise.resolve(null);
  return navigator.serviceWorker.register('sw.js').catch(() => null);
}

/** 'granted' | 'denied' | 'default' (chưa hỏi bao giờ) | 'unsupported'. */
export function pushPermissionStatus() {
  if (!isPushSupported()) return 'unsupported';
  return Notification.permission;
}

/** Thiết bị này đã bật nhận thông báo hay chưa (đã có subscription đang hoạt động). */
export async function isSubscribedOnThisDevice() {
  if (!isPushSupported()) return false;
  const reg = await navigator.serviceWorker.getRegistration();
  if (!reg) return false;
  const sub = await reg.pushManager.getSubscription();
  return !!sub;
}

/**
 * Xin quyền + đăng ký nhận thông báo trên thiết bị này, lưu địa chỉ nhận
 * (subscription) lên Supabase gắn với tài khoản đang đăng nhập (qua sbToken)
 * — Edge Function định kỳ dùng bảng này để biết gửi thông báo tới đâu.
 */
export async function subscribeToPush(sbToken) {
  if (!isPushSupported()) throw new Error('Trình duyệt/thiết bị này không hỗ trợ thông báo đẩy.');
  const permission = await Notification.requestPermission();
  if (permission !== 'granted') throw new Error('Bạn chưa cho phép nhận thông báo — vào cài đặt trình duyệt để bật lại nếu muốn dùng.');
  const reg = await navigator.serviceWorker.ready;
  let sub = await reg.pushManager.getSubscription();
  if (!sub) {
    sub = await reg.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(VAPID_PUBLIC_KEY),
    });
  }
  const json = sub.toJSON();
  const res = await callCreateAccountFunction(sbToken, {
    type: 'save-push-subscription',
    endpoint: json.endpoint, p256dh: json.keys.p256dh, auth: json.keys.auth,
  });
  if (!res.ok) throw new Error(res.reason || 'Không lưu được đăng ký nhận thông báo, thử lại sau.');
}

/**
 * Tự động bật thông báo NGAY sau khi đăng nhập/mở lại app — khỏi cần khách
 * hàng/nhân viên tự vào trang "Đổi mật khẩu" bấm nút mới bật được như trước.
 * LƯU Ý: trình duyệt vẫn BẮT BUỘC tự người dùng bấm "Cho phép" ở đúng hộp
 * thoại xin quyền thật của trình duyệt — không có cách nào bỏ qua bước này
 * (quy định bảo mật chung của mọi trình duyệt/hệ điều hành, không phải giới
 * hạn riêng của app) — nhưng giờ hộp thoại đó tự bật lên ngay, gộp vào đúng
 * lúc đăng nhập, thay vì phải tự đi tìm trang cài đặt riêng mới thấy nút bật.
 * Đã từ chối ("denied") trước đó thì KHÔNG tự hỏi lại nữa (trình duyệt cũng
 * không cho hỏi lại) — cần tự vào cài đặt trình duyệt bật lại nếu đổi ý; đã
 * bật rồi ("granted") thì âm thầm xác nhận lại đăng ký (phòng khi lần trước
 * lưu chưa xong), không hiện gì thêm cho người dùng thấy.
 */
export async function autoSubscribeIfPossible(sbToken) {
  if (!isPushSupported()) return;
  if (Notification.permission === 'denied') return;
  try { await subscribeToPush(sbToken); } catch (e) { console.warn('Không tự bật được thông báo:', e); }
}

/** Tắt nhận thông báo trên thiết bị này. */
export async function unsubscribeFromPush(sbToken) {
  if (!isPushSupported()) return;
  const reg = await navigator.serviceWorker.getRegistration();
  if (!reg) return;
  const sub = await reg.pushManager.getSubscription();
  if (!sub) return;
  const endpoint = sub.endpoint;
  await sub.unsubscribe();
  await callCreateAccountFunction(sbToken, { type: 'delete-push-subscription', endpoint });
}
