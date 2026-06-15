import { Check, FolderInput } from 'lucide-react'
import {
  DropdownMenuSub,
  DropdownMenuSubTrigger,
  DropdownMenuSubContent,
  DropdownMenuItem,
} from '~/components/ui/dropdown-menu'
import type { ProjectSummary } from '~/lib/domain/types'

// The "Move to project…" entry for a card overflow menu (Wren §6). Renders only
// when the owner has 2+ projects (a single-project owner has nowhere to move to —
// the caller gates on `projects.length > 1`). The current project is shown with a
// check and disabled; selecting another fires `onMove`. This is a radio-like list
// inside a submenu rather than a separate popover, so it stays keyboard-navigable
// and part of the same menu the rest of the actions live in.
export function MoveToProjectSubmenu({
  projects,
  currentProjectId,
  onMove,
}: {
  projects: ProjectSummary[]
  // The project the item currently belongs to (checked + disabled). May be null
  // for a legacy null-project timeline — then nothing is pre-selected.
  currentProjectId: string | null
  onMove: (target: ProjectSummary) => void
}) {
  return (
    <DropdownMenuSub>
      <DropdownMenuSubTrigger>
        <FolderInput />
        Move to project…
      </DropdownMenuSubTrigger>
      <DropdownMenuSubContent className="max-h-64 w-56 overflow-y-auto">
        {projects.map((p) => {
          const current = p.id === currentProjectId
          return (
            <DropdownMenuItem
              key={p.id}
              disabled={current}
              onSelect={() => {
                if (!current) onMove(p)
              }}
            >
              <span className="ch-move-item">
                <span className="truncate">{p.title}</span>
                {current && (
                  <>
                    <span className="ch-move-current">current</span>
                    <Check className="size-3.5 shrink-0 text-muted-foreground" />
                  </>
                )}
              </span>
            </DropdownMenuItem>
          )
        })}
      </DropdownMenuSubContent>
    </DropdownMenuSub>
  )
}
