import type { Metadata } from 'next';
import './globals.css';
export const metadata: Metadata = { title: 'VaultShare — Kho tài liệu an toàn', description: 'Lưu trữ và chia sẻ tài liệu mã hóa đầu cuối.' };
export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) { return <html lang="vi"><body>{children}</body></html> }
