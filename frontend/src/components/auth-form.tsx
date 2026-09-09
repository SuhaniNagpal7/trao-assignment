'use client';
import { FormEvent, useState } from 'react';
import { ArrowRight, ArrowUpRight } from 'lucide-react';
import { api } from '@/lib/api';
export default function AuthForm() {
  const [register, setRegister] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setError(''); setBusy(true);
    const values = Object.fromEntries(new FormData(event.currentTarget));
    try { await api(`/auth/${register ? 'register' : 'login'}`, { method: 'POST', body: JSON.stringify(values) }); window.location.assign('/'); }
    catch (e) { setError((e as Error).message); setBusy(false); }
  }
  return <main className="auth-layout">
    <section className="auth-story" aria-label="Ahead"><div className="brand"><span className="brand-mark"><ArrowUpRight size={20} /></span>ahead</div></section>
    <section className="auth-panel"><div className="auth-form"><span className="eyebrow">YOUR PREPARATION WORKSPACE</span><h2>{register ? 'Create an account' : 'Sign in'}</h2><p>{register ? 'Create an account to save your interview courses.' : 'Sign in to continue your preparation.'}</p>
      <form onSubmit={submit} key={String(register)}>
        {register && <label>Full name<input name="name" autoComplete="name" required maxLength={80} placeholder="Your name" /></label>}
        <label>Email address<input name="email" type="email" autoComplete="email" required placeholder="you@example.com" /></label>
        <label>Password<input name="password" type="password" autoComplete={register ? 'new-password' : 'current-password'} required minLength={10} maxLength={128} placeholder={register ? 'At least 10 characters' : 'Enter your password'} /></label>
        {error && <p className="error" role="alert">{error}</p>}
        <button className="primary full" disabled={busy}>{busy ? 'Please wait…' : register ? 'Create account' : 'Sign in'}<ArrowRight size={17} /></button>
      </form>
      <p className="auth-switch">{register ? 'Already have an account?' : 'New to Ahead?'} <button onClick={() => { setRegister(!register); setError(''); }}>{register ? 'Sign in' : 'Create an account'}</button></p>
    </div></section>
  </main>;
}
