// Edge Function GỘP CHUNG (1 function duy nhất, đỡ phải deploy nhiều chỗ) —
// xử lý: đăng nhập, tạo/xóa/sửa tài khoản khách hàng & quản trị viên, và
// nhập dữ liệu Excel. Toàn bộ logic nhạy cảm (băm/so mật khẩu, cấp JWT, ghi
// database) chạy Ở ĐÂY (server), KHÔNG chạy trong trình duyệt — dùng
// service_role key không lộ ra ngoài. Xem docs/supabase-migration.md.
//
// Cách gọi: POST body luôn có field "type":
//   { type: 'login', role: 'customer'|'admin', identifier, password }
//     -> PHẢI gọi trước để lấy JWT — không cần JWT sẵn có.
//   { type: 'forgot-password', cccd, phone } -> khách quên mật khẩu, KHÔNG
//     cần JWT sẵn có — khớp đúng CCCD+SĐT thì ghi 1 yêu cầu "quen_mat_khau"
//     vào bảng requests để admin gọi điện xác minh + cấp lại mật khẩu.
//   { type: 'verify-own-password', password } / { type: 'set-own-password',
//     newPassword, mustChangePassword? } -> tự đổi mật khẩu CHÍNH MÌNH, cần
//     JWT hợp lệ (khách hàng hoặc admin đều được, KHÔNG cần role='super').
//   { type: 'save-push-subscription', endpoint, p256dh, auth } / { type:
//     'delete-push-subscription', endpoint } -> tự bật/tắt thông báo đẩy cho
//     CHÍNH MÌNH, cần JWT hợp lệ (không cần role='super'). Việc GỬI thông
//     báo định kỳ nằm ở Edge Function riêng "send-due-reminders".
//   { type: 'customer-logout' } -> khách hàng bấm "Đăng xuất", cần JWT hợp
//     lệ — tắt cờ is_online NGAY để 2 chấm trạng thái ở trang admin chuyển
//     sang "chưa đăng nhập" ngay lập tức, không cần đợi hết hạn phiên.
//   { type: 'send-manual-notification', customerId, title, body } -> BẤT KỲ
//     admin/nhân viên nào (không cần role='super') tự soạn + gửi ngay 1
//     thông báo đẩy cho 1 khách hàng (khách phải đã bật thông báo trên ít
//     nhất 1 thiết bị). Nhân viên (role='staff') CHỈ gửi được cho khách
//     trong đúng phạm vi Thôn/Xóm được gán — y hệt điều kiện RLS bảng
//     customers, xem docs/supabase-migration.md mục 5b.
//   { type: 'add-zalo-customer', customerId } / { type: 'remove-zalo-customer',
//     customerId } -> Tầng 1 "Danh sách đã thêm vào OA" — DANH SÁCH CHUNG,
//     ai có canManageZaloOA/super cũng thêm/bỏ được (trong đúng Thôn/Xóm).
//   { type: 'add-zalo-auto-send', contractId, kind? ('lai_hang_thang_auto'
//     mặc định | 'lai_hang_thang_custom_day'), customDay?, intervalMonths?
//     (1-4, mặc định 1 = hàng tháng) } / { type: 'remove-zalo-auto-send', id }
//     / { type: 'update-zalo-auto-send-settings', id, customDay?,
//     intervalMonths? } -> Tầng 2 "Gửi tin tự động" — CHỈ còn 2 mục báo lãi
//     (KHÔNG còn 'đến hạn' — đến hạn giờ tự động theo Tầng 1, xem
//     send-due-reminders/index.ts), loại trừ nhau (1 hợp đồng chỉ ở 1 trong
//     2 mục). intervalMonths cho phép báo mỗi 2/3/4 tháng thay vì tháng nào
//     cũng báo — áp dụng cho CẢ 2 mục. RIÊNG TƯ theo từng người chọn (chỉ
//     người tự thêm mới xóa/sửa được lựa chọn của mình; add tự đảm bảo
//     khách đã ở Tầng 1, trùng hợp đồng với người khác thì bị chặn kèm tên
//     người đã chọn + mục họ chọn).
//   { type: 'send-zalo-manual', contractId } -> gửi tay ngay 1 khách, TỰ
//     CHỌN MẪU theo tình huống hợp đồng (gần/đã đến hạn dùng mẫu Đến hạn,
//     còn xa hạn dùng mẫu Báo lãi) — không cần tự chọn templateId nữa. BẮT
//     BUỘC khách đã có sẵn trong Tầng 1 "Danh sách OA" (KHÔNG còn tự thêm
//     ngầm lúc gửi như trước — chưa có thì báo lỗi, phải tự thêm trước qua
//     nút "Thêm vào OA" ở chi tiết khách hàng). Giới hạn 5 NGÀY mới gửi tay
//     lại được cho cùng 1 hợp đồng (tính theo lần gửi thành công gần nhất,
//     bất kể tự động hay gửi tay), báo rõ đã gửi ngày nào nếu còn trong hạn
//     chờ. Cần cờ RIÊNG canManageZaloOA (không dùng chung canManageUsers)
//     HOẶC role='super'. Nhân viên staff chỉ thao tác được hợp đồng/khách
//     trong đúng phạm vi Thôn/Xóm được gán — xem docs/supabase-migration.md
//     mục 10.
//   Tất cả các "type" còn lại BẮT BUỘC header Authorization: Bearer <JWT>
//   của 1 admin đã đăng nhập (xác minh lại tại server, không tin JWT mù) —
//   2 nhóm quyền khác nhau:
//   - CHỈ role='super' (toàn quyền) mới gọi được — gồm MỌI thao tác đụng đến
//     tài khoản QUẢN TRỊ VIÊN/nhân viên (tạo/xóa/đổi vai trò/đổi quyền/cấp
//     lại mật khẩu), không có ngoại lệ cho canManageUsers: nhân viên "chỉ
//     xem" được cấp cờ này CHỈ quản lý được Use KHÁCH HÀNG, không được đụng
//     tới tài khoản Quản trị viên nào khác (kể cả nhân viên chỉ xem khác):
//     { type: 'update-customer-profile', cccd, name?, phone?, address? }
//     { type: 'delete-contract', contractId }
//     { type: 'import', fullSync, rows: [...] } — nhập Excel/dán tay hàng loạt
//     { type: 'update-staff-role', staffId, role } — đổi Toàn quyền <-> Chỉ
//       xem cho 1 tài khoản đã có sẵn (giữ lại ít nhất 1 toàn quyền)
//     { type: 'staff', username, name?, password?, role, allowedThon?, allowedXom?, canManageUsers? }
//     { type: 'reset-staff-password', staffId, password? }
//     { type: 'force-logout-staff', staffId } — đăng xuất ngay, KHÔNG cấp lại mật khẩu
//     { type: 'update-staff-permissions', staffId, allowedThon?, allowedXom?, canManageUsers?, canManageZaloOA? }
//     { type: 'delete-staff', staffId }
//   - role='super' HOẶC nhân viên "chỉ xem" được cấp cờ canManageUsers=true
//     đều gọi được — CHỈ giới hạn trong phạm vi Use KHÁCH HÀNG:
//     { type: 'customer', cccd, name?, phone?, password? }
//     { type: 'reset-customer-password', customerId, password? }
//     { type: 'force-logout-customer', customerId } — đăng xuất ngay, KHÔNG cấp lại mật khẩu
//     { type: 'deactivate-customer', customerId }
//     { type: 'delete-customer', customerId }
// password bỏ trống thì tự sinh mật khẩu tạm ngẫu nhiên (trả về trong response).

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
// @ts-ignore — thư viện Node "web-push" chạy được trên Deno qua npm: specifier (Supabase Edge Runtime hỗ trợ sẵn). Dùng chung VAPID secret với send-due-reminders (đã đặt sẵn ở project, không cần thêm secret mới).
import webpush from 'npm:web-push@3.6.7';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const JWT_SECRET = Deno.env.get('CUSTOM_JWT_SECRET')!;
const VAPID_PUBLIC_KEY = Deno.env.get('VAPID_PUBLIC_KEY') || '';
const VAPID_PRIVATE_KEY = Deno.env.get('VAPID_PRIVATE_KEY') || '';
const VAPID_SUBJECT = Deno.env.get('VAPID_SUBJECT') || 'mailto:admin@example.com';
if (VAPID_PUBLIC_KEY && VAPID_PRIVATE_KEY) webpush.setVapidDetails(VAPID_SUBJECT, VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY);
// Zalo OA (ZBS Template Message) — dùng cho gửi tay 1 khách ngay tại đây
// (type 'send-zalo-manual'), Y HỆT cặp secret đã đặt cho send-due-reminders
// (gửi tự động theo lịch) — xem docs/supabase-migration.md mục 10.
const ZALO_APP_ID = Deno.env.get('ZALO_APP_ID') || '';
const ZALO_SECRET_KEY = Deno.env.get('ZALO_SECRET_KEY') || '';

const LOCK_AFTER_FAILS = 5;
const LOCK_MINUTES = 15;
// Phiên đăng nhập (JWT tự ký) KHÔNG còn tự động hết hạn theo thời gian nữa
// (bỏ hẳn theo yêu cầu — trước lần lượt là 8 tiếng rồi 1 năm, giờ bỏ luôn
// mốc thời gian, xem signJwt()/verifyJwt() bên dưới: token không còn field
// "exp"). Đăng nhập 1 lần là duy trì mãi mãi, chỉ hết khi khách/nhân viên tự
// bấm "Đăng xuất" hoặc tự xóa dữ liệu trình duyệt. Đánh đổi: JWT bị lộ (máy
// bị mất/lộ) thì dùng được vĩnh viễn — chấp nhận được với quy mô app này
// (không có cơ chế thu hồi token/refresh token riêng). Đổi mật khẩu KHÔNG tự
// vô hiệu hóa JWT cũ đang có sẵn.

const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { ...CORS, 'Content-Type': 'application/json' } });
}

// ---------- Mật khẩu — GIỐNG HỆT thuật toán trong js/state.js ----------
async function sha256Hex(text: string): Promise<string> {
  const data = new TextEncoder().encode(text);
  const digest = await crypto.subtle.digest('SHA-256', data);
  return Array.from(new Uint8Array(digest)).map((b) => b.toString(16).padStart(2, '0')).join('');
}
function randomHex(bytes: number): string {
  const arr = crypto.getRandomValues(new Uint8Array(bytes));
  return Array.from(arr).map((b) => b.toString(16).padStart(2, '0')).join('');
}
function genTempPassword(): string {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789';
  const arr = crypto.getRandomValues(new Uint8Array(8));
  return Array.from(arr).map((b) => chars[b % chars.length]).join('');
}
async function makeCredential(plainPassword: string): Promise<{ salt: string; hash: string }> {
  const salt = randomHex(8);
  const hash = await sha256Hex(salt + ':' + plainPassword);
  return { salt, hash };
}
async function verifyCredential(password: string, salt: string, hash: string): Promise<boolean> {
  return (await sha256Hex(salt + ':' + password)) === hash;
}
function genId(prefix: string): string {
  return `${prefix}_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
}
/** Y hệt REQUEST_STATUS_MAP trong js/state.js — chỉ dùng để soạn mô tả nhật ký (type 'log-admin-action'/'update-request-status'), không phải nguồn dữ liệu chính. */
const REQUEST_STATUS_LABELS: Record<string, string> = { moi: 'Mới', dang_xu_ly: 'Đang xử lý', da_lien_he: 'Đã liên hệ' };
/** Escape ký tự đặc biệt của LIKE/ILIKE ("%", "_", "\\") trước khi đưa vào ilike() — tránh username chứa các ký tự này bị hiểu nhầm thành wildcard. */
function escapeLike(s: string): string {
  return s.replace(/[\\%_]/g, (c) => '\\' + c);
}
function addDaysISO(iso: string, n: number): string {
  const dt = new Date(iso);
  dt.setDate(dt.getDate() + n);
  return dt.toISOString().slice(0, 10);
}

/**
 * Ghi 1 dòng vào nhật ký sử dụng (bảng activity_log) — CHỈ quản trị viên
 * toàn quyền (role='super') xem được (RLS chặn hẳn ở tầng database, không
 * chỉ ẩn trên giao diện — xem docs/supabase-migration.md mục 10.33). Ghi
 * bằng service role (client `admin` ở trên, bỏ qua RLS) nên LUÔN ghi được
 * bất kể người thao tác là ai. CÓ ĐỢI ghi xong (không chạy ngầm kiểu
 * "fire-and-forget" như zalo_send_log) — vì đây là nhật ký AN TOÀN/ĐỐI
 * SOÁT, cần chắc chắn ghi được chứ không ưu tiên tốc độ như lúc gửi Zalo;
 * các hành động được ghi log ở đây (tạo/xóa tài khoản, xóa hợp đồng, nhập
 * Excel...) vốn đã không phải thao tác cần phản hồi tức thì như gửi tin.
 * KHÔNG chặn luồng chính nếu ghi log lỗi (chỉ log ra console) — 1 lỗi ghi
 * nhật ký không được phép làm hỏng thao tác THẬT của người dùng.
 */
async function logActivity(adminId: string, adminName: string, action: string, description: string): Promise<void> {
  try {
    await admin.from('activity_log').insert({ id: genId('log'), admin_id: adminId, admin_name: adminName, action, description });
  } catch (e) {
    console.error('Lỗi ghi activity_log:', e);
  }
}

/** Y hệt parseAddress trong js/state.js. */
function parseAddress(raw: string) {
  const text = String(raw || '').trim();
  const withoutNote = text.replace(/\([^)]*\)/g, '');
  const parts = withoutNote.split(',').map((s) => s.trim()).filter(Boolean);
  const result = { xom: '', thon: '', xa: '', tinh: '' } as Record<string, string>;
  const rest: string[] = [];
  let currentField: string | null = null;
  for (const p of parts) {
    const low = p.toLowerCase();
    let field: string | null = null;
    if (low.startsWith('xóm') || low.startsWith('xom')) field = 'xom';
    else if (low.startsWith('thôn') || low.startsWith('thon')) field = 'thon';
    else if (low.startsWith('xã') || low.startsWith('xa ') || low.startsWith('phường') || low.startsWith('thị trấn') || low.startsWith('huyện')) field = 'xa';
    else if (low.startsWith('tỉnh') || low.startsWith('tp') || low.startsWith('thành phố')) field = 'tinh';

    if (field) { result[field] = p; currentField = field; }
    else if (currentField) result[currentField] += ', ' + p;
    else rest.push(p);
  }
  if (!result.tinh && parts.length) result.tinh = parts[parts.length - 1];
  if (!result.xa && rest.length) result.xa = rest.shift()!;
  if (!result.thon && parts.length >= 2) result.thon = parts[1];
  if (!result.xom && parts.length >= 1) result.xom = parts[0];
  return result;
}

// ---------- JWT tự ký/tự xác minh (không dùng Supabase Auth/auth.users thật) ----------
function base64url(input: Uint8Array | string): string {
  const bytes = typeof input === 'string' ? new TextEncoder().encode(input) : input;
  let str = '';
  for (const b of bytes) str += String.fromCharCode(b);
  return btoa(str).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
function base64urlDecode(str: string): Uint8Array {
  const padded = str.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - (str.length % 4)) % 4);
  const bin = atob(padded);
  return Uint8Array.from(bin, (c) => c.charCodeAt(0));
}
async function signJwt(payload: Record<string, unknown>): Promise<string> {
  const header = { alg: 'HS256', typ: 'JWT' };
  const encHeader = base64url(JSON.stringify(header));
  const encPayload = base64url(JSON.stringify(payload));
  const toSign = `${encHeader}.${encPayload}`;
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(JWT_SECRET), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const sigBuf = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(toSign));
  return `${toSign}.${base64url(new Uint8Array(sigBuf))}`;
}
async function verifyJwt(token: string): Promise<Record<string, any> | null> {
  const parts = token.split('.');
  if (parts.length !== 3) return null;
  const [encHeader, encPayload, encSig] = parts;
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(JWT_SECRET), { name: 'HMAC', hash: 'SHA-256' }, false, ['verify']);
  const ok = await crypto.subtle.verify('HMAC', key, base64urlDecode(encSig), new TextEncoder().encode(`${encHeader}.${encPayload}`));
  if (!ok) return null;
  const payload = JSON.parse(new TextDecoder().decode(base64urlDecode(encPayload)));
  // Không còn tự động hết hạn theo thời gian nữa (bỏ theo yêu cầu — "duy trì
  // đăng nhập", không bắt đăng nhập lại) — JWT cấp ra (xem 'login' bên dưới)
  // KHÔNG còn field "exp" nữa nên payload.exp luôn undefined, chỉ còn xác
  // minh đúng chữ ký (ok ở trên). CHỈ khi nào exp CÓ MẶT (JWT cũ cấp từ
  // trước lúc đổi, vẫn còn "exp") mới kiểm tra hết hạn như trước, để không
  // làm hỏng phiên đăng nhập đang có sẵn của khách/nhân viên.
  if (payload.exp && payload.exp < Math.floor(Date.now() / 1000)) return null;
  return payload;
}

// ------------------------------------------------------------
// Zalo OA (ZBS Template Message) — Y HỆT logic trong send-due-reminders/index.ts
// (function riêng, không chia sẻ code được giữa 2 Edge Function nên phải chép
// lại) — dùng cho type 'send-zalo-manual' (gửi tay ngay 1 khách từ màn hình
// chi tiết hợp đồng).
// ------------------------------------------------------------
function daysBetweenZalo(a: Date, b: Date): number {
  const sa = new Date(a); sa.setHours(0, 0, 0, 0);
  const sb = new Date(b); sb.setHours(0, 0, 0, 0);
  return Math.round((sb.getTime() - sa.getTime()) / 86400000);
}
function effectiveStatusZalo(contract: any, asOf: Date): 'da_tat_toan' | 'qua_han' | 'dang_vay' {
  if ((contract.balance || 0) <= 0) return 'da_tat_toan';
  if (daysBetweenZalo(new Date(contract.due_date), asOf) > 0) return 'qua_han';
  return 'dang_vay';
}
// Y HỆT NEAR_DUE_DAYS trong js/state.js — dùng để quyết định gửi tay (mục
// 'send-zalo-manual') nên dùng mẫu "Đến hạn" hay mẫu "Báo lãi": còn xa hạn
// (> 15 ngày) thì dùng mẫu Báo lãi, gần/đã đến hạn thì dùng mẫu Đến hạn.
const NEAR_DUE_DAYS_ZALO = 15;
function isNearOrPastDueZalo(contract: any, asOf: Date): boolean {
  const d = daysBetweenZalo(asOf, new Date(contract.due_date));
  return d <= NEAR_DUE_DAYS_ZALO; // <=0 nghĩa là đã đến/quá hạn, 1..15 là gần đến hạn
}
function interestDaysAccruedZalo(contract: any, asOf: Date): number {
  const paidUntil = contract.interest_paid_until || contract.disbursed_date;
  let days = daysBetweenZalo(new Date(paidUntil), asOf);
  if (contract.disbursed_date && daysBetweenZalo(new Date(contract.disbursed_date), new Date(paidUntil)) === 1) days += 1;
  return Math.max(0, days);
}
function accruedInterestZalo(contract: any, asOf: Date): number {
  if (effectiveStatusZalo(contract, asOf) === 'da_tat_toan') return 0;
  const days = interestDaysAccruedZalo(contract, asOf);
  const raw = Number(contract.balance) * days * (Number(contract.interest_rate) / 100) / 365;
  return Math.round(raw / 1000) * 1000;
}
function formatDateVNZalo(iso: string): string {
  const d = new Date(iso);
  return `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}/${d.getFullYear()}`;
}
/**
 * Định dạng số tiền cho MỌI tham số tiền trong mẫu Zalo OA — CHỈ chuỗi chữ
 * số thuần, không dấu chấm ngăn hàng nghìn, không chữ "đ", y hệt
 * send-due-reminders/index.ts — xem ghi chú đầy đủ ở đó.
 */
function formatVNDZaloTemplate(n: number): string {
  return String(Math.round(n));
}
/** Y HỆT stripDiacritics() trong js/utils.js — bỏ dấu tiếng Việt, in hoa, bỏ ký tự lạ, dùng cho nội dung chuyển khoản. */
function stripDiacriticsUpper(str: string): string {
  return str
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/đ/g, 'd').replace(/Đ/g, 'D')
    .replace(/\s*₫/g, 'd')
    .toUpperCase()
    .replace(/[^A-Z0-9 ]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}
function normalizeZaloPhone(phone: string): string {
  const digits = String(phone || '').replace(/\D/g, '');
  if (digits.startsWith('84')) return digits;
  if (digits.startsWith('0')) return '84' + digits.slice(1);
  return digits;
}
/**
 * Lấy Access Token hiện hành, tự làm mới bằng Refresh Token lưu trong bảng
 * zalo_oa_tokens — xem ghi chú y hệt trong send-due-reminders/index.ts.
 * DÙNG LẠI access_token đã lưu nếu còn mới (< 50 phút, an toàn hơn hạn thật
 * ~60 phút của Zalo) thay vì gọi API làm mới MỖI LẦN gửi — đỡ mất thêm 1
 * lượt gọi mạng ra ngoài (ngoài lượt gửi tin thật sự), bấm "Gửi tin Zalo OA
 * ngay" phản hồi nhanh hơn hẳn. AN TOÀN với việc Refresh Token tự xoay
 * vòng: xoay vòng chỉ xảy ra ĐÚNG lúc gọi API làm mới, không liên quan gì
 * tới việc tái sử dụng access_token đã có để GỬI TIN — gọi làm mới ít lại
 * còn giảm rủi ro đá nhau giữa nhiều lượt gửi cùng lúc.
 */
async function getZaloAccessToken(): Promise<string | null> {
  if (!ZALO_APP_ID || !ZALO_SECRET_KEY) return null;
  const { data: tokenRow } = await admin.from('zalo_oa_tokens').select('*').eq('id', 'default').maybeSingle();
  if (!tokenRow?.refresh_token) return null;
  if (tokenRow.access_token && tokenRow.updated_at) {
    const ageMinutes = (Date.now() - new Date(tokenRow.updated_at).getTime()) / 60000;
    if (ageMinutes < 50) return tokenRow.access_token as string;
  }
  try {
    const res = await fetch('https://oauth.zaloapp.com/v4/oa/access_token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', secret_key: ZALO_SECRET_KEY },
      body: new URLSearchParams({ app_id: ZALO_APP_ID, grant_type: 'refresh_token', refresh_token: tokenRow.refresh_token }),
    });
    const json2 = await res.json();
    if (!json2.access_token) { console.error('Lỗi làm mới Zalo access token:', json2); return null; }
    await admin.from('zalo_oa_tokens').update({
      access_token: json2.access_token,
      refresh_token: json2.refresh_token || tokenRow.refresh_token,
      updated_at: new Date().toISOString(),
    }).eq('id', 'default');
    return json2.access_token as string;
  } catch (e) {
    console.error('Lỗi gọi API làm mới Zalo access token:', e);
    return null;
  }
}
/** Gửi 1 tin mẫu Zalo qua SĐT, TỰ GHI LOG vào zalo_send_log (dùng cho cả gửi tay lẫn xem trong "Quản lý gửi tin"). */
async function sendZaloTemplateLogged(opts: {
  accessToken: string; phone: string; templateId: string; templateData: Record<string, string>;
  contractId: string; customerId: string; kind: string; triggeredBy: 'auto' | 'manual'; triggeredByAdminId?: string | null;
}): Promise<{ ok: boolean; reason?: string }> {
  let status: 'success' | 'error' = 'error';
  let errorMessage = '';
  try {
    const res = await fetch('https://business.openapi.zalo.me/message/template', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', access_token: opts.accessToken },
      body: JSON.stringify({
        phone: normalizeZaloPhone(opts.phone),
        template_id: opts.templateId,
        template_data: opts.templateData,
        tracking_id: `qtd-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      }),
    });
    const respJson = await res.json();
    if (respJson.error === 0) { status = 'success'; } else { errorMessage = respJson.message || JSON.stringify(respJson); }
  } catch (e: any) {
    errorMessage = String(e?.message || e);
  }
  await admin.from('zalo_send_log').insert({
    contract_id: opts.contractId, customer_id: opts.customerId, kind: opts.kind, template_id: opts.templateId,
    phone: opts.phone, status, error_message: errorMessage || null,
    triggered_by: opts.triggeredBy, triggered_by_admin_id: opts.triggeredByAdminId || null,
  });
  return status === 'success' ? { ok: true } : { ok: false, reason: errorMessage || 'Gửi thất bại.' };
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  if (req.method !== 'POST') return json({ ok: false, reason: 'Method not allowed' }, 405);

  let body: Record<string, any>;
  try {
    body = await req.json();
  } catch {
    return json({ ok: false, reason: 'Yêu cầu không hợp lệ.' }, 400);
  }

  // ===== type: 'login' — KHÔNG cần JWT sẵn có, đây là chỗ tạo ra JWT =====
  if (body.type === 'login') {
    const { role, identifier, password } = body;
    if (!identifier || !password || (role !== 'customer' && role !== 'admin')) {
      return json({ ok: false, reason: 'Thiếu thông tin đăng nhập.' }, 400);
    }
    const table = role === 'customer' ? 'customers' : 'admins';
    const idTrim = String(identifier).trim();

    let row: Record<string, any> | null = null;
    if (role === 'customer') {
      const noSpace = idTrim.replace(/\s/g, '');
      const { data, error } = await admin.from('customers').select('*');
      if (error) { console.error('query customers error:', error); return json({ ok: false, reason: 'Lỗi hệ thống, thử lại sau.' }, 500); }
      row = (data || []).find((c) => c.cccd === idTrim || (c.phone && c.phone.replace(/\s/g, '') === noSpace)) || null;
    } else {
      // Tên đăng nhập quản trị viên KHÔNG phân biệt hoa/thường — dùng ilike().
      const { data, error } = await admin.from('admins').select('*').ilike('username', escapeLike(idTrim)).maybeSingle();
      if (error) { console.error('query admins error:', error); return json({ ok: false, reason: 'Lỗi hệ thống, thử lại sau.' }, 500); }
      row = data;
    }

    const notFoundMsg = role === 'customer' ? 'Không tìm thấy tài khoản với số CCCD/số điện thoại này.' : 'Sai tên đăng nhập hoặc mật khẩu.';
    if (!row) return json({ ok: false, reason: notFoundMsg });
    if (!row.salt || !row.hash) return json({ ok: false, reason: 'Tài khoản này chưa được cấp mật khẩu đăng nhập — liên hệ quỹ tín dụng.' });
    if (row.locked_until && new Date(row.locked_until).getTime() > Date.now()) {
      const mins = Math.ceil((new Date(row.locked_until).getTime() - Date.now()) / 60000);
      return json({ ok: false, reason: `Tài khoản tạm khóa do nhập sai nhiều lần. Thử lại sau ${mins} phút.` });
    }

    const okPw = await verifyCredential(password, row.salt, row.hash);
    if (!okPw) {
      const failedAttempts = (row.failed_attempts || 0) + 1;
      const patch: Record<string, unknown> = { failed_attempts: failedAttempts };
      if (failedAttempts >= LOCK_AFTER_FAILS) { patch.locked_until = new Date(Date.now() + LOCK_MINUTES * 60000).toISOString(); patch.failed_attempts = 0; }
      await admin.from(table).update(patch).eq('id', row.id);
      return json({ ok: false, reason: role === 'customer' ? 'Số CCCD/số điện thoại hoặc mật khẩu không đúng.' : 'Sai tên đăng nhập hoặc mật khẩu.' });
    }

    // last_login_at + is_online CHỈ ghi cho customer — dùng cho 2 chấm trạng
    // thái ở trang Khách hàng & Hợp đồng / Quản lý User. is_online bật NGAY
    // ở đây (chấm "đã đăng nhập" nghĩa là ĐANG có phiên hoạt động, không phải
    // "đã từng đăng nhập") — tắt lại NGAY lúc khách bấm "Đăng xuất" (type
    // 'customer-logout' bên dưới). Trường hợp khách tắt app/rớt mạng mà
    // KHÔNG bấm đăng xuất, server không có cách nào tự biết để tắt is_online
    // — hasCustomerLoggedIn() (js/state.js) tự đặt 1 mốc hiển thị riêng (chỉ
    // để chấm không kẹt xanh mãi trên màn hình, KHÔNG phải hạn phiên đăng
    // nhập thật — phiên đăng nhập giờ không còn tự hết hạn nữa, xem trên).
    const loginPatch: Record<string, unknown> = { failed_attempts: 0, locked_until: null };
    if (role === 'customer') { loginPatch.last_login_at = new Date().toISOString(); loginPatch.is_online = true; }
    await admin.from(table).update(loginPatch).eq('id', row.id);

    const now = Math.floor(Date.now() / 1000);
    // KHÔNG còn field "exp" (thời hạn) — bỏ hẳn tự động đăng xuất theo thời
    // gian, đăng nhập 1 lần là duy trì mãi mãi (chỉ hết khi khách/nhân viên
    // tự bấm "Đăng xuất", hoặc tự xóa dữ liệu trình duyệt). Xem verifyJwt()
    // ở trên — thiếu "exp" giờ được hiểu là "không hết hạn", không còn bị từ
    // chối như trước.
    const token = await signJwt({
      sub: row.auth_user_id, role: 'authenticated', app_role: role, row_id: row.id,
      iat: now,
    });
    // Ghi nhật ký CHỈ đăng nhập của quản trị viên/nhân viên — KHÔNG ghi đăng
    // nhập của khách hàng (không thuộc "nhật ký sử dụng của quản trị viên").
    if (role === 'admin') await logActivity(row.id, row.name || row.username, 'login', `Đăng nhập hệ thống (${row.username})`);
    return json({ ok: true, token, id: row.id, mustChangePassword: !!row.must_change_password });
  }

  // ===== type: 'forgot-password' — KHÔNG cần JWT sẵn có (khách chưa đăng
  // nhập được nên chưa có JWT). Khách nhập CCCD + SĐT để "xác minh danh
  // tính" (chưa có OTP thật nên chỉ dừng ở mức khớp 2 thông tin này, không
  // tự đổi mật khẩu) — khớp đúng cả 2 mới ghi 1 "yêu cầu cấp lại mật khẩu"
  // vào bảng requests, admin xem yêu cầu (có tên/SĐT khách) rồi tự gọi điện
  // xác minh lại + cấp mật khẩu mới qua chức năng "Cấp lại mật khẩu" sẵn có
  // ở trang Khách hàng. Không tiết lộ CCCD/SĐT nào sai để tránh dò thông tin. =====
  if (body.type === 'forgot-password') {
    const cccd = String(body.cccd || '').trim();
    const phone = body.phone ? String(body.phone).replace(/\s/g, '') : '';
    if (!cccd || !phone) return json({ ok: false, reason: 'Cần nhập đủ số CCCD và số điện thoại.' }, 400);

    const { data: row, error } = await admin.from('customers').select('id, phone').eq('cccd', cccd).maybeSingle();
    if (error) { console.error('forgot-password lookup error:', error); return json({ ok: false, reason: 'Lỗi hệ thống, thử lại sau.' }, 500); }
    const notMatchMsg = 'Không tìm thấy tài khoản khớp với số CCCD và số điện thoại đã nhập. Vui lòng kiểm tra lại hoặc liên hệ trực tiếp quỹ tín dụng.';
    if (!row || !row.phone || row.phone.replace(/\s/g, '') !== phone) {
      return json({ ok: false, reason: notMatchMsg });
    }

    // Tránh ghi trùng nếu khách bấm nhiều lần: đã có yêu cầu "Mới" trong 24h gần nhất thì thôi, không tạo thêm.
    const since = new Date(Date.now() - 24 * 3600 * 1000).toISOString();
    const { data: recent } = await admin.from('requests').select('id')
      .eq('customer_id', row.id).eq('type', 'quen_mat_khau').eq('status', 'moi').gte('created_at', since).limit(1);
    if (!recent || !recent.length) {
      const { error: insErr } = await admin.from('requests').insert({
        id: genId('yc'), customer_id: row.id, type: 'quen_mat_khau',
        purpose: 'Khách hàng bấm "Quên mật khẩu" ở màn đăng nhập, đã xác minh khớp CCCD + SĐT.',
        status: 'moi',
      });
      if (insErr) { console.error('forgot-password insert error:', insErr); return json({ ok: false, reason: 'Lỗi hệ thống, thử lại sau.' }, 500); }
    }
    return json({ ok: true });
  }

  // ===== type: 'verify-own-password' / 'set-own-password' — tự đổi mật khẩu
  // CHÍNH MÌNH, cần JWT hợp lệ (khách hàng HOẶC admin/nhân viên đều được,
  // không cần role='super') =====
  if (body.type === 'verify-own-password' || body.type === 'set-own-password') {
    const authHeader = req.headers.get('Authorization') || '';
    const selfToken = authHeader.replace(/^Bearer\s+/i, '');
    const selfClaims = selfToken ? await verifyJwt(selfToken) : null;
    if (!selfClaims || !selfClaims.app_role) {
      return json({ ok: false, reason: 'Chưa đăng nhập hoặc phiên đã hết hạn.' }, 401);
    }
    const selfTable = selfClaims.app_role === 'customer' ? 'customers' : 'admins';

    if (body.type === 'verify-own-password') {
      const { data: row } = await admin.from(selfTable).select('salt, hash').eq('id', selfClaims.row_id).maybeSingle();
      if (!row || !row.salt || !row.hash) return json({ ok: true, valid: false });
      const valid = await verifyCredential(body.password || '', row.salt, row.hash);
      return json({ ok: true, valid });
    }

    const newPw = String(body.newPassword || '').trim();
    if (newPw.length < 6) return json({ ok: false, reason: 'Mật khẩu mới phải từ 6 ký tự.' }, 400);
    const cred = await makeCredential(newPw);
    const patch: Record<string, unknown> = { ...cred, must_change_password: !!body.mustChangePassword };
    const { error } = await admin.from(selfTable).update(patch).eq('id', selfClaims.row_id);
    if (error) return json({ ok: false, reason: 'Lỗi hệ thống, thử lại sau.' }, 500);
    return json({ ok: true });
  }

  // ===== type: 'save-push-subscription' / 'delete-push-subscription' — tự
  // đăng ký/hủy nhận thông báo đẩy (Web Push) CHO CHÍNH MÌNH, cần JWT hợp lệ
  // (khách hàng hoặc admin/nhân viên đều được, KHÔNG cần role='super') — bảng
  // push_subscriptions, xem docs/supabase-migration.md mục "Thông báo đẩy". =====
  if (body.type === 'save-push-subscription' || body.type === 'delete-push-subscription') {
    const authHeader = req.headers.get('Authorization') || '';
    const selfToken = authHeader.replace(/^Bearer\s+/i, '');
    const selfClaims = selfToken ? await verifyJwt(selfToken) : null;
    if (!selfClaims || !selfClaims.app_role) {
      return json({ ok: false, reason: 'Chưa đăng nhập hoặc phiên đã hết hạn.' }, 401);
    }

    if (body.type === 'delete-push-subscription') {
      const endpoint = String(body.endpoint || '').trim();
      if (!endpoint) return json({ ok: false, reason: 'Thiếu endpoint.' }, 400);
      // Chỉ xóa đúng subscription của CHÍNH người gọi (khớp cả endpoint lẫn owner_id).
      await admin.from('push_subscriptions').delete().eq('endpoint', endpoint).eq('owner_id', selfClaims.row_id);
      return json({ ok: true });
    }

    const endpoint = String(body.endpoint || '').trim();
    const p256dh = String(body.p256dh || '').trim();
    const authKey = String(body.auth || '').trim();
    if (!endpoint || !p256dh || !authKey) return json({ ok: false, reason: 'Thiếu thông tin đăng ký nhận thông báo.' }, 400);
    const { error } = await admin.from('push_subscriptions').upsert({
      endpoint, p256dh, auth: authKey,
      owner_type: selfClaims.app_role, owner_id: selfClaims.row_id,
    }, { onConflict: 'endpoint' });
    if (error) return json({ ok: false, reason: 'Lỗi hệ thống, thử lại sau.' }, 500);
    return json({ ok: true });
  }

  // ===== type: 'customer-logout' — khách hàng CHỦ ĐỘNG bấm "Đăng xuất" —
  // tắt is_online NGAY để chấm "đã đăng nhập" ở trang admin chuyển sang
  // "chưa đăng nhập" ngay lập tức (xem hasCustomerLoggedIn() trong
  // js/state.js). Gọi bằng JWT SẮP hết hiệu lực (đang đăng xuất) nên vẫn
  // chấp nhận claims hết hạn 1 chút cũng được — không sao, đây không phải
  // hành động nhạy cảm, chỉ để cập nhật đúng trạng thái hiển thị. =====
  if (body.type === 'customer-logout') {
    const authHeader = req.headers.get('Authorization') || '';
    const selfToken = authHeader.replace(/^Bearer\s+/i, '');
    const selfClaims = selfToken ? await verifyJwt(selfToken) : null;
    if (!selfClaims || selfClaims.app_role !== 'customer') {
      return json({ ok: false, reason: 'Chưa đăng nhập hoặc phiên đã hết hạn.' }, 401);
    }
    await admin.from('customers').update({ is_online: false }).eq('id', selfClaims.row_id);
    return json({ ok: true });
  }

  // ===== type: 'log-admin-action' — ghi 1 dòng vào Nhật ký sử dụng cho các
  // thao tác KHÔNG đi qua Edge Function này (ghi thẳng qua Row Level
  // Security — chat_messages/requests — hoặc chỉ ĐỌC dữ liệu đã có sẵn ở
  // trình duyệt — xem chi tiết khách hàng/hợp đồng, đổi bộ lọc) nên
  // logActivity() bình thường (gọi từ TRONG các "type" khác ở Edge Function
  // này) không có chỗ nào để tự chạy. Chỉ nhận 1 tập "action" CỐ ĐỊNH bên
  // dưới — với action gắn với 1 bản ghi thật (khách hàng/hợp đồng/yêu cầu),
  // server LUÔN tự tra cứu dữ liệu thật để tự soạn mô tả (KHÔNG tin mô tả
  // tự do từ client), tránh 1 quản trị viên tự ghi bậy nội dung sai sự thật
  // về 1 bản ghi/người khác vào nhật ký. Riêng 2 action 'filter-customers'
  // và 'nav-page' (chỉ là chọn bộ lọc/chuyển trang trên màn hình, không gắn
  // với bản ghi cụ thể nào để tra cứu, cũng không có gì nhạy cảm nếu mô tả
  // không khớp 100%) CHO PHÉP client tự mô tả ngắn, có giới hạn độ dài (chặn
  // spam) — xem 2 case đó bên dưới. admin_id/admin_name LUÔN lấy từ JWT của
  // người gọi (KHÔNG bao giờ
  // tin client tự khai), nên không ai giả mạo được thành người khác dù ở
  // action nào. =====
  if (body.type === 'log-admin-action') {
    const authHeader = req.headers.get('Authorization') || '';
    const selfToken = authHeader.replace(/^Bearer\s+/i, '');
    const selfClaims = selfToken ? await verifyJwt(selfToken) : null;
    if (!selfClaims || selfClaims.app_role !== 'admin') {
      return json({ ok: false, reason: 'Chưa đăng nhập hoặc phiên đã hết hạn.' }, 401);
    }
    const { data: selfAdmin } = await admin.from('admins').select('id, name, username').eq('id', selfClaims.row_id).maybeSingle();
    if (!selfAdmin) return json({ ok: false, reason: 'Chưa đăng nhập hoặc phiên đã hết hạn.' }, 401);
    const actorName = selfAdmin.name || selfAdmin.username;

    if (body.action === 'reply-chat') {
      const customerId = String(body.customerId || '').trim();
      if (!customerId) return json({ ok: false, reason: 'Thiếu mã khách hàng.' }, 400);
      const { data: cust } = await admin.from('customers').select('name').eq('id', customerId).maybeSingle();
      await logActivity(selfAdmin.id, actorName, 'reply-chat', `Trả lời chat với khách hàng "${cust?.name || customerId}"`);
      return json({ ok: true });
    }

    if (body.action === 'update-request-status') {
      const requestId = String(body.requestId || '').trim();
      if (!requestId) return json({ ok: false, reason: 'Thiếu mã yêu cầu.' }, 400);
      const { data: reqRow } = await admin.from('requests').select('status, customer_id').eq('id', requestId).maybeSingle();
      const { data: cust } = reqRow?.customer_id ? await admin.from('customers').select('name').eq('id', reqRow.customer_id).maybeSingle() : { data: null };
      const statusLabel = REQUEST_STATUS_LABELS[reqRow?.status as string] || reqRow?.status || '';
      await logActivity(selfAdmin.id, actorName, 'update-request-status', `Cập nhật trạng thái yêu cầu của khách hàng "${cust?.name || reqRow?.customer_id || '—'}" thành "${statusLabel}"`);
      return json({ ok: true });
    }

    if (body.action === 'view-customer') {
      const customerId = String(body.customerId || '').trim();
      if (!customerId) return json({ ok: false, reason: 'Thiếu mã khách hàng.' }, 400);
      const { data: cust } = await admin.from('customers').select('name').eq('id', customerId).maybeSingle();
      await logActivity(selfAdmin.id, actorName, 'view-customer', `Xem chi tiết khách hàng "${cust?.name || customerId}"`);
      return json({ ok: true });
    }

    if (body.action === 'view-contract') {
      const contractId = String(body.contractId || '').trim();
      if (!contractId) return json({ ok: false, reason: 'Thiếu mã hợp đồng.' }, 400);
      const { data: ct } = await admin.from('contracts').select('code, customer_id').eq('id', contractId).maybeSingle();
      const { data: cust } = ct?.customer_id ? await admin.from('customers').select('name').eq('id', ct.customer_id).maybeSingle() : { data: null };
      await logActivity(selfAdmin.id, actorName, 'view-contract', `Xem chi tiết hợp đồng ${ct?.code || contractId}${cust?.name ? ` (khách hàng "${cust.name}")` : ''}`);
      return json({ ok: true });
    }

    if (body.action === 'filter-customers') {
      // 1 trong 2 ngoại lệ trong 'log-admin-action' cho phép mô tả từ client
      // (cùng với 'nav-page' bên dưới, xem ghi chú đầu block) — chỉ vì
      // Thôn/Xóm/kiểu sắp xếp là tên/nhãn THẬT hiện đang chọn trên màn hình,
      // không có danh sách cố định để server tự tra & soạn câu như các
      // action khác. Cắt ngắn còn tối đa 200 ký tự — chặn spam/ghi rác dài
      // vô hạn vào nhật ký, không phải để lọc nội dung (không nhạy cảm).
      const filterDesc = String(body.filterDesc || '').trim().slice(0, 200);
      if (!filterDesc) return json({ ok: false, reason: 'Thiếu mô tả bộ lọc.' }, 400);
      await logActivity(selfAdmin.id, actorName, 'filter-customers', `Lọc danh sách khách hàng — ${filterDesc}`);
      return json({ ok: true });
    }

    if (body.action === 'nav-page') {
      // Ngoại lệ THỨ 2 cho phép mô tả từ client (xem ghi chú 'filter-customers'
      // ở trên) — nhãn trang lấy thẳng từ đúng tên đang hiện trên menu
      // (NAV_LABEL_MAP ở js/app.js), không có gì nhạy cảm nếu không khớp
      // 100% (chỉ là tên trang, không gắn với dữ liệu của ai). Cắt ngắn còn
      // tối đa 100 ký tự — chặn spam.
      const pageLabel = String(body.pageLabel || '').trim().slice(0, 100);
      if (!pageLabel) return json({ ok: false, reason: 'Thiếu tên trang.' }, 400);
      await logActivity(selfAdmin.id, actorName, 'nav-page', `Vào trang "${pageLabel}"`);
      return json({ ok: true });
    }

    return json({ ok: false, reason: 'Thiếu hoặc sai "action".' }, 400);
  }

  // ===== type: 'send-manual-notification' — BẤT KỲ admin/nhân viên nào đã
  // đăng nhập (KHÔNG cần role='super') tự soạn + gửi ngay 1 thông báo đẩy
  // cho 1 khách hàng. Nhân viên (role='staff') CHỈ gửi được cho khách trong
  // đúng phạm vi Thôn/Xóm được gán — y hệt điều kiện RLS bảng customers (xem
  // docs/supabase-migration.md mục 5b) — tránh gửi ra ngoài phạm vi dù biết
  // trước customerId (client-side chỉ ẩn UI, không phải hàng rào bảo mật
  // thật). Quản trị viên toàn quyền (role='super') không bị giới hạn gì. =====
  if (body.type === 'send-manual-notification') {
    const authHeader = req.headers.get('Authorization') || '';
    const selfToken = authHeader.replace(/^Bearer\s+/i, '');
    const selfClaims = selfToken ? await verifyJwt(selfToken) : null;
    if (!selfClaims || selfClaims.app_role !== 'admin') {
      return json({ ok: false, reason: 'Chưa đăng nhập hoặc phiên đã hết hạn.' }, 401);
    }
    const { data: caller, error: callerErr } = await admin.from('admins').select('*').eq('id', selfClaims.row_id).maybeSingle();
    if (callerErr || !caller) {
      return json({ ok: false, reason: 'Chưa đăng nhập hoặc phiên đã hết hạn.' }, 401);
    }
    if (!VAPID_PUBLIC_KEY || !VAPID_PRIVATE_KEY) {
      return json({ ok: false, reason: 'Chưa cấu hình thông báo đẩy trên server (thiếu secret VAPID) — xem docs/supabase-migration.md mục "Thông báo đẩy".' }, 500);
    }
    const customerId = String(body.customerId || '').trim();
    const title = String(body.title || '').trim();
    const msgBody = String(body.body || '').trim();
    if (!customerId || !title || !msgBody) return json({ ok: false, reason: 'Cần nhập đủ tiêu đề và nội dung thông báo.' }, 400);

    if (caller.role !== 'super') {
      const { data: cust } = await admin.from('customers').select('thon, xom').eq('id', customerId).maybeSingle();
      if (!cust) return json({ ok: false, reason: 'Không tìm thấy khách hàng.' }, 404);
      const allowedThon: string[] = caller.allowed_thon || [];
      const allowedXom: string[] = caller.allowed_xom || [];
      const inScope = allowedThon.includes(cust.thon) || allowedXom.includes(`${cust.thon}||${cust.xom}`);
      if (!inScope) return json({ ok: false, reason: 'Bạn không có quyền gửi thông báo cho khách hàng này.' }, 403);
    }

    const { data: subs, error: subsErr } = await admin.from('push_subscriptions').select('*').eq('owner_type', 'customer').eq('owner_id', customerId);
    if (subsErr) return json({ ok: false, reason: 'Lỗi hệ thống, thử lại sau.' }, 500);
    if (!subs || !subs.length) return json({ ok: false, reason: 'Khách hàng này chưa bật thông báo trên thiết bị nào.' });

    let sentCount = 0;
    for (const sub of subs) {
      try {
        await webpush.sendNotification(
          { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
          JSON.stringify({ title, body: msgBody, tag: 'thong-bao-thu-cong', url: './' })
        );
        sentCount++;
      } catch (e: any) {
        if (e && (e.statusCode === 404 || e.statusCode === 410)) {
          await admin.from('push_subscriptions').delete().eq('endpoint', sub.endpoint);
        } else {
          console.error('manual push send error:', e?.statusCode, e?.body || e);
        }
      }
    }
    if (!sentCount) return json({ ok: false, reason: 'Gửi không thành công — thiết bị của khách có thể đã tắt/gỡ đăng ký nhận thông báo, nhờ khách vào lại app bật lại thông báo.' });
    const { data: notifiedCust } = await admin.from('customers').select('name').eq('id', customerId).maybeSingle();
    await logActivity(caller.id, caller.name || caller.username, 'send-manual-notification',
      `Gửi thông báo đẩy "${title}" cho khách hàng "${notifiedCust?.name || customerId}" (${sentCount} thiết bị)`);
    return json({ ok: true, sentCount });
  }

  // ===== type: 'add-zalo-auto-send' / 'remove-zalo-auto-send' / 'send-zalo-manual'
  // — quản lý danh sách gửi Zalo OA tự động + gửi tay ngay 1 khách. Cần quyền
  // canManageZaloOA (cờ RIÊNG, KHÔNG dùng chung canManageUsers) HOẶC
  // role='super'. Nhân viên staff chỉ thao tác được với hợp đồng của khách
  // trong đúng phạm vi Thôn/Xóm được gán — y hệt kiểu kiểm tra ở
  // 'send-manual-notification' phía trên. =====
  if (body.type === 'add-zalo-auto-send' || body.type === 'remove-zalo-auto-send' || body.type === 'send-zalo-manual'
    || body.type === 'add-zalo-customer' || body.type === 'remove-zalo-customer' || body.type === 'update-zalo-auto-send-settings') {
    const authHeader = req.headers.get('Authorization') || '';
    const selfToken = authHeader.replace(/^Bearer\s+/i, '');
    const selfClaims = selfToken ? await verifyJwt(selfToken) : null;
    if (!selfClaims || selfClaims.app_role !== 'admin') {
      return json({ ok: false, reason: 'Chưa đăng nhập hoặc phiên đã hết hạn.' }, 401);
    }
    const { data: caller, error: callerErr } = await admin.from('admins').select('*').eq('id', selfClaims.row_id).maybeSingle();
    if (callerErr || !caller) return json({ ok: false, reason: 'Chưa đăng nhập hoặc phiên đã hết hạn.' }, 401);
    if (caller.role !== 'super' && caller.can_manage_zalo_oa !== true) {
      return json({ ok: false, reason: 'Bạn không có quyền quản lý gửi tin Zalo OA — liên hệ quản trị viên toàn quyền để được cấp quyền.' }, 403);
    }

    /** Kiểm tra hợp đồng có tồn tại + có nằm trong phạm vi Thôn/Xóm của người gọi không (super thì luôn true). */
    async function checkContractInScope(contractId: string): Promise<{ ok: boolean; contract?: any; customer?: any }> {
      const { data: contract } = await admin.from('contracts').select('*').eq('id', contractId).maybeSingle();
      if (!contract) return { ok: false };
      const { data: customer } = await admin.from('customers').select('*').eq('id', contract.customer_id).maybeSingle();
      if (!customer) return { ok: false };
      if (caller.role !== 'super') {
        const allowedThon: string[] = caller.allowed_thon || [];
        const allowedXom: string[] = caller.allowed_xom || [];
        const inScope = allowedThon.includes(customer.thon) || allowedXom.includes(`${customer.thon}||${customer.xom}`);
        if (!inScope) return { ok: false };
      }
      return { ok: true, contract, customer };
    }
    /** Y HỆT checkContractInScope() nhưng đi thẳng từ customerId (dùng cho add-zalo-customer, không cần qua hợp đồng cụ thể). */
    async function checkCustomerInScope(customerId: string): Promise<{ ok: boolean; customer?: any }> {
      const { data: customer } = await admin.from('customers').select('*').eq('id', customerId).maybeSingle();
      if (!customer) return { ok: false };
      if (caller.role !== 'super') {
        const allowedThon: string[] = caller.allowed_thon || [];
        const allowedXom: string[] = caller.allowed_xom || [];
        const inScope = allowedThon.includes(customer.thon) || allowedXom.includes(`${customer.thon}||${customer.xom}`);
        if (!inScope) return { ok: false };
      }
      return { ok: true, customer };
    }
    /** Đảm bảo khách đã có trong Tầng 1 (zalo_customers) — tự thêm nếu chưa có, không báo lỗi nếu đã có sẵn. */
    async function ensureZaloCustomer(customerId: string) {
      await admin.from('zalo_customers').insert({ customer_id: customerId, added_by: caller.id }).select().maybeSingle();
      // Bỏ qua lỗi trùng (đã có sẵn) — chỉ cần đảm bảo tồn tại, không cần biết vừa tạo mới hay đã có.
    }

    if (body.type === 'add-zalo-customer') {
      const customerId = String(body.customerId || '').trim();
      if (!customerId) return json({ ok: false, reason: 'Thiếu mã khách hàng.' }, 400);
      const scope = await checkCustomerInScope(customerId);
      if (!scope.ok) return json({ ok: false, reason: 'Không tìm thấy khách hàng hoặc bạn không có quyền với khách hàng này.' }, 403);
      const { data: existing } = await admin.from('zalo_customers').select('customer_id').eq('customer_id', customerId).maybeSingle();
      if (existing) return json({ ok: false, reason: 'Khách hàng này đã có trong danh sách OA rồi.' });
      const { error } = await admin.from('zalo_customers').insert({ customer_id: customerId, added_by: caller.id });
      if (error) return json({ ok: false, reason: 'Lỗi hệ thống, thử lại sau.' }, 500);
      await logActivity(caller.id, caller.name || caller.username, 'add-zalo-customer', `Thêm khách hàng "${scope.customer?.name || customerId}" vào Danh sách OA`);
      return json({ ok: true });
    }

    if (body.type === 'remove-zalo-customer') {
      const customerId = String(body.customerId || '').trim();
      if (!customerId) return json({ ok: false, reason: 'Thiếu mã khách hàng.' }, 400);
      const scope = await checkCustomerInScope(customerId);
      if (!scope.ok) return json({ ok: false, reason: 'Bạn không có quyền với khách hàng này.' }, 403);
      // Xóa khỏi Tầng 1 tự động XÓA THEO mọi lựa chọn gửi tự động (Tầng 2) của khách này, kể cả của
      // NGƯỜI KHÁC đã chọn — do khóa ngoại on delete cascade (xem docs mục 10.5). Chấp nhận đánh đổi
      // này vì đã bỏ hẳn khỏi danh sách OA thì không còn lý do gì để còn gửi tự động cho khách đó nữa.
      const { error } = await admin.from('zalo_customers').delete().eq('customer_id', customerId);
      if (error) return json({ ok: false, reason: 'Lỗi hệ thống, thử lại sau.' }, 500);
      await logActivity(caller.id, caller.name || caller.username, 'remove-zalo-customer', `Bỏ khách hàng "${scope.customer?.name || customerId}" khỏi Danh sách OA`);
      return json({ ok: true });
    }

    if (body.type === 'add-zalo-auto-send') {
      const contractId = String(body.contractId || '').trim();
      // "đến hạn" không còn là lựa chọn ở Tầng 2 nữa (tự động theo Tầng 1,
      // xem type 'send-due-reminders' phía server) — Tầng 2 giờ chỉ còn 2
      // mục báo lãi, loại trừ nhau (1 hợp đồng chỉ ở 1 trong 2, xem mục 10.6).
      const kind = body.kind === 'lai_hang_thang_custom_day' ? 'lai_hang_thang_custom_day' : 'lai_hang_thang_auto';
      const customDay = kind === 'lai_hang_thang_custom_day' ? Number(body.customDay) || null : null;
      // Định kỳ báo — mặc định 1 (hàng tháng, hành vi cũ), cho chọn 2/3/4
      // tháng báo 1 lần thay vì tháng nào cũng báo. Áp dụng cho CẢ 2 mục.
      const intervalMonths = [1, 2, 3, 4].includes(Number(body.intervalMonths)) ? Number(body.intervalMonths) : 1;
      if (!contractId) return json({ ok: false, reason: 'Thiếu mã hợp đồng.' }, 400);
      // Ngày gửi phải 1-30 (không có tháng nào ít hơn) — thiếu chặn này thì
      // ngày nhập lố (VD 31-35) sẽ KHÔNG BAO GIỜ khớp Date().getDate() nên
      // không tháng nào gửi được, âm thầm hỏng mà không báo lỗi gì cả.
      if (kind === 'lai_hang_thang_custom_day' && (!customDay || customDay < 1 || customDay > 30)) {
        return json({ ok: false, reason: 'Ngày gửi không hợp lệ (1-30).' }, 400);
      }
      const scope = await checkContractInScope(contractId);
      if (!scope.ok) return json({ ok: false, reason: 'Không tìm thấy hợp đồng hoặc bạn không có quyền với hợp đồng này.' }, 403);
      // Tự thêm vào Tầng 1 (danh sách OA) nếu khách chưa có sẵn — Tầng 2 (gửi
      // tự động) LUÔN đi kèm Tầng 1, đỡ bắt người dùng làm 2 bước riêng.
      await ensureZaloCustomer(scope.contract.customer_id);
      const { error } = await admin.from('zalo_auto_send_list').insert({
        id: genId('zas'), contract_id: contractId, customer_id: scope.contract.customer_id, kind, custom_day: customDay,
        interval_months: intervalMonths, created_by: caller.id,
      });
      if (error) {
        if (String(error.message || '').toLowerCase().includes('duplicate')) {
          // Tra xem AI đã chọn trước + chọn mục nào (không lộ gì nhạy cảm, chỉ tên) để báo đúng như yêu cầu.
          const { data: existingRow } = await admin.from('zalo_auto_send_list').select('created_by, kind').eq('contract_id', contractId).maybeSingle();
          const { data: existingAdmin } = existingRow?.created_by
            ? await admin.from('admins').select('name').eq('id', existingRow.created_by).maybeSingle()
            : { data: null };
          const who = existingAdmin?.name ? `nhân viên "${existingAdmin.name}"` : 'người khác';
          const kindLabel = existingRow?.kind === 'lai_hang_thang_custom_day' ? 'Gửi theo ngày cụ thể' : 'Báo lãi tự động hàng tháng';
          return json({ ok: false, reason: `Hợp đồng này đã được ${who} thêm vào mục "${kindLabel}" rồi (1 hợp đồng chỉ ở được 1 trong 2 mục).` });
        }
        return json({ ok: false, reason: 'Lỗi hệ thống, thử lại sau.' }, 500);
      }
      await logActivity(caller.id, caller.name || caller.username, 'add-zalo-auto-send',
        `Thêm hợp đồng ${scope.contract?.code || contractId} vào gửi tự động (${kind === 'lai_hang_thang_custom_day' ? 'Gửi theo ngày cụ thể' : 'Báo lãi tự động hàng tháng'})`);
      return json({ ok: true });
    }

    if (body.type === 'remove-zalo-auto-send') {
      const id = String(body.id || '').trim();
      if (!id) return json({ ok: false, reason: 'Thiếu mã.' }, 400);
      const { data: row } = await admin.from('zalo_auto_send_list').select('*').eq('id', id).maybeSingle();
      if (!row) return json({ ok: true }); // đã không còn -> coi như xong, khỏi báo lỗi
      // Chỉ chính người đã chọn (hoặc super) mới bỏ được — KHÔNG dùng
      // checkContractInScope ở đây, vì lựa chọn Tầng 2 giờ riêng tư theo
      // từng người, không phải cứ cùng phạm vi Thôn/Xóm là bỏ được của nhau.
      if (caller.role !== 'super' && row.created_by !== caller.id) {
        return json({ ok: false, reason: 'Bạn không có quyền bỏ lựa chọn của người khác.' }, 403);
      }
      const { error } = await admin.from('zalo_auto_send_list').delete().eq('id', id);
      if (error) return json({ ok: false, reason: 'Lỗi hệ thống, thử lại sau.' }, 500);
      const { data: rowContract } = await admin.from('contracts').select('code').eq('id', row.contract_id).maybeSingle();
      await logActivity(caller.id, caller.name || caller.username, 'remove-zalo-auto-send', `Bỏ hợp đồng ${rowContract?.code || row.contract_id} khỏi gửi tự động`);
      return json({ ok: true });
    }

    // Sửa ngày gửi (chỉ mục "Gửi theo ngày cụ thể") và/hoặc định kỳ báo (1-4
    // tháng, cả 2 mục) của 1 lựa chọn Tầng 2 đã có sẵn.
    if (body.type === 'update-zalo-auto-send-settings') {
      const id = String(body.id || '').trim();
      if (!id) return json({ ok: false, reason: 'Thiếu mã.' }, 400);
      const { data: row } = await admin.from('zalo_auto_send_list').select('*').eq('id', id).maybeSingle();
      if (!row) return json({ ok: false, reason: 'Không tìm thấy lựa chọn này (có thể đã bị xóa).' }, 404);
      if (caller.role !== 'super' && row.created_by !== caller.id) {
        return json({ ok: false, reason: 'Bạn không có quyền sửa lựa chọn của người khác.' }, 403);
      }
      const patch: Record<string, unknown> = {};
      if (body.intervalMonths !== undefined) {
        const intervalMonths = Number(body.intervalMonths);
        if (![1, 2, 3, 4].includes(intervalMonths)) return json({ ok: false, reason: 'Định kỳ không hợp lệ (chỉ 1-4 tháng).' }, 400);
        patch.interval_months = intervalMonths;
      }
      if (body.customDay !== undefined) {
        if (row.kind !== 'lai_hang_thang_custom_day') return json({ ok: false, reason: 'Chỉ mục "Gửi theo ngày cụ thể" mới sửa được ngày.' }, 400);
        const customDay = Number(body.customDay) || null;
        if (!customDay || customDay < 1 || customDay > 30) return json({ ok: false, reason: 'Ngày không hợp lệ (1-30).' }, 400);
        patch.custom_day = customDay;
      }
      if (!Object.keys(patch).length) return json({ ok: false, reason: 'Không có gì để sửa.' }, 400);
      const { error } = await admin.from('zalo_auto_send_list').update(patch).eq('id', id);
      if (error) return json({ ok: false, reason: 'Lỗi hệ thống, thử lại sau.' }, 500);
      const { data: rowContract } = await admin.from('contracts').select('code').eq('id', row.contract_id).maybeSingle();
      await logActivity(caller.id, caller.name || caller.username, 'update-zalo-auto-send-settings', `Sửa cài đặt gửi tự động của hợp đồng ${rowContract?.code || row.contract_id}`);
      return json({ ok: true });
    }

    if (body.type === 'send-zalo-manual') {
      const contractId = String(body.contractId || '').trim();
      if (!contractId) return json({ ok: false, reason: 'Thiếu thông tin.' }, 400);
      const now = new Date();

      // Trước đây các bước tra cứu này CHẠY LẦN LƯỢT (mỗi bước 1 lượt
      // round-trip riêng, cộng dồn lại là nguyên nhân chính khiến "Gửi tin
      // Zalo OA ngay" thấy lâu) — dồn lại còn 2 "đợt" song song thay vì nối
      // tiếp nhau (đợt sau chỉ chờ đúng những gì THẬT SỰ cần từ đợt trước):
      //
      // Đợt 1 — chỉ cần contractId đã có sẵn từ đầu, không phụ thuộc gì
      // khác: tra hợp đồng, tra lần gửi thành công gần nhất (tính hạn chờ 5
      // ngày), tra cấu hình mẫu Zalo, và lấy Access Token.
      const [contractRes, lastLogRes, orgRowRes, accessToken] = await Promise.all([
        admin.from('contracts').select('*').eq('id', contractId).maybeSingle(),
        admin.from('zalo_send_log').select('sent_at')
          .eq('contract_id', contractId).eq('status', 'success')
          .order('sent_at', { ascending: false }).limit(1).maybeSingle(),
        admin.from('orgs').select('zalo_template_due_id, zalo_template_interest_id').limit(1).maybeSingle(),
        getZaloAccessToken(),
      ]);
      const contract = contractRes.data;
      if (!contract) return json({ ok: false, reason: 'Không tìm thấy hợp đồng hoặc bạn không có quyền với hợp đồng này.' }, 403);
      if (!accessToken) return json({ ok: false, reason: 'Chưa cấu hình kết nối Zalo OA trên server (thiếu Secret/Refresh Token) — liên hệ để cấu hình trước.' }, 500);

      // Đợt 2 — CẦN biết contract.customer_id trước (chỉ có sau đợt 1) nên
      // phải đợi đợt 1 xong, nhưng bản thân 2 việc trong đợt này lại KHÔNG
      // phụ thuộc nhau (tra khách hàng để kiểm tra quyền Thôn/Xóm + lấy SĐT,
      // và tra đã có trong Tầng 1 "Danh sách OA" chưa) nên vẫn gộp song
      // song được với nhau.
      const [customerRes, zaloCustRes] = await Promise.all([
        admin.from('customers').select('*').eq('id', contract.customer_id).maybeSingle(),
        admin.from('zalo_customers').select('customer_id').eq('customer_id', contract.customer_id).maybeSingle(),
      ]);
      const customer = customerRes.data;
      if (!customer) return json({ ok: false, reason: 'Không tìm thấy hợp đồng hoặc bạn không có quyền với hợp đồng này.' }, 403);
      if (caller.role !== 'super') {
        const allowedThon: string[] = caller.allowed_thon || [];
        const allowedXom: string[] = caller.allowed_xom || [];
        const inScope = allowedThon.includes(customer.thon) || allowedXom.includes(`${customer.thon}||${customer.xom}`);
        if (!inScope) return json({ ok: false, reason: 'Không tìm thấy hợp đồng hoặc bạn không có quyền với hợp đồng này.' }, 403);
      }
      if (!customer.phone) return json({ ok: false, reason: 'Khách hàng này chưa có số điện thoại.' });

      // PHẢI đã có sẵn trong Tầng 1 "Danh sách OA" mới gửi tay được — KHÔNG
      // còn tự thêm ngầm lúc gửi như trước nữa (đổi theo yêu cầu: admin phải
      // chủ động xác minh đúng chủ SĐT rồi thêm vào OA trước, xem nút "Thêm
      // vào OA" ở chi tiết khách hàng).
      if (!zaloCustRes.data) {
        return json({ ok: false, reason: 'Khách hàng chưa có trong Danh sách OA — vào chi tiết khách hàng (mục Khách hàng & Hợp đồng) để thêm vào OA trước khi gửi.' });
      }

      // Giới hạn gửi tay: 5 ngày mới gửi lại được cho CÙNG 1 hợp đồng (tránh
      // gửi trùng/spam khách) — tính theo lần gửi Zalo THÀNH CÔNG gần nhất
      // của hợp đồng này (bất kể tự động hay gửi tay), báo rõ đã gửi ngày nào.
      const lastLog = lastLogRes.data;
      if (lastLog?.sent_at) {
        const daysSinceLast = daysBetweenZalo(new Date(lastLog.sent_at), now);
        if (daysSinceLast < 5) {
          return json({ ok: false, reason: `Hợp đồng này đã gửi Zalo gần nhất vào ngày ${formatDateVNZalo(lastLog.sent_at)} — phải đợi đủ 5 ngày mới gửi lại được (còn ${5 - daysSinceLast} ngày nữa).` });
        }
      }

      // Tự chọn mẫu theo tình huống hợp đồng — KHÔNG cần người gọi tự chọn
      // nữa: gần/đã đến hạn (<=15 ngày) dùng mẫu "Đến hạn", còn xa hạn dùng
      // mẫu "Báo lãi" (chỉ báo lãi, gốc chưa thật sự phải trả).
      const usesDueTemplate = isNearOrPastDueZalo(contract, now);
      const orgRow = orgRowRes.data;
      const templateId = usesDueTemplate ? orgRow?.zalo_template_due_id : orgRow?.zalo_template_interest_id;
      const kind = usesDueTemplate ? 'den_han' : 'lai_hang_thang';
      if (!templateId) {
        return json({ ok: false, reason: `Chưa cấu hình Template ID cho mẫu "${usesDueTemplate ? 'Đến hạn' : 'Báo lãi'}" — vào Quản lý OA > Cấu hình để điền trước.` }, 500);
      }

      const interest = accruedInterestZalo(contract, now);
      const goc = usesDueTemplate ? Number(contract.balance) : 0; // chưa đến hạn thì gốc chưa thật sự phải trả, chỉ báo lãi
      const total = goc + interest;
      const nameNoDiacritics = stripDiacriticsUpper(customer.name || '');
      const templateData = {
        TEN_KHACH_HANG: customer.name || '',
        SO_HDTD: contract.code,
        SO_KHE_UOC: contract.code,
        SO_DU: formatVNDZaloTemplate(contract.balance),
        GOC_PHAI_TRA: formatVNDZaloTemplate(goc),
        LAI_PHAI_TRA: formatVNDZaloTemplate(interest),
        SO_TIEN_CHUYEN_KHOAN: formatVNDZaloTemplate(total),
        NOI_DUNG_CHUYEN_KHOAN: stripDiacriticsUpper(`THANH TOAN ${usesDueTemplate ? '' : 'LAI '}HDTD ${contract.code} ${nameNoDiacritics}`),
        NGAY_DAO_HAN: formatDateVNZalo(contract.due_date),
        // Ngày gửi tin (hôm nay) — KHÁC với NGAY_DAO_HAN (ngày đến hạn thật của hợp đồng).
        NGAY_KE_HOACH: formatDateVNZalo(now.toISOString()),
      };
      const result = await sendZaloTemplateLogged({
        accessToken, phone: customer.phone, templateId, templateData,
        contractId, customerId: customer.id, kind, triggeredBy: 'manual', triggeredByAdminId: caller.id,
      });
      // Đã có log riêng "Quản lý gửi tin" (bảng zalo_send_log, GHI ĐỦ + CÓ ĐỢI
      // cho MỌI lượt gửi kể cả lỗi — xem sendZaloTemplateLogged() ở trên) —
      // ghi thêm 1 dòng NGẮN vào Nhật ký sử dụng chung khi THÀNH CÔNG, để
      // trang "Nhật ký" cũng thấy đủ, không cần vào riêng "Quản lý gửi tin"
      // mới biết. CỐ Ý KHÔNG ĐỢI (khác mọi chỗ gọi logActivity() còn lại) —
      // đây là đường gửi tay đã tốn nhiều công tối ưu tốc độ (mục 10.30-32),
      // thêm 1 lượt round-trip nữa vào ĐÚNG lúc chuẩn bị trả kết quả sẽ làm
      // chậm lại đúng thứ vừa tối ưu. Chấp nhận rủi ro nhỏ dòng này thỉnh
      // thoảng không kịp ghi (nếu Edge Function tắt tiến trình ngay sau khi
      // trả response) — không sao vì zalo_send_log (nguồn THẬT của lượt gửi
      // này) vẫn luôn ghi đủ, không phụ thuộc dòng này.
      if (result.ok) {
        logActivity(caller.id, caller.name || caller.username, 'send-zalo-manual',
          `Gửi tay Zalo OA (mẫu ${usesDueTemplate ? 'Đến hạn' : 'Báo lãi'}) cho khách hàng "${customer.name || contractId}"`)
          .catch((e) => console.error('Lỗi ghi activity_log (send-zalo-manual):', e));
      }
      return json(result.ok ? { ok: true } : { ok: false, reason: result.reason });
    }
  }

  // ===== Mọi type khác: bắt buộc JWT của 1 admin đã đăng nhập (super HOẶC
  // staff) — phân quyền chi tiết theo từng "type" ngay bên dưới, không còn
  // chặn cứng "chỉ super" ở 1 chỗ như trước nữa. =====
  const authHeader = req.headers.get('Authorization') || '';
  const token = authHeader.replace(/^Bearer\s+/i, '');
  const claims = token ? await verifyJwt(token) : null;
  if (!claims || claims.app_role !== 'admin') {
    return json({ ok: false, reason: 'Chưa đăng nhập hoặc phiên đã hết hạn.' }, 401);
  }
  const { data: callerAdmin, error: callerErr } = await admin.from('admins').select('*').eq('id', claims.row_id).maybeSingle();
  if (callerErr || !callerAdmin) {
    return json({ ok: false, reason: 'Chưa đăng nhập hoặc phiên đã hết hạn.' }, 401);
  }
  const isSuper = callerAdmin.role === 'super';
  // Nhân viên "chỉ xem" được cấp thêm cờ can_manage_users -> coi như "toàn
  // quyền thu nhỏ" CHỈ trong phạm vi Use KHÁCH HÀNG (tạo/cấp lại mật khẩu/
  // khóa/xóa) — KHÔNG được đụng vào bất kỳ tài khoản QUẢN TRỊ VIÊN nào khác
  // (kể cả 1 nhân viên chỉ xem khác), xem SUPER_ONLY_TYPES ngay dưới đây.
  const canManageUsers = isSuper || callerAdmin.can_manage_users === true;
  // Các "type" sau LUÔN bắt buộc đúng quản trị viên toàn quyền, không có
  // ngoại lệ cho canManageUsers — gồm CẢ sửa cấu hình quỹ/nhập hàng loạt LẪN
  // mọi thao tác đụng tới tài khoản Quản trị viên/nhân viên khác (tạo/xóa/
  // đổi vai trò/đổi quyền/cấp lại mật khẩu) — nhân viên có canManageUsers
  // chỉ được quản lý Use khách hàng, không được quản lý Use Quản trị viên.
  const SUPER_ONLY_TYPES = [
    'update-customer-profile', 'delete-contract', 'import', 'update-staff-role',
    'staff', 'reset-staff-password', 'update-staff-permissions', 'delete-staff', 'force-logout-staff',
  ];
  if (SUPER_ONLY_TYPES.includes(body.type) && !isSuper) {
    return json({ ok: false, reason: 'Chỉ quản trị viên toàn quyền mới được thực hiện thao tác này.' }, 403);
  }
  // Các "type" còn lại (quản lý Use khách hàng) cần ít nhất canManageUsers.
  if (!canManageUsers) {
    return json({ ok: false, reason: 'Bạn không có quyền thực hiện thao tác này — liên hệ quản trị viên toàn quyền để được cấp quyền "Quản lý User".' }, 403);
  }

  // ===== type: 'update-staff-role' — CHỈ super — đổi vai trò Toàn quyền <->
  // Chỉ xem cho 1 tài khoản đã có sẵn. Hạ 1 tài khoản 'super' xuống 'staff'
  // thì phải còn lại ít nhất 1 'super' khác, giữ đúng bất biến như delete-staff. =====
  if (body.type === 'update-staff-role') {
    const staffId = String(body.staffId || '').trim();
    const newRole = body.role === 'super' ? 'super' : 'staff';
    if (!staffId) return json({ ok: false, reason: 'Thiếu mã tài khoản.' }, 400);
    const { data: target } = await admin.from('admins').select('role, name, username').eq('id', staffId).maybeSingle();
    if (!target) return json({ ok: false, reason: 'Không tìm thấy tài khoản.' }, 404);
    if (target.role === 'super' && newRole === 'staff') {
      const { count } = await admin.from('admins').select('id', { count: 'exact', head: true }).eq('role', 'super');
      if ((count || 0) <= 1) return json({ ok: false, reason: 'Phải giữ lại ít nhất 1 quản trị viên toàn quyền.' }, 409);
    }
    const { error } = await admin.from('admins').update({ role: newRole }).eq('id', staffId);
    if (error) return json({ ok: false, reason: 'Lỗi hệ thống, thử lại sau.' }, 500);
    await logActivity(callerAdmin.id, callerAdmin.name || callerAdmin.username, 'update-staff-role',
      `Đổi vai trò tài khoản "${target.name || target.username}" thành ${newRole === 'super' ? 'Toàn quyền' : 'Nhân viên'}`);
    return json({ ok: true });
  }

  if (body.type === 'customer') {
    const cccd = String(body.cccd || '').trim();
    if (!cccd) return json({ ok: false, reason: 'Cần nhập số CCCD.' }, 400);
    const phone = body.phone ? String(body.phone).replace(/\s/g, '') : '';
    const finalPassword = body.password && String(body.password).trim() ? String(body.password).trim() : genTempPassword();
    const cred = await makeCredential(finalPassword);

    const { data: existing } = await admin.from('customers').select('*').eq('cccd', cccd).maybeSingle();
    if (existing && existing.salt && existing.hash) {
      return json({ ok: false, reason: 'Số CCCD này đã có tài khoản rồi — dùng chức năng cấp lại mật khẩu nếu cần đặt lại.' }, 409);
    }

    let customerId: string;
    if (existing) {
      customerId = existing.id;
      const patch: Record<string, unknown> = { ...cred, must_change_password: true, failed_attempts: 0, locked_until: null };
      if (body.name) patch.name = body.name;
      if (phone) patch.phone = phone;
      const { error } = await admin.from('customers').update(patch).eq('id', customerId);
      if (error) return json({ ok: false, reason: 'Lỗi hệ thống, thử lại sau.' }, 500);
    } else {
      customerId = genId('cust');
      const { error } = await admin.from('customers').insert({
        id: customerId, cccd, name: body.name || cccd, phone,
        salt: cred.salt, hash: cred.hash, must_change_password: true,
        failed_attempts: 0, locked_until: null,
      });
      if (error) return json({ ok: false, reason: 'Lỗi hệ thống, thử lại sau.' }, 500);
    }
    // Trả thẳng dòng khách hàng vừa tạo (đọc bằng service role, KHÔNG qua RLS
    // của người gọi) — vì người gọi có thể là nhân viên "chỉ xem" đã được cấp
    // canManageUsers, mà khách mới tạo (chưa có địa chỉ/Thôn/Xóm) không nằm
    // trong phạm vi Thôn/Xóm được gán cho họ, nên nếu để client tự SELECT lại
    // bằng token của người gọi thì RLS sẽ trả về rỗng — tài khoản coi như
    // "biến mất" khỏi trang Quản lý User dù đã tạo thành công thật trong CSDL.
    const { data: newRow } = await admin.from('customers').select('*').eq('id', customerId).maybeSingle();
    await logActivity(callerAdmin.id, callerAdmin.name || callerAdmin.username, 'customer',
      `${existing ? 'Cấp lại mật khẩu (qua màn tạo tài khoản)' : 'Tạo tài khoản mới'} cho khách hàng "${newRow?.name || cccd}" (CCCD ${cccd})`);
    return json({ ok: true, id: customerId, tempPassword: finalPassword, customer: newRow });
  }

  if (body.type === 'staff') {
    const username = String(body.username || '').trim();
    if (!username) return json({ ok: false, reason: 'Cần nhập tên đăng nhập.' }, 400);
    // Kiểm tra trùng KHÔNG phân biệt hoa/thường (khớp với ilike() lúc đăng
    // nhập) — không cho tạo "Admin1" nếu đã có "admin1", tránh 2 tài khoản
    // tưởng khác nhau nhưng đăng nhập lại lẫn vào nhau.
    const { data: existing } = await admin.from('admins').select('id').ilike('username', escapeLike(username)).maybeSingle();
    if (existing) return json({ ok: false, reason: 'Tên đăng nhập đã tồn tại.' }, 409);

    // Nhân viên chỉ có canManageUsers (không phải super) KHÔNG được tự tạo
    // tài khoản 'super' — ép về 'staff' bất kể client gửi gì lên.
    const finalRole = (isSuper && body.role === 'super') ? 'super' : 'staff';
    const finalPassword = body.password && String(body.password).trim() ? String(body.password).trim() : genTempPassword();
    const cred = await makeCredential(finalPassword);
    const staffId = genId('staff');

    const { error } = await admin.from('admins').insert({
      id: staffId, username, name: body.name || username, role: finalRole,
      allowed_thon: finalRole === 'staff' && Array.isArray(body.allowedThon) ? body.allowedThon : [],
      allowed_xom: finalRole === 'staff' && Array.isArray(body.allowedXom) ? body.allowedXom : [],
      can_manage_users: finalRole === 'staff' ? !!body.canManageUsers : false,
      salt: cred.salt, hash: cred.hash, must_change_password: true,
    });
    if (error) return json({ ok: false, reason: 'Lỗi hệ thống, thử lại sau.' }, 500);
    await logActivity(callerAdmin.id, callerAdmin.name || callerAdmin.username, 'staff',
      `Tạo tài khoản ${finalRole === 'super' ? 'quản trị viên toàn quyền' : 'nhân viên'} "${body.name || username}" (đăng nhập: ${username})`);
    return json({ ok: true, id: staffId, tempPassword: finalPassword });
  }

  if (body.type === 'update-customer-profile') {
    const cccd = String(body.cccd || '').trim();
    if (!cccd) return json({ ok: false, reason: 'Cần nhập số CCCD.' }, 400);
    const patch: Record<string, unknown> = {};
    if (body.name) patch.name = body.name;
    if (body.phone) patch.phone = String(body.phone).replace(/\s/g, '');
    if (body.address) { patch.address = body.address; Object.assign(patch, parseAddress(body.address)); }
    const { error } = await admin.from('customers').update(patch).eq('cccd', cccd);
    if (error) return json({ ok: false, reason: 'Lỗi hệ thống, thử lại sau.' }, 500);
    await logActivity(callerAdmin.id, callerAdmin.name || callerAdmin.username, 'update-customer-profile', `Cập nhật hồ sơ khách hàng (CCCD ${cccd})`);
    return json({ ok: true });
  }

  if (body.type === 'reset-customer-password') {
    const customerId = String(body.customerId || '').trim();
    if (!customerId) return json({ ok: false, reason: 'Thiếu mã khách hàng.' }, 400);
    const finalPassword = body.password && String(body.password).trim() ? String(body.password).trim() : genTempPassword();
    const cred = await makeCredential(finalPassword);
    // .select('name') NGAY TRÊN CÙNG lệnh update() — đọc luôn tên khách hàng
    // vừa cập nhật để ghi nhật ký cho dễ đọc, KHÔNG cần thêm 1 lượt truy vấn
    // riêng.
    const { data: updated, error } = await admin.from('customers')
      .update({ ...cred, must_change_password: true, failed_attempts: 0, locked_until: null })
      .eq('id', customerId).select('name').maybeSingle();
    if (error) return json({ ok: false, reason: 'Lỗi hệ thống, thử lại sau.' }, 500);
    await logActivity(callerAdmin.id, callerAdmin.name || callerAdmin.username, 'reset-customer-password', `Cấp lại mật khẩu khách hàng "${updated?.name || customerId}"`);
    return json({ ok: true, tempPassword: finalPassword });
  }

  // Đăng xuất use ngay (KHÔNG cấp lại mật khẩu) — chỉ ghi lại thời điểm bấm
  // vào cột force_logout_at, dùng cơ chế TỰ PHÁT HIỆN có sẵn của
  // "Cấp lại mật khẩu" (xem refreshSessionData() trong js/state.js): phiên
  // đang mở của use đó tự nhận ra force_logout_at vừa đổi (khác lần trước đã
  // biết) ở lần tự làm mới dữ liệu kế tiếp (quay lại tab/chuyển trang) rồi tự
  // đăng xuất, không cần tải lại trang. KHÔNG bắt đặt mật khẩu mới (khác hẳn
  // "Cấp lại mật khẩu") — dùng khi chỉ cần buộc thoát ra, VD: nghi ngờ có
  // người khác đang dùng chung tài khoản, hoặc muốn họ đăng nhập lại để nhận
  // đúng quyền/dữ liệu mới nhất.
  if (body.type === 'force-logout-customer') {
    const customerId = String(body.customerId || '').trim();
    if (!customerId) return json({ ok: false, reason: 'Thiếu mã khách hàng.' }, 400);
    const { data: updated, error } = await admin.from('customers').update({ force_logout_at: new Date().toISOString() }).eq('id', customerId).select('name').maybeSingle();
    if (error) return json({ ok: false, reason: 'Lỗi hệ thống, thử lại sau.' }, 500);
    await logActivity(callerAdmin.id, callerAdmin.name || callerAdmin.username, 'force-logout-customer', `Đăng xuất ngay khách hàng "${updated?.name || customerId}"`);
    return json({ ok: true });
  }

  if (body.type === 'deactivate-customer') {
    const customerId = String(body.customerId || '').trim();
    if (!customerId) return json({ ok: false, reason: 'Thiếu mã khách hàng.' }, 400);
    const { data: updated, error } = await admin.from('customers').update({ salt: null, hash: null, must_change_password: false, failed_attempts: 0, locked_until: null }).eq('id', customerId).select('name').maybeSingle();
    if (error) return json({ ok: false, reason: 'Lỗi hệ thống, thử lại sau.' }, 500);
    await logActivity(callerAdmin.id, callerAdmin.name || callerAdmin.username, 'deactivate-customer', `Vô hiệu hóa tài khoản khách hàng "${updated?.name || customerId}"`);
    return json({ ok: true });
  }

  if (body.type === 'delete-customer') {
    const customerId = String(body.customerId || '').trim();
    if (!customerId) return json({ ok: false, reason: 'Thiếu mã khách hàng.' }, 400);
    const { data: deleted, error } = await admin.from('customers').delete().eq('id', customerId).select('name, cccd').maybeSingle();
    if (error) return json({ ok: false, reason: 'Lỗi hệ thống, thử lại sau.' }, 500);
    await logActivity(callerAdmin.id, callerAdmin.name || callerAdmin.username, 'delete-customer', `Xóa tài khoản khách hàng "${deleted?.name || customerId}"${deleted?.cccd ? ` (CCCD ${deleted.cccd})` : ''}`);
    return json({ ok: true });
  }

  if (body.type === 'delete-contract') {
    const contractId = String(body.contractId || '').trim();
    if (!contractId) return json({ ok: false, reason: 'Thiếu mã hợp đồng.' }, 400);
    const { data: deleted, error } = await admin.from('contracts').delete().eq('id', contractId).select('code').maybeSingle();
    if (error) return json({ ok: false, reason: 'Lỗi hệ thống, thử lại sau.' }, 500);
    await logActivity(callerAdmin.id, callerAdmin.name || callerAdmin.username, 'delete-contract', `Xóa hợp đồng ${deleted?.code || contractId}`);
    return json({ ok: true });
  }

  // Đăng xuất quản trị viên/nhân viên ngay (KHÔNG cấp lại mật khẩu) — cùng cơ
  // chế với force-logout-customer ở trên (xem ghi chú tại đó).
  if (body.type === 'force-logout-staff') {
    const staffId = String(body.staffId || '').trim();
    if (!staffId) return json({ ok: false, reason: 'Thiếu mã tài khoản.' }, 400);
    const { data: updated, error } = await admin.from('admins').update({ force_logout_at: new Date().toISOString() }).eq('id', staffId).select('name, username').maybeSingle();
    if (error) return json({ ok: false, reason: 'Lỗi hệ thống, thử lại sau.' }, 500);
    await logActivity(callerAdmin.id, callerAdmin.name || callerAdmin.username, 'force-logout-staff', `Đăng xuất ngay tài khoản "${updated?.name || updated?.username || staffId}"`);
    return json({ ok: true });
  }

  if (body.type === 'reset-staff-password') {
    const staffId = String(body.staffId || '').trim();
    if (!staffId) return json({ ok: false, reason: 'Thiếu mã tài khoản.' }, 400);
    if (!isSuper) {
      const { data: target } = await admin.from('admins').select('role').eq('id', staffId).maybeSingle();
      if (target?.role === 'super') return json({ ok: false, reason: 'Không có quyền với tài khoản toàn quyền.' }, 403);
    }
    const finalPassword = body.password && String(body.password).trim() ? String(body.password).trim() : genTempPassword();
    const cred = await makeCredential(finalPassword);
    const { data: updated, error } = await admin.from('admins').update({ ...cred, must_change_password: true, failed_attempts: 0, locked_until: null }).eq('id', staffId).select('name, username').maybeSingle();
    if (error) return json({ ok: false, reason: 'Lỗi hệ thống, thử lại sau.' }, 500);
    await logActivity(callerAdmin.id, callerAdmin.name || callerAdmin.username, 'reset-staff-password', `Cấp lại mật khẩu tài khoản "${updated?.name || updated?.username || staffId}"`);
    return json({ ok: true, tempPassword: finalPassword });
  }

  if (body.type === 'update-staff-permissions') {
    const staffId = String(body.staffId || '').trim();
    if (!staffId) return json({ ok: false, reason: 'Thiếu mã tài khoản.' }, 400);
    const { data: updated, error } = await admin.from('admins').update({
      allowed_thon: Array.isArray(body.allowedThon) ? body.allowedThon : [],
      allowed_xom: Array.isArray(body.allowedXom) ? body.allowedXom : [],
      can_manage_users: !!body.canManageUsers,
      can_manage_zalo_oa: !!body.canManageZaloOA,
    }).eq('id', staffId).eq('role', 'staff').select('name, username').maybeSingle();
    if (error) return json({ ok: false, reason: 'Lỗi hệ thống, thử lại sau.' }, 500);
    await logActivity(callerAdmin.id, callerAdmin.name || callerAdmin.username, 'update-staff-permissions', `Sửa quyền tài khoản "${updated?.name || updated?.username || staffId}"`);
    return json({ ok: true });
  }

  if (body.type === 'delete-staff') {
    const staffId = String(body.staffId || '').trim();
    if (!staffId) return json({ ok: false, reason: 'Thiếu mã tài khoản.' }, 400);
    const { data: target } = await admin.from('admins').select('role').eq('id', staffId).maybeSingle();
    if (target && target.role === 'super') {
      if (!isSuper) return json({ ok: false, reason: 'Không có quyền với tài khoản toàn quyền.' }, 403);
      const { count } = await admin.from('admins').select('id', { count: 'exact', head: true }).eq('role', 'super');
      if ((count || 0) <= 1) return json({ ok: false, reason: 'Phải giữ lại ít nhất 1 quản trị viên toàn quyền.' }, 409);
    }
    const { data: deleted, error } = await admin.from('admins').delete().eq('id', staffId).select('name, username').maybeSingle();
    if (error) return json({ ok: false, reason: 'Lỗi hệ thống, thử lại sau.' }, 500);
    await logActivity(callerAdmin.id, callerAdmin.name || callerAdmin.username, 'delete-staff', `Xóa tài khoản "${deleted?.name || deleted?.username || staffId}"`);
    return json({ ok: true });
  }

  if (body.type === 'import') {
    const rows = Array.isArray(body.rows) ? body.rows : [];
    const fullSync = !!body.fullSync;
    const result = {
      newProfiles: 0, existingCustomers: 0, contracts: 0,
      deletedContracts: 0, deletedCustomers: 0, skipped: 0, zaloAutoSendMigrated: 0,
      newAccounts: [] as { name: string; cccd: string; tempPassword: string }[],
      errors: [] as string[],
    };

    const { data: allCustomers } = await admin.from('customers').select('*');
    const { data: allContracts } = await admin.from('contracts').select('*');
    const customerByCccd = new Map((allCustomers || []).map((c: any) => [c.cccd, c]));
    const contractByCode = new Map((allContracts || []).filter((c: any) => c.code).map((c: any) => [c.code, c]));

    // Tách riêng 2 mảng cho khách MỚI và khách ĐÃ CÓ SẴN — không gộp chung 1
    // upsert() duy nhất, vì khi ghi hàng loạt, PostgREST tự động lấy HỢP các
    // cột xuất hiện trong TOÀN BỘ mảng làm danh sách cột chung; dòng nào
    // thiếu 1 cột nào đó (vd: dòng "khách đã có sẵn" không đổi cccd nên
    // không đưa cccd vào patch) sẽ tự bị điền NULL cho đúng cột đó — cccd
    // not null nên báo lỗi ngay, nhưng các cột cho phép null khác (địa chỉ,
    // sđt...) sẽ ÂM THẦM bị xóa mất mà không báo lỗi gì. Tách riêng 2 lệnh,
    // mỗi lệnh nội bộ luôn có bộ cột đồng nhất (khách mới: object đủ mọi
    // cột; khách cũ: luôn là object đầy đủ `cust` sau khi merge patch, chứ
    // không phải chỉ mỗi phần thay đổi) để tránh hoàn toàn tình huống này.
    const newCustomerUpserts: Record<string, unknown>[] = [];
    const existingCustomerUpserts: Record<string, unknown>[] = [];
    const contractUpserts: Record<string, unknown>[] = [];
    const touchedContractIds = new Set<string>();
    const usedCodes = new Set<string>();
    // 1 khách hàng có thể xuất hiện ở NHIỀU dòng (mỗi dòng 1 hợp đồng) — GHI
    // hồ sơ khách hàng CHỈ SAU KHI xử lý xong hết các dòng (dùng touchedCccds
    // + originalCccds bên dưới để biết khách nào mới/cũ, 1 khách chỉ đẩy vào
    // mảng upsert ĐÚNG 1 LẦN dù có bao nhiêu hợp đồng). Trước đây đẩy ngay
    // trong vòng lặp — khách có ≥2 hợp đồng bị đẩy vào existingCustomerUpserts
    // nhiều lần, khiến 1 lệnh upsert() chứa 2 dòng cùng "id" -> Postgres báo
    // lỗi "ON CONFLICT DO UPDATE command cannot affect row a second time".
    const originalCccds = new Set(customerByCccd.keys());
    const touchedCccds = new Set<string>();
    const newTempPasswords = new Map<string, string>();

    for (const row of rows) {
      const cccd = String(row.cccd || '').trim();
      if (!cccd || !/^\d{9,12}$/.test(cccd)) { result.skipped++; continue; }
      touchedCccds.add(cccd);

      let cust: any = customerByCccd.get(cccd);
      const parsedAddr = row.address ? parseAddress(row.address) : null;

      if (cust) {
        const patch: Record<string, unknown> = {};
        if (row.name) patch.name = row.name;
        if (row.phone) patch.phone = String(row.phone).replace(/\s/g, '');
        if (row.address) { patch.address = row.address; Object.assign(patch, parsedAddr); }
        cust = { ...cust, ...patch };
        customerByCccd.set(cccd, cust);
      } else {
        const custId = genId('cust');
        const temp = genTempPassword();
        const cred = await makeCredential(temp);
        cust = {
          id: custId, cccd, name: row.name || '', phone: row.phone ? String(row.phone).replace(/\s/g, '') : '',
          address: row.address || '', ...(parsedAddr || { xom: '', thon: '', xa: '', tinh: '' }),
          salt: cred.salt, hash: cred.hash, must_change_password: true,
          failed_attempts: 0, locked_until: null,
        };
        customerByCccd.set(cccd, cust);
        newTempPasswords.set(cccd, temp);
      }

      const disbursed = row.disbursedDate || new Date().toISOString().slice(0, 10);
      const bal = Number(row.balance) || 0;
      let ct: any = row.code ? contractByCode.get(row.code) : null;
      let code = row.code || (ct ? ct.code : null);
      if (!code) {
        do { code = `HD-${cccd}-${Date.now().toString(36).slice(-5)}${Math.random().toString(36).slice(2, 4)}`; }
        while (contractByCode.has(code) || usedCodes.has(code));
      }
      usedCodes.add(code);

      const contractId = ct ? ct.id : genId('hd');
      const contractRow = {
        id: contractId, customer_id: cust.id, code,
        principal: row.principal != null && row.principal !== '' ? Number(row.principal) || 0 : bal,
        disbursed_date: disbursed,
        due_date: row.dueDate || addDaysISO(disbursed, 365),
        interest_rate: row.interestRate != null && row.interestRate !== '' ? Number(row.interestRate) || 0 : (ct ? ct.interest_rate : 0),
        balance: bal,
        interest_paid_until: row.interestPaidUntil || disbursed,
      };
      contractByCode.set(code, contractRow);
      contractUpserts.push(contractRow);
      touchedContractIds.add(contractId);
      result.contracts++;
    }

    // Đẩy MỖI khách hàng đúng 1 lần (dữ liệu cuối cùng sau khi đã gộp patch từ
    // hết các dòng của khách đó) vào đúng 1 trong 2 mảng — xem ghi chú ở khai
    // báo touchedCccds phía trên.
    for (const cccd of touchedCccds) {
      const cust = customerByCccd.get(cccd)!;
      if (originalCccds.has(cccd)) {
        existingCustomerUpserts.push(cust);
        result.existingCustomers++;
      } else {
        newCustomerUpserts.push(cust);
        result.newProfiles++;
        result.newAccounts.push({ name: (cust as any).name, cccd, tempPassword: newTempPasswords.get(cccd)! });
      }
    }

    // An toàn thêm lần nữa (phòng khi có nguồn trùng "id" khác chưa lường
    // hết, VD: 2 dòng Excel trùng y hệt Số HĐTD) — 1 lệnh upsert() KHÔNG được
    // chứa 2 dòng cùng khóa xung đột, Postgres báo lỗi "ON CONFLICT DO UPDATE
    // command cannot affect row a second time" nếu vi phạm. Giữ dòng CUỐI
    // cùng cho mỗi id (dữ liệu mới nhất).
    function dedupeById(rows: Record<string, unknown>[]): Record<string, unknown>[] {
      const map = new Map<unknown, Record<string, unknown>>();
      for (const r of rows) map.set((r as any).id, r);
      return [...map.values()];
    }
    const contractUpsertsDeduped = dedupeById(contractUpserts);

    if (newCustomerUpserts.length) {
      const { error } = await admin.from('customers').upsert(newCustomerUpserts, { onConflict: 'id' });
      if (error) result.errors.push('Lỗi ghi hồ sơ khách hàng mới: ' + error.message);
    }
    if (existingCustomerUpserts.length) {
      const { error } = await admin.from('customers').upsert(existingCustomerUpserts, { onConflict: 'id' });
      if (error) result.errors.push('Lỗi cập nhật hồ sơ khách hàng: ' + error.message);
    }
    if (contractUpsertsDeduped.length) {
      const { error } = await admin.from('contracts').upsert(contractUpsertsDeduped, { onConflict: 'id' });
      if (error) result.errors.push('Lỗi ghi hợp đồng: ' + error.message);
    }

    if (fullSync) {
      const toDeleteIds = (allContracts || []).filter((c: any) => !touchedContractIds.has(c.id)).map((c: any) => c.id);
      if (toDeleteIds.length) {
        // Trước khi xóa hợp đồng không còn trong file, tự CHUYỂN lựa chọn
        // Tầng 2 "Gửi tin tự động" (nếu có) đang gắn với hợp đồng đó sang
        // hợp đồng CÒN LẠI của CÙNG khách hàng, khi khách vẫn còn vay (VD:
        // tất toán hợp đồng cũ, mở hợp đồng mới khác số — vẫn là 1 khoản
        // vay đang tiếp diễn, không nên tự mất lựa chọn gửi tự động chỉ vì
        // đổi số hợp đồng). CHỈ chuyển khi RÕ RÀNG không mơ hồ: đúng 1 hợp
        // đồng cũ có Tầng 2 sắp bị xóa khớp với ĐÚNG 1 hợp đồng còn lại của
        // khách đó (còn dư nợ, chưa có sẵn trong Tầng 2). Nếu khách hàng có
        // nhiều khả năng cùng lúc, hoặc không còn hợp đồng nào khác (tất
        // toán thật) thì để hành vi cũ (xóa theo cascade FK, không đoán mò).
        const { data: orphanEntries } = await admin.from('zalo_auto_send_list')
          .select('id, contract_id, customer_id').in('contract_id', toDeleteIds);
        if (orphanEntries && orphanEntries.length) {
          const { data: existingAutoRows } = await admin.from('zalo_auto_send_list').select('contract_id');
          const alreadyInAuto = new Set((existingAutoRows || []).map((r: any) => r.contract_id));
          // Trạng thái CUỐI CÙNG của mọi hợp đồng sau lượt sync này —
          // contractUpsertsDeduped gồm cả hợp đồng cũ được cập nhật lẫn hợp
          // đồng mới tạo trong đúng lượt import này.
          const remainingByCustomer = new Map<string, string[]>();
          for (const cr of contractUpsertsDeduped) {
            const cid = (cr as any).id as string;
            if (alreadyInAuto.has(cid)) continue; // đã có Tầng 2 riêng, không ghi đè lên
            if ((Number((cr as any).balance) || 0) <= 0) continue; // còn lại nhưng đã tất toán -> không phải nơi để chuyển vào
            const custId = (cr as any).customer_id as string;
            const arr = remainingByCustomer.get(custId) || [];
            arr.push(cid);
            remainingByCustomer.set(custId, arr);
          }
          for (const entry of orphanEntries) {
            const candidates = (remainingByCustomer.get((entry as any).customer_id) || []).filter((cid) => !alreadyInAuto.has(cid));
            if (candidates.length !== 1) continue; // mơ hồ hoặc hết hợp đồng khác -> bỏ qua, xóa theo cascade như cũ
            const { error: migErr } = await admin.from('zalo_auto_send_list').update({ contract_id: candidates[0] }).eq('id', (entry as any).id);
            if (!migErr) { alreadyInAuto.add(candidates[0]); result.zaloAutoSendMigrated++; }
          }
        }
        const { error } = await admin.from('contracts').delete().in('id', toDeleteIds);
        if (!error) result.deletedContracts = toDeleteIds.length;
      }
      const { data: remaining } = await admin.from('contracts').select('customer_id, balance');
      const balByCust = new Map<string, number>();
      for (const c of remaining || []) balByCust.set(c.customer_id, (balByCust.get(c.customer_id) || 0) + (Number(c.balance) || 0));
      const { data: custNow } = await admin.from('customers').select('id, salt, hash');
      const pruneIds = (custNow || []).filter((c: any) => (balByCust.get(c.id) || 0) <= 0 && !(c.salt && c.hash)).map((c: any) => c.id);
      if (pruneIds.length) {
        const { error } = await admin.from('customers').delete().in('id', pruneIds);
        if (!error) result.deletedCustomers = pruneIds.length;
      }
    }

    await logActivity(callerAdmin.id, callerAdmin.name || callerAdmin.username, 'import',
      `Nhập dữ liệu Excel${fullSync ? ' (đồng bộ toàn bộ)' : ''}: ${result.contracts} hợp đồng, ${result.newAccounts.length} tài khoản mới` +
      (result.deletedContracts ? `, xóa ${result.deletedContracts} hợp đồng` : '') +
      (result.deletedCustomers ? `, xóa ${result.deletedCustomers} khách hàng` : '') +
      (result.skipped ? `, bỏ qua ${result.skipped} dòng lỗi` : ''));
    return json({ ok: true, ...result });
  }

  return json({ ok: false, reason: 'Thiếu hoặc sai "type".' }, 400);
});
