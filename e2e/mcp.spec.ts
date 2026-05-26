import { test, expect } from '@playwright/test'
import { execFileSync } from 'node:child_process'
import { randomBytes, createHash, randomUUID } from 'node:crypto'
import Database from 'better-sqlite3'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'

const MCP_URL = 'http://localhost:3001/api/mcp'

// Mint the local session token the same way users do (`bun run issue:key`) —
// against the throwaway e2e DB the server reads. The script prints prose plus the
// token on its own line; the token is the lone whitespace-free long string.
function issueKey(): string {
  const out = execFileSync('bunx', ['tsx', 'scripts/issue-key.ts'], {
    env: { ...process.env, DATABASE_URL: 'e2e.db' },
    encoding: 'utf8',
  })
  const token = out
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => /^[A-Za-z0-9._-]{20,}$/.test(l))
    .sort((a, b) => b.length - a.length)[0]
  if (!token) throw new Error(`could not parse a token from issue:key output:\n${out}`)
  return token
}

// Create / revoke API keys with direct better-sqlite3 writes against the same
// e2e.db file the server reads (WAL → writes are visible cross-process). This
// mirrors lib/auth/api-keys.ts exactly (`synek_` + base64url, sha256 hash, 12-char
// prefix) but avoids spawning a tsx subprocess per call — those cold-starts made
// the test flaky under parallel load.
const e2eDb = () => new Database('e2e.db')

function createKey(label = 'e2e'): { raw: string; id: string } {
  const raw = 'synek_' + randomBytes(32).toString('base64url')
  const id = randomUUID()
  const db = e2eDb()
  try {
    db.prepare('INSERT INTO api_keys (id, label, key_hash, prefix, created_at) VALUES (?, ?, ?, ?, ?)').run(
      id,
      label,
      createHash('sha256').update(raw).digest('hex'),
      raw.slice(0, 12),
      Date.now(),
    )
  } finally {
    db.close()
  }
  return { raw, id }
}

function revokeKey(id: string): void {
  const db = e2eDb()
  try {
    db.prepare('UPDATE api_keys SET revoked_at = ? WHERE id = ?').run(Date.now(), id)
  } finally {
    db.close()
  }
}

// MCP tool results wrap a single JSON text block — unwrap it.
function unwrap<T>(res: { content?: Array<{ type: string; text?: string }> }): T {
  const text = res.content?.find((c) => c.type === 'text')?.text
  if (!text) throw new Error('tool result had no text content')
  return JSON.parse(text) as T
}

async function connect(token: string): Promise<Client> {
  const transport = new StreamableHTTPClientTransport(new URL(MCP_URL), {
    requestInit: { headers: { Authorization: `Bearer ${token}` } },
  })
  const client = new Client({ name: 'strata-e2e', version: '1.0.0' })
  await client.connect(transport)
  return client
}

test('rejects requests without a Bearer token (401)', async ({ request }) => {
  const res = await request.post('/api/mcp', {
    headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream' },
    data: { jsonrpc: '2.0', id: 1, method: 'tools/list', params: {} },
  })
  expect(res.status()).toBe(401)
})

test('a named API key authorizes the MCP server, and revoking it returns 401', async ({ request }) => {
  const { raw, id } = createKey('e2e key')
  expect(raw.startsWith('synek_')).toBe(true)

  // The key authorizes a real tool call.
  const client = await connect(raw)
  try {
    const timelines = unwrap<Array<{ id: string }>>(
      await client.callTool({ name: 'list_timelines', arguments: {} }),
    )
    expect(Array.isArray(timelines)).toBe(true)
  } finally {
    await client.close()
  }

  // After revoke, the same key is rejected.
  revokeKey(id)
  const res = await request.post('/api/mcp', {
    headers: {
      'content-type': 'application/json',
      accept: 'application/json, text/event-stream',
      authorization: `Bearer ${raw}`,
    },
    data: { jsonrpc: '2.0', id: 1, method: 'tools/list', params: {} },
  })
  expect(res.status()).toBe(401)
})

test('apply_patch then get_timeline round-trips through the MCP server', async () => {
  const token = issueKey()
  const client = await connect(token)

  try {
    // A fresh timeline so the assertion is isolated from the seed.
    const created = unwrap<{ id: string }>(
      await client.callTool({ name: 'create_timeline', arguments: { title: 'MCP round-trip' } }),
    )
    expect(created.id).toBeTruthy()

    // One atomic Patch: two nodes wired by an edge via in-batch `ref` aliases.
    const patched = unwrap<{ patchId: string; results: Array<Record<string, unknown>>; canUndo: boolean }>(
      await client.callTool({
        name: 'apply_patch',
        arguments: {
          timelineId: created.id,
          summary: 'seed two events and an edge',
          ops: [
            { op: 'add_node', ref: 'a', type: 'event', title: 'MCP node A', start: '2001' },
            { op: 'add_node', ref: 'b', type: 'event', title: 'MCP node B', start: '2002' },
            { op: 'add_edge', sourceId: 'a', targetId: 'b', kind: 'caused' },
          ],
        },
      }),
    )
    expect(patched.patchId).toBeTruthy()
    expect(patched.results).toHaveLength(3)
    expect(patched.results.every((r) => 'id' in r)).toBe(true)
    expect(patched.canUndo).toBe(true)

    // Read it back: the write landed in the DB the viewer reads.
    const graph = unwrap<{ title: string; nodes: Array<{ title: string }>; edges: unknown[] }>(
      await client.callTool({ name: 'get_timeline', arguments: { timelineId: created.id } }),
    )
    expect(graph.title).toBe('MCP round-trip')
    expect(graph.nodes.map((n) => n.title).sort()).toEqual(['MCP node A', 'MCP node B'])
    expect(graph.edges).toHaveLength(1)
  } finally {
    await client.close()
  }
})
