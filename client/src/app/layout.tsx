import type { Metadata } from 'next';
import './globals.css';
import './routes.css';
import HomeRouteLinks from './home-route-links';
export const metadata: Metadata = { title: 'VaultShare — Kho tài liệu an toàn', description: 'Lưu trữ và chia sẻ tài liệu mã hóa đầu cuối.' };
export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) { return <html lang="vi"><body><HomeRouteLinks/>{children}</body></html> }
