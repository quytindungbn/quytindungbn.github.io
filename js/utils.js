export function genId(prefix = 'id') {
  return `${prefix}_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
}

export function formatNumber(n) {
  return Math.round(n || 0).toLocaleString('vi-VN');
}

export function formatVND(n) {
  return `${formatNumber(n)} ₫`;
}

export function compactParts(n) {
  const v = Math.round(Number(n) || 0);
  const abs = Math.abs(v);
  const fmt = (x) => x.toLocaleString('vi-VN', { maximumFractionDigits: 2 });
  if (abs >= 1e9 || Math.round(abs / 1e4) / 100 >= 1000) return { num: fmt(v / 1e9), unit: 'tỷ đ' };
  if (abs >= 1e6) return { num: fmt(v / 1e6), unit: 'triệu đ' };
  return { num: formatNumber(v), unit: 'đ' };
}

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

export function parseViDate(text) {
  const m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(String(text ?? '').trim());
  if (!m) return null;
  const day = Number(m[1]), month = Number(m[2]), year = Number(m[3]);
  const dt = new Date(year, month - 1, day);
  return dt.getFullYear() === year && dt.getMonth() === month - 1 && dt.getDate() === day ? dt : null;
}

export function maskViDate(raw) {
  const digits = String(raw ?? '').replace(/\D/g, '').slice(0, 8);
  return [digits.slice(0, 2), digits.slice(2, 4), digits.slice(4)].filter(Boolean).join('/');
}

export function toDateInputValue(d) {
  const dt = d instanceof Date ? d : new Date(d);
  return `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}-${String(dt.getDate()).padStart(2, '0')}`;
}

const BOLD_DIGITS = ['𝟎', '𝟏', '𝟐', '𝟑', '𝟒', '𝟓', '𝟔', '𝟕', '𝟖', '𝟗'];
export function boldDigits(s) {
  return String(s ?? '').replace(/[0-9]/g, (d) => BOLD_DIGITS[Number(d)]);
}

export async function copyText(text) {
  try {
    if (typeof navigator !== 'undefined' && navigator.clipboard && typeof window !== 'undefined' && window.isSecureContext) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {  }
  try {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.setAttribute('readonly', '');
    ta.style.cssText = 'position:fixed;top:0;left:0;width:1px;height:1px;opacity:0';
    document.body.appendChild(ta);
    ta.select();
    ta.setSelectionRange(0, text.length);
    const ok = document.execCommand('copy');
    ta.remove();
    return ok;
  } catch { return false; }
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

export function colorAt(index) {
  return PALETTE[index % PALETTE.length];
}

export function detectDeviceKind() {
  const ua = (typeof navigator !== 'undefined' && navigator.userAgent) || '';
  if (/iPad|Tablet|PlayBook|Silk/i.test(ua) || (/Android/i.test(ua) && !/Mobile/i.test(ua))) return 'tablet';
  if (/Mobi|iPhone|iPod|Android|Windows Phone|BlackBerry|Opera Mini/i.test(ua)) return 'phone';
  if (/Macintosh/i.test(ua) && typeof navigator !== 'undefined' && navigator.maxTouchPoints > 1) return 'tablet';
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

export function stripDiacriticsKeepCase(str) {
  return String(str || '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/đ/g, 'd').replace(/Đ/g, 'D')

    .replace(/\s*₫/g, 'd');
}

export function stripDiacritics(str) {
  return stripDiacriticsKeepCase(str)
    .toUpperCase()
    .replace(/[^A-Z0-9 ]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function maskCccd(cccd) {
  const s = String(cccd || '');
  if (s.length <= 7) return s;
  return s.slice(0, 3) + '•'.repeat(s.length - 7) + s.slice(-4);
}

export function daysUntil(dateStr) {
  return daysBetween(new Date(), new Date(dateStr));
}
