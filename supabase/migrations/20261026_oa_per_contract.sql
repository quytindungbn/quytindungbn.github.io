-- Gửi Zalo OA THEO TỪNG HỢP ĐỒNG (docs mục 10.83): mỗi hợp đồng có công tắc bật/tắt gửi OA + tick Người vay / Người cùng vay;
-- số điện thoại người cùng vay lưu trong "sổ người cùng vay" của khách (customers.co_people) — nhập 1 lần dùng cho mọi hợp đồng có tên người đó.
-- Chạy TRƯỚC khi deploy lại create-account + send-due-reminders. Chạy lại nhiều lần được (không ghi đè lựa chọn đã đổi).
alter table public.customers
  add column if not exists co_people jsonb not null default '[]'::jsonb;  -- [{ "name": "...", "phone": "09..." }] — sổ người cùng vay của khách

alter table public.contracts
  add column if not exists oa_enabled boolean not null default true,      -- false = hợp đồng này KHÔNG gửi OA (tự động, gửi tay) và ẩn khỏi lịch sử gửi
  add column if not exists oa_to_main boolean not null default true,      -- gửi cho người vay (số chính)
  add column if not exists oa_to_co boolean not null default false,       -- gửi cho người cùng vay GHI TRÊN HỢP ĐỒNG NÀY (cần có số trong co_people)
  add column if not exists oa_co_key text;                                -- tên người cùng vay (viết thường) mà tick oa_to_co đang áp dụng — đổi người thì tick tự mất hiệu lực

-- Chuyển dữ liệu cũ (mục 10.82: 1 người cùng vay / khách) sang cách lưu mới.
update public.customers
   set co_people = jsonb_build_array(jsonb_build_object('name', btrim(co_name), 'phone', coalesce(btrim(co_phone), '')))
 where co_people = '[]'::jsonb and coalesce(btrim(co_name), '') <> '';

update public.contracts ct
   set oa_to_main = coalesce(c.zalo_to_main, true),
       oa_to_co = true,
       oa_co_key = lower(regexp_replace(btrim(ct.heir_name), '\s+', ' ', 'g'))
  from public.customers c
 where c.id = ct.customer_id
   and coalesce(c.zalo_to_co, false) and coalesce(btrim(c.co_phone), '') <> ''
   and ct.heir_name is not null
   and lower(regexp_replace(btrim(ct.heir_name), '\s+', ' ', 'g')) = lower(regexp_replace(btrim(c.co_name), '\s+', ' ', 'g'))
   and ct.oa_co_key is null;
