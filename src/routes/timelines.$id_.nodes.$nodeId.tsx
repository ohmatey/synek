import { useMemo } from 'react'
import { createFileRoute, Link, useNavigate } from '@tanstack/react-router'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { ReactFlowProvider } from '@xyflow/react'
import { ArrowLeft, FileQuestion, Layers, Redo2, Sparkles, Undo2 } from 'lucide-react'
import { useTheme } from '@synek/ui'
import { getGraph } from '~/lib/server/graph'
import { getStoriesForMomentFn } from '~/lib/server/stories'
import { getEntityContext, undoEntityFn, redoEntityFn } from '~/lib/server/entities'
import { resolveThemeVars } from '~/lib/theme/resolveTimelineTheme'
import { NodeDetailPanel } from '~/components/canvas/NodeDetailPanel'
import { Button } from '~/components/ui/button'
import type { EntityContextResult } from '~/lib/domain/types'

// The dedicated, deep-linkable full-screen page for ONE entity — the docked
// canvas side panel (NodeDetailPanel) decoupled from React Flow and laid out as a
// centered, responsive reading column. It reuses the SAME component (variant
// 'page') so the read/edit form has one source of truth.
//
// Data + visibility ride on getGraph, the SAME query the canvas caches under
// ['graph', timelineId]: owner sees it editable, public timelines are read-only
// viewable (incl. signed-out), private-not-owned is `forbidden`, missing is
// `notFound` — all rendered as one indistinguishable "not available" page. Sharing
// the cache means an edit saved here (which invalidates ['graph', timelineId])
// reflects immediately, exactly as on the canvas.

const OG_DESC_MAX = 160

function truncate(s: string, n = OG_DESC_MAX): string {
  const t = s.trim()
  return t.length <= n ? t : `${t.slice(0, n - 1).trimEnd()}…`
}

export const Route = createFileRoute('/timelines/$id_/nodes/$nodeId')({
  // SSR-load the timeline graph so the OG tags below carry the entity into link
  // unfurls + crawlers. getGraph enforces visibility server-side.
  loader: ({ params }) => getGraph({ data: params.id }),
  head: ({ params, loaderData }) => {
    if (!loaderData || loaderData.status !== 'ok') {
      return { meta: [{ title: 'Entity not found · Synek' }] }
    }
    const node = loaderData.nodes.find((n) => n.id === params.nodeId)
    if (!node) return { meta: [{ title: 'Entity not found · Synek' }] }
    const desc = node.summary?.trim() ? truncate(node.summary) : `An entity on ${loaderData.title}.`
    const img = node.images.find((i) => i.url && i.show !== false)?.url
    return {
      meta: [
        { title: `${node.title} · Synek` },
        { name: 'description', content: desc },
        { property: 'og:type', content: 'article' },
        { property: 'og:site_name', content: 'Synek' },
        { property: 'og:title', content: node.title },
        { property: 'og:description', content: desc },
        ...(img ? [{ property: 'og:image', content: img }] : []),
        { name: 'twitter:card', content: img ? 'summary_large_image' : 'summary' },
        { name: 'twitter:title', content: node.title },
        { name: 'twitter:description', content: desc },
        ...(img ? [{ name: 'twitter:image', content: img }] : []),
      ],
    }
  },
  component: NodePage,
})

function NodePage() {
  const { id: timelineId, nodeId } = Route.useParams()
  const loaderData = Route.useLoaderData()
  const navigate = useNavigate()
  const { resolvedTheme } = useTheme()

  // Live graph, shared with the canvas — a save here invalidates ['graph', …] and
  // this re-reads. Seeded from the SSR loader so first paint needs no round-trip.
  const { data } = useQuery({
    queryKey: ['graph', timelineId],
    queryFn: () => getGraph({ data: timelineId }),
    initialData: loaderData,
  })

  const ok = data && data.status === 'ok' ? data : null
  const node = ok?.nodes.find((n) => n.id === nodeId) ?? null

  // The timeline's resolved theme as inline CSS vars (a branded artifact), for the
  // active scheme — same recipe the canvas + public story page use.
  const themeVars = useMemo(
    () => (ok ? resolveThemeVars(ok.theme, resolvedTheme) : {}),
    [ok, resolvedTheme],
  )

  // The stories on this moment — the SAME query (and cache key) the canvas uses.
  const { data: stories } = useQuery({
    queryKey: ['stories', nodeId],
    queryFn: () => getStoriesForMomentFn({ data: nodeId }),
    enabled: !!node,
  })

  // ADR 0004 — the cross-timeline context: which timelines this entity appears on
  // + the entity's own content undo/redo. Owner-only (the server fn gates it).
  const qc = useQueryClient()
  const isOwner = !!ok?.isOwner
  const { data: ctx } = useQuery({
    queryKey: ['entityContext', timelineId, nodeId],
    queryFn: () => getEntityContext({ data: { timelineId, nodeId } }),
    enabled: isOwner && !!node,
  })
  const entity: Extract<EntityContextResult, { status: 'ok' }> | null =
    ctx && ctx.status === 'ok' ? ctx : null
  // Other timelines this same entity is placed on (the "appears on" links).
  const otherPlacements = entity?.placements.filter((p) => p.timelineId !== timelineId) ?? []

  async function runEntityHistory(dir: 'undo' | 'redo') {
    if (!entity) return
    await (dir === 'undo' ? undoEntityFn : redoEntityFn)({ data: { entityId: entity.entityId } })
    // The edit propagated to every placement; refresh this timeline's graph + the
    // entity's undo/redo state. (Other open timelines refetch via their SSE nudge.)
    await qc.invalidateQueries({ queryKey: ['graph', timelineId] })
    void qc.invalidateQueries({ queryKey: ['entityContext', timelineId, nodeId] })
  }

  if (!ok || !node) {
    return (
      <div className="public-story-missing">
        <div className="psm-card">
          <FileQuestion className="psm-icon" aria-hidden />
          <h1>This entity isn’t available</h1>
          <p>
            The link may be private, moved, or mistyped. Open the timeline it lives on, or start your own.
          </p>
          <Link to="/" className="psr-cta">
            <Sparkles size={16} aria-hidden />
            Make your own with Synek
          </Link>
        </div>
      </div>
    )
  }

  return (
    <div className="node-page-shell" style={themeVars} data-theme-scoped={ok.theme ? '' : undefined}>
      <div className="node-page-bar">
        <Link
          to="/timelines/$id"
          params={{ id: timelineId }}
          search={{ node: nodeId }}
          className="node-page-back"
          data-testid="node-page-back"
        >
          <ArrowLeft size={16} aria-hidden />
          <span className="truncate">{ok.title}</span>
        </Link>
        {/* Content undo/redo on the ENTITY's own stack (ADR 0004), separate from
            the canvas ⌘Z. Owner-only; reverts the shared content on every timeline. */}
        {entity && (
          <div className="node-page-history">
            <Button
              variant="ghost"
              size="icon"
              className="size-7"
              disabled={!entity.canUndo}
              onClick={() => runEntityHistory('undo')}
              aria-label="Undo content edit"
              title="Undo content edit"
              data-testid="entity-undo"
            >
              <Undo2 className="size-4" />
            </Button>
            <Button
              variant="ghost"
              size="icon"
              className="size-7"
              disabled={!entity.canRedo}
              onClick={() => runEntityHistory('redo')}
              aria-label="Redo content edit"
              title="Redo content edit"
              data-testid="entity-redo"
            >
              <Redo2 className="size-4" />
            </Button>
          </div>
        )}
      </div>
      {/* useReactFlow() inside the panel needs a provider; there's no canvas here,
          so a bare provider resolves it to a no-op (the focus-on-canvas button is
          hidden in 'page' variant anyway). */}
      <ReactFlowProvider>
        <NodeDetailPanel
          // Re-key on the node's CONTENT so an external change — an entity content
          // undo/redo (ADR 0004) or a propagated edit from another timeline —
          // remounts the panel with fresh form state instead of stale local edits.
          key={`${node.id}:${node.title}:${node.startInstant}:${node.summary ?? ''}`}
          variant="page"
          node={node}
          edges={ok.edges}
          nodes={ok.nodes}
          timelineId={timelineId}
          readOnly={!ok.isOwner}
          stories={stories}
          // The page has no canvas to preview drafts on; edits persist on Save.
          onDraft={() => {}}
          // Close / delete → back to the canvas with this node selected.
          onClose={() =>
            navigate({ to: '/timelines/$id', params: { id: timelineId }, search: { node: nodeId } })
          }
          // Tapping a relation opens THAT entity's page (stay full-screen).
          onSelectNode={(otherId) =>
            navigate({ to: '/timelines/$id/nodes/$nodeId', params: { id: timelineId, nodeId: otherId } })
          }
          // The reader lives on the canvas — open it there on this story.
          onPlayStory={(storyId) =>
            navigate({ to: '/timelines/$id', params: { id: timelineId }, search: { node: nodeId, story: storyId } })
          }
        />
      </ReactFlowProvider>
      {/* ADR 0004 — this is a SHARED entity: where else it appears. Editing its
          content here propagates to all of these. Owner-only. */}
      {otherPlacements.length > 0 && (
        <section className="node-page-appears" aria-label="Appears on" data-testid="appears-on">
          <h2 className="node-page-appears-label">
            <Layers size={14} aria-hidden /> Also appears on
          </h2>
          <ul className="node-page-appears-list">
            {otherPlacements.map((p) => (
              <li key={p.timelineId}>
                <Link
                  to="/timelines/$id/nodes/$nodeId"
                  params={{ id: p.timelineId, nodeId: p.nodeId }}
                  className="node-page-appears-link"
                >
                  {p.timelineTitle}
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  )
}
