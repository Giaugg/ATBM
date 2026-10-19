from datetime import datetime, timedelta, timezone
import jwt
from pwdlib import PasswordHash
from fastapi import Depends, HTTPException
from fastapi.security import OAuth2PasswordBearer
from sqlalchemy.orm import Session
from .config import settings
from .database import get_db
from .models import User

password_hash = PasswordHash.recommended()
oauth = OAuth2PasswordBearer(tokenUrl="/api/v1/auth/login")

def hash_password(password: str) -> str: return password_hash.hash(password)
def verify_password(password: str, hashed: str) -> bool: return password_hash.verify(password, hashed)
def make_token(user: User) -> str:
    exp = datetime.now(timezone.utc) + timedelta(minutes=settings.access_token_minutes)
    return jwt.encode({"sub": str(user.id), "exp": exp}, settings.jwt_secret, algorithm="HS256")

def current_user(token: str = Depends(oauth), db: Session = Depends(get_db)) -> User:
    try:
        payload = jwt.decode(token, settings.jwt_secret, algorithms=["HS256"])
        user_id = int(payload["sub"])
    except (jwt.PyJWTError, KeyError, ValueError):
        raise HTTPException(status_code=401, detail="Phiên đăng nhập không hợp lệ hoặc đã hết hạn", headers={"WWW-Authenticate":"Bearer"})
    user = db.get(User, user_id)
    if not user or not user.is_active: raise HTTPException(status_code=401, detail="Tài khoản không hoạt động")
    return user

def require_admin(user: User = Depends(current_user)) -> User:
    if not user.is_admin: raise HTTPException(status_code=403, detail="Cần quyền quản trị")
    return user
