// Expand the Martech timeline around "Agentic Marketing" as ONE atomic Patch.
// Same db-layer the MCP apply_patch tool uses (PatchBuilder + applyOps + commitPatch),
// run directly because the plugin's MCP OAuth token is expired. All facts/citations
// are web-verified (real URLs + verbatim quotes). Run:
//   DATABASE_URL=local.db bunx tsx scripts/expand-agentic.ts
import { loadGraph, getTimelineMeta } from '../src/lib/db/graph'
import { PatchBuilder, commitPatch } from '../src/lib/db/patches'
import { applyOps } from '../src/lib/mcp/ops'
import { collectPatchWarnings } from '../src/lib/mcp/warnings'

const TL = 'afb28757-0871-4600-a781-9e062d3d8b75'
const AGENTIC = '860b763a-880c-4d32-af4e-cef74239cf5b' // Agentic Marketing (concept)
const ADOBE = 'a76b5442-3b89-416e-b438-918f4b6f53e5' // Adobe (org)
const AGENTFORCE = '47fcc744-18b3-4857-957a-f6008df22397' // Einstein GPT → Agentforce

const ops: any[] = [
  {
    op: 'add_node', ref: 'autogpt', type: 'entity', subtype: 'work', lane: 'Agentic AI',
    title: 'AutoGPT', start: '2023-03-30', precision: 'day', geoScope: 'diffuse',
    summary: "The open-source project (Toran Bruce Richards / Significant Gravitas) that let GPT-4 pursue a goal on its own — breaking it into sub-tasks and using tools. One of the fastest-growing repos in GitHub history, it put 'AI agents' on the map and kicked off the agentic wave.",
    citations: [{ title: 'AutoGPT — Wikipedia', url: 'https://en.wikipedia.org/wiki/AutoGPT', sourceType: 'scholarship', quote: 'Unlike chatbots that require continuous user commands, AutoGPT works autonomously by breaking the main goal into smaller sub-tasks and using tools like web browsing and file management to complete them.' }],
  },
  {
    op: 'add_node', ref: 'ng', type: 'entity', subtype: 'person', lane: 'Agentic AI',
    title: 'Andrew Ng', start: '2024-03', precision: 'month', location: 'Palo Alto, California', lat: 37.44, lng: -122.14,
    summary: "AI researcher (co-founder of Google Brain and Coursera; leads AI Fund and DeepLearning.AI). In 2024 he popularized 'agentic workflows' — reflection, tool use, planning, multi-agent collaboration — as the design pattern behind the shift from one-shot prompting to autonomous agents.",
    images: [{ url: 'https://upload.wikimedia.org/wikipedia/commons/thumb/2/20/Andrew_Ng_at_TechCrunch_Disrupt_SF_2017.jpg/250px-Andrew_Ng_at_TechCrunch_Disrupt_SF_2017.jpg', alt: 'Andrew Ng', aspect: 'portrait' }],
    citations: [{ title: "What's next for AI agentic workflows — Andrew Ng (Sequoia AI Ascent 2024)", url: 'https://www.youtube.com/watch?v=sal78ACtGTc', sourceType: 'press', quote: 'I think AI agentic workflows will drive massive AI progress this year — perhaps even more than the next generation of foundation models.' }],
  },
  {
    op: 'add_node', ref: 'claude_cu', type: 'event', lane: 'Agentic AI',
    title: "Anthropic — Claude 'computer use'", start: '2024-10-22', precision: 'day', location: 'San Francisco, California', lat: 37.77, lng: -122.42,
    summary: 'Anthropic releases computer use in public beta — Claude 3.5 Sonnet becomes the first frontier model able to operate software like a person (move a cursor, click, type). A key enabler for agents that act inside real marketing tools, not just chat.',
    citations: [{ title: 'Introducing computer use, a new Claude 3.5 Sonnet, and Claude 3.5 Haiku — Anthropic', url: 'https://www.anthropic.com/news/3-5-models-and-computer-use', sourceType: 'press', quote: 'Available today on the API, developers can direct Claude to use computers the way people do—by looking at a screen, moving a cursor, clicking buttons, and typing text.' }],
  },
  {
    op: 'add_node', ref: 'msft_agents', type: 'event', lane: 'Agentic AI',
    title: 'Microsoft — autonomous agents in Copilot Studio', start: '2024-11', precision: 'month', location: 'Redmond, Washington', lat: 47.67, lng: -122.12,
    summary: "Microsoft brings autonomous agents to Copilot Studio (announced Oct 2024; public preview at Ignite, Nov 2024) — agents that act in the background on business processes, including sales and marketing, escalating the 'agent wars' with Salesforce.",
    citations: [{ title: 'Unlocking autonomous agent capabilities with Microsoft Copilot Studio — Microsoft', url: 'https://www.microsoft.com/en-us/microsoft-copilot/blog/copilot-studio/unlocking-autonomous-agent-capabilities-with-microsoft-copilot-studio/', sourceType: 'press', quote: 'These agents understand the nature of your work and act on your behalf—providing support across business roles, teams, and functions.' }],
  },
  {
    op: 'add_node', ref: 'gartner', type: 'event', lane: 'Agentic AI',
    title: 'Gartner names Agentic AI the #1 strategic tech trend for 2025', start: '2024-10-21', precision: 'day', location: 'Stamford, Connecticut', lat: 41.05, lng: -73.54,
    summary: 'Gartner names agentic AI the top strategic technology trend for 2025 — analyst validation that autonomous, goal-driven agents are the next enterprise (and marketing) wave.',
    citations: [{ title: 'Gartner Identifies the Top 10 Strategic Technology Trends for 2025', url: 'https://www.gartner.com/en/newsroom/press-releases/2024-10-21-gartner-identifies-the-top-10-strategic-technology-trends-for-2025', sourceType: 'scholarship', quote: 'By 2028, at least 15% of day-to-day work decisions will be made autonomously through agentic AI, up from 0% in 2024.' }],
  },
  {
    op: 'add_node', ref: 'adobe_agentic', type: 'event', lane: 'Adobe',
    title: 'Adobe — Experience Platform Agent Orchestrator', start: '2025-03-18', precision: 'day', location: 'San Jose, California', lat: 37.33, lng: -121.89,
    summary: 'At Adobe Summit 2025, Adobe launches the Experience Platform Agent Orchestrator and ~10 purpose-built marketing agents (audience, experimentation, content) — agentic AI brought directly into the marketing cloud.',
    citations: [{ title: 'Adobe Summit 2025: Adobe AI Platform Unites Creativity and Marketing — Adobe', url: 'https://news.adobe.com/news/2025/03/adobe-summit-2025-adobe-ai-platform-unites-creativity-marketing', sourceType: 'press', quote: 'Businesses will be able to manage and orchestrate AI agents—across Adobe and third parties—through a single interface.' }],
  },

  // edges: new → Agentic Marketing, among the new track, and into existing nodes
  { op: 'add_edge', sourceId: 'autogpt', targetId: AGENTIC, kind: 'influenced', label: 'the breakout that named the wave' },
  { op: 'add_edge', sourceId: 'autogpt', targetId: 'ng', kind: 'influenced' },
  { op: 'add_edge', sourceId: 'ng', targetId: AGENTIC, kind: 'influenced', label: 'named the design pattern' },
  { op: 'add_edge', sourceId: 'claude_cu', targetId: AGENTIC, kind: 'influenced', label: 'agents can operate software' },
  { op: 'add_edge', sourceId: 'msft_agents', targetId: AGENTIC, kind: 'influenced' },
  { op: 'add_edge', sourceId: 'msft_agents', targetId: AGENTFORCE, kind: 'competed_with', label: 'the AI agent wars' },
  { op: 'add_edge', sourceId: 'gartner', targetId: AGENTIC, kind: 'influenced', label: 'named the #1 trend' },
  { op: 'add_edge', sourceId: 'adobe_agentic', targetId: AGENTIC, kind: 'influenced' },
  { op: 'add_edge', sourceId: ADOBE, targetId: 'adobe_agentic', kind: 'caused' },
]

async function main() {
  const builder = new PatchBuilder(TL, loadGraph(TL))
  const { results } = applyOps(builder, ops)
  const patchId = commitPatch(TL, builder, 'Expand around Agentic Marketing — AutoGPT, Ng, Claude computer use, Microsoft/Adobe agents, Gartner')
  const added = results.filter((r: any) => r.id)
  const warnings = await collectPatchWarnings(loadGraph(TL), ops, getTimelineMeta(TL)?.viewSettings ?? null)
  console.log(`patch ${patchId}`)
  console.log(`nodes+edges applied: ${added.length} (6 nodes + 9 edges expected)`)
  console.log('warnings:', warnings.length ? JSON.stringify(warnings, null, 2) : 'none')
  console.log('canvas: http://localhost:3001/timelines/' + TL)
}
main().catch((e) => { console.error('THREW:', e); process.exit(1) })
