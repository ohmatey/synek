import { useState } from 'react'
import { Plug } from 'lucide-react'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '~/components/ui/card'
import { Separator } from '~/components/ui/separator'
import { useSession } from '~/lib/auth/client'
import { TimelinesSection } from './TimelinesSection'
import { KeysPanel } from './KeysPanel'
import { ConnectGuide } from './ConnectGuide'

export function SignedIn() {
  const { data: session } = useSession()
  const [freshKey, setFreshKey] = useState<string | null>(null)
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

      <TimelinesSection />

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <span className="grid size-7 place-items-center rounded-md border border-border bg-background text-primary">
              <Plug className="size-4" />
            </span>
            Connect an MCP client
          </CardTitle>
          <CardDescription>
            Point your client (Claude Desktop, Claude Code) at the endpoint with an API key, then ask
            it to build and edit timelines. The app itself has no AI — your client brings the model.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-6">
          <KeysPanel onFreshKey={setFreshKey} />
          <Separator />
          <ConnectGuide apiKey={freshKey} />
        </CardContent>
      </Card>
    </div>
  )
}
