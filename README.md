# VaultShare

Ứng dụng web lưu trữ và chia sẻ tài liệu an toàn, gồm client Next.js, API Python/FastAPI, PostgreSQL, migration Alembic và kho bản mã trên ổ đĩa dạng volume.

## Chạy toàn bộ bằng Docker

Cần Docker Desktop đang chạy. Từ thư mục gốc dự án:

```bash
docker compose up --build
```

Mở ứng dụng tại [http://localhost:3000](http://localhost:3000), API docs tại [http://localhost:8000/docs](http://localhost:8000/docs). API tự chạy `alembic upgrade head` trước khi khởi động. Dữ liệu PostgreSQL và tệp mã hóa tồn tại trong hai Docker volume riêng.

Thiết lập `POSTGRES_PASSWORD` và `JWT_SECRET` trong môi trường trước khi chạy nếu dùng ngoài máy phát triển. Giá trị mặc định trong Compose chỉ dành cho local.

Trong cấu hình local, API chạy seed tài khoản demo tự động sau migration. Seed có tính idempotent: nếu email đã tồn tại thì giữ nguyên tài khoản đó.

## Chạy từng phần trong môi trường phát triển

1. Khởi động PostgreSQL 16 và tạo database `vaultshare`.
2. Tạo `server/.env` từ `server/.env.example`; chỉnh `DATABASE_URL` và `JWT_SECRET`.
3. Trong `server/`, cài dependency từ `requirements.txt`, sau đó chạy `alembic upgrade head` và `uvicorn app.main:app --reload`.
4. Ở thư mục gốc, chạy `npm install`, sau đó `npm run dev`.

Client dùng `NEXT_PUBLIC_API_URL` (mặc định `http://localhost:8000/api/v1`).

## Cơ sở dữ liệu

- [Sơ đồ ERD và giải thích bảng](docs/erd.md)
- [Migration khởi tạo](server/migrations/versions/0001_initial_schema.py)
- Thay đổi schema về sau: tạo revision mới bằng `alembic revision --autogenerate -m "describe change"`, kiểm tra migration được sinh, rồi áp dụng bằng `alembic upgrade head`.

Các bảng gồm `users`, `documents`, `document_grants` và `audit_logs`. Metadata nằm trong PostgreSQL; byte bản mã nằm trong volume `encrypted_files`. Sao lưu cần giữ đồng bộ cả database lẫn volume này.

### Xem database đang chạy

Mở terminal tại thư mục gốc dự án và vào PostgreSQL:

```bash
docker compose exec db psql -U vaultshare -d vaultshare
```

Trong dấu nhắc `psql`, dùng các lệnh sau:

```sql
\dt
\d+ users
SELECT id, email, display_name, is_active, created_at FROM users ORDER BY id;
SELECT id, owner_id, original_name, original_size, ciphertext_size, checksum_sha256, created_at FROM documents ORDER BY id;
SELECT document_id, user_id, granted_by_id, created_at FROM document_grants ORDER BY document_id, user_id;
SELECT id, user_id, document_id, action, details, created_at FROM audit_logs ORDER BY id DESC LIMIT 20;
```

Thoát bằng `\q`. Nếu muốn mở shell PostgreSQL bên ngoài container, cổng `5432` hiện chỉ được expose trong network nội bộ Compose; dùng `docker compose exec` như trên.

### Tài khoản demo

| Vai trò | Email | Mật khẩu |
| --- | --- | --- |
| Chủ sở hữu | `demo.owner@vaultshare.local` | `VaultOwner2026!` |
| Người nhận | `demo.guest@vaultshare.local` | `VaultGuest2026!` |

Hai nút tài khoản mẫu trên trang đăng nhập sẽ điền sẵn email và mật khẩu. Các tài khoản được seed vào bảng `users`, mỗi tài khoản có cặp RSA riêng và khóa riêng được mã hóa bằng mật khẩu tương ứng. Đây là thông tin demo cố định; chỉ dùng trên môi trường phát triển cục bộ. Nếu thay mật khẩu hoặc xóa tài khoản mẫu, seed không ghi đè tài khoản hiện có.

## API chính

- `POST /api/v1/auth/register`, `POST /api/v1/auth/login`, `GET /api/v1/auth/me`
- `GET/POST /api/v1/documents`, `GET /api/v1/documents/{id}/content`, `DELETE /api/v1/documents/{id}`
- `POST /api/v1/documents/{id}/verify`, `POST /api/v1/documents/{id}/shares`
- `GET /api/v1/users/public-key`, `GET /api/v1/stats`, `GET /api/v1/activity`

## Mã hóa và phạm vi

Trình duyệt mã hóa tệp bằng AES-256-GCM, tạo khóa riêng cho từng tài liệu, sau đó bọc khóa bằng RSA-OAEP 2048 bit/SHA-256. Khóa riêng RSA được mã hóa trong trình duyệt bằng AES-GCM với khóa dẫn xuất PBKDF2-HMAC-SHA-256 (310.000 vòng). API kiểm tra checksum SHA-256 của bản mã khi tải lên và khi người dùng yêu cầu kiểm tra lưu trữ. Client kiểm tra lại checksum và thẻ GCM khi giải mã. Máy chủ lưu mật khẩu bằng Argon2id và không nhận khóa riêng RSA dạng rõ hay nội dung tệp dạng rõ.

MVP hiện dùng JWT bearer, lưu tệp cục bộ trong volume và giới hạn upload 100 MB. Chưa có xác thực email/OTP, khôi phục khóa, thu hồi chia sẻ, quét virus, lưu S3, rate limiting hay chính sách production cho secret/backup. Người dùng mất mật khẩu sẽ không mở được khóa riêng. Không triển khai ra Internet trước khi cấu hình secret mạnh, HTTPS, giới hạn đăng nhập và sao lưu/khôi phục.
