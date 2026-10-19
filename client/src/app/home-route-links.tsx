"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { api } from "@/lib/api";

export default function HomeRouteLinks() {
  const pathname = usePathname();
  const [isAdmin, setIsAdmin] = useState(false);
  useEffect(() => {
    if (pathname !== "/") return;
    const token = localStorage.getItem("vaultshare_token");
    if (token)
      api
        .me(token)
        .then((user) => setIsAdmin(user.is_admin))
        .catch(() => setIsAdmin(false));
  }, [pathname]);
  if (pathname !== "/") return null;
  return (
    <nav className="home-route-links">
      <Link href="/profile">Thông tin người dùng</Link>
      {isAdmin && <Link href="/admin">Quản trị</Link>}
    </nav>
  );
}
