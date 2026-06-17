import { createFileRoute, redirect } from '@tanstack/react-router'
import { z } from 'zod'

// The workspace moved to the root `/` (Synek is a pure app — no landing page).
// This route is kept only as a redirect so old `/projects` links/bookmarks still
// resolve; it preserves the `?project=<slug>` scope on the way through.
const searchSchema = z.object({
  project: z.string().optional().catch(undefined),
})

export const Route = createFileRoute('/projects')({
  validateSearch: searchSchema,
  beforeLoad: ({ search }) => {
    throw redirect({ to: '/', search, replace: true })
  },
})
