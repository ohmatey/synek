import { createFileRoute } from '@tanstack/react-router'
import { z } from 'zod'
import { AuthScreen } from '~/components/home/AuthScreen'
import { parseSignupAttribution } from '~/lib/posthog/attribution'

// `?ref=story&slug=<slug>` carries shared-story attribution from a public /s/$slug
// "Make your own" CTA, so the resulting signup can be joined back to the share that
// drove it (M.4 viral loop). Optional + `.catch` — a missing/garbage ref degrades to
// a plain direct signup, never a 404.
const searchSchema = z.object({
  ref: z.string().optional().catch(undefined),
  slug: z.string().optional().catch(undefined),
})

export const Route = createFileRoute('/signup')({
  validateSearch: searchSchema,
  head: () => ({
    meta: [
      { title: 'Create your account · Synek' },
      { name: 'robots', content: 'noindex, nofollow' },
    ],
  }),
  component: SignupPage,
})

function SignupPage() {
  const search = Route.useSearch()
  return <AuthScreen mode="signup" attribution={parseSignupAttribution(search)} />
}
