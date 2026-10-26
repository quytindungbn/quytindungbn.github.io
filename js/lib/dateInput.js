import { maskViDate } from '../utils.js';

const FULL = /^\d{2}\/\d{2}\/\d{4}$/;
const SEPARATORS = '/.-, ';

export function caretAfterDigits(masked, n) {
  if (!(n > 0)) return 0;
  let seen = 0;
  for (let i = 0; i < masked.length; i++) {
    if (/\d/.test(masked[i]) && ++seen === n) return i + 1;
  }
  return masked.length;
}

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
