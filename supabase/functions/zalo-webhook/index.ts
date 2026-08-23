// Edge Function RIÊNG, NHẬN WEBHOOK TỪ ZALO (không phải app gọi) — Zalo OA
// gọi function này khi 1 tin ZBS Template Message đã gửi trước đó (xem
// create-account/index.ts + send-due-reminders/index.ts) THỰC SỰ TỚI ĐƯỢC
// máy khách hàng — khác với lúc gửi, lúc đó chỉ biết ZALO ĐÃ NHẬN yêu cầu gửi
// (status='success' trong zalo_send_log), CHƯA chắc khách đã nhận được tin.
//
// Cơ chế đối chiếu: lúc gửi tin, mình tự sinh 1 "tracking_id" ngẫu nhiên gửi
// kèm cho Zalo (VD: qtd-172...-abc123), lưu luôn vào cột tracking_id của
// đúng dòng zalo_send_log vừa ghi. Khi Zalo gọi webhook này báo "đã tới máy
// khách", Zalo đính kèm lại ĐÚNG tracking_id đó trong payload — mình dò tìm
// đúng dòng log có tracking_id trùng khớp, cập nhật delivered_at = thời điểm
// nhận được webhook. Trang "Quản lý gửi tin" (js/views/admin/zaloOA.js) dựa
// vào delivered_at có/không để phân biệt 2 trạng thái "Đã gửi tới Zalo" (chỉ
// mới success, delivered_at còn trống) và "Đã đến khách hàng" (delivered_at
// đã có).
//
// LƯU Ý QUAN TRỌNG lúc deploy: function này PHẢI tắt "Verify JWT" trong cấu
// hình function trên Supabase Dashboard — Zalo gọi tới KHÔNG kèm theo bất kỳ
// Authorization header nào (khác các Edge Function khác của app luôn có JWT/
// anon key đính kèm), bật "Verify JWT" sẽ khiến Supabase tự chặn ở tầng
// gateway (401) TRƯỚC KHI code trong file này kịp chạy, xem docs mục 10.21.
//
// LƯU Ý VỀ ĐỘ CHÍNH XÁC: cấu trúc payload thật của webhook Zalo gửi qua (tên
// field "event_name"/"tracking_id" nằm ở đâu trong JSON) được tra từ tài
// liệu công khai — KHÔNG có điều kiện gọi thẳng Zalo để tự kiểm thử trước.
// Vì vậy code dưới đây dò tìm tracking_id ở NHIỀU vị trí khả dĩ trong payload
// (phòng trường hợp đoán sai đúng 1 vị trí), và LUÔN ghi log toàn bộ payload
// thô ra console — nếu sau khi deploy vẫn không thấy delivered_at được cập
// nhật, xem log function này trên Supabase Dashboard (mục Logs) để biết
// chính xác payload thật trông ra sao, gửi lại cho biết để chỉnh đúng.

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
// Dùng ĐÚNG App ID đã cấu hình cho Zalo OA của Quỹ (đã có sẵn secret này,
// dùng chung với create-account/send-due-reminders) — đối chiếu lỏng (nếu có
// app_id trong payload thì phải khớp) để tránh 1 webhook tình cờ/giả mạo từ
// app Zalo khác cập nhật nhầm log của Quỹ. Không xác minh chữ ký (signature)
// vì chưa tra được đúng thuật toán Zalo dùng — chấp nhận được vì đây chỉ là
// cập nhật 1 cờ trạng thái hiển thị (không phải hành động tài chính/nhạy cảm).
const ZALO_APP_ID = Deno.env.get('ZALO_APP_ID');

const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

/** Dò tìm 1 field ở NHIỀU vị trí khả dĩ trong payload JSON (phòng trường hợp đoán sai đúng 1 cấu trúc). */
function findField(obj: any, keys: string[]): string | null {
  if (!obj || typeof obj !== 'object') return null;
  for (const key of keys) {
    if (typeof obj[key] === 'string' && obj[key]) return obj[key];
  }
  // Dò thêm 1 lớp lồng bên trong các object con thường gặp trong webhook Zalo.
  for (const wrapper of ['message', 'data', 'sender', 'recipient']) {
    const inner = obj[wrapper];
    if (inner && typeof inner === 'object') {
      for (const key of keys) {
        if (typeof inner[key] === 'string' && inner[key]) return inner[key];
      }
    }
  }
  return null;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });

  let body: Record<string, any> = {};
  try { body = await req.json(); } catch { /* payload rỗng/không phải JSON — bỏ qua, vẫn trả 200 */ }

  // Ghi lại TOÀN BỘ payload thô — chỗ duy nhất để biết cấu trúc thật nếu suy
  // đoán bên dưới chưa khớp, xem "Logs" của function này trên Supabase Dashboard.
  console.log('Zalo webhook nhận được:', JSON.stringify(body));

  try {
    const appId = findField(body, ['app_id', 'appId', 'oa_id', 'oaId']);
    if (ZALO_APP_ID && appId && appId !== ZALO_APP_ID) {
      console.warn('Zalo webhook có app_id không khớp cấu hình, bỏ qua:', appId);
      return new Response(JSON.stringify({ ok: true }), { headers: { ...CORS, 'Content-Type': 'application/json' } });
    }

    const trackingId = findField(body, ['tracking_id', 'trackingId']);
    if (trackingId) {
      const { error } = await admin
        .from('zalo_send_log')
        .update({ delivered_at: new Date().toISOString() })
        .eq('tracking_id', trackingId)
        .is('delivered_at', null);
      if (error) console.error('Lỗi cập nhật delivered_at:', error);
    } else {
      console.warn('Zalo webhook không tìm thấy tracking_id trong payload — không rõ cấu trúc, xem log payload thô ở trên.');
    }
  } catch (e) {
    console.error('Lỗi xử lý Zalo webhook:', e);
  }

  // LUÔN trả 200 nhanh — Zalo coi mọi mã khác 2xx là gửi lỗi và sẽ RETRY
  // nhiều lần (30s/5p/15p/30p/1h), dồn ngày càng nhiều webhook trùng nếu cứ
  // trả lỗi; lỗi xử lý bên trong (nếu có) chỉ ghi log, không throw ra ngoài.
  return new Response(JSON.stringify({ ok: true }), { headers: { ...CORS, 'Content-Type': 'application/json' } });
});
