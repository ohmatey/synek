import { Link } from '@tanstack/react-router'
import { useQuery } from '@tanstack/react-query'
import { ArrowRight, KeyRound } from 'lucide-react'
import { useSession } from '~/lib/auth/client'
import { listApiKeys } from '~/lib/server/api-keys'
import { TimelinesSection } from './TimelinesSection'

// Shown on the workspace home once the user has no keys: a compact nudge toward
// the API keys page (where the keys + MCP connection instructions now live).
// listApiKeys never auto-mints, so this reflects "nothing created yet".
function ConnectCta() {
  const { data: keys } = useQuery({ queryKey: ['api-keys'], queryFn: () => listApiKeys() })
  if (!keys || keys.length > 0) return null

  return (
    <Link
      to="/api-keys"
      className="group flex items-center gap-3 rounded-xl border border-primary/30 bg-primary/5 px-4 py-3.5 transition-colors hover:bg-primary/10"
    >
      <span className="grid size-9 shrink-0 place-items-center rounded-lg border border-border bg-background text-primary">
        <KeyRound className="size-4" />
      </span>
      <span className="flex min-w-0 flex-1 flex-col">
        <span className="text-sm font-medium">Create an API key to connect your MCP client</span>
        <span className="text-xs text-muted-foreground">
          Your client (Claude Desktop, Claude Code) brings the model and builds your timelines.
        </span>
      </span>
      <ArrowRight className="size-4 shrink-0 text-muted-foreground transition-transform group-hover:translate-x-0.5" />
    </Link>
  )
}

export function SignedIn() {
  const { data: session } = useSession()
  const name = session?.user?.name?.split(' ')[0] || session?.user?.email?.split('@')[0]

  return (
    <div className="mx-auto flex w-full max-w-6xl flex-col gap-8 px-6 py-10">
      <header>
        <span className="text-xs font-semibold uppercase tracking-[0.18em] text-primary">
          Workspace
        </span>
        <h1 className="mt-2 text-2xl font-semibold tracking-tight sm:text-3xl">
          {name ? `Welcome back, ${name}` : 'Welcome back'}
        </h1>
        <p className="mt-1.5 text-sm text-muted-foreground">
          Create a timeline, then let your MCP client build it out.
        </p>
      </header>

      <ConnectCta />

      <TimelinesSection />
    </div>
  )
}
