import { createFileRoute, Link } from '@tanstack/react-router'
import { createServerFn } from '@tanstack/react-start'
import { z } from 'zod'
import { BookOpenText } from 'lucide-react'
import { unfollowByToken } from '~/lib/db/subscriptions'

// PUBLIC, no-login unsubscribe (local-160). Each new-chapter email carries a per-
// subscription token; hitting this link removes that follow. GET-driven (email links
// can't POST) — the token is the whole authorization, so no session is needed and none
// is consulted. Idempotent: an already-used or bogus token renders the same calm
// "you're unsubscribed" state (never leaks whether the token existed).
const unsubscribeByToken = createServerFn({ method: 'POST' })
  .inputValidator((token: string) => z.string().parse(token))
  .handler(async ({ data: token }): Promise<{ ok: true }> => {
    unfollowByToken(token)
    return { ok: true as const }
  })

const searchSchema = z.object({ token: z.string().optional().catch(undefined) })

export const Route = createFileRoute('/unsubscribe')({
  validateSearch: searchSchema,
  loaderDeps: ({ search: { token } }) => ({ token }),
  loader: async ({ deps }) => {
    if (deps.token) await unsubscribeByToken({ data: deps.token })
    return { done: !!deps.token }
  },
  head: () => ({ meta: [{ title: 'Unsubscribed · Synek' }, { name: 'robots', content: 'noindex, nofollow' }] }),
  component: UnsubscribePage,
})

function UnsubscribePage() {
  const { done } = Route.useLoaderData()
  return (
    <div className="public-story-missing">
      <div className="psm-card">
        <BookOpenText className="psm-icon" aria-hidden />
        <h1>{done ? 'You’re unsubscribed' : 'Nothing to unsubscribe'}</h1>
        <p>
          {done
            ? 'You won’t get any more chapter emails for this series. You can follow it again anytime from its season page.'
            : 'This link is missing its token, or it was already used. No change was made.'}
        </p>
        <Link to="/" className="psr-cta">
          Go to Synek
        </Link>
      </div>
    </div>
  )
}
