import { useEffect, useState } from 'react'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '~/components/ui/tabs'
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
        <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground sm:w-20">
          Endpoint
        </span>
        <code
          data-testid="mcp-endpoint"
          className="flex-1 break-all rounded-md border border-border bg-background px-3 py-2 font-mono text-xs text-foreground"
        >
          {url}
        </code>
        <CopyButton text={url} variant="outline" />
      </div>

      {!apiKey && (
        <p className="text-xs text-muted-foreground">
          Create a key above — it’ll be filled into the commands below automatically (just this
          once).
        </p>
      )}

      <Tabs defaultValue="code">
        <TabsList>
          <TabsTrigger value="code">Claude Code</TabsTrigger>
          <TabsTrigger value="desktop">Claude Desktop</TabsTrigger>
          <TabsTrigger value="skills">Plugin &amp; skills</TabsTrigger>
        </TabsList>

        <TabsContent value="code" className="mt-4">
          <CodeBlock code={claudeCode} />
        </TabsContent>

        <TabsContent value="desktop" className="mt-4 flex flex-col gap-2">
          <p className="text-xs text-muted-foreground">
            Add to <code className="font-mono">claude_desktop_config.json</code> (bridges the HTTP
            endpoint over stdio), then restart Desktop.
          </p>
          <CodeBlock code={desktopJson} />
        </TabsContent>

        <TabsContent value="skills" className="mt-4 flex flex-col gap-2">
          <p className="text-xs text-muted-foreground">
            Install the <strong className="text-foreground">Synek plugin</strong> for skills that
            teach your client to build great timelines (mapping a domain, deepening, sourcing) and to
            connect/troubleshoot:
          </p>
          <CodeBlock code={'/plugin marketplace add ohmatey/synek-plugin\n/plugin install synek'} />
          <p className="text-xs text-muted-foreground">
            Then just ask: <em>“map the history of observability tooling”</em> and watch the canvas
            fill in.
          </p>
        </TabsContent>
      </Tabs>
    </div>
  )
}
