'use client'

import { Suspense, useState } from 'react'
import { signIn } from 'next-auth/react'
import { useSearchParams } from 'next/navigation'

function LoginForm() {
  const params = useSearchParams()
  const callbackUrl = params.get('callbackUrl') || '/admin'
  const errorParam = params.get('error')

  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(
    errorParam === 'CredentialsSignin' ? 'Invalid username or password.' : null,
  )

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault()
    setSubmitting(true)
    setError(null)
    const res = await signIn('admin-credentials', {
      username,
      password,
      callbackUrl,
      redirect: false,
    })
    setSubmitting(false)
    if (!res) {
      setError('Sign-in failed. Please try again.')
      return
    }
    if (res.error) {
      setError('Invalid username or password.')
      return
    }
    window.location.href = res.url || callbackUrl
  }

  return (
    <div className="min-h-screen flex items-center justify-center px-4">
      <form
        onSubmit={onSubmit}
        className="w-full max-w-sm rounded-lg border border-admin-border2 bg-admin-surface p-8 flex flex-col gap-6"
      >
        <div className="flex flex-col gap-1">
          <h1
            className="text-admin-green text-2xl font-extrabold uppercase tracking-[0.15em]"
            style={{ fontFamily: 'var(--font-barlow-condensed)' }}
          >
            T9L Admin
          </h1>
          <p className="text-admin-text3 text-xs uppercase tracking-[0.2em]">Sign in</p>
        </div>

        <div className="flex flex-col gap-2">
          <label
            htmlFor="username"
            className="text-[11px] font-semibold uppercase tracking-[0.15em] text-admin-text3"
          >
            Username
          </label>
          <input
            id="username"
            type="text"
            autoComplete="username"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            required
            className="rounded-md border border-admin-border2 bg-admin-surface2 px-3 py-2 text-admin-text outline-none focus:border-admin-green"
          />
        </div>

        <div className="flex flex-col gap-2">
          <label
            htmlFor="password"
            className="text-[11px] font-semibold uppercase tracking-[0.15em] text-admin-text3"
          >
            Password
          </label>
          <input
            id="password"
            type="password"
            autoComplete="current-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
            className="rounded-md border border-admin-border2 bg-admin-surface2 px-3 py-2 text-admin-text outline-none focus:border-admin-green"
          />
        </div>

        {error && (
          <div className="text-sm text-red-400 bg-red-950/40 border border-red-900 rounded-md px-3 py-2">
            {error}
          </div>
        )}

        <button
          type="submit"
          disabled={submitting}
          className="rounded-md bg-admin-green px-4 py-2 text-sm font-semibold tracking-wide text-[#0a1a12] hover:opacity-90 disabled:opacity-50"
        >
          {submitting ? 'Signing in…' : 'Sign in'}
        </button>
      </form>
    </div>
  )
}

export default function AdminLoginPage() {
  return (
    <Suspense fallback={null}>
      <LoginForm />
    </Suspense>
  )
}
