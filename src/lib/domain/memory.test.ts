import { describe, expect, it } from 'bun:test'
import {
  MEMORY_LIMITS,
  isEmptyMemory,
  mergeTimelineMemory,
  timelineMemoryUpdateSchema,
  type TimelineMemory,
} from './memory'

// The whole point of the two-region store is that a scheduled keeper and the
// person editing notes in the browser write the same column without eating each
// other's work. These tests pin that down.

describe('mergeTimelineMemory', () => {
  const seeded: TimelineMemory = {
    brief: 'AI tooling a small team can actually ship on.',
    notes: 'Skip embodied robotics.',
    references: [{ title: 'OpenAI API changelog', url: 'https://platform.openai.com/docs/changelog' }],
    cadence: 'weekly (Mon 07:23)',
    coveredThrough: '2026-08-07',
    runs: [{ date: '2026-08-10', summary: '+7 nodes, chapter V' }],
    watching: [{ item: 'Mistral frontier open-weight', firstSeen: '2026-08-10' }],
  }

  it('writes only the keys the patch names', () => {
    const next = mergeTimelineMemory(seeded, { coveredThrough: '2026-08-17' })
    expect(next.coveredThrough).toBe('2026-08-17')
    // Everything else survives untouched.
    expect(next.brief).toBe(seeded.brief)
    expect(next.notes).toBe(seeded.notes)
    expect(next.references).toEqual(seeded.references)
    expect(next.runs).toEqual(seeded.runs)
  })

  it('lets a keeper log a run without clobbering the user notes beside it', () => {
    const next = mergeTimelineMemory(seeded, {
      appendRun: { date: '2026-08-17', summary: 'no new developments' },
      coveredThrough: '2026-08-17',
    })
    expect(next.notes).toBe('Skip embodied robotics.')
    expect(next.brief).toBe(seeded.brief)
    expect(next.references).toEqual(seeded.references)
  })

  it('lets the user edit notes without dropping the run history', () => {
    const next = mergeTimelineMemory(seeded, { notes: 'Skip robotics. Prefer primary changelogs.' })
    expect(next.notes).toBe('Skip robotics. Prefer primary changelogs.')
    expect(next.runs).toEqual(seeded.runs)
    expect(next.coveredThrough).toBe('2026-08-07')
    expect(next.watching).toEqual(seeded.watching)
  })

  it('prepends appendRun newest-first rather than replacing the array', () => {
    const next = mergeTimelineMemory(seeded, {
      appendRun: { date: '2026-08-17', summary: '+2 nodes', patchId: 'p-123' },
    })
    expect(next.runs).toHaveLength(2)
    expect(next.runs?.[0]).toEqual({ date: '2026-08-17', summary: '+2 nodes', patchId: 'p-123' })
    expect(next.runs?.[1]).toEqual({ date: '2026-08-10', summary: '+7 nodes, chapter V' })
  })

  it('trims the run log to the bound, dropping the oldest', () => {
    const runs = Array.from({ length: MEMORY_LIMITS.runs }, (_, i) => ({
      date: '2026-01-01',
      summary: `run ${i}`,
    }))
    const next = mergeTimelineMemory({ runs }, { appendRun: { date: '2026-08-17', summary: 'newest' } })
    expect(next.runs).toHaveLength(MEMORY_LIMITS.runs)
    expect(next.runs?.[0].summary).toBe('newest')
    expect(next.runs?.some((r) => r.summary === `run ${MEMORY_LIMITS.runs - 1}`)).toBe(false)
  })

  it('clears a field on an explicit empty string or empty array', () => {
    const next = mergeTimelineMemory(seeded, { notes: '', references: [] })
    expect(next.notes).toBeUndefined()
    expect(next.references).toBeUndefined()
    // A clear is scoped too: the routine region is untouched.
    expect(next.runs).toEqual(seeded.runs)
  })

  it('builds from nothing when the timeline has no memory yet', () => {
    const next = mergeTimelineMemory(null, { appendRun: { date: '2026-08-17', summary: 'setup' } })
    expect(next.runs).toEqual([{ date: '2026-08-17', summary: 'setup' }])
  })
})

describe('isEmptyMemory', () => {
  it('treats an absent, blank, or empty-array-only record as empty', () => {
    expect(isEmptyMemory({})).toBe(true)
    expect(isEmptyMemory({ notes: '', runs: [] })).toBe(true)
  })

  it('is not empty once anything is stored', () => {
    expect(isEmptyMemory({ notes: 'x' })).toBe(false)
    expect(isEmptyMemory({ runs: [{ date: '2026-08-17', summary: 'x' }] })).toBe(false)
  })
})

describe('timelineMemoryUpdateSchema', () => {
  it('rejects an empty patch so a no-op write cannot bump updatedAt', () => {
    expect(timelineMemoryUpdateSchema.safeParse({}).success).toBe(false)
  })

  it('rejects a non-ISO date, which the old freeform log could not catch', () => {
    expect(timelineMemoryUpdateSchema.safeParse({ coveredThrough: '10 Aug 2026' }).success).toBe(false)
    expect(timelineMemoryUpdateSchema.safeParse({ coveredThrough: '2026-08-10' }).success).toBe(true)
  })

  it('rejects an unknown key so the contract is instructive to an MCP client', () => {
    expect(timelineMemoryUpdateSchema.safeParse({ notes: 'x', lastRun: '2026-08-10' }).success).toBe(false)
  })

  it('rejects runs[] directly, forcing appendRun so history cannot be silently dropped', () => {
    expect(timelineMemoryUpdateSchema.safeParse({ runs: [] }).success).toBe(false)
  })

  it('rejects a reference url that is not a url', () => {
    expect(timelineMemoryUpdateSchema.safeParse({ references: [{ title: 'x', url: 'not a url' }] }).success).toBe(false)
  })
})
