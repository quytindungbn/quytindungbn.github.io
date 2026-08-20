// Service Worker — CHỈ dùng để nhận & hiển thị thông báo đẩy (Web Push), không
// cache offline gì (app luôn cần dữ liệu mới từ Supabase, cache sai sẽ hại hơn
// lợi). Đăng ký từ js/app.js lúc khởi động, xem js/lib/push.js.

self.addEventListener('install', () => {
  self.skipWaiting();
});
self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim());
});

/** Máy chủ gửi thông báo dạng JSON: { title, body, url, tag }. */
self.addEventListener('push', (event) => {
  let data = {};
  try { data = event.data ? event.data.json() : {}; } catch (e) { data = { title: 'Thông báo', body: event.data ? event.data.text() : '' }; }
  const title = data.title || 'QTD Bình Nguyên';
  const options = {
    body: data.body || '',
    icon: 'icons/icon-192.png',
    badge: 'icons/icon-192.png',
    tag: data.tag || 'qtd-notify', // trùng tag thì thông báo mới thay thế thông báo cũ cùng loại, đỡ dồn đống
    data: { url: data.url || './' },
  };
  event.waitUntil(self.registration.showNotification(title, options));
});

/** Bấm vào thông báo — mở app đúng trang (nếu đã mở sẵn 1 tab thì focus tab đó thay vì mở tab mới). */
self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const targetUrl = new URL(event.notification.data?.url || './', self.location.origin).href;
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clients) => {
      for (const client of clients) {
        if ('focus' in client) { client.navigate(targetUrl); return client.focus(); }
      }
      if (self.clients.openWindow) return self.clients.openWindow(targetUrl);
    })
  );
});
