# VaultShare database design

PostgreSQL schema managed by Alembic. The complete initial DDL is [migration 0001](../server/migrations/versions/0001_initial_schema.py).

```mermaid
erDiagram
    USERS ||--o{ DOCUMENTS : owns
    USERS ||--o{ DOCUMENT_GRANTS : receives
    USERS ||--o{ DOCUMENT_GRANTS : grants
    DOCUMENTS ||--|{ DOCUMENT_GRANTS : access_keys
    USERS ||--o{ AUDIT_LOGS : performs
    DOCUMENTS o|--o{ AUDIT_LOGS : concerns

    USERS {
      int id PK
      varchar email UK
      varchar display_name
      varchar password_hash
      text public_key
      text encrypted_private_key
      varchar private_key_iv
      varchar kdf_salt
      boolean is_active
      boolean is_admin
      timestamptz created_at
      timestamptz updated_at
    }
    DOCUMENTS {
      int id PK
      int owner_id FK
      varchar original_name
      varchar content_type
      bigint original_size
      bigint ciphertext_size
      varchar storage_key UK
      varchar cipher_nonce
      varchar checksum_sha256
      timestamptz created_at
      timestamptz updated_at
    }
    DOCUMENT_GRANTS {
      int id PK
      int document_id FK
      int user_id FK
      text wrapped_key
      int granted_by_id FK
      boolean can_view
      boolean can_download
      boolean can_share
      timestamptz created_at
    }
    AUDIT_LOGS {
      bigint id PK
      int user_id FK
      int document_id FK
      varchar action
      text details
      varchar ip_address
      timestamptz created_at
    }
```

## Tables

- **users** — credentials hashed with Argon2id; RSA public key and password-encrypted PKCS#8 private-key bundle. The server does not receive the private key in plaintext.
- **documents** — encrypted-file metadata and opaque storage key. The actual encrypted bytes live in the encrypted-file volume, not a database BLOB.
- **document_grants** — one row per user with access to a document, including the RSA-OAEP wrapped AES file key. Owner access is also a grant. `(document_id, user_id)` is unique.
- **audit_logs** — account, upload, share, download, verification and delete events. File names and recipients may be in event details, so protect access to this table.

Deleting a user cascades their owned documents and grants. Deleting a document cascades its grants; audit references become null to retain the audit event. Backups must cover PostgreSQL and the encrypted-file volume together.

Xem thêm chi tiết từng cột và cơ chế khóa tại [Công dụng các bảng SQL và Cơ chế quản lý khóa](bang-sql-va-co-che-khoa.md).

## Glossary / Giải thích thuật ngữ

| Thuật ngữ | Giải thích |
| :--- | :--- |
| **PK / FK / UK** | *Primary Key* (khóa chính), *Foreign Key* (khóa ngoại liên kết bảng), *Unique Key* (ràng buộc giá trị duy nhất). |
| **Argon2id (`password_hash`)** | Thuật toán băm mật khẩu kháng GPU/ASIC dùng trên server để lưu và kiểm tra mật khẩu đăng nhập. |
| **PKCS#8 / SPKI** | Định dạng nhị phân chuẩn của khóa riêng tư (`encrypted_private_key`) và khóa công khai (`public_key`). |
| **IV / Nonce (`private_key_iv`, `cipher_nonce`)** | *Initialization Vector / Number used once* — chuỗi 12 byte ngẫu nhiên dùng một lần cho mỗi phép mã hóa AES-GCM. |
| **PBKDF2 & `kdf_salt`** | Hàm dẫn xuất khóa lặp 310.000 lần từ mật khẩu + chuỗi muối ngẫu nhiên `kdf_salt` để tạo khóa AES mở `encrypted_private_key`. |
| **wrapped_key** | Khóa AES-256 của tài liệu được bọc bằng `public_key` RSA-OAEP của từng người dùng có grant. |
| **storage_key** | Tên tệp ngẫu nhiên trên ổ đĩa trỏ tới file bản mã (`ciphertext`), tách biệt với `original_name`. |
| **checksum_sha256** | Mã băm SHA-256 của bản mã dùng để kiểm tra tính toàn vẹn tệp. |
| **CASCADE / RESTRICT / SET NULL** | Hành vi ràng buộc khóa ngoại khi xóa bản ghi cha: xóa lan truyền (`CASCADE`), chặn xóa (`RESTRICT`), hoặc giữ log bằng cách gán `NULL` (`SET NULL`). |
