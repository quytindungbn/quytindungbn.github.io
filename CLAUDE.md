# Quy ước viết mã

- Không viết chú thích diễn giải dài trong mã (js, css, Edge Function, tests). Cần thì tối đa 1 dòng ngắn; mô tả chi tiết đặt trong `docs/supabase-migration.md`.
- Sau khi sửa `index.html`, `css/` hoặc `js/` và trước khi commit: chạy `npm run stamp` (đóng dấu phiên bản cho tính năng tự cập nhật); `tests/version.test.mjs` báo lỗi nếu quên.
