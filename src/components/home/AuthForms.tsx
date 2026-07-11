import { useState } from 'react'
import { Link } from '@tanstack/react-router'
import { useQueryClient } from '@tanstack/react-query'
import { Loader2 } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '~/components/ui/button'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '~/components/ui/card'
import { Input } from '~/components/ui/input'
import { Label } from '~/components/ui/label'
import { Tabs, TabsList, TabsTrigger } from '~/components/ui/tabs'
import { signIn, signUp } from '~/lib/auth/client'
import { capture } from '~/lib/posthog/client'
import type { SignupAttribution } from '~/lib/posthog/attribution'

type Mode = 'signin' | 'signup'

// Error codes better-auth attaches when the *password* field specifically is at
// fault (too short/long, or plain wrong on sign-in) — branch on the stable code,
// not the message text, so this doesn't drift with copy/locale changes.
const PASSWORD_FIELD_ERROR_CODES = new Set(['PASSWORD_TOO_SHORT', 'PASSWORD_TOO_LONG', 'INVALID_PASSWORD'])

export function AuthForms({
  initialMode = 'signin',
  attribution,
  onAuthed,
}: {
  initialMode?: Mode
  /** M.4: where this signup came from — a shared story carries its slug for the join. */
  attribution?: SignupAttribution
  onAuthed?: () => void
}) {
  const qc = useQueryClient()
  const [mode, setMode] = useState<Mode>(initialMode)
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [name, setName] = useState('')
  // "Stay logged in": checked (default) persists the session cookie for the full
  // 30-day rolling window; unchecked makes it a browser-session cookie (Better
  // Auth's `rememberMe: false`), so closing the browser signs you out.
  const [rememberMe, setRememberMe] = useState(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [passwordError, setPasswordError] = useState(false)

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    if (busy) return
    setBusy(true)
    setError(null)
    setPasswordError(false)
    try {
      const res =
        mode === 'signup'
          ? await signUp.email({ email, password, name: name.trim() || email.split('@')[0] })
          : await signIn.email({ email, password, rememberMe })
      if (res.error) {
        setError(res.error.message || 'Authentication failed')
        setPasswordError(PASSWORD_FIELD_ERROR_CODES.has(res.error.code ?? ''))
        return
      }
      if (mode === 'signup') {
        toast.success('Account created — check your email to verify your address.')
        // M.1 funnel step 1 + M.4 attribution. `source` is the acquisition channel
        // ('shared_story' with its originating slug when the reader converted from a
        // public /s/$slug CTA, else 'direct'); `referrer` is the raw backstop.
        const attr = attribution ?? { source: 'direct' as const }
        capture('signup', { source: attr.source, slug: attr.slug, referrer: document.referrer || undefined })
      }
      await qc.invalidateQueries()
      onAuthed?.()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Authentication failed')
    } finally {
      setBusy(false)
    }
  }

  return (
    <Card
      id="auth"
      className="w-full border-border/70 bg-card/80 shadow-xl backdrop-blur-md"
    >
      <CardHeader>
        <CardTitle className="text-xl">
          {mode === 'signup' ? 'Create your account' : 'Welcome back'}
        </CardTitle>
        <CardDescription>
          {mode === 'signup'
            ? 'An account holds your timelines and API keys.'
            : 'Sign in to your timelines and API keys.'}
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-5">
        <Tabs
          value={mode}
          onValueChange={(v) => {
            setMode(v as Mode)
            setError(null)
            setPasswordError(false)
          }}
        >
          <TabsList className="grid w-full grid-cols-2">
            <TabsTrigger value="signin">Sign in</TabsTrigger>
            <TabsTrigger value="signup">Create account</TabsTrigger>
          </TabsList>
        </Tabs>

        <form className="flex flex-col gap-4" onSubmit={submit}>
          {mode === 'signup' && (
            <div className="flex flex-col gap-2">
              <Label htmlFor="auth-name">Name</Label>
              <Input
                id="auth-name"
                name="name"
                placeholder="e.g. Ada Lovelace…"
                value={name}
                onChange={(e) => setName(e.target.value)}
                autoComplete="name"
              />
            </div>
          )}
          <div className="flex flex-col gap-2">
            <Label htmlFor="auth-email">Email</Label>
            <Input
              id="auth-email"
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
          <div className="flex flex-col gap-2">
            <Label htmlFor="auth-password">Password</Label>
            <Input
              id="auth-password"
              type="password"
              name="password"
              required
              minLength={8}
              placeholder={mode === 'signup' ? 'e.g. At least 8 characters…' : '••••••••'}
              value={password}
              onChange={(e) => {
                setPassword(e.target.value)
                setPasswordError(false)
              }}
              autoComplete={mode === 'signup' ? 'new-password' : 'current-password'}
              aria-invalid={passwordError}
              className={passwordError ? 'border-destructive focus-visible:ring-destructive/40' : undefined}
            />
          </div>
          {mode === 'signin' && (
            <div className="flex items-center justify-between gap-3">
              <label
                htmlFor="auth-remember"
                className="flex cursor-pointer items-center gap-2 text-xs text-muted-foreground"
              >
                <input
                  id="auth-remember"
                  type="checkbox"
                  checked={rememberMe}
                  onChange={(e) => setRememberMe(e.target.checked)}
                  className="size-3.5 accent-primary"
                />
                Stay logged in
              </label>
              <Link
                to="/reset-password"
                className="text-xs text-muted-foreground transition-colors hover:text-foreground"
              >
                Forgot password?
              </Link>
            </div>
          )}
          <Button type="submit" disabled={busy} className="mt-1 w-full">
            {busy && <Loader2 className="animate-spin" />}
            {mode === 'signup' ? 'Create account' : 'Log in'}
          </Button>
        </form>

        {error && (
          <p
            role="alert"
            className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive"
          >
            {error}
          </p>
        )}
      </CardContent>
    </Card>
  )
}
