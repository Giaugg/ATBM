const API = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000/api/v1";
export type User = {
	id: number;
	email: string;
	display_name: string;
	public_key: string;
	encrypted_private_key: string;
	private_key_iv: string;
	kdf_salt: string;
	is_admin: boolean;
	created_at: string;
};
export type AdminUser = {
	id: number;
	email: string;
	display_name: string;
	is_active: boolean;
	is_admin: boolean;
	created_at: string;
};
export type AdminDocument = {
	id: number;
	original_name: string;
	content_type: string;
	original_size: number;
	ciphertext_size: number;
	owner_email: string;
	created_at: string;
};
export type AdminEvent = {
	id: number;
	action: string;
	details: string | null;
	created_at: string;
	actor_email: string | null;
	document_name: string | null;
};
export type Grant = { email: string; display_name: string; created_at: string };
export type Doc = {
	id: number;
	original_name: string;
	content_type: string;
	original_size: number;
	ciphertext_size: number;
	cipher_nonce: string;
	checksum_sha256: string;
	owner_email: string;
	created_at: string;
	wrapped_key: string;
	grants: Grant[];
};
async function call<T>(
	path: string,
	token?: string,
	init: RequestInit = {},
): Promise<T> {
	const headers = new Headers(init.headers);
	if (token) headers.set("Authorization", `Bearer ${token}`);
	if (
		init.body &&
		!(init.body instanceof FormData) &&
		typeof init.body === "string"
	)
		headers.set("Content-Type", "application/json");
	const response = await fetch(`${API}${path}`, {
		...init,
		headers,
		cache: "no-store",
	});
	if (!response.ok) {
		let detail = `API error ${response.status}`;
		try {
			const body = await response.json();
			detail = Array.isArray(body.detail)
				? body.detail
						.map(
							(issue: { loc?: unknown[]; msg?: string }) =>
								`${issue.loc?.slice(1).join(".") || "Request"}: ${issue.msg || "Invalid value"}`,
						)
						.join("; ")
				: body.detail || detail;
		} catch {}
		throw new Error(detail);
	}
	return response.json();
}
export const api = {
	register: (data: unknown) =>
		call<{ access_token: string; user: User }>("/auth/register", undefined, {
			method: "POST",
			body: JSON.stringify(data),
		}),
	login: (data: unknown) =>
		call<{ access_token: string; user: User }>("/auth/login", undefined, {
			method: "POST",
			body: JSON.stringify(data),
		}),
	me: (token: string) => call<User>("/auth/me", token),
	updateProfile: (token: string, display_name: string) =>
		call<User>("/auth/me", token, {
			method: "PATCH",
			body: JSON.stringify({ display_name }),
		}),
	bootstrapAdmin: (token: string, bootstrap_token: string) =>
		call<User>("/admin/bootstrap", token, {
			method: "POST",
			body: JSON.stringify({ bootstrap_token }),
		}),
	adminOverview: (token: string) =>
		call<{
			total_users: number;
			active_users: number;
			total_documents: number;
			storage_bytes: number;
			total_events: number;
		}>("/admin/overview", token),
	adminUsers: (token: string) => call<AdminUser[]>("/admin/users", token),
	setUserActive: (token: string, id: number, is_active: boolean) =>
		call<AdminUser>(`/admin/users/${id}/active`, token, {
			method: "PATCH",
			body: JSON.stringify({ is_active }),
		}),
	deleteAdminUser: (token: string, id: number) =>
		call<{ message: string }>(`/admin/users/${id}`, token, {
			method: "DELETE",
		}),
	adminDocuments: (token: string) =>
		call<AdminDocument[]>("/admin/documents", token),
	deleteAdminDocument: (token: string, id: number) =>
		call<{ message: string }>(`/admin/documents/${id}`, token, {
			method: "DELETE",
		}),
	adminActivity: (token: string) =>
		call<AdminEvent[]>("/admin/activity", token),
	docs: (token: string) => call<Doc[]>("/documents", token),
	stats: (token: string) =>
		call<{
			document_count: number;
			storage_bytes: number;
			shared_count: number;
			recipient_count: number;
		}>("/stats", token),
	activity: (token: string) =>
		call<
			{
				id: number;
				action: string;
				details: string | null;
				created_at: string;
				document_name: string | null;
			}[]
		>("/activity", token),
	recipient: (token: string, email: string) =>
		call<{ email: string; public_key: string; display_name: string }>(
			`/users/public-key?email=${encodeURIComponent(email)}`,
			token,
		),
	upload: (
		token: string,
		file: File,
		ciphertext: ArrayBuffer,
		nonce: string,
		checksum: string,
		wrappedKey: string,
	) => {
		const form = new FormData();
		form.append("file", new Blob([ciphertext]), "encrypted.bin");
		form.append("original_name", file.name);
		form.append("content_type", file.type || "application/octet-stream");
		form.append("original_size", String(file.size));
		form.append("cipher_nonce", nonce);
		form.append("checksum_sha256", checksum);
		form.append("wrapped_key", wrappedKey);
		return call<Doc>("/documents", token, { method: "POST", body: form });
	},
	content: (token: string, id: number) =>
		fetch(`${API}/documents/${id}/content`, {
			headers: { Authorization: `Bearer ${token}` },
			cache: "no-store",
		}).then(async (r) => {
			if (!r.ok)
				throw new Error((await r.json()).detail || "Không tải được bản mã");
			return r.arrayBuffer();
		}),
	verify: (token: string, id: number) =>
		call<{
			checksum_valid: boolean;
			expected_sha256: string;
			actual_sha256: string;
			ciphertext_size: number;
		}>(`/documents/${id}/verify`, token, { method: "POST" }),
	share: (token: string, id: number, email: string, wrapped_key: string) =>
		call<Doc>(`/documents/${id}/shares`, token, {
			method: "POST",
			body: JSON.stringify({ email, wrapped_key }),
		}),
	remove: (token: string, id: number) =>
		call<{ message: string }>(`/documents/${id}`, token, { method: "DELETE" }),
};
