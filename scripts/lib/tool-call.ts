import { z } from 'zod'
import { toolRegistry, type ToolCtx } from '../../src/lib/mcp/registry'

// Call a registry tool the way BOTH real callers do: parse the raw args through the
// tool's own inputSchema, then hand the PARSED args to the handler. The MCP SDK and
// the in-app agent runner both do this, and a handler invoked directly skips it,
// which hides schema-drift bugs: a field a handler reads but the schema omits is
// silently stripped in production (patch_story update_meta's `cast` was exactly
// this) yet works fine when a script calls the handler with its own object.

// Thrown when a script's payload would not survive the tool's schema intact, i.e. the
// real transports would reject it or silently alter it before any handler ran. Kept
// distinct from a handler throwing so a `denied()` authorization check can refuse to
// count it: otherwise a malformed payload would "deny" the call and pass vacuously.
export class ToolInputError extends Error {
  constructor(tool: string, detail: string) {
    super(`${tool}: ${detail}`)
    this.name = 'ToolInputError'
  }
}

// Paths present in `input` that are missing from `output`. z.object STRIPS keys it
// does not declare, at every depth, so this is how a field the handler was meant to
// receive (but the schema forgot) shows up in a test instead of in production.
function droppedKeys(input: unknown, output: unknown, path = ''): string[] {
  if (Array.isArray(input)) {
    return input.flatMap((v, i) => droppedKeys(v, Array.isArray(output) ? output[i] : undefined, `${path}[${i}]`))
  }
  if (input && typeof input === 'object') {
    const out = (output && typeof output === 'object' ? output : {}) as Record<string, unknown>
    return Object.entries(input).flatMap(([k, v]) => {
      if (v === undefined) return []
      const here = path ? `${path}.${k}` : k
      return k in out ? droppedKeys(v, out[k], here) : [here]
    })
  }
  return []
}

export function tool(name: string) {
  const def = toolRegistry.find((t) => t.name === name)
  if (!def) throw new Error(`tool ${name} not found`)
  const shape = z.object(def.inputSchema)
  return {
    name,
    handler: async (rawArgs: unknown, ctx: ToolCtx): Promise<unknown> => {
      const parsed = shape.safeParse(rawArgs)
      if (!parsed.success) {
        throw new ToolInputError(name, `payload does not satisfy the tool's inputSchema (${z.prettifyError(parsed.error)})`)
      }
      const dropped = droppedKeys(rawArgs, parsed.data)
      if (dropped.length > 0) {
        throw new ToolInputError(
          name,
          `inputSchema would silently drop ${dropped.join(', ')} (advertised-but-unaccepted field, or a typo)`,
        )
      }
      return def.handler(parsed.data, ctx)
    },
  }
}
