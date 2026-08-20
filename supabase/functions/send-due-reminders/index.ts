// Edge Function CHẠY ĐỊNH KỲ MỖI NGÀY (đặt lịch qua Supabase Cron — xem
// docs/supabase-migration.md mục "Thông báo đẩy") — quét toàn bộ hợp đồng
// còn dư nợ, gửi thông báo đẩy (Web Push) cho ĐÚNG khách hàng đã bật thông
// báo trên thiết bị của họ (bảng push_subscriptions). Lịch nhắc:
//   1. Lãi: nhắc lại ĐÚNG NGÀY (trong tháng) của "Đã trả lãi đến ngày" mỗi
//      tháng 1 lần, bắt đầu từ THÁNG SAU — VD: trả lãi đến ngày 17/08 thì
//      17/09 nhắc, rồi 17/10, 17/11... nhắc liên tục mỗi tháng cho tới khi
//      khách đóng lãi (interest_paid_until đổi ngày mới thì tự tính lại chu
//      kỳ từ ngày mới). Trường hợp mới giải ngân — hệ thống tự set
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
 * true nếu "today" đúng là "ngày này" của 1 tháng SAU (hoặc sau nữa) tháng
 * chứa anchorDate — tự xử lý tháng thiếu ngày (VD: mốc ngày 31 thì tháng chỉ
 * có 30 ngày sẽ tính là ngày cuối tháng đó, kiểu quy ước ngày thu phí định kỳ
 * thông thường).
 */
function isMonthlyAnniversary(anchorDate: Date, today: Date): boolean {
  const ay = anchorDate.getFullYear(), am = anchorDate.getMonth(), ad = anchorDate.getDate();
  const ty = today.getFullYear(), tm = today.getMonth(), td = today.getDate();
  const monthDiff = (ty - ay) * 12 + (tm - am);
  if (monthDiff < 1) return false; // chưa qua tới tháng sau
  const daysInTargetMonth = new Date(ty, tm + 1, 0).getDate();
  const expectedDay = Math.min(ad, daysInTargetMonth);
  return td === expectedDay;
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

    // 1) Lãi — đúng ngày trong tháng của mốc lãi, mỗi tháng 1 lần, liên tục.
    if (isMonthlyAnniversary(interestAnchorDate(ct), now)) {
      if (await shouldSend(ct.id, 'lai_hang_thang')) {
        const ok = await pushToCustomer(
          ct.customer_id, 'Thông báo tiền lãi',
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
        let title: string, body: string;
        if (daysToDue > 0) {
          title = 'Sắp đến hạn thanh toán';
          body = `Hợp đồng ${ct.code}: Số tiền gốc gần đến hạn là ${formatVNDBold(ct.balance)} và lãi đến nay là ${formatVNDBold(accruedInterest(ct, now))}, yêu cầu thanh toán trước ngày ${formatDateVNBold(ct.due_date)}.`;
        } else {
          title = '⚠️ QUÁ HẠN THANH TOÁN';
          const daysLate = Math.abs(daysToDue);
          body = `Hợp đồng ${ct.code} đã quá hạn ${daysLate} ngày. Yêu cầu thanh toán số tiền gốc là ${formatVNDBold(ct.balance)} và lãi là ${formatVNDBold(accruedInterest(ct, now))}. Nếu không sẽ bị phạt lãi quá hạn.`;
        }
        const ok = await pushToCustomer(ct.customer_id, title, body, 'gan-den-han');
        if (ok) { await logSent(ct.customer_id, ct.id, 'gan_den_han'); result.ganDenHanQuaHan++; }
      }
    }
  }

  return new Response(JSON.stringify({ ok: true, ...result }), { headers: { 'Content-Type': 'application/json' } });
});
