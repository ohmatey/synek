import { useEffect, useState } from 'react'
import { useNavigate } from '@tanstack/react-router'
import { useQueryClient } from '@tanstack/react-query'
import { ArrowRight, BookOpen, Layers, Loader2 } from 'lucide-react'
import { toast } from 'sonner'
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
import { createSeries } from '~/lib/server/series'
import { buildNewSeriesPrompt, buildNewStoryPrompt } from '~/lib/story-prompt'
import { capture } from '~/lib/posthog/client'
import { PromptActions } from '~/components/PromptActions'
import { DepthControl } from '~/components/PromptKnobs'
import { depthDirective, type Depth } from '~/lib/prompt-knobs'

export type CreateMode = 'story' | 'series'

const COPY: Record<CreateMode, { title: string; desc: string; nameLabel: string; namePlaceholder: string; cta: string }> = {
  story: {
    title: 'New story',
    desc: 'Name it and say what it’s about — we’ll set up the canvas and hand you a prompt to paste into your connected Claude, which builds the timeline and writes the story onto it.',
    nameLabel: 'Story',
    namePlaceholder: 'e.g. the race to the moon, the fall of Rome, the rise of jazz',
    cta: 'Create story',
  },
  series: {
    title: 'New series',
    desc: 'A series is a serialized season — chapters that build on each other. Name it and say what it’s about; we’ll set it up and hand you a prompt to write Chapter I.',
    nameLabel: 'Series',
    namePlaceholder: 'e.g. the history of computing, the Roman Republic, the AI era',
    cta: 'Create series',
  },
}

// The new-creator home-level "New story" / "New series" surface (Wren empty-state
// redesign). The app holds no AI, so creating is two beats: (1) name it — we create
// the empty timeline (and, in series mode, the series), then (2) copy a ready-made
// prompt to paste into your connected Claude, which builds the timeline AND writes the
// first story/chapter onto it. Mirrors NewTimelineDialog in shape; the difference is
// the prompt also asks for the narrative, since stories are the product.
export function NewStoryDialog({
  open,
  onOpenChange,
  mode,
  projectId,
  initialTitle = '',
  initialTopic = '',
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  mode: CreateMode
  // Optional active project; omitted → the db layer attaches to the owner's default.
  projectId?: string
  // Pre-fill from a "story starter" card.
  initialTitle?: string
  initialTopic?: string
}) {
  const qc = useQueryClient()
  const navigate = useNavigate()
  const [title, setTitle] = useState(initialTitle)
  const [topic, setTopic] = useState(initialTopic)
  const [depth, setDepth] = useState<Depth>('standard')
  const [busy, setBusy] = useState(false)
  // After creation we flip to the "copy a prompt" step, holding the ids + title.
  const [created, setCreated] = useState<{ timelineId: string; seriesId: string | null; title: string } | null>(null)

  const copy = COPY[mode]

  // Reset every time the dialog opens (or the starter preset changes) so a reopen
  // starts fresh from whatever preset launched it.
  useEffect(() => {
    if (!open) return
    setTitle(initialTitle)
    setTopic(initialTopic)
    setDepth('standard')
    setBusy(false)
    setCreated(null)
  }, [open, initialTitle, initialTopic])

  async function create() {
    if (busy) return
    const t = title.trim() || (mode === 'series' ? 'Untitled series' : 'Untitled story')
    setBusy(true)
    try {
      const tl = await createTimeline({ data: { title: t, projectId } })
      let seriesId: string | null = null
      if (mode === 'series') {
        // createTimeline always resolves a project (default when none passed), so its
        // projectId is the home for the series. Guard defensively.
        const pid = tl.projectId ?? projectId
        if (!pid) {
          toast.error('Couldn’t set up the series — no project found.')
          return
        }
        const res = await createSeries({ data: { projectId: pid, title: t, hook: topic.trim() || undefined } })
        if ('error' in res) {
          toast.error('Couldn’t create the series.')
          return
        }
        seriesId = res.seriesId
        await qc.invalidateQueries({ queryKey: ['home-series'] })
      }
      await qc.invalidateQueries({ queryKey: ['timelines'] })
      setCreated({ timelineId: tl.id, seriesId, title: tl.title })
      capture(mode === 'series' ? 'home_new_series_created' : 'home_new_story_created', {
        timeline_id: tl.id,
        series_id: seriesId,
        source: 'empty-state',
      })
    } finally {
      setBusy(false)
    }
  }

  const openCanvas = (id: string) => {
    onOpenChange(false)
    void navigate({ to: '/timelines/$id', params: { id } })
  }

  const depthClause = depthDirective(depth)
  const basePrompt = created
    ? created.seriesId
      ? buildNewSeriesPrompt({ seriesId: created.seriesId, timelineId: created.timelineId, title: created.title, topic })
      : buildNewStoryPrompt({ timelineId: created.timelineId, title: created.title, topic })
    : ''
  const prompt = basePrompt && depthClause ? `${basePrompt}\n\n${depthClause}` : basePrompt

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        {!created ? (
          <>
            <DialogHeader>
              <DialogTitle>{copy.title}</DialogTitle>
              <DialogDescription>{copy.desc}</DialogDescription>
            </DialogHeader>

            <form
              className="flex flex-col gap-4"
              onSubmit={(e) => {
                e.preventDefault()
                void create()
              }}
            >
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="new-story-name">{copy.nameLabel}</Label>
                <Input
                  id="new-story-name"
                  autoFocus
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  placeholder={copy.namePlaceholder}
                />
              </div>

              <div className="flex flex-col gap-1.5">
                <Label htmlFor="new-story-topic">
                  What’s it about? <span className="font-normal text-muted-foreground">(optional)</span>
                </Label>
                <Textarea
                  id="new-story-topic"
                  value={topic}
                  onChange={(e) => setTopic(e.target.value)}
                  placeholder="e.g. focus on the people and the rivalries, 1990–today"
                  rows={2}
                />
              </div>

              <Button type="submit" disabled={busy} className="w-full">
                {busy ? <Loader2 className="animate-spin" /> : mode === 'series' ? <Layers /> : <BookOpen />}
                {copy.cta}
              </Button>
            </form>
          </>
        ) : (
          <>
            <DialogHeader>
              <DialogTitle>“{created.title}” is ready</DialogTitle>
              <DialogDescription>
                Copy this prompt and paste it into your connected Claude — it builds the timeline and
                writes the {created.seriesId ? 'first chapter' : 'story'} onto it. The canvas fills in live as it works.
              </DialogDescription>
            </DialogHeader>

            <pre className="max-h-44 overflow-auto whitespace-pre-wrap rounded-lg border border-border bg-muted/40 p-3 text-xs leading-relaxed text-muted-foreground">
              {prompt}
            </pre>

            <DepthControl value={depth} onChange={setDepth} />

            <PromptActions
              prompt={prompt}
              timelineId={created.timelineId}
              resetKey={created.timelineId}
              copyLabel="Copy build prompt"
              copiedLabel="Prompt copied — paste into Claude"
              onCopy={() =>
                capture('build_prompt_copied', {
                  timeline_id: created.timelineId,
                  series_id: created.seriesId,
                })
              }
              runAnalyticsProps={{
                timeline_id: created.timelineId,
                verb_id: created.seriesId ? 'build-series' : 'build-story',
              }}
            />
            <Button type="button" variant="outline" className="w-full" onClick={() => openCanvas(created.timelineId)}>
              Open the canvas
              <ArrowRight />
            </Button>
          </>
        )}
      </DialogContent>
    </Dialog>
  )
}
