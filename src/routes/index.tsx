import { createFileRoute } from '@tanstack/react-router'
import { z } from 'zod'
import { ProjectsWorkspace } from '~/components/home/ProjectsWorkspace'

// The root `/` IS the signed-in workspace — Synek is a pure app, not a marketing
// site, so there is no landing page and no public discovery feed here. Per-story
// sharing still lives at the public `/s/$slug` page; only the cross-user Explore
// feed was removed (see ADR 0005).
//
// `?project=<slug>` re-scopes the page to one project (its own hero + rows);
// absent, it's the projects-list page. Optional + `.catch` for a SOFT fallback —
// an unknown/foreign/garbage slug degrades to the list, never a 404. The /p/$slug
// handle resolves onto this param.
const searchSchema = z.object({
  project: z.string().optional().catch(undefined),
})

export const Route = createFileRoute('/')({
  validateSearch: searchSchema,
  head: () => ({
    meta: [{ title: 'Synek' }, { name: 'robots', content: 'noindex, nofollow' }],
  }),
  component: ProjectsWorkspace,
})
