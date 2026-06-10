import { CopyButton } from '~/components/home/CopyButton'

// First-run onboarding shown on an empty canvas. Synek has no in-app AI, so the
// empty state IS the onboarding: it teaches the MCP loop and hands over a
// copy-ready client config pointing at this server.
export function CanvasEmpty() {
  const origin = typeof window !== 'undefined' ? window.location.origin : 'http://localhost:3001'
  const mcpUrl = `${origin}/api/mcp`
  const config = JSON.stringify(
    { mcpServers: { synek: { type: 'http', url: mcpUrl, headers: { Authorization: 'Bearer YOUR_TOKEN' } } } },
    null,
    2,
  )

  const steps = [
    { n: 1, text: 'Connect Claude (Desktop or Code) to this Synek MCP server with the config below.' },
    { n: 2, text: 'Ask it to build a timeline — it writes nodes and edges through the apply_patch tool.' },
    { n: 3, text: 'Watch them appear here, live. This canvas is the viewer; your MCP client is the author.' },
  ]

  return (
    <div className="pointer-events-auto mt-16 w-[min(92vw,540px)] rounded-xl border border-border bg-background/90 p-5 text-left shadow-lg backdrop-blur">
      <h2 className="text-base font-semibold text-foreground">This canvas is built by your MCP client</h2>
      <p className="mt-1 text-sm text-muted-foreground">
        Synek holds no AI of its own — connect your own Claude and it builds the timeline for you.
      </p>

      <ol className="mt-4 flex flex-col gap-2.5">
        {steps.map((s) => (
          <li key={s.n} className="flex items-start gap-2.5">
            <span className="mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-full bg-primary/10 text-[11px] font-bold text-primary">
              {s.n}
            </span>
            <span className="text-sm leading-snug text-foreground/90">{s.text}</span>
          </li>
        ))}
      </ol>

      <div className="mt-4 rounded-lg border border-border bg-muted/40">
        <div className="flex items-center justify-between border-b border-border px-3 py-1.5">
          <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">MCP config</span>
          <CopyButton text={config} label="Copy" size="sm" variant="ghost" className="h-7 px-2 text-xs" />
        </div>
        <pre className="overflow-x-auto px-3 py-2.5 text-[11px] leading-relaxed text-foreground/80">
          <code>{config}</code>
        </pre>
      </div>

      <p className="mt-3 flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
        Mint <code className="rounded bg-muted px-1 py-0.5 font-mono text-foreground/80">YOUR_TOKEN</code> by running
        <code className="rounded bg-muted px-1 py-0.5 font-mono text-foreground/80">bun run issue:key</code>
        <CopyButton text="bun run issue:key" size="sm" variant="ghost" className="h-6 px-1.5" />
      </p>
    </div>
  )
}
