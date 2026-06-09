import { useEffect, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { KeyRound, Loader2, ShieldCheck } from 'lucide-react'
import { Badge } from '~/components/ui/badge'
import { Button } from '~/components/ui/button'
import { Input } from '~/components/ui/input'
import { createApiKey, initApiKeys, revokeApiKey } from '~/lib/server/api-keys'
import { CopyButton } from './CopyButton'

const dateFmt = new Intl.DateTimeFormat(undefined, {
  day: 'numeric',
  month: 'short',
  year: 'numeric',
})

export function KeysPanel({ onFreshKey }: { onFreshKey: (raw: string) => void }) {
  const qc = useQueryClient()
  const [label, setLabel] = useState('')
  const [busy, setBusy] = useState(false)
  const [created, setCreated] = useState<{ raw: string; label: string } | null>(null)

  // First visit mints a "Default" key (show-once secret); afterwards a plain list.
  const { data } = useQuery({ queryKey: ['api-keys'], queryFn: () => initApiKeys() })
  const keys = data?.keys ?? []

  useEffect(() => {
    if (data?.created) {
      setCreated({ raw: data.created.raw, label: data.created.key.label })
      onFreshKey(data.created.raw)
    }
  }, [data?.created, onFreshKey])

  async function create() {
    const name = label.trim()
    if (busy || !name) return
    setBusy(true)
    try {
      const { raw, key } = await createApiKey({ data: { label: name } })
      setCreated({ raw, label: key.label })
      onFreshKey(raw)
      setLabel('')
      await qc.invalidateQueries({ queryKey: ['api-keys'] })
    } finally {
      setBusy(false)
    }
  }

  async function revoke(id: string, name: string) {
    if (!window.confirm(`Revoke “${name}”? Any client using it will stop working immediately.`))
      return
    await revokeApiKey({ data: id })
    await qc.invalidateQueries({ queryKey: ['api-keys'] })
  }

  return (
    <div className="flex flex-col gap-4">
      <form
        className="flex flex-col gap-2 sm:flex-row sm:items-center"
        onSubmit={(e) => {
          e.preventDefault()
          void create()
        }}
      >
        <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground sm:w-20">
          New key
        </span>
        <Input
          className="flex-1"
          placeholder="Name this key (e.g. Claude Desktop, laptop CLI)"
          value={label}
          onChange={(e) => setLabel(e.target.value)}
          aria-label="API key label"
        />
        <Button type="submit" variant="outline" disabled={busy || !label.trim()}>
          {busy ? <Loader2 className="animate-spin" /> : <KeyRound />}
          Create key
        </Button>
      </form>

      {created && (
        <div
          role="status"
          className="flex flex-col gap-3 rounded-lg border border-primary/30 bg-primary/5 p-4"
        >
          <div className="flex items-center gap-2 text-sm font-semibold text-primary">
            <ShieldCheck className="size-4" />
            Copy your key now — “{created.label}” won’t be shown again
          </div>
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
            <code className="flex-1 break-all rounded-md border border-border bg-background px-3 py-2 font-mono text-xs text-foreground">
              {created.raw}
            </code>
            <div className="flex shrink-0 gap-2">
              <CopyButton text={created.raw} label="Copy" variant="default" />
              <Button variant="ghost" size="sm" onClick={() => setCreated(null)}>
                Done
              </Button>
            </div>
          </div>
        </div>
      )}

      {keys.length > 0 && (
        <div className="overflow-hidden rounded-lg border border-border">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border bg-muted/40 text-left text-xs uppercase tracking-wide text-muted-foreground">
                <th className="px-3 py-2 font-medium">Key</th>
                <th className="px-3 py-2 font-medium">Secret</th>
                <th className="hidden px-3 py-2 font-medium md:table-cell">Created</th>
                <th className="hidden px-3 py-2 font-medium md:table-cell">Last used</th>
                <th className="w-16 px-3 py-2 text-right">
                  <span className="sr-only">Actions</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {keys.map((k) => (
                <tr
                  key={k.id}
                  className={`border-b border-border last:border-b-0 ${k.revokedAt ? 'opacity-55' : ''}`}
                >
                  <td className="px-3 py-2.5 font-medium">{k.label}</td>
                  <td className="px-3 py-2.5 text-muted-foreground">
                    <code className="font-mono text-xs">{k.prefix}…</code>
                    {k.revokedAt && (
                      <Badge variant="destructive" className="ml-2 rounded-full">
                        revoked
                      </Badge>
                    )}
                  </td>
                  <td className="hidden px-3 py-2.5 text-xs text-muted-foreground md:table-cell">
                    <time dateTime={new Date(k.createdAt).toISOString()}>
                      {dateFmt.format(k.createdAt)}
                    </time>
                  </td>
                  <td className="hidden px-3 py-2.5 text-xs text-muted-foreground md:table-cell">
                    {k.lastUsedAt ? dateFmt.format(k.lastUsedAt) : '—'}
                  </td>
                  <td className="px-3 py-2.5 text-right">
                    {!k.revokedAt && (
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => void revoke(k.id, k.label)}
                        className="text-destructive hover:bg-destructive/10 hover:text-destructive"
                      >
                        Revoke
                      </Button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
