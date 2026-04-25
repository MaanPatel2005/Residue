'use client';

import { useCallback, useEffect, useState } from 'react';

export interface AuthUser {
  uid: string;
  email: string;
}

interface AuthState {
  ready: boolean;
  token: string | null;
  user: AuthUser | null;
  error: string | null;
}

const TOKEN_KEY = 'residue.authToken';

async function postJson<T>(path: string, body: unknown): Promise<T> {
  const res = await fetch(path, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const err = (await res.json().catch(() => null)) as { error?: string } | null;
    throw new Error(err?.error ?? `HTTP ${res.status}`);
  }
  return (await res.json()) as T;
}

export function useAuth() {
  const [state, setState] = useState<AuthState>({
    ready: false,
    token: null,
    user: null,
    error: null,
  });

  // Hydrate from localStorage and verify against /api/auth/me.
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const stored = window.localStorage.getItem(TOKEN_KEY);
    if (!stored) {
      setState((s) => ({ ...s, ready: true }));
      return;
    }
    fetch('/api/auth/me', {
      headers: { authorization: `Bearer ${stored}` },
    })
      .then(async (res) => {
        if (!res.ok) {
          window.localStorage.removeItem(TOKEN_KEY);
          setState({ ready: true, token: null, user: null, error: null });
          return;
        }
        const data = (await res.json()) as { user: AuthUser };
        setState({ ready: true, token: stored, user: data.user, error: null });
      })
      .catch(() => {
        setState({ ready: true, token: null, user: null, error: null });
      });
  }, []);

  const persist = useCallback((token: string, user: AuthUser) => {
    if (typeof window !== 'undefined') {
      window.localStorage.setItem(TOKEN_KEY, token);
    }
    setState({ ready: true, token, user, error: null });
  }, []);

  const login = useCallback(
    async (email: string, password: string) => {
      try {
        const data = await postJson<{ token: string; user: AuthUser }>(
          '/api/auth/login',
          { email, password },
        );
        persist(data.token, data.user);
      } catch (error) {
        const message = error instanceof Error ? error.message : 'login failed';
        setState((s) => ({ ...s, ready: true, error: message }));
      }
    },
    [persist],
  );

  const register = useCallback(
    async (email: string, password: string) => {
      try {
        const data = await postJson<{ token: string; user: AuthUser }>(
          '/api/auth/register',
          { email, password },
        );
        persist(data.token, data.user);
      } catch (error) {
        const message =
          error instanceof Error ? error.message : 'registration failed';
        setState((s) => ({ ...s, ready: true, error: message }));
      }
    },
    [persist],
  );

  const logout = useCallback(() => {
    if (typeof window !== 'undefined') {
      window.localStorage.removeItem(TOKEN_KEY);
    }
    setState({ ready: true, token: null, user: null, error: null });
  }, []);

  return { ...state, login, register, logout };
}
