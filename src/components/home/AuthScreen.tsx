import { useEffect } from 'react'
import { Link, useNavigate } from '@tanstack/react-router'
import { ArrowLeft } from 'lucide-react'
import { ClientOnly } from '@synek/ui'
import { Skeleton } from '~/components/ui/skeleton'
import { useSession } from '~/lib/auth/client'
import { AuthForms } from './AuthForms'

type Mode = 'signin' | 'signup'

// Already signed in? Bounce to the workspace.
function RedirectIfAuthed() {
  const navigate = useNavigate()
  const { data: session } = useSession()
  useEffect(() => {
    if (session?.user) void navigate({ to: '/', replace: true })
  }, [session, navigate])
  return null
}

function AuthCard({ mode }: { mode: Mode }) {
  const navigate = useNavigate()
  return (
    <>
      <RedirectIfAuthed />
      <AuthForms initialMode={mode} onAuthed={() => void navigate({ to: '/' })} />
    </>
  )
}

export function AuthScreen({ mode }: { mode: Mode }) {
  return (
    <div className="relative flex min-h-screen flex-col overflow-hidden text-foreground">
      <div className="lp-aurora">
        <span />
        <span />
        <span />
      </div>
      <div className="lp-grid" />

      <header className="relative z-10 px-6 py-5">
        <Link
          to="/"
          className="inline-flex items-center gap-2.5 text-sm font-semibold tracking-tight transition-colors hover:text-primary"
        >
          <span className="grid size-7 place-items-center rounded-lg bg-gradient-to-br from-primary to-influence shadow-sm ring-1 ring-inset ring-white/10">
            <img src="/favicon.svg" alt="" width={16} height={16} className="opacity-95" />
          </span>
          Synek
        </Link>
      </header>

      <main className="relative z-10 grid flex-1 place-items-center px-6 pb-16">
        <div className="w-full max-w-md">
          <ClientOnly
            fallback={<Skeleton className="h-[420px] w-full rounded-xl border border-border/60" />}
          >
            <AuthCard mode={mode} />
          </ClientOnly>
          <p className="mt-6 text-center text-sm text-muted-foreground">
            <Link to="/" className="inline-flex items-center gap-1.5 hover:text-foreground">
              <ArrowLeft className="size-3.5" />
              Back to home
            </Link>
          </p>
        </div>
      </main>
    </div>
  )
}
