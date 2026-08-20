# Đóng gói app cài trên Android

App này là 1 trang web thuần (không cần build, xem README) — nên **không "đóng gói" theo
kiểu lập trình Android truyền thống** (không cần Android Studio/Java/Kotlin). Có 2 mức, từ dễ tới khó:

| Mức | Là gì | Cần làm gì | File cài đặt thật? |
|---|---|---|---|
| **1. Thêm vào Màn hình chính** | Chrome tự đóng gói tạm, mở như app (toàn màn hình, có icon riêng) | **Không cần làm gì thêm — dùng được ngay hôm nay** | Không — chỉ là lối tắt, vẫn cần vào lại trang web mỗi lần dùng (có mạng) |
| **2. File APK cài thật** | Đóng gói thành APK thật, cài như app tải từ Play Store | Dùng công cụ **PWABuilder** (miễn phí, không cần biết code) — ~15 phút | Có — file `.apk` gửi qua Zalo/USB để cài trực tiếp, hoặc đăng lên Google Play |

App đã có sẵn `manifest.json` + icon PNG chuẩn (`icons/icon-192.png`, `icons/icon-512.png`) —
điều kiện bắt buộc cho cả 2 mức đều đã đủ, không cần chuẩn bị gì thêm trước khi làm theo bên dưới.

## Mức 1 — Thêm vào Màn hình chính (dùng ngay, khuyên dùng trước)

Trên điện thoại Android, mở app **Chrome**, vào trang web (VD: `https://quytindungbn.github.io`):

1. Bấm nút **⋮** (3 chấm, góc trên phải) → chọn **"Cài đặt ứng dụng"** hoặc **"Thêm vào Màn hình chính"**
   (tên nút tùy phiên bản Chrome).
2. Xác nhận → icon "QTD Bình Nguyên" xuất hiện ở màn hình chính/ngăn kéo ứng dụng, y hệt app thật.
3. Mở bằng icon đó → chạy toàn màn hình (không thấy thanh địa chỉ trình duyệt), có trong danh sách
   "Cài đặt ứng dụng" của điện thoại (gỡ được như app thường).

**Ưu điểm**: làm ngay được, không cần công cụ gì, tự động cập nhật mỗi khi bạn sửa code (vì vẫn tải
từ trang web thật). **Hạn chế**: vẫn cần Chrome cài sẵn trên máy, không có file `.apk` để gửi cho
người khác cài trực tiếp — mỗi người phải tự làm bước trên trên điện thoại của họ.

## Mức 2 — Đóng gói thành file APK cài thật (dùng PWABuilder)

[PWABuilder](https://www.pwabuilder.com) là công cụ miễn phí của Microsoft, chuyên đóng gói trang
web (đã có `manifest.json` như app này) thành file `.apk`/`.aab` cài được trên Android — không cần
biết lập trình.

### Các bước

1. Vào **https://www.pwabuilder.com** bằng máy tính (không cần tài khoản).
2. Dán URL trang web (VD: `https://quytindungbn.github.io`) vào ô tìm kiếm → bấm **Start**.
3. PWABuilder tự quét `manifest.json` + icon, chấm điểm "độ sẵn sàng" — vì app đã có đủ
   `manifest.json`/icon PNG chuẩn nên phần này thường đã đạt, không cần sửa gì thêm.
4. Chọn nền tảng **Android** → bấm **Generate Package**.
5. Điền thông tin gói:
   - **Package ID**: định danh duy nhất kiểu `com.tencongty.quydinhngan` (không dấu, không khoảng
     trắng) — chỉ đặt 1 lần, khó đổi lại sau nếu định đăng Google Play sau này.
   - **App name**: "QTD Bình Nguyên" (hoặc tên bạn muốn hiện dưới icon).
   - **Version**: để mặc định `1.0.0.0` cho lần đầu.
   - Các mục còn lại (màu nền, splash screen...) để mặc định là được, PWABuilder tự lấy từ
     `manifest.json`.
6. Bấm **Download** → nhận về 1 file `.zip`, giải nén ra sẽ thấy file `.apk` (hoặc `.aab` nếu chọn
   đăng Play Store) và 1 file khóa ký (`signing.keystore` hoặc tương tự) — **giữ lại file khóa này**,
   cần dùng lại nếu sau này muốn cập nhật app (không phải tạo app mới từ đầu).

### Cài file APK lên điện thoại

1. Chuyển file `.apk` sang điện thoại Android (qua Zalo/Google Drive/dây USB...).
2. Điện thoại sẽ hỏi **"Cho phép cài từ nguồn này"** (Android chặn mặc định file không tải từ Play
   Store) — bấm **Cho phép**/**Cài đặt** khi được hỏi.
3. Xong — app xuất hiện trong danh sách ứng dụng, mở/gỡ như app tải từ Play Store.

> Vì bạn tự tạo file, không qua Google kiểm duyệt, nên máy sẽ cảnh báo "nguồn không xác định" —
> đây là cảnh báo bình thường của Android với mọi file cài đặt ngoài Play Store, không phải lỗi.

### (Tùy chọn, nâng cao) Bỏ thanh địa chỉ trình duyệt — trông giống app 100% native

Sau khi cài xong, app có thể vẫn hiện 1 thanh nhỏ ở trên (giống trình duyệt) — muốn bỏ hẳn, cần
"xác minh quyền sở hữu" domain với Google bằng file `assetlinks.json`:

1. PWABuilder sau bước Generate Package có phần hiện sẵn nội dung file `assetlinks.json` kèm SHA-256
   fingerprint của app vừa đóng gói.
2. Tạo file `.well-known/assetlinks.json` trong repo này (nhờ tôi tạo giúp nếu bạn có nội dung đó)
   với đúng nội dung PWABuilder đưa, rồi push lên `main` — trang web sẽ tự phục vụ file này tại
   `https://quytindungbn.github.io/.well-known/assetlinks.json`.
3. Cài lại app (gỡ bản cũ, cài bản APK mới) — Android tự nhận diện khớp, ẩn thanh địa chỉ.

Bước này không bắt buộc — app vẫn dùng bình thường nếu bỏ qua, chỉ là trải nghiệm chưa "native"
100% (còn dòng địa chỉ trang mờ nhạt phía trên).

### (Tùy chọn) Đăng lên Google Play Store

Nếu muốn người dùng tải qua Play Store thay vì gửi file `.apk` tay:
1. Đăng ký **Google Play Console** (https://play.google.com/console) — phí **25 USD, đóng 1 lần duy
   nhất** cho mọi app sau này.
2. Ở bước Generate Package của PWABuilder, chọn xuất file `.aab` (Android App Bundle) thay vì `.apk`
   — đây là định dạng Play Store yêu cầu.
3. Tạo app mới trong Play Console → tải file `.aab` lên → điền mô tả/ảnh chụp màn hình/chính sách
   riêng tư → gửi duyệt (thường vài ngày tới 1 tuần).

## Lưu ý quan trọng trước khi phát hành rộng rãi

Đóng gói app chỉ là bước **hiển thị** — không thay đổi gì về bảo mật/dữ liệu bên dưới. Trước khi cho
khách hàng thật dùng qua app đã đóng gói, vẫn cần hoàn tất checklist đã ghi trong `README.md` (mục
"Trước khi dùng thật"): OTP thật, rà soát bảo mật độc lập, tuân thủ Nghị định 13/2023/NĐ-CP về bảo vệ
dữ liệu cá nhân trước khi lưu CCCD khách hàng thật.
