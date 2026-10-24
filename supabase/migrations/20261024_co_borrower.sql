-- Người cùng vay (cột D file số 1 → contracts.heir_name): tên lấy tự động từ hợp đồng, lưu theo khách hàng (Use) cùng số điện thoại
-- và lựa chọn nhận tin Zalo OA. Chạy TRƯỚC khi deploy lại create-account + send-due-reminders (docs mục 10.82). Chạy lại nhiều lần được.
alter table public.customers
  add column if not exists co_name text,                              -- họ tên người cùng vay đã lưu (đối chiếu với hợp đồng mỗi lần nhập)
  add column if not exists co_phone text,                             -- số điện thoại (có Zalo) của người cùng vay
  add column if not exists co_prev_name text,                         -- tên người cùng vay trước khi bị đổi (để cảnh báo khi thêm lại vào OA)
  add column if not exists zalo_to_main boolean not null default true, -- gửi Zalo OA cho khách vay (số chính)
  add column if not exists zalo_to_co boolean not null default false;  -- gửi Zalo OA cho người cùng vay (cần có co_phone)

-- Nhãn "Người cùng vay" trong lịch sử cuộc gọi (call_log tạo ở docs mục 10.79; chưa tạo thì dòng này tự bỏ qua).
alter table if exists public.call_log add column if not exists callee text;
