export const NOTE_KINDS = ['none', 'after', 'date', 'monthly'];
export const NOTE_MAX_LEN = 300;
const WEEKDAYS = ['Chủ nhật', 'Thứ Hai', 'Thứ Ba', 'Thứ Tư', 'Thứ Năm', 'Thứ Sáu', 'Thứ Bảy'];
const RANK = { late: 0, today: 1, soon: 2, plain: 3, done: 4 };

const pad = (n) => String(n).padStart(2, '0');
const ISO_RE = /^\d{4}-\d{2}-\d{2}$/;

export function isoOf(date) { return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`; }
export function todayIso(now = new Date()) { return isoOf(now); }
function parseIso(iso) { const [y, m, d] = String(iso).split('-').map(Number); return new Date(y, m - 1, d); }

export function isIsoDate(v) {
  if (!ISO_RE.test(String(v ?? ''))) return false;
  const d = parseIso(v);
  return isoOf(d) === v;
}

export function addDaysIso(iso, n) { const d = parseIso(iso); d.setDate(d.getDate() + n); return isoOf(d); }
export function diffDays(fromIso, toIso) { return Math.round((parseIso(toIso) - parseIso(fromIso)) / 86400000); }
export function formatVnDate(iso) { return isIsoDate(iso) ? `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}` : ''; }
export function formatVnDayMonth(iso) { return isIsoDate(iso) ? `${iso.slice(8, 10)}/${iso.slice(5, 7)}` : ''; }
export function weekdayVi(iso) { return isIsoDate(iso) ? WEEKDAYS[parseIso(iso).getDay()] : ''; }
export function dayMonthTile(iso) { return isIsoDate(iso) ? { day: String(Number(iso.slice(8, 10))), month: `Thg ${Number(iso.slice(5, 7))}` } : null; }

function dayInMonth(year, month0, day) {
  const last = new Date(year, month0 + 1, 0).getDate();
  return new Date(year, month0, Math.min(day, last));
}

export function nextMonthlyOn(day, fromIso, inclusive = true) {
  const from = parseIso(fromIso);
  let cand = dayInMonth(from.getFullYear(), from.getMonth(), day);
  if (inclusive ? cand < from : cand <= from) cand = dayInMonth(from.getFullYear(), from.getMonth() + 1, day);
  return isoOf(cand);
}

function toInt(v, min, max) {
  const n = Number(String(v ?? '').replace(/[^\d-]/g, ''));
  return Number.isInteger(n) && n >= min && n <= max ? n : null;
}

export function firstRemindOn(plan, today) {
  if (plan.kind === 'after') {
    const n = toInt(plan.afterDays, 1, 365);
    return n === null ? null : addDaysIso(today, n);
  }
  if (plan.kind === 'date') return isIsoDate(plan.date) ? plan.date : null;
  if (plan.kind === 'monthly') {
    const d = toInt(plan.monthlyDay, 1, 31);
    return d === null ? null : nextMonthlyOn(d, today, true);
  }
  return null;
}

export function nextAfterDone(note, today) {
  if (note.kind !== 'monthly') return null;
  const day = toInt(note.monthlyDay, 1, 31);
  if (day === null) return null;
  const base = note.remindOn && note.remindOn > today ? note.remindOn : today;
  return nextMonthlyOn(day, base, false);
}

export function noteState(note, today) {
  if (note.status === 'done') return 'done';
  if (!note.remindOn) return 'plain';
  const d = diffDays(today, note.remindOn);
  return d < 0 ? 'late' : d === 0 ? 'today' : 'soon';
}

export function isDue(note, today) {
  const s = noteState(note, today);
  return s === 'late' || s === 'today';
}

export function pillLabel(note, today) {
  const s = noteState(note, today);
  if (s === 'late') return `Trễ ${diffDays(note.remindOn, today)} ngày`;
  if (s === 'today') return 'Hôm nay';
  if (s === 'soon') return `Còn ${diffDays(today, note.remindOn)} ngày`;
  if (s === 'done') return 'Đã xong';
  return 'Ghi chú';
}

export function repeatLabel(note) {
  if (note.kind === 'monthly') return `Hàng tháng · ngày ${note.monthlyDay}`;
  if (note.kind === 'after') return `Khách hẹn ${note.afterDays} ngày`;
  if (note.kind === 'date') return `Hẹn ngày ${formatVnDayMonth(note.remindOn)}`;
  return '';
}

export function sortNotes(notes, today) {
  return notes.slice().sort((a, b) => {
    const sa = noteState(a, today), sb = noteState(b, today);
    if (sa !== sb) return RANK[sa] - RANK[sb];
    if (sa === 'plain' || sa === 'done') return String(b.createdAt || '').localeCompare(String(a.createdAt || ''));
    if (a.remindOn !== b.remindOn) return a.remindOn < b.remindOn ? -1 : 1;
    return String(a.createdAt || '').localeCompare(String(b.createdAt || ''));
  });
}

export function summarize(notes, today) {
  const out = { late: 0, today: 0, soon: 0, plain: 0, total: 0 };
  for (const n of notes) {
    const s = noteState(n, today);
    if (s === 'done') continue;
    out[s] += 1;
    out.total += 1;
  }
  return out;
}

export function describeFirst(plan, today) {
  const iso = firstRemindOn(plan, today);
  if (!iso) return null;
  return { iso, text: `${weekdayVi(iso)}, ${formatVnDate(iso)}`, inDays: diffDays(today, iso) };
}

export function validateDraft(draft) {
  const text = String(draft.text ?? '').replace(/\s+/g, ' ').trim();
  if (!text) return { ok: false, reason: 'Nhập nội dung ghi chú.' };
  if (text.length > NOTE_MAX_LEN) return { ok: false, reason: `Ghi chú tối đa ${NOTE_MAX_LEN} ký tự.` };
  const kind = NOTE_KINDS.includes(draft.kind) ? draft.kind : 'none';
  const clean = { text, kind, afterDays: null, monthlyDay: null, date: null, amount: null, contractId: draft.contractId || null, visibility: draft.visibility === 'me' ? 'me' : 'all' };
  if (kind === 'after') {
    clean.afterDays = toInt(draft.afterDays, 1, 365);
    if (clean.afterDays === null) return { ok: false, reason: 'Số ngày hẹn từ 1 đến 365.' };
  }
  if (kind === 'date') {
    if (!isIsoDate(draft.date)) return { ok: false, reason: 'Chọn ngày nhắc.' };
    clean.date = draft.date;
  }
  if (kind === 'monthly') {
    clean.monthlyDay = toInt(draft.monthlyDay, 1, 31);
    if (clean.monthlyDay === null) return { ok: false, reason: 'Ngày trong tháng từ 1 đến 31.' };
  }
  const rawAmount = String(draft.amount ?? '').replace(/[^\d]/g, '');
  if (rawAmount) {
    const amount = Number(rawAmount);
    if (!Number.isSafeInteger(amount) || amount > 1e12) return { ok: false, reason: 'Số tiền quá lớn.' };
    clean.amount = amount;
  }
  return { ok: true, clean };
}

export function planChanged(note, clean) {
  return note.kind !== clean.kind
    || (clean.kind === 'after' && note.afterDays !== clean.afterDays)
    || (clean.kind === 'monthly' && note.monthlyDay !== clean.monthlyDay)
    || (clean.kind === 'date' && note.remindOn !== clean.date);
}
