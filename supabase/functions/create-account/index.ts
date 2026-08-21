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
//   { type: 'send-manual-notification', customerId, title, body } -> BẤT KỲ
//     admin/nhân viên nào (không cần role='super') tự soạn + gửi ngay 1
//     thông báo đẩy cho 1 khách hàng (khách phải đã bật thông báo trên ít
//     nhất 1 thiết bị). Nhân viên (role='staff') CHỈ gửi được cho khách
//     trong đúng phạm vi Thôn/Xóm được gán — y hệt điều kiện RLS bảng
//     customers, xem docs/supabase-migration.md mục 5b.
//   Tất cả các "type" còn lại BẮT BUỘC header Authorization: Bearer <JWT>
//   của 1 admin đã đăng nhập (xác minh lại tại server, không tin JWT mù) —
//   2 nhóm quyền khác nhau:
//   - CHỈ role='super' (toàn quyền) mới gọi được:
//     { type: 'update-customer-profile', cccd, name?, phone?, address? }
//     { type: 'delete-contract', contractId }
//     { type: 'import', fullSync, rows: [...] } — nhập Excel/dán tay hàng loạt
//     { type: 'update-staff-role', staffId, role } — đổi Toàn quyền <-> Chỉ
//       xem cho 1 tài khoản đã có sẵn (giữ lại ít nhất 1 toàn quyền)
//   - role='super' HOẶC nhân viên "chỉ xem" được cấp cờ canManageUsers=true
//     (xem { type: 'update-staff-permissions', ..., canManageUsers }) đều
//     gọi được — nhân viên có cờ này KHÔNG được tự tạo/đụng vào tài khoản
//     role='super' nào (server tự ép về 'staff'/chặn 403), coi như "toàn
//     quyền thu nhỏ" chỉ trong phạm vi quản lý Use + nhân viên khác:
//     { type: 'customer', cccd, name?, phone?, password? }
//     { type: 'staff', username, name?, password?, role, allowedThon?, allowedXom?, canManageUsers? }
//     { type: 'reset-customer-password', customerId, password? }
//     { type: 'deactivate-customer', customerId }
//     { type: 'delete-customer', customerId }
//     { type: 'reset-staff-password', staffId, password? }
//     { type: 'update-staff-permissions', staffId, allowedThon?, allowedXom?, canManageUsers? }
//     { type: 'delete-staff', staffId }
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

const LOCK_AFTER_FAILS = 5;
const LOCK_MINUTES = 15;
const SESSION_HOURS = 8;

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
/** Escape ký tự đặc biệt của LIKE/ILIKE ("%", "_", "\\") trước khi đưa vào ilike() — tránh username chứa các ký tự này bị hiểu nhầm thành wildcard. */
function escapeLike(s: string): string {
  return s.replace(/[\\%_]/g, (c) => '\\' + c);
}
function addDaysISO(iso: string, n: number): string {
  const dt = new Date(iso);
  dt.setDate(dt.getDate() + n);
  return dt.toISOString().slice(0, 10);
}

/** Y hệt parseAddress trong js/state.js. */
function parseAddress(raw: string) {
  const text = String(raw || '').trim();
  const withoutNote = text.replace(/\([^)]*\)/g, '');
  const parts = withoutNote.split(',').map((s) => s.trim()).filter(Boolean);
  const result = { xom: '', thon: '', xa: '', tinh: '' } as Record<string, string>;
  const rest: string[] = [];
  for (const p of parts) {
    const low = p.toLowerCase();
    if (low.startsWith('xóm') || low.startsWith('xom')) result.xom = p;
    else if (low.startsWith('thôn') || low.startsWith('thon')) result.thon = p;
    else if (low.startsWith('xã') || low.startsWith('xa ') || low.startsWith('phường') || low.startsWith('thị trấn') || low.startsWith('huyện')) result.xa = p;
    else if (low.startsWith('tỉnh') || low.startsWith('tp') || low.startsWith('thành phố')) result.tinh = p;
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
  if (!payload.exp || payload.exp < Math.floor(Date.now() / 1000)) return null;
  return payload;
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

    await admin.from(table).update({ failed_attempts: 0, locked_until: null }).eq('id', row.id);

    const now = Math.floor(Date.now() / 1000);
    const token = await signJwt({
      sub: row.auth_user_id, role: 'authenticated', app_role: role, row_id: row.id,
      iat: now, exp: now + SESSION_HOURS * 3600,
    });
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
    return json({ ok: true, sentCount });
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
  // quyền thu nhỏ" CHỈ trong phạm vi trang Quản lý User (tạo/sửa/xóa Use +
  // nhân viên khác) — KHÔNG được tự cấp/đổi vai trò 'super' cho ai (kể cả
  // chính mình) và KHÔNG đụng được vào tài khoản 'super' khác, xem từng chỗ
  // kiểm tra bên dưới.
  const canManageUsers = isSuper || callerAdmin.can_manage_users === true;
  // Các "type" sau LUÔN bắt buộc đúng quản trị viên toàn quyền, không có
  // ngoại lệ cho canManageUsers — sửa cấu hình quỹ/nhập hàng loạt/đổi vai
  // trò đều là hành động nhạy cảm hơn hẳn việc quản lý Use thông thường.
  const SUPER_ONLY_TYPES = ['update-customer-profile', 'delete-contract', 'import', 'update-staff-role'];
  if (SUPER_ONLY_TYPES.includes(body.type) && !isSuper) {
    return json({ ok: false, reason: 'Chỉ quản trị viên toàn quyền mới được thực hiện thao tác này.' }, 403);
  }
  // Các "type" còn lại (quản lý Use/nhân viên) cần ít nhất canManageUsers.
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
    const { data: target } = await admin.from('admins').select('role').eq('id', staffId).maybeSingle();
    if (!target) return json({ ok: false, reason: 'Không tìm thấy tài khoản.' }, 404);
    if (target.role === 'super' && newRole === 'staff') {
      const { count } = await admin.from('admins').select('id', { count: 'exact', head: true }).eq('role', 'super');
      if ((count || 0) <= 1) return json({ ok: false, reason: 'Phải giữ lại ít nhất 1 quản trị viên toàn quyền.' }, 409);
    }
    const { error } = await admin.from('admins').update({ role: newRole }).eq('id', staffId);
    if (error) return json({ ok: false, reason: 'Lỗi hệ thống, thử lại sau.' }, 500);
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
    return json({ ok: true, id: customerId, tempPassword: finalPassword });
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
    return json({ ok: true });
  }

  if (body.type === 'reset-customer-password') {
    const customerId = String(body.customerId || '').trim();
    if (!customerId) return json({ ok: false, reason: 'Thiếu mã khách hàng.' }, 400);
    const finalPassword = body.password && String(body.password).trim() ? String(body.password).trim() : genTempPassword();
    const cred = await makeCredential(finalPassword);
    const { error } = await admin.from('customers').update({ ...cred, must_change_password: true, failed_attempts: 0, locked_until: null }).eq('id', customerId);
    if (error) return json({ ok: false, reason: 'Lỗi hệ thống, thử lại sau.' }, 500);
    return json({ ok: true, tempPassword: finalPassword });
  }

  if (body.type === 'deactivate-customer') {
    const customerId = String(body.customerId || '').trim();
    if (!customerId) return json({ ok: false, reason: 'Thiếu mã khách hàng.' }, 400);
    const { error } = await admin.from('customers').update({ salt: null, hash: null, must_change_password: false, failed_attempts: 0, locked_until: null }).eq('id', customerId);
    if (error) return json({ ok: false, reason: 'Lỗi hệ thống, thử lại sau.' }, 500);
    return json({ ok: true });
  }

  if (body.type === 'delete-customer') {
    const customerId = String(body.customerId || '').trim();
    if (!customerId) return json({ ok: false, reason: 'Thiếu mã khách hàng.' }, 400);
    const { error } = await admin.from('customers').delete().eq('id', customerId);
    if (error) return json({ ok: false, reason: 'Lỗi hệ thống, thử lại sau.' }, 500);
    return json({ ok: true });
  }

  if (body.type === 'delete-contract') {
    const contractId = String(body.contractId || '').trim();
    if (!contractId) return json({ ok: false, reason: 'Thiếu mã hợp đồng.' }, 400);
    const { error } = await admin.from('contracts').delete().eq('id', contractId);
    if (error) return json({ ok: false, reason: 'Lỗi hệ thống, thử lại sau.' }, 500);
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
    const { error } = await admin.from('admins').update({ ...cred, must_change_password: true, failed_attempts: 0, locked_until: null }).eq('id', staffId);
    if (error) return json({ ok: false, reason: 'Lỗi hệ thống, thử lại sau.' }, 500);
    return json({ ok: true, tempPassword: finalPassword });
  }

  if (body.type === 'update-staff-permissions') {
    const staffId = String(body.staffId || '').trim();
    if (!staffId) return json({ ok: false, reason: 'Thiếu mã tài khoản.' }, 400);
    const { error } = await admin.from('admins').update({
      allowed_thon: Array.isArray(body.allowedThon) ? body.allowedThon : [],
      allowed_xom: Array.isArray(body.allowedXom) ? body.allowedXom : [],
      can_manage_users: !!body.canManageUsers,
    }).eq('id', staffId).eq('role', 'staff');
    if (error) return json({ ok: false, reason: 'Lỗi hệ thống, thử lại sau.' }, 500);
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
    const { error } = await admin.from('admins').delete().eq('id', staffId);
    if (error) return json({ ok: false, reason: 'Lỗi hệ thống, thử lại sau.' }, 500);
    return json({ ok: true });
  }

  if (body.type === 'import') {
    const rows = Array.isArray(body.rows) ? body.rows : [];
    const fullSync = !!body.fullSync;
    const result = {
      newProfiles: 0, existingCustomers: 0, contracts: 0,
      deletedContracts: 0, deletedCustomers: 0, skipped: 0,
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

    return json({ ok: true, ...result });
  }

  return json({ ok: false, reason: 'Thiếu hoặc sai "type".' }, 400);
});
