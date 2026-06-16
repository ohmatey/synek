import { Dialog, DialogContent, DialogDescription, DialogTitle } from '~/components/ui/dialog'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '~/components/ui/tabs'
import { VTAB } from '~/components/ui/vtab'
import { AccountPanel } from './AccountPanel'
import { ApiKeysPanel } from './ApiKeysPanel'
import { AgentKeyCard } from './AgentKeyCard'

export type SettingsTab = 'account' | 'api-keys'

const TAB_LABEL: Record<SettingsTab, string> = {
  account: 'Account',
  'api-keys': 'API keys',
}

// The signed-in settings surface: one modal with LEFT-SIDE vertical tabs. A fixed
// height keeps the dialog from resizing as you switch tabs; an aligned header row
// across both panes gives the close button a clean home (it no longer overlaps the
// content). The /account and /api-keys routes remain as deep-link fallbacks.
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
      <DialogContent className="flex h-[min(85vh,40rem)] gap-0 overflow-hidden p-0 sm:max-w-2xl">
        <Tabs
          orientation="vertical"
          value={tab}
          onValueChange={(v) => onTabChange(v as SettingsTab)}
          className="flex min-h-0 w-full flex-row gap-0"
        >
          <div className="flex w-44 shrink-0 flex-col border-r border-border bg-muted/30">
            <div className="flex h-14 shrink-0 items-center border-b border-border px-4">
              <DialogTitle className="text-sm font-semibold">Settings</DialogTitle>
              <DialogDescription className="sr-only">
                Manage your account, privacy, session, and connected keys.
              </DialogDescription>
            </div>
            <TabsList className="flex h-auto w-full flex-col items-stretch gap-1 rounded-none bg-transparent p-3">
              <TabsTrigger value="account" className={VTAB}>
                Account
              </TabsTrigger>
              <TabsTrigger value="api-keys" className={VTAB}>
                API keys
              </TabsTrigger>
            </TabsList>
          </div>

          <div className="flex min-h-0 flex-1 flex-col">
            <header className="flex h-14 shrink-0 items-center border-b border-border px-5 pr-12">
              <h2 className="text-sm font-semibold">{TAB_LABEL[tab]}</h2>
            </header>
            <div className="min-h-0 flex-1 overflow-y-auto p-5">
              <TabsContent value="account" className="mt-0">
                <AccountPanel />
              </TabsContent>
              <TabsContent value="api-keys" className="mt-0 flex flex-col gap-6">
                <ApiKeysPanel />
                <AgentKeyCard />
              </TabsContent>
            </div>
          </div>
        </Tabs>
      </DialogContent>
    </Dialog>
  )
}
