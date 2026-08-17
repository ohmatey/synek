import { useEffect, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Loader2, Plus, X } from 'lucide-react'
import { toast } from 'sonner'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '~/components/ui/dialog'
import { Button } from '~/components/ui/button'
import { Input } from '~/components/ui/input'
import { Label } from '~/components/ui/label'
import { Textarea } from '~/components/ui/textarea'
import { Separator } from '~/components/ui/separator'
import { getTimelineMemory, updateTimelineMemory } from '~/lib/server/timelines'
import { MEMORY_LIMITS, type TimelineReference } from '~/lib/domain/memory'

// Owner-only editor for TIMELINE MEMORY — the per-timeline context store that
// replaced the "Keeper log" node.
//
// The dialog is the visible half of the two-region ownership split: the fields
// here are the ones YOU own (brief, notes, references) and Save writes ONLY those
// three keys. The keeper's own bookkeeping is shown read-only below, because the
// question it answers ("is my routine actually running?") is worth surfacing but
// hand-editing a run log is not. Since the write is field-scoped, saving notes
// while a scheduled keeper appends a run cannot lose either write.

const emptyRef = (): TimelineReference => ({ title: '', url: undefined })

export function MemoryDialog({
  open,
  onOpenChange,
  timelineId,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  timelineId: string
}) {
  const qc = useQueryClient()
  const [brief, setBrief] = useState('')
  const [notes, setNotes] = useState('')
  const [refs, setRefs] = useState<TimelineReference[]>([])
  const [saving, setSaving] = useState(false)

  const { data: memory, isLoading } = useQuery({
    queryKey: ['timeline-memory', timelineId],
    queryFn: () => getTimelineMemory({ data: { id: timelineId } }),
    enabled: open,
  })

  // Re-seed each time it opens: an MCP client may have written since last time.
  useEffect(() => {
    if (!open || !memory) return
    setBrief(memory.brief ?? '')
    setNotes(memory.notes ?? '')
    setRefs(memory.references ?? [])
  }, [open, memory])

  async function save() {
    if (saving) return
    setSaving(true)
    try {
      // Drop blank rows, and normalise "" → undefined so an empty url clears
      // rather than failing the url() check.
      const references = refs
        .map((r) => ({ title: r.title.trim(), url: r.url?.trim() || undefined, note: r.note?.trim() || undefined }))
        .filter((r) => r.title.length > 0)

      await updateTimelineMemory({
        data: {
          id: timelineId,
          // Only the user-owned region. The keeper's keys are absent from this
          // patch, so the field-scoped merge leaves them exactly as they were.
          patch: { brief: brief.trim(), notes: notes.trim(), references },
        },
      })
      await qc.invalidateQueries({ queryKey: ['timeline-memory', timelineId] })
      onOpenChange(false)
      toast.success('Memory saved')
    } catch {
      toast.error('Couldn’t save the timeline memory')
    } finally {
      setSaving(false)
    }
  }

  const runs = memory?.runs ?? []
  const watching = memory?.watching ?? []
  const hasKeeper = runs.length > 0 || watching.length > 0 || !!memory?.cadence

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Timeline memory</DialogTitle>
          <DialogDescription>
            Standing context for this timeline. Your MCP client reads this before every run and treats it as
            instructions, so it is where scope, house rules and the sources you trust belong.
          </DialogDescription>
        </DialogHeader>

        <div className="max-h-[55vh] space-y-5 overflow-y-auto pr-1">
          <div className="space-y-1.5">
            <Label htmlFor="memory-brief">Brief</Label>
            <Textarea
              id="memory-brief"
              value={brief}
              onChange={(e) => setBrief(e.target.value)}
              maxLength={MEMORY_LIMITS.brief}
              rows={2}
              placeholder="What this timeline covers, and what it deliberately leaves out."
              disabled={isLoading}
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="memory-notes">Notes</Label>
            <Textarea
              id="memory-notes"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              maxLength={MEMORY_LIMITS.notes}
              rows={6}
              className="font-mono text-xs"
              placeholder={'Markdown. Standing instructions for whoever writes here next.\n\n- Prefer primary changelogs over commentary\n- Skip embodied robotics'}
              disabled={isLoading}
            />
            <p className="text-muted-foreground text-xs">Markdown. Read by every run, never overwritten by one.</p>
          </div>

          <div className="space-y-1.5">
            <div className="flex items-center justify-between">
              <Label>References</Label>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => setRefs((r) => [...r, emptyRef()])}
                disabled={isLoading || refs.length >= MEMORY_LIMITS.references}
                data-testid="memory-add-reference"
              >
                <Plus /> Add
              </Button>
            </div>
            <p className="text-muted-foreground text-xs">
              The standing sources this timeline is grounded in. A keeper re-checks these every run, so this is its
              search plan rather than a bibliography.
            </p>
            {refs.length === 0 && (
              <p className="text-muted-foreground rounded-md border border-dashed px-3 py-4 text-center text-xs">
                No standing references yet.
              </p>
            )}
            <div className="space-y-2">
              {refs.map((r, i) => (
                <div key={i} className="flex gap-2">
                  <div className="flex-1 space-y-1">
                    <Input
                      value={r.title}
                      onChange={(e) =>
                        setRefs((prev) => prev.map((x, j) => (j === i ? { ...x, title: e.target.value } : x)))
                      }
                      placeholder="OpenAI API changelog"
                      aria-label={`Reference ${i + 1} title`}
                    />
                    <Input
                      value={r.url ?? ''}
                      onChange={(e) =>
                        setRefs((prev) => prev.map((x, j) => (j === i ? { ...x, url: e.target.value } : x)))
                      }
                      placeholder="https://…"
                      inputMode="url"
                      className="text-xs"
                      aria-label={`Reference ${i + 1} link`}
                    />
                  </div>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    className="mt-0.5 shrink-0"
                    onClick={() => setRefs((prev) => prev.filter((_, j) => j !== i))}
                    aria-label={`Remove reference ${i + 1}`}
                  >
                    <X />
                  </Button>
                </div>
              ))}
            </div>
          </div>

          {hasKeeper && (
            <>
              <Separator />
              <div className="space-y-2">
                <Label>Keeper activity</Label>
                <p className="text-muted-foreground text-xs">
                  Written by your routine, shown here so you can tell whether it is still running.
                  {memory?.cadence ? ` Cadence: ${memory.cadence}.` : ''}
                  {memory?.coveredThrough ? ` Looked through ${memory.coveredThrough}.` : ''}
                </p>
                {runs.length > 0 && (
                  <ul className="space-y-1 text-xs">
                    {runs.slice(0, 6).map((run, i) => (
                      <li key={i} className="flex gap-2">
                        <span className="text-muted-foreground tabular-nums">{run.date}</span>
                        <span>{run.summary}</span>
                      </li>
                    ))}
                  </ul>
                )}
                {watching.length > 0 && (
                  <div className="space-y-1">
                    <p className="text-muted-foreground text-xs font-medium">Watching</p>
                    <ul className="space-y-1 text-xs">
                      {watching.map((w, i) => (
                        <li key={i}>
                          {w.item}
                          {w.promoteIf ? (
                            <span className="text-muted-foreground"> · promote if {w.promoteIf}</span>
                          ) : null}
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
              </div>
            </>
          )}
        </div>

        <DialogFooter className="gap-2">
          <Button variant="outline" size="sm" onClick={() => onOpenChange(false)} disabled={saving}>
            Cancel
          </Button>
          <Button size="sm" onClick={save} disabled={saving || isLoading} data-testid="memory-save">
            {saving && <Loader2 className="animate-spin" />}
            Save memory
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
