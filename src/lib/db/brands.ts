import { and, desc, eq } from 'drizzle-orm'
import { db } from './index'
import { brands, projects, type BrandRow } from './schema'
import type { BrandKit } from '~/lib/domain/brand'

// --- Brands: a LOCAL, owner-authored brand kit (stories-first slice 2) ------
// CRUD mirrors projects.ts EXACTLY: the db layer takes ids and trusts its guarded
// caller, with owner-scoped mutations AND'd on ownerId so a non-owner's call
// no-ops. The kit blob is whole-object replace-on-write — NOT a Patch. Slug is
// immutable across rename (the handle stays stable). LEAN: local authoring only —
// no Realscript fetch, no sync, no MCP brand tools (all LATER).

// Slugify a name the same way projects/stories do, so brand handles read
// consistently with the rest of the app.
const slugify = (s: string): string =>
  s
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60) || 'brand'

// `brands.slug` is global-unique. Slugify the name, then dedupe against the table
// with a numeric suffix on collision (the same probe projects.ts uses).
function uniqueSlug(name: string): string {
  const base = slugify(name)
  let candidate = base
  let n = 1
  while (db.select({ id: brands.id }).from(brands).where(eq(brands.slug, candidate)).get()) {
    n += 1
    candidate = `${base}-${n}`
  }
  return candidate
}

// A single owner's brands, newest first (the brand-list query).
export function listBrands(ownerId: string): BrandRow[] {
  return db
    .select()
    .from(brands)
    .where(eq(brands.ownerId, ownerId))
    .orderBy(desc(brands.createdAt))
    .all()
}

// Create a brand owned by `ownerId`. Slug is slugified-from-name + deduped. The
// kit is optional — a fresh brand is a named shell the editor fills in later.
export function createBrand(
  ownerId: string,
  opts: { name: string; kit?: BrandKit | null },
): BrandRow {
  return db
    .insert(brands)
    .values({
      ownerId,
      name: opts.name,
      slug: uniqueSlug(opts.name),
      kit: opts.kit ?? null,
    })
    .returning()
    .get()
}

// One brand by id, OWNER-SCOPED: returns the row ONLY when it exists AND belongs
// to `ownerId`, else null (fail-closed — never leak another owner's brand). AND'ing
// ownerId in the query keeps the boundary in one place.
export function getBrand(id: string, ownerId: string): BrandRow | null {
  return (
    db
      .select()
      .from(brands)
      .where(and(eq(brands.id, id), eq(brands.ownerId, ownerId)))
      .get() ?? null
  )
}

// Owner-scoped partial update. A non-owner's call no-ops (0 rows matched). Pass
// only the fields to change; `kit` accepts null to clear it. The slug is NEVER
// updated here (immutable handle) — only name + kit are editable.
export function updateBrand(
  id: string,
  ownerId: string,
  patch: { name?: string; kit?: BrandKit | null },
): void {
  const set: Record<string, unknown> = { updatedAt: new Date() }
  if (patch.name !== undefined) set.name = patch.name
  if (patch.kit !== undefined) set.kit = patch.kit
  db.update(brands)
    .set(set)
    .where(and(eq(brands.id, id), eq(brands.ownerId, ownerId)))
    .run()
}

// Owner-scoped delete. A non-owner's call no-ops. The FK on projects.brandId is
// ON DELETE SET NULL, so any project this brand dressed survives — its link just
// clears (the project is never destroyed by a brand delete).
export function deleteBrand(id: string, ownerId: string): void {
  db.delete(brands).where(and(eq(brands.id, id), eq(brands.ownerId, ownerId))).run()
}

// The shared owner guard for brands — a brand id must exist and belong to this
// owner, else throw. Mirror of makeRequireOwnedProject; ownerId stays the ONLY
// security boundary.
export function makeRequireOwnedBrand(ownerId: string) {
  return (brandId: string) => {
    const row = db
      .select({ ownerId: brands.ownerId })
      .from(brands)
      .where(eq(brands.id, brandId))
      .get()
    if (!row || row.ownerId !== ownerId) {
      throw new Error(`brand "${brandId}" not found`)
    }
  }
}

// Link (or unlink, with null) a project to a brand. DOUBLE owner-check, fail-closed:
//   1. the BRAND must be the caller's — requireOwnedBrand throws otherwise (rejects
//      linking a foreign / nonexistent brand). Skipped when unlinking (brandId null).
//   2. the PROJECT must be the caller's — the update AND's ownerId so a non-owner's
//      call no-ops (rejects re-branding a foreign project).
// Passing null clears the link. Mirrors moveTimelineToProject's two-sided guard.
export function setProjectBrand(projectId: string, ownerId: string, brandId: string | null): void {
  if (brandId !== null) {
    // (1) brand own-check — throws for a foreign/missing brand.
    makeRequireOwnedBrand(ownerId)(brandId)
  }
  // (2) project own-check is enforced by the ownerId predicate (a foreign project
  // matches 0 rows and the call no-ops).
  db.update(projects)
    .set({ brandId, updatedAt: new Date() })
    .where(and(eq(projects.id, projectId), eq(projects.ownerId, ownerId)))
    .run()
}
