import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react'
import type { ResolvedTheme, Theme } from './types'
import { THEME_COOKIE } from './theme-init-script'

interface ThemeContextValue {
  /** User preference: 'light' | 'dark' | 'system'. */
  theme: Theme
  /** Currently applied theme — never 'system'. */
  resolvedTheme: ResolvedTheme
  /** Set preference; persists to cookie + localStorage. */
  setTheme: (next: Theme) => void
}

const ThemeContext = createContext<ThemeContextValue | null>(null)

const LS_KEY = 'strata.theme'

function readCookie(): Theme | null {
  if (typeof document === 'undefined') return null
  const m = document.cookie.match(new RegExp(`(?:^|;\\s*)${THEME_COOKIE}=([^;]+)`))
  if (!m) return null
  const v = decodeURIComponent(m[1])
  return v === 'light' || v === 'dark' || v === 'system' ? v : null
}

function writeCookie(theme: Theme) {
  if (typeof document === 'undefined') return
  // 1 year, lax, root path.
  document.cookie = `${THEME_COOKIE}=${theme}; Path=/; Max-Age=31536000; SameSite=Lax`
}

function readSystem(): ResolvedTheme {
  if (typeof window === 'undefined') return 'dark'
  return window.matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark'
}

function resolve(theme: Theme): ResolvedTheme {
  return theme === 'system' ? readSystem() : theme
}

export function ThemeProvider({ children }: { children: ReactNode }) {
  // Initial state matches what the inline pre-hydration script wrote — read
  // from cookie if available, else 'system'. This keeps SSR + first-client-render
  // consistent (the inline script already updated <html data-theme>).
  const [theme, setThemeState] = useState<Theme>(() => readCookie() ?? 'system')
  const [resolvedTheme, setResolved] = useState<ResolvedTheme>(() => resolve(theme))

  // Apply theme to <html data-theme> + color-scheme. Re-runs on theme change.
  useEffect(() => {
    const root = document.documentElement
    root.dataset.theme = resolvedTheme
    root.style.colorScheme = resolvedTheme
  }, [resolvedTheme])

  // If user picked 'system', track OS changes live.
  useEffect(() => {
    if (theme !== 'system') return
    const mql = window.matchMedia('(prefers-color-scheme: light)')
    const onChange = () => setResolved(mql.matches ? 'light' : 'dark')
    mql.addEventListener('change', onChange)
    return () => mql.removeEventListener('change', onChange)
  }, [theme])

  const setTheme = useCallback((next: Theme) => {
    setThemeState(next)
    setResolved(resolve(next))
    writeCookie(next)
    try {
      localStorage.setItem(LS_KEY, next)
    } catch {}
  }, [])

  const value = useMemo<ThemeContextValue>(
    () => ({ theme, resolvedTheme, setTheme }),
    [theme, resolvedTheme, setTheme],
  )

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>
}

export function useThemeContext(): ThemeContextValue {
  const ctx = useContext(ThemeContext)
  if (!ctx) {
    throw new Error('useTheme must be used inside <ThemeProvider>')
  }
  return ctx
}
