# VaultShare

Ứng dụng web lưu trữ và chia sẻ tài liệu an toàn, gồm client Next.js, API Python/FastAPI, PostgreSQL cài trực tiếp trên máy, migration Alembic và kho bản mã trên ổ đĩa.

## Chạy toàn bộ bằng Docker

Cần Docker Desktop và PostgreSQL 16 cài trên Windows đang chạy. PostgreSQL không chạy trong Docker; Compose chỉ chạy API và client. Từ thư mục gốc dự án, tạo file `.env` từ mẫu (nếu chưa có) rồi chỉnh `DATABASE_URL` theo tài khoản PostgreSQL trên máy:

```powershell
if (!(Test-Path .\.env)) { Copy-Item .\.env.example .\.env }
```

Đặt `DATABASE_URL` dạng `postgresql+psycopg://vaultshare:<mat-khau>@host.docker.internal:5432/vaultshare`. Ví dụ giá trị mặc định trong file mẫu dùng mật khẩu `vaultshare_dev`, chỉ phù hợp cho local.

```bash
docker compose up --build
```

Mở ứng dụng tại [http://localhost:3000](http://localhost:3000), API docs tại [http://localhost:8000/docs](http://localhost:8000/docs). API tự chạy `alembic upgrade head` trước khi khởi động. Dữ liệu PostgreSQL nằm trong thư mục dữ liệu PostgreSQL trên Windows; tệp mã hóa nằm trong Docker volume `encrypted_files`.

Thiết lập `JWT_SECRET` trong `.env` nếu dùng ngoài máy phát triển. `DATABASE_URL` trong `.env` được API dùng khi chạy bằng Compose.

### PostgreSQL và pgAdmin

Cài PostgreSQL 16 và pgAdmin trên Windows. Trong pgAdmin, đăng ký server với **Host** `localhost`, **Port** `5432`, **Maintenance database** `postgres`, **Username** `postgres` và mật khẩu đã đặt khi cài PostgreSQL. Mở Query Tool và tạo database/user dùng cho ứng dụng:

```sql
CREATE USER vaultshare WITH PASSWORD 'vaultshare_dev';
CREATE DATABASE vaultshare OWNER vaultshare;
```

Đổi mật khẩu ví dụ thành mật khẩu riêng rồi đặt cùng giá trị trong `DATABASE_URL` ở file `.env` gốc. Sau khi tạo, có thể đăng ký thêm server trong pgAdmin với database `vaultshare`, username `vaultshare` để xem dữ liệu ứng dụng. PostgreSQL phải lắng nghe trên cổng `5432`; từ container API, `host.docker.internal` trỏ về máy Windows.

Khi chạy bằng Compose, API bật seed tài khoản demo sau migration. Khi chạy API trực tiếp trên máy, seed mặc định tắt; có thể bật thủ công theo hướng dẫn bên dưới. Seed có tính idempotent: nếu email đã tồn tại thì giữ nguyên tài khoản đó.

### Trang người dùng và quản trị

- `/login`: đăng nhập hoặc tạo tài khoản.
- `/`: kho tài liệu cá nhân.
- `/profile`: xem và cập nhật tên hiển thị; bootstrap admin đầu tiên.
- `/admin`: thống kê, khóa/mở hoặc xóa tài khoản thường, xóa tài liệu và xem nhật ký toàn hệ thống. Tất cả API quản trị đều yêu cầu role admin phía server; không thể tự xóa hoặc xóa quản trị viên khác.

Để bootstrap admin, cấu hình `ADMIN_BOOTSTRAP_TOKEN` bằng một chuỗi ngẫu nhiên mạnh trong file `.env` ở thư mục gốc khi dùng Docker Compose (hoặc trong `server/.env` khi chạy API trực tiếp). Đăng nhập tài khoản cần nâng quyền, mở `/profile`, rồi nhập token. Bootstrap chỉ thành công một lần, khi chưa có admin; sau đó có thể bỏ token khỏi môi trường. Cột role được thêm qua migration `0002_admin_role`, tự chạy khi khởi động bằng Compose.

## Chạy local trên Windows

> Cách này chạy PostgreSQL, API và client trực tiếp trên máy; không chạy service API/client trong Docker. Cần **Node.js/npm**, **Python 3.12** và **PostgreSQL** đang chạy trên `localhost:5432`, đúng với `DATABASE_URL` trong `server/.env`.

### 1. Kiểm tra database

Đảm bảo PostgreSQL đang chạy và có database `vaultshare` cùng user khớp với `DATABASE_URL` trong `server/.env`. Nếu cần tạo mới, mở PowerShell rồi chạy `psql -U postgres`; tại prompt `psql`, tạo user và database (đổi password ví dụ thành giá trị local của bạn):

```sql
CREATE USER vaultshare WITH PASSWORD 'choose-a-local-password';
CREATE DATABASE vaultshare OWNER vaultshare;
```

Nếu password chứa ký tự đặc biệt như `@`, `:` hoặc `/`, hãy URL-encode phần password trong `DATABASE_URL`. Thoát `psql` bằng `\q`.

Nếu chạy API trực tiếp trên Windows (không dùng Compose), `DATABASE_URL` dùng `localhost` như mẫu `server/.env`. Nếu API chạy trong Compose, dùng `host.docker.internal` như hướng dẫn trên.

### 2. Cài đặt và chạy API (lần đầu)

Mở terminal thứ nhất tại thư mục gốc dự án (`C:\Users\1\Desktop\DA\ATBM`). Nếu chưa có `server/.env`, tạo từ file mẫu (không ghi đè file đang tồn tại):

```powershell
Set-Location C:\Users\1\Desktop\DA\ATBM
if (!(Test-Path .\server\.env)) { Copy-Item .\server\.env.example .\server\.env }
```

Mở `server/.env` và xác nhận `DATABASE_URL`, `JWT_SECRET`, `ADMIN_BOOTSTRAP_TOKEN`, `CORS_ORIGINS` và `STORAGE_PATH` (`./storage`). File này được Git ignore; không commit hoặc gửi các secret lên repository.

Nếu máy chưa có Python 3.12, cài qua `winget`:

```powershell
winget install --id Python.Python.3.12 -e --source winget
```

Tạo virtual environment trong `server/`, cài dependencies, chạy migration rồi khởi động API:

```powershell
Set-Location C:\Users\1\Desktop\DA\ATBM\server
& "$env:LOCALAPPDATA\Programs\Python\Python312\python.exe" -m venv .venv
.\.venv\Scripts\Activate.ps1
python -m pip install --upgrade pip
pip install -r requirements.txt
alembic upgrade head
uvicorn app.main:app --reload --host 127.0.0.1 --port 8000
```

> Nếu máy đã cấu hình Python Launcher (`py -3.12`), có thể thay dòng tạo `.venv` bằng `py -3.12 -m venv .venv`. Nếu PowerShell chặn chạy script activate, mở quyền cho phiên terminal hiện tại bằng `Set-ExecutionPolicy -Scope Process Bypass`, sau đó chạy lại `.\.venv\Scripts\Activate.ps1`.

### 3. Chạy lại API ở các lần sau

Khi đã cài xong `.venv` và migration, ở các lần sau chỉ cần chạy:

```powershell
Set-Location C:\Users\1\Desktop\DA\ATBM\server
.\.venv\Scripts\Activate.ps1
uvicorn app.main:app --reload --host 127.0.0.1 --port 8000
```

Muốn tạo tài khoản demo local, dừng API bằng `Ctrl+C`, vẫn ở thư mục `server` (đang activate `.venv`) và chạy:

```powershell
$env:SEED_DEMO_USERS = "true"
python -m app.seed
Remove-Item Env:SEED_DEMO_USERS
```

Sau đó khởi động lại `uvicorn`. Nếu không seed demo, có thể đăng ký tài khoản mới trực tiếp tại `/login`.

### 4. Chạy client

Mở terminal thứ hai tại thư mục gốc dự án:

```powershell
Set-Location C:\Users\1\Desktop\DA\ATBM
npm install
npm run dev
```

Client dùng `NEXT_PUBLIC_API_URL`, mặc định `http://localhost:8000/api/v1`. Mở ứng dụng tại [http://localhost:3000](http://localhost:3000); API docs tại [http://localhost:8000/docs](http://localhost:8000/docs). `CORS_ORIGINS` trong `server/.env` cần cho phép `http://localhost:3000`.

### Vị trí file khi chạy local

Với `STORAGE_PATH=./storage`, backend ghi ciphertext vào thư mục `storage` tương đối với working directory của tiến trình API. Các lệnh phía trên chạy API từ `server/`, nên file được lưu tại `server/storage/`; thư mục này được tạo tự động và đã nằm trong `.gitignore`. Database chỉ giữ metadata và storage key, còn nội dung file trong thư mục này là bản mã.

Đây là ổ đĩa local, chưa phải cloud storage. Khi chạy toàn bộ bằng Docker Compose, Compose đặt `STORAGE_PATH=/data` và mount named volume `encrypted_files` vào `/data`; dữ liệu khi đó nằm trong Docker volume thay vì `server/storage`. Muốn dùng dịch vụ cloud/object storage cần tích hợp riêng, hiện project chưa cấu hình S3/Azure Blob/GCS.

## Tài liệu dự án

- [Giới thiệu và giải thích các tính năng hiện có](docs/gioi-thieu-va-tinh-nang.md)
- [Sơ đồ và giải thích các luồng hoạt động chính](docs/luong-hoat-dong.md)
- [Công dụng các bảng SQL và Cơ chế quản lý khóa](docs/bang-sql-va-co-che-khoa.md)
- [Sơ đồ ERD và giải thích bảng](docs/erd.md)

### Cơ sở dữ liệu

- [Migration khởi tạo](server/migrations/versions/0001_initial_schema.py)
- [Migration role quản trị](server/migrations/versions/0002_admin_role.py)
- Thay đổi schema về sau: tạo revision mới bằng `alembic revision --autogenerate -m "describe change"`, kiểm tra migration được sinh, rồi áp dụng bằng `alembic upgrade head`.

Các bảng gồm `users`, `documents`, `document_grants` và `audit_logs`. Metadata nằm trong PostgreSQL; byte bản mã nằm trong volume `encrypted_files`. Sao lưu cần giữ đồng bộ cả database lẫn volume này.

### Xem database đang chạy

Mở terminal tại thư mục gốc dự án và vào PostgreSQL:

```bash
psql -h localhost -U vaultshare -d vaultshare
```

Trong dấu nhắc `psql`, dùng các lệnh sau:

```sql
\dt
\d+ users
SELECT *id, email, display_name, is_active, created_at* FROM users ORDER BY id;
```
SELECT id, owner_id, original_name, original_size, ciphertext_size, checksum_sha256, created_at FROM documents ORDER BY id;
SELECT document_id, user_id, granted_by_id, created_at FROM document_grants ORDER BY document_id, user_id;
SELECT id, user_id, document_id, action, details, created_at FROM audit_logs ORDER BY id DESC LIMIT 20;

Thoát bằng `\q`. Có thể xem/chỉnh sửa database trực quan bằng pgAdmin với server `localhost:5432` và database `vaultshare`.

### Tài khoản demo

| Vai trò | Email | Mật khẩu |
| --- | --- | --- |
| Chủ sở hữu | `demo.owner@example.com` | `VaultOwner2026!` |
| Người nhận | `demo.guest@example.com` | `VaultGuest2026!` |

Các tài khoản demo được seed vào bảng `users`, mỗi tài khoản có cặp RSA riêng và khóa riêng được mã hóa bằng mật khẩu tương ứng. Dùng email/mật khẩu trong bảng để đăng nhập. Đây là thông tin demo cố định; chỉ dùng trên môi trường phát triển cục bộ. Nếu thay mật khẩu hoặc xóa tài khoản mẫu, seed không ghi đè tài khoản hiện có.

## API chính

- `POST /api/v1/auth/register`, `POST /api/v1/auth/login`, `GET /api/v1/auth/me`
- `PATCH /api/v1/auth/me`
- `POST /api/v1/admin/bootstrap` (khởi tạo admin một lần)
- `GET /api/v1/admin/overview`, `GET /api/v1/admin/users`, `PATCH /api/v1/admin/users/{id}/active`, `DELETE /api/v1/admin/users/{id}`
- `GET /api/v1/admin/documents`, `DELETE /api/v1/admin/documents/{id}`, `GET /api/v1/admin/activity`
- `GET/POST /api/v1/documents`, `GET /api/v1/documents/{id}/content`, `DELETE /api/v1/documents/{id}`
- `POST /api/v1/documents/{id}/verify`, `POST /api/v1/documents/{id}/shares`
- `GET /api/v1/users/public-key`, `GET /api/v1/stats`, `GET /api/v1/activity`

## Mã hóa và phạm vi

Trình duyệt mã hóa tệp bằng AES-256-GCM, tạo khóa riêng cho từng tài liệu, sau đó bọc khóa bằng RSA-OAEP 2048 bit/SHA-256. Khóa riêng RSA được mã hóa trong trình duyệt bằng AES-GCM với khóa dẫn xuất PBKDF2-HMAC-SHA-256 (310.000 vòng). API kiểm tra checksum SHA-256 của bản mã khi tải lên và khi người dùng yêu cầu kiểm tra lưu trữ. Client kiểm tra lại checksum và thẻ GCM khi giải mã. Máy chủ lưu mật khẩu bằng Argon2id và không nhận khóa riêng RSA dạng rõ hay nội dung tệp dạng rõ.

MVP hiện dùng JWT bearer, lưu tệp cục bộ trong volume và giới hạn upload 100 MB. Chưa có xác thực email/OTP, khôi phục khóa, thu hồi chia sẻ, quét virus, lưu S3, rate limiting hay chính sách production cho secret/backup. Người dùng mất mật khẩu sẽ không mở được khóa riêng. Không triển khai ra Internet trước khi cấu hình secret mạnh, HTTPS, giới hạn đăng nhập và sao lưu/khôi phục.
