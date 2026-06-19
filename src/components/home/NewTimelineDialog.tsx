import { useEffect, useState } from 'react'
import { useNavigate } from '@tanstack/react-router'
import { useQueryClient } from '@tanstack/react-query'
import { ArrowRight, Loader2, Sparkles } from 'lucide-react'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '~/components/ui/dialog'
import { Button } from '~/components/ui/button'
import { Input } from '~/components/ui/input'
import { Label } from '~/components/ui/label'
import { Textarea } from '~/components/ui/textarea'
import { createTimeline } from '~/lib/server/timelines'
import { buildTimelinePrompt } from '~/lib/timeline-prompt'
import { capture } from '~/lib/posthog/client'
import { PromptActions } from '~/components/PromptActions'
import { DepthControl } from '~/components/PromptKnobs'
import { depthDirective, type Depth } from '~/lib/prompt-knobs'

// "New timeline" surface for the workspace home. The app holds no AI, so creating a
// timeline is two beats: (1) name it — we create the empty timeline immediately —
// then (2) copy a ready-made prompt to paste into your connected Claude, which builds
// it out via apply_patch. From the second step you can open the (still-empty) canvas
// and watch it fill in live, or jump straight in.
export function NewTimelineDialog({
  open,
  onOpenChange,
  projectId,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  // Optional: create the timeline INSIDE this project (ADR 0002 D7 write path).
  // Omitted → the db layer attaches it to the owner's default project. The cinematic
  // home passes the active rail project so a new timeline lands where the creator is.
  projectId?: string
}) {
  const qc = useQueryClient()
  const navigate = useNavigate()
  const [title, setTitle] = useState('')
  const [topic, setTopic] = useState('')
  const [depth, setDepth] = useState<Depth>('standard')
  const [busy, setBusy] = useState(false)
  // Once created we flip to the "copy a prompt" step, holding the new id + title.
  const [created, setCreated] = useState<{ id: string; title: string } | null>(null)

  // Reset every time the dialog opens so a reopen starts fresh.
  useEffect(() => {
    if (!open) return
    setTitle('')
    setTopic('')
    setDepth('standard')
    setBusy(false)
    setCreated(null)
  }, [open])

  async function create() {
    if (busy) return
    const t = title.trim() || 'Untitled timeline'
    setBusy(true)
    try {
      const row = await createTimeline({ data: { title: t, projectId } })
      await qc.invalidateQueries({ queryKey: ['timelines'] })
      setCreated({ id: row.id, title: row.title })
      capture('timeline_created', { timeline_id: row.id, source: 'ui' })
    } finally {
      setBusy(false)
    }
  }

  const openTimeline = (id: string) => {
    onOpenChange(false)
    void navigate({ to: '/timelines/$id', params: { id } })
  }

  const depthClause = depthDirective(depth)
  const prompt = created
    ? buildTimelinePrompt({ timelineId: created.id, title: created.title, topic }) +
      (depthClause ? `\n\n${depthClause}` : '')
    : ''

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        {!created ? (
          <>
            <DialogHeader>
              <DialogTitle>New timeline</DialogTitle>
              <DialogDescription>
                Name it and describe the focus — we’ll create the canvas and hand you a prompt to
                paste into your connected Claude, which builds it out for you.
              </DialogDescription>
            </DialogHeader>

            <form
              className="flex flex-col gap-4"
              onSubmit={(e) => {
                e.preventDefault()
                void create()
              }}
            >
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="new-timeline-name">Name</Label>
                <Input
                  id="new-timeline-name"
                  autoFocus
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  placeholder="e.g. the electric car, jazz, observability tooling"
                />
              </div>

              <div className="flex flex-col gap-1.5">
                <Label htmlFor="new-timeline-focus">
                  Focus <span className="font-normal text-muted-foreground">(optional)</span>
                </Label>
                <Textarea
                  id="new-timeline-focus"
                  value={topic}
                  onChange={(e) => setTopic(e.target.value)}
                  placeholder="e.g. focus on the people and the rivalries, 1990–today"
                  rows={2}
                />
              </div>

              <Button type="submit" disabled={busy} className="w-full">
                {busy ? <Loader2 className="animate-spin" /> : <Sparkles />}
                Create timeline
              </Button>
            </form>
          </>
        ) : (
          <>
            <DialogHeader>
              <DialogTitle>“{created.title}” is ready</DialogTitle>
              <DialogDescription>
                Copy this prompt and paste it into your connected Claude — it builds the timeline
                out via apply_patch. The canvas fills in live as it works.
              </DialogDescription>
            </DialogHeader>

            <pre className="max-h-44 overflow-auto whitespace-pre-wrap rounded-lg border border-border bg-muted/40 p-3 text-xs leading-relaxed text-muted-foreground">
              {prompt}
            </pre>

            <DepthControl value={depth} onChange={setDepth} />

            <PromptActions
              prompt={prompt}
              timelineId={created.id}
              resetKey={created.id}
              copyLabel="Copy build prompt"
              copiedLabel="Prompt copied — paste into Claude"
              onCopy={() => capture('build_prompt_copied', { timeline_id: created.id })}
              runAnalyticsProps={{ timeline_id: created.id, verb_id: 'build-timeline' }}
            />
            <Button
              type="button"
              variant="outline"
              className="w-full"
              onClick={() => openTimeline(created.id)}
            >
              Open the canvas
              <ArrowRight />
            </Button>
          </>
        )}
      </DialogContent>
    </Dialog>
  )
}
