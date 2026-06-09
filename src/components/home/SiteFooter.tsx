import { Link } from '@tanstack/react-router'

const PRODUCT = [
  { label: 'How it works', href: '#how-it-works' },
  { label: 'Features', href: '#features' },
]

export function SiteFooter() {
  return (
    <footer className="relative mt-8 border-t border-border/60">
      {/* gradient hairline accent */}
      <div className="absolute inset-x-0 -top-px h-px bg-gradient-to-r from-transparent via-primary/40 to-transparent" />
      <div className="mx-auto grid max-w-6xl gap-10 px-6 py-12 sm:grid-cols-2 md:grid-cols-[1.5fr_1fr_1fr]">
        <div className="flex flex-col gap-3">
          <div className="flex items-center gap-2.5">
            <span className="grid size-7 place-items-center rounded-lg bg-gradient-to-br from-primary to-influence shadow-sm ring-1 ring-inset ring-white/10">
              <img src="/favicon.svg" alt="" width={16} height={16} className="opacity-95" />
            </span>
            <span className="text-sm font-semibold tracking-tight">Synek</span>
          </div>
          <p className="max-w-xs text-sm leading-relaxed text-muted-foreground">
            A timeline canvas your AI builds for you. Local-first, MCP-native — the app holds no
            model of its own.
          </p>
        </div>

        <div className="flex flex-col gap-3">
          <span className="text-xs font-semibold uppercase tracking-[0.14em] text-muted-foreground">
            Product
          </span>
          <ul className="flex flex-col gap-2.5 text-sm">
            {PRODUCT.map((l) => (
              <li key={l.label}>
                <a href={l.href} className="text-muted-foreground transition-colors hover:text-foreground">
                  {l.label}
                </a>
              </li>
            ))}
          </ul>
        </div>

        <div className="flex flex-col gap-3">
          <span className="text-xs font-semibold uppercase tracking-[0.14em] text-muted-foreground">
            Get started
          </span>
          <ul className="flex flex-col gap-2.5 text-sm">
            <li>
              <Link to="/login" className="text-muted-foreground transition-colors hover:text-foreground">
                Sign in
              </Link>
            </li>
            <li>
              <Link to="/signup" className="text-muted-foreground transition-colors hover:text-foreground">
                Create account
              </Link>
            </li>
          </ul>
        </div>
      </div>

      <div className="mx-auto flex max-w-6xl flex-col gap-2 border-t border-border/50 px-6 py-6 text-xs text-muted-foreground sm:flex-row sm:items-center sm:justify-between">
        <span>© {2026} Synek</span>
        <span>Local-first · MCP-native · No AI in the app</span>
      </div>
    </footer>
  )
}
