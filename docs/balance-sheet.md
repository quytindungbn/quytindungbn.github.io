# Cân đối kế toán theo tháng

Triển khai theo thứ tự: chạy `supabase/migrations/20261005_balance_sheet_reports.sql` trong SQL Editor, triển khai lại Edge Function `create-account`, sau đó cập nhật mã web. Bảng mới chỉ lưu số liệu tổng hợp JSON theo tháng, tên file và người nạp; không lưu file Excel gốc.

Quản trị viên toàn quyền mở **Cân đối kế toán → Nạp bảng cân đối**, chọn file A01/QTDCS `.xls` hoặc `.xlsx` có đủ số dư đầu/cuối kỳ. Sau khi xem trước, bấm **Lưu số liệu**. Nạp lại cùng kỳ sẽ thay đúng kỳ đó. Hai file mẫu CDKT12.xls và CDKT 09.xls chỉ dùng để kiểm tra, không nạp tự động.

Quyền xem của nhân viên do quản trị viên toàn quyền cấp tại **Quản lý User → nhân viên → Cho phép xem Cân đối kế toán**. Nhân viên chỉ xem; việc nạp file và sửa quyền vẫn dành riêng cho quản trị viên toàn quyền. Supabase RLS thực thi điều này ngay cả khi gọi API trực tiếp.

Tổng tài sản = số dư Nợ trừ Có của tài khoản cấp 1 **1 + 2 + 3**. Phía nguồn vốn = số dư Có trừ Nợ của **4 + 5 + 6 + 7 + 8**. Trong đó 2191 là dự phòng cụ thể, 2192 là dự phòng chung; 7 trừ 8 là lợi nhuận lũy kế. Không cộng lặp tài khoản cha với tài khoản con. Ứng dụng kiểm tra tài sản bằng nguồn vốn cả đầu và cuối kỳ, khớp tài khoản 219 với 2191 + 2192, và ngày báo cáo bao trọn một tháng trước khi cho lưu.

Đối chiếu dự phòng chỉ lấy bản chốt của app **cùng tháng**; nếu app chưa có số dự phòng, hiển thị “Chưa có số liệu” thay vì 0. Chênh lệch là **app trừ bảng cân đối**, để người quản trị kiểm tra, không tự điều chỉnh số nào.

Kiểm tra với file mẫu: CDKT12.xls cuối kỳ 31/12/2025 có tổng tài sản 75.612.688.585 đồng; CDKT 09.xls cuối kỳ 30/09/2026 có tổng tài sản 70.147.510.875 đồng, dự phòng chung 336.652.267 đồng, dự phòng cụ thể 7.040.500 đồng. Cả hai file cân đối về 0 đồng chênh lệch.
