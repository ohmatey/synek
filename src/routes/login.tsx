import { createFileRoute } from '@tanstack/react-router'
import { AuthScreen } from '~/components/home/AuthScreen'

export const Route = createFileRoute('/login')({
  component: () => <AuthScreen mode="signin" />,
})
