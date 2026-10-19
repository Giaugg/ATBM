"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { AdminDocument, AdminEvent, AdminUser, api } from "@/lib/api";

const formatBytes = (bytes: number) => {
  if (!bytes) return "0 B";
  const units = ["B", "KB", "MB", "GB"];
  let index = 0;
  let value = bytes;
  while (value >= 1024 && index < units.length - 1) {
    value /= 1024;
    index++;
  }
  return `${value.toFixed(index ? 1 : 0)} ${units[index]}`;
};

export default function AdminPage() {
  const [token, setToken] = useState("");
  const [overview, setOverview] = useState<{
    total_users: number;
    active_users: number;
    total_documents: number;
    storage_bytes: number;
    total_events: number;
  } | null>(null);
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [documents, setDocuments] = useState<AdminDocument[]>([]);
  const [events, setEvents] = useState<AdminEvent[]>([]);
  const [error, setError] = useState("");
  const [busyId, setBusyId] = useState<number | null>(null);

  async function load(accessToken: string) {
    setError("");
    try {
      const [stats, accountRows, documentRows, activityRows] =
        await Promise.all([
          api.adminOverview(accessToken),
          api.adminUsers(accessToken),
          api.adminDocuments(accessToken),
          api.adminActivity(accessToken),
        ]);
      setOverview(stats);
      setUsers(accountRows);
      setDocuments(documentRows);
      setEvents(activityRows);
    } catch (failure) {
      setError((failure as Error).message);
    }
  }

  useEffect(() => {
    const savedToken = localStorage.getItem("vaultshare_token") || "";
    setToken(savedToken);
    if (savedToken) load(savedToken);
  }, []);

  async function toggleUser(user: AdminUser) {
    if (!token) return;
    setBusyId(user.id);
    setError("");
    try {
      await api.setUserActive(token, user.id, !user.is_active);
      await load(token);
    } catch (failure) {
      setError((failure as Error).message);
    } finally {
      setBusyId(null);
    }
  }

  async function removeUser(user: AdminUser) {
    if (
      !token ||
      !window.confirm(
        `Xóa tài khoản ${user.email} cùng tài liệu và quyền chia sẻ liên quan?`,
      )
    )
      return;
    setBusyId(user.id);
    setError("");
    try {
      await api.deleteAdminUser(token, user.id);
      await load(token);
    } catch (failure) {
      setError((failure as Error).message);
    } finally {
      setBusyId(null);
    }
  }

  async function removeDocument(document: AdminDocument) {
    if (
      !token ||
      !window.confirm(
        `Xóa vĩnh viễn “${document.original_name}” của ${document.owner_email}?`,
      )
    )
      return;
    setBusyId(document.id);
    setError("");
    try {
      await api.deleteAdminDocument(token, document.id);
      await load(token);
    } catch (failure) {
      setError((failure as Error).message);
    } finally {
      setBusyId(null);
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
          <Link href="/profile">Thông tin người dùng</Link>
          <Link className="current" href="/admin">
            Quản trị
          </Link>
        </nav>
      </header>
      <div className="subpage-content">
        <div className="heading">
          <div>
            <small className="eyebrow">VAULTSHARE / ADMIN</small>
            <h1>Quản lý hệ thống</h1>
            <p>Tài khoản, tài liệu và nhật ký hoạt động.</p>
          </div>
          <button
            className="outline"
            onClick={() => token && load(token)}
            disabled={!token}
          >
            Làm mới
          </button>
        </div>
        {error && (
          <div className="error-box">
            {error}
            {error.includes("quản trị") && (
              <span> Tài khoản hiện tại chưa được cấp quyền.</span>
            )}
          </div>
        )}
        {!token && (
          <section className="profile-panel">
            <p>Bạn cần đăng nhập bằng tài khoản quản trị.</p>
            <Link className="primary" href="/login">
              Đăng nhập
            </Link>
          </section>
        )}
        {overview && (
          <>
            <section className="stats admin-stats">
              <article>
                <span>Tài khoản</span>
                <b>{overview.total_users}</b>
                <small>{overview.active_users} đang hoạt động</small>
              </article>
              <article>
                <span>Tài liệu</span>
                <b>{overview.total_documents}</b>
                <small>Đang lưu trữ</small>
              </article>
              <article>
                <span>Dung lượng</span>
                <b>{formatBytes(overview.storage_bytes)}</b>
                <small>Tổng dữ liệu gốc</small>
              </article>
              <article>
                <span>Sự kiện</span>
                <b>{overview.total_events}</b>
                <small>Trong nhật ký</small>
              </article>
            </section>
            <section className="admin-section">
              <div className="admin-section-title">
                <h2>Tài khoản</h2>
                <span>{users.length} hiển thị</span>
              </div>
              <div className="table-card admin-table">
                <div className="scroll">
                  <table>
                    <thead>
                      <tr>
                        <th>NGƯỜI DÙNG</th>
                        <th>VAI TRÒ</th>
                        <th>TRẠNG THÁI</th>
                        <th>NGÀY TẠO</th>
                        <th />
                      </tr>
                    </thead>
                    <tbody>
                      {users.map((user) => (
                        <tr key={user.id}>
                          <td>
                            <div className="filename">
                              <div>
                                <b>{user.display_name}</b>
                                <small>{user.email}</small>
                              </div>
                            </div>
                          </td>
                          <td>
                            {user.is_admin ? "Quản trị viên" : "Người dùng"}
                          </td>
                          <td>
                            <span
                              className={`pill ${user.is_active ? "" : "inactive"}`}
                            >
                              {user.is_active ? "Hoạt động" : "Đã khóa"}
                            </span>
                          </td>
                          <td>
                            {new Intl.DateTimeFormat("vi-VN", {
                              dateStyle: "medium",
                            }).format(new Date(user.created_at))}
                          </td>
                          <td>
                            {!user.is_admin && (
                              <div className="admin-actions">
                                <button
                                  className="outline small-action"
                                  disabled={busyId === user.id}
                                  onClick={() => toggleUser(user)}
                                >
                                  {user.is_active ? "Khóa" : "Mở khóa"}
                                </button>
                                <button
                                  className="danger-action"
                                  disabled={busyId === user.id}
                                  onClick={() => removeUser(user)}
                                >
                                  Xóa
                                </button>
                              </div>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            </section>
            <section className="admin-section">
              <div className="admin-section-title">
                <h2>Tài liệu</h2>
                <span>{documents.length} gần đây</span>
              </div>
              <div className="table-card admin-table">
                <div className="scroll">
                  <table>
                    <thead>
                      <tr>
                        <th>TÊN TÀI LIỆU</th>
                        <th>CHỦ SỞ HỮU</th>
                        <th>KÍCH THƯỚC</th>
                        <th>NGÀY TẠO</th>
                        <th />
                      </tr>
                    </thead>
                    <tbody>
                      {documents.map((document) => (
                        <tr key={document.id}>
                          <td>
                            <div className="filename">
                              <div>
                                <b>{document.original_name}</b>
                                <small>{document.content_type}</small>
                              </div>
                            </div>
                          </td>
                          <td>{document.owner_email}</td>
                          <td>{formatBytes(document.original_size)}</td>
                          <td>
                            {new Intl.DateTimeFormat("vi-VN", {
                              dateStyle: "medium",
                            }).format(new Date(document.created_at))}
                          </td>
                          <td>
                            <button
                              className="danger-action"
                              disabled={busyId === document.id}
                              onClick={() => removeDocument(document)}
                            >
                              Xóa
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            </section>
            <section className="admin-section">
              <div className="admin-section-title">
                <h2>Nhật ký toàn hệ thống</h2>
                <span>{events.length} gần đây</span>
              </div>
              <div className="table-card admin-table">
                <div className="scroll">
                  <table>
                    <thead>
                      <tr>
                        <th>THỜI GIAN</th>
                        <th>NGƯỜI DÙNG</th>
                        <th>THAO TÁC</th>
                        <th>CHI TIẾT</th>
                      </tr>
                    </thead>
                    <tbody>
                      {events.map((event) => (
                        <tr key={event.id}>
                          <td>
                            {new Intl.DateTimeFormat("vi-VN", {
                              dateStyle: "short",
                              timeStyle: "short",
                            }).format(new Date(event.created_at))}
                          </td>
                          <td>{event.actor_email || "Đã xóa tài khoản"}</td>
                          <td>{event.action}</td>
                          <td>{event.document_name || event.details || "—"}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            </section>
          </>
        )}
      </div>
    </main>
  );
}
