from datetime import datetime, timezone
from sqlalchemy import BigInteger, Boolean, DateTime, ForeignKey, Integer, String, Text, UniqueConstraint, func
from sqlalchemy.orm import Mapped, mapped_column, relationship
from .database import Base

def now_utc(): return datetime.now(timezone.utc)

class User(Base):
    __tablename__ = "users"
    __table_args__ = (UniqueConstraint("email", name="uq_users_email"),)
    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    email: Mapped[str] = mapped_column(String(320), index=True)
    display_name: Mapped[str] = mapped_column(String(120))
    password_hash: Mapped[str] = mapped_column(String(255))
    public_key: Mapped[str] = mapped_column(Text)
    encrypted_private_key: Mapped[str] = mapped_column(Text)
    private_key_iv: Mapped[str] = mapped_column(String(64))
    kdf_salt: Mapped[str] = mapped_column(String(64))
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)
    is_admin: Mapped[bool] = mapped_column(Boolean, default=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())
    documents: Mapped[list["Document"]] = relationship(back_populates="owner", cascade="all, delete-orphan")

class Document(Base):
    __tablename__ = "documents"
    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    owner_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    original_name: Mapped[str] = mapped_column(String(255))
    content_type: Mapped[str] = mapped_column(String(255), default="application/octet-stream")
    original_size: Mapped[int] = mapped_column(BigInteger)
    ciphertext_size: Mapped[int] = mapped_column(BigInteger)
    storage_key: Mapped[str] = mapped_column(String(64), unique=True)
    cipher_nonce: Mapped[str] = mapped_column(String(64))
    checksum_sha256: Mapped[str] = mapped_column(String(128), index=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())
    owner: Mapped[User] = relationship(back_populates="documents")
    grants: Mapped[list["DocumentGrant"]] = relationship(back_populates="document", cascade="all, delete-orphan")

class DocumentGrant(Base):
    __tablename__ = "document_grants"
    __table_args__ = (UniqueConstraint("document_id", "user_id", name="uq_document_grant_user"),)
    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    document_id: Mapped[int] = mapped_column(ForeignKey("documents.id", ondelete="CASCADE"), index=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    wrapped_key: Mapped[str] = mapped_column(Text)
    granted_by_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="RESTRICT"))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    document: Mapped[Document] = relationship(back_populates="grants")
    user: Mapped[User] = relationship(foreign_keys=[user_id])
    granted_by: Mapped[User] = relationship(foreign_keys=[granted_by_id])

class AuditLog(Base):
    __tablename__ = "audit_logs"
    id: Mapped[int] = mapped_column(BigInteger, primary_key=True)
    user_id: Mapped[int | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"), index=True)
    document_id: Mapped[int | None] = mapped_column(ForeignKey("documents.id", ondelete="SET NULL"), index=True)
    action: Mapped[str] = mapped_column(String(64), index=True)
    details: Mapped[str | None] = mapped_column(Text)
    ip_address: Mapped[str | None] = mapped_column(String(64))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), index=True)
