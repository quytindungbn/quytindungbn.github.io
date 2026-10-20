-- Người thừa kế/đồng vay (cột D của file số 1) — hiện cạnh tên khách ở chi tiết hợp đồng.
-- Chạy TRƯỚC khi deploy lại create-account. Mặc định NULL: hợp đồng cũ giữ nguyên.
alter table public.contracts add column if not exists heir_name text;
