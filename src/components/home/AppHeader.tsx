import { Link } from '@tanstack/react-router'
import { FolderKanban } from 'lucide-react'
import { ClientOnly } from '@synek/ui'
import { Button } from '~/components/ui/button'
import { ProfileMenu } from '~/components/ProfileMenu'
import { useSession } from '~/lib/auth/client'

// The right side of the global app header. Signed out: a Sign-in entry point.
// Signed in: the Projects button (the workspace lives behind /projects now — the
// left sidebar was removed) + the account menu (which carries the theme switcher).
function HeaderActions() {
  const { data: session, isPending } = useSession()

  if (isPending) return <span className="size-8 animate-pulse rounded-full bg-muted" />

  if (!session?.user)
    return (
      <Button asChild>
        <Link to="/login">Sign in</Link>
      </Button>
    )

  return (
    <div className="flex items-center gap-2">
      <Button asChild variant="outline" size="sm">
        <Link to="/projects">
          <FolderKanban className="size-4" />
          Projects
        </Link>
      </Button>
      <ProfileMenu />
    </div>
  )
}

// The global header shown above the public Explore feed (root /) and other
// marketing-adjacent pages. The workspace pages (canvas, /projects) bring their
// own chrome.
export function AppHeader() {
  return (
    <header className="sticky top-0 z-30 border-b border-border/40 bg-background/70 backdrop-blur-xl">
      <div className="mx-auto flex h-16 max-w-7xl items-center justify-between gap-4 px-6 sm:px-8">
        <Link to="/" className="group flex items-center gap-3">
          <span className="grid size-9 place-items-center rounded-xl bg-gradient-to-br from-primary to-influence shadow-sm ring-1 ring-inset ring-white/10 transition-transform group-hover:scale-105">
            <img src="/favicon.svg" alt="" width={20} height={20} className="opacity-95" />
          </span>
          <span className="text-lg font-semibold tracking-tight">Synek</span>
        </Link>

        <div className="flex items-center justify-end">
          <ClientOnly fallback={<span className="size-8 rounded-full bg-muted/60" />}>
            <HeaderActions />
          </ClientOnly>
        </div>
      </div>
    </header>
  )
}
