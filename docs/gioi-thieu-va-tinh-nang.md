# VaultShare: Giới thiệu và tính năng

## Giới thiệu

VaultShare là ứng dụng web để lưu trữ và chia sẻ tài liệu với mã hóa đầu cuối. Nội dung file được mã hóa ngay trong trình duyệt trước khi gửi đến API. Máy chủ giữ bản mã, metadata, quyền truy cập và nhật ký hoạt động; máy chủ không nhận file rõ hoặc private key RSA ở dạng rõ.

Ứng dụng gồm client Next.js, API FastAPI, PostgreSQL và volume lưu trữ ciphertext. Hệ thống có hai vai trò giao diện chính: người dùng và quản trị viên.

## Tính năng người dùng

### Tài khoản và phiên đăng nhập

- Đăng ký bằng email, mật khẩu và tên hiển thị.
- Đăng nhập nhận JWT bearer token để gọi các API cần xác thực.
- Khi đăng ký, trình duyệt tạo cặp khóa RSA riêng cho tài khoản.
- Private key được mã hóa bằng AES-GCM với khóa dẫn xuất từ mật khẩu qua PBKDF2-HMAC-SHA-256.
- Mật khẩu tài khoản được server lưu dưới dạng hash Argon2id.
- Hồ sơ cho phép xem email, vai trò, ngày tham gia và cập nhật tên hiển thị.

### Kho tài liệu

- Tải lên một hoặc nhiều file; ứng dụng mã hóa từng file trước khi gửi.
- Xem tài liệu sở hữu, tài liệu được chia sẻ, tên, loại nội dung, dung lượng, ngày tạo và trạng thái chia sẻ.
- Tìm theo tên và sắp xếp theo ngày, tên hoặc dung lượng.
- Tải file về sau khi kiểm tra checksum và giải mã trên trình duyệt.
- Xóa tài liệu do chính người dùng sở hữu.
- Xem thống kê số tài liệu, dung lượng, số tài liệu chia sẻ và tài liệu được nhận.

Mỗi file dùng một khóa AES-256-GCM ngẫu nhiên. Khóa AES được bọc bằng RSA-OAEP 2048-bit/SHA-256. Server lưu ciphertext trong Docker volume `encrypted_files` và metadata trong PostgreSQL. Giới hạn upload mặc định là 100 MiB cho bản mã.

### Chia sẻ và kiểm tra toàn vẹn

- Chủ sở hữu tìm public key của người nhận qua email.
- Trình duyệt mở wrapped AES key của tài liệu rồi bọc lại bằng public key của người nhận.
- API cấp `DocumentGrant` cho người nhận; chỉ tài khoản có grant mới lấy được ciphertext.
- Server kiểm tra SHA-256 khi upload và cung cấp thao tác xác minh lại dữ liệu đang lưu.
- Khi tải file, trình duyệt kiểm tra checksum và thẻ xác thực AES-GCM trước khi cung cấp file đã giải mã.

### Nhật ký hoạt động

Người dùng xem các sự kiện thuộc tài khoản của mình, như đăng nhập, upload, tải xuống, chia sẻ, xác minh và xóa tài liệu. Các thao tác quan trọng được lưu cùng thời điểm và thông tin liên quan.

## Tính năng quản trị

### Bootstrap admin

Admin đầu tiên được cấp qua token cấu hình `ADMIN_BOOTSTRAP_TOKEN`. Người dùng đăng nhập, mở trang hồ sơ và nhập token. API chỉ cho bootstrap khi server đã cấu hình token và chưa có admin; quyền được lưu trong database. Sau lần bootstrap đầu tiên, có thể gỡ token khỏi môi trường chạy.

### Trang quản trị

- Xem tổng số tài khoản, tài khoản hoạt động, tài liệu, dung lượng và sự kiện.
- Xem danh sách tài khoản và khóa/mở khóa user thường.
- Xóa user thường cùng tài liệu sở hữu và grants liên quan.
- Không thể tự khóa/xóa admin đang dùng hoặc xóa admin khác.
- Xem metadata tài liệu toàn hệ thống và xóa tài liệu.
- Xem nhật ký hoạt động toàn hệ thống.

Các quyền admin luôn được kiểm tra ở API, không chỉ bằng cách ẩn liên kết trên client. Các thao tác quản trị được ghi vào audit log.

## Các trang client

| Đường dẫn | Mục đích |
| --- | --- |
| `/login` | Đăng nhập hoặc đăng ký tài khoản |
| `/` | Kho tài liệu cá nhân và khu vực chia sẻ/hoạt động |
| `/profile` | Xem, cập nhật hồ sơ và bootstrap admin đầu tiên |
| `/admin` | Quản lý tài khoản, tài liệu, thống kê và nhật ký; cần role admin |

## Giới hạn hiện tại

- Đây là MVP; chưa có xác thực email/OTP, khôi phục mật khẩu hoặc khôi phục private key.
- Người dùng mất mật khẩu sẽ không thể mở private key đã mã hóa, vì vậy không giải mã được tài liệu.
- Chia sẻ hiện cấp quyền đọc; chưa có thu hồi grant trong giao diện.
- File được lưu trong Docker volume, chưa tích hợp S3, Azure Blob hay dịch vụ object storage khác.
- Chưa có quét malware, rate limiting hoặc chính sách production đầy đủ cho secret và backup.
- Thông tin tài khoản demo chỉ dành cho môi trường phát triển cục bộ; không dùng các mật khẩu demo trong môi trường thật.

## Tài liệu liên quan

- [Sơ đồ và giải thích các luồng hoạt động chính](luong-hoat-dong.md)
- [Sơ đồ ERD và giải thích database](erd.md)
- API docs khi chạy local: [http://localhost:8000/docs](http://localhost:8000/docs)
