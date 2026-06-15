import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '~/components/ui/dialog'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '~/components/ui/tabs'
import { AccountPanel } from './AccountPanel'
import { ApiKeysPanel } from './ApiKeysPanel'
import { AgentKeyCard } from './AgentKeyCard'

export type SettingsTab = 'account' | 'api-keys'

// The signed-in settings surface, consolidated into one tabbed modal so it opens
// over the current view (e.g. the cinematic home) instead of navigating away.
// Composes the same self-contained panels the /account and /api-keys routes use —
// those routes remain as deep-link fallbacks. The dialog only mounts its body on
// open, so the panels' client-only data reads (session, user-settings) are safe
// without an extra <ClientOnly> guard.
export function SettingsDialog({
  open,
  tab,
  onOpenChange,
  onTabChange,
}: {
  open: boolean
  tab: SettingsTab
  onOpenChange: (open: boolean) => void
  onTabChange: (tab: SettingsTab) => void
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[85vh] flex-col gap-4 sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Settings</DialogTitle>
          <DialogDescription className="sr-only">
            Manage your account, privacy, session, and connected keys.
          </DialogDescription>
        </DialogHeader>

        <Tabs
          value={tab}
          onValueChange={(v) => onTabChange(v as SettingsTab)}
          className="flex min-h-0 flex-1 flex-col gap-4"
        >
          <TabsList>
            <TabsTrigger value="account">Account</TabsTrigger>
            <TabsTrigger value="api-keys">API keys</TabsTrigger>
          </TabsList>

          {/* The panels can be tall (the connect guide especially) — scroll the body,
              keep the tabs pinned. -mx/px keeps focus rings from clipping at the edge. */}
          <div className="-mx-1 min-h-0 flex-1 overflow-y-auto px-1">
            <TabsContent value="account" className="mt-0">
              <AccountPanel />
            </TabsContent>
            <TabsContent value="api-keys" className="mt-0 flex flex-col gap-6">
              <ApiKeysPanel />
              <AgentKeyCard />
            </TabsContent>
          </div>
        </Tabs>
      </DialogContent>
    </Dialog>
  )
}
