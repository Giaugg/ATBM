# Luồng hoạt động chính

Tài liệu này mô tả các luồng đang được triển khai trong VaultShare. Mã hóa và giải mã nội dung tệp chạy ở trình duyệt; API chỉ nhận và lưu bản mã.

## Tổng quan hệ thống

```mermaid
flowchart LR
    U[Người dùng] -->|Trình duyệt Next.js| C[Client]
    C -->|HTTPS / JSON, multipart| A[FastAPI]
    A -->|SQLAlchemy| D[(PostgreSQL)]
    A -->|Bản mã theo storage_key| V[(Volume encrypted_files)]
    C -->|Web Crypto: AES-GCM / RSA-OAEP| K[Khóa trên thiết bị]
    K -. không gửi khóa riêng dạng rõ .-> A
```

- **Client** quản lý giao diện, JWT phiên, mã hóa/giải mã và khóa riêng đã được mở khóa trong bộ nhớ.
- **API** xác thực người dùng, kiểm tra quyền sở hữu/chia sẻ, kiểm tra checksum, lưu metadata và audit log.
- **PostgreSQL** lưu tài khoản, metadata tài liệu, grants và sự kiện.
- **Volume `encrypted_files`** lưu byte bản mã. `storage_key` là tên ngẫu nhiên, không phải tên file gốc.

## Đăng ký và đăng nhập

Khi đăng ký, trình duyệt tạo cặp khóa RSA. Khóa riêng được mã hóa bằng AES-GCM với khóa dẫn xuất từ mật khẩu qua PBKDF2; API chỉ nhận khóa riêng ở dạng đã mã hóa. Khi đăng nhập, API xác thực mật khẩu rồi trả thông tin khóa đã mã hóa để trình duyệt mở khóa cục bộ.

```mermaid
sequenceDiagram
    actor User as Người dùng
    participant Client as Trình duyệt
    participant API as FastAPI
    participant DB as PostgreSQL

    User->>Client: Nhập email và mật khẩu
    alt Đăng ký
        Client->>Client: Tạo RSA key pair
        Client->>Client: Mã hóa private key bằng PBKDF2 + AES-GCM
        Client->>API: POST /auth/register (password, public key, encrypted private key)
        API->>DB: Lưu user, password hash Argon2id và audit event
        DB-->>API: User đã tạo
    else Đăng nhập
        Client->>API: POST /auth/login (email, password)
        API->>DB: Đọc user và xác thực password hash
        DB-->>API: Thông tin user
        API->>DB: Ghi audit event đăng nhập
    end
    API-->>Client: JWT + thông tin user và private key đã mã hóa
    Client->>Client: Dùng mật khẩu mở khóa private key
    Client->>Client: Lưu JWT trong localStorage, giữ CryptoKey trong bộ nhớ
```

Sau khi tải lại trang, CryptoKey trong bộ nhớ không còn. Client xóa phiên đã lưu và yêu cầu đăng nhập lại để mở khóa; private key không được lưu dạng rõ trong localStorage.

## Tải lên tài liệu

Mỗi file có khóa AES-GCM riêng. Client mã hóa file, bọc khóa AES bằng public key RSA của người dùng, rồi gửi bản mã cùng metadata và checksum. API giới hạn bản mã ở `MAX_UPLOAD_BYTES` (Compose mặc định 100 MiB), xác nhận kích thước và SHA-256 trước khi lưu.

```mermaid
sequenceDiagram
    actor User as Người dùng
    participant Client as Trình duyệt
    participant API as FastAPI
    participant DB as PostgreSQL
    participant Store as Volume /data

    User->>Client: Chọn file
    Client->>Client: Tạo AES key + nonce, mã hóa file bằng AES-GCM
    Client->>Client: Bọc AES key bằng public key RSA-OAEP
    Client->>Client: Tính SHA-256 của bản mã
    Client->>API: POST /documents (ciphertext + metadata + checksum + wrapped key)
    API->>API: Kiểm tra tên, giới hạn kích thước, kích thước mã hóa và checksum
    API->>Store: Ghi ciphertext bằng storage_key ngẫu nhiên
    API->>DB: Tạo document, grant cho chủ sở hữu và audit event
    DB-->>API: Commit
    API-->>Client: Metadata tài liệu
```

Nếu kiểm tra upload thất bại, API rollback transaction và xóa file bản mã tạm. `content_type` và tên gốc chỉ là metadata do client gửi; nội dung được lưu dưới dạng ciphertext.

## Tải xuống và xác minh

API chỉ trả bản mã cho người dùng có `DocumentGrant`. Trình duyệt xác minh checksum, mở khóa AES bằng private key và giải mã AES-GCM; sau đó tải file rõ về thiết bị. Luồng xác minh lưu trữ chỉ so checksum trên server, còn màn hình client có thể tải bản mã về để xác thực checksum và thẻ GCM.

```mermaid
sequenceDiagram
    actor User as Người dùng
    participant Client as Trình duyệt
    participant API as FastAPI
    participant DB as PostgreSQL
    participant Store as Volume /data

    User->>Client: Chọn tải xuống hoặc kiểm tra tài liệu
    Client->>API: GET /documents/{id}/content (Bearer JWT)
    API->>DB: Xác thực user có grant cho document
    DB-->>API: Metadata + grant
    API->>Store: Đọc ciphertext
    Store-->>API: Ciphertext
    API-->>Client: Bản mã application/octet-stream
    Client->>Client: Kiểm tra SHA-256
    Client->>Client: RSA unwrap AES key rồi AES-GCM decrypt
    Client-->>User: Tải file đã giải mã về thiết bị
```

Endpoint `POST /documents/{id}/verify` đọc file trong volume và so SHA-256 với checksum đã lưu; kết quả được ghi vào audit log.

## Chia sẻ tài liệu

Chỉ chủ sở hữu được cấp quyền chia sẻ. Server không chuyển private key hoặc plaintext AES key. Client của chủ sở hữu mở khóa AES key hiện có bằng private key, bọc lại AES key với public key của người nhận, rồi API lưu grant mới.

```mermaid
sequenceDiagram
    actor Owner as Chủ sở hữu
    participant Client as Trình duyệt chủ sở hữu
    participant API as FastAPI
    participant DB as PostgreSQL
    actor Recipient as Người nhận

    Owner->>Client: Chọn tài liệu và nhập email người nhận
    Client->>API: GET /users/public-key?email=...
    API->>DB: Tìm tài khoản người nhận
    DB-->>Client: Public key RSA của người nhận
    Client->>Client: Mở wrapped AES key bằng private key của chủ sở hữu
    Client->>Client: Bọc AES key bằng public key người nhận
    Client->>API: POST /documents/{id}/shares (email, wrapped_key)
    API->>DB: Kiểm tra owner, chống grant trùng, lưu grant và audit event
    DB-->>API: Grant đã lưu
    API-->>Owner: Metadata tài liệu và danh sách grants
    Recipient->>API: GET /documents (Bearer JWT)
    API->>DB: Lấy tài liệu và grant của người nhận
    DB-->>Recipient: Metadata + wrapped key dành cho người nhận
    Recipient->>API: GET /documents/{id}/content (Bearer JWT)
    API->>DB: Kiểm tra DocumentGrant của người nhận
    API-->>Recipient: Ciphertext
    Recipient->>Recipient: Mở khóa AES key bằng private key cá nhân và giải mã
```

## Quản trị hệ thống

Admin đầu tiên được bootstrap bằng token cấu hình phía server, sau khi đăng nhập và khi hệ thống chưa có admin. Tất cả endpoint `/admin/*` còn lại dùng dependency `require_admin`; ẩn đường dẫn trên client không thay thế kiểm tra quyền ở API.

```mermaid
sequenceDiagram
    actor Admin as Người dùng được cấp quyền
    participant Client as Trình duyệt
    participant API as FastAPI
    participant DB as PostgreSQL
    participant Store as Volume /data

    Admin->>Client: Đăng nhập, mở /profile và nhập bootstrap token
    Client->>API: POST /admin/bootstrap (Bearer JWT + token)
    API->>DB: Kiểm tra chưa có admin và token cấu hình khớp
    API->>DB: Đặt is_admin=true, ghi audit event
    API-->>Client: User có quyền admin
    Admin->>Client: Mở /admin
    Client->>API: GET overview/users/documents/activity
    API->>API: require_admin kiểm tra role từ DB
    API->>DB: Đọc thống kê và dữ liệu quản trị
    DB-->>Client: Tổng quan, danh sách và audit log
    Admin->>Client: Khóa/mở user hoặc xóa user/tài liệu
    Client->>API: PATCH/DELETE /admin/* (Bearer JWT)
    API->>API: Kiểm tra quyền và các ràng buộc bảo vệ admin
    API->>DB: Cập nhật/xóa dữ liệu và ghi audit event
    API->>Store: Xóa ciphertext nếu xóa tài khoản/tài liệu sở hữu file
    API-->>Client: Kết quả thao tác
```

## Endpoint tham chiếu

| Luồng | Endpoint chính |
| --- | --- |
| Đăng ký / đăng nhập | `POST /api/v1/auth/register`, `POST /api/v1/auth/login` |
| Hồ sơ | `GET/PATCH /api/v1/auth/me` |
| Bootstrap admin | `POST /api/v1/admin/bootstrap` |
| Upload / danh sách / download | `POST/GET /api/v1/documents`, `GET /api/v1/documents/{id}/content` |
| Xác minh checksum | `POST /api/v1/documents/{id}/verify` |
| Chia sẻ | `GET /api/v1/users/public-key`, `POST /api/v1/documents/{id}/shares` |
| Quản trị | `/api/v1/admin/overview`, `/users`, `/documents`, `/activity` |
