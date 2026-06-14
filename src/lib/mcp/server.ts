import { McpServer, ResourceTemplate } from '@modelcontextprotocol/sdk/server/mcp.js'
import { listTimelines, loadGraph, getTimelineTitle, getTimelineMeta } from '~/lib/db/graph'
import { captureServer } from '~/lib/posthog/server'
import { toolRegistry, makeRequireOwned, type ToolCtx } from './registry'

const json = (data: unknown) => ({ content: [{ type: 'text' as const, text: JSON.stringify(data) }] })

// Per-tool analytics enrichment — cheap props derived mostly from the input args
// (parse-free). For apply_patch we also read the already-computed graphSummary +
// warnings out of the result text once, inside a try/catch so an analytics parse
// error can never fail the tool call.
function enrich(name: string, args: any, result: any): Record<string, unknown> {
  if (name === 'apply_patch') {
    const ops: any[] = Array.isArray(args?.ops) ? args.ops : []
    const counts: Record<string, number> = {}
    for (const op of ops) {
      if (typeof op?.op === 'string') counts[`ops_${op.op}`] = (counts[`ops_${op.op}`] ?? 0) + 1
    }
    const extra: Record<string, unknown> = { ops_total: ops.length, ...counts }
    try {
      const payload = JSON.parse(result?.content?.[0]?.text ?? '{}')
      if (payload.graphSummary) {
        extra.nodes_total = payload.graphSummary.nodes
        extra.edges_total = payload.graphSummary.edges
      }
      if (Array.isArray(payload.warnings)) extra.warnings = payload.warnings.length
    } catch {
      /* result shape changed — skip enrichment, never fail the tool */
    }
    return extra
  }
  if (name === 'write_story') {
    const segs: any[] = Array.isArray(args?.segments) ? args.segments : []
    const artifactCites = segs.reduce(
      (n, s) => n + (Array.isArray(s?.citations) ? s.citations.filter((c: any) => c && 'artifactId' in c).length : 0),
      0,
    )
    return {
      segments: segs.length,
      cast: Array.isArray(args?.cast) ? args.cast.length : 0,
      artifact_citations: artifactCites,
    }
  }
  if (name === 'register_artifact') {
    return { has_source: !!args?.source, linked_moment: !!args?.momentId, has_transcript: !!args?.transcript }
  }
  if (name === 'search_artifacts') {
    return { query_length: typeof args?.query === 'string' ? args.query.length : 0, scoped: !!args?.timelineId }
  }
  if (name === 'set_timeline_theme') {
    const t = args?.theme
    return {
      cleared: t === null,
      schemes: t?.colors ? Object.keys(t.colors).length : 0,
      color_slots: t?.colors
        ? Object.values(t.colors).reduce((n: number, s: any) => n + Object.keys(s ?? {}).length, 0)
        : 0,
      font: t?.font?.display ?? null,
      texture: t?.texture ?? null,
      has_image_style: !!t?.imageStyle,
      mood_count: Array.isArray(t?.mood) ? t.mood.length : 0,
    }
  }
  return {}
}

// One MCP server per request/connection, scoped to the OWNER behind the API key:
// every tool only sees and mutates that user's timelines. Reads are exposed as
// tools (so agentic clients can fetch mid-loop) AND mirrored as a read-only
// resource. ALL writes go through apply_patch. The tool surface itself lives in
// ./registry (shared with the in-app agent runner) — this factory only wraps each
// handler for the MCP transport: analytics + the { content:[{text}] } envelope.
export function buildMcpServer(ownerId: string): McpServer {
  const server = new McpServer(
    { name: 'synek', version: '0.1.0' },
    {
      instructions:
        'Synek is the user\'s spatial memory — where their research lives, visually, on a timeline. ' +
        'After create_timeline, SHARE the returned `url` with the user so they can open the canvas and watch it build. ' +
        'The canvas updates LIVE as you apply patches — never tell the user to refresh. ' +
        'READ cheaply: get_timeline returns the FULL graph (every summary + citation) and gets very large — for mid-build reads prefer query_timeline (filtered, compact rows), get_node (one node + its edges + stories), and get_layout_report (a whole-graph shape review). ' +
        'MUTATE the graph ONLY via apply_patch — one call = one undoable Patch holding a batch of ops. ' +
        'Within a batch, set `ref` on an add_node and reuse that alias as an edge endpoint to wire edges to nodes created in the same call. ' +
        'Give nodes a FACE, not a bare box: when you know a real, web-accessible image for a node (a Wikimedia portrait for a person, an official logo for an org, public-domain art for an era/event), pass it in the add_node/update_node `images` field as a URL. Set each image\'s `aspect` to "portrait" for tall subjects (a standing person, a headshot) or "landscape" for wide ones (scenes, logos) so it is framed correctly. Synek stores and renders it; it does not generate images. ' +
        'Give nodes a PLACE too: set `location` ("Golgotha, Jerusalem") where it adds texture, and when you know where it happened also pass `lat`/`lng` (decimal degrees, city-level precision is plenty) — those coordinates plot the node on the globe lens, which the user can play through to watch history move across the map. When a node genuinely CANNOT be pinned, say so explicitly with `geoScope` instead of skipping it: "global" (happened everywhere — a worldwide era), "diffuse" (several real sites, no single anchor), or "unknown" (the place is lost to history) — the globe narrates these as captions, coverage counts them as resolved, and NEVER guess coordinates as a substitute. get_layout_report returns a `coordinates` section (located / placeless / unset counts + a sample of the undecided nodes) so you can resolve them — pin or mark, every node gets a verdict — in one apply_patch. ' +
        'CITE with links: every citation takes a `url` — add a stable public link wherever one exists (and never invent one); title-only is fine for print sources. apply_patch verifies the links you pass and warns on dead ones. ' +
        'undo / redo step the per-timeline history. ' +
        'After building (or reshaping) a timeline, call set_timeline_view to pick the default zoom (pxPerDay) and gap collapsing so the canvas opens readable — heed the density warnings apply_patch returns. ' +
        'THEME the timeline to match its subject: call set_timeline_theme with freeform hex accents (per dark AND light scheme — an omitted scheme falls back to the default look), an optional canvas background wash, a display font (default | serif | slab | mono | rounded | grotesk), and a texture (none | dots | grid | paper) — a Roman timeline can feel like marble and ink, a startup timeline like a launch deck. Set `imageStyle` (a short image-generation style fragment) and `mood` keywords, then REUSE them: read the theme back via get_timeline and fold imageStyle/mood into every image or copy prompt you produce for this timeline so its art stays coherent. Heed the contrast warnings set_timeline_theme returns. ' +
        'After a multi-patch build, call get_layout_report and ACT on it — merge near-duplicate lanes, re-lane drifted nodes, fill story-poor eras, fix dead axis zones — before declaring the timeline done. ' +
        'To attach a NARRATIVE to a moment (node), call write_story with that node\'s id (momentId) and an ordered list of beats — stories are separate from the graph, written directly, and are NOT part of the undo/redo Patch stack. A moment can hold SEVERAL stories: omit `storyId` to create a new one, or pass an existing story\'s id to update it in place. Set a beat\'s `focusNodeId` to another node id to make the canvas pan to that entity and the panel beside the story switch to it as the reader reaches that beat (a guided tour); omit it to stay on the moment. ' +
        'Give stories a CAST: make sure the story\'s key characters exist as entity nodes FIRST (apply_patch), then pass them in `cast` and tour them with focusNodeId — write_story warns about cast names that have no node yet. ' +
        'Give stories ART: a story takes a `coverImage` and each beat an `image` ({url, aspect, layout: full | inset-left | inset-right | bleed}) — a sensory beat with a period artwork reads like a scene. Same sourcing rules as node images: real URLs only. ' +
        'GROUND beats in reusable SOURCES: for a primary source you will cite more than once or want to find again later (a letter, diary, photo, inscription, record), call register_artifact — it stores the transcript + reliability and returns an `artifactId` you pass as a beat citation `{ artifactId, excerptUsed }` in write_story (reusable + searchable), instead of an inline `{ title, url, quote }` one-off. Recall a prior artifact in a LATER session with search_artifacts and cite it again; link an artifact to a moment so it can sit on the canvas. ' +
        'You only see and edit your own timelines.',
    },
  )

  const requireOwned = makeRequireOwned(ownerId)
  const ctx: ToolCtx = { ownerId, requireOwned }

  // One analytics event per tool call, threaded through a single wrapper so it
  // covers ALL tools across BOTH transports (HTTP + stdio both build via this
  // factory). distinct_id = ownerId, the same Better Auth id the browser client
  // uses, so client + server events land on one PostHog person. No-ops without a
  // server key. `cb` is `any` to sidestep the SDK's generic ToolCallback overloads
  // — the config/handler still type-check at each call site.
  const register: typeof server.registerTool = (name, config, cb: any) =>
    server.registerTool(name, config, (async (args: any, extra: any) => {
      const t0 = performance.now()
      try {
        const result = await cb(args, extra)
        captureServer(ownerId, 'mcp_tool_called', {
          tool: name,
          ok: true,
          duration_ms: Math.round(performance.now() - t0),
          ...(args?.timelineId ? { timeline_id: args.timelineId } : {}),
          ...enrich(name, args, result),
        })
        return result
      } catch (err) {
        captureServer(ownerId, 'mcp_tool_called', {
          tool: name,
          ok: false,
          duration_ms: Math.round(performance.now() - t0),
          ...(args?.timelineId ? { timeline_id: args.timelineId } : {}),
          error: err instanceof Error ? err.message : String(err),
        })
        throw err
      }
    }) as any)

  // Wire the shared registry onto the MCP transport: run the raw handler, then
  // wrap its result in the MCP content envelope. inputSchema is the ZodRawShape
  // registerTool already expects.
  for (const tool of toolRegistry) {
    register(
      tool.name,
      { title: tool.title, description: tool.description, inputSchema: tool.inputSchema },
      async (args: any) => json(await tool.handler(args, ctx)),
    )
  }

  // Read-only resource mirror — this owner's timelines only, never writes.
  server.registerResource(
    'timeline',
    new ResourceTemplate('synek://timeline/{timelineId}', {
      list: async () => ({
        resources: listTimelines(ownerId).map((t) => ({
          uri: `synek://timeline/${t.id}`,
          name: t.title,
          mimeType: 'application/json',
        })),
      }),
    }),
    { title: 'Timeline graph', description: 'A timeline\'s nodes and edges as JSON.', mimeType: 'application/json' },
    async (uri, { timelineId }) => {
      const id = String(timelineId)
      requireOwned(id)
      return {
        contents: [
          {
            uri: uri.href,
            mimeType: 'application/json',
            text: JSON.stringify({ title: getTimelineTitle(id), theme: getTimelineMeta(id)?.theme ?? null, ...loadGraph(id) }),
          },
        ],
      }
    },
  )

  return server
}
