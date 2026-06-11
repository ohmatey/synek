import { useEffect, useState } from 'react'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '~/components/ui/dialog'
import { Label } from '~/components/ui/label'
import { Textarea } from '~/components/ui/textarea'
import { CopyButton } from '~/components/home/CopyButton'

export type PromptParam = { label: string; value: string }

// One prompt to display: what it does, the inputs it was built with, and the
// ready-to-run text. Action surfaces (the command palette, an entity's "Talk to"
// button, …) produce these; the dialog just renders them — and lets the user add
// their own free-text context, the way they'd type to a chat assistant.
export type PromptSpec = {
  /** Title — what running this prompt will do. */
  title: string
  /** One- or two-line explanation shown under the title. */
  description: string
  /** The filled-in inputs this prompt carries, shown as labeled rows. */
  params?: PromptParam[]
  /** The base prompt text; the user's context (if any) is appended on copy. */
  prompt: string
  /** Footnote under the action; defaults to the paste-into-Claude note. */
  hint?: string
  /** Label for the free-text context field. */
  contextLabel?: string
  /** Placeholder for the context field. */
  contextPlaceholder?: string
  /** How the typed context is introduced in the copied prompt. */
  contextHeading?: string
}

const DEFAULT_HINT =
  'Copy this and paste it into your connected Claude — it runs the Synek MCP tools and the canvas updates live.'
const DEFAULT_CONTEXT_LABEL = 'Add context (optional)'
const DEFAULT_CONTEXT_PLACEHOLDER =
  'Anything specific you want Claude to focus on or include — talk to it like you would in chat…'
const DEFAULT_CONTEXT_HEADING = 'Additional direction from the user:'

// Combine the base prompt with the user's typed context, the way a chat message
// rides on top of a system prompt.
export function composePrompt(spec: PromptSpec, context: string): string {
  const extra = context.trim()
  if (!extra) return spec.prompt
  return `${spec.prompt}\n\n${spec.contextHeading ?? DEFAULT_CONTEXT_HEADING}\n${extra}`
}

// A shared dialog that displays a PromptSpec and lets the user append context.
//
// SEAM — the inversion lives here. Today Synek holds no model, so the primary
// action is "copy the prompt" (the user's own Claude runs it), and the context
// field is just appended to the copied text. When Synek is hosted, THIS component
// is the single swap point: the copy button becomes a "Run" that POSTs the spec
// PLUS the typed context to the generation API. Callers depend only on PromptSpec,
// so that swap stays local to this file.
export function PromptDialog({
  open,
  onOpenChange,
  spec,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  spec: PromptSpec | null
}) {
  const [context, setContext] = useState('')
  // Reset the context field each time the dialog opens for a fresh prompt.
  useEffect(() => {
    if (open) setContext('')
  }, [open])

  const fullPrompt = spec ? composePrompt(spec, context) : ''
  const hasContext = context.trim().length > 0

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{spec?.title ?? ''}</DialogTitle>
          <DialogDescription>{spec?.description ?? ''}</DialogDescription>
        </DialogHeader>

        {spec && (
          <>
            {spec.params && spec.params.length > 0 && (
              <dl className="flex flex-col gap-1.5 rounded-lg border border-border bg-muted/40 p-3 text-sm">
                {spec.params.map((p) => (
                  <div key={p.label} className="flex items-baseline gap-3">
                    <dt className="w-24 shrink-0 text-xs uppercase tracking-wide text-muted-foreground">
                      {p.label}
                    </dt>
                    <dd className="min-w-0 flex-1 break-words font-medium">{p.value}</dd>
                  </div>
                ))}
              </dl>
            )}

            <div className="flex flex-col gap-1.5">
              <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Prompt</span>
              <pre className="max-h-44 overflow-auto whitespace-pre-wrap rounded-lg border border-border bg-background p-3 text-xs leading-relaxed text-foreground">
                {spec.prompt}
              </pre>
            </div>

            <div className="flex flex-col gap-1.5">
              <Label htmlFor="prompt-context" className="text-sm font-medium">
                {spec.contextLabel ?? DEFAULT_CONTEXT_LABEL}
              </Label>
              <Textarea
                id="prompt-context"
                value={context}
                onChange={(e) => setContext(e.target.value)}
                placeholder={spec.contextPlaceholder ?? DEFAULT_CONTEXT_PLACEHOLDER}
                rows={3}
              />
              <p className="text-xs text-muted-foreground">
                {hasContext
                  ? 'Added to the end of the prompt when you copy.'
                  : 'Optional — add a question or focus, like talking to a chat assistant.'}
              </p>
            </div>

            <CopyButton
              text={fullPrompt}
              label="Copy prompt"
              copiedLabel="Copied — paste into Claude"
              variant="default"
              className="w-full"
            />
            <p className="text-xs text-muted-foreground">{spec.hint ?? DEFAULT_HINT}</p>
          </>
        )}
      </DialogContent>
    </Dialog>
  )
}
