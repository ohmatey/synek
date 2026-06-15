import { useEffect, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { FolderPlus, Loader2 } from 'lucide-react'
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
import { createProject } from '~/lib/server/projects'
import { capture } from '~/lib/posthog/client'
import type { ProjectSummary } from '~/lib/domain/types'

// "New project" surface for the cinematic home rail (mirrors NewTimelineDialog in
// shape). A project is the top-level container above timelines/stories (ADR 0002);
// creating one is a single beat — name it, we make it, and the caller filters the
// home to it (its slug → ?project) so the creator lands on its empty state ready to
// add a timeline. Slice 1 only writes kind='nonfiction' (the server default).
export function NewProjectDialog({
  open,
  onOpenChange,
  onCreated,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  // Fired with the new project so the rail can select it (sync ?project=<slug>).
  onCreated?: (project: ProjectSummary) => void
}) {
  const qc = useQueryClient()
  const [title, setTitle] = useState('')
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    if (!open) return
    setTitle('')
    setBusy(false)
  }, [open])

  async function create() {
    if (busy) return
    const t = title.trim() || 'Untitled project'
    setBusy(true)
    try {
      const project = await createProject({ data: { title: t } })
      await qc.invalidateQueries({ queryKey: ['projects'] })
      capture('home_new_project_created', { project_id: project.id })
      onOpenChange(false)
      onCreated?.(project)
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>New project</DialogTitle>
          <DialogDescription>
            A project holds the timelines, stories and entities of one world. Name it — you can move
            timelines into it from any card.
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
            <Label htmlFor="new-project-name">Name</Label>
            <Input
              id="new-project-name"
              autoFocus
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="e.g. The Roman Republic, our product story, the AI race"
            />
          </div>

          <Button type="submit" disabled={busy} className="w-full">
            {busy ? <Loader2 className="animate-spin" /> : <FolderPlus />}
            Create project
          </Button>
        </form>
      </DialogContent>
    </Dialog>
  )
}
