// Hình minh họa NHỎ cho hướng dẫn "mở bằng trình duyệt" (khách mở link trong Zalo/Facebook...): vẽ mô phỏng 3 bước
// bằng SVG nội tuyến (không cần tải ảnh, không lệch phiên bản) — vòng cam là chỗ cần bấm. Dùng trong installBtn.js.

const ORANGE = '#e8590c';
const INK = '#14352d';
const GREY = '#e3eae7';
const FRAME = '#cfd9d5';
const FONT = 'system-ui, -apple-system, Segoe UI, Roboto, sans-serif';

const svg = (h, label, body) =>
  `<svg class="inst-pic" viewBox="0 0 240 ${h}" role="img" aria-label="${label}" xmlns="http://www.w3.org/2000/svg">${body}</svg>`;
const frame = (h) => `<rect x=".5" y=".5" width="239" height="${h - 1}" rx="10" fill="#f3f6f5" stroke="${FRAME}"/>`;
const ring = (cx, cy, r) => `<circle class="inst-ring" cx="${cx}" cy="${cy}" r="${r}" fill="none" stroke="${ORANGE}" stroke-width="2.5"/>`;
const bars = (y) => `<rect x="14" y="${y}" width="120" height="5" rx="2.5" fill="${GREY}"/><rect x="14" y="${y + 11}" width="84" height="5" rx="2.5" fill="${GREY}"/>`;

/** Bước 1: thanh trên cùng của Zalo, khoanh nút menu ở góc phải (Android ⋮ dọc · iPhone ⋯ ngang). */
export function picMenuButton(os) {
  const dots = os === 'ios'
    ? [-7, 0, 7].map((d) => `<circle cx="${212 + d}" cy="20" r="2" fill="${INK}"/>`).join('')
    : [13, 20, 27].map((y) => `<circle cx="212" cy="${y}" r="2" fill="${INK}"/>`).join('');
  return svg(58, 'Thanh trên cùng của Zalo, nút menu khoanh tròn ở góc phải',
    frame(58)
    + `<rect x=".5" y=".5" width="239" height="40" rx="10" fill="#fff" stroke="${FRAME}"/>`
    + `<path d="M19 13l-7 7 7 7" fill="none" stroke="#5b6b66" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/>`
    + `<text x="34" y="18" font-family="${FONT}" font-size="11" font-weight="700" fill="${INK}">QTD Bình Nguyên</text>`
    + `<text x="34" y="31" font-family="${FONT}" font-size="9" fill="#7a8a85">quytindungbn.github.io</text>`
    + dots + ring(212, 20, 15) + bars(46));
}

/** Bước 2: danh sách menu sổ xuống, tô đúng dòng cần chọn. */
export function picMenuItem(os) {
  const label = os === 'ios' ? 'Mở bằng Safari' : 'Mở bằng trình duyệt';
  const row = (y, w) => `<circle cx="104" cy="${y + 12}" r="5" fill="${GREY}"/><rect x="116" y="${y + 9}" width="${w}" height="6" rx="3" fill="${GREY}"/>`;
  return svg(86, `Menu sổ xuống, chọn dòng ${label}`,
    frame(86)
    + `<rect x="86" y="6" width="146" height="76" rx="9" fill="#fff" stroke="${FRAME}"/>`
    + row(10, 72) + row(34, 56)
    + `<rect x="90" y="56" width="138" height="22" rx="7" fill="#fff1e6"/>`
    + `<text x="98" y="71" font-family="${FONT}" font-size="10.5" font-weight="700" fill="${INK}">${label}</text>`
    + `<rect class="inst-ring" x="89" y="55" width="140" height="24" rx="8" fill="none" stroke="${ORANGE}" stroke-width="2.5"/>`
    + `<rect x="14" y="14" width="56" height="5" rx="2.5" fill="${GREY}"/><rect x="14" y="25" width="40" height="5" rx="2.5" fill="${GREY}"/>`);
}

/** Bước 3: trang đã mở trong trình duyệt thật, khoanh nút "Cài đặt ứng dụng". */
export function picInstallButton(os) {
  const browser = os === 'ios' ? 'Safari' : 'Chrome';
  return svg(80, `Trang mở trong ${browser}, nút Cài đặt ứng dụng khoanh tròn`,
    frame(80)
    + `<rect x="10" y="7" width="220" height="20" rx="10" fill="#fff" stroke="${FRAME}"/>`
    + `<text x="120" y="20.5" text-anchor="middle" font-family="${FONT}" font-size="9.5" fill="#5b6b66">quytindungbn.github.io</text>`
    + `<rect x="62" y="42" width="116" height="26" rx="13" fill="#0f6f61"/>`
    + `<text x="120" y="59" text-anchor="middle" font-family="${FONT}" font-size="11" font-weight="700" fill="#fff">Cài đặt ứng dụng</text>`
    + `<rect class="inst-ring" x="57" y="37" width="126" height="36" rx="18" fill="none" stroke="${ORANGE}" stroke-width="2.5"/>`);
}

/** 3 hình cho 3 bước của hướng dẫn "mở bằng trình duyệt" (os: 'ios' | 'android'). */
export function inAppPics(os) {
  return [picMenuButton(os), picMenuItem(os), picInstallButton(os)];
}
