import { useEffect } from 'react'
import { useQuery, useMutation } from '@tanstack/react-query'
import { Loader2, Sparkles, Check, AlertCircle } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '~/components/ui/button'
import { CopyButton } from '~/components/home/CopyButton'
import { capture } from '~/lib/posthog/client'
import { getAgentConfig, runAgent } from '~/lib/server/agent'

// The action footer shared by every prompt surface — the SINGLE progressive-
// enhancement point. With no in-app agent configured it's just "Copy prompt" (the
// user's own Claude runs it). With OPENROUTER_API_KEY set AND a timelineId to act
// on, it offers a primary "Run" (executes server-side; the canvas updates live via
// SSE) with Copy as the fallback. PromptDialog and the bespoke New Timeline / New
// Story dialogs all render this, so the swap lives in one place.
export function PromptActions({
  prompt,
  timelineId,
  resetKey,
  copyLabel = 'Copy prompt',
  copiedLabel = 'Copied — paste into Claude',
  disabled = false,
  onCopy,
  runAnalyticsProps,
  hint,
}: {
  /** The full text to copy or run (base prompt + any composed context). */
  prompt: string
  /** Target timeline. Required to enable Run; copy-only when absent. */
  timelineId?: string
  /** Change this (e.g. when the dialog reopens) to clear a prior run's result. */
  resetKey?: unknown
  copyLabel?: string
  copiedLabel?: string
  /** Disables both actions (e.g. the prompt isn't ready yet). */
  disabled?: boolean
  /** Copy analytics side effect. */
  onCopy?: () => void
  /** Props for the `verb_prompt_run` event fired on Run. */
  runAnalyticsProps?: Record<string, unknown>
  /** Footnote shown under the copy-only action. */
  hint?: string
}) {
  const { data: cfg } = useQuery({
    queryKey: ['agent-config'],
    queryFn: () => getAgentConfig(),
    staleTime: 5 * 60_000,
  })

  const run = useMutation({
    // The server resolves the per-user key + model; the client just sends the prompt.
    mutationFn: (text: string) => runAgent({ data: { timelineId: timelineId!, prompt: text } }),
    onSuccess: (result) => {
      capture('verb_prompt_run', { ...(runAnalyticsProps ?? {}), model: cfg?.defaultModel, ok: result.ok })
      if (result.ok) toast.success('Done — the canvas updated live')
      else toast.error(result.error || 'The run failed')
    },
    onError: (err) => toast.error(err instanceof Error ? err.message : 'The run failed'),
  })

  // Clear the previous result when the host resets (e.g. dialog reopen).
  useEffect(() => {
    run.reset()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [resetKey])

  const canRun = !!(cfg?.enabled && timelineId)
  const result = run.data

  if (!canRun) {
    return (
      <>
        <CopyButton
          text={prompt}
          label={copyLabel}
          copiedLabel={copiedLabel}
          variant="default"
          className="w-full"
          disabled={disabled}
          onCopy={onCopy}
        />
        {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
      </>
    )
  }

  return (
    <div className="flex flex-col gap-2">
      {result && (
        <div
          className={`flex gap-2 rounded-lg border p-3 text-sm ${
            result.ok ? 'border-success/40 bg-success/10 text-foreground' : 'border-destructive/40 bg-destructive/10 text-foreground'
          }`}
        >
          {result.ok ? (
            <Check className="mt-0.5 size-4 shrink-0 text-success" />
          ) : (
            <AlertCircle className="mt-0.5 size-4 shrink-0 text-destructive" />
          )}
          <p className="min-w-0 flex-1 break-words">
            {result.ok ? result.summary || 'Done.' : result.error || 'The run failed.'}
          </p>
        </div>
      )}
      <Button type="button" className="w-full" disabled={disabled || run.isPending} onClick={() => run.mutate(prompt)}>
        {run.isPending ? (
          <>
            <Loader2 className="animate-spin" /> Running…
          </>
        ) : result?.ok ? (
          <>
            <Sparkles /> Run again
          </>
        ) : (
          <>
            <Sparkles /> Run
          </>
        )}
      </Button>
      <CopyButton
        text={prompt}
        label="Copy prompt instead"
        copiedLabel={copiedLabel}
        variant="outline"
        className="w-full"
        disabled={disabled || run.isPending}
        onCopy={onCopy}
      />
      <p className="text-xs text-muted-foreground">
        Run executes here on the server and the canvas updates live — no separate Claude needed.
      </p>
    </div>
  )
}
