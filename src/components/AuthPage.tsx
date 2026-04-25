'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { FormEvent, useState } from 'react';

import { useAuth } from '@/hooks/useAuth';

interface AuthPageProps {
  mode: 'login' | 'signup';
}

export default function AuthPage({ mode }: AuthPageProps) {
  const router = useRouter();
  const auth = useAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);

  const isSignup = mode === 'signup';

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setBusy(true);
    try {
      const ok = isSignup
        ? await auth.register(email, password)
        : await auth.login(email, password);
      if (ok) router.push('/');
    } finally {
      setBusy(false);
    }
  };

  return (
    <main className="min-h-screen bg-[#0a0a1a] text-white overflow-hidden">
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_top_left,rgba(6,182,212,0.18),transparent_32%),radial-gradient(circle_at_bottom_right,rgba(147,51,234,0.18),transparent_34%)]" />
      <div className="relative min-h-screen flex items-center justify-center px-4 py-12">
        <div className="w-full max-w-md">
          <Link
            href="/"
            className="inline-flex items-center text-sm text-gray-400 hover:text-cyan-300 mb-6"
          >
            Back to Residue
          </Link>

          <section className="rounded-2xl border border-gray-800 bg-gray-900/80 backdrop-blur-md shadow-2xl shadow-cyan-950/20 p-8">
            <div className="mb-8">
              <div className="w-12 h-12 rounded-xl bg-linear-to-br from-cyan-500 to-purple-600 flex items-center justify-center mb-5">
                <svg
                  className="w-7 h-7 text-white"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                  aria-hidden="true"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M9 19V6l12-3v13M9 19c0 1.105-1.343 2-3 2s-3-.895-3-2 1.343-2 3-2 3 .895 3 2zm12-3c0 1.105-1.343 2-3 2s-3-.895-3-2 1.343-2 3-2 3 .895 3 2zM9 10l12-3"
                  />
                </svg>
              </div>
              <p className="text-xs uppercase tracking-[0.3em] text-cyan-300/80 mb-3">
                Residue
              </p>
              <h1 className="text-3xl font-bold">
                {isSignup ? 'Create your account' : 'Welcome back'}
              </h1>
              <p className="text-sm text-gray-400 mt-3">
                {isSignup
                  ? 'Save your acoustic profile and connect companion devices.'
                  : 'Sign in to continue your personalized acoustic workspace.'}
              </p>
            </div>

            {auth.ready && auth.user ? (
              <div className="space-y-4">
                <div className="rounded-xl border border-cyan-500/20 bg-cyan-500/10 p-4">
                  <p className="text-sm text-cyan-100">You are already signed in as</p>
                  <p className="text-sm font-medium text-white mt-1">{auth.user.email}</p>
                </div>
                <button
                  type="button"
                  onClick={() => router.push('/')}
                  className="w-full rounded-xl bg-linear-to-r from-cyan-500 to-purple-600 px-4 py-3 text-sm font-semibold text-white hover:opacity-90"
                >
                  Continue to app
                </button>
                <button
                  type="button"
                  onClick={auth.logout}
                  className="w-full rounded-xl border border-gray-700 px-4 py-3 text-sm font-semibold text-gray-300 hover:bg-gray-800/70"
                >
                  Sign out
                </button>
              </div>
            ) : (
              <form onSubmit={submit} className="space-y-5">
                <label className="block">
                  <span className="text-sm text-gray-300">Email</span>
                  <input
                    type="email"
                    required
                    autoComplete="email"
                    value={email}
                    onChange={(event) => setEmail(event.target.value)}
                    className="mt-2 w-full rounded-xl border border-gray-700 bg-gray-950/60 px-4 py-3 text-sm text-white outline-none transition focus:border-cyan-400 focus:ring-2 focus:ring-cyan-400/20"
                    placeholder="you@example.com"
                  />
                </label>

                <label className="block">
                  <span className="text-sm text-gray-300">Password</span>
                  <input
                    type="password"
                    required
                    minLength={6}
                    autoComplete={isSignup ? 'new-password' : 'current-password'}
                    value={password}
                    onChange={(event) => setPassword(event.target.value)}
                    className="mt-2 w-full rounded-xl border border-gray-700 bg-gray-950/60 px-4 py-3 text-sm text-white outline-none transition focus:border-cyan-400 focus:ring-2 focus:ring-cyan-400/20"
                    placeholder="At least 6 characters"
                  />
                </label>

                {auth.error && (
                  <p className="rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm text-red-300">
                    {auth.error}
                  </p>
                )}

                <button
                  type="submit"
                  disabled={busy || !auth.ready}
                  className="w-full rounded-xl bg-linear-to-r from-cyan-500 to-purple-600 px-4 py-3 text-sm font-semibold text-white hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {busy
                    ? isSignup
                      ? 'Creating account...'
                      : 'Signing in...'
                    : isSignup
                      ? 'Create account'
                      : 'Sign in'}
                </button>
              </form>
            )}

            <div className="mt-6 text-center text-sm text-gray-400">
              {isSignup ? (
                <>
                  Already have an account?{' '}
                  <Link href="/login" className="text-cyan-300 hover:text-cyan-200">
                    Sign in
                  </Link>
                </>
              ) : (
                <>
                  New to Residue?{' '}
                  <Link href="/signup" className="text-cyan-300 hover:text-cyan-200">
                    Create an account
                  </Link>
                </>
              )}
            </div>
          </section>
        </div>
      </div>
    </main>
  );
}
