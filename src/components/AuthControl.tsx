'use client';

import { useState } from 'react';

import type { AuthUser } from '@/hooks/useAuth';

interface Props {
  ready: boolean;
  user: AuthUser | null;
  error: string | null;
  onLogin: (email: string, password: string) => Promise<void> | void;
  onRegister: (email: string, password: string) => Promise<void> | void;
  onLogout: () => void;
}

export default function AuthControl({
  ready,
  user,
  error,
  onLogin,
  onRegister,
  onLogout,
}: Props) {
  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState<'login' | 'register'>('login');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);

  if (!ready) {
    return (
      <span className="text-xs text-gray-500" aria-label="auth loading">
        …
      </span>
    );
  }

  if (user) {
    return (
      <div className="flex items-center gap-2">
        <span className="text-xs text-gray-300 hidden sm:inline" title={user.uid}>
          {user.email}
        </span>
        <button
          type="button"
          onClick={onLogout}
          className="text-xs px-3 py-1.5 rounded-lg border border-gray-700 text-gray-300 hover:bg-gray-800/60"
        >
          Sign out
        </button>
      </div>
    );
  }

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="text-xs px-3 py-1.5 rounded-lg border border-cyan-500/40 text-cyan-300 hover:bg-cyan-500/10"
      >
        Sign in
      </button>
    );
  }

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    try {
      if (mode === 'login') await onLogin(email, password);
      else await onRegister(email, password);
    } finally {
      setBusy(false);
    }
  };

  return (
    <form
      onSubmit={submit}
      className="flex flex-wrap items-center gap-2 bg-gray-900/80 border border-gray-800 rounded-lg px-3 py-2"
    >
      <input
        type="email"
        required
        autoComplete="email"
        placeholder="email"
        value={email}
        onChange={(e) => setEmail(e.target.value)}
        className="bg-gray-800/60 text-sm px-2 py-1 rounded border border-gray-700 focus:border-cyan-500/60 outline-none"
      />
      <input
        type="password"
        required
        minLength={6}
        autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
        placeholder="password"
        value={password}
        onChange={(e) => setPassword(e.target.value)}
        className="bg-gray-800/60 text-sm px-2 py-1 rounded border border-gray-700 focus:border-cyan-500/60 outline-none"
      />
      <button
        type="submit"
        disabled={busy}
        className="text-xs px-3 py-1.5 rounded-lg bg-gradient-to-r from-cyan-500 to-purple-600 text-white disabled:opacity-50"
      >
        {mode === 'login' ? 'Sign in' : 'Create'}
      </button>
      <button
        type="button"
        onClick={() => setMode(mode === 'login' ? 'register' : 'login')}
        className="text-xs text-gray-400 hover:text-gray-200"
      >
        {mode === 'login' ? 'Need an account?' : 'Have one?'}
      </button>
      <button
        type="button"
        onClick={() => setOpen(false)}
        className="text-xs text-gray-500 hover:text-gray-300"
        aria-label="close"
      >
        ×
      </button>
      {error && (
        <span className="text-xs text-red-400 w-full" role="alert">
          {error}
        </span>
      )}
    </form>
  );
}
