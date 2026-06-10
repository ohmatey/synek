import { useQuery } from '@tanstack/react-query'
import { cn } from '~/lib/utils'
import { floatChip } from './chrome'

// Polls /api/health so the user can see at a glance whether the app server — and
// therefore the MCP endpoint their client writes to — is reachable. The opaque
// connection failure (a write that silently can't reach the server) was the first
// friction point when building a timeline; this makes that state visible.
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
  const label = status === 'ready' ? 'MCP ready' : status === 'offline' ? 'Offline' : 'Checking…'
  const title =
    status === 'offline'
      ? 'App server unreachable — your MCP client’s writes will fail until it’s back'
      : 'App server reachable — your MCP client can build this timeline'

  return (
    <div
      className={cn(floatChip, 'inline-flex h-8 items-center gap-1.5 px-2.5 text-xs')}
      title={title}
      data-testid="mcp-status"
      data-status={status}
    >
      <span
        className={cn(
          'size-2 rounded-full',
          status === 'ready' && 'bg-emerald-500',
          status === 'offline' && 'animate-pulse bg-red-500',
          status === 'checking' && 'bg-muted-foreground/40',
        )}
        aria-hidden
      />
      <span className="text-muted-foreground">{label}</span>
    </div>
  )
}
