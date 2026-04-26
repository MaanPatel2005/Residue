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

async function getJson<T>(path: string): Promise<T> {
  const res = await fetch(path, { credentials: 'include' });
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

  // Hydrate from the server-side Auth0 session.
  useEffect(() => {
    let cancelled = false;

    const hydrate = async () => {
      try {
        const data = await getJson<{ token: string; user: AuthUser }>('/api/auth/me');
        if (!cancelled) {
          setState({
            ready: true,
            token: data.token,
            user: data.user,
            error: null,
          });
        }
      } catch (error) {
        if (!cancelled) {
          const message =
            error instanceof Error && !error.message.startsWith('HTTP 401')
              ? error.message
              : null;
          setState({ ready: true, token: null, user: null, error: message });
        }
      }
    };

    void hydrate();

    return () => {
      cancelled = true;
    };
  }, []);

  const login = useCallback(
    async () => {
      if (typeof window !== 'undefined') {
        window.location.assign('/auth/login');
      }
      return true;
    },
    [],
  );

  const register = useCallback(
    async () => {
      if (typeof window !== 'undefined') {
        window.location.assign('/auth/login?screen_hint=signup');
      }
      return true;
    },
    [],
  );

  const logout = useCallback(() => {
    if (typeof window !== 'undefined') {
      window.location.assign('/auth/logout');
    }
    setState({ ready: true, token: null, user: null, error: null });
  }, []);

  return { ...state, login, register, logout };
}
