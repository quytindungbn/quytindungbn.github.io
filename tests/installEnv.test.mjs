import test from 'node:test';
import assert from 'node:assert/strict';
import { detectInstallEnv, installGuideKind } from '../js/lib/installEnv.js';

const UA = {
  androidChrome: 'Mozilla/5.0 (Linux; Android 14; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Mobile Safari/537.36',
  androidSamsung: 'Mozilla/5.0 (Linux; Android 13; SM-S918B) AppleWebKit/537.36 (KHTML, like Gecko) SamsungBrowser/24.0 Chrome/117.0.0.0 Mobile Safari/537.36',
  androidFirefox: 'Mozilla/5.0 (Android 14; Mobile; rv:127.0) Gecko/127.0 Firefox/127.0',
  androidEdge: 'Mozilla/5.0 (Linux; Android 14; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Mobile Safari/537.36 EdgA/126.0.0.0',
  androidZalo: 'Mozilla/5.0 (Linux; Android 13; Redmi Note 11) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/120.0.0.0 Mobile Safari/537.36 Zalo/12.3',
  androidFacebook: 'Mozilla/5.0 (Linux; Android 12; SM-A525F) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/110.0.0.0 Mobile Safari/537.36 [FB_IAB/FB4A;FBAV/450.0.0.38.108;]',
  iosSafari: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1',
  iosChrome: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/126.0.6478.153 Mobile/15E148 Safari/604.1',
  iosZalo: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 Zalo/1.0',
  iosMessenger: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 [FBAN/FBIOS;FBAV/450.0;FB_IAB/MESSENGER]',
  winChrome: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
  winEdge: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36 Edg/126.0.0.0',
  winFirefox: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:127.0) Gecko/20100101 Firefox/127.0',
  macSafari: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Safari/605.1.15',
};
const kind = (ua, extra = {}) => installGuideKind(detectInstallEnv({ ua, ...extra }));

test('Android: Chrome/Edge/Samsung có hộp thoại cài thật (chromium), Firefox thì không', () => {
  for (const ua of [UA.androidChrome, UA.androidSamsung, UA.androidEdge]) {
    const e = detectInstallEnv({ ua });
    assert.equal(e.os, 'android'); assert.ok(e.chromium); assert.ok(e.mobile); assert.equal(e.inApp, '');
  }
  assert.equal(detectInstallEnv({ ua: UA.androidSamsung }).browser, 'samsung');
  assert.equal(detectInstallEnv({ ua: UA.androidEdge }).browser, 'edge');
  const f = detectInstallEnv({ ua: UA.androidFirefox });
  assert.equal(f.browser, 'firefox'); assert.ok(!f.chromium);
  assert.equal(kind(UA.androidFirefox), 'android-firefox');
});

test('Trình duyệt nhúng (Zalo, Facebook, Messenger) được nhận ra, kể cả iPhone — và không coi là cài được', () => {
  const cases = [[UA.androidZalo, 'Zalo', 'android'], [UA.androidFacebook, 'Facebook', 'android'], [UA.iosZalo, 'Zalo', 'ios'], [UA.iosMessenger, 'Facebook', 'ios']];
  for (const [ua, name, os] of cases) {
    const e = detectInstallEnv({ ua });
    assert.equal(e.inApp, name, ua); assert.equal(e.os, os); assert.ok(!e.chromium);
    assert.equal(installGuideKind(e), 'in-app');
  }
});

test('iPhone: Safari có hướng dẫn riêng, Chrome/Edge/Firefox trên iPhone dùng hướng dẫn khác và không có hộp thoại thật', () => {
  assert.equal(kind(UA.iosSafari), 'ios-safari');
  const c = detectInstallEnv({ ua: UA.iosChrome });
  assert.equal(c.os, 'ios'); assert.equal(c.browser, 'chrome'); assert.ok(!c.chromium);
  assert.equal(installGuideKind(c), 'ios-other');
});

test('iPad mở bằng giao diện máy Mac (Macintosh + màn chạm) vẫn là iOS', () => {
  const e = detectInstallEnv({ ua: UA.macSafari, platform: 'MacIntel', touchPoints: 5 });
  assert.equal(e.os, 'ios'); assert.equal(installGuideKind(e), 'ios-safari');
  assert.equal(detectInstallEnv({ ua: UA.macSafari, platform: 'MacIntel', touchPoints: 0 }).os, 'desktop');
});

test('Máy tính: Chrome/Edge cài được, Safari/Firefox chỉ hướng dẫn', () => {
  assert.equal(kind(UA.winChrome), 'desktop-chromium');
  assert.equal(kind(UA.winEdge), 'desktop-chromium');
  assert.ok(detectInstallEnv({ ua: UA.winEdge }).chromium);
  assert.equal(detectInstallEnv({ ua: UA.winEdge }).browser, 'edge');
  assert.equal(kind(UA.macSafari, { platform: 'MacIntel' }), 'desktop-safari');
  assert.equal(kind(UA.winFirefox), 'desktop-firefox');
  assert.ok(!detectInstallEnv({ ua: UA.macSafari, platform: 'MacIntel' }).mobile);
});

test('UA rỗng không gây lỗi', () => {
  const e = detectInstallEnv({});
  assert.equal(e.os, 'desktop'); assert.equal(e.inApp, ''); assert.ok(!e.chromium);
  assert.equal(installGuideKind(e), 'desktop-other');
});
