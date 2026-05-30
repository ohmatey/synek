import { useState } from 'react'
import { Card } from '@strata/ui'
import { TimelinesSection } from './TimelinesSection'
import { KeysPanel } from './KeysPanel'
import { ConnectGuide } from './ConnectGuide'

export function SignedIn() {
  const [freshKey, setFreshKey] = useState<string | null>(null)
  return (
    <div className="mx-auto flex w-full max-w-5xl flex-col gap-6 px-6 py-10">
      <TimelinesSection />
      <Card elevation="flat" padding="lg" className="flex flex-col gap-4">
        <div>
          <h2 className="text-sm font-semibold uppercase tracking-wide text-[var(--color-fg-muted)]">
            Connect an MCP client
          </h2>
          <p className="mt-1 text-sm text-[var(--color-fg-secondary)]">
            Point your client (Claude Desktop, Claude Code) at the endpoint with an API key, then
            ask it to build and edit timelines. The app itself has no AI — your client brings the
            model.
          </p>
        </div>
        <KeysPanel onFreshKey={setFreshKey} />
        <ConnectGuide apiKey={freshKey} />
      </Card>
    </div>
  )
}
