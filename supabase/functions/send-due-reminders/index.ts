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

const NEAR_DUE_START_DAYS = 10; // Bắt đầu nhắc "gần đến hạn/quá hạn" từ đúng X ngày trước hạn
const NEAR_DUE_REPEAT_DAYS = 3; // ...rồi lặp lại mỗi X ngày, cả trước lẫn sau ngày đến hạn, tới khi tất toán
const MONTHLY_REMINDER_OFFSETS = [0, 2]; // Lãi (nợ trong hạn): mỗi tháng nhắc đúng 2 LẦN — ngay ngày mốc (offset 0) và 2 ngày sau đó (offset 2), KHÔNG liên tục — nếu chưa đóng

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

Deno.serve(async (req) => {
  if (CRON_SECRET) {
    const provided = req.headers.get('x-cron-secret') || '';
    if (provided !== CRON_SECRET) return new Response('Unauthorized', { status: 401 });
  }

  const now = new Date();
  const result = { laiHangThang: 0, ganDenHanQuaHan: 0 };

  // Tiêu đề thông báo LUÔN đồng nhất "<tên quỹ> thông báo:" cho mọi loại nhắc
  // (không còn tiêu đề riêng theo từng loại như trước) — khớp với tiêu đề
  // mặc định ở popup admin tự gửi tay (xem buildContractNotificationPreset()
  // trong js/views/admin/customers.js).
  const { data: orgRow } = await admin.from('orgs').select('short_name').limit(1).maybeSingle();
  const NOTI_TITLE = `${orgRow?.short_name || 'Quỹ tín dụng'} thông báo:`;

  const { data: contracts, error: ctErr } = await admin.from('contracts').select('*');
  if (ctErr) return new Response(JSON.stringify({ ok: false, reason: ctErr.message }), { status: 500 });

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
          `Hợp đồng ${ct.code}: số tiền lãi của quý khách hiện là ${formatVND(accruedInterest(ct, now))}. Vui lòng thanh toán lãi hàng tháng đúng hạn.`,
          'lai-hang-thang'
        );
        if (ok) { await logSent(ct.customer_id, ct.id, 'lai_hang_thang'); result.laiHangThang++; }
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
      }
    }
  }

  return new Response(JSON.stringify({ ok: true, ...result }), { headers: { 'Content-Type': 'application/json' } });
});
