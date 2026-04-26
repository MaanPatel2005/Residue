'use client';

import type { AuthUser } from '@/hooks/useAuth';

interface Props {
  ready: boolean;
  user: AuthUser | null;
}

export default function AuthControl({
  ready,
  user,
}: Props) {
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
        <a
          href="/auth/logout"
          className="text-xs px-3 py-1.5 rounded-lg border border-gray-700 text-gray-300 hover:bg-gray-800/60"
        >
          Sign out
        </a>
      </div>
    );
  }

  return (
    <div className="flex items-center gap-2">
      <a
        href="/auth/login"
        className="text-xs px-3 py-1.5 rounded-lg border border-cyan-500/40 text-cyan-300 hover:bg-cyan-500/10"
      >
        Sign in
      </a>
      <a
        href="/auth/login?screen_hint=signup"
        className="hidden sm:inline-flex text-xs px-3 py-1.5 rounded-lg bg-linear-to-r from-cyan-500 to-purple-600 text-white hover:opacity-90"
      >
        Create account
      </a>
    </div>
  );
}
