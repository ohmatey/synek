import { Link, useRouter } from '@tanstack/react-router'
import { useQueryClient } from '@tanstack/react-query'
import { Check, LogOut, Monitor, Moon, Sun } from 'lucide-react'
import { ClientOnly, ThemeToggle, useThemeContext, type Theme } from '@synek/ui'
import { Button } from '~/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '~/components/ui/dropdown-menu'
import { signOut, useSession } from '~/lib/auth/client'

const THEMES: { value: Theme; label: string; icon: typeof Monitor }[] = [
  { value: 'system', label: 'System', icon: Monitor },
  { value: 'light', label: 'Light', icon: Sun },
  { value: 'dark', label: 'Dark', icon: Moon },
]

function ProfileMenu({ name, email }: { name: string | null; email: string }) {
  const qc = useQueryClient()
  const router = useRouter()
  const { theme, setTheme } = useThemeContext()
  const initial = (name || email || '?').trim().charAt(0).toUpperCase()

  async function logout() {
    await signOut()
    await qc.invalidateQueries()
    // Re-run the home route loader so the server-resolved auth state (which drives
    // landing-vs-dashboard) flips back to the public landing.
    await router.invalidate()
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          aria-label="Account menu"
          className="grid size-8 cursor-pointer place-items-center rounded-full bg-gradient-to-br from-primary to-influence text-xs font-semibold text-white shadow-sm ring-1 ring-inset ring-white/15 outline-none transition-[box-shadow,transform] hover:ring-white/30 focus-visible:ring-2 focus-visible:ring-ring/60 active:scale-95"
        >
          {initial}
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" sideOffset={8} className="w-60">
        <div className="flex items-center gap-2.5 px-2 py-1.5">
          <span className="grid size-8 shrink-0 place-items-center rounded-full bg-gradient-to-br from-primary to-influence text-xs font-semibold text-white ring-1 ring-inset ring-white/15">
            {initial}
          </span>
          <span className="flex min-w-0 flex-col">
            <span className="truncate text-sm font-medium">{name || 'Your account'}</span>
            <span className="truncate text-xs text-muted-foreground">{email}</span>
          </span>
        </div>

        <DropdownMenuSeparator />
        <DropdownMenuLabel className="text-xs font-normal text-muted-foreground">
          Theme
        </DropdownMenuLabel>
        {THEMES.map((t) => (
          <DropdownMenuItem
            key={t.value}
            onSelect={(e) => {
              e.preventDefault() // keep the menu open so themes can be previewed
              setTheme(t.value)
            }}
          >
            <t.icon />
            {t.label}
            {theme === t.value && <Check className="ml-auto size-4 text-primary" />}
          </DropdownMenuItem>
        ))}

        <DropdownMenuSeparator />
        <DropdownMenuItem variant="destructive" onSelect={() => void logout()}>
          <LogOut />
          Log out
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

function HeaderAccount() {
  const { data: session, isPending } = useSession()

  if (isPending) return <span className="size-8 animate-pulse rounded-full bg-muted" />

  if (!session?.user)
    return (
      <div className="flex items-center gap-2">
        <ThemeToggle />
        <Button asChild size="sm">
          <Link to="/login">Sign in</Link>
        </Button>
      </div>
    )

  return <ProfileMenu name={session.user.name ?? null} email={session.user.email} />
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
