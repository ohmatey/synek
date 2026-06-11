import { useQuery } from '@tanstack/react-query'
import { Link } from '@tanstack/react-router'
import { Tooltip, TooltipContent, TooltipTrigger } from '~/components/ui/tooltip'
import { cn } from '~/lib/utils'
import { floatChip } from './chrome'

// At-a-glance MCP connectivity: a single status dot (no label). It polls
// /api/health so the user can see whether the app server — and therefore the MCP
// endpoint their client writes to — is reachable. The opaque connection failure
// (a write that silently can't reach the server) was the first friction point;
// this makes that state visible. Hover for a description; when offline the
// tooltip explains the problem and links to the API keys / connection page.
export function McpStatusChip() {
  const { data, isError, isLoading } = useQuery({
    queryKey: ['health'],
    queryFn: async () => {
      const res = await fetch('/api/health', { cache: 'no-store' })
      if (!res.ok) throw new Error('offline')
      return (await res.json()) as { ok: boolean }
    },
    refetchInterval: 10_000,
    retry: false,
    staleTime: 5_000,
  })

  const status = isLoading ? 'checking' : isError || !data?.ok ? 'offline' : 'ready'
  const aria =
    status === 'ready'
      ? 'MCP server reachable'
      : status === 'offline'
        ? 'MCP server unreachable'
        : 'Checking MCP server'

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span
          className={cn(
            floatChip,
            'grid size-8 cursor-default place-items-center outline-none focus-visible:ring-2 focus-visible:ring-ring/50',
          )}
          tabIndex={0}
          role="status"
          aria-label={aria}
          data-testid="mcp-status"
          data-status={status}
        >
          <span
            className={cn(
              'size-2.5 rounded-full',
              status === 'ready' && 'bg-emerald-500',
              status === 'offline' && 'animate-pulse bg-red-500',
              status === 'checking' && 'bg-muted-foreground/40',
            )}
            aria-hidden
          />
        </span>
      </TooltipTrigger>
      <TooltipContent side="bottom" className="max-w-64 text-left">
        {status === 'ready' && (
          <span>MCP server reachable — your client can build this timeline.</span>
        )}
        {status === 'checking' && <span>Checking the MCP server…</span>}
        {status === 'offline' && (
          <span className="flex flex-col gap-1.5">
            <span className="font-medium">Not connected</span>
            <span className="opacity-90">
              The app server is unreachable, so your MCP client’s writes will fail. Make sure it’s
              running and connected with an API key.
            </span>
            <Link
              to="/api-keys"
              className="font-medium underline underline-offset-2 hover:opacity-90"
            >
              Set up the connection →
            </Link>
          </span>
        )}
      </TooltipContent>
    </Tooltip>
  )
}
