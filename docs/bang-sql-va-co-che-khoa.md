# Công dụng các bảng SQL và Cơ chế quản lý khóa

Tài liệu này giải thích chi tiết vai trò của từng bảng trong cơ sở dữ liệu PostgreSQL (định nghĩa tại [`server/app/models.py`](../server/app/models.py)) và cơ chế lưu trữ khóa bảo mật (như `encrypted_private_key`, `private_key_iv`, `wrapped_key`) của hệ thống **VaultShare**.

---

## 1. Công dụng của các bảng (Table) trong SQL

Hệ thống gồm **4 bảng chính** (ngoài bảng `alembic_version` do Alembic dùng để theo dõi phiên bản migration):

### 1.1. Bảng `users`
Lưu thông tin định danh tài khoản, dữ liệu xác thực đăng nhập và **bộ khóa bất đối xứng** của từng người dùng.

| Cột | Kiểu dữ liệu | Công dụng |
| :--- | :--- | :--- |
| `id` | `Integer` (PK) | Khóa chính định danh người dùng. |
| `email` | `String(320)` (Unique) | Email đăng nhập (chuẩn hóa chữ thường, ràng buộc duy nhất `uq_users_email`). |
| `display_name` | `String(120)` | Tên hiển thị của người dùng trên giao diện. |
| `password_hash` | `String(255)` | Mật khẩu đã băm bằng **Argon2id** dùng để xác thực đăng nhập (server không lưu mật khẩu gốc). |
| `public_key` | `Text` | Khóa công khai **RSA-OAEP 2048-bit** (chuẩn SPKI, mã hóa base64). Người khác dùng khóa này để bọc khóa AES khi chia sẻ tài liệu cho user. |
| `encrypted_private_key` | `Text` | Khóa riêng tư RSA (chuẩn PKCS#8) **đã bị mã hóa ở trình duyệt** bằng AES-GCM trước khi gửi lên server. |
| `private_key_iv` | `String(64)` | Vector khởi tạo (IV / Nonce 12 byte, base64) dùng khi mã hóa/giải mã `encrypted_private_key`. |
| `kdf_salt` | `String(64)` | Chuỗi muối ngẫu nhiên (16 byte, base64) dùng cho thuật toán PBKDF2 để dẫn xuất khóa từ mật khẩu. |
| `is_active` | `Boolean` | Trạng thái hoạt động (`True` = bình thường, `False` = bị quản trị viên khóa). |
| `is_admin` | `Boolean` | Đánh dấu quyền quản trị hệ thống (`True` = admin). |
| `created_at`, `updated_at` | `DateTime(tz)` | Thời điểm tạo tài khoản và cập nhật gần nhất. |

### 1.2. Bảng `documents`
Lưu **metadata và thông số mật mã** của tài liệu. Nội dung tệp đã mã hóa (bản mã) **không** lưu dưới dạng BLOB trong SQL mà lưu thành file trên ổ đĩa / Docker volume (`STORAGE_PATH`).

| Cột | Kiểu dữ liệu | Công dụng |
| :--- | :--- | :--- |
| `id` | `Integer` (PK) | Khóa chính định danh tài liệu. |
| `owner_id` | `Integer` (FK $\rightarrow$ `users.id`) | Chủ sở hữu gốc của tài liệu (`ON DELETE CASCADE`). |
| `original_name` | `String(255)` | Tên tệp gốc ban đầu. |
| `content_type` | `String(255)` | Kiểu MIME của tệp (ví dụ `application/pdf`, `image/png`). |
| `original_size` | `BigInteger` | Kích thước tệp gốc trước khi mã hóa (tính bằng byte). |
| `ciphertext_size` | `BigInteger` | Kích thước tệp bản mã trên đĩa (`original_size + 16` byte Auth Tag của AES-GCM). |
| `storage_key` | `String(64)` (Unique) | Tên tệp ngẫu nhiên (`secrets.token_hex(24)`) trỏ tới file bản mã trên ổ đĩa server, giúp che giấu tên file thật trên hệ thống tệp. |
| `cipher_nonce` | `String(64)` | IV / Nonce 12 byte (base64) của AES-GCM dùng để giải mã bản mã nội dung tệp. |
| `checksum_sha256` | `String(128)` | Mã băm SHA-256 (hex) của bản mã, dùng để đối chiếu tính toàn vẹn trước khi giải mã hoặc khi kiểm tra lưu trữ. |
| `created_at`, `updated_at` | `DateTime(tz)` | Thời điểm tải lên và cập nhật. |

### 1.3. Bảng `document_grants`
Là bảng trung gian **phân quyền truy cập và phân phối khóa** giữa `users` và `documents`. Có ràng buộc duy nhất `uq_document_grant_user` trên cặp `(document_id, user_id)` — mỗi user tối đa 1 dòng grant cho mỗi tài liệu.

| Cột | Kiểu dữ liệu | Công dụng |
| :--- | :--- | :--- |
| `id` | `Integer` (PK) | Khóa chính của bản ghi cấp quyền. |
| `document_id` | `Integer` (FK $\rightarrow$ `documents.id`) | Tài liệu được cấp quyền (`ON DELETE CASCADE`). |
| `user_id` | `Integer` (FK $\rightarrow$ `users.id`) | Người dùng được phép truy cập (bao gồm cả chủ sở hữu khi upload và người được chia sẻ) (`ON DELETE CASCADE`). |
| `wrapped_key` | `Text` | Khóa AES-256 của tài liệu **đã được bọc (encrypt) bằng `public_key` RSA-OAEP của `user_id`**. Mỗi người nhận có một bản `wrapped_key` riêng cho cùng một tài liệu. |
| `granted_by_id` | `Integer` (FK $\rightarrow$ `users.id`) | Người đã thực hiện chia sẻ / cấp quyền (`ON DELETE RESTRICT`). |
| `can_view` | `Boolean` | Quyền xem thông tin và kiểm tra tính toàn vẹn lưu trữ của tài liệu (mặc định `True`). |
| `can_download` | `Boolean` | Quyền tải bản mã về và giải mã tệp gốc (mặc định `True`). |
| `can_share` | `Boolean` | Quyền chia sẻ tiếp, chỉnh sửa quyền hoặc thu hồi quyền của người nhận khác (mặc định `False`). |
| `created_at` | `DateTime(tz)` | Thời điểm được cấp quyền. |

### 1.4. Bảng `audit_logs`
Ghi nhật ký bảo mật phục vụ truy vết các hành động quan trọng trong hệ thống.

| Cột | Kiểu dữ liệu | Công dụng |
| :--- | :--- | :--- |
| `id` | `BigInteger` (PK) | Khóa chính tăng dần. |
| `user_id` | `Integer` (FK $\rightarrow$ `users.id`, nullable) | Người thực hiện hành động (`ON DELETE SET NULL` để giữ lịch sử ngay cả khi tài khoản bị xóa). |
| `document_id` | `Integer` (FK $\rightarrow$ `documents.id`, nullable) | Tài liệu liên quan (`ON DELETE SET NULL` để giữ lịch sử ngay cả khi tài liệu bị xóa). |
| `action` | `String(64)` | Mã sự kiện (ví dụ: `account_created`, `login`, `login_failed`, `document_uploaded`, `ciphertext_downloaded`, `storage_verified`, `document_shared`, `permission_updated`, `share_revoked`, `document_deleted`). |
| `details` | `Text` (nullable) | Thông tin chi tiết bổ sung (tên tệp, email người nhận, cờ quyền được cấp...). |
| `ip_address` | `String(64)` (nullable) | Địa chỉ IP của client gửi yêu cầu. |
| `created_at` | `DateTime(tz)` | Thời điểm phát sinh sự kiện. |

---

## 2. Cơ chế `encrypted_private_key` và `private_key_iv`

Hai cột này trong bảng `users` giải quyết bài toán: **Làm sao người dùng đăng nhập lại trên trình duyệt/thiết bị mới vẫn giải mã được tài liệu cũ, trong khi server không bao giờ biết khóa riêng tư (`private_key`) dạng rõ?**

### 2.1. Vai trò từng thành phần
- **`encrypted_private_key`**:
  - Là khóa riêng tư RSA-OAEP (xuất ở định dạng PKCS#8) **đã được mã hóa bằng thuật toán AES-GCM 256-bit** ngay trên trình duyệt lúc đăng ký (hàm `makeKeyBundle` trong [`client/src/lib/crypto.ts`](../client/src/lib/crypto.ts)).
  - Khi người dùng tải lại trang hoặc đăng nhập trên máy khác, `CryptoKey` trong RAM bị mất. Server gửi trả `encrypted_private_key` về để trình duyệt mở khóa lại đúng `private_key` ban đầu.
  - Nếu kẻ tấn công hoặc quản trị viên đọc được toàn bộ database, họ vẫn không thể giải mã `encrypted_private_key` vì không có mật khẩu gốc của người dùng.
- **`private_key_iv`**:
  - Là chuỗi **Initialization Vector (IV / Nonce) ngẫu nhiên 12 byte** (lưu dạng base64) được tạo cùng lúc mã hóa `private_key`.
  - Trong chuẩn AES-GCM, `iv` không cần giữ bí mật mà cần **duy nhất/ngẫu nhiên** cho mỗi lần mã hóa để đảm bảo an toàn mật mã.
  - Khi đăng nhập lại, hàm `unlockPrivateKey` bắt buộc phải kết hợp đúng `password` + `kdf_salt` + `private_key_iv` mới giải mã và xác thực (verify Auth Tag) được `encrypted_private_key`.

### 2.2. Công thức mã hóa & giải mã khóa riêng tư

$$\text{AES Key} = \text{PBKDF2}(\text{password},\ \text{kdf\_salt},\ 310000,\ \text{SHA-256})$$

1. **Lúc đăng ký (`makeKeyBundle`):**
   $$\text{encrypted\_private\_key} = \text{AES-GCM-Encrypt}(\text{AES Key},\ \text{private\_key\_iv},\ \text{private\_key})$$
2. **Lúc đăng nhập (`unlockPrivateKey`):**
   $$\text{private\_key} = \text{AES-GCM-Decrypt}(\text{AES Key},\ \text{private\_key\_iv},\ \text{encrypted\_private\_key})$$

*(Nếu người dùng quên mật khẩu, server không có cơ chế khôi phục lại `private_key` vì server không lưu mật khẩu gốc lẫn `private_key` dạng rõ.)*

---

## 3. Giải thích các thuật ngữ

| Thuật ngữ | Giải thích |
| :--- | :--- |
| **Plaintext (Bản rõ)** | Dữ liệu gốc chưa mã hóa (nội dung tệp gốc trước khi upload, hoặc khóa ở dạng dùng được ngay). |
| **Ciphertext (Bản mã)** | Dữ liệu đã được mã hóa; không thể đọc được nếu không có đúng khóa và tham số giải mã (`cipher_nonce` / `private_key_iv`). |
| **AES-256-GCM** | Thuật toán mã hóa đối xứng dùng khóa 256-bit ở chế độ GCM (*Galois/Counter Mode*). Vừa mã hóa bảo mật dữ liệu vừa sinh thẻ xác thực (**Auth Tag 16 byte**) để phát hiện nếu bản mã bị sửa đổi. |
| **RSA-OAEP (2048-bit)** | Thuật toán mã hóa bất đối xứng dùng cặp khóa `public_key` (để mã hóa) và `private_key` (để giải mã) với cơ chế đệm OAEP + hàm băm SHA-256. Trong VaultShare dùng để **bọc/mở khóa AES**. |
| **Key Wrapping (`wrapped_key`)** | Kỹ thuật dùng khóa công khai RSA (`public_key`) để mã hóa ("bọc") một khóa đối xứng AES. Nhờ đó nhiều người dùng có thể giải mã cùng 1 file ciphertext mà không cần chia sẻ chung private key. |
| **PBKDF2 (HMAC-SHA-256)** | Hàm dẫn xuất khóa (*Password-Based Key Derivation Function 2*). Lặp hàm băm 310.000 lần cùng `kdf_salt` để biến mật khẩu người dùng thành khóa AES 256-bit đủ mạnh, chống tấn công dò mật khẩu brute-force. |
| **kdf_salt (Salt)** | Chuỗi byte ngẫu nhiên gắn thêm vào mật khẩu trước khi chạy PBKDF2, giúp hai người dùng đặt cùng mật khẩu vẫn sinh ra khóa dẫn xuất khác nhau và chống tấn công bảng cầu vồng (rainbow table). |
| **IV / Nonce (`private_key_iv`, `cipher_nonce`)** | *Initialization Vector / Number used once* — chuỗi 12 byte ngẫu nhiên dùng một lần cho một phép mã hóa AES-GCM, đảm bảo cùng một dữ liệu và khóa nhưng mỗi lần mã hóa cho ra bản mã khác nhau. |
| **Argon2id (`password_hash`)** | Thuật toán băm mật khẩu hiện đại kháng GPU/ASIC, được server dùng để lưu trữ và kiểm tra mật khẩu đăng nhập trong bảng `users`. |
| **SHA-256 (`checksum_sha256`)** | Hàm băm mật mã tạo chuỗi định danh 256-bit (64 ký tự hex) duy nhất cho dữ liệu; dùng để kiểm tra bản mã tải lên hoặc tải về có bị lỗi truyền tải hay bị chỉnh sửa hay không. |
| **SPKI / PKCS#8** | Hai chuẩn định dạng nhị phân phổ biến của Web Crypto API khi xuất/nhập khóa bất đối xứng: **SPKI** dùng cho `public_key`, **PKCS#8** dùng cho `private_key`. |
| **JWT (JSON Web Token)** | Chuỗi token xác thực phiên đăng nhập (`access_token`) gửi qua HTTP header `Authorization: Bearer <token>`. |
| **Zero-Knowledge Storage** | Mô hình lưu trữ mà máy chủ không nắm được khóa giải mã dạng rõ hay nội dung dữ liệu gốc của người dùng; toàn bộ mã hóa/giải mã diễn ra ở phía client. |
