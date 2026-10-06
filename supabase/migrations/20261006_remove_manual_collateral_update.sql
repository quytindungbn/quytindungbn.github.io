-- Giá trị và mã TSBĐ chỉ được cập nhật qua nhập file số 1 ở Edge Function.
-- Bỏ đường ghi trực tiếp từ trình duyệt từng hợp đồng; service role nhập file
-- vẫn ghi được theo cơ chế hiện có.
drop policy if exists "super admin updates collateral" on public.contracts;
