"""Create local demo accounts and Web Crypto-compatible encrypted RSA keys."""
import base64
import os

from cryptography.hazmat.primitives import hashes, serialization
from cryptography.hazmat.primitives.asymmetric import rsa
from cryptography.hazmat.primitives.ciphers.aead import AESGCM
from cryptography.hazmat.primitives.kdf.pbkdf2 import PBKDF2HMAC
from sqlalchemy import select

from .config import settings
from .database import SessionLocal
from .models import User
from .security import hash_password

DEMO_ACCOUNTS = (
    ("demo.owner@example.com", "VaultOwner2026!", "Demo Owner"),
    ("demo.guest@example.com", "VaultGuest2026!", "Demo Guest"),
)

def b64(value: bytes) -> str:
    return base64.b64encode(value).decode("ascii")

def create_account(email: str, password: str, display_name: str) -> User:
    pair = rsa.generate_private_key(public_exponent=65537, key_size=2048)
    private_der = pair.private_bytes(serialization.Encoding.DER, serialization.PrivateFormat.PKCS8, serialization.NoEncryption())
    public_der = pair.public_key().public_bytes(serialization.Encoding.DER, serialization.PublicFormat.SubjectPublicKeyInfo)
    salt, iv = os.urandom(16), os.urandom(12)
    key = PBKDF2HMAC(algorithm=hashes.SHA256(), length=32, salt=salt, iterations=310000).derive(password.encode("utf-8"))
    encrypted_private_key = AESGCM(key).encrypt(iv, private_der, None)
    return User(
        email=email,
        display_name=display_name,
        password_hash=hash_password(password),
        public_key=b64(public_der),
        encrypted_private_key=b64(encrypted_private_key),
        private_key_iv=b64(iv),
        kdf_salt=b64(salt),
    )

def main():
    if not settings.seed_demo_users:
        print("Demo account seeding is disabled (set SEED_DEMO_USERS=true to enable).")
        return
    created = []
    with SessionLocal() as db:
        for email, password, display_name in DEMO_ACCOUNTS:
            if db.scalar(select(User.id).where(User.email == email)):
                continue
            db.add(create_account(email, password, display_name))
            created.append(email)
        db.commit()
    print(f"Demo accounts ready; newly created: {', '.join(created) if created else 'none (already seeded)'}")

if __name__ == "__main__":
    main()
