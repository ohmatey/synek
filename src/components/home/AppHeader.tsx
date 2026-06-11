import { Link } from '@tanstack/react-router'
import { ClientOnly } from '@synek/ui'
import { Button } from '~/components/ui/button'
import { ProfileMenu } from '~/components/ProfileMenu'
import { useSession } from '~/lib/auth/client'

function HeaderAccount() {
  const { data: session, isPending } = useSession()

  if (isPending) return <span className="size-8 animate-pulse rounded-full bg-muted" />

  // Theme lives in the profile menu, which is per-user — so a signed-out visitor
  // has no theme switcher, just the sign-in entry point.
  if (!session?.user)
    return (
      <Button asChild size="sm">
        <Link to="/login">Sign in</Link>
      </Button>
    )

  return <ProfileMenu />
}

// Marketing anchors live only on the landing page, so they're dead links once
// you're signed in (the workspace has no such sections) — show them only then.
function MarketingNav() {
  const { data: session, isPending } = useSession()
  if (isPending || session?.user) return null

  return (
    <nav className="hidden items-center gap-1 md:flex">
      <a
        href="#how-it-works"
        className="rounded-md px-3 py-1.5 text-sm text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
      >
        How it works
      </a>
      <a
        href="#features"
        className="rounded-md px-3 py-1.5 text-sm text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
      >
        Features
      </a>
    </nav>
  )
}

export function AppHeader() {
  return (
    <header className="sticky top-0 z-30 border-b border-border/40 bg-background/70 backdrop-blur-xl">
      <div className="mx-auto flex h-14 max-w-6xl items-center justify-between gap-4 px-6">
        <a href="/" className="group flex items-center gap-2.5">
          <span className="grid size-7 place-items-center rounded-lg bg-gradient-to-br from-primary to-influence shadow-sm ring-1 ring-inset ring-white/10 transition-transform group-hover:scale-105">
            <img src="/favicon.svg" alt="" width={16} height={16} className="opacity-95" />
          </span>
          <span className="text-sm font-semibold tracking-tight">Synek</span>
        </a>

        <ClientOnly>
          <MarketingNav />
        </ClientOnly>

        <div className="flex items-center justify-end">
          <ClientOnly fallback={<span className="size-8 rounded-full bg-muted/60" />}>
            <HeaderAccount />
          </ClientOnly>
        </div>
      </div>
    </header>
  )
}
