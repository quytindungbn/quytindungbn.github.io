// Nhận diện máy/trình duyệt đang mở app để chọn đúng cách mời & hướng dẫn cài đặt — hàm thuần (nhận ua/platform/touchPoints)
// nên kiểm thử được. Dùng trong lib/installPwa.js (lúc chạy thật lấy từ navigator) và components/installBtn.js (nội dung hướng dẫn).

/** Trình duyệt NHÚNG trong ứng dụng khác (khách bấm link trong Zalo/Facebook/Messenger... thì mở ra ở đây): không cài được app, phải mở bằng trình duyệt thật. */
const IN_APP = [
  [/Zalo/i, 'Zalo'],
  [/FBAN|FBAV|FB_IAB|FBIOS|FB4A/i, 'Facebook'],
  [/Messenger/i, 'Messenger'],
  [/Instagram/i, 'Instagram'],
  [/musical_ly|BytedanceWebview|TikTok/i, 'TikTok'],
  [/\bLine\//i, 'Line'],
  [/MicroMessenger/i, 'WeChat'],
  [/Snapchat/i, 'Snapchat'],
  [/Twitter/i, 'Twitter'],
];

/**
 * { os: 'ios'|'android'|'desktop', mobile, browser: 'safari'|'chrome'|'edge'|'firefox'|'samsung'|'opera'|'other',
 *   inApp: tên ứng dụng nhúng ('Zalo'...) hoặc '' , chromium: có sự kiện beforeinstallprompt (Chrome/Edge/Samsung/Opera, không tính iPhone) }
 */
export function detectInstallEnv({ ua = '', platform = '', touchPoints = 0 } = {}) {
  const u = String(ua || '');
  const ios = /iphone|ipad|ipod/i.test(u) || (platform === 'MacIntel' && touchPoints > 1);
  const android = /android/i.test(u);
  const os = ios ? 'ios' : android ? 'android' : 'desktop';
  let inApp = '';
  for (const [re, name] of IN_APP) if (re.test(u)) { inApp = name; break; }
  let browser = 'other';
  if (/EdgA|EdgiOS|Edg\//.test(u)) browser = 'edge';
  else if (/OPR\/|OPT\/|Opera/.test(u)) browser = 'opera';
  else if (/SamsungBrowser/i.test(u)) browser = 'samsung';
  else if (/Firefox|FxiOS/i.test(u)) browser = 'firefox';
  else if (/Chrome|CriOS|Chromium/i.test(u)) browser = 'chrome';
  else if (/Safari/i.test(u)) browser = 'safari';
  const chromium = !ios && ['chrome', 'edge', 'samsung', 'opera'].includes(browser) && !inApp;
  return { os, mobile: ios || android, browser, inApp, chromium };
}

/** Môi trường của máy đang chạy (lấy từ navigator). */
export function currentInstallEnv() {
  return detectInstallEnv({ ua: navigator.userAgent, platform: navigator.platform, touchPoints: navigator.maxTouchPoints || 0 });
}

/**
 * Loại hướng dẫn cài tay phù hợp với môi trường:
 * 'in-app' (mở trong Zalo/Facebook... → phải mở bằng trình duyệt) · 'ios-safari' · 'ios-other' (Chrome/Edge/Firefox trên iPhone) ·
 * 'android-firefox' · 'android-other' · 'desktop-chromium' · 'desktop-safari' · 'desktop-firefox' · 'desktop-other'.
 */
export function installGuideKind(env) {
  if (env.inApp) return 'in-app';
  if (env.os === 'ios') return env.browser === 'safari' ? 'ios-safari' : 'ios-other';
  if (env.os === 'android') return env.browser === 'firefox' ? 'android-firefox' : 'android-other';
  if (env.browser === 'safari') return 'desktop-safari';
  if (env.browser === 'firefox') return 'desktop-firefox';
  if (env.chromium) return 'desktop-chromium';
  return 'desktop-other';
}

/**
 * Liên kết "intent:" của Android để mở trang bằng ứng dụng NGOÀI (trình duyệt nhúng trong Zalo/Facebook chuyển liên kết này cho hệ thống).
 * `url` là địa chỉ https đầy đủ của trang (không kèm #). Chrome: ép đúng gói com.android.chrome; không có Chrome thì hệ thống dùng
 * S.browser_fallback_url (chính địa chỉ đó). Trình duyệt bất kỳ: không ép gói — hệ thống mở bằng trình duyệt mặc định (hoặc hỏi chọn).
 */
export function androidIntentUrl(url, browser = 'chrome') {
  const u = new URL(url);
  const scheme = u.protocol.replace(':', '');
  const base = `intent://${u.host}${u.pathname}${u.search}#Intent;scheme=${scheme};`;
  if (browser === 'chrome') return `${base}package=com.android.chrome;S.browser_fallback_url=${encodeURIComponent(url)};end`;
  return `${base}action=android.intent.action.VIEW;category=android.intent.category.BROWSABLE;end`;
}
