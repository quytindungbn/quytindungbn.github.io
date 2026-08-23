// Edge Function CHẠY ĐỊNH KỲ MỖI NGÀY (đặt lịch qua Supabase Cron — xem
// docs/supabase-migration.md mục "Thông báo đẩy") — quét toàn bộ hợp đồng
// còn dư nợ, gửi thông báo đẩy (Web Push) cho ĐÚNG khách hàng đã bật thông
// báo trên thiết bị của họ (bảng push_subscriptions). Lịch nhắc:
//   1. Lãi (nợ trong hạn): đúng 2 LẦN mỗi tháng — lần 1 vào ĐÚNG NGÀY (trong
//      tháng) của "Đã trả lãi đến ngày", THÁNG SAU (VD: trả lãi đến ngày
//      13/08 thì 13/09 nhắc lần 1); lần 2 đúng 2 NGÀY sau đó (15/09), rồi
//      NGƯNG hẳn cho tới đợt tháng sau nữa (13/10 nhắc lần 1, 15/10 nhắc lần
//      2) — cứ thế lặp lại mỗi tháng, KHÔNG phải nhắc liên tục nhiều ngày
//      liền, cho tới khi khách đóng lãi (interest_paid_until đổi ngày mới
//      thì tự tính lại chu kỳ từ ngày mới, đợt nhắc dở dang trước đó tự dừng
//      luôn vì mốc đã đổi). Trường hợp mới giải ngân — hệ thống tự set
//      interest_paid_until = disbursed_date + 1 ngày (quy ước tính lãi, xem
//      interestDaysAccrued() trong js/state.js) — thì lấy NGÀY GIẢI NGÂN làm
//      mốc (không lấy interest_paid_until, vì lúc đó nó bị lệch 1 ngày do quy
//      ước tính, không phải ngày khách thật sự đã đóng lãi).
//   2. Gần đến hạn/quá hạn: bắt đầu từ ĐÚNG 10 ngày trước ngày đến hạn, nhắc
//      lại mỗi 3 NGÀY 1 lần (10, 7, 4, 1 ngày trước hạn, rồi tiếp tục mỗi 3
//      ngày sau khi quá hạn) cho tới khi tất toán — KHÔNG dừng lại. Trước
//      ngày đến hạn: nhắc số tiền GỐC sắp đến hạn + hạn chót thanh toán. Từ
//      đúng ngày đến hạn trở đi: nhắc cả GỐC lẫn LÃI, lời lẽ mạnh hơn (khách
//      đã trễ hạn thật).
// Chống gửi trùng bằng bảng notification_log (ghi lại lần gửi gần nhất theo
// từng hợp đồng + loại nhắc).
//
// Riêng Zalo OA (ZBS Template Message, xem phần dưới): KHÔNG gửi tràn lan
// như thông báo đẩy — vì Zalo tốn phí thật + không có cách xác minh trước
// SĐT có đúng chủ hay không. Function này CHỈ tự động gửi 2 mục Tầng 2 (phải
// CHỌN RIÊNG từng hợp đồng vào bảng zalo_auto_send_list, loại trừ nhau — 1
// hợp đồng chỉ ở 1 trong 2 mục):
//   - "Báo lãi tự động hàng tháng": đúng lịch nhắc lãi hàng tháng (mục #1
//     trên), gửi ĐÚNG 1 lần/tháng.
//   - "Gửi theo ngày cụ thể": đúng 1 lần/tháng vào ngày admin tự chọn, CHỈ
//     gửi nếu đã tính lãi > 20 ngày kể từ lần đóng gần nhất (mới đóng gần
//     đây thì bỏ qua, dồn qua tháng sau).
// CẢ 2 mục trên TỰ CHUYỂN sang mẫu "Đến hạn/Quá hạn" thay vì tiếp tục báo
// lãi ngay khi hợp đồng đã GẦN/ĐÃ đến hạn (đúng NEAR_DUE_DAYS_ZALO = 10
// ngày ở function này — báo trước khách 10 ngày theo yêu cầu, KHÁC với
// ngưỡng 15 ngày riêng của nút gửi tay ở create-account) — không còn báo
// lãi suông lúc sắp phải trả cả gốc lẫn lãi nữa. Riêng việc gửi tay VẪN
// không đổi: khách phải có sẵn trong Tầng 1 "Danh sách OA", giới hạn 5
// ngày/lần cho mỗi hợp đồng.
//
// KHÔNG dùng chung Edge Function với create-account (function đó phục vụ
// request TRỰC TIẾP từ trình duyệt qua anon key; function này CHỈ được gọi
// bởi Supabase Cron/pg_cron nội bộ, kèm secret riêng CRON_SECRET để không ai
// gọi tràn lan từ bên ngoài gửi thông báo giả). Admin tự gửi thông báo TAY
// cho 1 khách bất kỳ thì dùng type "send-manual-notification" ở
// create-account (xem file đó) — không đi qua function này.

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
// @ts-ignore — thư viện Node "web-push" chạy được trên Deno qua npm: specifier (Supabase Edge Runtime hỗ trợ sẵn).
import webpush from 'npm:web-push@3.6.7';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const VAPID_PUBLIC_KEY = Deno.env.get('VAPID_PUBLIC_KEY')!;
const VAPID_PRIVATE_KEY = Deno.env.get('VAPID_PRIVATE_KEY')!;
// "Chủ sở hữu" khóa VAPID theo chuẩn Web Push — chỉ cần 1 email/URL liên hệ
// thật, các dịch vụ push (Google/Mozilla...) dùng để liên hệ nếu key bị lỗi,
// KHÔNG hiện ra cho người dùng cuối thấy.
const VAPID_SUBJECT = Deno.env.get('VAPID_SUBJECT') || 'mailto:admin@example.com';
const CRON_SECRET = Deno.env.get('CRON_SECRET'); // tùy chọn nhưng khuyến nghị đặt — xem docs
// Zalo OA (ZBS Template Message) — gửi tin qua số điện thoại khi hợp đồng
// ĐẾN HẠN/QUÁ HẠN, song song với thông báo đẩy. App ID + Secret Key là bí
// mật KHÔNG đổi, đặt cố định qua Secrets (xem docs mục 10). Refresh Token thì
// NGƯỢC LẠI — Zalo tự đổi (rotate) mỗi lần làm mới, nên phải lưu trong bảng
// zalo_oa_tokens (chỉ Edge Function này đọc/ghi được, không lộ ra ngoài) chứ
// không đặt cố định trong Secrets như 2 cái trên được.
const ZALO_APP_ID = Deno.env.get('ZALO_APP_ID');
const ZALO_SECRET_KEY = Deno.env.get('ZALO_SECRET_KEY');

const NEAR_DUE_START_DAYS = 10; // Bắt đầu nhắc "gần đến hạn/quá hạn" từ đúng X ngày trước hạn
const NEAR_DUE_REPEAT_DAYS = 3; // ...rồi lặp lại mỗi X ngày, cả trước lẫn sau ngày đến hạn, tới khi tất toán
const MONTHLY_REMINDER_OFFSETS = [0, 2]; // Lãi (nợ trong hạn): mỗi tháng nhắc đúng 2 LẦN — ngay ngày mốc (offset 0) và 2 ngày sau đó (offset 2), KHÔNG liên tục — nếu chưa đóng
// Ngưỡng RIÊNG để 2 mục Tầng 2 (báo lãi hàng tháng/theo ngày) tự CHUYỂN
// sang mẫu "Đến hạn/Quá hạn" thay vì tiếp tục báo lãi — báo trước khách
// hàng đúng 10 ngày theo yêu cầu. LƯU Ý: KHÁC với NEAR_DUE_DAYS_ZALO=15
// trong create-account/index.ts (ngưỡng riêng cho nút gửi tay tự chọn
// mẫu) — 2 ngưỡng này cố tình để khác nhau, không phải gõ nhầm.
const NEAR_DUE_DAYS_ZALO = 10;

const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);
webpush.setVapidDetails(VAPID_SUBJECT, VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY);

function daysBetween(a: Date, b: Date): number {
  const sa = new Date(a); sa.setHours(0, 0, 0, 0);
  const sb = new Date(b); sb.setHours(0, 0, 0, 0);
  return Math.round((sb.getTime() - sa.getTime()) / 86400000);
}

/** Y HỆT effectiveContractStatus() trong js/state.js. */
function effectiveStatus(contract: any, asOf: Date): 'da_tat_toan' | 'qua_han' | 'dang_vay' {
  if ((contract.balance || 0) <= 0) return 'da_tat_toan';
  if (daysBetween(new Date(contract.due_date), asOf) > 0) return 'qua_han';
  return 'dang_vay';
}

/** Y HỆT interestDaysAccrued() trong js/state.js (đã sửa đúng thứ tự +1 ngày đặc biệt rồi mới chặn về 0). */
function interestDaysAccrued(contract: any, asOf: Date): number {
  const paidUntil = contract.interest_paid_until || contract.disbursed_date;
  let days = daysBetween(new Date(paidUntil), asOf);
  if (contract.disbursed_date && daysBetween(new Date(contract.disbursed_date), new Date(paidUntil)) === 1) days += 1;
  return Math.max(0, days);
}

/** Y HỆT accruedInterest() trong js/state.js. */
function accruedInterest(contract: any, asOf: Date): number {
  if (effectiveStatus(contract, asOf) === 'da_tat_toan') return 0;
  const days = interestDaysAccrued(contract, asOf);
  const raw = Number(contract.balance) * days * (Number(contract.interest_rate) / 100) / 365;
  return Math.round(raw / 1000) * 1000;
}

function formatVND(n: number): string {
  return Math.round(n).toLocaleString('vi-VN') + 'đ';
}
function formatDateVN(iso: string): string {
  const d = new Date(iso);
  return `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}/${d.getFullYear()}`;
}

// Thông báo đẩy hệ thống (Notification API) KHÔNG hỗ trợ chữ đậm/HTML thật —
// mọi trình duyệt/điện thoại chỉ hiện được chữ thường trong nội dung thông
// báo, không có cách nào bật bold/markdown ở đó (giới hạn của chuẩn Web
// Push/Notification, không phải giới hạn riêng của app). Cách gần đúng nhất
// để số tiền/ngày "nổi bật" hơn hẳn phần chữ xung quanh: đổi CHỮ SỐ thường
// sang bộ ký tự Unicode "Mathematical Bold" — nhìn đậm hẳn trên hầu hết máy
// hiện đại dù về bản chất vẫn là text thường, không phải định dạng.
const BOLD_DIGITS = ['𝟎', '𝟏', '𝟐', '𝟑', '𝟒', '𝟓', '𝟔', '𝟕', '𝟖', '𝟗'];
function boldDigits(s: string): string {
  return s.replace(/[0-9]/g, (d) => BOLD_DIGITS[Number(d)]);
}
function formatVNDBold(n: number): string { return boldDigits(formatVND(n)); }
function formatDateVNBold(iso: string): string { return boldDigits(formatDateVN(iso)); }

/**
 * Mốc "ngày trong tháng" để nhắc lãi hàng tháng — xem ghi chú lịch nhắc #1
 * ở đầu file. Bình thường lấy ngày của interest_paid_until; riêng trường hợp
 * mới giải ngân (paidUntil = disbursed + đúng 1 ngày, theo quy ước tính lãi)
 * thì lấy ngày giải ngân làm mốc thay vì ngày bị lệch +1 đó.
 */
function interestAnchorDate(contract: any): Date {
  const disbursed = new Date(contract.disbursed_date);
  const paidUntil = new Date(contract.interest_paid_until || contract.disbursed_date);
  if (contract.disbursed_date && daysBetween(disbursed, paidUntil) === 1) return disbursed;
  return paidUntil;
}

/**
 * Ngày mốc nhắc lãi hàng tháng của ĐỢT GẦN NHẤT đã tới (<= today), tính từ
 * anchorDate — tự xử lý tháng thiếu ngày (VD: mốc ngày 31 thì tháng chỉ có 30
 * ngày sẽ tính là ngày cuối tháng đó, kiểu quy ước ngày thu phí định kỳ thông
 * thường). Trả về null nếu chưa qua tới đợt tháng sau đầu tiên.
 */
function latestMonthlyOccurrence(anchorDate: Date, today: Date): Date | null {
  const ay = anchorDate.getFullYear(), am = anchorDate.getMonth(), ad = anchorDate.getDate();
  const ty = today.getFullYear(), tm = today.getMonth();
  const occDayThisMonth = Math.min(ad, new Date(ty, tm + 1, 0).getDate());
  let occ = new Date(ty, tm, occDayThisMonth);
  if (occ > today) {
    // Chưa tới ngày mốc của tháng này -> đợt gần nhất là tháng TRƯỚC.
    const py = tm === 0 ? ty - 1 : ty, pm = tm === 0 ? 11 : tm - 1;
    occ = new Date(py, pm, Math.min(ad, new Date(py, pm + 1, 0).getDate()));
  }
  const monthDiff = (occ.getFullYear() - ay) * 12 + (occ.getMonth() - am);
  if (monthDiff < 1) return null; // chưa qua tới đợt tháng sau đầu tiên
  return occ;
}

/**
 * true nếu "today" ĐÚNG là 1 trong 2 ngày nhắc lãi của tháng gần nhất (ngày
 * mốc, hoặc đúng 2 ngày sau ngày mốc — xem MONTHLY_REMINDER_OFFSETS) — VD:
 * mốc ngày 13 -> đúng 13 và 15 mỗi tháng là true, còn lại trong tháng
 * (14, 16, 17...) là false, KHÔNG nhắc liên tục nhiều ngày liền. Xem ghi chú
 * lịch nhắc #1 ở đầu file.
 */
function isMonthlyReminderDay(anchorDate: Date, today: Date): boolean {
  const occ = latestMonthlyOccurrence(anchorDate, today);
  if (!occ) return false;
  const d = daysBetween(occ, today);
  return MONTHLY_REMINDER_OFFSETS.includes(d);
}

/**
 * Y HỆT isMonthlyReminderDay() nhưng CHỈ đúng 1 LẦN/tháng — đúng ngày mốc
 * (offset 0), KHÔNG lặp lại 2 ngày sau như thông báo đẩy — dùng riêng cho
 * Zalo OA mục "Báo lãi tự động hàng tháng" (điều kiện gửi giống hệt thông
 * báo đẩy trong hạn — "đúng ngày này tháng sau" — chỉ khác đúng ở việc
 * không nhắc lặp lại lần 2). intervalMonths (mặc định 1) cho phép báo mỗi
 * N tháng thay vì tháng nào cũng báo — VD 2 = "đúng ngày này 2 tháng sau",
 * đếm số tháng lệch so với đợt neo (anchorDate) rồi chỉ báo khi chia hết
 * cho N, KHÔNG cần lưu thêm mốc riêng nào khác.
 */
function isMonthlyReminderDayOnce(anchorDate: Date, today: Date, intervalMonths = 1): boolean {
  const occ = latestMonthlyOccurrence(anchorDate, today);
  if (!occ) return false;
  if (daysBetween(occ, today) !== 0) return false;
  const monthDiff = (occ.getFullYear() - anchorDate.getFullYear()) * 12 + (occ.getMonth() - anchorDate.getMonth());
  return monthDiff % intervalMonths === 0;
}

/**
 * Dùng cho Zalo OA mục "Gửi theo ngày cụ thể" — đúng ngày admin tự chọn
 * (customDay) trong tháng, VÀ đã đủ intervalMonths tháng kể từ THÁNG lựa
 * chọn này được tạo (createdAt) — cho phép báo mỗi N tháng thay vì tháng
 * nào cũng báo. VD: tạo lựa chọn vào tháng 3, ngày 15, interval=2 -> báo
 * đúng 15/3, 15/5, 15/7... (không báo 15/4, 15/6).
 */
function isCustomDayDue(customDay: number, createdAt: Date, today: Date, intervalMonths = 1): boolean {
  if (today.getDate() !== customDay) return false;
  const monthDiff = (today.getFullYear() - createdAt.getFullYear()) * 12 + (today.getMonth() - createdAt.getMonth());
  return monthDiff >= 0 && monthDiff % intervalMonths === 0;
}

async function sendPush(sub: { endpoint: string; p256dh: string; auth: string }, payload: Record<string, unknown>): Promise<boolean> {
  try {
    await webpush.sendNotification(
      { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
      JSON.stringify(payload)
    );
    return true;
  } catch (e: any) {
    // 404/410 = subscription đã hết hạn/bị trình duyệt thu hồi -> dọn khỏi DB luôn, khỏi thử lại vô ích.
    if (e && (e.statusCode === 404 || e.statusCode === 410)) {
      await admin.from('push_subscriptions').delete().eq('endpoint', sub.endpoint);
    } else {
      console.error('push send error:', e?.statusCode, e?.body || e);
    }
    return false;
  }
}

async function pushToCustomer(customerId: string, title: string, body: string, tag: string): Promise<boolean> {
  const { data: subs } = await admin.from('push_subscriptions').select('*').eq('owner_type', 'customer').eq('owner_id', customerId);
  if (!subs || !subs.length) return false;
  let anyOk = false;
  for (const sub of subs) {
    const ok = await sendPush(sub as any, { title, body, tag, url: './' });
    if (ok) anyOk = true;
  }
  return anyOk;
}

// ------------------------------------------------------------
// Zalo OA (ZBS Template Message) — xem ghi chú ở khai báo ZALO_APP_ID phía trên.
// ------------------------------------------------------------

/** Y HỆT stripDiacritics() trong js/utils.js — bỏ dấu tiếng Việt, in hoa, bỏ ký tự lạ, dùng cho nội dung chuyển khoản. */
function stripDiacriticsUpper(str: string): string {
  return str
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/đ/g, 'd').replace(/Đ/g, 'D')
    .replace(/\s*₫/g, 'd') // ký hiệu tiền "₫" là 1 ký tự riêng (U+20AB), NFD không đụng tới — xem utils.js
    .toUpperCase()
    .replace(/[^A-Z0-9 ]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Chuẩn hóa SĐT sang định dạng Zalo yêu cầu: mã quốc gia 84, không số 0 đầu, không dấu cách/gạch. */
function normalizeZaloPhone(phone: string): string {
  const digits = String(phone || '').replace(/\D/g, '');
  if (digits.startsWith('84')) return digits;
  if (digits.startsWith('0')) return '84' + digits.slice(1);
  return digits;
}

/**
 * Lấy Access Token OA hiện hành — tự làm mới bằng Refresh Token đang lưu
 * trong bảng zalo_oa_tokens mỗi lần Edge Function này chạy (Access Token chỉ
 * sống ~1 tiếng nên không cache dài hạn). Refresh Token Zalo trả về CÓ THỂ
 * khác Refresh Token cũ (tự xoay vòng) — ghi đè lại vào bảng luôn để lần chạy
 * sau vẫn dùng được. Trả về null nếu chưa cấu hình đủ (ZALO_APP_ID/SECRET_KEY
 * chưa đặt Secret, hoặc bảng zalo_oa_tokens chưa có dòng nào) — các nơi gọi
 * hàm này phải tự bỏ qua việc gửi Zalo khi null, KHÔNG được chặn cả hàm nhắc
 * lịch (thông báo đẩy vẫn phải chạy bình thường dù chưa cấu hình Zalo).
 */
async function getZaloAccessToken(): Promise<string | null> {
  if (!ZALO_APP_ID || !ZALO_SECRET_KEY) return null;
  const { data: tokenRow } = await admin.from('zalo_oa_tokens').select('*').eq('id', 'default').maybeSingle();
  if (!tokenRow?.refresh_token) return null;
  try {
    const res = await fetch('https://oauth.zaloapp.com/v4/oa/access_token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', secret_key: ZALO_SECRET_KEY },
      body: new URLSearchParams({ app_id: ZALO_APP_ID, grant_type: 'refresh_token', refresh_token: tokenRow.refresh_token }),
    });
    const json = await res.json();
    if (!json.access_token) { console.error('Lỗi làm mới Zalo access token:', json); return null; }
    await admin.from('zalo_oa_tokens').update({
      access_token: json.access_token,
      refresh_token: json.refresh_token || tokenRow.refresh_token,
      updated_at: new Date().toISOString(),
    }).eq('id', 'default');
    return json.access_token as string;
  } catch (e) {
    console.error('Lỗi gọi API làm mới Zalo access token:', e);
    return null;
  }
}

/**
 * Gửi 1 tin nhắn mẫu (ZBS Template Message) qua số điện thoại, TỰ GHI LOG vào
 * bảng zalo_send_log (cả thành công lẫn lỗi, kèm nội dung lỗi) — để trang
 * "Quản lý OA" > "Quản lý gửi tin" xem được. Trả về true nếu Zalo báo gửi
 * thành công (nghĩa là ZALO ĐÃ NHẬN yêu cầu gửi — CHƯA chắc đã tới máy khách,
 * xem "tracking_id" + zalo-webhook/index.ts để hiểu trạng thái "đã đến khách
 * hàng" được cập nhật riêng, muộn hơn, qua webhook).
 */
async function sendZaloTemplate(opts: {
  accessToken: string; phone: string; templateId: string; templateData: Record<string, string>;
  contractId: string; customerId: string; kind: string;
}): Promise<boolean> {
  let status: 'success' | 'error' = 'error';
  let errorMessage = '';
  // tracking_id do MÌNH tự sinh, gửi kèm cho Zalo — Zalo lát sau gọi webhook
  // báo "đã đến máy khách" sẽ đính kèm lại đúng tracking_id này, dùng để dò
  // ra đúng dòng log cần cập nhật (xem zalo-webhook/index.ts).
  const trackingId = `qtd-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  try {
    const res = await fetch('https://business.openapi.zalo.me/message/template', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', access_token: opts.accessToken },
      body: JSON.stringify({
        phone: normalizeZaloPhone(opts.phone),
        template_id: opts.templateId,
        template_data: opts.templateData,
        tracking_id: trackingId,
      }),
    });
    const json = await res.json();
    if (json.error === 0) { status = 'success'; } else { errorMessage = json.message || JSON.stringify(json); console.error('Lỗi gửi tin Zalo:', json); }
  } catch (e: any) {
    errorMessage = String(e?.message || e);
    console.error('Lỗi gọi API gửi tin Zalo:', e);
  }
  await admin.from('zalo_send_log').insert({
    contract_id: opts.contractId, customer_id: opts.customerId, kind: opts.kind, template_id: opts.templateId,
    phone: opts.phone, status, error_message: errorMessage || null, triggered_by: 'auto',
    tracking_id: status === 'success' ? trackingId : null,
  });
  return status === 'success';
}

/**
 * Định dạng số tiền cho MỌI tham số tiền trong mẫu Zalo OA — CHỈ chuỗi chữ
 * số thuần, không dấu chấm ngăn hàng nghìn, không chữ "đ". Đã thử thêm "đ"
 * (báo lỗi định dạng ở SO_TIEN_CHUYEN_KHOAN), rồi thử thêm dấu chấm (báo lỗi
 * tiếp ở LAI_PHAI_TRA) — Zalo validate các tham số tiền này rất nghiêm ngặt,
 * chỉ chấp nhận đúng số thuần. Quay lại định dạng CHUẨN ban đầu cho TẤT CẢ.
 */
function formatVNDZaloTemplate(n: number): string {
  return String(Math.round(n));
}

/** Cùng DẠNG với isNearOrPastDueZalo() trong create-account/index.ts nhưng dùng ngưỡng RIÊNG (10 ngày, xem NEAR_DUE_DAYS_ZALO ở trên) — true khi hợp đồng đã gần/tới/qua hạn. */
function isNearOrPastDueZalo(contract: any, asOf: Date): boolean {
  const d = daysBetween(asOf, new Date(contract.due_date));
  return d <= NEAR_DUE_DAYS_ZALO;
}

/**
 * Chọn mẫu Zalo cho 1 lần gửi Tầng 2 (báo lãi hàng tháng/theo ngày) — GẦN/ĐÃ
 * đến hạn thì tự CHUYỂN sang mẫu "Đến hạn/Quá hạn" thay vì tiếp tục báo lãi
 * (y hệt cách gửi tay tự chọn mẫu). Trả về null nếu mẫu tương ứng chưa cấu
 * hình Template ID — nơi gọi phải tự bỏ qua lần gửi đó, không báo lỗi.
 */
function pickZaloTemplate(ct: any, now: Date, orgRow: { zalo_template_due_id?: string | null; zalo_template_interest_id?: string | null } | null): { templateId: string; dueTemplate: boolean } | null {
  const dueTemplate = isNearOrPastDueZalo(ct, now);
  const templateId = dueTemplate ? orgRow?.zalo_template_due_id : orgRow?.zalo_template_interest_id;
  if (!templateId) return null;
  return { templateId, dueTemplate };
}

/**
 * Dựng template_data dùng chung cho cả 2 mẫu Zalo — "Đến hạn" (dueTemplate
 * = true, có đủ Gốc lẫn Lãi) và "Báo lãi" (dueTemplate = false, Gốc = 0 vì
 * chưa thật sự phải trả). Tên tham số y hệt mẫu 519351 (xem docs mục 10).
 * NGAY_KE_HOACH = ngày gửi tin (hôm nay), KHÔNG phải ngày đến hạn thật của
 * hợp đồng (đã có NGAY_DAO_HAN riêng) — theo đúng yêu cầu.
 */
function buildZaloTemplateData(ct: any, customer: { name: string; phone: string }, now: Date, dueTemplate: boolean): Record<string, string> {
  const interest = accruedInterest(ct, now);
  const goc = dueTemplate ? Number(ct.balance) : 0;
  const total = goc + interest;
  const nameNoDiacritics = stripDiacriticsUpper(customer.name || '');
  return {
    TEN_KHACH_HANG: customer.name || '',
    SO_HDTD: ct.code,
    SO_KHE_UOC: ct.code,
    SO_DU: formatVNDZaloTemplate(ct.balance),
    GOC_PHAI_TRA: formatVNDZaloTemplate(goc),
    LAI_PHAI_TRA: formatVNDZaloTemplate(interest),
    SO_TIEN_CHUYEN_KHOAN: formatVNDZaloTemplate(total),
    NGAY_KE_HOACH: formatDateVN(now.toISOString()),
    NOI_DUNG_CHUYEN_KHOAN: stripDiacriticsUpper(`THANH TOAN ${dueTemplate ? '' : 'LAI '}HDTD ${ct.code} ${nameNoDiacritics}`),
    NGAY_DAO_HAN: formatDateVN(ct.due_date),
  };
}

Deno.serve(async (req) => {
  if (CRON_SECRET) {
    const provided = req.headers.get('x-cron-secret') || '';
    if (provided !== CRON_SECRET) return new Response('Unauthorized', { status: 401 });
  }

  const now = new Date();
  const result = { laiHangThang: 0, ganDenHanQuaHan: 0, zaloBaoLai: 0 };

  // Tiêu đề thông báo LUÔN đồng nhất "<tên quỹ> thông báo:" cho mọi loại nhắc
  // (không còn tiêu đề riêng theo từng loại như trước) — khớp với tiêu đề
  // mặc định ở popup admin tự gửi tay (xem buildContractNotificationPreset()
  // trong js/views/admin/customers.js).
  const { data: orgRow } = await admin.from('orgs').select('short_name, zalo_template_interest_id, zalo_template_due_id').limit(1).maybeSingle();
  const NOTI_TITLE = `${orgRow?.short_name || 'Quỹ tín dụng'} thông báo:`;

  const { data: contracts, error: ctErr } = await admin.from('contracts').select('*');
  if (ctErr) return new Response(JSON.stringify({ ok: false, reason: ctErr.message }), { status: 500 });

  // Cần thêm tên + SĐT khách hàng để gửi Zalo (bảng contracts không có sẵn 2 cột này).
  const { data: customersData } = await admin.from('customers').select('id, name, phone');
  const customerMap = new Map<string, { name: string; phone: string }>(
    (customersData || []).map((c: any) => [c.id, { name: c.name, phone: c.phone }])
  );

  // Chỉ tốn 1 lần làm mới token/lượt chạy (không phải mỗi hợp đồng 1 lần) —
  // và CHỈ làm khi đã cấu hình ÍT NHẤT 1 trong 2 mẫu (mục Quản lý OA > Cấu
  // hình), tránh gọi API Zalo vô ích lúc chưa cấu hình gì.
  const zaloAccessToken = (orgRow?.zalo_template_interest_id || orgRow?.zalo_template_due_id) ? await getZaloAccessToken() : null;

  // Tầng 2 "Gửi tin tự động" — CHỈ còn 2 mục báo lãi (loại trừ nhau, 1 hợp
  // đồng chỉ ở 1 trong 2): 'lai_hang_thang_auto' theo đúng lịch nhắc lãi
  // hàng tháng sẵn có (isMonthlyReminderDay), 'lai_hang_thang_custom_day'
  // gửi vào ngày admin tự chọn (custom_day). intervalMonths (1-4, mặc định
  // 1) cho phép báo mỗi N tháng thay vì tháng nào cũng báo — áp dụng cho
  // cả 2 mục, xem isMonthlyReminderDayOnce()/isCustomDayDue().
  const { data: autoSendRows } = await admin.from('zalo_auto_send_list').select('contract_id, kind, custom_day, interval_months, created_at');
  const autoSendMap = new Map<string, { kind: string; customDay: number | null; intervalMonths: number; createdAt: string }>(
    (autoSendRows || []).map((r: any) => [r.contract_id, { kind: r.kind, customDay: r.custom_day, intervalMonths: r.interval_months || 1, createdAt: r.created_at }])
  );

  /** Có nên gửi thông báo "kind" cho 1 hợp đồng cụ thể hôm nay không — chặn gửi lại trong cùng 1 ngày. */
  async function shouldSend(contractId: string, kind: string): Promise<boolean> {
    const { data } = await admin.from('notification_log').select('sent_at')
      .eq('contract_id', contractId).eq('kind', kind)
      .order('sent_at', { ascending: false }).limit(1);
    if (!data || !data.length) return true;
    return daysBetween(new Date(data[0].sent_at), now) >= 1;
  }
  async function logSent(customerId: string, contractId: string, kind: string) {
    await admin.from('notification_log').insert({ owner_id: customerId, contract_id: contractId, kind, sent_at: now.toISOString() });
  }

  for (const ct of contracts || []) {
    const status = effectiveStatus(ct, now);
    if (status === 'da_tat_toan') continue;

    // 1) Lãi — mỗi tháng nhắc đúng 2 lần (ngày mốc + 2 ngày sau đó), nếu
    // chưa đóng thì lặp lại y hệt vào đợt tháng sau, không nhắc liên tục.
    if (isMonthlyReminderDay(interestAnchorDate(ct), now)) {
      if (await shouldSend(ct.id, 'lai_hang_thang')) {
        const ok = await pushToCustomer(
          ct.customer_id, NOTI_TITLE,
          `Hợp đồng ${ct.code} của quý khách số tiền lãi đến nay là: ${formatVND(accruedInterest(ct, now))}. Vui lòng thanh toán lãi hàng tháng đúng hạn.`,
          'lai-hang-thang'
        );
        if (ok) { await logSent(ct.customer_id, ct.id, 'lai_hang_thang'); result.laiHangThang++; }
      }
    }

    // Zalo OA — mục "Báo lãi tự động hàng tháng" (Tầng 2): điều kiện gửi
    // GIỐNG HỆT thông báo đẩy trong hạn ở trên ("đúng ngày này tháng sau",
    // dùng chung interestAnchorDate) nhưng CHỈ gửi ĐÚNG 1 LẦN/đợt (không lặp
    // lại lần 2 như push) — xem isMonthlyReminderDayOnce(). Mặc định mỗi
    // tháng 1 lần, admin chọn định kỳ 2/3/4 tháng thì báo thưa hơn (autoEntry.
    // intervalMonths). CHỈ gửi cho hợp đồng admin đã tự chọn vào ĐÚNG mục
    // này (autoSendMap). Gần/đã đến hạn thì tự chuyển sang mẫu "Đến hạn/Quá
    // hạn" (xem pickZaloTemplate).
    {
      const autoEntry = autoSendMap.get(ct.id);
      if (autoEntry?.kind === 'lai_hang_thang_auto' && zaloAccessToken
        && isMonthlyReminderDayOnce(interestAnchorDate(ct), now, autoEntry.intervalMonths)) {
        const picked = pickZaloTemplate(ct, now, orgRow);
        if (picked) {
          const customer = customerMap.get(ct.customer_id);
          if (customer?.phone && await shouldSend(ct.id, 'zalo_lai_hang_thang')) {
            const zaloOk = await sendZaloTemplate({
              accessToken: zaloAccessToken, phone: customer.phone, templateId: picked.templateId,
              templateData: buildZaloTemplateData(ct, customer, now, picked.dueTemplate),
              contractId: ct.id, customerId: ct.customer_id, kind: 'lai_hang_thang_auto',
            });
            if (zaloOk) { await logSent(ct.customer_id, ct.id, 'zalo_lai_hang_thang'); result.zaloBaoLai++; }
          }
        }
      }
    }

    // Zalo OA — mục "Gửi theo ngày cụ thể" (Tầng 2): gửi vào ngày admin tự
    // chọn (custom_day), không phụ thuộc lịch nhắc lãi hàng tháng thông
    // thường ở trên — mặc định mỗi tháng 1 lần, chọn định kỳ 2/3/4 tháng thì
    // báo thưa hơn kể từ THÁNG tạo lựa chọn (xem isCustomDayDue()). CHỈ gửi
    // nếu số ngày đã tính lãi (kể từ lần đóng lãi gần nhất) đã QUÁ 20 ngày —
    // mới đóng lãi gần đây (<=20 ngày) thì bỏ qua đợt này, để dồn qua đợt kế
    // tiếp (không có gì phải nhắc ngay lúc khách vừa đóng). Gần/đã đến hạn
    // thì tự chuyển sang mẫu "Đến hạn/Quá hạn" (xem pickZaloTemplate).
    {
      const autoEntry = autoSendMap.get(ct.id);
      if (autoEntry?.kind === 'lai_hang_thang_custom_day' && autoEntry.customDay
        && isCustomDayDue(autoEntry.customDay, new Date(autoEntry.createdAt), now, autoEntry.intervalMonths)
        && interestDaysAccrued(ct, now) > 20 && zaloAccessToken) {
        const picked = pickZaloTemplate(ct, now, orgRow);
        if (picked) {
          const customer = customerMap.get(ct.customer_id);
          if (customer?.phone && await shouldSend(ct.id, 'zalo_lai_ngay_cu_the')) {
            const zaloOk = await sendZaloTemplate({
              accessToken: zaloAccessToken, phone: customer.phone, templateId: picked.templateId,
              templateData: buildZaloTemplateData(ct, customer, now, picked.dueTemplate),
              contractId: ct.id, customerId: ct.customer_id, kind: 'lai_hang_thang_custom_day',
            });
            if (zaloOk) { await logSent(ct.customer_id, ct.id, 'zalo_lai_ngay_cu_the'); result.zaloBaoLai++; }
          }
        }
      }
    }

    // 2) Gần đến hạn/quá hạn — mỗi 3 ngày kể từ 10 ngày trước hạn, liên tục
    // tới khi tất toán. Nội dung + giọng điệu đổi khác nhau tùy còn trước
    // hạn hay đã tới/qua hạn.
    const daysToDue = daysBetween(now, new Date(ct.due_date));
    if (daysToDue <= NEAR_DUE_START_DAYS && (NEAR_DUE_START_DAYS - daysToDue) % NEAR_DUE_REPEAT_DAYS === 0) {
      if (await shouldSend(ct.id, 'gan_den_han')) {
        let body: string;
        if (daysToDue > 0) {
          body = `Hợp đồng ${ct.code} của quý khách đã GẦN ĐẾN HẠN. Số tiền gốc là ${formatVNDBold(ct.balance)} và lãi đến nay là: ${formatVNDBold(accruedInterest(ct, now))}. Vui lòng thanh toán trước ngày ${formatDateVNBold(ct.due_date)}.`;
        } else {
          body = `Hợp đồng ${ct.code} ĐÃ TRỄ HẠN. Số tiền gốc là ${formatVNDBold(ct.balance)}, lãi đến nay là: ${formatVNDBold(accruedInterest(ct, now))}. Yêu cầu quý khách thanh toán và thực hiện đúng như cam kết.`;
        }
        const ok = await pushToCustomer(ct.customer_id, NOTI_TITLE, body, 'gan-den-han');
        if (ok) { await logSent(ct.customer_id, ct.id, 'gan_den_han'); result.ganDenHanQuaHan++; }
        // Zalo OA KHÔNG còn tự động gửi cho "gần đến hạn/đến hạn" nữa (theo
        // yêu cầu) — mẫu "Đến hạn" giờ CHỈ gửi được qua nút gửi tay ở chi
        // tiết hợp đồng (type 'send-zalo-manual' trong create-account), tự
        // chọn mẫu theo tình huống. Thông báo đẩy (push) ở trên vẫn giữ
        // nguyên lịch tự động như cũ, không đổi.
      }
    }
  }

  return new Response(JSON.stringify({ ok: true, ...result }), { headers: { 'Content-Type': 'application/json' } });
});
