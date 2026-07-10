import { useState } from 'react'
import { Link, useNavigate } from '@tanstack/react-router'
import { ArrowLeft, Loader2, MailCheck } from 'lucide-react'
import { ClientOnly } from '@synek/ui'
import { toast } from 'sonner'
import { Button } from '~/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '~/components/ui/card'
import { Input } from '~/components/ui/input'
import { Label } from '~/components/ui/label'
import { Skeleton } from '~/components/ui/skeleton'
import { authClient } from '~/lib/auth/client'

// Self-serve password recovery (Better Auth). Two states keyed on the email link:
//  - no `token` → request a reset (forgetPassword → emails a link to here)
//  - `token`    → set a new password (resetPassword)
// Mirrors AuthScreen's chrome; rendered by /reset-password.

function RequestReset() {
  const [email, setEmail] = useState('')
  const [busy, setBusy] = useState(false)
  const [sent, setSent] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    if (busy) return
    setBusy(true)
    setError(null)
    try {
      const res = await authClient.requestPasswordReset({ email, redirectTo: '/reset-password' })
      if (res.error) {
        setError(res.error.message || 'Could not send the reset email')
        return
      }
      setSent(true)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not send the reset email')
    } finally {
      setBusy(false)
    }
  }

  if (sent) {
    return (
      <Card className="w-full border-border/70 bg-card/80 shadow-xl backdrop-blur-md">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-xl">
            <MailCheck className="size-5 text-success" /> Check your email
          </CardTitle>
          <CardDescription>
            If an account exists for <span className="font-medium text-foreground">{email}</span>, a password-reset link
            is on its way. The link expires in an hour.
          </CardDescription>
        </CardHeader>
      </Card>
    )
  }

  return (
    <Card className="w-full border-border/70 bg-card/80 shadow-xl backdrop-blur-md">
      <CardHeader>
        <CardTitle className="text-xl">Reset your password</CardTitle>
        <CardDescription>Enter your account email and we'll send you a link to set a new password.</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-5">
        <form className="flex flex-col gap-4" onSubmit={submit}>
          <div className="flex flex-col gap-2">
            <Label htmlFor="reset-email">Email</Label>
            <Input
              id="reset-email"
              type="email"
              name="email"
              required
              spellCheck={false}
              placeholder="e.g. you@example.com…"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              autoComplete="email"
            />
          </div>
          <Button type="submit" disabled={busy} className="mt-1 w-full">
            {busy && <Loader2 className="animate-spin" />}
            Send reset link
          </Button>
        </form>
        {error && (
          <p role="alert" className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
            {error}
          </p>
        )}
      </CardContent>
    </Card>
  )
}

function SetNewPassword({ token }: { token: string }) {
  const navigate = useNavigate()
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    if (busy) return
    if (password !== confirm) {
      setError('Passwords do not match')
      return
    }
    setBusy(true)
    setError(null)
    try {
      const res = await authClient.resetPassword({ newPassword: password, token })
      if (res.error) {
        setError(res.error.message || 'This reset link is invalid or has expired')
        return
      }
      toast.success('Password updated — sign in with your new password')
      void navigate({ to: '/login' })
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not reset the password')
    } finally {
      setBusy(false)
    }
  }

  return (
    <Card className="w-full border-border/70 bg-card/80 shadow-xl backdrop-blur-md">
      <CardHeader>
        <CardTitle className="text-xl">Set a new password</CardTitle>
        <CardDescription>Choose a new password for your account.</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-5">
        <form className="flex flex-col gap-4" onSubmit={submit}>
          <div className="flex flex-col gap-2">
            <Label htmlFor="new-password">New password</Label>
            <Input
              id="new-password"
              type="password"
              name="password"
              required
              minLength={8}
              placeholder="e.g. At least 8 characters…"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete="new-password"
            />
          </div>
          <div className="flex flex-col gap-2">
            <Label htmlFor="confirm-password">Confirm password</Label>
            <Input
              id="confirm-password"
              type="password"
              name="confirm-password"
              required
              minLength={8}
              placeholder="e.g. Confirm new password…"
              value={confirm}
              onChange={(e) => setConfirm(e.target.value)}
              autoComplete="new-password"
            />
          </div>
          <Button type="submit" disabled={busy} className="mt-1 w-full">
            {busy && <Loader2 className="animate-spin" />}
            Update password
          </Button>
        </form>
        {error && (
          <p role="alert" className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
            {error}
          </p>
        )}
      </CardContent>
    </Card>
  )
}

export function ResetPasswordScreen({ token }: { token?: string }) {
  return (
    <div className="relative flex min-h-screen flex-col overflow-hidden text-foreground">
      <div className="lp-aurora">
        <span />
        <span />
        <span />
      </div>
      <div className="lp-grid" />

      <header className="relative z-10 px-6 py-5">
        <Link
          to="/"
          className="inline-flex items-center gap-2.5 text-sm font-semibold tracking-tight transition-colors hover:text-primary"
        >
          <span className="grid size-7 place-items-center rounded-lg bg-gradient-to-br from-primary to-influence shadow-sm ring-1 ring-inset ring-white/10">
            <img src="/favicon.svg" alt="" width={16} height={16} className="opacity-95" />
          </span>
          Synek
        </Link>
      </header>

      <main id="main" tabIndex={-1} className="relative z-10 grid flex-1 place-items-center px-6 pb-16">
        <div className="w-full max-w-md">
          <ClientOnly fallback={<Skeleton className="h-[320px] w-full rounded-xl border border-border/60" />}>
            {token ? <SetNewPassword token={token} /> : <RequestReset />}
          </ClientOnly>
          <p className="mt-6 text-center text-sm text-muted-foreground">
            <Link to="/login" className="inline-flex items-center gap-1.5 hover:text-foreground">
              <ArrowLeft className="size-3.5" />
              Back to sign in
            </Link>
          </p>
        </div>
      </main>
    </div>
  )
}
