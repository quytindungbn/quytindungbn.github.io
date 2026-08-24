// ============================================================
// Lớp dữ liệu & nghiệp vụ trung tâm (state) — ĐÃ KẾT NỐI SUPABASE THẬT
// (xem docs/supabase-migration.md): đăng nhập, khách hàng/hợp đồng, tài
// khoản, yêu cầu tư vấn, cài đặt tổ chức đều đọc/ghi qua Supabase (Edge
// Function + Row Level Security), không còn chỉ chạy trên localStorage.
// `state` object trong file này vẫn đóng vai trò CACHE trong bộ nhớ (để
// giữ nguyên toàn bộ UI/view layer không cần sửa) — mọi hàm ghi đều gọi
// Supabase trước, thành công mới cập nhật cache + notify() để vẽ lại màn
// hình. localStorage/seedDemoData() chỉ còn dùng làm dữ liệu demo hiển
// thị TẠM lúc app chưa kết nối được mạng, không phải nguồn sự thật nữa.
// ============================================================
import { genId, mulberry32, randInt, addDays, daysBetween } from './utils.js';
import { getSupabaseClient, getRealtimeClient, callLoginFunction, callCreateAccountFunction, callImportDataFunction, callForgotPasswordFunction } from './lib/supabaseClient.js';

export const STORAGE_KEY = 'qtd_demo_v3';

export const REQUEST_TYPE = [
  { id: 'vay_moi', label: 'Yêu cầu mở khoản vay mới' },
  { id: 'tu_van', label: 'Yêu cầu tư vấn khác' },
  { id: 'quen_mat_khau', label: 'Yêu cầu cấp lại mật khẩu' },
];
export const REQUEST_STATUS = [
  { id: 'moi', label: 'Mới', badge: 'badge-blue' },
  { id: 'dang_xu_ly', label: 'Đang xử lý', badge: 'badge-yellow' },
  { id: 'da_lien_he', label: 'Đã liên hệ', badge: 'badge-green' },
];
export const REQUEST_STATUS_MAP = Object.fromEntries(REQUEST_STATUS.map((s) => [s.id, s]));

export const CONTRACT_STATUS = [
  { id: 'dang_vay', label: 'Trong hạn', badge: 'badge-blue' },
  { id: 'qua_han', label: 'Quá hạn', badge: 'badge-red' },
  { id: 'da_tat_toan', label: 'Đã tất toán', badge: 'badge-green' },
];
export const CONTRACT_STATUS_MAP = Object.fromEntries(CONTRACT_STATUS.map((s) => [s.id, s]));

const LOCK_AFTER_FAILS = 5;
const LOCK_MINUTES = 15;
export const NEAR_DUE_DAYS = 15;

// Thông tin nhận thanh toán (QR) — NHÚNG CỨNG trong code, KHÔNG đọc/ghi qua
// Supabase (bảng orgs) nữa và KHÔNG sửa được qua "Cài đặt" nữa, kể cả quản
// trị viên toàn quyền (xem js/views/admin/settings.js). Lý do: điện thoại
// đăng nhập sẵn tài khoản toàn quyền mà bị mất/bị kẻ gian chiếm được thì
// trước đây vẫn đổi được số tài khoản ngay trong app — đổi vào đây thì phải
// sửa code + deploy lại (qua Claude Code), kẻ gian có điện thoại tuyệt đối
// không tự đổi được nữa. Muốn đổi ngân hàng/số tài khoản thật thì báo lại để
// sửa 4 dòng dưới đây rồi deploy lại (KHÔNG cần chạy SQL gì, xem docs mục
// 10.18).
export const BANK_INFO = Object.freeze({
  bankName: 'Ngân hàng Hợp tác xã Việt Nam (Co-op Bank)',
  bankBin: '970446',
  bankAccountNo: '5200000000825012',
  bankAccountName: 'QUY TIN DUNG NHAN DAN BINH NGUYEN',
});

let state = null;
const listeners = new Set();
function notify() { persist(); listeners.forEach((fn) => fn()); }
export function subscribe(fn) { listeners.add(fn); return () => listeners.delete(fn); }
export function getState() { return state; }
function persist() {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(state)); }
  catch (e) { console.error('Không lưu được dữ liệu', e); }
}

/** Vá dữ liệu cũ đã lưu trong localStorage từ bản trước — thêm field mới còn thiếu để tránh lỗi (VD: allowedXom). */
function migrateState() {
  if (!state) return;
  (state.admins || []).forEach((a) => {
    if (!Array.isArray(a.allowedThon)) a.allowedThon = [];
    if (!Array.isArray(a.allowedXom)) a.allowedXom = [];
  });
  if (!Array.isArray(state.pushSubscribedCustomerIds)) state.pushSubscribedCustomerIds = [];
  if (!Array.isArray(state.zaloCustomers)) state.zaloCustomers = [];
  if (!Array.isArray(state.zaloAutoSendList)) state.zaloAutoSendList = [];
  if (!Array.isArray(state.zaloSendLog)) state.zaloSendLog = [];
}

export async function init() {
  const raw = localStorage.getItem(STORAGE_KEY);
  if (raw) {
    try { state = JSON.parse(raw); migrateState(); }
    catch (e) { console.warn('Dữ liệu lỗi, tạo lại dữ liệu mẫu.', e); await seedDemoData(); }
  } else {
    await seedDemoData();
  }
  // Thông tin quỹ tín dụng (org) là DUY NHẤT thứ cần hiện ra TRƯỚC khi đăng
  // nhập (màn đăng nhập hiện tên quỹ) — nên tải thẳng từ Supabase ngay lúc
  // khởi động app, không đợi tới lúc đăng nhập như customers/contracts. Bảng
  // orgs cho phép SELECT công khai (không nhạy cảm — banner + số tài khoản
  // ngân hàng vốn phải công khai để khách chuyển khoản), chỉ cần anon key.
  await loadOrgPublic();
  // Phiên đăng nhập cũ khôi phục từ localStorage (tải lại trang/mở lại app)
  // KHÔNG đi qua setSession() nên phải tự bật lắng nghe thời gian thực ở đây
  // — để "tự đăng xuất ngay khi bị cấp lại mật khẩu ở nơi khác" cũng hoạt
  // động đúng cho phiên đã đăng nhập từ trước, không chỉ phiên vừa đăng nhập
  // mới trong đúng lượt mở app này.
  if (state.session) subscribeForceLogout(state.session.role, state.session.id, state.session.sbToken);
  persist();
}

async function loadOrgPublic() {
  try {
    const sb = getSupabaseClient();
    const { data } = await sb.from('orgs').select('*').limit(1).maybeSingle();
    if (data) state.org = mapOrgRow(data);
  } catch (e) {
    console.warn('Không tải được thông tin quỹ tín dụng từ Supabase, tạm dùng dữ liệu demo.', e);
  }
}
function mapOrgRow(row) {
  return {
    id: row.id, name: row.name, shortName: row.short_name, hotline: row.hotline, address: row.address,
    bannerEnabled: !!row.banner_enabled, bannerTitle: row.banner_title || '', bannerText: row.banner_text || '',
    // 4 dòng ngân hàng KHÔNG còn lấy từ Supabase (row.bank_*) nữa — luôn dùng
    // đúng hằng số BANK_INFO nhúng cứng trong code, xem giải thích ở đó.
    ...BANK_INFO,
    // Mã mẫu tin Zalo OA (ZBS Template Message) dùng khi hợp đồng ĐẾN HẠN/QUÁ
    // HẠN — xem trang "Quản lý OA" (js/views/admin/zaloOA.js). Chỉ lưu
    // Template ID (không nhạy cảm) ở đây; App ID/Secret Key/Access Token thật
    // KHÔNG lưu qua bảng orgs (bảng này ai cũng SELECT được, kể cả chưa đăng
    // nhập — xem docs/supabase-migration.md mục 10), mà đặt riêng ở Supabase
    // Secrets + bảng zalo_oa_tokens (chỉ Edge Function đọc được).
    zaloTemplateDueId: row.zalo_template_due_id || '',
    // Mã mẫu tin "Báo lãi" — dùng khi hợp đồng CHƯA đến hạn (gửi tay/tự
    // động 2 mục "Báo lãi tự động hàng tháng"/"Gửi theo ngày cụ thể").
    zaloTemplateInterestId: row.zalo_template_interest_id || '',
  };
}

// ------------------------------------------------------------
// Mật khẩu — băm bằng Web Crypto API (SHA-256 + muối), không cần thư viện ngoài.
// Lưu ý: đây vẫn là mô hình demo (không có backend thật đứng sau).
// ------------------------------------------------------------
async function sha256Hex(text) {
  const data = new TextEncoder().encode(text);
  const digest = await crypto.subtle.digest('SHA-256', data);
  return Array.from(new Uint8Array(digest)).map((b) => b.toString(16).padStart(2, '0')).join('');
}
function randomHex(bytes) {
  const arr = crypto.getRandomValues(new Uint8Array(bytes));
  return Array.from(arr).map((b) => b.toString(16).padStart(2, '0')).join('');
}
export function genTempPassword() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789';
  const arr = crypto.getRandomValues(new Uint8Array(8));
  return Array.from(arr).map((b) => chars[b % chars.length]).join('');
}
async function makeCredential(plainPassword) {
  const salt = randomHex(8);
  const hash = await sha256Hex(salt + ':' + plainPassword);
  return { salt, hash };
}
async function verifyCredential(plainPassword, salt, hash) {
  return (await sha256Hex(salt + ':' + plainPassword)) === hash;
}

// ------------------------------------------------------------
// Tổ chức (thông tin quỹ tín dụng, banner) — admin chỉnh trực tiếp trong app
// ------------------------------------------------------------
export function getOrg() { return state.org; }
/**
 * Sửa thông tin quỹ tín dụng (banner/mẫu Zalo...) — ĐÃ CHUYỂN SANG SUPABASE
 * THẬT, ghi thẳng qua RLS (chỉ admin role='super' được phép, xem policy
 * trong docs). CỐ Ý KHÔNG còn nhận patch 4 field ngân hàng (bankBin/
 * bankName/bankAccountNo/bankAccountName) nữa — map bên dưới không có 4 tên
 * này nên có patch cũng bị bỏ qua, im lặng không lỗi (xem BANK_INFO).
 */
export async function updateOrg(patch) {
  const session = getSession();
  const sb = getSupabaseClient(session?.sbToken);
  const dbPatch = {};
  const map = {
    name: 'name', shortName: 'short_name', hotline: 'hotline', address: 'address',
    bannerEnabled: 'banner_enabled', bannerTitle: 'banner_title', bannerText: 'banner_text',
    zaloTemplateDueId: 'zalo_template_due_id', zaloTemplateInterestId: 'zalo_template_interest_id',
  };
  for (const [k, col] of Object.entries(map)) if (patch[k] !== undefined) dbPatch[col] = patch[k];
  const { error } = await sb.from('orgs').update(dbPatch).eq('id', state.org.id);
  if (error) throw new Error('Không lưu được cài đặt, thử lại sau.');
  Object.assign(state.org, patch);
  notify();
}

// ------------------------------------------------------------
// Tách địa chỉ dạng "Xóm 01, thôn Bình Nguyên, xã Bình Sơn, tỉnh Quảng Ngãi"
// thành từng phần theo từ khóa đầu câu — để admin lọc/phân quyền theo Thôn/Xóm
// mà không cần người nhập liệu tự tách sẵn.
// ------------------------------------------------------------
export function parseAddress(raw) {
  const text = String(raw || '').trim();
  const withoutNote = text.replace(/\([^)]*\)/g, ''); // bỏ ghi chú kiểu "(Trước đây là: ...)"
  const parts = withoutNote.split(',').map((s) => s.trim()).filter(Boolean);
  const result = { xom: '', thon: '', xa: '', tinh: '' };
  const rest = [];
  // Mỗi phần cách nhau bởi dấu phẩy KHÔNG nhất thiết là 1 trường riêng — VD
  // "Xóm 5, Bắc Biên, thôn Bình Nguyên, ..." thì "Bắc Biên" vẫn thuộc về Xóm
  // (chỉ là người nhập lỡ chấm phẩy giữa chừng), không phải Xã/Thôn. Quy tắc:
  // 1 phần bắt đầu bằng từ khóa (Xóm/Thôn/Xã/Tỉnh...) thì MỞ trường mới; phần
  // không có từ khóa thì nối tiếp vào trường đang mở dở — nên "Xóm" sẽ lấy
  // TRỌN VẸN mọi thứ trước từ khóa "thôn" kế tiếp, dù có mấy dấu phẩy đi nữa.
  let currentField = null;
  for (const p of parts) {
    const low = p.toLowerCase();
    let field = null;
    if (low.startsWith('xóm') || low.startsWith('xom')) field = 'xom';
    else if (low.startsWith('thôn') || low.startsWith('thon')) field = 'thon';
    else if (low.startsWith('xã') || low.startsWith('xa ') || low.startsWith('phường') || low.startsWith('thị trấn') || low.startsWith('huyện')) field = 'xa';
    else if (low.startsWith('tỉnh') || low.startsWith('tp') || low.startsWith('thành phố')) field = 'tinh';

    if (field) { result[field] = p; currentField = field; }
    else if (currentField) result[currentField] += ', ' + p;
    else rest.push(p);
  }
  // Dự phòng theo vị trí nếu không nhận ra từ khóa (địa chỉ ghi tắt, không tiền tố)
  if (!result.tinh && parts.length) result.tinh = parts[parts.length - 1];
  if (!result.xa && rest.length) result.xa = rest.shift();
  if (!result.thon && parts.length >= 2) result.thon = parts[1];
  if (!result.xom && parts.length >= 1) result.xom = parts[0];
  return result;
}

// ------------------------------------------------------------
// Khách hàng
// ------------------------------------------------------------
export function listCustomers(filters = {}) {
  let list = state.customers;
  const thonList = [].concat(filters.thon || []).filter(Boolean);
  const xomList = [].concat(filters.xom || []).filter(Boolean);
  if (thonList.length) list = list.filter((c) => thonList.includes(c.thon));
  if (xomList.length) list = list.filter((c) => xomList.includes(c.xom));
  if (filters.adminId) {
    const admin = getAdmin(filters.adminId);
    if (admin && admin.role === 'staff') {
      const allowedThon = new Set(admin.allowedThon || []);
      const allowedXomKeys = new Set(admin.allowedXom || []);
      // So khớp CẶP Thôn+Xóm (xem xomKey()) chứ KHÔNG chỉ mỗi tên Xóm — tên
      // Xóm (VD: "Xóm 8") có thể trùng nhau giữa nhiều Thôn khác nhau, so
      // khớp riêng lẻ tên Xóm sẽ cấp nhầm quyền xem Xóm cùng tên ở Thôn khác.
      list = list.filter((c) => allowedThon.has(c.thon) || allowedXomKeys.has(xomKey(c.thon, c.xom)));
    }
  }
  return list;
}
export function getCustomer(id) { return state.customers.find((c) => c.id === id); }
export function findCustomerByCccd(cccd) { return state.customers.find((c) => c.cccd === String(cccd).trim()); }
/** Tìm khách hàng theo CCCD HOẶC số điện thoại — dùng cho đăng nhập, khách có thể dùng 1 trong 2 số. */
export function findCustomerByIdentifier(value) {
  const v = String(value || '').trim();
  const vNoSpace = v.replace(/\s/g, '');
  return state.customers.find((c) => c.cccd === v || (c.phone && c.phone.replace(/\s/g, '') === vNoSpace));
}

export function listContractsByCustomer(customerId) {
  return state.contracts.filter((c) => c.customerId === customerId).sort((a, b) => new Date(b.disbursedDate) - new Date(a.disbursedDate));
}
export function getContract(id) { return state.contracts.find((c) => c.id === id); }

export function customerOutstandingTotal(customerId) {
  return listContractsByCustomer(customerId)
    .filter((c) => effectiveContractStatus(c) !== 'da_tat_toan')
    .reduce((s, c) => s + c.balance, 0);
}

/**
 * Trạng thái THỰC TẾ của hợp đồng — tính trực tiếp từ dư nợ + ngày đến hạn,
 * không phụ thuộc trường "status" lưu sẵn (file Excel thật không có cột
 * trạng thái nên trường đó luôn là 'dang_vay' lúc nhập, không tự cập nhật
 * theo thời gian). Coi là:
 * - "Đã tất toán" nếu dư nợ ≤ 0.
 * - "Quá hạn" nếu còn dư nợ và đã qua ngày đến hạn.
 * - "Trong hạn" (id nội bộ vẫn là 'dang_vay') các trường hợp còn lại.
 */
export function effectiveContractStatus(contract, asOf = new Date()) {
  if ((contract.balance || 0) <= 0) return 'da_tat_toan';
  if (daysBetween(new Date(contract.dueDate), asOf) > 0) return 'qua_han';
  return 'dang_vay';
}

/** 'qua_han' | 'gan_den_han' | null — mức cần chú ý của 1 hợp đồng, dùng để gắn badge/lọc. */
export function contractUrgency(contract, asOf = new Date()) {
  const status = effectiveContractStatus(contract, asOf);
  if (status === 'qua_han') return 'qua_han';
  if (status === 'dang_vay') {
    const d = daysBetween(asOf, new Date(contract.dueDate));
    if (d >= 0 && d <= NEAR_DUE_DAYS) return 'gan_den_han';
  }
  return null;
}

/**
 * Số ngày tính lãi — tính bình thường (số ngày từ "Thu lãi đến ngày" tới hôm
 * nay), TRỪ trường hợp đặc biệt "Thu lãi đến ngày" = ngày giải ngân + 1 ngày
 * (quy ước thu lãi ngày đầu ngay lúc giải ngân) thì cộng thêm 1 ngày nữa.
 * VD: giải ngân 17/08, thu lãi đến ngày 18/08 (= giải ngân + 1), hôm nay
 * 19/08 -> bình thường ra 1 ngày, cộng thêm 1 ngày đặc biệt = 2 ngày.
 */
export function interestDaysAccrued(contract, asOf = new Date()) {
  const paidUntil = contract.interestPaidUntil || contract.disbursedDate;
  // LƯU Ý: phải cộng thêm 1 ngày đặc biệt (nếu có) TRƯỚC khi chặn số âm về 0
  // — chặn về 0 trước rồi mới cộng sẽ sai lệch 1 ngày so với thực tế. VD:
  // "Thu lãi đến ngày" 21/08, hôm nay 20/08 (chưa tới ngày đó) -> ra -1 ngày,
  // rơi đúng vào trường hợp đặc biệt (= giải ngân + 1) nên cộng thêm 1 ngày
  // -> -1 + 1 = 0 ngày mới đúng, KHÔNG PHẢI chặn -1 về 0 trước rồi mới +1 = 1.
  let days = daysBetween(new Date(paidUntil), asOf);
  if (contract.disbursedDate && daysBetween(new Date(contract.disbursedDate), new Date(paidUntil)) === 1) {
    days += 1;
  }
  return Math.max(0, days);
}
/**
 * Lãi phát sinh từ ngày đã trả lãi đến ngày hiện tại.
 * Công thức: Số dư × số ngày × lãi suất năm / 365, làm tròn đến HÀNG NGHÌN
 * gần nhất (VD: 81.500 -> 82.000; 81.350 -> 81.000).
 */
export function accruedInterest(contract, asOf = new Date()) {
  if (effectiveContractStatus(contract, asOf) === 'da_tat_toan') return 0;
  const days = interestDaysAccrued(contract, asOf);
  const raw = contract.balance * days * (contract.interestRate / 100) / 365;
  return Math.round(raw / 1000) * 1000;
}

/**
 * Đăng nhập khách hàng bằng CCCD HOẶC số điện thoại + mật khẩu.
 * ĐÃ CHUYỂN SANG SUPABASE THẬT (xem docs/supabase-migration.md) — không còn
 * kiểm tra mật khẩu ở đây nữa, mà gọi Edge Function "login" (chạy phía
 * server, an toàn dù chưa có OTP). Đúng mật khẩu thì tải luôn hồ sơ + toàn
 * bộ hợp đồng của khách đó từ Supabase vào state (THAY HẲN dữ liệu demo cũ)
 * để các màn hình khác (dashboard, chi tiết hợp đồng...) dùng lại y nguyên,
 * không cần sửa gì thêm. Vé (JWT) trả về trong "sbToken" — nơi gọi hàm này
 * (login.js) cần lưu vào session để dùng cho các lần gọi Supabase sau.
 *
 * LƯU Ý (giai đoạn chuyển tiếp): mới migrate riêng phần đăng nhập + xem hợp
 * đồng của khách hàng. Đăng nhập quản trị viên/nhân viên, yêu cầu tư vấn,
 * và mọi thao tác ghi khác VẪN đang chạy trên dữ liệu demo cục bộ như cũ —
 * sẽ chuyển tiếp ở các bước sau.
 */
export async function loginCustomer(identifier, password) {
  const res = await callLoginFunction({ role: 'customer', identifier, password });
  if (!res.ok) return { ok: false, reason: res.reason };
  await loadCustomerSessionData(res.id, res.token);
  return { ok: true, customerId: res.id, mustChangePassword: !!res.mustChangePassword, sbToken: res.token };
}

/**
 * Khách quên mật khẩu, gọi từ màn đăng nhập (CHƯA đăng nhập, không có JWT) —
 * xác minh đúng CCCD + SĐT khớp 1 khách hàng có thật rồi ghi 1 "yêu cầu cấp
 * lại mật khẩu" vào bảng requests (như 1 yêu cầu tư vấn thông thường, hiện
 * ngay trong danh sách "Yêu cầu tư vấn" ở trang quản trị) — KHÔNG tự đổi mật
 * khẩu, admin xem yêu cầu rồi tự gọi điện xác minh + cấp mật khẩu mới qua
 * SĐT (chức năng "Cấp lại mật khẩu" đã có sẵn ở trang Khách hàng), vì app
 * chưa có OTP thật để tự động hoàn toàn bước xác minh danh tính này.
 * Toàn bộ logic tra cứu + ghi request chạy Ở SERVER (Edge Function, cùng
 * cơ chế an toàn như "login") — trình duyệt không tự query được customers.
 */
export async function requestPasswordReset(cccd, phone) {
  return callForgotPasswordFunction({ cccd, phone });
}

/** Tải hồ sơ + toàn bộ hợp đồng của 1 khách hàng từ Supabase, thay hoàn toàn state.customers/state.contracts. */
async function loadCustomerSessionData(customerId, token) {
  const sb = getSupabaseClient(token);
  const [{ data: custRow }, { data: contractRows }, { data: requestRows }] = await Promise.all([
    sb.from('customers').select('*').eq('id', customerId).maybeSingle(),
    sb.from('contracts').select('*').eq('customer_id', customerId),
    sb.from('requests').select('*').eq('customer_id', customerId),
  ]);
  state.customers = custRow ? [mapCustomerRow(custRow)] : [];
  state.contracts = (contractRows || []).map(mapContractRow);
  state.requests = (requestRows || []).map(mapRequestRow);
}

/** snake_case (cột Postgres) -> camelCase (đúng field app đang dùng khắp nơi). */
function mapCustomerRow(row) {
  return {
    id: row.id, cccd: row.cccd, name: row.name, phone: row.phone || '', address: row.address || '',
    thon: row.thon || '', xom: row.xom || '', xa: row.xa || '', tinh: row.tinh || '',
    salt: row.salt, hash: row.hash,
    mustChangePassword: !!row.must_change_password,
    failedAttempts: row.failed_attempts || 0,
    lockedUntil: row.locked_until ? new Date(row.locked_until).getTime() : null,
    lastLoginAt: row.last_login_at || null,
    isOnline: !!row.is_online,
    createdAt: row.created_at,
  };
}
function mapContractRow(row) {
  return {
    id: row.id, customerId: row.customer_id, code: row.code,
    principal: Number(row.principal), balance: Number(row.balance),
    disbursedDate: row.disbursed_date, dueDate: row.due_date,
    interestRate: Number(row.interest_rate),
    interestPaidUntil: row.interest_paid_until,
  };
}

/** Kiểm tra mật khẩu hiện tại của khách hàng — ĐÃ CHUYỂN SANG SUPABASE THẬT qua Edge Function (chỉ tự xác minh chính mình). */
export async function verifyCustomerPassword(customerId, password) {
  const session = getSession();
  if (!session || session.id !== customerId) return false;
  const res = await callCreateAccountFunction(session.sbToken, { type: 'verify-own-password', password });
  return !!(res.ok && res.valid);
}

/** ĐÃ CHUYỂN SANG SUPABASE THẬT qua Edge Function (tự đổi mật khẩu chính mình, không cần quyền super). */
export async function setCustomerPassword(customerId, newPassword, opts = {}) {
  const session = getSession();
  const res = await callCreateAccountFunction(session?.sbToken, {
    type: 'set-own-password', newPassword, mustChangePassword: !!opts.mustChangePassword,
  });
  if (!res.ok) throw new Error(res.reason || 'Không đổi được mật khẩu.');
  const c = getCustomer(customerId);
  if (c) { c.mustChangePassword = !!opts.mustChangePassword; c.tempPassword = null; }
  notify();
}

/** Admin cấp lại mật khẩu cho khách — có thể tự nhập mật khẩu cụ thể, để trống thì tự sinh ngẫu nhiên. */
/** Admin cấp lại mật khẩu cho khách hàng — ĐÃ CHUYỂN SANG SUPABASE THẬT qua Edge Function "create-account". */
export async function adminResetCustomerPassword(customerId, customPassword) {
  const session = getSession();
  const res = await callCreateAccountFunction(session?.sbToken, { type: 'reset-customer-password', customerId, password: customPassword });
  if (!res.ok) throw new Error(res.reason || 'Không cấp lại được mật khẩu.');
  const c = getCustomer(customerId);
  if (c) { c.mustChangePassword = true; c.failedAttempts = 0; c.lockedUntil = null; }
  notify();
  return res.tempPassword;
}

/**
 * Tạo/cập nhật HỒ SƠ khách hàng (tên, SĐT, địa chỉ) — KHÔNG đụng đến tài
 * khoản đăng nhập. Dùng cho luồng nhập từ Excel: file chỉ cho biết ai đang
 * có khoản vay, không phải là nơi cấp tài khoản. Nếu khách chưa từng được
 * "Tạo User" thì hồ sơ này chưa đăng nhập được (salt/hash rỗng) — vẫn xem
 * là 1 khách hàng hợp lệ để gắn hợp đồng vào, admin có thể tạo tài khoản
 * cho họ sau bất cứ lúc nào qua nút "Tạo User" (không mất dữ liệu hợp đồng).
 */
/**
 * Phần lõi của upsertCustomerProfile — KHÔNG gọi notify(). Dùng khi cần gộp
 * nhiều thay đổi lại rồi chỉ notify() 1 lần ở cuối (VD: nhập cả trăm dòng từ
 * Excel cùng lúc — gọi notify() riêng từng dòng sẽ rất chậm vì mỗi lần đều
 * lưu localStorage + vẽ lại toàn bộ trang).
 */
function upsertCustomerProfileCore({ cccd, name, phone, address }, existing) {
  const parsed = address != null ? parseAddress(address) : null;
  const phoneClean = phone != null ? String(phone).replace(/\s/g, '') : phone;
  let c = existing !== undefined ? existing : findCustomerByCccd(cccd);
  if (c) {
    c.name = name || c.name;
    c.phone = phoneClean || c.phone;
    if (address) { c.address = address; Object.assign(c, parsed); }
    return { customer: c, isNew: false };
  }
  c = {
    id: genId('cust'), cccd: String(cccd).trim(), name: name || '', phone: phoneClean || '',
    address: address || '', ...(parsed || { xom: '', thon: '', xa: '', tinh: '' }),
    salt: null, hash: null, mustChangePassword: false, tempPassword: null,
    failedAttempts: 0, lockedUntil: null, createdAt: new Date().toISOString(),
  };
  state.customers.push(c);
  return { customer: c, isNew: true };
}
/** Admin sửa hồ sơ khách hàng (tên/SĐT/địa chỉ) — ĐÃ CHUYỂN SANG SUPABASE THẬT qua Edge Function "create-account". */
export async function upsertCustomerProfile({ cccd, name, phone, address }) {
  const session = getSession();
  const res = await callCreateAccountFunction(session?.sbToken, { type: 'update-customer-profile', cccd, name, phone, address });
  if (!res.ok) throw new Error(res.reason || 'Không cập nhật được hồ sơ.');
  const c = findCustomerByCccd(cccd);
  if (c) {
    if (name) c.name = name;
    if (phone) c.phone = String(phone).replace(/\s/g, '');
    if (address) { c.address = address; Object.assign(c, parseAddress(address)); }
  }
  notify();
  return { customer: c };
}

/**
 * "Tạo User" — cấp tài khoản đăng nhập (CCCD + mật khẩu) cho 1 khách hàng.
 * Nếu CCCD đã có hồ sơ sẵn (từ Excel) thì chỉ gắn thêm tài khoản vào đúng
 * hồ sơ đó (giữ nguyên tên/địa chỉ/hợp đồng đã có) — khách đăng nhập là tự
 * thấy ngay mọi hợp đồng khớp CCCD, không cần làm gì thêm. Nếu CCCD chưa có
 * hồ sơ nào thì tạo mới (chỉ cần CCCD, tên tùy chọn — không cần địa chỉ).
 */
/**
 * Tạo tài khoản đăng nhập cho khách hàng — ĐÃ CHUYỂN SANG SUPABASE THẬT,
 * gọi Edge Function "create-account" (chỉ admin role='super' gọi được,
 * xác minh ngay tại server — xem docs/supabase-migration.md mục 5). Tạo
 * xong tải lại đúng dòng khách hàng đó từ Supabase để đồng bộ vào state.
 */
export async function activateCustomerAccount({ cccd, name, phone, password }) {
  const session = getSession();
  const res = await callCreateAccountFunction(session?.sbToken, { type: 'customer', cccd, name, phone, password });
  if (!res.ok) throw new Error(res.reason || 'Không tạo được tài khoản.');
  // Dùng thẳng dòng khách hàng mà server trả về (đọc bằng service role, xem
  // create-account/index.ts) thay vì tự SELECT lại bằng token của người gọi:
  // nhân viên "chỉ xem" được cấp canManageUsers có thể không có quyền RLS
  // xem khách mới tạo (chưa có Thôn/Xóm) — tự SELECT lại sẽ ra rỗng và làm
  // tài khoản mới tạo "biến mất" khỏi trang Quản lý User dù đã tạo thành công.
  const customer = res.customer ? mapCustomerRow(res.customer) : { id: res.id, cccd };
  const idx = state.customers.findIndex((c) => c.id === customer.id);
  if (idx >= 0) state.customers[idx] = customer; else state.customers.push(customer);
  notify();
  return { customer, tempPassword: res.tempPassword };
}

/**
 * "Xóa Use" — chỉ gỡ TÀI KHOẢN ĐĂNG NHẬP (mật khẩu/salt/hash), KHÔNG đụng gì
 * đến hồ sơ khách hàng hay hợp đồng — 2 thứ đó độc lập với tài khoản đăng
 * nhập. Khách trở lại trạng thái "chỉ có hồ sơ" như mới nhập từ Excel, admin
 * có thể "Tạo User" lại bất cứ lúc nào mà không mất dữ liệu hợp đồng.
 */
/** "Xóa Use" — ĐÃ CHUYỂN SANG SUPABASE THẬT qua Edge Function "create-account". */
export async function deactivateCustomerAccount(customerId) {
  const session = getSession();
  const res = await callCreateAccountFunction(session?.sbToken, { type: 'deactivate-customer', customerId });
  if (!res.ok) throw new Error(res.reason || 'Không xóa được Use.');
  const c = getCustomer(customerId);
  if (c) { c.salt = null; c.hash = null; c.mustChangePassword = false; c.tempPassword = null; c.failedAttempts = 0; c.lockedUntil = null; }
  notify();
}

/** Danh sách các Thôn / Xóm đang có trong dữ liệu khách hàng (dùng để lọc & gán quyền). */
/**
 * So sánh tên Xóm kiểu "tự nhiên" theo số — Xóm thường đặt tên bằng số (có
 * khi kèm số phụ dạng "8/1", "8/2"): sắp đúng thứ tự 01, 02, 03, 08, 8/1,
 * 8/2, 09, 10... thay vì so chuỗi kiểu chữ cái (sẽ ra "01, 09, 10, 8/1..."
 * sai thứ tự vì "1" < "8" < "9" theo ký tự).
 */
function naturalXomCompare(a, b) {
  const parse = (s) => {
    const m = String(s).match(/(\d+)(?:\s*\/\s*(\d+))?/);
    return m ? [parseInt(m[1], 10), m[2] ? parseInt(m[2], 10) : 0] : [Infinity, 0];
  };
  const [aMajor, aMinor] = parse(a);
  const [bMajor, bMinor] = parse(b);
  if (aMajor !== bMajor) return aMajor - bMajor;
  if (aMinor !== bMinor) return aMinor - bMinor;
  return String(a).localeCompare(String(b), 'vi');
}
export function distinctThon() {
  return [...new Set(state.customers.map((c) => c.thon).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'vi'));
}
export function distinctXom(thon) {
  const thonList = [].concat(thon || []).filter(Boolean);
  const list = thonList.length ? state.customers.filter((c) => thonList.includes(c.thon)) : state.customers;
  return [...new Set(list.map((c) => c.xom).filter(Boolean))].sort(naturalXomCompare);
}
/**
 * Khóa định danh 1 Xóm CỤ THỂ, gắn kèm Thôn chứa nó — tên Xóm (VD: "Xóm 8")
 * có thể trùng nhau giữa nhiều Thôn khác nhau nên KHÔNG được dùng riêng
 * mỗi tên Xóm để phân quyền/lọc, phải luôn đi kèm đúng Thôn của nó. Dùng
 * khi cấp quyền staff (allowedXom lưu dạng key này, xem updateStaffPermissions)
 * và khi lọc khách hàng theo quyền (xem listCustomers).
 */
export function xomKey(thon, xom) { return `${thon}||${xom}`; }
export function parseXomKey(key) {
  const i = String(key || '').indexOf('||');
  return i < 0 ? { thon: '', xom: key || '' } : { thon: key.slice(0, i), xom: key.slice(i + 2) };
}

/** Cây Thôn -> danh sách Xóm trong thôn đó — dùng cho phân quyền nhân viên theo từng cấp. */
export function thonXomTree() {
  return distinctThon().map((thon) => ({ thon, xomList: distinctXom(thon) }));
}

/** Sinh mã hợp đồng tự động khi không có sẵn (không bắt buộc phải nhập). */
function autoContractCode(cccd) {
  const n = state.contracts.filter((c) => c.autoCode).length + 1;
  return `HD-${cccd}-${String(n).padStart(3, '0')}`;
}

/** Phần lõi của upsertContract — KHÔNG gọi notify() (xem ghi chú ở upsertCustomerProfileCore). */
function upsertContractCore({ customerId, code, principal, disbursedDate, dueDate, interestRate, balance, status, interestPaidUntil }, existing) {
  const customer = getCustomer(customerId);
  const bal = Number(balance) || 0;
  let ct = existing !== undefined ? existing : (code ? state.contracts.find((c) => c.code === code) : null);
  const data = {
    customerId,
    code: code || (ct ? ct.code : autoContractCode(customer?.cccd || customerId)),
    autoCode: !code,
    principal: principal != null && principal !== '' ? Number(principal) || 0 : bal, // mặc định = dư nợ nếu không có số tiền vay gốc
    disbursedDate,
    dueDate: dueDate || addDays(new Date(disbursedDate), 365).toISOString().slice(0, 10), // mặc định 1 năm nếu Excel không có
    interestRate: interestRate != null && interestRate !== '' ? Number(interestRate) || 0 : (ct ? ct.interestRate : 0),
    balance: bal, status: status || 'dang_vay',
    interestPaidUntil: interestPaidUntil || disbursedDate,
  };
  if (ct) { Object.assign(ct, data); }
  else { ct = { id: genId('hd'), ...data }; state.contracts.push(ct); }
  return ct;
}
export function upsertContract(args) {
  const ct = upsertContractCore(args);
  notify();
  return ct;
}

/**
 * Admin tự soạn + gửi ngay 1 thông báo đẩy (Web Push) cho 1 khách hàng —
 * khách đó phải đã bật thông báo trên ít nhất 1 thiết bị (xem trang "Đổi mật
 * khẩu" của khách/nút "Bật thông báo nhắc lịch"), nếu chưa sẽ báo lỗi rõ.
 * Trả về { ok, sentCount, reason }.
 */
export async function sendManualNotification(customerId, title, body) {
  const session = getSession();
  return callCreateAccountFunction(session?.sbToken, { type: 'send-manual-notification', customerId, title, body });
}

// ------------------------------------------------------------
// Zalo OA (ZBS Template Message) — 2 tầng danh sách:
//   Tầng 1 "Danh sách đã thêm vào OA" (zaloCustomers) — theo KHÁCH HÀNG,
//     danh sách CHUNG (ai có quyền cũng thấy/thêm được), giống "Use" không
//     tự xóa khi hết hợp đồng/dư nợ.
//   Tầng 2 "Danh sách gửi tự động" (zaloAutoSendList) — theo HỢP ĐỒNG, RIÊNG
//     TƯ theo từng người tự chọn (server chỉ trả về đúng lựa chọn của CHÍNH
//     người gọi, xem RLS "admin sees own zalo auto send selections"), nhưng
//     1 (hợp đồng, tình huống) chỉ 1 người chọn được tại 1 thời điểm — người
//     khác cố chọn trùng bị server chặn kèm tên người đã chọn.
// Xem trang "Quản lý OA" (js/views/admin/zaloOA.js) và
// docs/supabase-migration.md mục 10. Cần quyền canManageZaloOA (hoặc super).
// ------------------------------------------------------------
export function isZaloCustomer(customerId) {
  return (state.zaloCustomers || []).some((r) => r.customerId === customerId);
}
export function listZaloCustomers() { return state.zaloCustomers || []; }
/** Hợp đồng này đã có trong danh sách gửi tự động CỦA CHÍNH MÌNH chưa (1 hợp đồng chỉ ở được 1 trong 2 mục) — trả về dòng nếu có, null nếu chưa. */
export function findZaloAutoSend(contractId) {
  return (state.zaloAutoSendList || []).find((r) => r.contractId === contractId) || null;
}
export function listZaloAutoSend() { return state.zaloAutoSendList || []; }
export function listZaloAutoSendByKind(kind) { return (state.zaloAutoSendList || []).filter((r) => r.kind === kind); }
export function listZaloSendLog() { return state.zaloSendLog || []; }
/** Lần gửi Zalo THÀNH CÔNG gần nhất của 1 hợp đồng (từ cache log, tối đa 200 dòng gần nhất) — dùng hiện cảnh báo "còn N ngày mới gửi lại được" trước khi bấm gửi tay. Trả về null nếu chưa gửi lần nào (trong phạm vi cache). */
export function lastSuccessfulZaloSend(contractId) {
  const rows = (state.zaloSendLog || []).filter((l) => l.contractId === contractId && l.status === 'success');
  if (!rows.length) return null;
  return rows.reduce((a, b) => (new Date(a.sentAt) > new Date(b.sentAt) ? a : b));
}

/**
 * Thêm/bỏ khỏi Tầng 1 "Danh sách OA" — vá thẳng vào cache cục bộ + notify()
 * thay vì refreshSessionData() (tải lại TOÀN BỘ dữ liệu phiên — admins,
 * customers, contracts, requests, push, cả 3 bảng Zalo... rất nặng cho 1
 * thao tác đơn giản, đặc biệt rõ khi thêm hàng loạt nhiều khách 1 lúc ở
 * modal "Thêm khách hàng vào OA" — mỗi lần thêm phải đợi 1 lượt tải lại đầy
 * đủ mới xong). Server trả về đủ để tự vá, không cần đợi tải lại.
 */
export async function addZaloCustomer(customerId) {
  const session = getSession();
  const res = await callCreateAccountFunction(session?.sbToken, { type: 'add-zalo-customer', customerId });
  if (!res.ok) throw new Error(res.reason || 'Không thêm được vào danh sách OA.');
  if (!state.zaloCustomers.some((r) => r.customerId === customerId)) {
    state.zaloCustomers.push({ customerId, addedBy: session?.id || null, addedAt: new Date().toISOString() });
  }
  notify();
}
export async function removeZaloCustomer(customerId) {
  const session = getSession();
  const res = await callCreateAccountFunction(session?.sbToken, { type: 'remove-zalo-customer', customerId });
  if (!res.ok) throw new Error(res.reason || 'Không xóa được khỏi danh sách OA.');
  state.zaloCustomers = state.zaloCustomers.filter((r) => r.customerId !== customerId);
  // Server tự cascade xóa mọi lựa chọn Tầng 2 (zalo_auto_send_list) của
  // khách này khi bỏ khỏi Tầng 1 — kể cả của người khác đã chọn, nhưng RLS
  // chỉ cho client thấy đúng lựa chọn CỦA CHÍNH MÌNH nên chỉ cần dọn phần
  // đó ở cache cục bộ, không lệch gì so với việc tải lại.
  state.zaloAutoSendList = state.zaloAutoSendList.filter((r) => r.customerId !== customerId);
  notify();
}
/**
 * Thêm 1 hợp đồng vào Tầng 2 (gửi tự động) — tự đảm bảo khách đã ở Tầng 1,
 * không cần thêm tay riêng trước. "kind": 'lai_hang_thang_auto' (mặc định)
 * hoặc 'lai_hang_thang_custom_day' (cần kèm customDay, 1-30) — KHÔNG còn
 * 'den_han' nữa (đến hạn giờ CHỈ gửi tay, xem sendZaloManual()).
 * "intervalMonths" (1-4, mặc định 1) = định kỳ báo — 1 là hàng tháng như
 * cũ, 2/3/4 là báo mỗi 2/3/4 tháng 1 lần thay vì tháng nào cũng báo.
 */
export async function addZaloAutoSend(contractId, kind = 'lai_hang_thang_auto', customDay = null, intervalMonths = 1) {
  const session = getSession();
  const res = await callCreateAccountFunction(session?.sbToken, { type: 'add-zalo-auto-send', contractId, kind, customDay, intervalMonths });
  if (!res.ok) throw new Error(res.reason || 'Không thêm được vào danh sách gửi tự động.');
  // Server có thể tự tạo thêm dòng Tầng 1 (nếu khách chưa có) — tải lại
  // session data thay vì tự vá cache cục bộ, tránh lệch dữ liệu.
  await refreshSessionData();
}
export async function removeZaloAutoSend(id) {
  const session = getSession();
  const res = await callCreateAccountFunction(session?.sbToken, { type: 'remove-zalo-auto-send', id });
  if (!res.ok) throw new Error(res.reason || 'Không xóa được khỏi danh sách gửi tự động.');
  state.zaloAutoSendList = state.zaloAutoSendList.filter((r) => r.id !== id);
  notify();
}
/**
 * Sửa ngày gửi (1-30, chỉ mục "Gửi theo ngày cụ thể") và/hoặc định kỳ báo
 * (1-4 tháng, cả 2 mục) của 1 lựa chọn Tầng 2 đã có sẵn — chỉ chính người
 * đã chọn (hoặc super) sửa được. `patch`: { customDay?, intervalMonths? } —
 * chỉ gửi field nào thật sự muốn đổi.
 */
export async function updateZaloAutoSendSettings(id, patch) {
  const session = getSession();
  const res = await callCreateAccountFunction(session?.sbToken, { type: 'update-zalo-auto-send-settings', id, ...patch });
  if (!res.ok) throw new Error(res.reason || 'Không sửa được lựa chọn này.');
  const row = state.zaloAutoSendList.find((r) => r.id === id);
  if (row) {
    if (patch.customDay !== undefined) row.customDay = patch.customDay;
    if (patch.intervalMonths !== undefined) row.intervalMonths = patch.intervalMonths;
  }
  notify();
}
/**
 * Gửi tay ngay 1 tin Zalo cho khách hàng của 1 hợp đồng — server TỰ CHỌN
 * mẫu theo tình huống (gần/đã đến hạn dùng mẫu Đến hạn, còn xa hạn dùng mẫu
 * Báo lãi), không cần tự chọn mẫu ở đây nữa. BẮT BUỘC khách đã có sẵn trong
 * Tầng 1 "Danh sách OA" và cách lần gửi thành công gần nhất >= 5 ngày (server
 * tự chặn + trả reason rõ ràng nếu chưa đủ điều kiện). Trả về { ok, reason }.
 */
export async function sendZaloManual(contractId) {
  const session = getSession();
  const res = await callCreateAccountFunction(session?.sbToken, { type: 'send-zalo-manual', contractId });
  // Gửi tay có ghi log ở server (zalo_send_log) — tải lại session data để
  // hiện ngay (VD: cảnh báo "còn N ngày" ở lần mở tiếp theo), không cần đợi
  // refreshSessionData() định kỳ.
  await refreshSessionData();
  return res;
}

/** ĐÃ CHUYỂN SANG SUPABASE THẬT qua Edge Function "create-account" — hợp đồng tự xóa theo (FK cascade). */
export async function deleteCustomer(id) {
  const session = getSession();
  const res = await callCreateAccountFunction(session?.sbToken, { type: 'delete-customer', customerId: id });
  if (!res.ok) throw new Error(res.reason || 'Không xóa được khách hàng.');
  state.customers = state.customers.filter((c) => c.id !== id);
  state.contracts = state.contracts.filter((c) => c.customerId !== id);
  notify();
}
/** ĐÃ CHUYỂN SANG SUPABASE THẬT qua Edge Function "create-account". */
export async function deleteContract(id) {
  const session = getSession();
  const res = await callCreateAccountFunction(session?.sbToken, { type: 'delete-contract', contractId: id });
  if (!res.ok) throw new Error(res.reason || 'Không xóa được hợp đồng.');
  state.contracts = state.contracts.filter((c) => c.id !== id);
  pruneEmptyCustomerProfiles(); // hết hợp đồng mà chưa có tài khoản Use thì dọn luôn hồ sơ (chỉ ở local cache)
  notify();
}

// ------------------------------------------------------------
// Nhập dữ liệu từ bảng (đọc trực tiếp file .xlsx/.xls hoặc dán dữ liệu copy
// từ Excel) — đúng thứ tự cột theo mẫu sổ theo dõi vay đang dùng:
// Số HĐTD | Người nhận nợ | Địa chỉ | Số CMND/CCCD | Số di động |
// Ngày nhận nợ | Ngày đáo hạn | Thu lãi đến ngày | Số tiền giải ngân |
// Số dư | Lãi suất
// (địa chỉ tự tách Xóm/Thôn/Tỉnh; cột nào thiếu dữ liệu sẽ tự tính/tự sinh)
// ------------------------------------------------------------
export function parseVNNumber(str) {
  let s = String(str ?? '').trim().replace(/[^\d.,-]/g, '');
  if (!s) return 0;
  // "42.500.000" kiểu VN (chấm ngăn cách hàng nghìn, đúng từng nhóm 3 số) -> bỏ chấm
  if (/^-?\d{1,3}(\.\d{3})+$/.test(s)) s = s.replace(/\./g, '');
  else if (s.includes(',') && s.includes('.')) s = s.replace(/\./g, '').replace(',', '.'); // "1.234.567,89"
  else if (s.includes(',')) s = s.replace(',', '.'); // chỉ có phẩy -> coi là dấu thập phân
  // còn lại (vd "9.5" từ ô số của Excel/JS): giữ nguyên dấu chấm làm phần thập phân
  const n = parseFloat(s);
  return Number.isFinite(n) ? n : 0;
}
export function parseVNDate(str) {
  const s = String(str || '').trim();
  const m = s.match(/^(\d{1,2})[/\-.](\d{1,2})[/\-.](\d{2,4})$/);
  if (m) {
    let [, d, mo, y] = m;
    if (y.length === 2) y = '20' + y;
    return `${y}-${mo.padStart(2, '0')}-${d.padStart(2, '0')}`;
  }
  // Số serial ngày kiểu Excel (ô định dạng Ngày tháng khi đọc từ file .xlsx sẽ ra số thuần)
  if (/^\d{4,6}$/.test(s)) {
    const dt = new Date(Date.UTC(1899, 11, 30) + Number(s) * 86400000);
    if (!Number.isNaN(dt.getTime())) return dt.toISOString().slice(0, 10);
  }
  const dt = new Date(s);
  return Number.isNaN(dt.getTime()) ? '' : dt.toISOString().slice(0, 10);
}

/**
 * Dọn hồ sơ khách hàng không còn dư nợ nào (hết hợp đồng, hoặc còn hợp đồng
 * nhưng tổng dư nợ = 0, đã tất toán hết) VÀ chưa có tài khoản Use — xóa luôn
 * khỏi mục Khách hàng, kèm dọn theo các hợp đồng dư nợ 0 còn sót của họ. Use
 * thì LUÔN giữ lại dù hết dư nợ (2 thứ độc lập với nhau).
 */
function pruneEmptyCustomerProfiles() {
  const balanceByCustomer = new Map();
  for (const ct of state.contracts) {
    balanceByCustomer.set(ct.customerId, (balanceByCustomer.get(ct.customerId) || 0) + (ct.balance || 0));
  }
  const keepIds = new Set(
    state.customers.filter((c) => (balanceByCustomer.get(c.id) || 0) > 0 || (c.salt && c.hash)).map((c) => c.id)
  );
  const before = state.customers.length;
  state.customers = state.customers.filter((c) => keepIds.has(c.id));
  state.contracts = state.contracts.filter((ct) => keepIds.has(ct.customerId));
  return before - state.customers.length;
}

const HEADER_HINTS = ['cccd', 'cmnd', 'người nhận nợ', 'nguoi nhan no', 'họ tên', 'ho ten', 'số hđtd', 'so hdtd'];
/**
 * Nhập dữ liệu hợp đồng từ Excel/dữ liệu dán — coi file/dữ liệu nhập là
 * NGUỒN SỰ THẬT mới nhất: tên/SĐT/địa chỉ luôn được cập nhật ghi đè theo
 * đúng dữ liệu vừa nhập cho MỌI khách hàng khớp CCCD (dù mới hay đã có sẵn
 * hồ sơ/tài khoản) — Use đã tạo trước cho CCCD đó lần đăng nhập sau sẽ tự
 * thấy ngay thông tin mới vì dùng chung 1 hồ sơ.
 * - CCCD CHƯA từng có trong hệ thống -> ngoài tạo hồ sơ còn tự cấp luôn tài
 *   khoản Use (mật khẩu tự sinh ngẫu nhiên, trả về trong result.newAccounts
 *   để hiện cho admin gửi khách).
 * - CCCD ĐÃ có sẵn -> chỉ cập nhật hồ sơ + hợp đồng, KHÔNG đụng đến tài
 *   khoản đăng nhập đã cấp (mật khẩu vẫn giữ nguyên).
 * Khi `fullSync` bật (dùng cho tải file Excel) — coi file là danh sách ĐẦY ĐỦ
 * hiện tại: hợp đồng nào đang có trong hệ thống mà KHÔNG xuất hiện trong
 * lần nhập này sẽ bị XÓA, để danh sách hợp đồng luôn khớp đúng file mới
 * nhất; khách hàng nào sau đó không còn dư nợ nào và cũng chưa có tài
 * khoản Use thì dọn luôn hồ sơ (xem pruneEmptyCustomerProfiles). Không bật
 * fullSync với kiểu dán tay (chỉ thêm/cập nhật, không xóa/dọn gì).
 */
/**
 * Nhập dữ liệu từ Excel/dán tay — ĐÃ CHUYỂN SANG SUPABASE THẬT. Trình duyệt
 * chỉ còn lo tách cột + parse ngày/số (KHÔNG nhạy cảm, giữ nguyên logic cũ ở
 * đây) — việc GHI vào database (đặc biệt tự tạo tài khoản cho khách hoàn
 * toàn mới) chuyển hết sang Edge Function "import-data" (xem
 * docs/supabase-migration.md), vì đó là hành động nhạy cảm cần xác minh
 * đúng người gọi có quyền "super" tại server.
 */
export async function importFromPastedTable(text, { fullSync = false } = {}) {
  const lines = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  const rows = [];
  let skipped = 0;
  const parseErrors = [];
  for (const line of lines) {
    const cells = line.includes('\t') ? line.split('\t') : line.split(',');
    if (cells.length < 2) { skipped++; continue; }
    const headerCheck = cells.slice(0, 2).join(' ').toLowerCase();
    if (HEADER_HINTS.some((h) => headerCheck.includes(h))) continue; // bỏ qua dòng tiêu đề

    const [code, name, address, cccdRaw, phone, disbursedDate, dueDate, interestPaidUntil, principal, balance, interestRate] = cells.map((c) => c.trim());
    const cccd = (cccdRaw || '').replace(/\s/g, '');
    if (!cccd || !/^\d{9,12}$/.test(cccd)) { parseErrors.push(`Bỏ qua dòng (CCCD không hợp lệ): ${line.slice(0, 40)}...`); continue; }

    const disbursed = parseVNDate(disbursedDate) || new Date().toISOString().slice(0, 10);
    rows.push({
      cccd, name, address, phone, code: code || null,
      principal: principal ? parseVNNumber(principal) : null,
      disbursedDate: disbursed,
      dueDate: dueDate ? parseVNDate(dueDate) : null,
      interestRate: interestRate ? parseVNNumber(interestRate) : null,
      balance: parseVNNumber(balance),
      interestPaidUntil: parseVNDate(interestPaidUntil) || null,
    });
  }

  const session = getSession();
  const res = await callImportDataFunction(session?.sbToken, { rows, fullSync });
  if (!res.ok) throw new Error(res.reason || 'Không nhập được dữ liệu.');

  // Tải lại toàn bộ khách hàng/hợp đồng từ Supabase để đồng bộ đúng dữ liệu
  // thật sau khi nhập — chắc chắn đúng hơn tự tính lại ở trình duyệt vì mọi
  // quyết định thêm/sửa/xóa đều đã xảy ra ở server.
  await loadAdminSessionData(session.sbToken);
  // BẮT BUỘC gọi notify() để lưu dữ liệu vừa tải về vào localStorage — thiếu
  // dòng này thì màn hình vẫn hiện đúng dữ liệu mới (nhờ redraw thủ công ở
  // UI), nhưng dữ liệu mới đó CHỈ nằm trong bộ nhớ tạm của tab đang mở; bấm
  // tải lại trang (F5) sẽ đọc lại đúng localStorage cũ (từ lần notify() gần
  // nhất trước đó, VD: lúc đăng nhập) -> tưởng như dữ liệu vừa nhập "biến
  // mất", dù trong Supabase vẫn đúng, không hề mất gì.
  notify();

  return {
    newProfiles: res.newProfiles || 0, existingCustomers: res.existingCustomers || 0, contracts: res.contracts || 0,
    deletedContracts: res.deletedContracts || 0, deletedCustomers: res.deletedCustomers || 0,
    zaloAutoSendMigrated: res.zaloAutoSendMigrated || 0,
    skipped: skipped + (res.skipped || 0), errors: [...parseErrors, ...(res.errors || [])],
    newAccounts: res.newAccounts || [],
  };
}

// ------------------------------------------------------------
// Quản trị viên
// ------------------------------------------------------------
/**
 * Đăng nhập quản trị viên/nhân viên — ĐÃ CHUYỂN SANG SUPABASE THẬT, cùng cơ
 * chế với loginCustomer() (xem ghi chú ở đó). Đúng mật khẩu thì tải toàn bộ
 * admins/customers/contracts từ Supabase vào state — RLS tự lọc đúng phạm
 * vi (nhân viên chỉ thấy khách trong Thôn/Xóm được gán, quản trị toàn
 * quyền thấy hết), y hệt logic phân quyền client-side cũ, chỉ khác là giờ
 * chặn được thật ở tầng server chứ không chỉ ẩn trên giao diện.
 */
export async function loginAdmin(username, password) {
  const res = await callLoginFunction({ role: 'admin', identifier: username, password });
  if (!res.ok) return { ok: false, reason: res.reason };
  await loadAdminSessionData(res.token);
  return { ok: true, adminId: res.id, mustChangePassword: !!res.mustChangePassword, sbToken: res.token };
}

/**
 * Tự động tải lại dữ liệu mới nhất từ Supabase — gọi định kỳ từ app.js (xem
 * startAutoRefresh()) để KHÔNG cần thoát ra vào lại mới thấy dữ liệu mới
 * (VD: admin vừa sửa/nhập Excel ở máy khác, khách vừa có yêu cầu tư vấn
 * mới...). Không làm gì nếu chưa đăng nhập. Nếu người dùng đang gõ dở trong
 * 1 ô nhập liệu NGOÀI modal (trong modal/bottom-sheet thì an toàn, vì
 * notify() chỉ vẽ lại #app-content, không đụng tới modal — modal luôn gắn
 * thẳng vào <body>) thì vẫn tải dữ liệu mới về nhưng HOÃN vẽ lại màn hình để
 * khỏi xóa mất chữ đang gõ dở, dữ liệu mới sẽ tự hiện ở lần làm mới kế tiếp.
 */
export async function refreshSessionData() {
  if (!state || !state.session) return;
  const session = state.session;
  const active = document.activeElement;
  const isTypingOutsideModal = active && ['INPUT', 'TEXTAREA', 'SELECT'].includes(active.tagName) && !active.closest('.modal-overlay');
  try {
    if (session.role === 'admin') await loadAdminSessionData(session.sbToken);
    else await loadCustomerSessionData(session.id, session.sbToken);
  } catch (e) {
    console.warn('Không tự làm mới được dữ liệu, sẽ thử lại ở lần sau.', e);
    return;
  }
  if (isTypingOutsideModal) persist(); // lưu tạm, chưa vẽ lại ngay
  else notify();
}

async function loadAdminSessionData(token) {
  const sb = getSupabaseClient(token);
  const [{ data: adminRows }, { data: customerRows }, { data: contractRows }, { data: requestRows }, pushRes, zaloCustRes, zaloListRes, zaloLogRes] = await Promise.all([
    sb.from('admins').select('*'),
    sb.from('customers').select('*'),
    sb.from('contracts').select('*'),
    sb.from('requests').select('*'),
    // Chỉ cần biết CÓ hay KHÔNG (không cần chi tiết endpoint) — dùng cho 2
    // chấm trạng thái (đăng nhập/bật thông báo) ở trang Khách hàng & Hợp đồng
    // và Quản lý User. Cần policy RLS riêng cho phép admin đọc (xem mục 9
    // trong docs/supabase-migration.md) — lỗi (chưa chạy policy) thì bỏ qua,
    // coi như chưa biết ai bật thông báo, không chặn tải các dữ liệu khác.
    sb.from('push_subscriptions').select('owner_type, owner_id').eq('owner_type', 'customer').then((r) => r, () => ({ data: [] })),
    // Tầng 1 "Danh sách đã thêm vào OA" — CHUNG cho mọi admin có quyền trong
    // phạm vi (không riêng theo người, khác Tầng 2 bên dưới).
    sb.from('zalo_customers').select('*').then((r) => r, () => ({ data: [] })),
    // Tầng 2 "Danh sách gửi tự động" — RLS chỉ trả về đúng lựa chọn của
    // CHÍNH người đang đăng nhập (super thấy hết) + log gửi tin. Bọc an toàn
    // (giống push_subscriptions) phòng lúc chưa chạy policy (mục 10).
    sb.from('zalo_auto_send_list').select('*').then((r) => r, () => ({ data: [] })),
    sb.from('zalo_send_log').select('*').order('sent_at', { ascending: false }).limit(200).then((r) => r, () => ({ data: [] })),
  ]);
  state.admins = (adminRows || []).map(mapAdminRow);
  state.customers = (customerRows || []).map(mapCustomerRow);
  state.contracts = (contractRows || []).map(mapContractRow);
  state.requests = (requestRows || []).map(mapRequestRow);
  // Mảng thường (KHÔNG phải Set) — state được JSON.stringify() vào
  // localStorage mỗi lần persist()/notify(), Set sẽ bị mất sạch dữ liệu khi
  // serialize (JSON.stringify(new Set(...)) ra "{}"), lần tải lại từ cache sẽ
  // gọi .has() trên object thường và văng lỗi ngay khi vẽ trang.
  state.pushSubscribedCustomerIds = [...new Set((pushRes?.data || []).map((r) => r.owner_id))];
  state.zaloCustomers = (zaloCustRes?.data || []).map(mapZaloCustomerRow);
  state.zaloAutoSendList = (zaloListRes?.data || []).map(mapZaloAutoSendRow);
  state.zaloSendLog = (zaloLogRes?.data || []).map(mapZaloSendLogRow);
}

function mapZaloCustomerRow(row) {
  return { customerId: row.customer_id, addedBy: row.added_by, addedAt: row.added_at };
}
function mapZaloAutoSendRow(row) {
  return { id: row.id, contractId: row.contract_id, customerId: row.customer_id, kind: row.kind, customDay: row.custom_day, intervalMonths: row.interval_months || 1, createdBy: row.created_by, createdAt: row.created_at };
}
function mapZaloSendLogRow(row) {
  return {
    id: row.id, contractId: row.contract_id, customerId: row.customer_id, kind: row.kind, templateId: row.template_id,
    phone: row.phone, status: row.status, errorMessage: row.error_message,
    triggeredBy: row.triggered_by, triggeredByAdminId: row.triggered_by_admin_id, sentAt: row.sent_at,
  };
}

function mapAdminRow(row) {
  return {
    id: row.id, username: row.username, name: row.name, role: row.role,
    allowedThon: row.allowed_thon || [], allowedXom: row.allowed_xom || [],
    canManageUsers: !!row.can_manage_users,
    // Cờ RIÊNG cho quyền quản lý gửi tin Zalo OA — KHÔNG dùng chung
    // canManageUsers, vì gửi tin OA tốn phí thật, cấp riêng để admin toàn
    // quyền kiểm soát được từng nhân viên muốn cho gửi OA hay không, độc lập
    // với việc có cho quản lý Use hay không. Xem canManageZaloOA() bên dưới.
    canManageZaloOA: !!row.can_manage_zalo_oa,
    salt: row.salt, hash: row.hash, mustChangePassword: !!row.must_change_password, createdAt: row.created_at,
  };
}
export function getAdmin(id) { return state.admins.find((a) => a.id === id); }
export function listAdmins() { return state.admins; }
export function isSuperAdmin(id) { return getAdmin(id)?.role === 'super'; }
/**
 * Nhân viên "chỉ xem" có thể được cấp THÊM quyền vào trang "Quản lý User"
 * (tạo/sửa/xóa Use + nhân viên khác) mà KHÔNG cần lên hẳn "Toàn quyền" —
 * xem cờ `canManageUsers` (cột can_manage_users). Toàn quyền thì mặc định
 * luôn có quyền này, không cần cấp riêng.
 */
export function canManageUsers(id) {
  const a = getAdmin(id);
  return !!a && (a.role === 'super' || !!a.canManageUsers);
}
/** Y HỆT canManageUsers() nhưng cho quyền quản lý gửi tin Zalo OA — xem ghi chú ở mapAdminRow(). */
export function canManageZaloOA(id) {
  const a = getAdmin(id);
  return !!a && (a.role === 'super' || !!a.canManageZaloOA);
}

/**
 * Tạo tài khoản quản trị (role 'super' toàn quyền hoặc 'staff' chỉ xem) —
 * có tên đăng nhập + mật khẩu (tự sinh nếu không nhập) + phân quyền xem ngay
 * trong lúc tạo (chỉ áp dụng cho 'staff'). Phân quyền 2 cấp: allowedThon
 * (xem trọn cả Thôn, gồm mọi Xóm trong đó) và allowedXom (chỉ xem riêng 1
 * vài Xóm cụ thể dù Thôn chứa nó không được cấp trọn).
 */
/**
 * Tạo tài khoản quản trị viên/nhân viên — ĐÃ CHUYỂN SANG SUPABASE THẬT,
 * cùng cơ chế với activateCustomerAccount() ở trên (qua Edge Function
 * "create-account", chỉ admin role='super' gọi được).
 */
export async function addStaffAdmin({ username, name, password, role, allowedThon, allowedXom, canManageUsers: canManage }) {
  const session = getSession();
  const res = await callCreateAccountFunction(session?.sbToken, {
    type: 'staff', username, name, password, role, allowedThon, allowedXom, canManageUsers: !!canManage,
  });
  if (!res.ok) throw new Error(res.reason || 'Không tạo được tài khoản.');
  const sb = getSupabaseClient(session.sbToken);
  const { data: row } = await sb.from('admins').select('*').eq('id', res.id).maybeSingle();
  const staff = row ? mapAdminRow(row) : { id: res.id, username };
  const idx = state.admins.findIndex((a) => a.id === staff.id);
  if (idx >= 0) state.admins[idx] = staff; else state.admins.push(staff);
  notify();
  return { staff, tempPassword: res.tempPassword };
}
/** ĐÃ CHUYỂN SANG SUPABASE THẬT qua Edge Function "create-account". */
export async function updateStaffPermissions(id, allowedThon, allowedXom, canManage, canManageZalo) {
  const a = getAdmin(id);
  if (!a || a.role !== 'staff') return;
  const session = getSession();
  const res = await callCreateAccountFunction(session?.sbToken, {
    type: 'update-staff-permissions', staffId: id, allowedThon, allowedXom,
    canManageUsers: !!canManage, canManageZaloOA: !!canManageZalo,
  });
  if (!res.ok) throw new Error(res.reason || 'Không cập nhật được quyền xem.');
  a.allowedThon = Array.isArray(allowedThon) ? allowedThon : [];
  a.allowedXom = Array.isArray(allowedXom) ? allowedXom : [];
  a.canManageUsers = !!canManage;
  a.canManageZaloOA = !!canManageZalo;
  notify();
}
/**
 * Đổi vai trò (Toàn quyền <-> Chỉ xem) cho 1 tài khoản quản trị/nhân viên
 * ĐÃ CÓ SẴN — chỉ quản trị viên TOÀN QUYỀN mới gọi được (server tự xác minh
 * lại, không tin JWT mù), tránh 1 nhân viên "được cấp quyền Quản lý User" tự
 * nâng cấp mình/người khác lên Toàn quyền. Server cũng tự giữ lại ít nhất 1
 * quản trị viên toàn quyền, không cho hạ hết xuống Chỉ xem.
 */
export async function updateStaffRole(id, role) {
  const a = getAdmin(id);
  if (!a) return;
  const session = getSession();
  const res = await callCreateAccountFunction(session?.sbToken, { type: 'update-staff-role', staffId: id, role });
  if (!res.ok) throw new Error(res.reason || 'Không đổi được vai trò.');
  a.role = role;
  notify();
}
/** Cấp lại mật khẩu cho quản trị viên/nhân viên — có thể tự nhập mật khẩu cụ thể, để trống thì tự sinh ngẫu nhiên. */
/** ĐÃ CHUYỂN SANG SUPABASE THẬT qua Edge Function "create-account". */
export async function resetStaffPassword(id, customPassword) {
  const a = getAdmin(id);
  if (!a) throw new Error('Không tìm thấy tài khoản');
  const session = getSession();
  const res = await callCreateAccountFunction(session?.sbToken, { type: 'reset-staff-password', staffId: id, password: customPassword });
  if (!res.ok) throw new Error(res.reason || 'Không cấp lại được mật khẩu.');
  a.mustChangePassword = true;
  notify();
  return res.tempPassword;
}
/** Kiểm tra mật khẩu hiện tại của quản trị viên/nhân viên — dùng cho màn tự đổi mật khẩu. */
/** ĐÃ CHUYỂN SANG SUPABASE THẬT qua Edge Function (chỉ tự xác minh chính mình). */
export async function verifyAdminPassword(id, password) {
  const session = getSession();
  if (!session || session.id !== id) return false;
  const res = await callCreateAccountFunction(session.sbToken, { type: 'verify-own-password', password });
  return !!(res.ok && res.valid);
}

/** Tự đổi mật khẩu (Quản trị viên/nhân viên tự đặt mật khẩu mới cho chính mình) — ĐÃ CHUYỂN SANG SUPABASE THẬT. */
export async function setStaffPassword(id, newPassword, opts = {}) {
  const session = getSession();
  const res = await callCreateAccountFunction(session?.sbToken, { type: 'set-own-password', newPassword, mustChangePassword: !!opts.mustChangePassword });
  if (!res.ok) throw new Error(res.reason || 'Không đổi được mật khẩu.');
  const a = getAdmin(id);
  if (a) a.mustChangePassword = !!opts.mustChangePassword;
  notify();
}
/** ĐÃ CHUYỂN SANG SUPABASE THẬT qua Edge Function "create-account" (server tự kiểm tra giữ lại ít nhất 1 super admin). */
export async function deleteStaffAdmin(id) {
  const a = getAdmin(id);
  if (!a) return;
  const session = getSession();
  const res = await callCreateAccountFunction(session?.sbToken, { type: 'delete-staff', staffId: id });
  if (!res.ok) throw new Error(res.reason || 'Không xóa được tài khoản.');
  state.admins = state.admins.filter((x) => x.id !== id);
  notify();
}
/** Tài khoản khách hàng có đang bị tạm khóa hay không (do nhập sai mật khẩu nhiều lần). */
export function isCustomerLocked(c) { return !!(c.lockedUntil && c.lockedUntil > Date.now()); }

// Phiên đăng nhập (JWT) giờ KHÔNG còn tự hết hạn theo thời gian nữa (xem
// create-account/index.ts — token không còn field "exp") — đăng nhập 1 lần
// là duy trì mãi mãi, chỉ hết khi bấm "Đăng xuất" thật. Mốc này vì vậy KHÔNG
// còn mô phỏng 1 hạn phiên thật nào cả — chỉ là 1 mốc HIỂN THỊ thuần túy, để
// chấm "đã đăng nhập" không kẹt xanh MÃI MÃI trên màn hình admin nếu khách
// tắt app/rớt mạng/mất máy mà không bấm "Đăng xuất" (server không có cách
// nào chủ động biết để tự tắt is_online lúc đó). Chọn 1 năm là hợp lý cho
// mục đích hiển thị này (đủ dài để không làm phiền, đủ ngắn để dọn dần các
// tài khoản có vẻ đã bỏ dùng).
const CUSTOMER_SESSION_HOURS = 24 * 365;

/**
 * "Đã đăng nhập" (cho 2 chấm trạng thái ở trang Khách hàng & Hợp đồng / Quản
 * lý User) — nghĩa là "HIỆN ĐANG đăng nhập" (còn phiên hoạt động), KHÔNG phải
 * "đã từng đăng nhập" (lịch sử) như bản trước: dựa vào cờ is_online — bật lên
 * true NGAY lúc xác minh mật khẩu đúng (Edge Function create-account, type
 * 'login'), tắt về false NGAY lúc khách bấm "Đăng xuất" (type
 * 'customer-logout', xem hàm logout() ở trên). Kèm 1 lớp phòng hờ THUẦN HIỂN
 * THỊ: nếu last_login_at đã quá CUSTOMER_SESSION_HOURS giờ thì coi như hết
 * phiên (chỉ trên màn hình admin) dù is_online lỡ chưa kịp tắt — phiên đăng
 * nhập THẬT của khách vẫn còn nguyên, không hề bị ảnh hưởng. KHÔNG còn suy ra
 * từ hasPushEnabled() nữa — bật thông báo là chuyện RIÊNG, khách bật xong tắt
 * app vẫn còn đăng ký nhận thông báo dù không còn "đang đăng nhập" nữa.
 */
export function hasCustomerLoggedIn(c) {
  if (!c || !c.isOnline) return false;
  if (!c.lastLoginAt) return true; // phòng hờ dữ liệu cũ chưa kịp có mốc thời gian
  return (Date.now() - new Date(c.lastLoginAt).getTime()) < CUSTOMER_SESSION_HOURS * 3600 * 1000;
}

/** "Đã bật thông báo" — khách có ít nhất 1 thiết bị đã subscribe push (xem loadAdminSessionData()). */
export function hasPushEnabled(customerId) { return !!(state.pushSubscribedCustomerIds && state.pushSubscribedCustomerIds.includes(customerId)); }

// ------------------------------------------------------------
// Yêu cầu tư vấn / mở khoản vay
// ------------------------------------------------------------
export function listRequests(filters = {}) {
  let list = [...state.requests];
  if (filters.customerId) list = list.filter((r) => r.customerId === filters.customerId);
  if (filters.status && filters.status !== 'all') list = list.filter((r) => r.status === filters.status);
  return list.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
}
/**
 * Khách hàng gửi yêu cầu tư vấn/vay mới — ĐÃ CHUYỂN SANG SUPABASE THẬT, ghi
 * thẳng qua RLS (không cần Edge Function riêng vì đây không phải hành động
 * nhạy cảm — RLS đã chặn khách chỉ tạo được yêu cầu cho ĐÚNG chính mình,
 * xem policy "customer creates own request" trong docs/supabase-migration.md).
 */
export async function createRequest({ customerId, type, amount, purpose, termMonths, note }) {
  const session = getSession();
  const sb = getSupabaseClient(session?.sbToken);
  const row = {
    id: genId('yc'), customer_id: customerId, type, amount: Number(amount) || 0, purpose: purpose || '',
    term_months: Number(termMonths) || null, note: note || '', status: 'moi',
  };
  const { error } = await sb.from('requests').insert(row);
  if (error) throw new Error('Không gửi được yêu cầu, thử lại sau.');
  const req = mapRequestRow({ ...row, created_at: new Date().toISOString() });
  state.requests.push(req);
  notify();
  return req;
}
/** Admin cập nhật trạng thái yêu cầu — ĐÃ CHUYỂN SANG SUPABASE THẬT qua RLS. */
export async function updateRequestStatus(id, status) {
  const session = getSession();
  const sb = getSupabaseClient(session?.sbToken);
  const { error } = await sb.from('requests').update({ status }).eq('id', id);
  if (error) throw new Error('Không cập nhật được trạng thái, thử lại sau.');
  const r = state.requests.find((x) => x.id === id);
  if (r) r.status = status;
  notify();
}
function mapRequestRow(row) {
  return {
    id: row.id, customerId: row.customer_id, type: row.type, amount: row.amount,
    purpose: row.purpose || '', termMonths: row.term_months, note: row.note || '',
    status: row.status, createdAt: row.created_at,
  };
}

// ------------------------------------------------------------
// Session (đăng nhập hiện tại)
// ------------------------------------------------------------
export function getSession() { return state.session; }
export function setSession(session) {
  state.session = session;
  if (session) subscribeForceLogout(session.role, session.id, session.sbToken);
  else unsubscribeForceLogout();
  notify();
}

// ------------------------------------------------------------
// "Bị cấp lại mật khẩu ở nơi khác thì tự đăng xuất NGAY" — lắng nghe thời
// gian thực (Supabase Realtime, WebSocket) đúng dòng admins/customers của
// CHÍNH phiên đang mở ở đây. Trước đây admin cấp lại mật khẩu cho ai đó chỉ
// đổi được cột must_change_password trên server — nếu người đó ĐANG mở sẵn
// phiên đăng nhập ở máy khác thì phiên cũ đó vẫn dùng được bình thường cho
// tới khi tự tải lại trang mới thấy bị bắt đổi mật khẩu. Giờ hễ dòng của
// mình đổi VÀ must_change_password=true (đúng lúc BỊ NGƯỜI KHÁC cấp lại —
// tự đổi mật khẩu của chính mình luôn set cờ này về false nên không đụng
// nhánh này) thì ĐĂNG XUẤT NGAY, không cần đợi tải lại trang.
// ------------------------------------------------------------
let forceLogoutChannel = null;
function subscribeForceLogout(role, rowId, jwt) {
  unsubscribeForceLogout();
  if (!rowId || !jwt) return;
  const table = role === 'customer' ? 'customers' : 'admins';
  try {
    const sb = getRealtimeClient(jwt);
    forceLogoutChannel = sb
      .channel(`force-logout-${table}-${rowId}`)
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table, filter: `id=eq.${rowId}` }, (payload) => {
        if (payload.new?.must_change_password) logout();
      })
      .subscribe();
  } catch (e) {
    console.warn('Không lắng nghe được thời gian thực (đăng xuất tự động khi bị cấp lại mật khẩu sẽ không hoạt động, không ảnh hưởng gì khác).', e);
  }
}
function unsubscribeForceLogout() {
  if (forceLogoutChannel) { forceLogoutChannel.unsubscribe(); forceLogoutChannel = null; }
}

/**
 * Đăng xuất — với khách hàng, báo luôn cho server biết để tắt cờ is_online
 * NGAY (dùng cho chấm "đã đăng nhập" ở trang admin) — bắn đi KHÔNG chờ kết
 * quả (fire-and-forget) để không làm chậm/kẹt thao tác đăng xuất ở máy này
 * nếu mạng yếu/rớt mạng; đăng xuất tại đây luôn xử lý xong ngay lập tức bất
 * kể server có nhận được hay không.
 */
export function logout() {
  const session = state.session;
  if (session && session.role === 'customer') {
    callCreateAccountFunction(session.sbToken, { type: 'customer-logout' }).catch(() => {});
  }
  unsubscribeForceLogout();
  state.session = null;
  notify();
}

// ============================================================
// Sinh dữ liệu DEMO — toàn bộ tên/CCCD/số liệu dưới đây là GIẢ,
// không liên quan đến bất kỳ khách hàng thật nào.
// ============================================================
async function seedDemoData() {
  const rng = mulberry32(7717);
  const org = {
    name: 'Quỹ Tín Dụng Nhân Dân Bình Nguyên',
    shortName: 'QTD Bình Nguyên',
    hotline: '1900 000 000',
    address: '01 Đường Mẫu, Phường Trung Tâm, Tỉnh Demo',
    bannerEnabled: true,
    bannerTitle: 'Ưu đãi lãi suất vay tiêu dùng',
    bannerText: 'Liên hệ quầy giao dịch hoặc gửi yêu cầu tư vấn ngay trên ứng dụng để được hỗ trợ.',
    // Thông tin nhận thanh toán — dùng chung đúng hằng số BANK_INFO nhúng
    // cứng ở đầu file (không còn là dữ liệu demo tách riêng nữa).
    ...BANK_INFO,
  };

  const adminCred = await makeCredential('Admin@123');
  const staffCred = await makeCredential('Staff@123');
  const admins = [
    { id: 'admin_1', username: 'admin', name: 'Quản trị viên', role: 'super', allowedThon: [], allowedXom: [], ...adminCred },
    { id: 'staff_1', username: 'nhanvien1', name: 'Nhân viên địa bàn Thôn 1', role: 'staff', allowedThon: ['Thôn 1'], allowedXom: [], ...staffCred, createdAt: new Date().toISOString() },
  ];

  const demoDefs = [
    ['079300012345', 'Trần Văn Mẫu', '0901 000 001', 'Xóm A, Thôn 1, Tỉnh Demo'],
    ['079300012346', 'Nguyễn Thị Mẫu', '0901 000 002', 'Xóm B, Thôn 1, Tỉnh Demo'],
    ['079300012347', 'Lê Văn Ví Dụ', '0901 000 003', 'Xóm A, Thôn 2, Tỉnh Demo'],
    ['079300012348', 'Phạm Thị Ví Dụ', '0901 000 004', 'Xóm B, Thôn 2, Tỉnh Demo'],
  ];
  const customers = [];
  for (const [cccd, name, phone, address] of demoDefs) {
    const temp = 'Demo@123';
    const cred = await makeCredential(temp);
    customers.push({
      id: genId('cust'), cccd, name, phone, address, ...parseAddress(address),
      ...cred, mustChangePassword: true, tempPassword: temp,
      failedAttempts: 0, lockedUntil: null, createdAt: new Date().toISOString(),
    });
  }

  const contracts = [];
  const now = new Date();
  customers.forEach((c, i) => {
    const nContracts = i === 0 ? 2 : 1; // khách đầu tiên có nhiều hợp đồng để minh họa
    for (let k = 0; k < nContracts; k++) {
      const principal = randInt(rng, 20, 150) * 1_000_000;
      const disbursed = addDays(now, -randInt(rng, 30, 400));
      const due = addDays(disbursed, randInt(rng, 6, 24) * 30);
      // Trạng thái phải khớp với ngày đến hạn để dữ liệu demo hợp lý
      const isPastDue = due < now;
      const status = isPastDue
        ? (rng() < 0.65 ? 'qua_han' : 'da_tat_toan')
        : (rng() < 0.85 ? 'dang_vay' : 'da_tat_toan');
      contracts.push({
        id: genId('hd'), customerId: c.id,
        code: `HD${2026}${String(1000 + contracts.length)}`,
        principal, disbursedDate: disbursed.toISOString().slice(0, 10),
        dueDate: due.toISOString().slice(0, 10),
        interestRate: [8.5, 9.2, 10.0][randInt(rng, 0, 2)],
        balance: status === 'da_tat_toan' ? 0 : Math.round((principal * (0.3 + rng() * 0.7)) / 100000) * 100000,
        status,
        // Giả lập lần đóng lãi gần nhất: cách đây một số ngày (0-45 ngày), không vượt quá ngày giải ngân
        interestPaidUntil: (() => {
          const lastPaid = addDays(now, -randInt(rng, 0, 45));
          return (lastPaid < disbursed ? disbursed : lastPaid).toISOString().slice(0, 10);
        })(),
      });
    }
  });

  const requests = [
    {
      id: genId('yc'), customerId: customers[1].id, type: 'vay_moi', amount: 50_000_000,
      purpose: 'Bổ sung vốn kinh doanh', termMonths: 12, note: '',
      status: 'moi', createdAt: addDays(now, -1).toISOString(),
    },
    {
      id: genId('yc'), customerId: customers[2].id, type: 'tu_van', amount: 0,
      purpose: 'Hỏi về lãi suất tất toán trước hạn', termMonths: null, note: 'Muốn tất toán hợp đồng HD20261000',
      status: 'dang_xu_ly', createdAt: addDays(now, -3).toISOString(),
    },
  ];

  state = { org, admins, customers, contracts, requests, session: null, pushSubscribedCustomerIds: [], zaloCustomers: [], zaloAutoSendList: [], zaloSendLog: [] };
}
