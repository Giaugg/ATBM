from datetime import datetime
from pydantic import BaseModel, ConfigDict, EmailStr, Field

class RegisterIn(BaseModel):
    email: EmailStr
    password: str = Field(min_length=10, max_length=128)
    display_name: str = Field(min_length=1, max_length=120)
    public_key: str = Field(min_length=20)
    encrypted_private_key: str = Field(min_length=20)
    private_key_iv: str = Field(min_length=8, max_length=64)
    kdf_salt: str = Field(min_length=8, max_length=64)

class LoginIn(BaseModel):
    email: EmailStr
    password: str = Field(min_length=1, max_length=128)

class UserOut(BaseModel):
    id: int; email: str; display_name: str; public_key: str; is_admin: bool
    encrypted_private_key: str; private_key_iv: str; kdf_salt: str; created_at: datetime
    model_config = ConfigDict(from_attributes=True)

class ProfileUpdateIn(BaseModel):
    display_name: str = Field(min_length=1, max_length=120)

class AdminBootstrapIn(BaseModel):
    bootstrap_token: str = Field(min_length=1, max_length=512)

class AdminUserActiveIn(BaseModel):
    is_active: bool

class AdminUserOut(BaseModel):
    id: int; email: str; display_name: str; is_active: bool; is_admin: bool; created_at: datetime

class AdminDocumentOut(BaseModel):
    id: int; original_name: str; content_type: str; original_size: int
    ciphertext_size: int; owner_email: str; created_at: datetime

class AdminAuditOut(BaseModel):
    id: int; action: str; details: str | None; created_at: datetime
    actor_email: str | None; document_name: str | None

class AdminOverviewOut(BaseModel):
    total_users: int; active_users: int; total_documents: int
    storage_bytes: int; total_events: int

class TokenOut(BaseModel):
    access_token: str; token_type: str = "bearer"; user: UserOut

class ShareIn(BaseModel):
    email: EmailStr
    wrapped_key: str = Field(min_length=20)
    can_view: bool = True
    can_download: bool = True
    can_share: bool = False

class UpdateGrantIn(BaseModel):
    can_view: bool = True
    can_download: bool = True
    can_share: bool = False

class GrantOut(BaseModel):
    id: int; user_id: int; email: str; display_name: str; created_at: datetime
    can_view: bool; can_download: bool; can_share: bool

class DocumentOut(BaseModel):
    id: int; original_name: str; content_type: str; original_size: int; ciphertext_size: int
    cipher_nonce: str; checksum_sha256: str; owner_email: str; created_at: datetime
    wrapped_key: str; can_view: bool; can_download: bool; can_share: bool; is_owner: bool
    grants: list[GrantOut]

class StatsOut(BaseModel):
    document_count: int; storage_bytes: int; shared_count: int; recipient_count: int

class AuditOut(BaseModel):
    id: int; action: str; details: str | None; created_at: datetime; document_name: str | None

class MessageOut(BaseModel): message: str
