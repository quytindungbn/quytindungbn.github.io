// Người cùng vay (cột D file số 1 → contracts.heir_name): tên lấy tự động từ hợp đồng, lưu theo từng khách hàng (Use),
// kèm số điện thoại + lựa chọn gửi Zalo OA. Hàm thuần — dùng chung cho màn hình và (bản sao ở Edge Function) lúc nhập Excel.

/** Chuẩn hóa tên để so sánh: bỏ khoảng trắng thừa, không phân biệt hoa/thường (giữ nguyên dấu tiếng Việt). */
export function normPersonName(name) {
  return String(name || '').normalize('NFC').replace(/\s+/g, ' ').trim().toLowerCase();
}

/** Hai tên có cùng 1 người không (cùng họ tên, bỏ qua hoa/thường & khoảng trắng). Tên trống thì không bao giờ trùng. */
export function samePerson(a, b) {
  const x = normPersonName(a);
  return !!x && x === normPersonName(b);
}

/**
 * Các tên người cùng vay có trong danh sách hợp đồng (heirName), theo thứ tự hợp đồng, không trùng nhau, bỏ tên trống
 * và tên trùng chính khách vay. Hợp đồng nào thì `contracts` đã được lọc sẵn (thường là các hợp đồng còn dư nợ).
 */
export function heirNamesOf(contracts, customerName) {
  const out = [];
  for (const ct of contracts || []) {
    const n = String(ct.heirName || '').replace(/\s+/g, ' ').trim();
    if (!n || samePerson(n, customerName)) continue;
    if (!out.some((x) => samePerson(x, n))) out.push(n);
  }
  return out;
}

/**
 * Đối chiếu người cùng vay ĐÃ LƯU của khách với các tên có trong hợp đồng:
 *  - 'none'    : hợp đồng không ghi người cùng vay → giữ nguyên những gì đã lưu, không làm gì.
 *  - 'fill'    : chưa lưu ai → lưu tên đầu tiên trong hợp đồng.
 *  - 'keep'    : tên đã lưu vẫn có trong hợp đồng → giữ nguyên (số điện thoại + lựa chọn gửi OA vẫn như cũ).
 *  - 'replace' : tên đã lưu không còn trong hợp đồng nào, hợp đồng ghi người khác → thay bằng người mới (xóa số cũ),
 *                và khách bị bỏ khỏi danh sách OA; khi thêm lại sẽ có cảnh báo (prev = tên cũ).
 */
export function reconcileCoBorrower(savedName, heirNames) {
  const names = heirNames || [];
  if (!names.length) return { action: 'none', name: String(savedName || '') };
  if (!String(savedName || '').trim()) return { action: 'fill', name: names[0] };
  if (names.some((n) => samePerson(n, savedName))) return { action: 'keep', name: String(savedName) };
  return { action: 'replace', name: names[0], prev: String(savedName) };
}

/**
 * Kiểm tra số điện thoại người cùng vay khi nhập: ĐÚNG 10 chữ số và bắt đầu bằng số 0 (bỏ khoảng trắng, dấu chấm, gạch nối).
 * Để trống là hợp lệ (nghĩa là xóa số). Trả { ok, empty, phone, reason }.
 */
export function checkCoPhone(raw) {
  const digits = String(raw ?? '').replace(/[\s.\-()]/g, '');
  if (!digits) return { ok: true, empty: true, phone: '' };
  if (!/^\d+$/.test(digits)) return { ok: false, reason: 'Số điện thoại chỉ được nhập chữ số.' };
  if (digits[0] !== '0') return { ok: false, reason: 'Số điện thoại phải bắt đầu bằng số 0.' };
  if (digits.length !== 10) return { ok: false, reason: 'Số điện thoại phải đủ 10 số.' };
  return { ok: true, empty: false, phone: digits };
}

/**
 * Lọc những gì gõ/dán vào ô số điện thoại: chỉ giữ chữ số, tối đa 10 số; dán dạng "+84 988 777 666" hoặc "84988777666" thì đổi thành 0988777666.
 */
export function sanitizeCoPhoneInput(raw) {
  let v = String(raw ?? '');
  if (/^\s*\+84/.test(v)) v = v.replace(/^\s*\+84/, '0');
  v = v.replace(/\D/g, '');
  if (/^84\d{9}$/.test(v)) v = '0' + v.slice(2);
  return v.slice(0, 10);
}
