import { createFileRoute } from '@tanstack/react-router'
import { AuthScreen } from '~/components/home/AuthScreen'

export const Route = createFileRoute('/signup')({
  head: () => ({
    meta: [
      { title: 'Create your account · Synek' },
      { name: 'robots', content: 'noindex, nofollow' },
    ],
  }),
  component: () => <AuthScreen mode="signup" />,
})
