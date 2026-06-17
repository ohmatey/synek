import { createServerFn } from '@tanstack/react-start'
import { z } from 'zod'
import {
  listProjects as dbListProjects,
  createProject as dbCreateProject,
  getProject as dbGetProject,
  getProjectBySlug as dbGetProjectBySlug,
  updateProject as dbUpdateProject,
  deleteProject as dbDeleteProject,
  makeRequireOwnedProject,
} from '~/lib/db/projects'
import { moveTimelineToProject as dbMoveTimelineToProject } from '~/lib/db/graph'
import { requireUser } from '~/lib/auth/session'
import { timelineThemeSchema } from '~/lib/domain/theme'
import { brandKitSchema, type BrandKit } from '~/lib/domain/brand'
import type { ProjectRow } from '~/lib/db/schema'
import type { ProjectSummary, TimelineTheme } from '~/lib/domain/types'

// All project RPCs are scoped to the signed-in user — you only see and manage
// your own projects. Create/rename/delete are owner-checked in the DB layer (a
// non-owner's mutation no-ops); reads list/own-check on the user's id. Mirrors
// server/timelines.ts.

const toSummary = (p: ProjectRow): ProjectSummary => ({
  id: p.id,
  slug: p.slug,
  title: p.title,
  description: p.description,
  kind: p.kind,
  createdAt: p.createdAt.getTime(),
})

export const listProjects = createServerFn({ method: 'GET' }).handler(async (): Promise<ProjectSummary[]> => {
  const user = await requireUser()
  return dbListProjects(user.id).map(toSummary)
})

export const createProject = createServerFn({ method: 'POST' })
  .inputValidator((d: { title: string }) => z.object({ title: z.string().trim().min(1).max(200) }).parse(d))
  .handler(async ({ data }): Promise<ProjectSummary> => {
    const user = await requireUser()
    return toSummary(dbCreateProject(data.title, user.id))
  })

// Owner-scoped read of one project's summary by id; null when it doesn't exist or
// isn't the caller's (fail-closed — never leak another owner's project). Direct
// single-row fetch + own-check on the returned ownerId (no list+find scan).
export const getProject = createServerFn({ method: 'GET' })
  .inputValidator((d: string) => z.string().parse(d))
  .handler(async ({ data: id }): Promise<ProjectSummary | null> => {
    const user = await requireUser()
    const row = dbGetProject(id)
    if (!row || row.ownerId !== user.id) return null
    return toSummary(row)
  })

// Owner-scoped read of one project's summary by SLUG (the URL handle, D6); null
// when it doesn't exist or isn't the caller's. Backs the /p/$slug route, which
// resolves a shared/MCP-returned slug to the home's project filter. Missing and
// foreign slugs both return null indistinguishably (no cross-owner reveal).
export const getProjectBySlug = createServerFn({ method: 'GET' })
  .inputValidator((d: string) => z.string().parse(d))
  .handler(async ({ data: slug }): Promise<ProjectSummary | null> => {
    const user = await requireUser()
    const row = dbGetProjectBySlug(slug, user.id)
    return row ? toSummary(row) : null
  })

export const renameProject = createServerFn({ method: 'POST' })
  .inputValidator((d: { id: string; title: string }) =>
    z.object({ id: z.string(), title: z.string().trim().min(1).max(200) }).parse(d),
  )
  .handler(async ({ data }) => {
    const user = await requireUser()
    dbUpdateProject(data.id, user.id, { title: data.title })
    return { ok: true as const }
  })

export const deleteProject = createServerFn({ method: 'POST' })
  .inputValidator((d: string) => z.string().parse(d))
  .handler(async ({ data }) => {
    const user = await requireUser()
    dbDeleteProject(data, user.id)
    return { ok: true as const }
  })

// Owner-only: REPLACE the project's default theme wholesale (timelines inherit it
// at read time unless they override). Pass null to clear back to the default look.
export const setProjectTheme = createServerFn({ method: 'POST' })
  .inputValidator((d: { id: string; theme: TimelineTheme | null }) =>
    z.object({ id: z.string(), theme: timelineThemeSchema.nullable() }).parse(d),
  )
  .handler(async ({ data }) => {
    const user = await requireUser()
    dbUpdateProject(data.id, user.id, { theme: data.theme })
    return { ok: true as const }
  })

// The project's BUILT-IN branding: its render theme + its brand kit (identity +
// voice), plus the slug/title so a caller given only a projectId (the story dialog)
// can seed a blank kit. Owner-scoped, fail-closed — null when the project isn't the
// caller's. Replaces the former per-account brand-kit library (one kit per project).
export type ProjectBranding = {
  id: string
  slug: string
  title: string
  theme: TimelineTheme | null
  brand: BrandKit | null
}

export const getProjectBranding = createServerFn({ method: 'GET' })
  .inputValidator((d: string) => z.string().parse(d))
  .handler(async ({ data: id }): Promise<ProjectBranding | null> => {
    const user = await requireUser()
    const row = dbGetProject(id)
    if (!row || row.ownerId !== user.id) return null
    return { id: row.id, slug: row.slug, title: row.title, theme: row.theme ?? null, brand: row.brand ?? null }
  })

// Owner-only: REPLACE the project's built-in brand kit. Validated by brandKitSchema
// (the SAME contract the dormant brands table used), so the story "brand costume"
// reads a well-formed kit. Pass null to clear it back to no brand.
export const setProjectBrandKit = createServerFn({ method: 'POST' })
  .inputValidator((d: { id: string; kit: unknown }) =>
    z.object({ id: z.string(), kit: brandKitSchema.nullable() }).parse(d),
  )
  .handler(async ({ data }) => {
    const user = await requireUser()
    dbUpdateProject(data.id, user.id, { brand: data.kit })
    return { ok: true as const }
  })

// Move a timeline to a different project (the move-to-project affordance,
// local-126 — ADR 0002 D9: metadata, NOT a Patch). Lives here (not timelines.ts)
// because it's a project-scoped reassignment. DOUBLE owner-check, fail-closed:
//   1. the TARGET project must be the caller's — requireOwnedProject throws
//      otherwise (rejects moving into a foreign / nonexistent project), and
//   2. the TIMELINE must be the caller's — the db helper AND's ownerId so a
//      non-owner's call no-ops (rejects moving a foreign timeline).
// Stories/entities inherit the timeline, so there's no separate story-move. The
// UI should invalidate the projects + timelines queries (and re-pick the hero)
// after this resolves; the undo toast reverses by calling this again with the
// original projectId (returned below).
export const moveTimelineToProject = createServerFn({ method: 'POST' })
  .inputValidator((d: { timelineId: string; targetProjectId: string }) =>
    z.object({ timelineId: z.string(), targetProjectId: z.string() }).parse(d),
  )
  .handler(async ({ data }) => {
    const user = await requireUser()
    // (1) target-project own-check — throws for a foreign/missing project.
    makeRequireOwnedProject(user.id)(data.targetProjectId)
    // (2) timeline own-check is enforced by the db helper's ownerId predicate.
    dbMoveTimelineToProject(data.timelineId, user.id, data.targetProjectId)
    return { ok: true as const, timelineId: data.timelineId, projectId: data.targetProjectId }
  })
