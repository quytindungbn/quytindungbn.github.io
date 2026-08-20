// Edge Function CHẠY ĐỊNH KỲ (đặt lịch qua Supabase Cron — xem
// docs/supabase-migration.md mục "Thông báo đẩy") — quét toàn bộ hợp đồng
// còn dư nợ, gửi thông báo đẩy (Web Push) cho ĐÚNG khách hàng đã bật thông
// báo trên thiết bị của họ (bảng push_subscriptions), khi:
//   1. Hợp đồng sắp đến hạn (trong NEAR_DUE_DAYS ngày) — nhắc 1 lần/hợp đồng.
//   2. Hợp đồng đã quá hạn — nhắc lại định kỳ mỗi OVERDUE_REMIND_EVERY_DAYS
//      ngày cho tới khi tất toán.
//   3. Ngày 1 đầu tháng — nhắc tổng quan (đúng yêu cầu "thông báo khi tới
//      tháng") cho khách đang có khoản vay hoạt động.
// Chống gửi trùng bằng bảng notification_log (ghi lại lần gửi gần nhất).
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

const NEAR_DUE_DAYS = 15; // Y HỆT js/state.js — đổi thì đổi cả 2 nơi cho khớp
const OVERDUE_REMIND_EVERY_DAYS = 7;
const MONTHLY_DEDUPE_DAYS = 20; // đủ dài để không gửi trùng trong cùng 1 tháng dù cron chạy lại nhiều lần ngày 1

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

function formatVND(n: number): string {
  return Math.round(n).toLocaleString('vi-VN') + 'đ'; // "đ"
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
  const result = { nearDue: 0, overdue: 0, monthly: 0 };

  const { data: contracts, error: ctErr } = await admin.from('contracts').select('*');
  if (ctErr) return new Response(JSON.stringify({ ok: false, reason: ctErr.message }), { status: 500 });

  // Gom theo khách hàng — 1 khách nhiều hợp đồng cùng loại nhắc thì vẫn tính
  // riêng từng hợp đồng (dedupe theo contract_id), KHÔNG gộp chung 1 thông
  // báo, để khách biết chính xác hợp đồng nào cần chú ý.
  const nearDueByCustomer = new Map<string, any[]>();
  const overdueByCustomer = new Map<string, any[]>();
  const activeByCustomer = new Map<string, any[]>();

  for (const ct of contracts || []) {
    const status = effectiveStatus(ct, now);
    if (status === 'da_tat_toan') continue;
    if (!activeByCustomer.has(ct.customer_id)) activeByCustomer.set(ct.customer_id, []);
    activeByCustomer.get(ct.customer_id)!.push(ct);
    if (status === 'qua_han') {
      if (!overdueByCustomer.has(ct.customer_id)) overdueByCustomer.set(ct.customer_id, []);
      overdueByCustomer.get(ct.customer_id)!.push(ct);
    } else {
      const d = daysBetween(now, new Date(ct.due_date));
      if (d >= 0 && d <= NEAR_DUE_DAYS) {
        if (!nearDueByCustomer.has(ct.customer_id)) nearDueByCustomer.set(ct.customer_id, []);
        nearDueByCustomer.get(ct.customer_id)!.push(ct);
      }
    }
  }

  /** Có nên gửi thông báo "kind" (gắn 1 hợp đồng cụ thể hoặc chung cho khách nếu contractId=null) hôm nay không — chặn gửi lại quá dày. */
  async function shouldSend(ownerId: string, kind: string, contractId: string | null, minDaysBetween: number): Promise<boolean> {
    let q = admin.from('notification_log').select('sent_at').eq('owner_id', ownerId).eq('kind', kind).order('sent_at', { ascending: false }).limit(1);
    q = contractId ? q.eq('contract_id', contractId) : q.is('contract_id', null);
    const { data } = await q;
    if (!data || !data.length) return true;
    return daysBetween(new Date(data[0].sent_at), now) >= minDaysBetween;
  }
  async function logSent(ownerId: string, kind: string, contractId: string | null) {
    await admin.from('notification_log').insert({ owner_id: ownerId, kind, contract_id: contractId, sent_at: now.toISOString() });
  }

  // 1) Sắp đến hạn
  for (const [customerId, cts] of nearDueByCustomer) {
    for (const ct of cts) {
      if (!(await shouldSend(customerId, 'gan_den_han', ct.id, NEAR_DUE_DAYS))) continue;
      const ok = await pushToCustomer(
        customerId, 'Sắp đến hạn thanh toán',
        `Hợp đồng ${ct.code} đến hạn ngày ${ct.due_date} — dư nợ ${formatVND(ct.balance)}.`,
        'gan-den-han'
      );
      if (ok) { await logSent(customerId, 'gan_den_han', ct.id); result.nearDue++; }
    }
  }

  // 2) Quá hạn — nhắc định kỳ tới khi tất toán
  for (const [customerId, cts] of overdueByCustomer) {
    for (const ct of cts) {
      if (!(await shouldSend(customerId, 'qua_han', ct.id, OVERDUE_REMIND_EVERY_DAYS))) continue;
      const ok = await pushToCustomer(
        customerId, 'Hợp đồng đã quá hạn',
        `Hợp đồng ${ct.code} đã quá hạn thanh toán — dư nợ ${formatVND(ct.balance)}. Vui lòng liên hệ quỹ tín dụng sớm.`,
        'qua-han'
      );
      if (ok) { await logSent(customerId, 'qua_han', ct.id); result.overdue++; }
    }
  }

  // 3) Nhắc đầu tháng — đúng yêu cầu "thông báo khi tới tháng"
  if (now.getDate() === 1) {
    for (const [customerId, cts] of activeByCustomer) {
      if (!(await shouldSend(customerId, 'monthly', null, MONTHLY_DEDUPE_DAYS))) continue;
      const totalBalance = cts.reduce((s, c) => s + Number(c.balance || 0), 0);
      const ok = await pushToCustomer(
        customerId, 'Nhắc lịch đầu tháng',
        `Bạn đang có ${cts.length} hợp đồng vay, tổng dư nợ ${formatVND(totalBalance)}. Mở app để xem chi tiết lãi phát sinh.`,
        'nhac-thang'
      );
      if (ok) { await logSent(customerId, 'monthly', null); result.monthly++; }
    }
  }

  return new Response(JSON.stringify({ ok: true, ...result }), { headers: { 'Content-Type': 'application/json' } });
});
