-- Cất sổ người cùng vay (tên + số điện thoại) theo CCCD của khách khi hồ sơ khách bị dọn lúc nhập file (hết dư nợ, chưa có tài khoản Use) — docs mục 10.84.
-- Lần vay sau, khách được tạo lại từ file mà hợp đồng ghi đúng người cùng vay đó thì dùng lại luôn số đã lưu.
-- Chạy TRƯỚC khi deploy lại create-account. Chạy lại nhiều lần được. Bảng chỉ truy cập qua Edge Function (service role);
-- không cấp quyền gì cho anon/authenticated nên trình duyệt không đọc/ghi trực tiếp được.
create table if not exists public.co_people_archive (
  cccd text primary key,                                   -- CCCD của khách (người vay)
  people jsonb not null default '[]'::jsonb,                -- [{ "name": "TRẦN THỊ BÍCH", "phone": "0988777666" }]
  updated_at timestamptz not null default now()
);

alter table public.co_people_archive enable row level security;
revoke all on public.co_people_archive from anon, authenticated;
grant select, insert, update, delete on public.co_people_archive to service_role;
