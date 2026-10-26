-- Lịch sử gửi tin Zalo OA: ghi sẵn NGƯỜI NHẬN lúc gửi (docs mục 10.89)
-- Mỗi dòng zalo_send_log là 1 số điện thoại đã gửi; 2 cột mới cho biết số đó là của người vay hay người cùng vay (và tên người cùng vay) tại thời điểm gửi,
-- để trang Quản lý OA > Lịch sử gửi luôn hiện đúng "Người vay" / "Người cùng vay · tên" dù sau này số điện thoại của khách bị sửa hoặc xóa.
-- Dòng cũ để trống (màn hình tự suy ra bằng cách so số điện thoại như trước). An toàn chạy lại nhiều lần.
alter table zalo_send_log add column if not exists recipient_who text check (recipient_who in ('main', 'co'));
alter table zalo_send_log add column if not exists recipient_name text;
