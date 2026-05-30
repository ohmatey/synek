import { useEffect, useState } from 'react'
import { CopyButton } from './CopyButton'
import { CodeBlock } from './CodeBlock'

export function ConnectGuide({ apiKey }: { apiKey: string | null }) {
  const [origin, setOrigin] = useState('')
  useEffect(() => setOrigin(window.location.origin), [])
  const url = `${origin || 'http://localhost:3001'}/api/mcp`
  const key = apiKey ?? '<YOUR_API_KEY>'

  const claudeCode = `claude mcp add --transport http synek ${url} \\\n  --header "Authorization: Bearer ${key}"`
  const desktopJson = JSON.stringify(
    {
      mcpServers: {
        synek: {
          command: 'npx',
          args: ['-y', 'mcp-remote', url, '--header', `Authorization: Bearer ${key}`],
        },
      },
    },
    null,
    2,
  )

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
        <span className="text-xs uppercase tracking-wide text-[var(--color-fg-muted)] sm:w-20">
          Endpoint
        </span>
        <code
          data-testid="mcp-endpoint"
          className="flex-1 break-all rounded bg-[var(--color-bg-base)] px-2 py-1 font-mono text-xs text-[var(--color-fg-primary)] border border-[var(--color-border-default)]"
        >
          {url}
        </code>
        <CopyButton text={url} size="sm" variant="secondary" />
      </div>

      {!apiKey && (
        <p className="text-xs text-[var(--color-fg-muted)]">
          Create a key above — it’ll be filled into the commands below automatically (just this once).
        </p>
      )}

      <Step title="Claude Code">
        <CodeBlock code={claudeCode} />
      </Step>

      <Step title="Claude Desktop">
        <p className="mb-2 text-xs text-[var(--color-fg-muted)]">
          Add to <code className="font-mono">claude_desktop_config.json</code> (bridges the HTTP
          endpoint over stdio), then restart Desktop.
        </p>
        <CodeBlock code={desktopJson} />
      </Step>

      <Step title="Get the skills">
        <p className="mb-2 text-xs text-[var(--color-fg-muted)]">
          Install the <strong className="text-[var(--color-fg-secondary)]">Synek plugin</strong> for
          skills that teach your client to build great timelines (mapping a domain, deepening,
          sourcing) and to connect/troubleshoot:
        </p>
        <CodeBlock code={'/plugin marketplace add ohmatey/synek-plugin\n/plugin install synek'} />
        <p className="mt-2 text-xs text-[var(--color-fg-muted)]">
          Then just ask: <em>“map the history of observability tooling”</em> and watch the canvas
          fill in.
        </p>
      </Step>
    </div>
  )
}

function Step({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <h4 className="mb-2 text-sm font-semibold text-[var(--color-fg-primary)]">{title}</h4>
      {children}
    </div>
  )
}
