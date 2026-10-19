'use client';

import { FormEvent, useState } from 'react';
import { useRouter } from 'next/navigation';
import { api } from '@/lib/api';
import { makeKeyBundle, unlockPrivateKey } from '@/lib/crypto';
import { saveSession } from '@/lib/session';

export default function LoginPage() {
  const router = useRouter();
  const [mode, setMode] = useState<'login' | 'register'>('login');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setError('');
    setBusy(true);
    try {
      let result;
      if (mode === 'register') {
        if (password.length < 10) throw new Error('Mật khẩu cần ít nhất 10 ký tự.');
        const keys = await makeKeyBundle(password);
        result = await api.register({ email, password, display_name: displayName || email.split('@')[0], ...keys });
      } else {
        result = await api.login({ email, password });
      }
      const privateKey = await unlockPrivateKey(result.user, password);
      saveSession(result.access_token, privateKey);
      router.replace('/');
    } catch (failure) {
      setError((failure as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return <main className="auth"><section className="auth-side"><a className="brand" href="/"><b>V</b> vault<span>share</span></a><div className="auth-copy"><small>PRIVATE BY DESIGN</small><h1>Tài liệu của bạn.<br/><em>Quyền kiểm soát của bạn.</em></h1><p>Mã hóa trên thiết bị. Chia sẻ có kiểm soát. Kiểm tra toàn vẹn bất cứ lúc nào.</p><div className="cipher-card"><b>AES-256-GCM</b><b>RSA-OAEP</b></div></div><footer>AN TOÀN TỪ THIẾT KẾ</footer></section><section className="auth-main"><div className="auth-box"><small className="eyebrow">KHO TÀI LIỆU CÁ NHÂN</small><h2>{mode === 'login' ? 'Chào mừng trở lại' : 'Tạo không gian an toàn'}</h2><p>{mode === 'login' ? 'Đăng nhập để tiếp tục vào không gian của bạn.' : 'Tạo tài khoản để bắt đầu lưu trữ tài liệu.'}</p><div className="tabs"><button className={mode === 'login' ? 'selected' : ''} onClick={() => { setMode('login'); setError(''); }}>Đăng nhập</button><button className={mode === 'register' ? 'selected' : ''} onClick={() => { setMode('register'); setError(''); }}>Tạo tài khoản</button></div><form onSubmit={submit}>{mode === 'register' && <label>Tên hiển thị<input value={displayName} onChange={event => setDisplayName(event.target.value)} required/></label>}<label>Email<input type="email" value={email} onChange={event => setEmail(event.target.value)} required/></label><label>Mật khẩu<input type="password" minLength={mode === 'register' ? 10 : 1} value={password} onChange={event => setPassword(event.target.value)} required/></label>{error && <div className="error-box">{error}</div>}<button className="primary full" disabled={busy}>{busy ? 'Đang xử lý…' : mode === 'login' ? 'Đăng nhập' : 'Tạo tài khoản'} <span>→</span></button></form><a className="login-back" href="/">Quay lại kho tài liệu</a></div></section></main>;
}
