// Thứ tự "mới nhất trước" của hợp đồng ở Khách hàng & Hợp đồng: NGÀY VAY mới nhất trước; cùng ngày vay thì SỐ THỨ TỰ HĐTD lớn trước.
// Số HĐTD dạng "461/26": 461 là số thứ tự (khóa chính), 26 chỉ là NĂM (chỉ xét sau số thứ tự). Hàm thuần — có bài kiểm thử riêng.

/** Tách số HĐTD "461/26" → { seq: 461, year: 26 }. Không đọc được số thứ tự thì seq/year = -1 (xếp cuối). */
export function contractSeq(code) {
  const m = String(code ?? '').trim().match(/^(\d+)\s*(?:\/\s*(\d+))?/);
  return m ? { seq: Number(m[1]), year: m[2] === undefined ? -1 : Number(m[2]) } : { seq: -1, year: -1 };
}

/** Ngày vay dạng chuỗi so sánh được ("YYYY-MM-DD"); thiếu/sai thì '' (xếp cuối). */
function dateKey(v) {
  if (v instanceof Date) return Number.isNaN(v.getTime()) ? '' : v.toISOString().slice(0, 10);
  const s = String(v ?? '').trim();
  return /^\d{4}-\d{2}-\d{2}/.test(s) ? s.slice(0, 10) : '';
}

/** So sánh 2 hợp đồng, mới nhất trước: ngày vay giảm dần → số thứ tự HĐTD giảm dần → năm của HĐTD giảm dần. */
export function compareContractsNewestFirst(a, b) {
  const da = dateKey(a?.disbursedDate), db = dateKey(b?.disbursedDate);
  if (da !== db) return da < db ? 1 : -1;
  const x = contractSeq(a?.code), y = contractSeq(b?.code);
  if (x.seq !== y.seq) return y.seq - x.seq;
  return y.year - x.year;
}
