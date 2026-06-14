import { createFileRoute } from '@tanstack/react-router'
import { ClientOnly } from '@synek/ui'
import { SettingsLayout } from '~/components/account/SettingsLayout'
import { ApiKeysPanel } from '~/components/account/ApiKeysPanel'
import { AgentKeyCard } from '~/components/account/AgentKeyCard'

export const Route = createFileRoute('/api-keys')({
  head: () => ({
    meta: [{ title: 'API keys · Synek' }, { name: 'robots', content: 'noindex, nofollow' }],
  }),
  component: ApiKeysPage,
})

function ApiKeysPage() {
  return (
    <SettingsLayout
      title="API keys"
      description="Connect your own MCP client, or add an OpenRouter key to run prompts in-app."
    >
      <div className="flex flex-col gap-6">
        <ApiKeysPanel />
        {/* Reads per-user settings — client-only to avoid an SSR session fetch. */}
        <ClientOnly>
          <AgentKeyCard />
        </ClientOnly>
      </div>
    </SettingsLayout>
  )
}
