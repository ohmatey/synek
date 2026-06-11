import { createFileRoute } from '@tanstack/react-router'
import { SettingsLayout } from '~/components/account/SettingsLayout'
import { AccountPanel } from '~/components/account/AccountPanel'

export const Route = createFileRoute('/account')({
  head: () => ({
    meta: [{ title: 'Account · Synek' }, { name: 'robots', content: 'noindex, nofollow' }],
  }),
  component: AccountPage,
})

function AccountPage() {
  return (
    <SettingsLayout title="Account" description="Manage your profile and session.">
      <AccountPanel />
    </SettingsLayout>
  )
}
