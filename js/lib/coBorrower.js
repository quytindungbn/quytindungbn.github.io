// Người cùng vay (cột D file số 1 → contracts.heir_name) và gửi Zalo OA THEO TỪNG HỢP ĐỒNG (docs mục 10.83).
//  · Tên người cùng vay lấy tự động từ từng hợp đồng; số điện thoại lưu trong "sổ người cùng vay" của khách (customer.coPeople) —
//    nhập 1 lần dùng cho mọi hợp đồng có tên người đó.
//  · Mỗi hợp đồng có công tắc bật/tắt gửi OA + tick Khách vay / Người cùng vay (CHỈ người có tên trong chính hợp đồng đó).
// Hàm thuần — dùng chung cho màn hình; Edge Function có bản sao (tests/coBorrower.test.mjs + scratchpad edge test giữ hai bên khớp nhau).

/** Chuẩn hóa tên để so sánh: bỏ khoảng trắng thừa, không phân biệt hoa/thường (giữ nguyên dấu tiếng Việt). */
export function normPersonName(name) {
  return String(name || '').normalize('NFC').replace(/\s+/g, ' ').trim().toLowerCase();
}

/** Hai tên có cùng 1 người không (cùng họ tên, bỏ qua hoa/thường & khoảng trắng). Tên trống thì không bao giờ trùng. */
export function samePerson(a, b) {
  const x = normPersonName(a);
  return !!x && x === normPersonName(b);
}

/** Hai số điện thoại có cùng 1 số không (bỏ ký tự lạ, +84/84 → 0). Số trống thì không bao giờ trùng. */
export function samePhone(a, b) {
  const n = (v) => String(v || '').replace(/[^\d]/g, '').replace(/^84/, '0');
  return !!n(a) && n(a) === n(b);
}

/** Họ tên người cùng vay ghi trên 1 hợp đồng ('' nếu không ghi, hoặc ghi trùng chính khách vay). */
export function heirOfContract(contract, customerName) {
  const n = String(contract?.heirName || '').replace(/\s+/g, ' ').trim();
  return !n || samePerson(n, customerName) ? '' : n;
}

/**
 * Các tên người cùng vay có trong danh sách hợp đồng (heirName), theo thứ tự hợp đồng, không trùng nhau, bỏ tên trống
 * và tên trùng chính khách vay. Hợp đồng nào thì `contracts` đã được lọc sẵn (thường là các hợp đồng còn dư nợ).
 */
export function heirNamesOf(contracts, customerName) {
  const out = [];
  for (const ct of contracts || []) {
    const n = heirOfContract(ct, customerName);
    if (n && !out.some((x) => samePerson(x, n))) out.push(n);
  }
  return out;
}

/** Số điện thoại đã lưu của 1 người trong sổ người cùng vay (tìm theo tên, không phân biệt hoa/thường); chưa có thì ''. */
export function coPhoneOf(people, name) {
  const p = (people || []).find((x) => samePerson(x?.name, name));
  return p ? String(p.phone || '') : '';
}

/**
 * Trạng thái gửi Zalo OA CÓ HIỆU LỰC của 1 hợp đồng (customer: { name, phone, coPeople }):
 *  - enabled : hợp đồng đang bật gửi OA (tắt thì không gửi gì, không hiện trong lịch sử gửi).
 *  - coName/coPhone : người cùng vay GHI TRÊN HỢP ĐỒNG NÀY và số đã lưu (chưa có số thì coLocked = true, không tick được).
 *  - mainLocked : khách vay chưa có số điện thoại → không tick được.
 *  - toCo : người cùng vay nhận tin hợp đồng này — chỉ khi đã tick ĐÚNG người này (oaCoKey khớp tên trên hợp đồng) và có số;
 *  - toMain : khách vay nhận tin; luôn còn ít nhất 1 người nhận (người cùng vay không nhận được thì khách vay nhận).
 *  - recipients : danh sách số sẽ nhận tin ({ who: 'main'|'co', phone }), trùng số chỉ giữ 1.
 */
export function contractOa(contract, customer) {
  const enabled = contract?.oaEnabled !== false;
  const coName = heirOfContract(contract, customer?.name);
  const coPhone = coName ? coPhoneOf(customer?.coPeople, coName) : '';
  const mainPhone = String(customer?.phone || '').trim();
  const coLocked = !!coName && !coPhone;
  const mainLocked = !mainPhone;
  const coUsable = !!coName && !!coPhone && !samePhone(coPhone, mainPhone);
  const ticked = contract?.oaToCo === true && !!coName && samePerson(contract?.oaCoKey, coName);
  const toCo = enabled && ticked && coUsable;
  const toMain = enabled && (contract?.oaToMain !== false || !toCo) && !mainLocked;
  const recipients = [];
  if (toMain) recipients.push({ who: 'main', phone: mainPhone });
  if (toCo) recipients.push({ who: 'co', phone: coPhone });
  return { enabled, coName, coPhone, coLocked, mainLocked, toCo, toMain, recipients };
}

/**
 * Tóm tắt gửi Zalo OA của 1 khách qua các hợp đồng (contracts: các hợp đồng còn hiệu lực) — dùng cho Danh sách OA / Gửi tự động:
 *  - mode : 'main' (chỉ khách vay) · 'co' (chỉ người cùng vay) · 'both' · 'none' (mọi hợp đồng đã tắt hoặc không còn ai nhận).
 *  - custom : có gì khác mặc định (có người cùng vay nhận, có hợp đồng tắt, hợp đồng bật mà chưa có số nào để gửi, hoặc khách vay bị bỏ tick) → mới cần dòng "Gửi tới".
 *  - items : từng hợp đồng + trạng thái, theo thứ tự.
 */
export function customerOaSummary(contracts, customer) {
  const items = (contracts || []).map((ct) => ({ contract: ct, state: contractOa(ct, customer) }));
  const anyMain = items.some((x) => x.state.toMain);
  const anyCo = items.some((x) => x.state.toCo);
  const offCount = items.filter((x) => !x.state.enabled).length;
  const mode = anyMain && anyCo ? 'both' : anyCo ? 'co' : anyMain ? 'main' : 'none';
  const noRecipient = items.some((x) => x.state.enabled && !x.state.recipients.length); // hợp đồng bật nhưng không có số nào để gửi (khách vay chưa có số...)
  const custom = anyCo || offCount > 0 || noRecipient || items.some((x) => x.state.enabled && !x.state.toMain && !x.state.mainLocked);
  return { items, anyMain, anyCo, offCount, noRecipient, mode, custom };
}

/** Tên gọi ngắn của 1 người (từ cuối họ tên, viết hoa chữ đầu): "TRẦN THỊ BÍCH" → "Bích". */
export function shortPersonName(name) {
  const words = String(name || '').trim().split(/\s+/).filter(Boolean);
  const w = words[words.length - 1] || '';
  return w ? w.charAt(0).toLocaleUpperCase('vi') + w.slice(1).toLocaleLowerCase('vi') : '';
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
