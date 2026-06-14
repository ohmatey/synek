import { createFileRoute } from '@tanstack/react-router'
import { z } from 'zod'
import { ResetPasswordScreen } from '~/components/home/ResetPasswordScreen'

// The Better Auth reset email links here with a `token`; without one, this is the
// "request a reset" form.
export const Route = createFileRoute('/reset-password')({
  validateSearch: z.object({ token: z.string().optional() }),
  head: () => ({
    meta: [
      { title: 'Reset password · Synek' },
      { name: 'robots', content: 'noindex, nofollow' },
    ],
  }),
  component: RouteComponent,
})

function RouteComponent() {
  const { token } = Route.useSearch()
  return <ResetPasswordScreen token={token} />
}
