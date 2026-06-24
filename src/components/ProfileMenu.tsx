import { useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { Brush, Check, KeyRound, LogOut, Monitor, Moon, Palette, Sun, User } from 'lucide-react'
import { useThemeContext, type Theme } from '@synek/ui'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from '~/components/ui/dropdown-menu'
import { SettingsDialog, type SettingsTab } from '~/components/account/SettingsDialog'
import { BrandLibraryDialog } from '~/components/brand/BrandLibraryDialog'
import { signOut, useSession } from '~/lib/auth/client'
import { setUserTheme } from '~/lib/server/preferences'
import { cn } from '~/lib/utils'

const THEMES: { value: Theme; label: string; icon: typeof Monitor }[] = [
  { value: 'system', label: 'System', icon: Monitor },
  { value: 'light', label: 'Light', icon: Sun },
  { value: 'dark', label: 'Dark', icon: Moon },
]

// The signed-in user's avatar + account menu. Self-contained: reads the session
// and renders nothing for a signed-out viewer, so it can drop into both the home
// header and the timeline canvas chrome. Theme switching lives in a submenu;
// Account / API keys deep-link to the settings pages.
export function ProfileMenu({ className }: { className?: string }) {
  const qc = useQueryClient()
  const { theme, setTheme } = useThemeContext()
  const { data: session } = useSession()
  // Which settings tab is open (null = dialog closed). Opening from a menu item
  // closes the dropdown (default onSelect) and opens the dialog at that tab.
  const [settingsTab, setSettingsTab] = useState<SettingsTab | null>(null)
  const [brandsOpen, setBrandsOpen] = useState(false)
  const user = session?.user
  if (!user) return null

  const name = user.name || null
  const email = user.email
  const initial = (name || email || '?').trim().charAt(0).toUpperCase()

  async function logout() {
    await signOut()
    await qc.invalidateQueries()
  }

  // Apply locally for an instant preview, then persist to the user's account so
  // the choice follows them across devices. Keep the cached server value in sync
  // so ThemeSync doesn't later revert the pick.
  function chooseTheme(next: Theme) {
    setTheme(next)
    void setUserTheme({ data: { theme: next } }).then(() =>
      qc.setQueryData(['user-theme'], { theme: next }),
    )
  }

  return (
    <>
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          aria-label="Account menu"
          className={cn(
            'grid size-8 cursor-pointer place-items-center rounded-full bg-gradient-to-br from-primary to-influence text-xs font-semibold text-white shadow-sm ring-1 ring-inset ring-white/15 outline-none transition-[box-shadow,transform] hover:ring-white/30 focus-visible:ring-2 focus-visible:ring-ring/60 active:scale-95',
            className,
          )}
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
        <DropdownMenuItem onSelect={() => setSettingsTab('account')}>
          <User />
          Account
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={() => setSettingsTab('api-keys')}>
          <KeyRound />
          API keys
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={() => setBrandsOpen(true)}>
          <Brush />
          Brand kits
        </DropdownMenuItem>

        <DropdownMenuSub>
          <DropdownMenuSubTrigger className="gap-2">
            <Palette className="size-4 text-muted-foreground" />
            Theme
          </DropdownMenuSubTrigger>
          <DropdownMenuSubContent className="w-40">
            {THEMES.map((t) => (
              <DropdownMenuItem
                key={t.value}
                onSelect={(e) => {
                  e.preventDefault() // keep the menu open so themes can be previewed
                  chooseTheme(t.value)
                }}
              >
                <t.icon aria-hidden="true" />
                {t.label}
                {theme === t.value && <Check aria-hidden="true" className="ml-auto size-4 text-primary" />}
              </DropdownMenuItem>
            ))}
          </DropdownMenuSubContent>
        </DropdownMenuSub>

        <DropdownMenuSeparator />
        <DropdownMenuItem variant="destructive" onSelect={() => void logout()}>
          <LogOut />
          Log out
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>

    <SettingsDialog
      open={settingsTab !== null}
      tab={settingsTab ?? 'account'}
      onOpenChange={(o) => {
        if (!o) setSettingsTab(null)
      }}
      onTabChange={setSettingsTab}
    />
    <BrandLibraryDialog open={brandsOpen} onOpenChange={setBrandsOpen} />
    </>
  )
}
