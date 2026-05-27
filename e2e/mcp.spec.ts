import { test, expect } from '@playwright/test'
import { randomBytes, createHash, randomUUID } from 'node:crypto'
import Database from 'better-sqlite3'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'

const MCP_URL = 'http://localhost:3001/api/mcp'

// Create / revoke API keys with direct better-sqlite3 writes against the same
// e2e.db file the server reads (WAL → writes are visible cross-process). Mirrors
// lib/auth/api-keys.ts (`synek_` + base64url, sha256 hash, 12-char prefix). The
// key is owned by the seeded demo user, so MCP (now owner-scoped) sees the demo's
// public timelines and can create/edit under that account.
const e2eDb = () => new Database('e2e.db')

function demoUserId(db: Database.Database): string {
  const row = db.prepare("SELECT id FROM user WHERE email = 'demo@strata.app'").get() as { id: string } | undefined
  if (!row) throw new Error('demo user not found — did the seed run in global-setup?')
  return row.id
}

function createKey(label = 'e2e'): { raw: string; id: string } {
  const raw = 'synek_' + randomBytes(32).toString('base64url')
  const id = randomUUID()
  const db = e2eDb()
  try {
    db.prepare('INSERT INTO api_keys (id, user_id, label, key_hash, prefix, created_at) VALUES (?, ?, ?, ?, ?, ?)').run(
      id,
      demoUserId(db),
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
  const { raw } = createKey('round-trip')
  const client = await connect(raw)

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
