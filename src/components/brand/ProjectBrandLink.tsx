import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Link2, Link2Off, Loader2 } from 'lucide-react'
import { Button } from '~/components/ui/button'
import { toast } from 'sonner'
import { getProjectBrandId, setProjectBrand } from '~/lib/server/brands'

// The project-link affordance shown inside the brand editor when a project context
// is present (stories-first slice 2). Reads whether this project currently points
// at THIS brand and toggles the link. Both sides are owner-checked server-side
// (setProjectBrand double-checks project AND brand) — a foreign link is rejected
// there; this is just the control.
export function ProjectBrandLink({
  project,
  brandId,
  brandName,
}: {
  project: { id: string; title: string }
  brandId: string
  brandName: string
}) {
  const qc = useQueryClient()
  const { data: linkedBrandId, isLoading } = useQuery({
    queryKey: ['project-brand', project.id],
    queryFn: () => getProjectBrandId({ data: project.id }),
  })

  const linkedHere = linkedBrandId === brandId
  const linkedElsewhere = !!linkedBrandId && linkedBrandId !== brandId

  async function toggle() {
    try {
      await setProjectBrand({ data: { projectId: project.id, brandId: linkedHere ? null : brandId } })
      await qc.invalidateQueries({ queryKey: ['project-brand', project.id] })
      toast.success(linkedHere ? `Unlinked from “${project.title}”` : `Linked “${brandName}” to “${project.title}”`)
    } catch (e) {
      toast.error('Could not update the project link')
      console.error(e)
    }
  }

  return (
    <div className="flex items-center justify-between gap-3 rounded-md border border-border bg-muted/30 p-3">
      <div className="flex min-w-0 flex-col">
        <span className="text-sm font-medium">Project: {project.title}</span>
        <span className="text-xs text-muted-foreground">
          {isLoading
            ? 'Checking link…'
            : linkedHere
              ? 'This brand dresses this project.'
              : linkedElsewhere
                ? 'A different brand is linked. Linking here replaces it.'
                : 'Not linked to a brand yet.'}
        </span>
      </div>
      <Button variant={linkedHere ? 'outline' : 'default'} size="sm" onClick={() => void toggle()} disabled={isLoading}>
        {isLoading ? <Loader2 className="size-4 animate-spin" /> : linkedHere ? <Link2Off className="size-4" /> : <Link2 className="size-4" />}
        {linkedHere ? 'Unlink' : 'Link to project'}
      </Button>
    </div>
  )
}
