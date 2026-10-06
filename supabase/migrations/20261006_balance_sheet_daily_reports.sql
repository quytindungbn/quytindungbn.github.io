-- Một kỳ tháng lưu bản A01 mới nhất, ngày số liệu có thể trước ngày cuối tháng.
-- Khóa year_month giữ nguyên để nạp lại đúng tháng sẽ cập nhật bản đã lưu.
alter table public.balance_sheet_reports
  drop constraint if exists balance_sheet_month_end;

alter table public.balance_sheet_reports
  drop constraint if exists balance_sheet_period_in_month;

alter table public.balance_sheet_reports
  add constraint balance_sheet_period_in_month
  check (to_char(period_end, 'YYYY-MM') = year_month);
