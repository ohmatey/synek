import { createFileRoute } from '@tanstack/react-router'
import { z } from 'zod'
import { ProjectsWorkspace } from '~/components/home/ProjectsWorkspace'

// The signed-in workspace. `?project=<slug>` re-scopes the page to one project
// (its own hero + rows); absent, it's the projects-list page. Optional + `.catch`
// for a SOFT fallback — an unknown/foreign/garbage slug degrades to the list,
// never a 404. The /p/$slug handle resolves onto this param.
const searchSchema = z.object({
  project: z.string().optional().catch(undefined),
})

export const Route = createFileRoute('/projects')({
  validateSearch: searchSchema,
  head: () => ({
    meta: [{ title: 'Projects · Synek' }, { name: 'robots', content: 'noindex, nofollow' }],
  }),
  component: ProjectsWorkspace,
})
