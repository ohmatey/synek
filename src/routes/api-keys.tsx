import { createFileRoute } from '@tanstack/react-router'
import { SettingsLayout } from '~/components/account/SettingsLayout'
import { ApiKeysPanel } from '~/components/account/ApiKeysPanel'

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
      description="Create keys and connect your MCP client to build timelines."
    >
      <ApiKeysPanel />
    </SettingsLayout>
  )
}
