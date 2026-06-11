import type { ReactNode } from 'react'
import { Link } from '@tanstack/react-router'
import { ArrowLeft } from 'lucide-react'
import { ClientOnly } from '@synek/ui'
import { AppHeader } from '~/components/home/AppHeader'
import { RequireAuth } from '~/components/RequireAuth'

// Shared chrome for the auth-gated settings pages (Account, API keys): the site
// header, a centred column, a back-to-workspace link, and a title/description.
// The body is wrapped in <ClientOnly> + <RequireAuth> so a signed-out visitor is
// redirected and the session check never runs during SSR.
export function SettingsLayout({
  title,
  description,
  children,
}: {
  title: string
  description?: string
  children: ReactNode
}) {
  return (
    <div className="flex min-h-screen flex-col text-foreground">
      <AppHeader />
      <main className="flex-1">
        <div className="mx-auto flex w-full max-w-3xl flex-col gap-8 px-6 py-10">
          <div>
            <Link
              to="/"
              className="inline-flex items-center gap-1.5 text-sm text-muted-foreground transition-colors hover:text-foreground"
            >
              <ArrowLeft className="size-3.5" />
              Back to workspace
            </Link>
            <h1 className="mt-3 text-2xl font-semibold tracking-tight">{title}</h1>
            {description && <p className="mt-1.5 text-sm text-muted-foreground">{description}</p>}
          </div>

          <ClientOnly fallback={<div className="h-72 rounded-xl border border-border/60 bg-muted/20" />}>
            <RequireAuth>{children}</RequireAuth>
          </ClientOnly>
        </div>
      </main>
    </div>
  )
}
