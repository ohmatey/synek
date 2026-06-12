import { Button } from '~/components/ui/button'
import { verbsForNode, type VerbContext } from '~/lib/verbs'
import type { PromptSpec } from '~/components/PromptDialog'
import type { GraphNode } from '~/lib/domain/types'

// The verb action row (NEXT.5 Tier 1 — docs/product/prd/next5-verb-system.md).
// Renders the verbs that apply to THIS node (filtered by each verb's `showWhen`),
// reading the one shared registry so the panel and ⌘K never drift. `onRun` hands
// the built PromptSpec up to whoever owns the shared PromptDialog.
//
// `exclude` lets a surface drop verbs it already covers another way — the node
// panel excludes 'write-story' because its dedicated Story section is right below.
export function NodeVerbBar({
  node,
  ctx,
  onRun,
  exclude,
}: {
  node: GraphNode
  ctx: VerbContext
  onRun: (spec: PromptSpec) => void
  exclude?: string[]
}) {
  const verbs = verbsForNode(node).filter((v) => !exclude?.includes(v.id))
  if (verbs.length === 0) return null

  return (
    <div className="mt-3 flex flex-wrap gap-2">
      {verbs.map((v) => {
        const Icon = v.icon
        return (
          <Button
            key={v.id}
            variant="outline"
            size="sm"
            className="h-8 gap-1.5"
            onClick={() => onRun(v.makeSpec(node, ctx))}
          >
            <Icon className="size-4" />
            {v.label(node)}
          </Button>
        )
      })}
    </div>
  )
}
