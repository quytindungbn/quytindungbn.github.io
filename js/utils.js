// Các hàm tiện ích dùng chung: định dạng tiền, ngày, id, rng...

export function genId(prefix = 'id') {
  return `${prefix}_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
}

/** Định dạng số nguyên kiểu VN: 1234567 -> "1.234.567" */
export function formatNumber(n) {
  return Math.round(n || 0).toLocaleString('vi-VN');
}

/** Định dạng tiền tệ đầy đủ: 225000 -> "225.000 ₫" */
export function formatVND(n) {
  return `${formatNumber(n)} ₫`;
}

/**
 * Số tiền rút gọn kèm đơn vị: 429000000 -> { num: '429', unit: 'triệu đ' }, 95610000000 -> { num: '95,61', unit: 'tỷ đ' }.
 * Tối đa 2 số lẻ và bỏ số 0 thừa: 429,00 -> "429", 429,50 -> "429,5". Dưới 1 triệu hiện số đầy đủ: 950.000 đ.
 */
export function compactParts(n) {
  const v = Math.round(Number(n) || 0);
  const abs = Math.abs(v);
  const fmt = (x) => x.toLocaleString('vi-VN', { maximumFractionDigits: 2 });
  if (abs >= 1e9 || Math.round(abs / 1e4) / 100 >= 1000) return { num: fmt(v / 1e9), unit: 'tỷ đ' }; // 999,999 triệu làm tròn thành 1 tỷ
  if (abs >= 1e6) return { num: fmt(v / 1e6), unit: 'triệu đ' };
  return { num: formatNumber(v), unit: 'đ' };
}

/** Định dạng rút gọn cho số liệu nổi bật: 1020000 -> "1,02 triệu đ", 429000000 -> "429 triệu đ". Dưới 1 triệu: số đầy đủ, không đơn vị. */
export function formatCompact(n) {
  const { num, unit } = compactParts(n);
  return Math.abs(Math.round(Number(n) || 0)) >= 1e6 ? `${num} ${unit}` : num;
}

const WEEKDAYS = ['CN', 'Thứ 2', 'Thứ 3', 'Thứ 4', 'Thứ 5', 'Thứ 6', 'Thứ 7'];
const MONTHS = ['Th1','Th2','Th3','Th4','Th5','Th6','Th7','Th8','Th9','Th10','Th11','Th12'];

export function formatDate(d) {
  const dt = d instanceof Date ? d : new Date(d);
  const dd = String(dt.getDate()).padStart(2, '0');
  const mm = String(dt.getMonth() + 1).padStart(2, '0');
  return `${dd}/${mm}/${dt.getFullYear()}`;
}

/** "dd/mm/yyyy" -> Date (00:00 giờ địa phương); sai định dạng hoặc ngày không có thật (VD 31/02/2026) -> null. */
export function parseViDate(text) {
  const m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(String(text ?? '').trim());
  if (!m) return null;
  const day = Number(m[1]), month = Number(m[2]), year = Number(m[3]);
  const dt = new Date(year, month - 1, day);
  return dt.getFullYear() === year && dt.getMonth() === month - 1 && dt.getDate() === day ? dt : null;
}

/** Gõ số liền (VD "25102026") tự chèn dấu "/" thành "25/10/2026"; bỏ ký tự không phải số, tối đa 8 số. */
export function maskViDate(raw) {
  const digits = String(raw ?? '').replace(/\D/g, '').slice(0, 8);
  return [digits.slice(0, 2), digits.slice(2, 4), digits.slice(4)].filter(Boolean).join('/');
}

/** Date -> "YYYY-MM-DD" theo giờ địa phương (giá trị của ô <input type="date">; KHÔNG dùng toISOString vì lệch múi giờ). */
export function toDateInputValue(d) {
  const dt = d instanceof Date ? d : new Date(d);
  return `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}-${String(dt.getDate()).padStart(2, '0')}`;
}

// Thông báo đẩy hệ thống (Notification API) KHÔNG hỗ trợ chữ đậm/HTML thật —
// mọi trình duyệt/điện thoại chỉ hiện được chữ thường, không có cách nào bật
// bold/markdown ở đó (giới hạn của chuẩn Web Push/Notification, không phải
// giới hạn riêng của app — y hệt lý do đã áp dụng trong
// supabase/functions/send-due-reminders/index.ts). Cách gần đúng nhất để số
// tiền/ngày "nổi bật" hơn hẳn phần chữ xung quanh: đổi CHỮ SỐ thường sang bộ
// ký tự Unicode "Mathematical Bold" — nhìn đậm hẳn trên hầu hết máy hiện đại
// dù về bản chất vẫn là text thường, không phải định dạng.
const BOLD_DIGITS = ['𝟎', '𝟏', '𝟐', '𝟑', '𝟒', '𝟓', '𝟔', '𝟕', '𝟖', '𝟗'];
export function boldDigits(s) {
  return String(s ?? '').replace(/[0-9]/g, (d) => BOLD_DIGITS[Number(d)]);
}

export function formatDateTime(d) {
  const dt = d instanceof Date ? d : new Date(d);
  const hh = String(dt.getHours()).padStart(2, '0');
  const mi = String(dt.getMinutes()).padStart(2, '0');
  return `${hh}:${mi} ${formatDate(dt)}`;
}

export function formatRelativeShort(d) {
  const dt = d instanceof Date ? d : new Date(d);
  return `${MONTHS[dt.getMonth()]}`;
}

export function startOfDay(d) {
  const dt = new Date(d);
  dt.setHours(0, 0, 0, 0);
  return dt;
}

export function addDays(d, n) {
  const dt = new Date(d);
  dt.setDate(dt.getDate() + n);
  return dt;
}

export function daysBetween(a, b) {
  return Math.round((startOfDay(b) - startOfDay(a)) / 86400000);
}

/** RNG có seed để tạo dữ liệu mẫu ổn định */
export function mulberry32(seed) {
  let a = seed;
  return function () {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function pick(rng, arr) {
  return arr[Math.floor(rng() * arr.length)];
}

export function randInt(rng, min, max) {
  return Math.floor(rng() * (max - min + 1)) + min;
}

export function initials(name) {
  const words = String(name ?? '').trim().split(/\s+/).filter(Boolean);
  if (!words.length) return '?';
  return (words[0][0] + (words.length > 1 ? words[words.length - 1][0] : '')).toUpperCase();
}

const PALETTE = ['#2f6fed', '#16a34a', '#d97706', '#db2777', '#7c3aed', '#0891b2', '#dc2626', '#4d7c0f'];
export function colorFor(seed) {
  let h = 0;
  const s = String(seed);
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
  return PALETTE[h % PALETTE.length];
}
/** Màu theo vị trí (đảm bảo không trùng nhau trong 1 danh sách ngắn) */
export function colorAt(index) {
  return PALETTE[index % PALETTE.length];
}

/** Thiết bị đang dùng: 'phone' | 'tablet' | 'desktop' (đoán theo User-Agent) — ghi vào Nhật ký lúc đăng nhập. */
export function detectDeviceKind() {
  const ua = (typeof navigator !== 'undefined' && navigator.userAgent) || '';
  if (/iPad|Tablet|PlayBook|Silk/i.test(ua) || (/Android/i.test(ua) && !/Mobile/i.test(ua))) return 'tablet';
  if (/Mobi|iPhone|iPod|Android|Windows Phone|BlackBerry|Opera Mini/i.test(ua)) return 'phone';
  if (/Macintosh/i.test(ua) && typeof navigator !== 'undefined' && navigator.maxTouchPoints > 1) return 'tablet'; // iPadOS giả danh Mac
  return 'desktop';
}

export function escapeHtml(str) {
  return String(str ?? '').replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[c]));
}

export function debounce(fn, ms = 250) {
  let t;
  return (...args) => {
    clearTimeout(t);
    t = setTimeout(() => fn(...args), ms);
  };
}

/** Chỉ bỏ dấu tiếng Việt — GIỮ NGUYÊN chữ hoa/thường + dấu câu (: . , ...). Dùng cho nội dung cần đọc tự nhiên (VD: tin nhắn SMS). */
export function stripDiacriticsKeepCase(str) {
  return String(str || '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/đ/g, 'd').replace(/Đ/g, 'D')
    // Ký hiệu tiền "₫" (dấu Đồng, VD: formatVND() trả về "48.000 ₫") là 1 KÝ
    // TỰ RIÊNG (U+20AB), KHÔNG phải chữ "đ" có dấu nên .normalize('NFD') ở
    // trên không đụng tới — phải tự thay tay, không sẽ lọt dấu ra tin nhắn.
    .replace(/\s*₫/g, 'd');
}
/** Bỏ dấu tiếng Việt, in hoa, bỏ luôn dấu câu — dùng cho nội dung chuyển khoản ngân hàng (thường yêu cầu không dấu, không ký tự lạ). */
export function stripDiacritics(str) {
  return stripDiacriticsKeepCase(str)
    .toUpperCase()
    .replace(/[^A-Z0-9 ]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Che bớt số CCCD khi hiển thị, vd: 023xxxxxxxxx -> 023•••••6789 */
export function maskCccd(cccd) {
  const s = String(cccd || '');
  if (s.length <= 7) return s;
  return s.slice(0, 3) + '•'.repeat(s.length - 7) + s.slice(-4);
}

/** Số ngày còn lại đến hạn (âm = đã quá hạn) */
export function daysUntil(dateStr) {
  return daysBetween(new Date(), new Date(dateStr));
}
