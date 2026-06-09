import { createFileRoute } from '@tanstack/react-router'
import { AuthScreen } from '~/components/home/AuthScreen'

export const Route = createFileRoute('/login')({
  head: () => ({
    meta: [
      { title: 'Sign in · Synek' },
      { name: 'robots', content: 'noindex, nofollow' },
    ],
  }),
  component: () => <AuthScreen mode="signin" />,
})
