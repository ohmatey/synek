import { z } from 'zod'
import { toolRegistry } from '../src/lib/mcp/registry'
import { agentSystemPrompt } from '../src/lib/agent/system-prompt'
import { agentEnabled, defaultModel } from '../src/lib/agent/config'

// Proves the in-app agent's plumbing WITHOUT a key or a network call: the shared
// tool registry is intact, every tool's Zod input schema converts to JSON Schema
// (the opSchema discriminated-union smoke test for the function-calling loop), and
// the system-prompt doctrine loads. The live OpenRouter round-trip needs a real key
// and is a manual check. Run under Node: `bun run verify:agent`.

const EXPECTED = [
  'list_timelines',
  'create_timeline',
  'get_timeline',
  'query_timeline',
  'get_node',
  'get_layout_report',
  'apply_patch',
  'set_timeline_view',
  'set_timeline_theme',
  'write_story',
  'register_artifact',
  'search_artifacts',
  'undo',
  'redo',
]

function assert(cond: boolean, msg: string) {
  if (!cond) throw new Error(`FAIL: ${msg}`)
  console.log(`  ✓ ${msg}`)
}

function main() {
  // 1. Registry shape
  const names = toolRegistry.map((t) => t.name)
  assert(names.length === EXPECTED.length, `registry has ${EXPECTED.length} tools (got ${names.length})`)
  assert(new Set(names).size === names.length, 'tool names are unique')
  assert(EXPECTED.every((n) => names.includes(n)), 'all expected tools are present')

  // 2. Every tool's input schema converts to draft-07 JSON Schema (what the runner
  //    feeds OpenRouter as function `parameters`).
  for (const t of toolRegistry) {
    const schema = z.toJSONSchema(z.object(t.inputSchema), { target: 'draft-07' }) as any
    assert(schema?.type === 'object', `${t.name}: JSON Schema is an object`)
  }

  // 3. apply_patch's ops array (the discriminated union) is the riskiest conversion.
  const applyPatch = toolRegistry.find((t) => t.name === 'apply_patch')!
  const apSchema = z.toJSONSchema(z.object(applyPatch.inputSchema), { target: 'draft-07' }) as any
  const opsItems = apSchema?.properties?.ops?.items
  assert(!!opsItems && (Array.isArray(opsItems.anyOf) || Array.isArray(opsItems.oneOf) || !!opsItems.type),
    'apply_patch.ops converts to a union/array item schema')

  // 4. The shared doctrine loads (single source of truth for both transports).
  const sys = agentSystemPrompt()
  assert(sys.length > 200, 'system prompt is non-empty')
  assert(sys.includes('apply_patch'), 'system prompt carries the authoring doctrine')

  // 5. Config surface
  assert(defaultModel().length > 0, `defaultModel resolves ("${defaultModel()}")`)
  console.log(`  · agentEnabled() = ${agentEnabled()} (OPENROUTER_API_KEY ${agentEnabled() ? 'set' : 'unset'})`)

  console.log('\nAgent plumbing verified ✓  (live OpenRouter round-trip needs a key — manual check)')
}

main()
