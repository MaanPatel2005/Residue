'use client';

import Link from 'next/link';

import ResidueLogo from '@/components/ResidueLogo';

interface AuthPageProps {
  mode: 'login' | 'signup';
}

const siteTitleClass =
  'font-[family-name:var(--font-economica)] text-4xl font-bold tracking-wide text-[#8c52ff]';

export default function AuthPage({ mode }: AuthPageProps) {
  const isSignup = mode === 'signup';
  const primaryHref = isSignup
    ? '/auth/login?screen_hint=signup'
    : '/auth/login';

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
              <div className="mb-5 flex items-center gap-3">
                <ResidueLogo className="w-12 h-12 rounded-xl" priority />
                <p className={siteTitleClass}>RESIDUE</p>
              </div>
              <h1 className="text-3xl font-bold">
                {isSignup ? 'Create your account' : 'Welcome back'}
              </h1>
              <p className="text-sm text-gray-400 mt-3">
                {isSignup
                  ? 'Save your acoustic profile and connect companion devices.'
                  : 'Sign in to continue your personalized acoustic workspace.'}
              </p>
            </div>

            <div className="space-y-4">
              <a
                href={primaryHref}
                className="block w-full rounded-xl bg-linear-to-r from-cyan-500 to-purple-600 px-4 py-3 text-center text-sm font-semibold text-white hover:opacity-90"
              >
                {isSignup ? 'Continue to Auth0 signup' : 'Continue to Auth0 login'}
              </a>
              <p className="rounded-xl border border-cyan-500/20 bg-cyan-500/10 p-4 text-sm text-cyan-100">
                Authentication is handled by Auth0 Universal Login, including secure
                server-side session cookies for this Next.js app.
              </p>
            </div>

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
