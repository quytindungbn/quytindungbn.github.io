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
import { getSupabaseClient, callLoginFunction, callCreateAccountFunction, callImportDataFunction, callForgotPasswordFunction } from './lib/supabaseClient.js';

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
  if (typeof state.chatUnreadCount !== 'number') state.chatUnreadCount = 0;
  if (!Array.isArray(state.monthlySnapshots)) state.monthlySnapshots = [];
}

export async function init() {
  const raw = localStorage.getItem(STORAGE_KEY);
  if (raw) {
    try { state = JSON.parse(raw); migrateState(); }
    catch (e) { console.warn('Dữ liệu lỗi, tạo lại dữ liệu mẫu.', e); await seedDemoData(); }
  } else {
    await seedDemoData();
  }
  // KHÔNG await loadOrgPublic() ở đây nữa — trước đây làm vậy khiến màn hình
  // ĐẦU TIÊN (đăng nhập) phải đợi xong 1 lượt gọi mạng tới Supabase mới chịu
  // vẽ ra, dù đã có sẵn tên quỹ hợp lý để hiện ngay (dữ liệu demo ở lần đầu
  // mở app — seedDemoData() ở trên, hoặc đúng tên quỹ THẬT lưu từ lần trước
  // ở localStorage — trường hợp phổ biến nhất, "app hiện ra chậm" chủ yếu là
  // do lần này). Giờ init() trả về NGAY (không cần mạng) để app.js vẽ màn
  // hình đầu tiên tức khắc bằng dữ liệu đã có sẵn — refreshOrgPublic() gọi
  // RIÊNG ngay sau đó (không đợi), cập nhật ngầm tên quỹ/banner thật khi tải
  // xong (notify() tự kích hoạt vẽ lại đúng phần header, xem app.js).
  persist(); // lưu lại dữ liệu mẫu vừa tạo (nếu lần đầu mở app) — không cần đợi mạng cho việc này
}

/**
 * Tải lại thông tin quỹ tín dụng (org) từ Supabase — tách RIÊNG khỏi init()
 * (xem ghi chú ở trên) để không chặn màn hình đầu tiên. Gọi ngay sau
 * renderApp() lần đầu ở app.js, KHÔNG await — chạy ngầm, notify() khi xong
 * để tự vẽ lại đúng tên quỹ/banner thật (S.subscribe ở app.js).
 */
export async function refreshOrgPublic() {
  await loadOrgPublic();
  notify();
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
    // Số ngày "gần đến hạn" để tự chuyển mẫu Zalo OA "Đến hạn" (gửi tay LẪN
    // tự động đều dùng chung số này) — admin tự nhập ở "Quản lý OA" > "Cấu
    // hình", để trống thì dùng mặc định 15 ngày như trước giờ.
    zaloNearDueDays: row.zalo_near_due_days || 15,
    // Mẫu thông báo đẩy (App) admin tự soạn — xem DEFAULT_PUSH_TEMPLATES ở
    // trên. null nếu admin chưa tự tùy chỉnh (dùng mẫu mặc định).
    pushTemplates: row.push_templates || null,
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
// Mẫu THÔNG BÁO ĐẨY (App) tự soạn được — admin gõ tay tiêu đề/nội dung có
// gắn TOKEN (VD: <Ma_HD>) trong "Quản lý OA" > tab "Cấu hình" (xem
// js/views/admin/zaloOA.js), lưu ở org.pushTemplates (cột orgs.push_templates,
// jsonb) — đổi chữ không cần sửa code/deploy lại gì. Dùng CHUNG cho cả gửi
// tay (buildContractNotificationPreset() trong admin/customers.js) LẪN gửi
// tự động (send-due-reminders/index.ts, port lại y hệt bằng TypeScript) —
// đúng yêu cầu "gửi tay hay tự động đều đồng bộ".
//
// 3 mẫu (theo tình huống hợp đồng, y hệt phân loại contractStatusInfo()):
// 'interest' (chưa đến hạn, chỉ báo lãi), 'nearDue' (gần đến hạn), 'overdue'
// (đã trễ hạn) — mỗi mẫu chỉ có "body" (nội dung); "title" (tiêu đề) dùng
// CHUNG 1 mẫu cho cả 3 (đúng như hành vi cũ — LUÔN đồng nhất "<tên quỹ>
// thông báo:"), lưu riêng ở pushTemplates.title.
export const DEFAULT_PUSH_TEMPLATES = {
  title: '<Ten_quy> thông báo:',
  interest: 'Số tiền lãi hợp đồng <Ma_HD> của quý khách đến hôm nay là: <So_tien_lai>. Quý khách vui lòng thanh toán đúng hạn.',
  nearDue: 'Hợp đồng <Ma_HD> của quý khách đã GẦN ĐẾN HẠN. Số tiền gốc là <So_tien_goc> và lãi đến nay là: <So_tien_lai>. Quý khách vui lòng thanh toán trước ngày <Ngay_dao_han>.',
  overdue: 'Hợp đồng <Ma_HD> ĐÃ TRỄ HẠN. Số tiền gốc là <So_tien_goc>, lãi đến nay là: <So_tien_lai>. Yêu cầu quý khách thanh toán và thực hiện đúng như cam kết.',
};

/** Danh sách TOKEN dùng được trong mẫu thông báo đẩy — hiện làm chú thích ở màn "Cấu hình" (zaloOA.js) VÀ dùng để build đúng tên khóa cho renderNotificationTemplate(). */
export const PUSH_TEMPLATE_TOKENS = [
  { token: '<Ten_KH>', desc: 'Tên khách hàng' },
  { token: '<Ma_HD>', desc: 'Mã hợp đồng' },
  { token: '<So_tien_goc>', desc: 'Số tiền gốc phải trả (đúng theo kỳ đang cần chú ý nếu hợp đồng có phân kỳ trả nợ, không thì là dư nợ hiện tại)' },
  { token: '<So_tien_lai>', desc: 'Tiền lãi tính đến hôm nay' },
  { token: '<So_du>', desc: 'Dư nợ hiện tại (không đổi theo kỳ)' },
  { token: '<Ngay_dao_han>', desc: 'Ngày đến hạn (đúng theo kỳ đang cần chú ý nếu có, không thì là ngày đáo hạn hợp đồng)' },
  { token: '<Ten_quy>', desc: 'Tên viết tắt quỹ tín dụng' },
];

/**
 * Thay TOKEN (VD: "<Ma_HD>") trong 1 chuỗi mẫu bằng giá trị thật — token nào
 * không có trong `tokens` thì GIỮ NGUYÊN chữ gốc (không xóa mất, để admin dễ
 * nhận ra gõ sai tên token). Dùng cho cả tiêu đề lẫn nội dung thông báo đẩy.
 */
export function renderNotificationTemplate(str, tokens) {
  return String(str || '').replace(/<([A-Za-z0-9_]+)>/g, (m, key) => (key in tokens ? String(tokens[key]) : m));
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
    zaloNearDueDays: 'zalo_near_due_days', pushTemplates: 'push_templates',
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

/** Đổi NĂM của 1 ngày, giữ nguyên tháng/ngày — dùng cho computeInstallmentPlan() bên dưới. Tự lùi về ngày cuối tháng trước nếu ngày gốc là 29/02 mà năm mới không phải năm nhuận (JS Date mặc định sẽ tự "tràn" sang 01/03, phải tự chặn lại). */
function withYear(date, year) {
  const month = date.getMonth();
  const day = date.getDate();
  const d = new Date(year, month, day);
  if (d.getMonth() !== month) d.setDate(0);
  return d;
}

/**
 * Đổi 1 Date (dựng bằng new Date(năm, tháng, ngày) — tức LUÔN theo giờ ĐỊA
 * PHƯƠNG của trình duyệt) thành chuỗi "YYYY-MM-DD" — dùng cho
 * computeInstallmentPlan() bên dưới. TUYỆT ĐỐI KHÔNG dùng
 * date.toISOString().slice(0,10) ở đây — toISOString() luôn quy đổi ra GIỜ
 * UTC trước, nên ở múi giờ Việt Nam (UTC+7, sớm hơn UTC) thì 00:00 giờ VN sẽ
 * lùi về 17:00 NGÀY HÔM TRƯỚC theo UTC, làm SAI LỆCH ngày hiển thị (VD:
 * 23/08/2026 bị hiện thành 22/08/2026) — dùng luôn getFullYear()/getMonth()/
 * getDate() (giờ địa phương) để không bị lệch múi giờ.
 */
function toLocalISODate(date) {
  const yyyy = date.getFullYear();
  const mm = String(date.getMonth() + 1).padStart(2, '0');
  const dd = String(date.getDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}

/**
 * "Phân kỳ trả nợ" (xem lúc bấm vào chi tiết hợp đồng — hiện ở "Kỳ tới";
 * chưa gắn vào Tổng quan/nhắc nợ tự động/Zalo OA) — dựng từ
 * contract.installmentSchedule (map năm -> số tiền, đọc từ các cột "Phân kỳ
 * năm..." lúc nhập Excel mẫu báo cáo, xem mục 10.44 docs).
 *
 * QUY TẮC (theo đúng yêu cầu):
 * - Hợp đồng có DƯỚI 2 năm có số liệu > 0 -> KHÔNG coi là có phân kỳ trả nợ,
 *   trả về null — nơi gọi tự hiểu là tính/hiển thị Y HỆT hợp đồng thường
 *   (dùng thẳng dueDate/balance như mọi khi), KHÔNG đổi gì cả.
 * - Từ 2 năm trở lên -> mỗi năm là 1 "kỳ", ngày đến hạn của kỳ đó = ngày
 *   giải ngân (disbursedDate) nhưng đổi sang ĐÚNG NĂM của kỳ, giữ nguyên
 *   tháng/ngày — VD: giải ngân 03/08/2026, kỳ năm 2027 -> đến hạn 03/08/2027.
 * - MẶC ĐỊNH mỗi kỳ hiển thị ĐÚNG số tiền ghi trong kỳ đó theo Excel (VD:
 *   kỳ 20tr, kỳ sau 20tr, kỳ sau 160tr -> hiển thị đúng y vậy). KHÔNG phải
 *   kiểu cộng dồn tổng (SAI: kỳ đầu 20, kỳ sau 40, kỳ cuối 200 theo dư nợ).
 * - Kỳ (KHÔNG phải kỳ cuối cùng): số tiền đã trả lũy kế (= Số tiền vay ban
 *   đầu - Số dư hiện tại) được PHÂN BỔ THEO ĐÚNG THỨ TỰ từng kỳ một — kỳ
 *   trước "no" đủ mới tới lượt kỳ sau — ÁP DỤNG NGAY CHO MỌI KỲ, kể cả kỳ
 *   CHƯA tới hạn (trả dư ra thì kỳ sau phải giảm ngay, không đợi tới đúng
 *   ngày mới trừ). VD: phân kỳ 20tr/20tr/160tr (kỳ cuối), đã trả dư 30tr ->
 *   kỳ 1 dùng hết 20tr (còn dư 10tr) -> kỳ 2 chỉ còn thiếu 20-10=10tr, kỳ 1
 *   hiển thị 0đ. Trả dư 50tr -> kỳ 1 VÀ kỳ 2 đều = 0đ (dùng hết 40tr cho cả
 *   2 kỳ). Ngược lại nếu kỳ trước đã trả thiếu (VD kỳ cần 10tr mới trả 5tr)
 *   thì kỳ này chỉ báo thêm đúng phần còn thiếu (5tr) cho đủ.
 * - Riêng KỲ CUỐI CÙNG (trùng "Ngày đáo hạn" hợp đồng): mặc định vẫn hiển
 *   thị ĐÚNG số tiền ghi trong kỳ — CHỈ đổi thành SỐ DƯ NỢ HIỆN TẠI CÒN LẠI
 *   khi số tiền đã trả lũy kế (= Số tiền vay ban đầu - Số dư hiện tại) đã
 *   VƯỢT quá tổng tất cả các kỳ TRƯỚC kỳ cuối (nghĩa là các kỳ trước đã được
 *   trả dư ra rồi, số dư nợ còn lại lúc đó mới là số CHÍNH XÁC khách còn
 *   phải trả cho kỳ cuối, không phải con số cố định ghi sẵn trong Excel).
 *   VD thực tế: vay 280tr, dư nợ hiện tại 140tr (=> đã trả lũy kế 140tr).
 *   Phân kỳ 2027: 10tr, 2028: 10tr, 2029: 260tr (kỳ cuối). Tổng các kỳ TRƯỚC
 *   kỳ cuối = 10+10=20tr. Đã trả 140tr > 20tr -> kỳ cuối (2029) hiển thị
 *   đúng bằng SỐ DƯ NỢ CÒN LẠI (140tr), không phải 260tr ghi trong Excel.
 */
export function computeInstallmentPlan(contract, asOf = new Date()) {
  const schedule = contract.installmentSchedule;
  if (!schedule) return null;
  const entries = Object.entries(schedule)
    .map(([year, amount]) => ({ year: Number(year), amount: Number(amount) }))
    .filter((e) => Number.isFinite(e.year) && e.amount > 0)
    .sort((a, b) => a.year - b.year);
  if (entries.length < 2) return null;

  const disbursed = new Date(contract.disbursedDate);
  const balance = Number(contract.balance) || 0;
  const amountPaid = (Number(contract.principal) || 0) - balance; // đã trả lũy kế tới hiện tại
  const sumBeforeLast = entries.slice(0, -1).reduce((s, e) => s + e.amount, 0); // tổng các kỳ TRƯỚC kỳ cuối
  let cumulativeRequired = 0;
  return entries.map((e, idx) => {
    cumulativeRequired += e.amount; // tổng các kỳ tính đến kỳ này (cộng dồn)
    const isLast = idx === entries.length - 1;
    const dueDate = withYear(disbursed, e.year);
    const daysLeft = daysBetween(asOf, dueDate);
    const isPastOrToday = daysLeft <= 0;

    let dueAmount;
    if (isLast) {
      // Chỉ đổi thành số dư nợ còn lại khi đã trả lũy kế VƯỢT quá tổng các
      // kỳ trước kỳ cuối — ngược lại vẫn hiển thị đúng số ghi trong kỳ.
      dueAmount = amountPaid > sumBeforeLast ? balance : e.amount;
    } else {
      // Kỳ (không phải kỳ cuối) — PHÂN BỔ tiền đã trả lũy kế theo ĐÚNG THỨ
      // TỰ từng kỳ một (kỳ trước no đủ mới tới kỳ sau), ÁP DỤNG CHO MỌI KỲ
      // (kể cả kỳ CHƯA tới hạn, không chỉ kỳ đã đến/quá hạn — trả dư ra thì
      // kỳ sau phải giảm ngay, không đợi tới đúng ngày mới trừ):
      // - Phần đã trả CHO RIÊNG kỳ này = đã trả lũy kế - tổng các kỳ TRƯỚC
      //   kỳ này (chặn dưới 0 nếu chưa trả đủ tới lượt kỳ này).
      // - Số còn thiếu của kỳ này = số ghi trong kỳ - phần đã trả cho kỳ này
      //   (chặn dưới 0 nếu đã trả dư/đủ).
      // VD: phân kỳ 20tr/20tr/160tr, đã trả dư 30tr -> kỳ 1 dùng hết 20tr
      // (còn dư 10tr) -> kỳ 2 chỉ còn thiếu 20-10=10tr. Trả dư 50tr -> kỳ 1
      // VÀ kỳ 2 đều = 0 (dùng hết 40tr cho cả 2 kỳ, dư 10tr chuyển qua kỳ
      // cuối nhưng kỳ cuối tính riêng ở nhánh isLast bên trên).
      const requiredBeforeThis = cumulativeRequired - e.amount; // tổng các kỳ TRƯỚC kỳ này
      const coveredForThis = Math.max(0, amountPaid - requiredBeforeThis);
      dueAmount = Math.max(0, e.amount - coveredForThis);
    }

    return {
      year: e.year,
      dueDate: toLocalISODate(dueDate),
      amount: e.amount, // số tiền GHI TRONG kỳ theo file Excel (tham khảo)
      dueAmount, // số tiền THỰC SỰ cần báo/hiển thị cho kỳ này (xem quy tắc ở trên)
      daysLeft,
      shouldWarn: isPastOrToday && dueAmount > 0,
    };
  });
}

/**
 * "Kỳ tới" của 1 hợp đồng — kỳ ĐẦU TIÊN trong computeInstallmentPlan() còn
 * thiếu tiền (dueAmount > 0), tức là kỳ cần chú ý nhất lúc này (có thể đã
 * quá hạn hoặc còn ở tương lai). Dùng CHUNG cho cả ô tóm tắt "Kỳ tới"
 * (js/components/ui.js) LẪN bộ lọc "Gần đến hạn"/"Quá hạn" ở trang Khách
 * hàng (js/views/admin/customers.js) — để cả 2 nơi tính nhất quán, không
 * lặp code. Trả về null nếu hợp đồng không có phân kỳ, hoặc đã trả đủ hết
 * mọi kỳ theo lịch.
 *
 * `urgency` dùng ĐÚNG ngưỡng NEAR_DUE_DAYS (15 ngày) y hệt contractUrgency()
 * ở trên, áp cho NGÀY ĐẾN HẠN CỦA KỲ thay vì ngày đáo hạn hợp đồng gốc.
 */
export function nextInstallmentInfo(contract, asOf = new Date()) {
  const plan = computeInstallmentPlan(contract, asOf);
  if (!plan) return null;
  const idx = plan.findIndex((p) => p.dueAmount > 0);
  if (idx < 0) return null;
  const next = plan[idx];
  const urgency = next.daysLeft < 0 ? 'qua_han' : next.daysLeft <= NEAR_DUE_DAYS ? 'gan_den_han' : null;
  return { plan, idx, next, urgency };
}

/**
 * Số ngày quá hạn THỰC SỰ của 1 hợp đồng — xét CẢ ngày đáo hạn hợp đồng gốc
 * LẪN "Kỳ tới" của phân kỳ trả nợ (nếu có), lấy nguồn NÀO QUÁ HẠN NHIỀU HƠN
 * (y hệt cách contractStatusInfo() ưu tiên "quá hạn" ở dưới) — dùng để xếp
 * NHÓM NỢ theo đúng quy định phân loại nợ (Thông tư 02/2013 NHNN): Nhóm 1 =
 * quá hạn 0-10 ngày, Nhóm 2 = 11-90, Nhóm 3 = 91-180, Nhóm 4 = 181-360, Nhóm
 * 5 = trên 360 ngày — xem debtGroup() ngay bên dưới. Trả về null nếu hợp
 * đồng đã tất toán (không xếp nhóm nợ cho hợp đồng đã trả hết).
 */
export function daysOverdue(contract, asOf = new Date()) {
  if ((Number(contract.balance) || 0) <= 0) return null;
  const mainOverdue = daysBetween(new Date(contract.dueDate), asOf);
  const inst = nextInstallmentInfo(contract, asOf);
  const instOverdue = inst ? -inst.next.daysLeft : -Infinity;
  return Math.max(0, mainOverdue, instOverdue);
}

/**
 * Nhóm nợ 1-5 theo đúng quy định phân loại nợ NHNN (Thông tư 02/2013, Điều
 * 10) — dùng số ngày quá hạn từ daysOverdue() ở trên. null nếu đã tất toán
 * (không thuộc nhóm nào). Dùng cho dashboard "Tỷ lệ nợ xấu" ở Tổng quan
 * (xem debtGroupSummary() ngay bên dưới) — "nợ xấu" chính thức = Nhóm 3+4+5.
 */
export function debtGroup(contract, asOf = new Date()) {
  const d = daysOverdue(contract, asOf);
  if (d === null) return null;
  if (d <= 10) return 1;
  if (d <= 90) return 2;
  if (d <= 180) return 3;
  if (d <= 360) return 4;
  return 5;
}

/**
 * Tổng hợp dư nợ theo từng nhóm nợ + lãi phải thu (CHỈ tính Nhóm 1 — nợ từ
 * Nhóm 2 trở lên coi như khó thu lãi đúng hạn, không tính vào lãi phải thu
 * nữa, theo đúng yêu cầu) + tỷ lệ nợ xấu (dư nợ Nhóm 3+4+5 / tổng dư nợ) —
 * dùng cho dashboard "Tổng quan" (xem overview.js) VÀ cho việc chốt số liệu
 * cuối tháng (xem mục 10.46 docs/supabase-migration.md).
 * `contracts` truyền vào nên là ĐÚNG phạm vi được phép xem của phiên đang
 * gọi (super = toàn quỹ, staff = trong Thôn/Xóm được gán — xem
 * visibleContracts() ở overview.js).
 */
export function debtGroupSummary(contracts, asOf = new Date()) {
  const groupBalances = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 };
  let totalBalance = 0;
  let interestReceivable = 0;
  for (const ct of contracts) {
    const g = debtGroup(ct, asOf);
    if (g === null) continue;
    const balance = Number(ct.balance) || 0;
    groupBalances[g] += balance;
    totalBalance += balance;
    if (g === 1) interestReceivable += accruedInterest(ct, asOf);
  }
  const badDebtBalance = groupBalances[3] + groupBalances[4] + groupBalances[5];
  const badDebtRatio = totalBalance > 0 ? (badDebtBalance / totalBalance) * 100 : 0;
  return { groupBalances, totalBalance, interestReceivable, badDebtBalance, badDebtRatio };
}

/** Tỷ lệ trích dự phòng CỤ THỂ theo từng nhóm nợ 2-5 (Nhóm 1 = 0%, không trích) — Thông tư 02/2013 NHNN, đúng số quỹ đang áp dụng. */
const SPECIFIC_PROVISION_RATE = { 2: 0.05, 3: 0.2, 4: 0.5, 5: 1 };
/** Tỷ lệ dự phòng CHUNG, áp dụng trên tổng dư nợ Nhóm 1-4 (không tính Nhóm 5). */
const GENERAL_PROVISION_RATE = 0.0075;

/**
 * Dự phòng rủi ro phải trích — dùng cho dashboard "Tổng quan" (mục "Dư nợ
 * theo nhóm nợ", xem overview.js nhomNoSectionHtml()), tính "SỐNG" ngay lúc
 * gọi (không có lịch sử theo tháng, giống debtGroupSummary() ở trên).
 *
 * - Dự phòng CHUNG = 0,75% × tổng dư nợ Nhóm 1-4 (không tính Nhóm 5).
 * - Dự phòng CỤ THỂ = với TỪNG hợp đồng ở Nhóm 2-5: tỷ lệ theo nhóm (2=5%,
 *   3=20%, 4=50%, 5=100%) × PHẦN DƯ NỢ CÒN LẠI sau khi trừ 50% giá trị TSBĐ
 *   đã khai báo (`ct.hasCollateral`/`ct.collateralValue`, xem
 *   setContractCollateral() bên dưới) — dư nợ vượt quá phần được khấu trừ đó
 *   VẪN phải trích đúng phần vượt, không phải cứ có TSBĐ là miễn hoàn toàn.
 */
export function provisionSummary(contracts, asOf = new Date()) {
  let generalBase = 0;
  let specificProvision = 0;
  for (const ct of contracts) {
    const g = debtGroup(ct, asOf);
    if (g === null) continue;
    const balance = Number(ct.balance) || 0;
    if (g <= 4) generalBase += balance;
    const rate = SPECIFIC_PROVISION_RATE[g];
    if (!rate) continue;
    const deductible = ct.hasCollateral ? (Number(ct.collateralValue) || 0) * 0.5 : 0;
    specificProvision += Math.max(0, balance - deductible) * rate;
  }
  return { generalProvision: generalBase * GENERAL_PROVISION_RATE, specificProvision };
}

/**
 * Super admin tích/nhập "Có TSBĐ" + giá trị cho 1 hợp đồng — dùng tính "Dự
 * phòng cụ thể phải trích" (provisionSummary() ở trên). CHỈ super admin gọi
 * được — RLS chặn admin thường ("super admin updates collateral" trên
 * `contracts`, xem mục docs/supabase-migration.md). Tích/bỏ tích được tự do,
 * không giới hạn.
 */
export async function setContractCollateral(contractId, { hasCollateral, collateralValue }) {
  const ct = state.contracts.find((c) => c.id === contractId);
  if (!ct) throw new Error('Không tìm thấy hợp đồng.');
  const session = getSession();
  const sb = getSupabaseClient(session?.sbToken);
  const patch = { has_collateral: !!hasCollateral, collateral_value: hasCollateral ? (Number(collateralValue) || 0) : 0 };
  const { error } = await sb.from('contracts').update(patch).eq('id', contractId);
  if (error) throw new Error('Không lưu được TSBĐ, thử lại sau.');
  ct.hasCollateral = patch.has_collateral;
  ct.collateralValue = patch.collateral_value;
  notify();
  logAdminAction('update-contract-collateral', { contractId });
}

/**
 * Trạng thái HIỂN THỊ đầy đủ của 1 hợp đồng — xét CẢ ngày đáo hạn hợp đồng
 * gốc LẪN "Kỳ tới" của phân kỳ trả nợ (nextInstallmentInfo(), nếu có), dùng
 * ĐÚNG ngưỡng NEAR_DUE_DAYS (15 ngày). Trả về sẵn {status, badge, label,
 * days, dueAmount, source} — dùng thẳng cho "Trạng thái" + dòng cảnh báo ở
 * CHI TIẾT hợp đồng (CẢ 2 bên quản trị/khách hàng) + trang chủ khách hàng.
 * `dueAmount` = SỐ TIỀN GỐC gắn với cảnh báo — nếu nguồn cảnh báo là 1 KỲ cụ
 * thể (source:'installment') thì lấy đúng số tiền đến hạn của KỲ đó (không
 * phải toàn bộ dư nợ); nếu nguồn là ngày đáo hạn hợp đồng gốc (source:
 * 'contract') thì lấy dư nợ hiện tại như trước giờ.
 *
 * CHỦ Ý: KHÔNG đụng vào contractUrgency()/effectiveContractStatus() —
 * 2 hàm gốc đó vẫn giữ NGUYÊN VẸN, đang dùng cho mẫu tin Zalo OA/nhắc nợ
 * (buildContractNotificationPreset trong admin/customers.js) — CHƯA gắn
 * phân kỳ vào Zalo OA theo đúng yêu cầu. Tổng quan (overview.js) đã gắn
 * phân kỳ vào rồi nhưng qua contractAttentionInfo() (NGƯỠNG RỘNG 45 ngày,
 * xem bên dưới), không phải qua hàm này (hàm này chỉ dùng ĐÚNG 15 ngày,
 * cho "Trạng thái" ở chi tiết hợp đồng).
 */
export function contractStatusInfo(contract, asOf = new Date()) {
  if ((contract.balance || 0) <= 0) {
    return { status: 'da_tat_toan', badge: 'badge-green', label: 'Đã tất toán', days: 0, dueAmount: 0, source: null };
  }
  const mainDays = daysBetween(asOf, new Date(contract.dueDate));
  const mainLevel = mainDays < 0 ? 'qua_han' : mainDays <= NEAR_DUE_DAYS ? 'gan_den_han' : null;
  const inst = nextInstallmentInfo(contract, asOf);
  const instLevel = inst ? inst.urgency : null;

  // Ưu tiên QUÁ HẠN trước (lấy nguồn quá hạn NHIỀU ngày nhất); không ai quá
  // hạn mới xét GẦN ĐẾN HẠN (lấy nguồn gấp nhất — ÍT ngày nhất).
  const overdue = [];
  if (mainLevel === 'qua_han') overdue.push({ days: Math.abs(mainDays), source: 'contract', amount: contract.balance });
  if (instLevel === 'qua_han') overdue.push({ days: Math.abs(inst.next.daysLeft), source: 'installment', amount: inst.next.dueAmount });
  if (overdue.length) {
    const worst = overdue.reduce((a, b) => (b.days > a.days ? b : a));
    return { status: 'qua_han', badge: 'badge-red', label: `Quá hạn ${worst.days} ngày`, days: worst.days, dueAmount: worst.amount, source: worst.source };
  }
  const near = [];
  if (mainLevel === 'gan_den_han') near.push({ days: mainDays, source: 'contract', amount: contract.balance });
  if (instLevel === 'gan_den_han') near.push({ days: inst.next.daysLeft, source: 'installment', amount: inst.next.dueAmount });
  if (near.length) {
    const soonest = near.reduce((a, b) => (b.days < a.days ? b : a));
    return { status: 'gan_den_han', badge: 'badge-yellow', label: `Gần đến hạn ${soonest.days} ngày`, days: soonest.days, dueAmount: soonest.amount, source: soonest.source };
  }
  return { status: 'dang_vay', badge: 'badge-blue', label: 'Trong hạn', days: mainDays, dueAmount: contract.balance, source: 'contract' };
}

// "Gần đến hạn" ở contractAttentionInfo() bên dưới RỘNG hơn hẳn NEAR_DUE_DAYS
// (15 ngày, dùng cho contractStatusInfo()/nhắc nợ Zalo OA) — xem trước tới
// tận 45 ngày, dùng cho trang "Khách hàng & Hợp đồng" + popup "Gần đến hạn"
// ở Tổng quan (2 nơi CHUNG 1 ngưỡng này để nhất quán).
export const WIDE_NEAR_DUE_DAYS = 45;

/**
 * Mức cần chú ý CAO NHẤT của 1 hợp đồng — xét CẢ ngày đáo hạn hợp đồng gốc
 * LẪN "Kỳ tới" của phân kỳ trả nợ (nextInstallmentInfo()) nếu hợp đồng có
 * phân kỳ, dùng ngưỡng RỘNG WIDE_NEAR_DUE_DAYS (45 ngày, xem trước xa hơn
 * hẳn NEAR_DUE_DAYS chính thức) — để hợp đồng có kỳ đến hạn/quá hạn GIỮA
 * CHỪNG (chưa tới ngày đáo hạn cuối cùng của hợp đồng) vẫn lọt vào đúng bộ
 * lọc "Gần đến hạn"/"Nợ quá hạn" ở trang Khách hàng & popup "Gần đến hạn" ở
 * Tổng quan, y hệt cảnh báo ngày đáo hạn hợp đồng gốc. Trả về { level:
 * 'qua_han' | 'gan_den_han' | null, days, dueAmount, source }. `dueAmount` =
 * SỐ TIỀN GỐC gắn với cảnh báo — nếu nguồn là 1 KỲ cụ thể (source:
 * 'installment') thì lấy đúng số tiền đến hạn của KỲ đó (không phải toàn bộ
 * dư nợ); nếu nguồn là ngày đáo hạn hợp đồng gốc (source:'contract') thì lấy
 * dư nợ hiện tại như trước giờ — y hệt cách contractStatusInfo() ở trên tính
 * dueAmount, chỉ khác ngưỡng "gần đến hạn" (RỘNG 45 ngày thay vì 15 ngày).
 */
export function contractAttentionInfo(contract, asOf = new Date()) {
  const d = daysBetween(asOf, new Date(contract.dueDate));
  const contractLevel = contractUrgency(contract, asOf) === 'qua_han' ? 'qua_han' : (d >= 0 && d <= WIDE_NEAR_DUE_DAYS ? 'gan_den_han' : null);
  const inst = nextInstallmentInfo(contract, asOf);
  const instDays = inst ? inst.next.daysLeft : null;
  const instLevel = inst ? (instDays < 0 ? 'qua_han' : (instDays <= WIDE_NEAR_DUE_DAYS ? 'gan_den_han' : null)) : null;

  const overdue = [];
  if (contractLevel === 'qua_han') overdue.push({ days: Math.abs(d), source: 'contract', amount: contract.balance });
  if (instLevel === 'qua_han') overdue.push({ days: Math.abs(instDays), source: 'installment', amount: inst.next.dueAmount });
  if (overdue.length) {
    const worst = overdue.reduce((a, b) => (b.days > a.days ? b : a)); // quá hạn: lấy NHIỀU ngày nhất
    return { level: 'qua_han', days: worst.days, dueAmount: worst.amount, source: worst.source };
  }

  const nearDue = [];
  if (contractLevel === 'gan_den_han') nearDue.push({ days: d, source: 'contract', amount: contract.balance });
  if (instLevel === 'gan_den_han') nearDue.push({ days: instDays, source: 'installment', amount: inst.next.dueAmount });
  if (nearDue.length) {
    const soonest = nearDue.reduce((a, b) => (b.days < a.days ? b : a)); // gần đến hạn: lấy ÍT ngày nhất (gấp nhất)
    return { level: 'gan_den_han', days: soonest.days, dueAmount: soonest.amount, source: soonest.source };
  }

  return { level: null, days: 0, dueAmount: contract.balance, source: null };
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
  const [{ data: custRow }, { data: contractRows }, { data: requestRows }, chatUnreadRes] = await Promise.all([
    sb.from('customers').select('*').eq('id', customerId).maybeSingle(),
    sb.from('contracts').select('*').eq('customer_id', customerId),
    sb.from('requests').select('*').eq('customer_id', customerId),
    // Số tin nhắn hỗ trợ (chat) do quản trị viên/nhân viên gửi mà khách CHƯA
    // đọc — dùng cho chấm đỏ ở nút chat nổi (xem js/components/shell.js
    // renderChatFab). Bọc an toàn (giống push_subscriptions) phòng lúc chưa
    // chạy SQL tạo bảng chat_messages (mục 10.24) — lỗi thì coi như 0, không
    // chặn tải các dữ liệu khác.
    sb.from('chat_messages').select('id', { count: 'exact', head: true })
      .eq('customer_id', customerId).eq('sender_role', 'admin').is('read_at', null)
      .then((r) => r, () => ({ count: 0 })),
  ]);
  state.customers = custRow ? [mapCustomerRow(custRow)] : [];
  state.contracts = (contractRows || []).map(mapContractRow);
  state.requests = (requestRows || []).map(mapRequestRow);
  state.chatUnreadCount = chatUnreadRes?.count || 0;
}

/** snake_case (cột Postgres) -> camelCase (đúng field app đang dùng khắp nơi). */
function mapCustomerRow(row) {
  return {
    id: row.id, cccd: row.cccd, name: row.name, phone: row.phone || '', address: row.address || '',
    thon: row.thon || '', xom: row.xom || '', xa: row.xa || '', tinh: row.tinh || '',
    salt: row.salt, hash: row.hash,
    mustChangePassword: !!row.must_change_password,
    forceLogoutAt: row.force_logout_at || null,
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
    // 2 cột MỚI (chỉ có khi nhập từ "mẫu báo cáo" — xem mục 10.44 docs) —
    // agreementCode chỉ để hiển thị tham khảo; installmentSchedule dùng cho
    // computeInstallmentPlan() (xem hàm đó bên dưới).
    agreementCode: row.agreement_code || null,
    installmentSchedule: row.installment_schedule || null,
    // Tài sản bảo đảm (TSBĐ) — dùng tính "Dự phòng cụ thể phải trích" ở
    // dashboard "Tổng quan" (xem overview.js debtGroupHtml()/setContractCollateral()
    // bên dưới) — KHÔNG liên quan tới đợt nhập Excel nào, chỉ super admin tự
    // tích/nhập tay từng hợp đồng qua danh sách "Dư nợ theo nhóm nợ".
    hasCollateral: !!row.has_collateral,
    collateralValue: Number(row.collateral_value) || 0,
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
 * Đăng xuất NGAY 1 khách hàng đang có phiên đăng nhập ở đâu đó — KHÔNG cấp
 * lại mật khẩu (khác adminResetCustomerPassword ở trên). Dùng đúng cơ chế
 * tự phát hiện của "Cấp lại mật khẩu" (xem refreshSessionData() — so
 * forceLogoutAt trước/sau mỗi lần tự làm mới dữ liệu) nên tự bung ra y hệt,
 * không cần tải lại trang.
 */
export async function forceLogoutCustomer(customerId) {
  const session = getSession();
  const res = await callCreateAccountFunction(session?.sbToken, { type: 'force-logout-customer', customerId });
  if (!res.ok) throw new Error(res.reason || 'Không đăng xuất được tài khoản này.');
  const c = getCustomer(customerId);
  if (c) c.forceLogoutAt = new Date().toISOString();
  notify();
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
  // hiện đúng (VD: cảnh báo "còn N ngày" ở lần mở tiếp theo), không cần đợi
  // refreshSessionData() định kỳ. CHẠY NGẦM (không await) — người vừa bấm
  // gửi cần biết kết quả THÀNH CÔNG/LỖI càng nhanh càng tốt (gửi Zalo qua
  // mạng ngoài vốn đã mất vài giây rồi), không nên bắt họ đợi thêm cả 1 lượt
  // tải lại TOÀN BỘ dữ liệu phiên (8 bảng) nữa mới thấy được kết quả.
  refreshSessionData().catch(() => {});
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
//
// 2 cột TÙY CHỌN thêm ở CUỐI (chỉ có khi đọc file "mẫu báo cáo" mới — xem
// remapReportTemplateRows() trong js/lib/xlsxLite.js, KHÔNG bắt buộc với
// mẫu phẳng/dán tay): Mã khế ước | Phân kỳ trả nợ theo năm (đóng gói JSON).
// ------------------------------------------------------------
export function parseVNNumber(str) {
  let s = String(str ?? '').trim().replace(/[^\d.,-]/g, '');
  if (!s) return 0;
  // "42.500.000" kiểu VN (chấm ngăn cách hàng nghìn, đúng từng nhóm 3 số) -> bỏ chấm
  if (/^-?\d{1,3}(\.\d{3})+$/.test(s)) s = s.replace(/\./g, '');
  // "100,000,000" kiểu Mỹ (PHẨY ngăn cách hàng nghìn, đúng từng nhóm 3 số,
  // KHÔNG kèm dấu chấm nào khác — mẫu báo cáo dùng định dạng này) -> bỏ
  // phẩy, coi như số nguyên. PHẢI kiểm tra TRƯỚC nhánh "chỉ có phẩy -> dấu
  // thập phân" bên dưới — thiếu nhánh này thì "100,000,000" sẽ bị hiểu
  // nhầm thành 100 (chỉ đổi ĐÚNG 1 dấu phẩy đầu tiên thành dấu chấm, phẩy
  // còn lại khiến parseFloat() dừng đọc luôn ở đó) — sai đến hàng triệu lần.
  else if (/^-?\d{1,3}(,\d{3})+$/.test(s)) s = s.replace(/,/g, '');
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

    // 2 cột cuối (agreementCode, installmentScheduleRaw) CHỈ có khi đọc từ
    // "mẫu báo cáo" mới (xem remapReportTemplateRows() trong js/lib/xlsxLite.js)
    // — dán tay/mẫu phẳng cũ không có 2 cột này, tự ra undefined, không ảnh
    // hưởng gì (2 trường tương ứng dưới đây tự thành null).
    const [code, name, address, cccdRaw, phone, disbursedDate, dueDate, interestPaidUntil, principal, balance, interestRate, agreementCode, installmentScheduleRaw] = cells.map((c) => c.trim());
    const cccd = (cccdRaw || '').replace(/\s/g, '');
    if (!cccd || !/^\d{9,12}$/.test(cccd)) { parseErrors.push(`Bỏ qua dòng (CCCD không hợp lệ): ${line.slice(0, 40)}...`); continue; }

    // Phân kỳ trả nợ theo từng năm (nếu file có cột "Phân kỳ năm..."), ĐÓNG
    // GÓI qua 1 cột chuỗi JSON — chỉ giữ lại năm có SỐ TIỀN THẬT > 0 (năm
    // ghi 0/rỗng không phải 1 kỳ trả nợ thật). Quyết định "có phân kỳ trả nợ
    // hẳn hoi hay không" (từ 2 năm có số liệu trở lên) để dành cho chỗ TÍNH
    // TOÁN hiển thị (xem computeInstallmentPlan()), ở đây chỉ ghi nhận đúng
    // dữ liệu thô đã có, không tự quyết định trước.
    let installmentSchedule = null;
    if (installmentScheduleRaw) {
      try {
        const raw = JSON.parse(installmentScheduleRaw);
        const parsed = {};
        for (const [year, amtRaw] of Object.entries(raw)) {
          const amt = parseVNNumber(amtRaw);
          if (amt > 0) parsed[year] = amt;
        }
        if (Object.keys(parsed).length) installmentSchedule = parsed;
      } catch (e) { /* dữ liệu phân kỳ lỗi/đọc không được — bỏ qua, không chặn nhập cả dòng vì lỗi ở đúng phần không bắt buộc này */ }
    }

    const disbursed = parseVNDate(disbursedDate) || new Date().toISOString().slice(0, 10);
    rows.push({
      cccd, name, address, phone, code: code || null,
      agreementCode: agreementCode || null,
      installmentSchedule,
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
 *
 * "Bị cấp lại mật khẩu ở nơi khác thì tự đăng xuất ngay" cũng dựa vào ĐÚNG
 * lần làm mới này (không cần thêm cơ chế/hẹn giờ riêng nào khác) — so
 * must_change_password của CHÍNH mình TRƯỚC/SAU khi tải: chuyển từ false
 * sang true nghĩa là VỪA BỊ NGƯỜI KHÁC cấp lại ngay trong lúc đang dùng
 * phiên này (mới đăng nhập bằng mật khẩu tạm thì cờ này đã true SẴN từ đầu
 * phiên rồi, không tính) — đăng xuất ngay, KHÔNG cho hiện màn "nhập mật khẩu
 * mới" trong phiên cũ nữa (khớp yêu cầu: phải đăng nhập lại từ đầu).
 */
export async function refreshSessionData() {
  if (!state || !state.session) return;
  const session = state.session;
  const active = document.activeElement;
  const isTypingOutsideModal = active && ['INPUT', 'TEXTAREA', 'SELECT'].includes(active.tagName) && !active.closest('.modal-overlay');
  const getSelf = () => (session.role === 'admin' ? getAdmin(session.id) : getCustomer(session.id));
  const wasMustChange = !!getSelf()?.mustChangePassword;
  const wasForceLogoutAt = getSelf()?.forceLogoutAt || null;
  try {
    if (session.role === 'admin') await loadAdminSessionData(session.sbToken);
    else await loadCustomerSessionData(session.id, session.sbToken);
  } catch (e) {
    console.warn('Không tự làm mới được dữ liệu, sẽ thử lại ở lần sau.', e);
    return;
  }
  if (!wasMustChange && getSelf()?.mustChangePassword) { logout(); return; }
  // "Đăng xuất use" (forceLogoutCustomer/forceLogoutStaff) — CÙNG cơ chế:
  // mốc thời gian đổi khác lần trước đã biết (kể cả từ null sang có giá trị,
  // hoặc đổi sang giá trị MỚI hơn nếu đã từng bị đăng xuất kiểu này trước đó
  // trong lịch sử tài khoản) nghĩa là VỪA bị buộc đăng xuất ngay trong lúc
  // đang dùng phiên này -> đăng xuất thật, không cần tải lại trang. Áp dụng
  // cho CẢ quản trị viên/nhân viên lẫn khách hàng (getSelf() tự đọc đúng
  // bảng theo session.role).
  const nowForceLogoutAt = getSelf()?.forceLogoutAt || null;
  if (nowForceLogoutAt && nowForceLogoutAt !== wasForceLogoutAt) { logout(); return; }
  if (isTypingOutsideModal) persist(); // lưu tạm, chưa vẽ lại ngay
  else notify();
}

/**
 * Kiểm tra NHẸ (chỉ 2 cột, đúng 1 dòng — KHÁC HẲN refreshSessionData() ở
 * trên vốn tải lại TOÀN BỘ dữ liệu phiên) xem CHÍNH mình vừa bị cấp lại mật
 * khẩu hay bị "Đăng xuất" ngay trong lúc đang dùng phiên này hay chưa — gọi
 * ĐỊNH KỲ mỗi vài giây (xem setInterval ở js/app.js) để 2 việc này TỰ BUNG
 * RA NGAY, không cần đợi người dùng quay lại tab/chuyển trang mới phát hiện
 * ra (khác refreshSessionData(), vốn CHỦ Ý chỉ chạy khi có tín hiệu quay lại
 * tab/chuyển trang, xem ghi chú ở startAutoRefresh() trong js/app.js).
 *
 * AN TOÀN để chạy định kỳ (không lặp lại lỗi "setInterval làm mất bộ lọc/
 * chữ đang gõ dở" đã từng gặp ở mục 10.22 trong docs/supabase-migration.md):
 * hàm này KHÔNG BAO GIỜ gọi persist()/notify() khi không có gì thay đổi —
 * chỉ đụng tới màn hình ĐÚNG lúc thật sự cần đăng xuất ngay (logout() gọi
 * notify() bên trong nó), nên không ảnh hưởng gì tới trang đang xem/đang gõ
 * trong mọi trường hợp khác.
 *
 * CHỈ đăng xuất khi thấy dấu hiệu bất thường ở 2 LƯỢT KIỂM TRA LIÊN TIẾP
 * (~5 giây/lượt, xem pendingForceLogoutSignal) — phòng hờ đăng xuất OAN do 1
 * lượt đọc dữ liệu hiếm khi bị lệch thoáng qua (VD: đúng lúc trùng thời điểm
 * refreshSessionData() đang thay hẳn state.admins/state.customers bằng dữ
 * liệu mới ở 1 tick riêng khác) — lệch thật do bị cấp lại mật khẩu/"Đăng
 * xuất" thì vẫn giữ nguyên qua 2 lượt liền, chỉ chậm thêm tối đa ~5 giây so
 * với bản chỉ kiểm tra 1 lượt.
 */
// Tín hiệu "có vẻ cần đăng xuất" thấy được ở lượt kiểm tra GẦN NHẤT (dạng
// chuỗi tóm tắt, xem checkForceLogout()) — CHỈ thật sự đăng xuất khi ĐÚNG
// tín hiệu này lặp lại ở lượt kế tiếp (~5 giây sau). Phòng hờ 1 lượt đọc dữ
// liệu "xui" thoáng qua (VD: đúng lúc trùng với refreshSessionData() đang
// tải lại state.admins/state.customers ở 1 tick khác) làm sai lệch 1 lần rồi
// tự đúng lại ngay sau đó — không nên đăng xuất oan chỉ vì 1 lần đọc lệch.
let pendingForceLogoutSignal = null;

/** So 2 mốc thời gian force_logout_at CÙNG Ý NGHĨA hay không, dùng Date thay vì so chuỗi trực tiếp — tránh báo "khác nhau" giả do lệch định dạng chuỗi (VD: độ chính xác phần giây/mili-giây) giữa 2 lần đọc khác cột chọn, dù cùng 1 giá trị thật trong CSDL. */
function sameInstant(a, b) {
  if (a === b) return true;
  if (!a || !b) return false;
  const ta = new Date(a).getTime();
  const tb = new Date(b).getTime();
  return Number.isFinite(ta) && Number.isFinite(tb) && ta === tb;
}

export async function checkForceLogout() {
  if (!state || !state.session) { pendingForceLogoutSignal = null; return; }
  const session = state.session;
  const table = session.role === 'admin' ? 'admins' : 'customers';
  const sb = getSupabaseClient(session.sbToken);
  let data;
  try {
    const res = await sb.from(table).select('must_change_password, force_logout_at').eq('id', session.id).maybeSingle();
    data = res.data;
  } catch (e) { return; } // mất mạng tạm thời -> im lặng, thử lại ở lượt sau
  if (!data) return;
  const getSelf = () => (session.role === 'admin' ? getAdmin(session.id) : getCustomer(session.id));
  const wasMustChange = !!getSelf()?.mustChangePassword;
  const wasForceLogoutAt = getSelf()?.forceLogoutAt || null;
  const nowForceLogoutAt = data.force_logout_at || null;
  const suspicious = (!wasMustChange && data.must_change_password) || (nowForceLogoutAt && !sameInstant(nowForceLogoutAt, wasForceLogoutAt));
  if (!suspicious) { pendingForceLogoutSignal = null; return; }
  const signal = `${session.id}:${!!data.must_change_password}:${nowForceLogoutAt}`;
  if (pendingForceLogoutSignal === signal) { pendingForceLogoutSignal = null; logout(); return; }
  pendingForceLogoutSignal = signal; // thấy lần đầu -> chờ đúng tín hiệu này lặp lại ở lượt kế tiếp mới đăng xuất thật
}

async function loadAdminSessionData(token) {
  const sb = getSupabaseClient(token);
  const [{ data: adminRows }, { data: customerRows }, { data: contractRows }, { data: requestRows }, pushRes, zaloCustRes, zaloListRes, zaloLogRes, chatUnreadRes, snapshotRes] = await Promise.all([
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
    // Tổng số tin nhắn hỗ trợ (chat) do KHÁCH HÀNG gửi mà CHƯA có ai trong
    // phạm vi quản lý đọc — dùng cho chấm đỏ ở mục menu "Hỗ trợ" (xem
    // js/components/shell.js renderSupportNavBadge). Bọc an toàn (giống
    // push_subscriptions) phòng lúc chưa chạy SQL tạo bảng chat_messages.
    sb.from('chat_messages').select('id', { count: 'exact', head: true }).eq('sender_role', 'customer').is('read_at', null).then((r) => r, () => ({ count: 0 })),
    // Số liệu chốt cuối mỗi tháng (dashboard "Tổng quan" — dư nợ/lãi phải
    // thu/nợ xấu theo tháng, xem mục 10.46 docs) — RLS chỉ trả về dữ liệu cho
    // quản trị viên toàn quyền (role='super'), nhân viên thường sẽ tự nhận
    // mảng rỗng (không phải lỗi) — không sao, dashboard này vốn CHỈ hiện cho
    // super (xem overview.js). Bọc an toàn phòng lúc chưa chạy SQL tạo bảng.
    sb.from('monthly_snapshots').select('*').order('year_month').then((r) => r, () => ({ data: [] })),
  ]);
  state.admins = (adminRows || []).map(mapAdminRow);
  state.customers = (customerRows || []).map(mapCustomerRow);
  state.contracts = (contractRows || []).map(mapContractRow);
  state.requests = (requestRows || []).map(mapRequestRow);
  state.monthlySnapshots = (snapshotRes?.data || []).map(mapMonthlySnapshotRow);
  // Mảng thường (KHÔNG phải Set) — state được JSON.stringify() vào
  // localStorage mỗi lần persist()/notify(), Set sẽ bị mất sạch dữ liệu khi
  // serialize (JSON.stringify(new Set(...)) ra "{}"), lần tải lại từ cache sẽ
  // gọi .has() trên object thường và văng lỗi ngay khi vẽ trang.
  state.pushSubscribedCustomerIds = [...new Set((pushRes?.data || []).map((r) => r.owner_id))];
  state.zaloCustomers = (zaloCustRes?.data || []).map(mapZaloCustomerRow);
  state.zaloAutoSendList = (zaloListRes?.data || []).map(mapZaloAutoSendRow);
  state.zaloSendLog = (zaloLogRes?.data || []).map(mapZaloSendLogRow);
  state.chatUnreadCount = chatUnreadRes?.count || 0;
}

function mapMonthlySnapshotRow(row) {
  return {
    yearMonth: row.year_month, snapshotDate: row.snapshot_date,
    totalBalance: Number(row.total_balance) || 0,
    interestReceivable: Number(row.interest_receivable) || 0,
    groupBalances: row.group_balances || {},
    badDebtBalance: Number(row.bad_debt_balance) || 0,
    badDebtRatio: Number(row.bad_debt_ratio) || 0,
  };
}
/** Danh sách số liệu đã chốt theo tháng, sắp xếp từ CŨ -> MỚI (khớp thứ tự vẽ biểu đồ theo thời gian) — dùng cho dashboard "Tổng quan" (chỉ super admin, xem overview.js). */
export function listMonthlySnapshots() { return state.monthlySnapshots || []; }

/**
 * Chốt số liệu THÁNG NÀY ngay bây giờ (không cần đợi đúng ngày cuối tháng) —
 * gọi qua Edge Function create-account (type 'capture-monthly-snapshot',
 * CHỈ super admin gọi được, server tự kiểm tra lại quyền). Tính lại và GHI
 * ĐÈ (upsert theo year_month) — bấm nhiều lần trong cùng 1 tháng chỉ cập
 * nhật đúng 1 dòng của tháng đó, không tạo trùng. Lịch tự động (đúng ngày
 * cuối tháng, xem send-due-reminders) vẫn chạy song song, không đụng nhau.
 */
export async function captureMonthlySnapshotNow() {
  const session = state.session;
  const res = await callCreateAccountFunction(session?.sbToken, { type: 'capture-monthly-snapshot' });
  if (res.ok) { await loadAdminSessionData(session.sbToken); notify(); }
  return res;
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
    salt: row.salt, hash: row.hash, mustChangePassword: !!row.must_change_password,
    forceLogoutAt: row.force_logout_at || null, createdAt: row.created_at,
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
/**
 * Sửa tên hiển thị của 1 tài khoản quản trị viên/nhân viên (KỂ CẢ chính
 * mình đang đăng nhập) — CHỈ quản trị viên toàn quyền gọi được (xem
 * SUPER_ONLY_TYPES trong create-account/index.ts). Thêm để sửa tên các tài
 * khoản còn để tên chung chung kiểu "Quản trị viên" (VD: tài khoản khởi tạo
 * ban đầu) — Nhật ký sử dụng (mục 10.35) hiển thị đúng tên này, sửa lại ở
 * đây là Nhật ký tự hiện đúng tên thật ngay từ lần ghi tiếp theo (không sửa
 * lại được các dòng đã ghi TRƯỚC đó, vì admin_name là ảnh chụp tại đúng lúc
 * ghi, không tự đổi theo).
 */
export async function updateStaffName(id, name) {
  const a = getAdmin(id);
  if (!a) return;
  const trimmed = String(name || '').trim();
  if (!trimmed) throw new Error('Tên không được để trống.');
  const session = getSession();
  const res = await callCreateAccountFunction(session?.sbToken, { type: 'update-staff-name', staffId: id, name: trimmed });
  if (!res.ok) throw new Error(res.reason || 'Không sửa được tên.');
  a.name = trimmed;
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

/**
 * Đăng xuất NGAY 1 quản trị viên/nhân viên đang có phiên đăng nhập ở đâu đó
 * — KHÔNG cấp lại mật khẩu (khác resetStaffPassword ở trên). Cùng cơ chế tự
 * phát hiện của forceLogoutCustomer() (xem refreshSessionData()) — CHỈ quản
 * trị viên toàn quyền mới gọi được (khớp đúng quyền của reset-staff-password
 * ở server, vì tài khoản Quản trị viên/nhân viên vốn chỉ do super quản lý).
 */
export async function forceLogoutStaff(id) {
  const a = getAdmin(id);
  if (!a) throw new Error('Không tìm thấy tài khoản');
  const session = getSession();
  const res = await callCreateAccountFunction(session?.sbToken, { type: 'force-logout-staff', staffId: id });
  if (!res.ok) throw new Error(res.reason || 'Không đăng xuất được tài khoản này.');
  a.forceLogoutAt = new Date().toISOString();
  notify();
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
  logAdminAction('update-request-status', { requestId: id });
}
function mapRequestRow(row) {
  return {
    id: row.id, customerId: row.customer_id, type: row.type, amount: row.amount,
    purpose: row.purpose || '', termMonths: row.term_months, note: row.note || '',
    status: row.status, createdAt: row.created_at, readAt: row.read_at || null,
  };
}

/**
 * Số yêu cầu tư vấn CHƯA ĐỌC trong phạm vi của adminId — dùng cho chấm đỏ ở
 * tab "Tư vấn" và mục menu "Hỗ trợ" gộp chung (xem js/views/admin/support.js,
 * js/components/shell.js). "Chưa đọc" = read_at còn rỗng — tự đánh dấu đã
 * đọc ngay khi admin VÀO XEM tab "Tư vấn" (xem markAllRequestsRead() bên
 * dưới), vì danh sách đã hiện sẵn TRỌN VẸN nội dung từng yêu cầu (không như
 * chat, chỉ hiện xem trước — phải mở hẳn 1 hội thoại mới coi là "đã đọc").
 */
export function countUnreadRequests(adminId) {
  // Yêu cầu đã chuyển "Đã liên hệ" (xử lý xong) KHÔNG tính vào đây nữa dù
  // chưa từng "đọc" — coi như xong việc thì thôi báo, khớp đúng cách "Yêu
  // cầu mới nhất" ở Tổng quan cũng tự ẩn các yêu cầu đã xử lý xong.
  let list = state.requests.filter((r) => !r.readAt && r.status !== 'da_lien_he');
  const admin = getAdmin(adminId);
  if (admin && admin.role === 'staff') {
    const allowedIds = new Set(listCustomers({ adminId }).map((c) => c.id));
    list = list.filter((r) => allowedIds.has(r.customerId));
  }
  return list.length;
}

/** Đánh dấu TOÀN BỘ yêu cầu tư vấn CHƯA XỬ LÝ XONG (trong đúng phạm vi Thôn/Xóm của adminId, kể cả đang lọc theo trạng thái nào) là đã đọc — gọi mỗi khi tab "Hỗ trợ" (yêu cầu tư vấn) hiện ra, để chấm đỏ tự tắt ngay lúc admin thật sự nhìn thấy danh sách. */
export async function markAllRequestsRead(adminId) {
  let unread = state.requests.filter((r) => !r.readAt && r.status !== 'da_lien_he');
  const admin = getAdmin(adminId);
  if (admin && admin.role === 'staff') {
    const allowedIds = new Set(listCustomers({ adminId }).map((c) => c.id));
    unread = unread.filter((r) => allowedIds.has(r.customerId));
  }
  if (!unread.length) return;
  const session = getSession();
  const sb = getSupabaseClient(session?.sbToken);
  const { error } = await sb.from('requests').update({ read_at: new Date().toISOString() }).in('id', unread.map((r) => r.id));
  if (error) return; // im lặng, thử lại ở lượt sau — không chặn/báo lỗi gì cho người dùng vì đây chỉ là chấm đỏ, không phải thao tác họ chủ động bấm
  const now = new Date().toISOString();
  unread.forEach((r) => { r.readAt = now; });
  notify();
}

// ------------------------------------------------------------
// Chat hỗ trợ — khách hàng hỏi, quản trị viên toàn quyền HOẶC nhân viên có
// quyền "Quản lý User" trả lời (xem docs/supabase-migration.md mục 10.24).
// Ghi thẳng qua RLS (không cần Edge Function, giống bảng "requests") — mỗi
// tin nhắn là 1 dòng trong bảng chat_messages, "hội thoại" = toàn bộ tin
// nhắn cùng 1 customer_id. KHÔNG tải vào state chung như các bảng khác (xem
// loadAdminSessionData/loadCustomerSessionData) vì cần polling RIÊNG, CHỈ
// khi khung chat đang mở (xem js/components/chatPanel.js) — các hàm dưới
// đây được gọi trực tiếp theo yêu cầu, không phải lúc nào cũng có trong bộ
// nhớ cache.
// ------------------------------------------------------------
function mapChatMessageRow(row) {
  return {
    id: row.id, customerId: row.customer_id, senderRole: row.sender_role,
    senderAdminId: row.sender_admin_id || null, message: row.message,
    createdAt: row.created_at, readAt: row.read_at || null,
  };
}

/** Toàn bộ tin nhắn của 1 khách hàng, CŨ -> MỚI — dùng cho khung chat (khách tự xem hội thoại của mình, hoặc admin xem hộ hội thoại của khách đó). */
export async function listChatMessages(customerId) {
  const session = getSession();
  const sb = getSupabaseClient(session?.sbToken);
  const { data, error } = await sb.from('chat_messages').select('*').eq('customer_id', customerId).order('created_at', { ascending: true });
  if (error) throw new Error('Không tải được tin nhắn, thử lại sau.');
  return (data || []).map(mapChatMessageRow);
}

/** Gửi 1 tin nhắn vào hội thoại của customerId — khách hàng CHỈ gửi được cho CHÍNH MÌNH (RLS tự chặn gửi hộ người khác), admin gửi được cho khách bất kỳ trong phạm vi quản lý. */
export async function sendChatMessage(customerId, message) {
  const session = getSession();
  const text = String(message || '').trim();
  if (!text) throw new Error('Chưa nhập nội dung.');
  const sb = getSupabaseClient(session?.sbToken);
  const row = {
    id: genId('chat'), customer_id: customerId,
    sender_role: session.role === 'admin' ? 'admin' : 'customer',
    sender_admin_id: session.role === 'admin' ? session.id : null,
    message: text,
  };
  const { error } = await sb.from('chat_messages').insert(row);
  if (error) throw new Error('Không gửi được tin nhắn, thử lại sau.');
  logAdminAction('reply-chat', { customerId }); // tự bỏ qua nếu người gửi là khách hàng (xem logAdminAction())
  return mapChatMessageRow({ ...row, created_at: new Date().toISOString(), read_at: null });
}

/**
 * Đánh dấu đã đọc mọi tin nhắn CỦA PHÍA BÊN KIA (chưa đọc) trong 1 hội thoại
 * — gọi mỗi khi khung chat đang mở/vừa tải lại tin mới. `.select('id')` để
 * biết CHÍNH XÁC vừa đánh dấu đọc bao nhiêu dòng — nhờ đó trừ thẳng vào
 * state.chatUnreadCount (đang cache trong bộ nhớ, dùng chung cho chấm đỏ nút
 * chat nổi/mục menu "Hỗ trợ", xem js/components/shell.js) rồi notify() NGAY,
 * để chấm đỏ tắt NGAY LÚC xem xong — KHÔNG phải đợi tới lần
 * refreshSessionData() kế tiếp (đổi tab/chuyển trang) mới cập nhật.
 */
export async function markChatRead(customerId) {
  const session = getSession();
  if (!session) return;
  const otherRole = session.role === 'admin' ? 'customer' : 'admin';
  const sb = getSupabaseClient(session.sbToken);
  const { data } = await sb.from('chat_messages').update({ read_at: new Date().toISOString() })
    .eq('customer_id', customerId).eq('sender_role', otherRole).is('read_at', null)
    .select('id');
  if (!data || !data.length) return; // không có gì mới để đánh dấu -> khỏi notify() thừa
  state.chatUnreadCount = Math.max(0, (state.chatUnreadCount || 0) - data.length);
  notify();
}

/**
 * Danh sách hội thoại cho trang "Hỗ trợ" (admin) — nhóm theo customer_id từ
 * tối đa 500 tin nhắn gần nhất (đủ dùng cho quy mô 1 quỹ tín dụng, tránh tải
 * cả lịch sử chat không giới hạn mỗi lần mở trang, giống cách zalo_send_log
 * giới hạn 200 dòng gần nhất). Mỗi phần tử: { customerId, lastMessage, lastAt,
 * lastSenderRole, unreadCount } — unreadCount đếm đúng tin CHƯA ĐỌC do KHÁCH
 * gửi (khớp đúng phía admin cần trả lời, không tính tin admin tự gửi).
 */
export async function listChatConversations() {
  const session = getSession();
  const sb = getSupabaseClient(session?.sbToken);
  const { data, error } = await sb.from('chat_messages').select('*').order('created_at', { ascending: false }).limit(500);
  if (error) throw new Error('Không tải được danh sách hội thoại, thử lại sau.');
  const map = new Map();
  for (const row of (data || [])) {
    const m = mapChatMessageRow(row);
    let conv = map.get(m.customerId);
    if (!conv) {
      // Dòng ĐẦU TIÊN gặp cho 1 customerId (do đã sắp created_at giảm dần)
      // chính là tin nhắn MỚI NHẤT của hội thoại đó.
      conv = { customerId: m.customerId, lastMessage: m.message, lastAt: m.createdAt, lastSenderRole: m.senderRole, unreadCount: 0 };
      map.set(m.customerId, conv);
    }
    if (m.senderRole === 'customer' && !m.readAt) conv.unreadCount++;
  }
  return [...map.values()].sort((a, b) => new Date(b.lastAt) - new Date(a.lastAt));
}

// ------------------------------------------------------------
// Nhật ký sử dụng (activity_log) — CHỈ quản trị viên toàn quyền (role=
// 'super') xem được, RLS đã chặn hẳn ở tầng database (không chỉ ẩn trên
// giao diện) — xem docs/supabase-migration.md mục 10.33. KHÔNG tải sẵn vào
// state lúc đăng nhập (khác requests/chat, vốn ít và cần cho chấm đỏ ngay) —
// nhật ký có thể dài dần theo thời gian, chỉ tải khi thật sự mở trang, có
// phân trang "Tải thêm".
// ------------------------------------------------------------
function mapActivityLogRow(row) {
  return {
    id: row.id, adminId: row.admin_id, adminName: row.admin_name,
    action: row.action, description: row.description, createdAt: row.created_at,
  };
}
/**
 * Lấy 1 trang nhật ký, mới nhất trước — truyền `before` (createdAt của dòng
 * cuối trang đã tải) để tải tiếp trang kế ("Tải thêm"). Ghi bằng Edge
 * Function (service role) nên chỉ có ĐỌC ở đây — không có hàm ghi phía
 * client (xem logActivity() trong supabase/functions/create-account/index.ts).
 */
export async function listActivityLog({ before, limit = 100 } = {}) {
  const session = getSession();
  const sb = getSupabaseClient(session?.sbToken);
  let q = sb.from('activity_log').select('*').order('created_at', { ascending: false }).limit(limit);
  if (before) q = q.lt('created_at', before);
  const { data, error } = await q;
  if (error) throw new Error('Không tải được nhật ký, thử lại sau.');
  return (data || []).map(mapActivityLogRow);
}

/**
 * Ghi 1 dòng vào Nhật ký sử dụng cho thao tác KHÔNG tự có chỗ ghi log qua
 * Edge Function khác (VD: xem chi tiết khách hàng/hợp đồng, lọc danh sách,
 * trả lời chat, cập nhật trạng thái yêu cầu — những việc này ghi thẳng qua
 * RLS hoặc chỉ là đọc dữ liệu, không đi qua "cửa" nào của create-account để
 * server tự biết mà ghi) — xem type 'log-admin-action' trong
 * supabase/functions/create-account/index.ts. CHẠY NGẦM, KHÔNG throw/chặn
 * UI — chỉ để lưu lại nhật ký, không phải thao tác chính người dùng đang chờ
 * kết quả. Tự bỏ qua nếu không phải phiên quản trị viên (nhật ký chỉ theo
 * dõi quản trị viên/nhân viên, không theo dõi khách hàng).
 */
export function logAdminAction(action, extra = {}) {
  const session = getSession();
  if (!session || session.role !== 'admin') return;
  callCreateAccountFunction(session.sbToken, { type: 'log-admin-action', action, ...extra }).catch(() => {});
}

// ------------------------------------------------------------
// Session (đăng nhập hiện tại)
// ------------------------------------------------------------
export function getSession() { return state.session; }
export function setSession(session) { state.session = session; notify(); }

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

  state = { org, admins, customers, contracts, requests, session: null, pushSubscribedCustomerIds: [], zaloCustomers: [], zaloAutoSendList: [], zaloSendLog: [], chatUnreadCount: 0 };
}
