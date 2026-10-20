-- Lịch sử các lần nhập file Excel + dữ liệu để quay lại bản trước.
-- Chạy TRƯỚC khi deploy lại create-account. Bảng chỉ truy cập qua Edge Function (service role);
-- không cấp quyền gì cho anon/authenticated nên trình duyệt không đọc/ghi trực tiếp được.
create table if not exists public.import_history (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  admin_id text references public.admins(id) on delete set null,
  admin_name text not null,
  kind text not null default 'import' check (kind in ('import', 'supplement')), -- file số 1 / dán tay | file số 2
  file_name text,
  full_sync boolean not null default false,
  summary jsonb not null default '{}'::jsonb,   -- số liệu tóm tắt (mới/đổi/xóa...)
  details jsonb not null default '{}'::jsonb,   -- danh sách cụ thể: hợp đồng nào, của ai, đổi gì
  snapshot jsonb not null default '{}'::jsonb,  -- dữ liệu cũ để quay lại bản trước
  rolled_back_at timestamptz,
  rolled_back_by text
);
create index if not exists import_history_created_idx on public.import_history (created_at desc);

alter table public.import_history enable row level security;
revoke all on public.import_history from anon, authenticated;
grant select, insert, update, delete on public.import_history to service_role;
