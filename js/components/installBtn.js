// "Cài đặt ứng dụng" — UI dùng CHUNG cho trang đăng nhập (login.js), sidebar/menu
// "Thêm" khi đã đăng nhập (shell.js), VÀ 1 banner tự động mời cài lúc vào app trên máy CHƯA cài
// (initAutoInstallPrompt(), gọi 1 LẦN DUY NHẤT lúc khởi động app — xem app.js).
// Logic thật (bắt sự kiện beforeinstallprompt) ở lib/installPwa.js; nhận diện trình duyệt/máy ở lib/installEnv.js.
import { icon } from '../icons.js';
import { openModal } from './modal.js';
import { toast } from './toast.js';
import { copyText } from '../utils.js';
import { promptInstall, isStandalone, onInstallable } from '../lib/installPwa.js';
import { currentInstallEnv, installGuideKind } from '../lib/installEnv.js';

const SNOOZE_KEY = 'qtd_install_snooze_at'; // lúc khách bấm "Để sau"/mở hướng dẫn — 7 ngày sau mới mời lại
const LEGACY_IOS_KEY = 'qtd_install_ios_seen'; // khóa cũ (iPhone chỉ mời 1 lần) — gặp thì đổi sang cách mới
const SNOOZE_MS = 7 * 24 * 3600 * 1000;

function snoozed() {
  try {
    if (localStorage.getItem(LEGACY_IOS_KEY)) { localStorage.removeItem(LEGACY_IOS_KEY); localStorage.setItem(SNOOZE_KEY, String(Date.now())); }
    const t = Number(localStorage.getItem(SNOOZE_KEY));
    return !!t && Date.now() - t < SNOOZE_MS;
  } catch { return false; }
}
function snooze() {
  try { localStorage.setItem(SNOOZE_KEY, String(Date.now())); } catch { /* bỏ qua — chỉ là nhớ để khỏi mời liên tục */ }
}

/** Gắn hành vi bấm cho 1 nút "Cài đặt ứng dụng" có sẵn trong DOM (sidebar, menu Thêm, trang đăng nhập...). */
export function bindInstallButton(btn) {
  btn.addEventListener('click', () => runInstallFlow(btn));
  window.addEventListener('appinstalled', () => btn.remove(), { once: true });
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
    } else {
      // 'in-app' (đang mở trong Zalo/Facebook...), 'ios-manual', 'unsupported' (Firefox, Safari máy tính, hoặc đã cài sẵn rồi):
      // không tự cài được — hiện hướng dẫn ĐÚNG với máy/trình duyệt đang dùng.
      openInstallGuide();
    }
  } finally {
    if (btn) btn.disabled = false;
  }
}

const ST = (n, html) => `<li><span class="inst-n">${n}</span><div>${html}</div></li>`;
const SHARE = icon('shareIos', 'icon-sm');

/** Nội dung hướng dẫn cài tay theo loại máy/trình duyệt (xem installGuideKind). */
function guideContent(kind, env) {
  switch (kind) {
    case 'in-app':
      return {
        title: 'Mở bằng trình duyệt để cài',
        lead: `Bạn đang mở trang trong <b>${env.inApp}</b> — ứng dụng này <b>không cho cài đặt</b>. Hãy mở bằng trình duyệt của điện thoại:`,
        steps: env.os === 'ios'
          ? [ST(1, 'Bấm nút <b>⋯</b> (hoặc biểu tượng <b>chia sẻ</b>) ở góc màn hình'), ST(2, 'Chọn <b>Mở bằng Safari</b>'), ST(3, 'Trang mở ra trong Safari, bấm lại <b>Cài đặt ứng dụng</b> rồi làm theo hướng dẫn')]
          : [ST(1, 'Bấm nút <b>⋮</b> (3 chấm) hoặc <b>⋯</b> ở góc trên bên phải'), ST(2, 'Chọn <b>Mở bằng trình duyệt</b> (hoặc <b>Mở trong Chrome</b>)'), ST(3, 'Trang mở ra trong Chrome, bấm lại <b>Cài đặt ứng dụng</b>')],
        foot: 'Hoặc bấm <b>Sao chép liên kết</b> bên dưới rồi dán vào ô địa chỉ của Chrome/Safari.',
        copy: true,
      };
    case 'ios-safari':
      return {
        title: 'Cài đặt ứng dụng trên iPhone',
        lead: 'iPhone không cho trang web tự cài — bạn làm 3 bước sau (khoảng 10 giây):',
        steps: [ST(1, `Bấm nút <b>Chia sẻ</b> ${SHARE} (hình vuông có mũi tên đi lên) ở thanh dưới màn hình`), ST(2, 'Cuộn xuống, chọn <b>Thêm vào MH chính</b> (Add to Home Screen)'), ST(3, 'Bấm <b>Thêm</b> ở góc trên bên phải')],
        foot: 'Xong là có biểu tượng <b>QTD Bình Nguyên</b> ở màn hình chính, mở lên dùng như app thật.',
      };
    case 'ios-other':
      return {
        title: 'Cài đặt ứng dụng trên iPhone',
        lead: 'Trên iPhone, cài ứng dụng bằng nút Chia sẻ:',
        steps: [ST(1, `Bấm nút <b>Chia sẻ</b> ${SHARE} (trên thanh địa chỉ hoặc trong menu <b>⋯</b>)`), ST(2, 'Chọn <b>Thêm vào MH chính</b> (Add to Home Screen)'), ST(3, 'Bấm <b>Thêm</b>')],
        foot: 'Không thấy mục "Thêm vào MH chính"? Hãy mở trang này bằng <b>Safari</b> rồi làm lại.',
        copy: true,
      };
    case 'android-firefox':
      return {
        title: 'Cài đặt ứng dụng',
        lead: 'Trên Firefox, bạn làm như sau:',
        steps: [ST(1, 'Bấm nút <b>⋮</b> (3 chấm) ở góc trên bên phải'), ST(2, 'Chọn <b>Cài đặt</b> (hoặc <b>Thêm vào màn hình chính</b>)'), ST(3, 'Xác nhận <b>Thêm</b>')],
        foot: 'Nên dùng <b>Chrome</b> để cài được dễ nhất — có hộp thoại cài sẵn, chỉ cần bấm đồng ý.',
        copy: true,
      };
    case 'android-other':
      return {
        title: 'Cài đặt ứng dụng',
        lead: 'Nếu bạn <b>đã cài</b>, hãy mở ứng dụng từ biểu tượng <b>QTD Bình Nguyên</b> ngoài màn hình chính. Nếu chưa cài:',
        steps: [ST(1, 'Bấm nút <b>⋮</b> (3 chấm) ở góc trình duyệt'), ST(2, 'Chọn <b>Cài đặt ứng dụng</b> (hoặc <b>Thêm vào màn hình chính</b>)'), ST(3, 'Xác nhận để thêm')],
        foot: 'Dùng <b>Chrome</b> sẽ cài được dễ nhất.',
        copy: true,
      };
    case 'desktop-chromium':
      return {
        title: 'Cài đặt ứng dụng',
        lead: 'Nếu bạn <b>đã cài</b>, hãy mở ứng dụng từ menu Start (Windows) hoặc Launchpad (Mac). Nếu chưa cài:',
        steps: [ST(1, 'Bấm biểu tượng <b>Cài đặt</b> (màn hình có mũi tên) ở bên phải thanh địa chỉ'), ST(2, 'Hoặc vào menu <b>⋮</b> → <b>Cài đặt QTD Bình Nguyên…</b> (Edge: <b>⋯ → Ứng dụng → Cài đặt trang này làm ứng dụng</b>)'), ST(3, 'Bấm <b>Cài đặt</b>')],
      };
    case 'desktop-safari':
      return {
        title: 'Cài đặt ứng dụng',
        lead: 'Trên Safari (máy Mac, macOS 14 trở lên):',
        steps: [ST(1, 'Mở menu <b>Tệp</b> (File) trên thanh menu phía trên'), ST(2, 'Chọn <b>Thêm vào Dock</b>')],
        foot: 'Phiên bản cũ hơn chưa hỗ trợ — hãy dùng <b>Chrome</b> hoặc <b>Edge</b>.',
      };
    default: // desktop-firefox, desktop-other
      return {
        title: 'Cài đặt ứng dụng',
        lead: 'Trình duyệt này chưa hỗ trợ cài ứng dụng. Hãy mở trang bằng <b>Chrome</b> hoặc <b>Edge</b> để cài.',
        steps: [],
        copy: true,
      };
  }
}

/**
 * Hướng dẫn cài TAY — UI CỦA CHÍNH APP (không phải API trình duyệt) nên mở được ở mọi nơi, kể cả iPhone
 * (Apple không cho web tự cài), Firefox, Safari máy tính và trình duyệt nhúng trong Zalo/Facebook.
 */
export function openInstallGuide() {
  const env = currentInstallEnv();
  const g = guideContent(installGuideKind(env), env);
  openModal({
    title: g.title,
    sheetClass: 'inst-guide',
    bodyHtml: `
      <p class="inst-lead">${g.lead}</p>
      ${g.steps.length ? `<ol class="inst-steps">${g.steps.join('')}</ol>` : ''}
      ${g.foot ? `<p class="inst-foot">${g.foot}</p>` : ''}
      ${g.copy ? `<button type="button" class="btn btn-outline btn-block" id="inst-copy">${icon('copy', 'icon-sm')} Sao chép liên kết</button>` : ''}
    `,
    onMount(sheet) {
      const copyBtn = sheet.querySelector('#inst-copy');
      if (copyBtn) copyBtn.addEventListener('click', async () => {
        if (await copyText(location.origin + location.pathname)) toast('Đã sao chép liên kết — dán vào ô địa chỉ của trình duyệt', 'success');
        else toast('Không sao chép được — hãy nhấn giữ vào địa chỉ trang để sao chép', 'error');
      });
    },
  });
}

let bannerEl = null;

/**
 * Hiện 1 thẻ mời NỔI Ở DƯỚI MÀN HÌNH — đây là UI CỦA CHÍNH APP (không phải hộp thoại thật của trình duyệt) nên tự
 * hiện lên được, an toàn. Bấm "Cài đặt" TRÊN THẺ NÀY mới là lúc gọi hộp thoại thật (cú bấm đó là user gesture hợp lệ,
 * không vi phạm giới hạn của trình duyệt — khác với việc tự gọi thẳng promptInstall() mà không qua cú bấm nào).
 */
function showInstallBanner(onGo, onLater) {
  if (bannerEl || isStandalone()) return;
  bannerEl = document.createElement('div');
  bannerEl.className = 'inst-banner';
  bannerEl.setAttribute('role', 'dialog');
  bannerEl.setAttribute('aria-label', 'Cài đặt ứng dụng');
  bannerEl.innerHTML = `
    <div class="inst-banner-top">
      <img class="inst-banner-ic" src="icons/icon-192.png?v=2" alt="" width="44" height="44">
      <div class="inst-banner-tx"><b>Cài ứng dụng QTD Bình Nguyên</b><span>Mở nhanh từ màn hình chính, nhận thông báo</span></div>
    </div>
    <div class="inst-banner-act">
      <button type="button" class="btn btn-outline" data-later>Để sau</button>
      <button type="button" class="btn btn-primary" data-go>${icon('download', 'icon-sm')} Cài đặt</button>
    </div>
  `;
  document.body.appendChild(bannerEl);
  document.body.classList.add('has-inst-banner'); // trang đăng nhập nhích nội dung lên để thẻ mời không che nút
  bannerEl.querySelector('[data-go]').addEventListener('click', () => { closeBanner(); onGo(); });
  bannerEl.querySelector('[data-later]').addEventListener('click', () => { closeBanner(); if (onLater) onLater(); });
}
function closeBanner() {
  if (bannerEl) { bannerEl.remove(); bannerEl = null; }
  document.body.classList.remove('has-inst-banner');
}
window.addEventListener('appinstalled', closeBanner);

/**
 * Điểm vào DUY NHẤT để tự mời cài đặt ngay khi vừa vào app trên máy CHƯA cài — gọi 1 LẦN lúc khởi động app (xem app.js).
 *   - Chrome/Edge/Samsung/Opera: hiện thẻ mời ngay khi trình duyệt xác nhận "cài được" — bấm "Cài đặt" là hiện hộp
 *     thoại thật của trình duyệt, đồng ý là xong.
 *   - iPhone, Firefox/trình duyệt khác trên điện thoại, và trình duyệt nhúng trong Zalo/Facebook: tự hiện thẻ mời (không có
 *     hộp thoại thật) — bấm "Cài đặt" mở hướng dẫn đúng với máy đang dùng.
 *   - Máy tính: chỉ mời khi trình duyệt có hộp thoại thật (Chrome/Edge), không làm phiền các trình duyệt khác.
 * Bấm "Để sau" hoặc "Cài đặt" thì 7 ngày sau mới mời lại; nút "Cài đặt ứng dụng" ở trang đăng nhập/menu vẫn luôn có sẵn.
 */
export function initAutoInstallPrompt() {
  if (isStandalone() || snoozed()) return;
  const env = currentInstallEnv();
  const go = (run) => () => { snooze(); run(); };
  if (env.chromium) {
    onInstallable(() => showInstallBanner(go(() => runInstallFlow(null)), snooze));
    return;
  }
  if (env.mobile) setTimeout(() => showInstallBanner(go(openInstallGuide), snooze), 1200);
}
