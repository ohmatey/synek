import { createServerFn } from '@tanstack/react-start'
import { z } from 'zod'
import {
  listBrands as dbListBrands,
  createBrand as dbCreateBrand,
  getBrand as dbGetBrand,
  updateBrand as dbUpdateBrand,
  deleteBrand as dbDeleteBrand,
  setProjectBrand as dbSetProjectBrand,
} from '~/lib/db/brands'
import { getProject as dbGetProject } from '~/lib/db/projects'
import { requireUser } from '~/lib/auth/session'
import { brandKitSchema, type BrandKit } from '~/lib/domain/brand'
import type { BrandRow } from '~/lib/db/schema'

// All brand RPCs are scoped to the signed-in user — you only see and manage your
// own brand kits. Create/rename/edit/delete + project-link are owner-checked in the
// DB layer (a non-owner's mutation no-ops or throws); reads list/own-check on the
// user's id. Mirrors server/projects.ts. LEAN slice 2: local authoring only — no
// Realscript fetch, no sync, no MCP brand tools.

// Lightweight list/row view — kit included (kits are small; the editor needs it on
// open). createdAt/updatedAt as epoch-ms (no Date over the RPC), like other DTOs.
export type BrandSummary = {
  id: string
  slug: string
  name: string
  kit: BrandKit | null
  createdAt: number
  updatedAt: number
}

const toSummary = (b: BrandRow): BrandSummary => ({
  id: b.id,
  slug: b.slug,
  name: b.name,
  kit: b.kit ?? null,
  createdAt: b.createdAt.getTime(),
  updatedAt: b.updatedAt.getTime(),
})

export const listBrands = createServerFn({ method: 'GET' }).handler(async (): Promise<BrandSummary[]> => {
  const user = await requireUser()
  return dbListBrands(user.id).map(toSummary)
})

export const createBrand = createServerFn({ method: 'POST' })
  .inputValidator((d: { name: string }) => z.object({ name: z.string().trim().min(1).max(120) }).parse(d))
  .handler(async ({ data }): Promise<BrandSummary> => {
    const user = await requireUser()
    return toSummary(dbCreateBrand(user.id, { name: data.name }))
  })

// Owner-scoped read of one brand (with its full kit) by id; null when it doesn't
// exist or isn't the caller's (fail-closed — never leak another owner's brand).
export const getBrand = createServerFn({ method: 'GET' })
  .inputValidator((d: string) => z.string().parse(d))
  .handler(async ({ data: id }): Promise<BrandSummary | null> => {
    const user = await requireUser()
    const row = dbGetBrand(id, user.id)
    return row ? toSummary(row) : null
  })

// Owner-only: rename the brand AND/OR replace its kit. The kit is validated by
// brandKitSchema (the SAME contract the data layer + any later MCP tool use); pass
// null to clear it. A non-owner's call no-ops in the db layer.
export const updateBrand = createServerFn({ method: 'POST' })
  .inputValidator((d: { id: string; name?: string; kit?: unknown }) =>
    z
      .object({
        id: z.string(),
        name: z.string().trim().min(1).max(120).optional(),
        // brandKitSchema is the gate — a malformed kit is rejected before write.
        kit: brandKitSchema.nullable().optional(),
      })
      .parse(d),
  )
  .handler(async ({ data }) => {
    const user = await requireUser()
    dbUpdateBrand(data.id, user.id, {
      ...(data.name !== undefined ? { name: data.name } : {}),
      ...(data.kit !== undefined ? { kit: data.kit } : {}),
    })
    return { ok: true as const }
  })

export const deleteBrand = createServerFn({ method: 'POST' })
  .inputValidator((d: string) => z.string().parse(d))
  .handler(async ({ data }) => {
    const user = await requireUser()
    dbDeleteBrand(data, user.id)
    return { ok: true as const }
  })

// Link (or unlink, null) a project to a brand. DOUBLE owner-check, fail-closed: the
// brand must be the caller's (db throws otherwise) and the project must be the
// caller's (the db helper's ownerId predicate no-ops otherwise). Returns the brand
// the project now points at (or null), so the UI can reflect it without a refetch.
export const setProjectBrand = createServerFn({ method: 'POST' })
  .inputValidator((d: { projectId: string; brandId: string | null }) =>
    z.object({ projectId: z.string(), brandId: z.string().nullable() }).parse(d),
  )
  .handler(async ({ data }) => {
    const user = await requireUser()
    dbSetProjectBrand(data.projectId, user.id, data.brandId)
    return { ok: true as const, projectId: data.projectId, brandId: data.brandId }
  })

// Owner-scoped read of the brand a project is currently linked to (its brandId),
// for the link affordance. null when the project isn't the caller's or has no brand.
export const getProjectBrandId = createServerFn({ method: 'GET' })
  .inputValidator((d: string) => z.string().parse(d))
  .handler(async ({ data: projectId }): Promise<string | null> => {
    const user = await requireUser()
    const row = dbGetProject(projectId)
    if (!row || row.ownerId !== user.id) return null
    return row.brandId ?? null
  })
