import { useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { Button, Card, Input } from '@synek/ui'
import { signIn, signUp } from '~/lib/auth/client'

type Mode = 'signin' | 'signup'

export function AuthForms() {
  const qc = useQueryClient()
  const [mode, setMode] = useState<Mode>('signin')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [name, setName] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    if (busy) return
    setBusy(true)
    setError(null)
    try {
      const res =
        mode === 'signup'
          ? await signUp.email({ email, password, name: name.trim() || email.split('@')[0] })
          : await signIn.email({ email, password })
      if (res.error) {
        setError(res.error.message || 'Authentication failed')
        return
      }
      await qc.invalidateQueries()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Authentication failed')
    } finally {
      setBusy(false)
    }
  }

  return (
    <Card id="auth" elevation="raised" padding="lg" className="w-full max-w-md">
      <h2 className="mb-1 text-lg font-semibold text-[var(--color-fg-primary)]">
        {mode === 'signup' ? 'Create your account' : 'Sign in'}
      </h2>
      <p className="mb-4 text-sm text-[var(--color-fg-muted)]">
        {mode === 'signup'
          ? 'An account holds your timelines and API keys.'
          : 'Sign in to your timelines and API keys.'}
      </p>
      <form className="flex flex-col gap-3" onSubmit={submit}>
        {mode === 'signup' && (
          <Input
            placeholder="Name (optional)"
            value={name}
            onChange={(e) => setName(e.target.value)}
            aria-label="Name"
          />
        )}
        <Input
          type="email"
          required
          placeholder="Email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          aria-label="Email"
        />
        <Input
          type="password"
          required
          minLength={8}
          placeholder="Password (min 8 characters)"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          aria-label="Password"
        />
        <Button type="submit" variant="primary" loading={busy}>
          {mode === 'signup' ? 'Create account' : 'Log in'}
        </Button>
      </form>
      {error && (
        <p
          role="alert"
          className="mt-3 rounded-[var(--radius-control)] border border-[var(--color-danger)] bg-[var(--color-danger-soft-bg)] px-3 py-2 text-xs text-[var(--color-danger)]"
        >
          {error}
        </p>
      )}
      <button
        type="button"
        className="mt-4 text-xs text-[var(--color-fg-muted)] hover:text-[var(--color-fg-secondary)] transition-colors"
        onClick={() => {
          setMode((m) => (m === 'signup' ? 'signin' : 'signup'))
          setError(null)
        }}
      >
        {mode === 'signup' ? 'Have an account? Log in' : 'New here? Create an account'}
      </button>
    </Card>
  )
}
