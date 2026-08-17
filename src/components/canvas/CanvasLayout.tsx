import type { CSSProperties, ReactNode } from 'react'
import { Link } from '@tanstack/react-router'
import { ProfileMenu } from '~/components/ProfileMenu'
import { cn } from '~/lib/utils'
import { floatChip } from './chrome'

// The Synek logo chip — a home link that's always present in the canvas chrome,
// even when there's no timeline to name (a missing / private one). The full
// AppBar (logo + editable timeline name + switcher) supersedes it on the loaded
// canvas; this is the bare fallback so the bar is never empty on the left.
export function BrandChip() {
  return (
    <Link
      to="/"
      className={cn(
        floatChip,
        'flex h-8 items-center gap-1.5 px-2.5 text-sm font-semibold transition-colors hover:text-primary',
      )}
      title="Home"
    >
      <span className="grid size-5 place-items-center rounded-md bg-gradient-to-br from-primary to-influence ring-1 ring-inset ring-white/10">
        <img src="/favicon.svg" alt="" width={12} height={12} className="opacity-95" />
      </span>
      Synek
    </Link>
  )
}

// The canvas page's layout shell: the full-height `.canvas-root` plus the floating
// `.top-bar` chrome (identity on the left, an optional centered lens toggle, and a
// right-aligned control cluster that always ends in the account menu). Both the
// loaded canvas and its load states (missing / private timeline) render through
// this, so the app bar with its controls is present no matter what loads beneath —
// a stranded error page never strips the user of navigation.
export function CanvasLayout({
  brand,
  center,
  controls,
  texture,
  storyOpen,
  detailOpen,
  style,
  children,
}: {
  // Left identity slot — defaults to the bare brand/home chip; the loaded canvas
  // passes the full <AppBar /> (timeline name + switcher).
  brand?: ReactNode
  // Center slot — the lens <ViewSwitcher /> on the loaded canvas; omitted in load
  // states (there's nothing to switch).
  center?: ReactNode
  // Right-aligned contextual controls (palette, history, settings, share…). The
  // account menu is appended automatically so it's always rightmost.
  controls?: ReactNode
  // Forwarded to `.canvas-root` for the per-timeline theme/texture treatment.
  texture?: string
  // Which docks are mounted. CSS needs this as a FLAG, not as a width: the
  // --story-reader-w / --detail-panel-w custom properties are published
  // unconditionally, so their values can never say whether a panel actually
  // exists. The dock-order rules key off these attributes.
  storyOpen?: boolean
  detailOpen?: boolean
  style?: CSSProperties
  children?: ReactNode
}) {
  return (
    <div
      className="canvas-root"
      data-canvas-texture={texture}
      data-story-open={storyOpen || undefined}
      data-detail-open={detailOpen || undefined}
      style={style}
    >
      <div className="top-bar">
        {brand ?? <BrandChip />}
        {center}
        <div className="canvas-toolbar">
          {controls}
          <ProfileMenu />
        </div>
      </div>
      {children}
    </div>
  )
}
