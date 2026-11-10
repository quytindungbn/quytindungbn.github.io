const HIDDEN_PLACES = new Set(['binh son', 'quang ngai']);
const UNIT_PREFIX = /^(xa|huyen|thi tran|phuong|tinh|thanh pho|tp)\b\.?\s*/;

const plain = (text) => String(text || '').normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/đ/gi, 'd').toLowerCase().replace(/\s+/g, ' ').trim();
const unitName = (part) => plain(part).replace(UNIT_PREFIX, '');
const isProvincePart = (part) => /^(tinh|thanh pho|tp)\b/.test(plain(part));

export function isXomName(value) {
  const low = String(value || '').normalize('NFC').trim().toLowerCase();
  return low.startsWith('xóm') || low.startsWith('xom');
}

export function shortAddress(address) {
  const parts = String(address || '').normalize('NFC').replace(/\([^)]*\)/g, '').split(',')
    .map((part) => part.trim()).filter(Boolean)
    .filter((part, i, all) => i === 0 || plain(part) !== plain(all[i - 1]));
  const cut = parts.findIndex(isProvincePart);
  const head = cut < 0 ? parts : parts.slice(0, cut + 1);
  const shown = head.filter((part) => !HIDDEN_PLACES.has(unitName(part)));
  return (shown.length ? shown : head).join(', ');
}

function fieldOf(part) {
  const low = String(part).toLowerCase();
  if (low.startsWith('xóm') || low.startsWith('xom')) return 'xom';
  if (low.startsWith('thôn') || low.startsWith('thon')) return 'thon';
  if (low.startsWith('xã') || low.startsWith('xa ') || low.startsWith('phường') || low.startsWith('thị trấn') || low.startsWith('huyện')) return 'xa';
  if (low.startsWith('tỉnh') || low.startsWith('tp') || low.startsWith('thành phố')) return 'tinh';
  return null;
}

export function parseAddress(raw) {
  const text = String(raw || '').trim();
  const withoutNote = text.replace(/\([^)]*\)/g, '');
  const parts = withoutNote.split(',').map((s) => s.trim()).filter(Boolean);
  const result = { xom: '', thon: '', xa: '', tinh: '' };
  const rest = [];

  let currentField = null;
  for (const p of parts) {
    const field = fieldOf(p);
    if (field) { result[field] = p; currentField = field; }
    else if (currentField) result[currentField] += ', ' + p;
    else rest.push(p);
  }

  if (!result.tinh && parts.length) result.tinh = parts[parts.length - 1];
  if (!result.xa && rest.length) result.xa = rest.shift();
  if (!result.thon && parts.length >= 2) result.thon = parts[1];
  if (!result.xom && parts.length >= 1 && !fieldOf(parts[0])) result.xom = parts[0];
  return result;
}
