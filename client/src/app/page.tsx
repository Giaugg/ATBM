"use client";
import { ChangeEvent, FormEvent, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import "./demo.css";
import { api, Doc, User } from "@/lib/api";
import {
	checksum,
	decryptFile,
	encryptFile,
	makeKeyBundle,
	rewrapForRecipient,
	unlockPrivateKey,
} from "@/lib/crypto";
import { clearSession, getActivePrivateKey, saveSession } from "@/lib/session";

type EventRow = {
	id: number;
	action: string;
	details: string | null;
	created_at: string;
	document_name: string | null;
};
const fmt = (n: number) => {
	if (!n) return "0 B";
	const u = ["B", "KB", "MB", "GB"];
	let i = 0;
	while (n >= 1024 && i < 3) {
		n /= 1024;
		i++;
	}
	return `${n.toFixed(i ? 1 : 0)} ${u[i]}`;
};
const date = (s: string) =>
	new Intl.DateTimeFormat("vi-VN", { dateStyle: "medium" }).format(new Date(s));
const glyph = (name: string) =>
	({
		pdf: "▧",
		doc: "▤",
		docx: "▤",
		txt: "≡",
		png: "▧",
		jpg: "▧",
		jpeg: "▧",
		csv: "▦",
		xlsx: "▦",
		zip: "▣",
	})[name.split(".").pop()?.toLowerCase() || ""] || "▤";
const actionName = (a: string) =>
	({
		account_created: "Tạo tài khoản",
		login: "Đăng nhập",
		login_failed: "Đăng nhập thất bại",
		document_uploaded: "Tải lên và mã hóa",
		storage_verified: "Kiểm tra toàn vẹn",
		storage_integrity_failed: "Phát hiện sai checksum",
		ciphertext_downloaded: "Tải bản mã",
		document_shared: "Chia sẻ tài liệu",
		document_deleted: "Xóa tài liệu",
	})[a] || a;
const demoAccounts = [
	{
		label: "Demo Owner",
		email: "demo.owner@example.com",
		password: "VaultOwner2026!",
		role: "Tài khoản chủ sở hữu",
	},
	{
		label: "Demo Guest",
		email: "demo.guest@example.com",
		password: "VaultGuest2026!",
		role: "Tài khoản người nhận",
	},
];

export default function Home() {
	const router = useRouter();
	const [token, setToken] = useState(""),
		[user, setUser] = useState<User | null>(null),
		[privateKey, setPrivateKey] = useState<CryptoKey | null>(null),
		[authMode, setAuthMode] = useState<"login" | "register">("login");
	const [sessionReady, setSessionReady] = useState(false);
	const [docs, setDocs] = useState<Doc[]>([]),
		[stats, setStats] = useState({
			document_count: 0,
			storage_bytes: 0,
			shared_count: 0,
			recipient_count: 0,
		}),
		[events, setEvents] = useState<EventRow[]>([]);
	const [page, setPage] = useState<"files" | "shared" | "activity">("files"),
		[query, setQuery] = useState(""),
		[sort, setSort] = useState("newest"),
		[busy, setBusy] = useState(false),
		[toast, setToast] = useState(""),
		[error, setError] = useState(""),
		[verify, setVerify] = useState<{
			ok: boolean;
			name: string;
			message: string;
		} | null>(null);
	const [email, setEmail] = useState(""),
		[password, setPassword] = useState(""),
		[displayName, setDisplayName] = useState("");
	const [shareDoc, setShareDoc] = useState<Doc | null>(null),
		[shareEmail, setShareEmail] = useState("");
	useEffect(() => {
		const saved = localStorage.getItem("vaultshare_token");
		const key = getActivePrivateKey();
		if (!saved || !key) {
			if (saved) clearSession();
			setSessionReady(true);
			return;
		}
		setToken(saved);
		setPrivateKey(key);
		api
			.me(saved)
			.then(setUser)
			.catch(() => {
				clearSession();
				setToken("");
			})
			.finally(() => setSessionReady(true));
	}, []);
	useEffect(() => {
		if (sessionReady && (!token || !user)) router.replace("/login");
	}, [sessionReady, token, user, router]);
	const received = docs.filter((d) => d.owner_email !== user?.email),
		owned = docs.filter((d) => d.owner_email === user?.email);
	const visible = useMemo(
		() =>
			owned
				.filter((d) =>
					d.original_name.toLowerCase().includes(query.toLowerCase()),
				)
				.sort((a, b) =>
					sort === "oldest"
						? +new Date(a.created_at) - +new Date(b.created_at)
						: sort === "name"
							? a.original_name.localeCompare(b.original_name)
							: sort === "size"
								? b.original_size - a.original_size
								: +new Date(b.created_at) - +new Date(a.created_at),
				),
		[owned, query, sort],
	);
	function notice(s: string) {
		setToast(s);
		setTimeout(() => setToast(""), 3500);
	}
	async function reload(t = token) {
		if (!t) return;
		const [d, s, a] = await Promise.all([
			api.docs(t),
			api.stats(t),
			api.activity(t),
		]);
		setDocs(d);
		setStats(s);
		setEvents(a);
	}
	useEffect(() => {
		if (token) reload().catch((e) => setError(e.message));
	}, [token]);
	async function submitAuth(e: FormEvent) {
		e.preventDefault();
		setError("");
		setBusy(true);
		try {
			if (authMode === "register") {
				if (password.length < 10)
					throw new Error("Mật khẩu cần ít nhất 10 ký tự.");
				const keys = await makeKeyBundle(password);
				const result = await api.register({
					email,
					password,
					display_name: displayName || email.split("@")[0],
					...keys,
				});
				const unlocked = await unlockPrivateKey({ ...keys }, password);
				saveSession(result.access_token, unlocked);
				setUser(result.user);
				setToken(result.access_token);
				setPrivateKey(unlocked);
			} else {
				const result = await api.login({ email, password });
				const unlocked = await unlockPrivateKey(result.user, password);
				saveSession(result.access_token, unlocked);
				setUser(result.user);
				setToken(result.access_token);
				setPrivateKey(unlocked);
			}
			setPassword("");
		} catch (e) {
			setError((e as Error).message);
		} finally {
			setBusy(false);
		}
	}
	async function onUpload(e: ChangeEvent<HTMLInputElement>) {
		const files = [...(e.target.files || [])];
		e.target.value = "";
		if (!files.length || !user || !token) return;
		setBusy(true);
		try {
			for (const f of files) {
				if (f.size > 100 * 1024 * 1024)
					throw new Error(`${f.name} vượt giới hạn 100 MB`);
				const encrypted = await encryptFile(f, user.public_key);
				await api.upload(
					token,
					f,
					encrypted.ciphertext,
					encrypted.nonce,
					encrypted.checksum,
					encrypted.wrapped_key,
				);
			}
			await reload();
			notice("Tài liệu đã mã hóa và lưu trên máy chủ.");
		} catch (e) {
			setError((e as Error).message);
		} finally {
			setBusy(false);
		}
	}
	async function verifyDoc(d: Doc) {
		setBusy(true);
		try {
			const server = await api.verify(token, d.id);
			const content = await api.content(token, d.id);
			const clientOk = (await checksum(content)) === d.checksum_sha256;
			let gcmOk = false;
			try {
				if (privateKey)
					await decryptFile(
						content,
						d.cipher_nonce,
						d.wrapped_key,
						privateKey,
					).then(() => (gcmOk = true));
			} catch {}
			const ok = server.checksum_valid && clientOk && gcmOk;
			setVerify({
				ok,
				name: d.original_name,
				message: ok
					? "Checksum máy chủ và trình duyệt khớp; AES-GCM xác thực thành công."
					: "Checksum hoặc thẻ xác thực không hợp lệ.",
			});
			await reload();
		} catch (e) {
			setError((e as Error).message);
		} finally {
			setBusy(false);
		}
	}
	async function download(d: Doc) {
		setBusy(true);
		try {
			const cipher = await api.content(token, d.id);
			if ((await checksum(cipher)) !== d.checksum_sha256)
				throw new Error("Checksum không khớp — tệp có thể đã bị thay đổi.");
			if (!privateKey)
				throw new Error("Hãy đăng nhập lại để mở khóa riêng tư.");
			const data = await decryptFile(
				cipher,
				d.cipher_nonce,
				d.wrapped_key,
				privateKey,
			);
			const a = document.createElement("a");
			a.href = URL.createObjectURL(new Blob([data], { type: d.content_type }));
			a.download = d.original_name;
			a.click();
			setTimeout(() => URL.revokeObjectURL(a.href), 4000);
			notice("Tệp đã được xác thực và giải mã.");
		} catch (e) {
			setError((e as Error).message);
		} finally {
			setBusy(false);
		}
	}
	async function share(e: FormEvent) {
		e.preventDefault();
		if (!shareDoc) return;
		setBusy(true);
		try {
			const recipient = await api.recipient(token, shareEmail);
			if (!privateKey)
				throw new Error("Phiên khóa riêng tư đã hết. Hãy đăng nhập lại.");
			const wrapped = await rewrapForRecipient(
				shareDoc.wrapped_key,
				privateKey,
				recipient.public_key,
			);
			await api.share(token, shareDoc.id, shareEmail, wrapped);
			setShareDoc(null);
			setShareEmail("");
			await reload();
			notice("Đã chia sẻ khóa tài liệu bằng RSA-OAEP.");
		} catch (e) {
			setError((e as Error).message);
		} finally {
			setBusy(false);
		}
	}
	async function remove(d: Doc) {
		if (!confirm(`Xóa “${d.original_name}” khỏi kho?`)) return;
		try {
			await api.remove(token, d.id);
			await reload();
			notice("Đã xóa tài liệu.");
		} catch (e) {
			setError((e as Error).message);
		}
	}
	function signOut() {
		clearSession();
		setToken("");
		setUser(null);
		setPrivateKey(null);
		setDocs([]);
		setStats({
			document_count: 0,
			storage_bytes: 0,
			shared_count: 0,
			recipient_count: 0,
		});
	}
	if (!sessionReady || !token || !user) return null;

	if (!token || !user)
		return (
			<main className="auth">
				<section className="auth-side">
					<a className="brand" href="#">
						<b>V</b> vault<span>share</span>
					</a>
					<div className="auth-copy">
						<small>✦ &nbsp; PRIVATE BY DESIGN</small>
						<h1>
							Tài liệu của bạn.
							<br />
							<em>Quyền kiểm soát của bạn.</em>
						</h1>
						<p>
							Mã hóa trên thiết bị. Chia sẻ có kiểm soát. Kiểm tra toàn vẹn bất
							cứ lúc nào.
						</p>
						<div className="cipher-card">
							<div>
								<span>⌑</span> END-TO-END ENCRYPTED <i />
							</div>
							<hr />
							<b>AES-256-GCM</b>
							<b>RSA-OAEP</b>
						</div>
					</div>
					<footer>AN TOÀN TỪ THIẾT KẾ</footer>
				</section>
				<section className="auth-main">
					<div className="auth-box">
						<small className="eyebrow">KHO TÀI LIỆU CÁ NHÂN</small>
						<h2>
							{authMode === "login"
								? "Chào mừng trở lại"
								: "Tạo không gian an toàn"}
						</h2>
						<p>
							{authMode === "login"
								? "Đăng nhập để tiếp tục vào không gian của bạn."
								: "Tạo tài khoản để bắt đầu lưu trữ tài liệu."}
						</p>
						<div className="tabs">
							<button
								className={authMode === "login" ? "selected" : ""}
								onClick={() => {
									setAuthMode("login");
									setError("");
								}}
							>
								Đăng nhập
							</button>
							<button
								className={authMode === "register" ? "selected" : ""}
								onClick={() => {
									setAuthMode("register");
									setError("");
								}}
							>
								Tạo tài khoản
							</button>
						</div>
						<form onSubmit={submitAuth}>
							{authMode === "register" && (
								<label>
									Tên hiển thị
									<input
										value={displayName}
										onChange={(e) => setDisplayName(e.target.value)}
										placeholder="Nguyễn Văn An"
										required
									/>
								</label>
							)}
							<label>
								Email
								<input
									value={email}
									type="email"
									onChange={(e) => setEmail(e.target.value)}
									placeholder="ten@email.com"
									required
								/>
							</label>
							<label>
								Mật khẩu
								<input
									value={password}
									type="password"
									minLength={authMode === "register" ? 10 : 1}
									onChange={(e) => setPassword(e.target.value)}
									placeholder={
										authMode === "register"
											? "Tối thiểu 10 ký tự"
											: "Nhập mật khẩu"
									}
									required
								/>
							</label>
							<button className="primary full" disabled={busy}>
								{busy
									? "Đang xử lý…"
									: authMode === "login"
										? "Đăng nhập"
										: "Tạo tài khoản"}{" "}
								<span>→</span>
							</button>
						</form>
						{authMode === "login" && (
							<div className="demo-accounts">
								<div>
									<b>Tài khoản mẫu</b>
									<span>Chọn một tài khoản để điền thông tin đăng nhập.</span>
								</div>
								<section>
									{demoAccounts.map((account) => (
										<button
											type="button"
											key={account.email}
											onClick={() => {
												setEmail(account.email);
												setPassword(account.password);
												setError("");
											}}
										>
											<strong>{account.label}</strong>
											<small>{account.role}</small>
											<em>Điền thông tin →</em>
										</button>
									))}
								</section>
							</div>
						)}
						{error && <div className="error-box">{error}</div>}
						<div className="privacy">
							⌑ &nbsp; Khóa riêng được mã hóa bằng mật khẩu của bạn.
						</div>
					</div>
					<small className="auth-legal">
						MVP — dữ liệu được lưu trên máy chủ của bạn.
					</small>
				</section>
			</main>
		);

	return (
		<div className="shell">
			<aside className="sidebar">
				<a className="brand" href="#">
					<b>V</b> vault<span>share</span>
				</a>
				<div className="workspace">
					<span>⌂</span>
					<div>
						<b>Không gian cá nhân</b>
						<small>Kho lưu trữ</small>
					</div>
					<i>⌄</i>
				</div>
				<small className="side-cap">KHÔNG GIAN LÀM VIỆC</small>
				<nav>
					<button
						className={page === "files" ? "on" : ""}
						onClick={() => setPage("files")}
					>
						▤ <span>Tất cả tài liệu</span>
						<i>{owned.length}</i>
					</button>
					<button
						className={page === "shared" ? "on" : ""}
						onClick={() => setPage("shared")}
					>
						♧ <span>Đã chia sẻ</span>
					</button>
					<button
						className={page === "activity" ? "on" : ""}
						onClick={() => setPage("activity")}
					>
						◷ <span>Hoạt động</span>
					</button>
				</nav>
				<small className="side-cap security-cap">BẢO MẬT</small>
				<div className="security">
					<b>✳ &nbsp; Mã hóa đang bật</b>
					<p>Tài liệu được bảo vệ bằng AES-256-GCM.</p>
					<small>● &nbsp; Khóa riêng trên thiết bị</small>
				</div>
				<div className="storage">
					<div>
						<span>Dung lượng sử dụng</span>
						<b>{fmt(stats.storage_bytes)}</b>
					</div>
					<div className="meter">
						<i
							style={{
								width: `${Math.min(100, (stats.storage_bytes / (500 * 1024 * 1024)) * 100)}%`,
							}}
						/>
					</div>
					<small>
						{((stats.storage_bytes / (500 * 1024 * 1024)) * 100).toFixed(1)}%
						trong 500 MB
					</small>
				</div>
				<div className="user">
					<div className="avatar">
						{(user.display_name || user.email)[0].toUpperCase()}
					</div>
					<div>
						<b>{user.display_name}</b>
						<small>{user.email}</small>
					</div>
					<button onClick={signOut} title="Đăng xuất">
						↪
					</button>
				</div>
			</aside>
			<main className="main">
				<header className="topbar">
					<div>
						Không gian cá nhân <span>/</span>{" "}
						<b>
							{page === "files"
								? "Tất cả tài liệu"
								: page === "shared"
									? "Đã chia sẻ"
									: "Hoạt động"}
						</b>
					</div>
					<button
						className="help"
						onClick={() =>
							alert(
								"Bản mã tệp lưu trên máy chủ. AES-GCM và RSA-OAEP chạy trong trình duyệt. Khóa riêng chỉ được gửi lên ở dạng đã mã hóa bằng mật khẩu.",
							)
						}
					>
						?
					</button>
				</header>
				<div className="content">
					{toast && <div className="toast">{toast}</div>}
					{error && (
						<div className="error-box inline">
							<span>{error}</span>
							<button onClick={() => setError("")}>×</button>
						</div>
					)}
					{page === "files" && (
						<>
							<div className="heading">
								<div>
									<small className="eyebrow">THƯ VIỆN CỦA BẠN</small>
									<h1>Tất cả tài liệu</h1>
									<p>Tệp được mã hóa trước khi gửi lên máy chủ.</p>
								</div>
								<label className="primary upload">
									＋ Tải tài liệu lên
									<input
										type="file"
										multiple
										onChange={onUpload}
										disabled={busy}
									/>
								</label>
							</div>
							<div className="stats">
								<article>
									<span>Tổng tài liệu</span>
									<b>{stats.document_count}</b>
									<small>Trong kho của bạn</small>
									<i className="stat-ico">▤</i>
								</article>
								<article>
									<span>Dung lượng đã dùng</span>
									<b>{fmt(stats.storage_bytes)}</b>
									<small>trên 500 MB</small>
									<i className="stat-ico blue">◫</i>
								</article>
								<article>
									<span>Đã chia sẻ</span>
									<b>{stats.shared_count}</b>
									<small>Tài liệu đang chia sẻ</small>
									<i className="stat-ico green">♧</i>
								</article>
								<article>
									<span>Nhận chia sẻ</span>
									<b>{stats.recipient_count}</b>
									<small>Tài liệu được cấp quyền</small>
									<i className="stat-ico amber">✓</i>
								</article>
							</div>
							<section className="table-card">
								<div className="toolbar">
									<b>
										Tài liệu gần đây <i>{visible.length}</i>
									</b>
									<div>
										<input
											placeholder="⌕  Tìm tài liệu..."
											value={query}
											onChange={(e) => setQuery(e.target.value)}
										/>
										<select
											value={sort}
											onChange={(e) => setSort(e.target.value)}
										>
											<option value="newest">Mới nhất</option>
											<option value="oldest">Cũ nhất</option>
											<option value="name">Tên A–Z</option>
											<option value="size">Dung lượng</option>
										</select>
										<button className="refresh" onClick={() => reload()}>
											↻
										</button>
									</div>
								</div>
								<div className="scroll">
									<table>
										<thead>
											<tr>
												<th>TÊN TÀI LIỆU</th>
												<th>KÍCH THƯỚC</th>
												<th>TRẠNG THÁI</th>
												<th>NGÀY TẠO</th>
												<th />
											</tr>
										</thead>
										<tbody>
											{visible.map((d) => (
												<tr key={d.id}>
													<td>
														<div className="filename">
															<span>{glyph(d.original_name)}</span>
															<div>
																<b>{d.original_name}</b>
																<small>{d.content_type}</small>
															</div>
														</div>
													</td>
													<td>{fmt(d.original_size)}</td>
													<td>
														<label className="pill">
															●{" "}
															{d.grants.length > 1 ? "Đã chia sẻ" : "Đã mã hóa"}
														</label>
													</td>
													<td>{date(d.created_at)}</td>
													<td>
														<details>
															<summary>···</summary>
															<menu>
																<button onClick={() => download(d)}>
																	↓ Tải xuống
																</button>
																<button onClick={() => verifyDoc(d)}>
																	✓ Kiểm tra lưu trữ
																</button>
																<button
																	onClick={() => {
																		setShareDoc(d);
																		setShareEmail("");
																	}}
																>
																	♧ Chia sẻ
																</button>
																<button onClick={() => remove(d)}>
																	× Xóa tài liệu
																</button>
															</menu>
														</details>
													</td>
												</tr>
											))}
										</tbody>
									</table>
									{visible.length === 0 && (
										<div className="empty">
											<div>▤</div>
											<b>
												{query
													? "Không tìm thấy tài liệu"
													: "Kho tài liệu của bạn đang trống"}
											</b>
											<p>
												{query
													? "Thử từ khóa khác."
													: "Tải tài liệu lên để mã hóa và lưu trữ an toàn."}
											</p>
											{!query && (
												<label className="outline">
													＋ Tải tài liệu đầu tiên
													<input type="file" multiple onChange={onUpload} />
												</label>
											)}
										</div>
									)}
								</div>
								<footer>
									<span>
										Hiển thị {visible.length} / {owned.length} tài liệu
									</span>
									<span>⌑ &nbsp; Mã hóa đầu cuối đang bật</span>
								</footer>
							</section>
						</>
					)}
					{page === "shared" && (
						<>
							<div className="heading">
								<div>
									<small className="eyebrow">CHIA SẺ AN TOÀN</small>
									<h1>Đã chia sẻ</h1>
									<p>Tài liệu bạn cấp quyền và nhận từ người khác.</p>
								</div>
							</div>
							<section className="secondary">
								{docs
									.filter(
										(d) => d.grants.length > 1 || d.owner_email !== user.email,
									)
									.map((d) => (
										<div className="secondary-row" key={d.id}>
											<span className="secondary-icon">
												{glyph(d.original_name)}
											</span>
											<div className="secondary-name">
												<b>{d.original_name}</b>
												<small>
													{d.owner_email === user.email
														? "Bạn sở hữu"
														: "Được chia sẻ với bạn"}{" "}
													· {fmt(d.original_size)}
												</small>
											</div>
											<div className="secondary-meta">
												{d.grants.length - 1} người nhận
												<button className="outline" onClick={() => download(d)}>
													Tải xuống
												</button>
											</div>
										</div>
									))}
								{docs.filter(
									(d) => d.grants.length > 1 || d.owner_email !== user.email,
								).length === 0 && (
									<div className="empty">
										<b>Chưa có tài liệu được chia sẻ</b>
										<p>Tài liệu bạn chia sẻ hoặc nhận sẽ xuất hiện tại đây.</p>
									</div>
								)}
							</section>
						</>
					)}
					{page === "activity" && (
						<>
							<div className="heading">
								<div>
									<small className="eyebrow">NHẬT KÝ BẢO MẬT</small>
									<h1>Hoạt động</h1>
									<p>Lịch sử thao tác tài khoản của bạn.</p>
								</div>
							</div>
							<section className="secondary">
								{events.map((e) => (
									<div className="secondary-row" key={e.id}>
										<span className="secondary-icon">◷</span>
										<div className="secondary-name">
											<b>{actionName(e.action)}</b>
											<small>{e.details || e.document_name || ""}</small>
										</div>
										<div className="secondary-meta">
											{new Intl.DateTimeFormat("vi-VN", {
												dateStyle: "short",
												timeStyle: "short",
											}).format(new Date(e.created_at))}
										</div>
									</div>
								))}
								{!events.length && (
									<div className="empty">
										<b>Chưa có hoạt động</b>
										<p>Hoạt động tài khoản sẽ xuất hiện tại đây.</p>
									</div>
								)}
							</section>
						</>
					)}
				</div>
			</main>
			{shareDoc && (
				<div
					className="backdrop"
					onMouseDown={(e) => e.target === e.currentTarget && setShareDoc(null)}
				>
					<section className="modal">
						<button className="close" onClick={() => setShareDoc(null)}>
							×
						</button>
						<small className="eyebrow">CHIA SẺ MÃ HÓA</small>
						<h2>Chia sẻ tài liệu</h2>
						<p>
							Khóa AES của “{shareDoc.original_name}” được bọc bằng khóa RSA của
							người nhận.
						</p>
						<form onSubmit={share}>
							<label>
								Email người nhận
								<input
									type="email"
									required
									value={shareEmail}
									onChange={(e) => setShareEmail(e.target.value)}
									placeholder="nguoi-nhan@email.com"
								/>
							</label>
							<button className="primary full" disabled={busy}>
								Chia sẻ an toàn <span>→</span>
							</button>
						</form>
					</section>
				</div>
			)}
			{verify && (
				<div
					className="backdrop"
					onMouseDown={(e) => e.target === e.currentTarget && setVerify(null)}
				>
					<section className="modal">
						<button className="close" onClick={() => setVerify(null)}>
							×
						</button>
						<div className={verify.ok ? "result-icon" : "result-icon bad"}>
							{verify.ok ? "✓" : "×"}
						</div>
						<small className="eyebrow">KIỂM TRA LƯU TRỮ</small>
						<h2>
							{verify.ok ? "Tài liệu toàn vẹn" : "Không thể xác thực tài liệu"}
						</h2>
						<p>{verify.name}</p>
						<div className="result-line">{verify.message}</div>
						<button className="outline full" onClick={() => setVerify(null)}>
							Đóng
						</button>
					</section>
				</div>
			)}
		</div>
	);
}
