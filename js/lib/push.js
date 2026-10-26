import { callCreateAccountFunction } from './supabaseClient.js';

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

export function registerServiceWorker() {
  if (!('serviceWorker' in navigator)) return Promise.resolve(null);
  return navigator.serviceWorker.register('sw.js').catch(() => null);
}

export function pushPermissionStatus() {
  if (!isPushSupported()) return 'unsupported';
  return Notification.permission;
}

export async function isSubscribedOnThisDevice() {
  if (!isPushSupported()) return false;
  const reg = await navigator.serviceWorker.getRegistration();
  if (!reg) return false;
  const sub = await reg.pushManager.getSubscription();
  return !!sub;
}

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

export async function autoSubscribeIfPossible(sbToken) {
  if (!isPushSupported()) return;
  if (Notification.permission === 'denied') return;
  try { await subscribeToPush(sbToken); } catch (e) { console.warn('Không tự bật được thông báo:', e); }
}

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
