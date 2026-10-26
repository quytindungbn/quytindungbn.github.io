const WEEKDAYS = ['Chủ nhật', 'Thứ Hai', 'Thứ Ba', 'Thứ Tư', 'Thứ Năm', 'Thứ Sáu', 'Thứ Bảy'];
const pad2 = (n) => String(n).padStart(2, '0');
const startOfDay = (d) => new Date(d.getFullYear(), d.getMonth(), d.getDate());

export function describeCallTime(iso, now = new Date()) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return { time: '--:--', date: '', weekday: '', rel: '', ago: '', days: 0 };
  const days = Math.max(0, Math.round((startOfDay(now) - startOfDay(d)) / 86400000));
  const minutes = Math.max(0, Math.floor((now - d) / 60000));
  let rel;
  if (days === 0) rel = 'Hôm nay';
  else if (days === 1) rel = 'Hôm qua';
  else if (days < 31) rel = `${days} ngày trước`;
  else if (days < 365) rel = `${Math.floor(days / 30)} tháng trước`;
  else rel = `${Math.floor(days / 365)} năm trước`;
  let ago = '';
  if (days === 0) ago = minutes < 1 ? 'Vừa xong' : minutes < 60 ? `${minutes} phút trước` : `${Math.floor(minutes / 60)} giờ trước`;
  return {
    time: `${pad2(d.getHours())}:${pad2(d.getMinutes())}`,
    date: `${pad2(d.getDate())}/${pad2(d.getMonth() + 1)}/${d.getFullYear()}`,
    weekday: WEEKDAYS[d.getDay()],
    rel, ago, days,
  };
}

export function formatPhoneDisplay(phone) {
  const raw = String(phone ?? '').trim();
  const digits = raw.replace(/[^\d]/g, '');
  if (/^0\d{9}$/.test(digits) && !raw.startsWith('+')) return `${digits.slice(0, 4)} ${digits.slice(4, 7)} ${digits.slice(7)}`;
  return raw.replace(/\s+/g, ' ');
}
