import { readFileSync, existsSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

// The in-app agent runs the SAME tools as the user's external Claude, so it should
// follow the SAME authoring doctrine. Single source of truth: the plugin's
// building-timelines SKILL.md — read at module load, never duplicated. Falls back
// to a condensed inline doctrine if the file can't be located (e.g. an image that
// didn't ship the plugin tree), so the runner never crashes.

// The plugin ships into the Docker image (Dockerfile `COPY . .` → /app), so cwd-
// relative resolves in the container; the source-relative path resolves under tsx.
function doctrinePath(): string | null {
  const here = path.dirname(fileURLToPath(import.meta.url))
  const candidates = [
    process.env.SYNEK_AGENT_DOCTRINE,
    path.resolve(here, '../../../synek-plugin/skills/building-timelines/SKILL.md'),
    path.resolve(process.cwd(), 'synek-plugin/skills/building-timelines/SKILL.md'),
  ].filter((p): p is string => Boolean(p))
  return candidates.find((p) => existsSync(p)) ?? null
}

// Strip YAML frontmatter (the leading --- … --- block) so the model gets prose.
function stripFrontmatter(md: string): string {
  if (!md.startsWith('---')) return md
  const end = md.indexOf('\n---', 3)
  return end === -1 ? md : md.slice(md.indexOf('\n', end + 1) + 1).trimStart()
}

const FALLBACK_DOCTRINE = `# Building good Synek timelines
Synek is a single-user timeline canvas. Drive it through the tools below. Your job is not a valid graph — it's one a person wants to look at: real people, real dates, meaningful connections, a story that reads left-to-right.
- ALL writes go through apply_patch: assemble the whole map (or a coherent chunk) and send it as ONE call = one undoable Patch. Within a batch, set \`ref\` on an add_node and reuse that alias as an edge endpoint.
- Nodes: type event|entity|period|concept; a real (fuzzy ok) \`start\` ("49 BCE", "Q3 2008"); omit \`end\` for events; always write a 1–3 sentence \`summary\`; set \`subtype\` (person|org|place|work) on entities; use \`lane\` for parallel tracks.
- Edges: closed set caused|succeeded|influenced|acquired|competed_with — few, deliberate, typed.
- Cite freely with real URLs (never invent one). Read before you write (get_layout_report / query_timeline) so you don't duplicate existing nodes.
- A row of bare gray boxes is a failure even if every op succeeded.`

const PREAMBLE = `You are Synek's built-in timeline agent. The user has the canvas OPEN and it updates LIVE as you call tools — never tell them to refresh, and never hand back a link to a localhost server. Work ONLY on the timeline id given in the user's request; do not create a new timeline unless explicitly asked. Use the read tools (get_layout_report, query_timeline, get_node) before writing so you build on what's already there instead of duplicating it. Make every change through the tools — do not just describe what you would do. When you're done, reply with ONE short paragraph summarizing exactly what you changed (counts, names). If there was nothing to do, say so plainly. Follow the authoring doctrine below.`

let cached: string | null = null

// The runner's system prompt: a short operating preamble + the shared authoring
// doctrine. Cached after first load.
export function agentSystemPrompt(): string {
  if (cached) return cached
  const p = doctrinePath()
  const doctrine = p ? stripFrontmatter(readFileSync(p, 'utf8')) : FALLBACK_DOCTRINE
  cached = `${PREAMBLE}\n\n---\n\n${doctrine}`
  return cached
}
