-- Chạy trước khi triển khai giao diện Cân đối kế toán.
-- Cờ riêng: chỉ quản trị viên toàn quyền có thể cấp qua create-account.
alter table public.admins
  add column if not exists can_view_balance_sheet boolean not null default false;

create table if not exists public.balance_sheet_reports (
  year_month text primary key check (year_month ~ '^[0-9]{4}-(0[1-9]|1[0-2])$'),
  period_end date not null,
  source_name text not null,
  figures jsonb not null,
  imported_by text not null,
  imported_at timestamptz not null default now(),
  constraint balance_sheet_month_end check (
    to_char(period_end, 'YYYY-MM') = year_month
    and period_end = (date_trunc('month', period_end)::date + interval '1 month - 1 day')::date
  ),
  constraint balance_sheet_figures_shape check (
    jsonb_typeof(figures) = 'object'
    and jsonb_typeof(figures->'start') = 'object'
    and jsonb_typeof(figures->'end') = 'object'
  )
);

alter table public.balance_sheet_reports enable row level security;
revoke all on public.balance_sheet_reports from public, anon;
grant select, insert, update on public.balance_sheet_reports to authenticated;

drop policy if exists "balance sheet permitted admin reads" on public.balance_sheet_reports;
create policy "balance sheet permitted admin reads" on public.balance_sheet_reports
  for select to authenticated
  using (
    (auth.jwt() ->> 'app_role') = 'admin'
    and exists (
      select 1 from public.admins a
      where a.id = (auth.jwt() ->> 'row_id')
        and (a.role = 'super' or a.can_view_balance_sheet)
    )
  );

drop policy if exists "balance sheet super inserts" on public.balance_sheet_reports;
create policy "balance sheet super inserts" on public.balance_sheet_reports
  for insert to authenticated
  with check (
    (auth.jwt() ->> 'app_role') = 'admin'
    and imported_by = (auth.jwt() ->> 'row_id')
    and exists (
      select 1 from public.admins a
      where a.id = (auth.jwt() ->> 'row_id') and a.role = 'super'
    )
  );

drop policy if exists "balance sheet super updates" on public.balance_sheet_reports;
create policy "balance sheet super updates" on public.balance_sheet_reports
  for update to authenticated
  using (
    (auth.jwt() ->> 'app_role') = 'admin'
    and exists (
      select 1 from public.admins a
      where a.id = (auth.jwt() ->> 'row_id') and a.role = 'super'
    )
  )
  with check (
    (auth.jwt() ->> 'app_role') = 'admin'
    and imported_by = (auth.jwt() ->> 'row_id')
    and exists (
      select 1 from public.admins a
      where a.id = (auth.jwt() ->> 'row_id') and a.role = 'super'
    )
  );
