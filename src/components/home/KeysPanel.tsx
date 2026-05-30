import { useEffect, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Badge, Button, Input } from '@strata/ui'
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
    if (!window.confirm(`Revoke “${name}”? Any client using it will stop working immediately.`)) return
    await revokeApiKey({ data: id })
    await qc.invalidateQueries({ queryKey: ['api-keys'] })
  }

  return (
    <div className="flex flex-col gap-3">
      <form
        className="flex flex-col gap-2 sm:flex-row sm:items-center"
        onSubmit={(e) => {
          e.preventDefault()
          void create()
        }}
      >
        <span className="text-xs uppercase tracking-wide text-[var(--color-fg-muted)] sm:w-20">
          New key
        </span>
        <Input
          className="flex-1"
          placeholder="Name this key (e.g. Claude Desktop, laptop CLI)"
          value={label}
          onChange={(e) => setLabel(e.target.value)}
          aria-label="API key label"
        />
        <Button type="submit" loading={busy} disabled={!label.trim()}>
          Create key
        </Button>
      </form>

      {created && (
        <div
          role="status"
          className="flex flex-col gap-2 rounded-[var(--radius-control)] border border-[var(--color-accent-primary)] bg-[var(--color-primary-soft)] p-3 sm:flex-row sm:items-center"
        >
          <span className="text-xs font-semibold uppercase tracking-wide text-[var(--color-accent-primary)] sm:w-20">
            Copy now
          </span>
          <code className="home-connect-token flex-1 break-all rounded bg-[var(--color-bg-base)] px-2 py-1 font-mono text-xs text-[var(--color-fg-primary)]">
            {created.raw}
          </code>
          <CopyButton text={created.raw} variant="primary" size="sm" />
          <Button variant="ghost" size="sm" onClick={() => setCreated(null)}>
            Done
          </Button>
          <span className="text-[11px] text-[var(--color-fg-muted)]">
            Save it now — “{created.label}” won’t be shown again.
          </span>
        </div>
      )}

      {keys.length > 0 && (
        <table className="home-keys-table w-full text-sm">
          <thead>
            <tr className="border-b border-[var(--color-border-subtle)] text-left text-xs uppercase tracking-wide text-[var(--color-fg-muted)]">
              <th className="py-2 font-medium">Key</th>
              <th className="py-2 font-medium">Secret</th>
              <th className="py-2 font-medium hidden md:table-cell">Created</th>
              <th className="py-2 font-medium hidden md:table-cell">Last used</th>
              <th className="py-2 w-20 text-right">
                <span className="sr-only">Actions</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {keys.map((k) => (
              <tr
                key={k.id}
                className={`border-b border-[var(--color-border-faint)] last:border-b-0 ${
                  k.revokedAt ? 'opacity-60' : ''
                }`}
              >
                <td className="py-2 text-[var(--color-fg-primary)]">{k.label}</td>
                <td className="py-2 text-[var(--color-fg-muted)]">
                  <code className="font-mono text-xs">{k.prefix}…</code>
                  {k.revokedAt && (
                    <Badge variant="danger" appearance="soft" className="ml-2">
                      revoked
                    </Badge>
                  )}
                </td>
                <td className="py-2 hidden md:table-cell text-xs text-[var(--color-fg-muted)]">
                  <time dateTime={new Date(k.createdAt).toISOString()}>
                    {dateFmt.format(k.createdAt)}
                  </time>
                </td>
                <td className="py-2 hidden md:table-cell text-xs text-[var(--color-fg-muted)]">
                  {k.lastUsedAt ? dateFmt.format(k.lastUsedAt) : '—'}
                </td>
                <td className="py-2 text-right">
                  {!k.revokedAt && (
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => void revoke(k.id, k.label)}
                      className="text-[var(--color-danger)] hover:bg-[var(--color-danger-soft-bg)]"
                    >
                      Revoke
                    </Button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  )
}
