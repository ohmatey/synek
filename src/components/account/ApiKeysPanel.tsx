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
import { KeysPanel } from '~/components/home/KeysPanel'
import { ConnectGuide } from '~/components/home/ConnectGuide'

// API keys + MCP connection instructions, relocated from the workspace home.
// KeysPanel mints/lists the user's keys (and a show-once "Default" on first
// visit); the freshly created secret is handed to ConnectGuide so the connect
// commands are pre-filled with a real key, just once.
export function ApiKeysPanel() {
  const [freshKey, setFreshKey] = useState<string | null>(null)

  return (
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
  )
}
