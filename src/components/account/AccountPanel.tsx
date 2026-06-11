import { useEffect, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { Check, Loader2, LogOut } from 'lucide-react'
import { Button } from '~/components/ui/button'
import { Input } from '~/components/ui/input'
import { Label } from '~/components/ui/label'
import { Card, CardContent, CardHeader, CardTitle } from '~/components/ui/card'
import { authClient, signOut, useSession } from '~/lib/auth/client'

// Account settings: avatar + identity, an editable display name, and sign-out.
// Email is read-only (it's the login identifier for the single local user).
export function AccountPanel() {
  const qc = useQueryClient()
  const { data: session } = useSession()
  const user = session?.user
  const initial = (user?.name || user?.email || '?').trim().charAt(0).toUpperCase()

  const [name, setName] = useState(user?.name ?? '')
  const [busy, setBusy] = useState(false)
  const [saved, setSaved] = useState(false)

  // Keep the field in sync when the session resolves/refreshes.
  useEffect(() => setName(user?.name ?? ''), [user?.name])

  const dirty = name.trim() !== (user?.name ?? '').trim()

  async function save() {
    const next = name.trim()
    if (busy || !next || !dirty) return
    setBusy(true)
    setSaved(false)
    try {
      await authClient.updateUser({ name: next })
      await qc.invalidateQueries()
      setSaved(true)
    } finally {
      setBusy(false)
    }
  }

  async function logout() {
    await signOut()
    await qc.invalidateQueries()
  }

  return (
    <div className="flex flex-col gap-6">
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Profile</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-6">
          <div className="flex items-center gap-3">
            <span className="grid size-12 shrink-0 place-items-center rounded-full bg-gradient-to-br from-primary to-influence text-lg font-semibold text-white ring-1 ring-inset ring-white/15">
              {initial}
            </span>
            <div className="flex min-w-0 flex-col">
              <span className="truncate text-sm font-medium">{user?.name || 'Your account'}</span>
              <span className="truncate text-xs text-muted-foreground">{user?.email}</span>
            </div>
          </div>

          <form
            className="flex flex-col gap-4"
            onSubmit={(e) => {
              e.preventDefault()
              void save()
            }}
          >
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="account-name">Display name</Label>
              <Input
                id="account-name"
                value={name}
                onChange={(e) => {
                  setName(e.target.value)
                  setSaved(false)
                }}
                placeholder="Your name"
                className="max-w-sm"
              />
            </div>

            <div className="flex flex-col gap-1.5">
              <Label htmlFor="account-email">Email</Label>
              <Input
                id="account-email"
                value={user?.email ?? ''}
                disabled
                readOnly
                className="max-w-sm"
              />
              <p className="text-xs text-muted-foreground">
                Your email is the sign-in identifier and can’t be changed here.
              </p>
            </div>

            <div className="flex items-center gap-3">
              <Button type="submit" disabled={busy || !dirty || !name.trim()}>
                {busy ? <Loader2 className="animate-spin" /> : null}
                Save changes
              </Button>
              {saved && !dirty && (
                <span className="inline-flex items-center gap-1.5 text-sm text-primary">
                  <Check className="size-4" />
                  Saved
                </span>
              )}
            </div>
          </form>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Session</CardTitle>
        </CardHeader>
        <CardContent>
          <Button variant="outline" onClick={() => void logout()}>
            <LogOut />
            Log out
          </Button>
        </CardContent>
      </Card>
    </div>
  )
}
