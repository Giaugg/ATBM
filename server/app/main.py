from contextlib import asynccontextmanager
from pathlib import Path
import hashlib, hmac, os, secrets
from fastapi import Depends, FastAPI, File, Form, HTTPException, Query, Request, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from sqlalchemy import delete, func, select
from sqlalchemy.orm import Session, joinedload
from .config import settings
from .database import get_db
from .models import AuditLog, Document, DocumentGrant, User
from .schemas import AdminAuditOut, AdminBootstrapIn, AdminDocumentOut, AdminOverviewOut, AdminUserActiveIn, AdminUserOut, AuditOut, DocumentOut, LoginIn, MessageOut, ProfileUpdateIn, RegisterIn, ShareIn, StatsOut, TokenOut, UserOut
from .security import current_user, hash_password, make_token, require_admin, verify_password

@asynccontextmanager
async def lifespan(_: FastAPI):
    Path(settings.storage_path).mkdir(parents=True, exist_ok=True)
    yield

app = FastAPI(title="VaultShare API", version="1.0.0", description="API lưu trữ bản mã tài liệu VaultShare", lifespan=lifespan)
app.add_middleware(CORSMiddleware, allow_origins=[x.strip() for x in settings.cors_origins.split(',')], allow_credentials=True, allow_methods=["GET","POST","DELETE","OPTIONS"], allow_headers=["Authorization","Content-Type"])

def audit(db: Session, user_id: int | None, action: str, detail: str | None = None, document_id: int | None = None, request: Request | None = None):
    ip = request.client.host if request and request.client else None
    db.add(AuditLog(user_id=user_id, action=action, details=detail, document_id=document_id, ip_address=ip))

def get_document_for_user(db: Session, document_id: int, user_id: int):
    doc = db.execute(select(Document).options(joinedload(Document.grants).joinedload(DocumentGrant.user),joinedload(Document.owner)).where(Document.id == document_id)).unique().scalar_one_or_none()
    if not doc: raise HTTPException(404, "Không tìm thấy tài liệu")
    grant = next((g for g in doc.grants if g.user_id == user_id), None)
    if not grant: raise HTTPException(404, "Không tìm thấy tài liệu")
    return doc, grant

def document_out(doc: Document, grant: DocumentGrant) -> DocumentOut:
    return DocumentOut(id=doc.id, original_name=doc.original_name, content_type=doc.content_type, original_size=doc.original_size, ciphertext_size=doc.ciphertext_size, cipher_nonce=doc.cipher_nonce, checksum_sha256=doc.checksum_sha256, owner_email=doc.owner.email, created_at=doc.created_at, wrapped_key=grant.wrapped_key, grants=[{"email":g.user.email,"display_name":g.user.display_name,"created_at":g.created_at} for g in doc.grants])

@app.get("/health", response_model=MessageOut)
def health(): return {"message":"ok"}

@app.post("/api/v1/auth/register", response_model=TokenOut, status_code=201)
def register(payload: RegisterIn, request: Request, db: Session = Depends(get_db)):
    email = str(payload.email).lower()
    if db.scalar(select(User.id).where(User.email == email)): raise HTTPException(409, "Email đã được đăng ký")
    user = User(email=email, display_name=payload.display_name.strip(), password_hash=hash_password(payload.password), public_key=payload.public_key, encrypted_private_key=payload.encrypted_private_key, private_key_iv=payload.private_key_iv, kdf_salt=payload.kdf_salt)
    db.add(user); db.flush(); audit(db,user.id,"account_created",request=request); db.commit(); db.refresh(user)
    return {"access_token":make_token(user),"user":user}

@app.post("/api/v1/auth/login", response_model=TokenOut)
def login(payload: LoginIn, request: Request, db: Session = Depends(get_db)):
    user = db.scalar(select(User).where(User.email == str(payload.email).lower()))
    if not user or not verify_password(payload.password,user.password_hash):
        audit(db,user.id if user else None,"login_failed",request=request); db.commit(); raise HTTPException(401,"Email hoặc mật khẩu không chính xác")
    audit(db,user.id,"login",request=request); db.commit()
    return {"access_token":make_token(user),"user":user}

@app.get("/api/v1/auth/me", response_model=UserOut)
def me(user: User = Depends(current_user)): return user

@app.patch("/api/v1/auth/me", response_model=UserOut)
def update_profile(payload: ProfileUpdateIn, request: Request, user: User = Depends(current_user), db: Session = Depends(get_db)):
    display_name = payload.display_name.strip()
    if not display_name: raise HTTPException(422, "Tên hiển thị không được để trống")
    user.display_name = display_name
    audit(db,user.id,"profile_updated",display_name,request=request); db.commit(); db.refresh(user)
    return user

@app.post("/api/v1/admin/bootstrap", response_model=UserOut)
def bootstrap_admin(payload: AdminBootstrapIn, request: Request, user: User = Depends(current_user), db: Session = Depends(get_db)):
    configured_token = settings.admin_bootstrap_token
    if not configured_token: raise HTTPException(404, "Chưa cấu hình token khởi tạo quản trị")
    if db.scalar(select(User.id).where(User.is_admin.is_(True))): raise HTTPException(409, "Quyền quản trị đã được khởi tạo")
    if not hmac.compare_digest(payload.bootstrap_token, configured_token): raise HTTPException(403, "Token khởi tạo không hợp lệ")
    user.is_admin = True
    audit(db,user.id,"admin_bootstrapped",request=request); db.commit(); db.refresh(user)
    return user

@app.get("/api/v1/admin/overview", response_model=AdminOverviewOut)
def admin_overview(admin: User = Depends(require_admin), db: Session = Depends(get_db)):
    return AdminOverviewOut(
        total_users=db.scalar(select(func.count()).select_from(User)) or 0,
        active_users=db.scalar(select(func.count()).select_from(User).where(User.is_active.is_(True))) or 0,
        total_documents=db.scalar(select(func.count()).select_from(Document)) or 0,
        storage_bytes=db.scalar(select(func.coalesce(func.sum(Document.original_size),0))) or 0,
        total_events=db.scalar(select(func.count()).select_from(AuditLog)) or 0,
    )

@app.get("/api/v1/admin/users", response_model=list[AdminUserOut])
def admin_users(offset: int = Query(0, ge=0), limit: int = Query(50, ge=1, le=100), admin: User = Depends(require_admin), db: Session = Depends(get_db)):
    return db.scalars(select(User).order_by(User.created_at.desc()).offset(offset).limit(limit)).all()

@app.patch("/api/v1/admin/users/{user_id}/active", response_model=AdminUserOut)
def admin_set_user_active(user_id: int, payload: AdminUserActiveIn, request: Request, admin: User = Depends(require_admin), db: Session = Depends(get_db)):
    is_active = payload.is_active
    target = db.get(User, user_id)
    if not target: raise HTTPException(404, "Không tìm thấy tài khoản")
    if target.id == admin.id and not is_active: raise HTTPException(422, "Không thể khóa tài khoản quản trị đang sử dụng")
    if target.is_admin and not is_active:
        active_admins = db.scalar(select(func.count()).select_from(User).where(User.is_admin.is_(True), User.is_active.is_(True))) or 0
        if active_admins <= 1: raise HTTPException(409, "Không thể khóa quản trị viên đang hoạt động cuối cùng")
    target.is_active = is_active
    audit(db,admin.id,"admin_user_activated" if is_active else "admin_user_deactivated",target.email,request=request)
    db.commit(); db.refresh(target)
    return target

@app.delete("/api/v1/admin/users/{user_id}", response_model=MessageOut)
def admin_delete_user(user_id: int, request: Request, admin: User = Depends(require_admin), db: Session = Depends(get_db)):
    target = db.get(User, user_id)
    if not target: raise HTTPException(404, "Không tìm thấy tài khoản")
    if target.id == admin.id: raise HTTPException(422, "Không thể xóa tài khoản quản trị đang sử dụng")
    if target.is_admin: raise HTTPException(403, "Không thể xóa tài khoản quản trị khác")
    documents = db.scalars(select(Document).where(Document.owner_id == target.id)).all()
    paths = [Path(settings.storage_path) / doc.storage_key for doc in documents]
    audit(db,admin.id,"admin_user_deleted",target.email,request=request)
    db.execute(delete(DocumentGrant).where(DocumentGrant.granted_by_id == target.id))
    db.execute(delete(DocumentGrant).where(DocumentGrant.user_id == target.id))
    db.execute(delete(Document).where(Document.owner_id == target.id))
    db.execute(delete(User).where(User.id == target.id))
    db.commit()
    for path in paths: path.unlink(missing_ok=True)
    return {"message":"Đã xóa tài khoản và dữ liệu liên quan"}

@app.get("/api/v1/admin/documents", response_model=list[AdminDocumentOut])
def admin_documents(offset: int = Query(0, ge=0), limit: int = Query(50, ge=1, le=100), admin: User = Depends(require_admin), db: Session = Depends(get_db)):
    rows = db.execute(select(Document, User.email).join(User, Document.owner_id == User.id).order_by(Document.created_at.desc()).offset(offset).limit(limit)).all()
    return [AdminDocumentOut(id=doc.id, original_name=doc.original_name, content_type=doc.content_type, original_size=doc.original_size, ciphertext_size=doc.ciphertext_size, owner_email=email, created_at=doc.created_at) for doc,email in rows]

@app.delete("/api/v1/admin/documents/{document_id}", response_model=MessageOut)
def admin_delete_document(document_id: int, request: Request, admin: User = Depends(require_admin), db: Session = Depends(get_db)):
    doc = db.get(Document, document_id)
    if not doc: raise HTTPException(404, "Không tìm thấy tài liệu")
    path = Path(settings.storage_path) / doc.storage_key
    audit(db,admin.id,"admin_document_deleted",doc.original_name,doc.id,request)
    db.delete(doc); db.commit(); path.unlink(missing_ok=True)
    return {"message":"Đã xóa tài liệu"}

@app.get("/api/v1/admin/activity", response_model=list[AdminAuditOut])
def admin_activity(offset: int = Query(0, ge=0), limit: int = Query(100, ge=1, le=200), admin: User = Depends(require_admin), db: Session = Depends(get_db)):
    rows = db.execute(select(AuditLog, User.email, Document.original_name).outerjoin(User, AuditLog.user_id == User.id).outerjoin(Document, AuditLog.document_id == Document.id).order_by(AuditLog.created_at.desc()).offset(offset).limit(limit)).all()
    return [AdminAuditOut(id=event.id, action=event.action, details=event.details, created_at=event.created_at, actor_email=email, document_name=name) for event,email,name in rows]

@app.get("/api/v1/users/public-key")
def recipient_public_key(email: str, user: User = Depends(current_user), db: Session = Depends(get_db)):
    recipient=db.scalar(select(User).where(User.email==email.lower()))
    if not recipient: raise HTTPException(404,"Không tìm thấy tài khoản")
    return {"email":recipient.email,"public_key":recipient.public_key,"display_name":recipient.display_name}

@app.post("/api/v1/documents", response_model=DocumentOut, status_code=201)
async def upload_document(request: Request, file: UploadFile = File(...), original_name: str = Form(...), content_type: str = Form("application/octet-stream"), original_size: int = Form(...), cipher_nonce: str = Form(...), checksum_sha256: str = Form(...), wrapped_key: str = Form(...), user: User = Depends(current_user), db: Session = Depends(get_db)):
    name = Path(original_name.replace('\\','/')).name
    if not name or len(name) > 255: raise HTTPException(422,"Tên tệp không hợp lệ")
    if original_size < 0: raise HTTPException(422,"Kích thước không hợp lệ")
    storage_key = secrets.token_hex(24); target = Path(settings.storage_path) / storage_key
    h = hashlib.sha256(); size = 0
    try:
        with target.open('wb') as out:
            while chunk := await file.read(1024 * 1024):
                size += len(chunk)
                if size > settings.max_upload_bytes: raise HTTPException(413,"Tệp vượt quá giới hạn 100 MB")
                h.update(chunk); out.write(chunk)
        if size != original_size + 16: raise HTTPException(422,"Kích thước bản mã không khớp kích thước tài liệu")
        if h.hexdigest() != checksum_sha256: raise HTTPException(422,"Checksum của bản mã không khớp")
        doc = Document(owner_id=user.id, original_name=name, content_type=content_type[:255], original_size=original_size, ciphertext_size=size, storage_key=storage_key, cipher_nonce=cipher_nonce, checksum_sha256=checksum_sha256)
        db.add(doc); db.flush(); db.add(DocumentGrant(document_id=doc.id,user_id=user.id,granted_by_id=user.id,wrapped_key=wrapped_key)); audit(db,user.id,"document_uploaded",name,doc.id,request); db.commit(); db.refresh(doc)
        doc.owner=user; doc.grants[0].user=user
        return document_out(doc,doc.grants[0])
    except Exception:
        db.rollback()
        target.unlink(missing_ok=True)
        raise
    finally: await file.close()

@app.get("/api/v1/documents", response_model=list[DocumentOut])
def list_documents(user: User = Depends(current_user), db: Session = Depends(get_db)):
    grants = db.execute(select(DocumentGrant).options(joinedload(DocumentGrant.document).joinedload(Document.owner),joinedload(DocumentGrant.document).joinedload(Document.grants).joinedload(DocumentGrant.user)).where(DocumentGrant.user_id == user.id).order_by(DocumentGrant.created_at.desc())).unique().scalars().all()
    return [document_out(g.document,g) for g in grants]

@app.get("/api/v1/documents/{document_id}/content")
def download_document(document_id: int, request: Request, user: User = Depends(current_user), db: Session = Depends(get_db)):
    doc, _ = get_document_for_user(db,document_id,user.id); path=Path(settings.storage_path)/doc.storage_key
    if not path.is_file(): raise HTTPException(410,"Bản mã không còn trong kho")
    audit(db,user.id,"ciphertext_downloaded",doc.original_name,doc.id,request); db.commit()
    return FileResponse(path,media_type="application/octet-stream",filename=f"{doc.id}.vaultcipher",headers={"Cache-Control":"no-store"})

@app.post("/api/v1/documents/{document_id}/verify")
def verify_document(document_id: int, request: Request, user: User = Depends(current_user), db: Session = Depends(get_db)):
    doc,_=get_document_for_user(db,document_id,user.id); path=Path(settings.storage_path)/doc.storage_key
    if not path.is_file(): raise HTTPException(410,"Bản mã không còn trong kho")
    h=hashlib.sha256()
    with path.open('rb') as f:
        for chunk in iter(lambda:f.read(1024*1024),b''): h.update(chunk)
    ok=h.hexdigest()==doc.checksum_sha256
    audit(db,user.id,"storage_verified" if ok else "storage_integrity_failed",doc.original_name,doc.id,request); db.commit()
    return {"document_id":doc.id,"checksum_valid":ok,"expected_sha256":doc.checksum_sha256,"actual_sha256":h.hexdigest(),"ciphertext_size":path.stat().st_size}

@app.post("/api/v1/documents/{document_id}/shares", response_model=DocumentOut, status_code=201)
def share_document(document_id: int, payload: ShareIn, request: Request, user: User = Depends(current_user), db: Session = Depends(get_db)):
    doc,grant=get_document_for_user(db,document_id,user.id)
    if doc.owner_id != user.id: raise HTTPException(403,"Chỉ chủ sở hữu có thể chia sẻ tài liệu")
    recipient=db.scalar(select(User).where(User.email==str(payload.email).lower()))
    if not recipient: raise HTTPException(404,"Không tìm thấy tài khoản người nhận")
    if recipient.id==user.id: raise HTTPException(422,"Không thể chia sẻ cho chính bạn")
    existing=db.scalar(select(DocumentGrant).where(DocumentGrant.document_id==doc.id,DocumentGrant.user_id==recipient.id))
    if existing: raise HTTPException(409,"Tài liệu đã được chia sẻ với tài khoản này")
    db.add(DocumentGrant(document_id=doc.id,user_id=recipient.id,granted_by_id=user.id,wrapped_key=payload.wrapped_key)); audit(db,user.id,"document_shared",recipient.email,doc.id,request); db.commit()
    doc=db.execute(select(Document).options(joinedload(Document.owner),joinedload(Document.grants).joinedload(DocumentGrant.user)).where(Document.id==doc.id)).unique().scalar_one();return document_out(doc,grant)

@app.delete("/api/v1/documents/{document_id}", response_model=MessageOut)
def delete_document(document_id: int, request: Request, user: User = Depends(current_user), db: Session = Depends(get_db)):
    doc,_=get_document_for_user(db,document_id,user.id)
    if doc.owner_id!=user.id: raise HTTPException(403,"Chỉ chủ sở hữu có thể xóa tài liệu")
    path=Path(settings.storage_path)/doc.storage_key; name=doc.original_name
    audit(db,user.id,"document_deleted",name,doc.id,request);db.delete(doc);db.commit();path.unlink(missing_ok=True)
    return {"message":"Đã xóa tài liệu"}

@app.get("/api/v1/stats", response_model=StatsOut)
def stats(user: User = Depends(current_user), db: Session = Depends(get_db)):
    owned=db.scalars(select(Document).where(Document.owner_id==user.id)).all()
    shared=sum(1 for d in owned if len(d.grants)>1)
    received=db.scalar(select(func.count()).select_from(DocumentGrant).where(DocumentGrant.user_id==user.id,DocumentGrant.document_id.not_in(select(Document.id).where(Document.owner_id==user.id)))) or 0
    return StatsOut(document_count=len(owned),storage_bytes=sum(d.original_size for d in owned),shared_count=shared,recipient_count=received)

@app.get("/api/v1/activity", response_model=list[AuditOut])
def activity(user: User = Depends(current_user), db: Session = Depends(get_db)):
    rows=db.scalars(select(AuditLog).where(AuditLog.user_id==user.id).order_by(AuditLog.created_at.desc()).limit(100)).all()
    docs={d.id:d.original_name for d in db.scalars(select(Document).where(Document.id.in_([x.document_id for x in rows if x.document_id]))).all()}
    return [AuditOut(id=x.id,action=x.action,details=x.details,created_at=x.created_at,document_name=docs.get(x.document_id)) for x in rows]
