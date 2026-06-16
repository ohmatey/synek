import { Dialog, DialogContent, DialogDescription, DialogTitle } from '~/components/ui/dialog'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '~/components/ui/tabs'
import { VTAB } from '~/components/ui/vtab'
import { AccountPanel } from './AccountPanel'
import { ApiKeysPanel } from './ApiKeysPanel'
import { AgentKeyCard } from './AgentKeyCard'

export type SettingsTab = 'account' | 'api-keys'

// The signed-in settings surface, consolidated into one modal with LEFT-SIDE
// vertical tabs (a settings rail) so it opens over the current view instead of
// navigating away. Composes the same self-contained panels the /account and
// /api-keys routes use — those routes remain as deep-link fallbacks.
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
      <DialogContent className="flex max-h-[85vh] gap-0 overflow-hidden p-0 sm:max-w-2xl">
        <Tabs
          orientation="vertical"
          value={tab}
          onValueChange={(v) => onTabChange(v as SettingsTab)}
          className="flex min-h-0 w-full flex-row gap-0"
        >
          <div className="flex w-44 shrink-0 flex-col gap-1 border-r border-border bg-muted/30 p-3">
            <DialogTitle className="px-2 pb-1 pt-1.5 text-sm font-semibold">Settings</DialogTitle>
            <DialogDescription className="sr-only">
              Manage your account, privacy, session, and connected keys.
            </DialogDescription>
            <TabsList className="flex h-auto w-full flex-col items-stretch gap-1 rounded-none bg-transparent p-0">
              <TabsTrigger value="account" className={VTAB}>
                Account
              </TabsTrigger>
              <TabsTrigger value="api-keys" className={VTAB}>
                API keys
              </TabsTrigger>
            </TabsList>
          </div>

          <div className="min-h-0 flex-1 overflow-y-auto p-5">
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
