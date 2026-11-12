# Luồng hoạt động chính

Tài liệu này mô tả toàn bộ các luồng hoạt động đang được triển khai trong **VaultShare** theo sơ đồ **3 cột chia từng bước theo hàng ngang**:
- **Cột 1 — User (Trình duyệt giữ gì):** Khóa, token và dữ liệu đang có tại trình duyệt ở bước đó.
- **Cột 2 — Mũi tên + File / Key đi kèm:** Chiều truyền qua HTTPS (`───────▶` lên server, `◀───────` về client) cùng dữ liệu đính kèm.
- **Cột 3 — Server (PostgreSQL / Disk giữ gì):** Các bảng SQL và file bản mã trên ổ đĩa được đọc, ghi hoặc kiểm tra ở bước đó.

---

## Tổng quan hệ thống

- **Client (Next.js + Web Crypto):** Quản lý giao diện, JWT phiên, thực hiện toàn bộ mã hóa/giải mã AES-256-GCM và bọc/mở khóa RSA-OAEP, giữ `private_key` (`CryptoKey`) trong RAM.
- **API (FastAPI):** Xác thực JWT, kiểm tra quyền sở hữu và phân quyền (`can_view`, `can_download`, `can_share`), kiểm tra kích thước & checksum SHA-256, ghi metadata và nhật ký kiểm toán.
- **PostgreSQL:** Lưu 4 bảng `users`, `documents`, `document_grants`, `audit_logs` (chi tiết xem tại [Công dụng các bảng SQL và Cơ chế quản lý khóa](bang-sql-va-co-che-khoa.md)).
- **Ổ đĩa / Volume `encrypted_files`:** Lưu byte bản mã (`ciphertext`) dưới tên ngẫu nhiên `storage_key`.

---

## 1. Đăng ký tài khoản (`POST /api/v1/auth/register`)

| Bước | Cột 1: User (Trình duyệt giữ gì) | Cột 2: Mũi tên + File / Key đi kèm | Cột 3: Server (PostgreSQL giữ gì) |
| :---: | :--- | :---: | :--- |
| **1** | • Nhập `email`, `display_name`, `password`<br>• Sinh cặp khóa RSA-OAEP 2048-bit: **`public_key`**, **`private_key`**<br>• Sinh `kdf_salt` (16 byte) và `private_key_iv` (12 byte)<br>• Dùng `PBKDF2(password, kdf_salt)` + AES-GCM mã hóa `private_key` $\rightarrow$ **`encrypted_private_key`** | — | *(Chưa nhận dữ liệu)* |
| **2** | • Giữ `password`, `public_key`, `private_key` trong RAM | `───────▶`<br>`email`, `display_name`, `password`,<br>`public_key`, `encrypted_private_key`,<br>`private_key_iv`, `kdf_salt`<br>*(Không gửi `private_key` rõ)* | • Kiểm tra trùng `email`<br>• Băm `password` bằng Argon2id $\rightarrow$ **`password_hash`**<br>• **INSERT `users`:** `password_hash`, `public_key`, `encrypted_private_key`, `private_key_iv`, `kdf_salt`<br>• **INSERT `audit_logs`:** `account_created` |
| **3** | • Lưu **`access_token` (JWT)** vào `localStorage`<br>• Giữ **`private_key` (`CryptoKey`)** trong RAM, xóa `password` | `◀───────`<br>`access_token` (JWT) + thông tin `user` | • Giữ nguyên bảng `users` + `audit_logs`<br>*(Server **không** có `private_key` rõ)* |

---

## 2. Đăng nhập (`POST /api/v1/auth/login`)

| Bước | Cột 1: User (Trình duyệt giữ gì) | Cột 2: Mũi tên + File / Key đi kèm | Cột 3: Server (PostgreSQL giữ gì) |
| :---: | :--- | :---: | :--- |
| **1** | • Chỉ có `email`, `password` người dùng vừa nhập | `───────▶`<br>`email`, `password` | • Tra `users` theo `email`, đối chiếu `password` với **`password_hash`** (Argon2id)<br>• **INSERT `audit_logs`:** `login` (hoặc `login_failed`) |
| **2** | • Chờ nhận bộ khóa đã mã hóa | `◀───────`<br>`access_token` (JWT), `public_key`,<br>**`encrypted_private_key`**, `private_key_iv`, `kdf_salt` | • Giữ nguyên bảng `users` (`password_hash`, `public_key`, `encrypted_private_key`, `private_key_iv`, `kdf_salt`) |
| **3** | • Dùng `password` + `kdf_salt` + `private_key_iv` giải mã `encrypted_private_key` $\rightarrow$ lấy **`private_key` (`CryptoKey`)** giữ trong RAM<br>• Lưu `access_token` (JWT) vào `localStorage` | — | *(Không giữ `private_key` rõ; sau khi reload trang `CryptoKey` trong RAM mất nên client yêu cầu đăng nhập lại)* |

---

## 3. Tải tài liệu lên (`POST /api/v1/documents`)

| Bước | Cột 1: User (Trình duyệt giữ gì) | Cột 2: Mũi tên + File / Key đi kèm | Cột 3: Server (PostgreSQL + Disk giữ gì) |
| :---: | :--- | :---: | :--- |
| **1** | • Giữ **`private_key`**, **`public_key`**, `JWT`<br>• Chọn **File gốc (plaintext)**<br>• Sinh khóa **`AES-256-GCM`** ngẫu nhiên + `cipher_nonce` (12 byte)<br>• Mã hóa File gốc $\rightarrow$ **`ciphertext`**<br>• Tính **`checksum_sha256`** của `ciphertext`<br>• Dùng `public_key` của mình bọc khóa AES $\rightarrow$ **`wrapped_key`** | — | *(Chưa nhận tệp)* |
| **2** | • Gửi gói dữ liệu mã hóa (`multipart/form-data`) | `───────▶`<br>Header: `Bearer JWT`<br>File: **`ciphertext`** (bản mã)<br>Key/Meta: **`wrapped_key`**, `cipher_nonce`,<br>`checksum_sha256`, `original_name`, `original_size`, `content_type`<br>*(Không gửi File gốc hay AES key rõ)* | • Kiểm tra `ciphertext_size == original_size + 16`, giới hạn `MAX_UPLOAD_BYTES` và `checksum_sha256`<br>• **Ổ đĩa (`STORAGE_PATH`):** ghi file **`ciphertext`** dưới tên ngẫu nhiên **`storage_key`**<br>• **INSERT `documents`:** `owner_id`, `storage_key`, `cipher_nonce`, `checksum_sha256`, metadata tệp<br>• **INSERT `document_grants`:** `user_id = owner`, **`wrapped_key`** (bọc cho owner), `can_view=True`, `can_download=True`, `can_share=False`<br>• **INSERT `audit_logs`:** `document_uploaded` |
| **3** | • Nhận `DocumentOut` hiển thị danh sách tài liệu; vẫn chỉ giữ `private_key` + `JWT` | `◀───────`<br>`DocumentOut` (`id`, `wrapped_key`, `grants[]`, ...) | • Lưu vĩnh viễn: file **`ciphertext`** trên đĩa + metadata trong **`documents`** + **`wrapped_key`** trong **`document_grants`** *(nếu kiểm tra thất bại sẽ rollback DB và xóa file tạm)* |

---

## 4. Tải xuống, Giải mã & Kiểm tra lưu trữ

### 4.1. Tải xuống & Giải mã (`GET /api/v1/documents` $\rightarrow$ `/content`)

| Bước | Cột 1: User (Trình duyệt giữ gì) | Cột 2: Mũi tên + File / Key đi kèm | Cột 3: Server (PostgreSQL + Disk giữ gì) |
| :---: | :--- | :---: | :--- |
| **1** | • Giữ **`private_key` (RSA)** trong RAM + `JWT` | `───────▶`<br>`GET /documents`<br>Header: `Bearer JWT` | • Truy vấn **`document_grants`** theo `user_id` + join **`documents`** |
| **2** | • Nhận danh sách tài liệu cùng **`wrapped_key`** và quyền (`can_view`, `can_download`, `can_share`, `is_owner`) | `◀───────`<br>`DocumentOut[]` (`wrapped_key`, `cipher_nonce`,<br>`checksum_sha256`, quyền của user, `grants[]`) | • Giữ nguyên `documents` + `document_grants` |
| **3** | • Bấm **"Tải xuống"** tài liệu `id` | `───────▶`<br>`GET /documents/{id}/content`<br>Header: `Bearer JWT` | • Kiểm tra **`document_grants`**: user có grant và (`is_owner` hoặc `can_download == True`)<br>• **INSERT `audit_logs`:** `ciphertext_downloaded` |
| **4** | • Nhận **`ciphertext`**, kiểm tra `SHA-256(ciphertext) == checksum_sha256` | `◀───────`<br>Stream file **`ciphertext`** (`application/octet-stream`) | • Đọc file **`ciphertext`** từ ổ đĩa theo `documents.storage_key` và stream về |
| **5** | • Dùng **`private_key`** mở `wrapped_key` $\rightarrow$ lấy **khóa AES gốc**<br>• Dùng **khóa AES** + `cipher_nonce` giải mã `ciphertext` $\rightarrow$ **File gốc (plaintext)** lưu về máy | — | *(Server không bao giờ thấy khóa AES rõ hay File gốc)* |

### 4.2. Kiểm tra toàn vẹn lưu trữ (`POST /api/v1/documents/{id}/verify`)

| Bước | Cột 1: User (Trình duyệt giữ gì) | Cột 2: Mũi tên + File / Key đi kèm | Cột 3: Server (PostgreSQL + Disk giữ gì) |
| :---: | :--- | :---: | :--- |
| **1** | • Giữ `JWT` + `private_key` | `───────▶`<br>`POST /documents/{id}/verify`<br>Header: `Bearer JWT` | • Kiểm tra **`document_grants`**: `is_owner` hoặc `can_view == True`<br>• Đọc file **`ciphertext`** theo `storage_key`, tính lại SHA-256 so với `documents.checksum_sha256`<br>• **INSERT `audit_logs`:** `storage_verified` / `storage_integrity_failed` |
| **2** | • Hiển thị kết quả xác minh server (và kiểm tra giải mã GCM cục bộ nếu tải file) | `◀───────`<br>`{ checksum_valid, expected_sha256, actual_sha256, ciphertext_size }` | • Giữ nguyên dữ liệu |

---

## 5. Chia sẻ tài liệu & Phân quyền linh hoạt

### 5.1. Chia sẻ cho người nhận mới (`GET /users/public-key` $\rightarrow$ `POST /documents/{id}/shares`)

| Bước | Cột 1: User A — Người chia sẻ | Cột 2: Mũi tên + File / Key đi kèm | Cột 3: Server (PostgreSQL) |
| :---: | :--- | :---: | :--- |
| **1** | • Giữ **`private_key_A`** + **`wrapped_key_A`** của tài liệu<br>• Nhập email người nhận **B** và chọn bộ quyền (`can_view`, `can_download`, `can_share`) | `───────▶`<br>`GET /users/public-key?email=B`<br>Header: `Bearer JWT_A` | • Tra bảng **`users`** theo email `B` để lấy khóa công khai |
| **2** | • Nhận **`public_key_B`** | `◀───────`<br>`{ email: B, public_key_B, display_name }` | • Giữ nguyên bảng `users` |
| **3** | • Dùng **`private_key_A`** mở `wrapped_key_A` $\rightarrow$ **khóa AES gốc**<br>• Dùng **`public_key_B`** bọc lại khóa AES $\rightarrow$ **`wrapped_key_B`** | — | *(Server không tham gia bước mở/bọc khóa)* |
| **4** | • Gửi yêu cầu cấp quyền cho B | `───────▶`<br>`POST /documents/{id}/shares`<br>Body: `email = B`, **`wrapped_key_B`**,<br>`can_view`, `can_download`, `can_share` | • Kiểm tra **`document_grants`** của A (`is_owner` hoặc `can_share == True`)<br>• **INSERT `document_grants`:** `user_id = B`, `granted_by_id = A`, **`wrapped_key = wrapped_key_B`**, `can_view`, `can_download`, `can_share`<br>• **INSERT `audit_logs`:** `document_shared` |
| **5** | • Cập nhật danh sách người nhận trên modal chia sẻ | `◀───────`<br>`DocumentOut` (kèm `grants[]` mới) | • Bảng **`document_grants`** có 2 dòng riêng cho cùng tài liệu: `wrapped_key_A` (của A) và `wrapped_key_B` (của B) |

### 5.2. Cập nhật quyền & Thu hồi quyền (`PATCH` / `DELETE /documents/{id}/shares/{grant_id}`)

| Bước | Cột 1: User A — Người quản lý quyền | Cột 2: Mũi tên + File / Key đi kèm | Cột 3: Server (PostgreSQL) |
| :---: | :--- | :---: | :--- |
| **1** | • Giữ `Bearer JWT_A` (không cần xử lý khóa AES hay RSA) | **Đổi quyền:**<br>`───────▶` `PATCH /documents/{id}/shares/{grant_id}`<br>`{ can_view, can_download, can_share }`<br><br>**Thu hồi:**<br>`───────▶` `DELETE /documents/{id}/shares/{grant_id}` | • Kiểm tra A là `owner` hoặc `can_share == True` (chặn sửa/xóa dòng grant của `owner`)<br>• **PATCH:** `UPDATE document_grants` sửa 3 cờ quyền của B<br>• **DELETE:** `DELETE FROM document_grants` xóa dòng của B (xóa luôn `wrapped_key_B`)<br>• **INSERT `audit_logs`:** `permission_updated` / `share_revoked` |
| **2** | • Cập nhật lại danh sách người nhận và quyền trên giao diện | `◀───────`<br>`DocumentOut` (kèm `grants[]` sau cập nhật) | • Nếu đã thu hồi, khi **User B** gọi `GET /documents` hoặc `/content` sẽ không còn dòng trong `document_grants` để lấy `wrapped_key_B` hay tải `ciphertext` |

---

## 6. Quản trị hệ thống (`/profile` & `/admin`)

| Bước | Cột 1: Admin (Trình duyệt) | Cột 2: Mũi tên + File / Key đi kèm | Cột 3: Server (PostgreSQL + Disk) |
| :---: | :--- | :---: | :--- |
| **1** | • Đăng nhập tại `/profile`, nhập **`bootstrap_token`** | `───────▶`<br>`POST /admin/bootstrap`<br>`{ bootstrap_token }` + `Bearer JWT` | • Kiểm tra chưa có admin trong `users` và khớp `ADMIN_BOOTSTRAP_TOKEN`<br>• **UPDATE `users`:** `is_admin = True`<br>• **INSERT `audit_logs`:** `admin_bootstrapped` |
| **2** | • Mở `/admin`, xem thống kê, danh sách tài khoản, tài liệu, nhật ký | `───────▶` `GET /admin/overview`, `/users`, `/documents`, `/activity`<br>`◀───────` Dữ liệu tổng hợp (không có file rõ) | • `require_admin` kiểm tra `users.is_admin == True`<br>• Đọc từ `users`, `documents`, `audit_logs` |
| **3** | • Khóa/mở tài khoản hoặc xóa user / xóa tài liệu | `───────▶` `PATCH /admin/users/{id}/active` hoặc `DELETE /admin/...`<br>`◀───────` Kết quả thao tác | • Kiểm tra ràng buộc bảo vệ admin<br>• **UPDATE/DELETE** trên `users` / `documents`<br>• **Ổ đĩa:** xóa các file `ciphertext` liên quan theo `storage_key`<br>• **INSERT `audit_logs`** |

---

## Endpoint tham chiếu

| Luồng | Endpoint chính |
| :--- | :--- |
| Đăng ký / đăng nhập | `POST /api/v1/auth/register`, `POST /api/v1/auth/login` |
| Hồ sơ | `GET/PATCH /api/v1/auth/me` |
| Bootstrap admin | `POST /api/v1/admin/bootstrap` |
| Upload / danh sách / download | `POST/GET /api/v1/documents`, `GET /api/v1/documents/{id}/content` |
| Xác minh checksum | `POST /api/v1/documents/{id}/verify` |
| Chia sẻ & phân quyền | `GET /api/v1/users/public-key`, `POST /api/v1/documents/{id}/shares`, `PATCH/DELETE /api/v1/documents/{id}/shares/{grant_id}` |
| Quản trị | `/api/v1/admin/overview`, `/users`, `/documents`, `/activity` |

---

## Giải thích các thuật ngữ

| Thuật ngữ | Giải thích |
| :--- | :--- |
| **Plaintext (Bản rõ)** | Dữ liệu gốc chưa mã hóa (nội dung tệp gốc trước khi upload, hoặc khóa ở dạng dùng được ngay). |
| **Ciphertext (Bản mã)** | Dữ liệu đã được mã hóa; không thể đọc được nếu không có đúng khóa và tham số giải mã (`cipher_nonce` / `private_key_iv`). |
| **AES-256-GCM** | Thuật toán mã hóa đối xứng dùng khóa 256-bit ở chế độ GCM (*Galois/Counter Mode*). Vừa mã hóa nội dung tệp vừa sinh thẻ xác thực (**Auth Tag 16 byte**) để phát hiện mọi thay đổi trái phép trên bản mã. |
| **RSA-OAEP (2048-bit)** | Thuật toán mã hóa bất đối xứng dùng cặp `public_key` (để bọc khóa) và `private_key` (để mở khóa) với cơ chế đệm OAEP và hàm băm SHA-256. |
| **Key Wrapping (`wrapped_key`)** | Kỹ thuật dùng `public_key` RSA của từng người dùng để mã hóa ("bọc") khóa AES của tài liệu. Nhờ đó nhiều người cùng đọc được một file `ciphertext` mà mỗi người dùng một `private_key` riêng. |
| **encrypted_private_key** | Khóa riêng tư RSA (PKCS#8) đã được mã hóa bằng AES-GCM ở trình duyệt trước khi gửi lên server, giúp người dùng đăng nhập lại vẫn giữ nguyên khóa cũ mà server không đọc được khóa rõ. |
| **PBKDF2 & `kdf_salt`** | *Password-Based Key Derivation Function 2* (310.000 vòng SHA-256) kết hợp chuỗi muối ngẫu nhiên `kdf_salt` để biến mật khẩu người dùng thành khóa AES 256-bit dùng mã hóa/giải mã `encrypted_private_key`. |
| **IV / Nonce (`private_key_iv`, `cipher_nonce`)** | *Initialization Vector / Number used once* — chuỗi 12 byte ngẫu nhiên dùng một lần cho mỗi phép mã hóa AES-GCM, đảm bảo an toàn khi cùng một khóa được dùng nhiều lần. |
| **Argon2id (`password_hash`)** | Thuật toán băm mật khẩu kháng GPU/ASIC dùng trên server để lưu và kiểm tra mật khẩu đăng nhập trong bảng `users`. |
| **SHA-256 (`checksum_sha256`)** | Mã băm 256-bit (64 ký tự hex) của bản mã, dùng để đối chiếu tính toàn vẹn khi tải lên, tải xuống hoặc kiểm tra lưu trữ (`/verify`). |
| **storage_key** | Tên tệp ngẫu nhiên sinh trên server (`secrets.token_hex(24)`) dùng để lưu `ciphertext` trên ổ đĩa, tách biệt hoàn toàn với tên tệp gốc `original_name`. |
| **DocumentGrant** | Bản ghi cấp quyền trong bảng `document_grants`, gắn một `user_id` với một `document_id`, chứa `wrapped_key` riêng cho user đó cùng 3 cờ quyền `can_view`, `can_download`, `can_share`. |
| **JWT (Bearer Token)** | *JSON Web Token* (`access_token`) cấp sau khi đăng nhập/đăng ký, gửi kèm header `Authorization: Bearer <token>` để xác thực các API. |
| **AuditLog** | Bản ghi nhật ký sự kiện bảo mật trong bảng `audit_logs` (lưu `action`, `details`, `ip_address`, `user_id`, `document_id`, `created_at`). |
