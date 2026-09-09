'use client';
import Link from 'next/link';
import { ArrowUpRight, LayoutGrid, LogOut } from 'lucide-react';
import { useState } from 'react';
import { api, ApiError, Auth } from '@/lib/api';
export default function Shell({ auth, children }: { auth: Auth; children: React.ReactNode }) {
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  async function logout() {
    setBusy(true);
    try { await api('/auth/logout', { method: 'POST' }, auth.csrf_token); window.location.assign('/login'); }
    catch (e) { if (e instanceof ApiError && e.status === 401) window.location.assign('/login'); else { setError((e as Error).message); setBusy(false); } }
  }
  return <div className="app-shell calm-workspace">
    <aside className="sidebar">
      <Link href="/" className="brand"><span className="brand-mark"><ArrowUpRight size={21} /></span>ahead<span className="brand-dot">.</span></Link>
      <span className="nav-label">YOUR WORKSPACE</span>
      <nav aria-label="Main navigation"><Link href="/" className="nav-item active"><LayoutGrid size={18} /> My courses</Link></nav>
      <div className="profile"><span className="avatar" aria-hidden="true">{auth.user.name.slice(0, 1).toUpperCase()}</span><div><strong>{auth.user.name}</strong><span>Personal workspace</span></div><button className="icon-button" aria-label="Sign out" title="Sign out" disabled={busy} onClick={logout}><LogOut size={17} /></button></div>
      {error && <p className="error" role="alert">{error}</p>}
    </aside>
    <div className="workspace"><main id="main-content">{children}</main></div>
  </div>;
}
