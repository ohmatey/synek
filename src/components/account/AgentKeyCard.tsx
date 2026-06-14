import { useEffect, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Bot, Check, Loader2 } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '~/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '~/components/ui/card'
import { Input } from '~/components/ui/input'
import { Label } from '~/components/ui/label'
import {
  getUserSettings,
  setOpenRouterKey,
  clearOpenRouterKey,
  setAgentModel,
} from '~/lib/server/user-settings'

// The per-user BYO OpenRouter key + model (Phase 2). With a key saved, the prompt
// dialogs' "Run" executes in-app; without one, they fall back to copy-a-prompt. The
// key is encrypted server-side and never returned here — only a display prefix.
const MODEL_PLACEHOLDER = 'anthropic/claude-sonnet-4.6'

export function AgentKeyCard() {
  const qc = useQueryClient()
  const { data: settings } = useQuery({ queryKey: ['user-settings'], queryFn: () => getUserSettings() })

  const [key, setKey] = useState('')
  const [model, setModel] = useState('')
  // Seed the model field from the server once it loads.
  useEffect(() => {
    if (settings?.agentModel != null) setModel(settings.agentModel)
  }, [settings?.agentModel])

  const refresh = () => {
    void qc.invalidateQueries({ queryKey: ['user-settings'] })
    void qc.invalidateQueries({ queryKey: ['agent-config'] }) // so "Run" appears/disappears
  }

  const saveKey = useMutation({
    mutationFn: () => setOpenRouterKey({ data: { key } }),
    onSuccess: (res) => {
      if (res.ok) {
        toast.success('OpenRouter key saved')
        setKey('')
        refresh()
      } else {
        toast.error(res.error)
      }
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : 'Could not save the key'),
  })

  const removeKey = useMutation({
    mutationFn: () => clearOpenRouterKey(),
    onSuccess: () => {
      toast.success('OpenRouter key removed')
      refresh()
    },
  })

  const saveModel = useMutation({
    mutationFn: () => setAgentModel({ data: { model } }),
    onSuccess: () => {
      toast.success('Model saved')
      refresh()
    },
  })

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <span className="grid size-7 place-items-center rounded-md border border-border bg-background text-primary">
            <Bot className="size-4" />
          </span>
          In-app agent (OpenRouter)
        </CardTitle>
        <CardDescription>
          Add your own OpenRouter key to run prompts in-app — the canvas builds itself live, no separate Claude needed.
          Optional: without a key, the prompt dialogs just copy a prompt for your own client.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-5">
        {settings && !settings.canStoreKey ? (
          <p className="rounded-md border border-border bg-muted/40 px-3 py-2 text-sm text-muted-foreground">
            This server isn’t configured to store keys (no <code>SYNEK_SECRETS_KEY</code>). You can still copy prompts
            into your own client, or ask the operator to enable in-app runs.
          </p>
        ) : (
          <>
            <div className="flex flex-col gap-2">
              <Label htmlFor="openrouter-key">OpenRouter API key</Label>
              {settings?.hasOpenRouterKey && (
                <p className="text-xs text-muted-foreground">
                  A key is saved (<span className="font-mono">{settings.openRouterKeyPrefix}…</span>). Enter a new one to
                  replace it, or remove it.
                </p>
              )}
              <div className="flex gap-2">
                <Input
                  id="openrouter-key"
                  type="password"
                  placeholder="sk-or-v1-…"
                  value={key}
                  onChange={(e) => setKey(e.target.value)}
                  autoComplete="off"
                />
                <Button type="button" onClick={() => saveKey.mutate()} disabled={!key.trim() || saveKey.isPending}>
                  {saveKey.isPending ? <Loader2 className="animate-spin" /> : <Check />}
                  Save
                </Button>
                {settings?.hasOpenRouterKey && (
                  <Button type="button" variant="outline" onClick={() => removeKey.mutate()} disabled={removeKey.isPending}>
                    Remove
                  </Button>
                )}
              </div>
              <p className="text-xs text-muted-foreground">
                Stored encrypted on the server; never shown again. Get a key at{' '}
                <a
                  href="https://openrouter.ai/keys"
                  target="_blank"
                  rel="noreferrer"
                  className="underline hover:text-foreground"
                >
                  openrouter.ai/keys
                </a>
                .
              </p>
            </div>

            <div className="flex flex-col gap-2">
              <Label htmlFor="agent-model">Model</Label>
              <div className="flex gap-2">
                <Input
                  id="agent-model"
                  placeholder={MODEL_PLACEHOLDER}
                  value={model}
                  onChange={(e) => setModel(e.target.value)}
                  autoComplete="off"
                  spellCheck={false}
                  className="font-mono text-sm"
                />
                <Button type="button" variant="outline" onClick={() => saveModel.mutate()} disabled={saveModel.isPending}>
                  {saveModel.isPending ? <Loader2 className="animate-spin" /> : null}
                  Save
                </Button>
              </div>
              <p className="text-xs text-muted-foreground">
                Any tool-calling OpenRouter model slug. Blank uses the server default.
              </p>
            </div>
          </>
        )}
      </CardContent>
    </Card>
  )
}
