import { useQueryClient } from '@tanstack/react-query'
import { Button, ClientOnly, ThemeToggle, cn } from '@synek/ui'
import { signOut, useSession } from '~/lib/auth/client'

function AuthArea() {
  const qc = useQueryClient()
  const { data: session, isPending } = useSession()

  async function logout() {
    await signOut()
    await qc.invalidateQueries()
  }

  if (isPending) return <span className="text-xs text-[var(--color-fg-muted)]">…</span>

  if (!session?.user)
    return (
      <a
        href="#auth"
        className={cn(
          'inline-flex h-8 items-center rounded-[var(--radius-control)] px-3 text-sm font-medium',
          'bg-[var(--color-accent-primary)] text-[var(--color-on-accent)]',
          'hover:brightness-110 transition-[filter]',
        )}
      >
        Sign in
      </a>
    )

  return (
    <div className="flex items-center gap-2">
      <span
        className="hidden max-w-[18ch] truncate text-xs text-[var(--color-fg-muted)] sm:inline"
        title={session.user.email}
      >
        {session.user.email}
      </span>
      <Button size="sm" variant="ghost" onClick={() => void logout()}>
        Sign out
      </Button>
    </div>
  )
}

export function AppHeader() {
  return (
    <header
      className={cn(
        'sticky top-0 z-20 flex h-14 items-center justify-between gap-4 px-6',
        'border-b border-[var(--color-border-subtle)]',
        'bg-[var(--color-bg-base)]/85 backdrop-blur',
      )}
    >
      <a href="/" className="flex items-center gap-2 text-[var(--color-fg-primary)]">
        <img src="/favicon.svg" alt="" width={24} height={24} className="opacity-90" />
        <span className="text-sm font-semibold tracking-tight">Synek</span>
      </a>
      <div className="flex items-center gap-2">
        <ThemeToggle />
        <ClientOnly>
          <AuthArea />
        </ClientOnly>
      </div>
    </header>
  )
}
