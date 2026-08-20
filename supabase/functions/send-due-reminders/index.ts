// Edge Function CHẠY ĐỊNH KỲ MỖI NGÀY (đặt lịch qua Supabase Cron — xem
// docs/supabase-migration.md mục "Thông báo đẩy") — quét toàn bộ hợp đồng
// còn dư nợ, gửi thông báo đẩy (Web Push) cho ĐÚNG khách hàng đã bật thông
// báo trên thiết bị của họ (bảng push_subscriptions). Lịch nhắc:
//   1. Lãi: cứ mỗi 30 ngày kể từ "Đã trả lãi đến ngày" (hoặc ngày giải ngân
//      nếu chưa trả lãi lần nào) mà KHÔNG đổi (khách chưa đóng) thì nhắc lại
//      — 1 lần ở ngày 30, 1 lần ở ngày 60 (nếu vẫn chưa đóng), ngày 90...
//   2. Gần đến hạn: đúng NOTIFY_BEFORE_DUE_DAYS (5) ngày trước ngày đến hạn
//      của hợp đồng — nhắc ĐÚNG 1 LẦN.
//   3. Đến hạn: đúng ngày đến hạn — nhắc ĐÚNG 1 LẦN.
//   4. Trễ hạn: sau ngày đến hạn — nhắc LẠI MỖI NGÀY cho tới khi tất toán.
// Chống gửi trùng bằng bảng notification_log (ghi lại lần gửi gần nhất theo
// từng hợp đồng + loại nhắc).
//
// KHÔNG dùng chung Edge Function với create-account (function đó phục vụ
// request TRỰC TIẾP từ trình duyệt qua anon key; function này CHỈ được gọi
// bởi Supabase Cron/pg_cron nội bộ, kèm secret riêng CRON_SECRET để không ai
// gọi tràn lan từ bên ngoài gửi thông báo giả).

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

const INTEREST_CYCLE_DAYS = 30; // Nhắc lãi lặp lại mỗi X ngày kể từ lần trả lãi gần nhất
const NOTIFY_BEFORE_DUE_DAYS = 5; // Nhắc "sắp đến hạn" trước đúng X ngày (1 lần duy nhất)
const ONCE_EVER_DEDUPE_DAYS = 3650; // Dùng cho các mốc chỉ nhắc ĐÚNG 1 LẦN trong đời hợp đồng (sắp đến hạn, đến hạn) — 10 năm coi như "không nhắc lại nữa"

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
  const result = { laiChu30Ngay: 0, ganDenHan: 0, denHan: 0, treHan: 0 };

  const { data: contracts, error: ctErr } = await admin.from('contracts').select('*');
  if (ctErr) return new Response(JSON.stringify({ ok: false, reason: ctErr.message }), { status: 500 });

  /** Có nên gửi thông báo "kind" cho 1 hợp đồng cụ thể hôm nay không — chặn gửi lại quá dày. */
  async function shouldSend(contractId: string, kind: string, minDaysBetween: number): Promise<boolean> {
    const { data } = await admin.from('notification_log').select('sent_at')
      .eq('contract_id', contractId).eq('kind', kind)
      .order('sent_at', { ascending: false }).limit(1);
    if (!data || !data.length) return true;
    return daysBetween(new Date(data[0].sent_at), now) >= minDaysBetween;
  }
  async function logSent(customerId: string, contractId: string, kind: string) {
    await admin.from('notification_log').insert({ owner_id: customerId, contract_id: contractId, kind, sent_at: now.toISOString() });
  }

  for (const ct of contracts || []) {
    const status = effectiveStatus(ct, now);
    if (status === 'da_tat_toan') continue;

    // 1) Lãi mỗi 30 ngày kể từ "Đã trả lãi đến ngày" — khách không đóng thì
    // cứ đúng chu kỳ 30 ngày lại nhắc tiếp (60, 90 ngày...), đóng lãi rồi
    // (interest_paid_until được cập nhật) thì tự tính lại từ ngày mới.
    const interestDays = interestDaysAccrued(ct, now);
    if (interestDays > 0 && interestDays % INTEREST_CYCLE_DAYS === 0) {
      if (await shouldSend(ct.id, 'lai_30_ngay', 1)) {
        const ok = await pushToCustomer(
          ct.customer_id, 'Thông báo tiền lãi',
          `Hợp đồng ${ct.code}: số tiền lãi của quý khách hiện là ${formatVND(accruedInterest(ct, now))}. Vui lòng thanh toán lãi hàng tháng đúng hạn.`,
          'lai-30-ngay'
        );
        if (ok) { await logSent(ct.customer_id, ct.id, 'lai_30_ngay'); result.laiChu30Ngay++; }
      }
    }

    // 2), 3), 4) Theo ngày đến hạn
    const daysToDue = daysBetween(now, new Date(ct.due_date));
    if (daysToDue === NOTIFY_BEFORE_DUE_DAYS) {
      if (await shouldSend(ct.id, 'gan_den_han', ONCE_EVER_DEDUPE_DAYS)) {
        const ok = await pushToCustomer(
          ct.customer_id, 'Sắp đến hạn thanh toán',
          `Hợp đồng ${ct.code} còn ${NOTIFY_BEFORE_DUE_DAYS} ngày nữa đến hạn (${ct.due_date}) — dư nợ ${formatVND(ct.balance)}.`,
          'gan-den-han'
        );
        if (ok) { await logSent(ct.customer_id, ct.id, 'gan_den_han'); result.ganDenHan++; }
      }
    } else if (daysToDue === 0) {
      if (await shouldSend(ct.id, 'den_han', ONCE_EVER_DEDUPE_DAYS)) {
        const ok = await pushToCustomer(
          ct.customer_id, 'Đến hạn thanh toán hôm nay',
          `Hợp đồng ${ct.code} đến hạn thanh toán hôm nay — dư nợ ${formatVND(ct.balance)}. Vui lòng thanh toán đúng hạn.`,
          'den-han'
        );
        if (ok) { await logSent(ct.customer_id, ct.id, 'den_han'); result.denHan++; }
      }
    } else if (daysToDue < 0) {
      if (await shouldSend(ct.id, 'tre_han', 1)) {
        const ok = await pushToCustomer(
          ct.customer_id, 'Hợp đồng đã trễ hạn',
          `Hợp đồng ${ct.code} đã trễ hạn ${Math.abs(daysToDue)} ngày — dư nợ ${formatVND(ct.balance)}. Vui lòng liên hệ quỹ tín dụng sớm.`,
          'tre-han'
        );
        if (ok) { await logSent(ct.customer_id, ct.id, 'tre_han'); result.treHan++; }
      }
    }
  }

  return new Response(JSON.stringify({ ok: true, ...result }), { headers: { 'Content-Type': 'application/json' } });
});
