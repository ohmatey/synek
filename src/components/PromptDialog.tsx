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
import { PromptActions } from '~/components/PromptActions'
import { DepthControl } from '~/components/PromptKnobs'
import { depthDirective, type Depth } from '~/lib/prompt-knobs'
import { capture, type ClientEvent } from '~/lib/posthog/client'

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
  /** The base prompt text; the user's context (if any) is appended on copy/run. */
  prompt: string
  /**
   * The timeline this prompt acts on. Required for the in-app "Run" path (the
   * agent needs a target); copy-only prompts can omit it.
   */
  timelineId?: string
  /** Footnote under the action; defaults to the paste-into-Claude note. */
  hint?: string
  /** Label for the free-text context field. */
  contextLabel?: string
  /** Placeholder for the context field. */
  contextPlaceholder?: string
  /** How the typed context is introduced in the copied prompt. */
  contextHeading?: string
  /** Optional analytics event fired when the user copies this prompt. */
  analytics?: { event: ClientEvent; props?: Record<string, unknown> }
}

const DEFAULT_HINT =
  'Copy this and paste it into your connected Claude — it runs the Synek MCP tools and the canvas updates live.'
const DEFAULT_CONTEXT_LABEL = 'Add context (optional)'
const DEFAULT_CONTEXT_PLACEHOLDER =
  'Anything specific you want Claude to focus on or include — talk to it like you would in chat…'
const DEFAULT_CONTEXT_HEADING = 'Additional direction from the user:'

// Combine the base prompt with the active depth knob and the user's typed context,
// the way a chat message rides on top of a system prompt. Depth is appended before
// the context so the user's words still get the last say. 'standard' (or no depth)
// appends nothing, so existing prompts stay byte-identical.
export function composePrompt(spec: PromptSpec, context: string, depth?: Depth): string {
  let out = spec.prompt
  const d = depth ? depthDirective(depth) : null
  if (d) out += `\n\n${d}`
  const extra = context.trim()
  if (extra) out += `\n\n${spec.contextHeading ?? DEFAULT_CONTEXT_HEADING}\n${extra}`
  return out
}

// A shared dialog that displays a PromptSpec and lets the user append context.
//
// SEAM — the inversion lives here, now progressively enhanced. The action footer
// (PromptActions) is "Copy prompt" with no agent configured (the user's own Claude
// runs it — the local-first default), and gains a primary "Run" when an agent IS
// configured AND the spec carries a timelineId. Callers depend only on PromptSpec.
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
  const [depth, setDepth] = useState<Depth>('standard')
  // Reset the context + depth each time the dialog opens for a fresh prompt.
  useEffect(() => {
    if (open) {
      setContext('')
      setDepth('standard')
    }
  }, [open])

  const fullPrompt = spec ? composePrompt(spec, context, depth) : ''
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
                  ? 'Added to the end of the prompt when you run or copy.'
                  : 'Optional — add a question or focus, like talking to a chat assistant.'}
              </p>
            </div>

            <DepthControl value={depth} onChange={setDepth} />

            <PromptActions
              prompt={fullPrompt}
              timelineId={spec.timelineId}
              resetKey={spec}
              copyLabel="Copy prompt"
              onCopy={spec.analytics ? () => capture(spec.analytics!.event, spec.analytics!.props) : undefined}
              runAnalyticsProps={spec.analytics?.props}
              hint={spec.hint ?? DEFAULT_HINT}
            />
          </>
        )}
      </DialogContent>
    </Dialog>
  )
}
