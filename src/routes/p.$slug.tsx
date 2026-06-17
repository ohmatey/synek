import { createFileRoute, redirect } from '@tanstack/react-router'
import { getProjectBySlug } from '~/lib/server/projects'

// /p/$slug — the slug-addressable project handle the MCP create_project/get_project
// tools hand back (`${BASE_URL}/p/${slug}`, registry.ts). The project VIEW is the
// workspace at the root `/` scoped via `?project=<slug>`; this route is a thin
// owner-scoped RESOLVER that bounces a project slug onto that param.
//
// Fail-closed, no cross-owner reveal: getProjectBySlug is owner-scoped, so a
// missing slug, a slug owned by someone else, and a signed-out visitor all
// resolve to null and collapse to the SAME redirect to `/` (the bare workspace,
// which soft-falls-back to the list). Only a slug the caller actually owns
// redirects to `/?project=<slug>`. The two negative paths are
// indistinguishable, so existence never leaks. requireUser() inside the server fn
// throws for a signed-out visitor; we treat that throw like "not found".
export const Route = createFileRoute('/p/$slug')({
  loader: async ({ params }) => {
    let project: Awaited<ReturnType<typeof getProjectBySlug>> = null
    try {
      project = await getProjectBySlug({ data: params.slug })
    } catch {
      // Unauthenticated (requireUser threw) or any resolution error → fail-closed.
      project = null
    }
    if (project) {
      throw redirect({ to: '/', search: { project: project.slug }, replace: true })
    }
    // Missing / foreign / signed-out — bounce to the bare workspace (no reveal).
    throw redirect({ to: '/', replace: true })
  },
})
