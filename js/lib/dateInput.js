import { maskViDate } from '../utils.js';

// Sửa ngày dd/mm/yyyy ngay trong ô nhập (công cụ Tính lãi vay): gõ số đè lên số đang có và tự nhảy qua dấu "/", gõ dấu phân cách để sang phần kế tiếp,
// xóa sát dấu "/" thì xóa luôn số bên cạnh. Chỉ là hàm thuần (không đụng DOM) — phần gắn vào ô nhập nằm ở js/views/admin/loanCalc.js; kiểm thử: tests/dateInput.test.mjs.

const FULL = /^\d{2}\/\d{2}\/\d{4}$/;
const SEPARATORS = '/.-, ';

/** Vị trí con trỏ ngay sau chữ số thứ `n` của chuỗi đã định dạng (n = 0 → đầu chuỗi). */
export function caretAfterDigits(masked, n) {
  if (!(n > 0)) return 0;
  let seen = 0;
  for (let i = 0; i < masked.length; i++) {
    if (/\d/.test(masked[i]) && ++seen === n) return i + 1;
  }
  return masked.length;
}

/**
 * Gõ 1 ký tự `text` vào ô có nội dung `value`, vùng chọn [start, end].
 * Trả { value, caret } khi tự xử lý (cần chặn thao tác mặc định), hoặc null để trình duyệt tự chèn rồi mới định dạng lại.
 * - Ngày đã đủ dd/mm/yyyy: gõ số = đè lên số tại con trỏ (bỏ qua dấu "/"), con trỏ nhảy qua dấu "/" kế tiếp; chọn hết rồi gõ thì nhập lại cả ngày.
 * - Gõ "/", ".", "-", "," hoặc dấu cách: sang phần kế tiếp; phần đang gõ chỉ có 1 số thì thêm số 0 phía trước (5 → 05).
 */
export function typeIntoViDate(value, start, end, text) {
  const v = String(value ?? '');
  if (typeof text !== 'string' || text.length !== 1) return null;
  if (/\d/.test(text)) {
    if (!FULL.test(v)) return null;
    if (start <= 0 && end >= v.length) return null;
    let pos = start;
    if (v[pos] === '/') pos++;
    if (pos >= v.length) return { value: v, caret: v.length };
    const next = v.slice(0, pos) + text + v.slice(pos + 1);
    let caret = pos + 1;
    if (next[caret] === '/') caret++;
    return { value: next, caret };
  }
  if (!SEPARATORS.includes(text)) return null;
  const at = Math.min(Math.max(end, 0), v.length);
  const idx = (v.slice(0, at).match(/\//g) || []).length;
  if (idx >= 2) return { value: v, caret: at };
  const parts = v.split('/');
  if (!parts[idx]) return { value: v, caret: at };
  if (parts[idx].length === 1) parts[idx] = `0${parts[idx]}`;
  const caret = parts.slice(0, idx + 1).join('/').length + 1;
  return { value: parts.length === idx + 1 ? `${parts.join('/')}/` : parts.join('/'), caret };
}

/**
 * Xóa (Backspace: forward = false, Delete: forward = true) khi con trỏ sát dấu "/": xóa luôn số bên cạnh dấu đó, không chỉ xóa mỗi dấu (vì dấu sẽ tự hiện lại).
 * Trả { value, caret } hoặc null (để trình duyệt tự xóa — xóa số thường, hoặc đang có vùng chọn).
 */
export function deleteFromViDate(value, start, end, forward) {
  const v = String(value ?? '');
  if (start !== end) return null;
  const i = forward ? start : start - 1;
  if (i < 0 || i >= v.length || v[i] !== '/') return null;
  const j = forward ? i + 1 : i - 1;
  if (j < 0 || j >= v.length) return null;
  const digitsBefore = v.slice(0, j).replace(/\D/g, '').length;
  const masked = maskViDate(v.slice(0, j) + v.slice(j + 1));
  return { value: masked, caret: caretAfterDigits(masked, digitsBefore) };
}
