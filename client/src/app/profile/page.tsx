"use client";

import { FormEvent, useEffect, useState } from "react";
import Link from "next/link";
import { api, User } from "@/lib/api";

export default function ProfilePage() {
  const [token, setToken] = useState("");
  const [user, setUser] = useState<User | null>(null);
  const [displayName, setDisplayName] = useState("");
  const [bootstrapToken, setBootstrapToken] = useState("");
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const savedToken = localStorage.getItem("vaultshare_token") || "";
    setToken(savedToken);
    if (savedToken)
      api
        .me(savedToken)
        .then((profile) => {
          setUser(profile);
          setDisplayName(profile.display_name);
        })
        .catch((failure) => setError((failure as Error).message));
  }, []);

  async function updateProfile(event: FormEvent) {
    event.preventDefault();
    if (!token) return;
    setBusy(true);
    setError("");
    setMessage("");
    try {
      const updated = await api.updateProfile(token, displayName);
      setUser(updated);
      setDisplayName(updated.display_name);
      setMessage("Đã cập nhật thông tin.");
    } catch (failure) {
      setError((failure as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function becomeAdmin(event: FormEvent) {
    event.preventDefault();
    if (!token) return;
    setBusy(true);
    setError("");
    setMessage("");
    try {
      const updated = await api.bootstrapAdmin(token, bootstrapToken);
      setUser((current) =>
        current ? { ...current, is_admin: updated.is_admin } : current,
      );
      setBootstrapToken("");
      setMessage("Đã khởi tạo quyền quản trị cho tài khoản này.");
    } catch (failure) {
      setError((failure as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="subpage">
      <header className="subpage-header">
        <Link className="brand" href="/">
          <b>V</b> vault<span>share</span>
        </Link>
        <nav>
          <Link href="/">Kho tài liệu</Link>
          <Link className="current" href="/profile">
            Thông tin người dùng
          </Link>
          {user?.is_admin && <Link href="/admin">Quản trị</Link>}
        </nav>
      </header>
      <div className="subpage-content">
        <div className="heading">
          <div>
            <small className="eyebrow">TÀI KHOẢN</small>
            <h1>Thông tin người dùng</h1>
            <p>Cập nhật thông tin hồ sơ và quyền truy cập.</p>
          </div>
        </div>
        {!token && (
          <section className="profile-panel">
            <p>Bạn cần đăng nhập để xem thông tin tài khoản.</p>
            <Link className="primary" href="/login">
              Đăng nhập
            </Link>
          </section>
        )}
        {error && <div className="error-box">{error}</div>}
        {message && <div className="success-box">{message}</div>}
        {user && (
          <>
            <section className="profile-panel">
              <form onSubmit={updateProfile}>
                <label>
                  Email
                  <input value={user.email} readOnly />
                </label>
                <label>
                  Tên hiển thị
                  <input
                    value={displayName}
                    onChange={(event) => setDisplayName(event.target.value)}
                    required
                    maxLength={120}
                  />
                </label>
                <div className="profile-row">
                  <span>Vai trò</span>
                  <b>{user.is_admin ? "Quản trị viên" : "Người dùng"}</b>
                </div>
                <div className="profile-row">
                  <span>Ngày tham gia</span>
                  <b>
                    {new Intl.DateTimeFormat("vi-VN", {
                      dateStyle: "long",
                    }).format(new Date(user.created_at))}
                  </b>
                </div>
                <button className="primary" disabled={busy}>
                  Lưu thay đổi
                </button>
              </form>
            </section>
            {!user.is_admin && (
              <section className="profile-panel bootstrap-panel">
                <small className="eyebrow">THIẾT LẬP QUẢN TRỊ</small>
                <h2>Khởi tạo quản trị viên đầu tiên</h2>
                <p>
                  Chỉ khả dụng khi server đã cấu hình token bootstrap và chưa có
                  quản trị viên.
                </p>
                <form onSubmit={becomeAdmin}>
                  <label>
                    Bootstrap token
                    <input
                      type="password"
                      value={bootstrapToken}
                      onChange={(event) =>
                        setBootstrapToken(event.target.value)
                      }
                      required
                      autoComplete="off"
                    />
                  </label>
                  <button className="outline" disabled={busy}>
                    Xác nhận quyền quản trị
                  </button>
                </form>
              </section>
            )}
          </>
        )}
      </div>
    </main>
  );
}
