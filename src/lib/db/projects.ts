import { and, desc, eq } from 'drizzle-orm'
import { db } from './index'
import { projects, type ProjectRow } from './schema'
import type { ProjectKind, ProjectWorld, TimelineTheme } from '~/lib/domain/types'

// --- Projects: the top-level owned container (ADR 0002) -------------------
// CRUD mirrors the timeline CRUD in graph.ts EXACTLY: the db layer takes ids and
// trusts its guarded caller (server fns via requireUser, MCP via ctx.ownerId).
// Owner-scoped mutations are AND'd on ownerId so a non-owner's call no-ops.
// Project CRUD is METADATA — never a Patch (D9); the Patch engine knows nothing
// about projects.

// Lightweight ownership view of a project (no timeline/resource payload), the
// project-level companion to TimelineMeta. `theme` drives timeline theme
// inheritance (timeline.theme ?? project.theme ?? defaults — resolved at read).
export type ProjectMeta = {
  id: string
  slug: string
  title: string
  ownerId: string | null
  kind: ProjectKind
  theme: TimelineTheme | null
}

// Slugify a title the same way the story path does (db/stories.ts) so project
// URLs read consistently with story URLs.
const slugify = (s: string): string =>
  s
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60) || 'project'

// `projects.slug` is global-unique (D6). Slugify the title, then dedupe against
// the table with a numeric suffix on collision — the same "two users both make
// 'My first project' → my-first-project / my-first-project-2" the ADR describes.
function uniqueSlug(title: string): string {
  const base = slugify(title)
  let candidate = base
  let n = 1
  // Bounded probe — global-unique index is the hard guarantee; this just avoids
  // a guaranteed conflict insert.
  while (db.select({ id: projects.id }).from(projects).where(eq(projects.slug, candidate)).get()) {
    n += 1
    candidate = `${base}-${n}`
  }
  return candidate
}

// A single owner's projects, newest first (the home-list query).
export function listProjects(ownerId: string): ProjectRow[] {
  return db
    .select()
    .from(projects)
    .where(eq(projects.ownerId, ownerId))
    .orderBy(desc(projects.createdAt))
    .all()
}

// Create a project owned by `ownerId`. Slug is slugified-from-title + deduped.
// Slice 1 only ever writes kind='nonfiction' (the column default); the param is
// here so P4 (fiction) is additive.
export function createProject(
  title: string,
  ownerId: string,
  opts: { kind?: ProjectKind; description?: string | null; theme?: TimelineTheme | null } = {},
): ProjectRow {
  return db
    .insert(projects)
    .values({
      title,
      ownerId,
      slug: uniqueSlug(title),
      kind: opts.kind ?? 'nonfiction',
      description: opts.description ?? null,
      theme: opts.theme ?? null,
    })
    .returning()
    .get()
}

// One project row by id, or null. NOT owner-scoped — callers own-check via the
// returned ownerId (mirrors getTimelineMeta: the guard is the caller's job).
export function getProject(id: string): ProjectRow | null {
  return db.select().from(projects).where(eq(projects.id, id)).get() ?? null
}

// One project by its global-unique slug (D6), owner-scoped: returns the row ONLY
// when it both exists AND belongs to `ownerId`. A foreign or unknown slug returns
// null indistinguishably — the caller (the /p/$slug route) collapses both to the
// same redirect so existence never leaks across owners. AND'ing ownerId in the
// query (not a fetch-then-check) keeps the boundary in one place.
export function getProjectBySlug(slug: string, ownerId: string): ProjectRow | null {
  return (
    db
      .select()
      .from(projects)
      .where(and(eq(projects.slug, slug), eq(projects.ownerId, ownerId)))
      .get() ?? null
  )
}

// Ownership/theme metadata for one project, or null if it doesn't exist.
export function getProjectMeta(id: string): ProjectMeta | null {
  const row = db
    .select({
      id: projects.id,
      slug: projects.slug,
      title: projects.title,
      ownerId: projects.ownerId,
      kind: projects.kind,
      theme: projects.theme,
    })
    .from(projects)
    .where(eq(projects.id, id))
    .get()
  return row ?? null
}

// Owner-scoped partial update of a project's editable metadata. A non-owner's
// call no-ops (0 rows matched). Pass only the fields you want to change; theme
// accepts null to clear it back to the brand default.
export function updateProject(
  id: string,
  ownerId: string,
  patch: {
    title?: string
    description?: string | null
    kind?: ProjectKind
    world?: ProjectWorld | null
    brandRef?: string | null
    theme?: TimelineTheme | null
  },
): void {
  const set: Record<string, unknown> = { updatedAt: new Date() }
  if (patch.title !== undefined) set.title = patch.title
  if (patch.description !== undefined) set.description = patch.description
  if (patch.kind !== undefined) set.kind = patch.kind
  if (patch.world !== undefined) set.world = patch.world
  if (patch.brandRef !== undefined) set.brandRef = patch.brandRef
  if (patch.theme !== undefined) set.theme = patch.theme
  db.update(projects)
    .set(set)
    .where(and(eq(projects.id, id), eq(projects.ownerId, ownerId)))
    .run()
}

// Cascades to the project's timelines (and, by their existing cascades, those
// timelines' nodes/edges/patches/stories) and its resources (D9 destructive
// admin semantics). Owner-scoped: a non-owner's call no-ops.
export function deleteProject(id: string, ownerId: string): void {
  db.delete(projects).where(and(eq(projects.id, id), eq(projects.ownerId, ownerId))).run()
}

// The owner's default project id — the runtime companion to the migration-0020
// backfill, so a fresh signup (no migration backfill ran for them) still gets a
// project, and createTimeline always has a project to attach to. Returns the
// owner's newest existing project, else creates "My first project" (matching the
// migration's default title) and returns its id.
//
// NOTE: idempotent in steady state (returns the existing one), but if called
// concurrently for an owner with NO project it could create two — acceptable for
// slice 1 (one primary writer at a time; the backfill already seeds upgraders).
export function ensureDefaultProject(ownerId: string): string {
  const existing = db
    .select({ id: projects.id })
    .from(projects)
    .where(eq(projects.ownerId, ownerId))
    .orderBy(desc(projects.createdAt))
    .get()
  if (existing) return existing.id
  return createProject('My first project', ownerId).id
}

// The shared owner guard for projects — a project id must exist and belong to
// this owner, else a tool error. Mirror of makeRequireOwned (registry.ts) one
// level up. ownerId stays the ONLY security boundary; this is the same check
// applied to the container.
export function makeRequireOwnedProject(ownerId: string) {
  return (projectId: string) => {
    const meta = getProjectMeta(projectId)
    if (!meta || meta.ownerId !== ownerId) {
      throw new Error(`project "${projectId}" not found`)
    }
  }
}
