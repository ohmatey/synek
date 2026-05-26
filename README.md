# Strata

**Strata** (display name *Chronograph*) is a temporally-anchored **knowledge canvas** — a visual mesh of typed nodes and relationships laid out along a horizontal timeline.

Strata is **driven from outside via an MCP server**. The app itself contains **no AI**. You connect your own [MCP](https://modelcontextprotocol.io) client — Claude Desktop, Claude Code, or anything that speaks MCP — with an access token, and that client's model creates and manages timelines for you. The web app is the canvas: a live viewer you watch fill in, plus manual editing.

It's **local-first and single-user**: a SQLite database, your machine, your client's model.

---

## Quick start

```bash
bun install
cp .env.example .env        # defaults are fine for local use
bun run dev                 # http://localhost:3001
```

Open http://localhost:3001. The home page has a **Connect an MCP client** panel — copy the endpoint URL and reveal an access token there. Then point your MCP client at Strata (see below) and ask it to build a timeline.

> Optional: `bun run db:seed` loads a few example timelines so the canvas isn't empty.

---

## Getting an access token

Every request to the MCP server must carry `Authorization: Bearer <token>`. Two ways to get one (both return the **same** long-lived token for the single local user):

- **In the app (easiest):** on the home page, open **Connect an MCP client → Reveal token** and copy it.
- **From the CLI:** `bun run issue:key` prints the token.

Auth is [Better Auth](https://better-auth.com); the token is a long-lived session token delivered via its `bearer` plugin.

---

## Connecting a client

Strata exposes the **same** MCP server over two transports.

### Remote (HTTP) — e.g. Claude Code

The running app serves MCP at `http://localhost:3001/api/mcp`. Add it to your client with a bearer header. For Claude Code:

```bash
claude mcp add --transport http strata http://localhost:3001/api/mcp \
  --header "Authorization: Bearer <YOUR_TOKEN>"
```

### Local (stdio) — e.g. Claude Desktop

Run a server the client launches as a subprocess. In Claude Desktop's `claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "strata": {
      "command": "tsx",
      "args": ["/ABSOLUTE/PATH/TO/strata/src/mcp/stdio.ts"],
      "env": {
        "DATABASE_URL": "/ABSOLUTE/PATH/TO/strata/local.db",
        "STRATA_API_KEY": "<YOUR_TOKEN>"
      }
    }
  }
}
```

> **Run only one primary writer at a time** — the web app *or* the stdio server. Both open the same `local.db` (WAL + a busy timeout keep reads safe).

To poke the server directly, use the [MCP Inspector](https://github.com/modelcontextprotocol/inspector):

```bash
# HTTP
npx @modelcontextprotocol/inspector   # connect to http://localhost:3001/api/mcp, add the Authorization header
# stdio
STRATA_API_KEY=<token> npx @modelcontextprotocol/inspector tsx src/mcp/stdio.ts
```

---

## What the client can do (MCP tools)

| Tool | Purpose |
|---|---|
| `list_timelines` | List all timelines (id + title). |
| `create_timeline` | Create a new empty timeline. |
| `get_timeline` | Read a timeline's full graph (nodes + edges). |
| `apply_patch` | **The one write tool.** Apply a batch of edits as one undoable change. |
| `undo` / `redo` | Step the per-timeline history. |

There's also a read-only resource, `strata://timeline/{id}`, so a client can attach a timeline as context.

### `apply_patch` and the one-edit-one-Patch rule

Every change goes through `apply_patch`. One call carries an ordered list of `ops` and commits as **one atomic, undoable Patch**:

- `add_node` — `{ type: event|entity|period, title, start, end?, precision?, citations?, subtype? }`
- `update_node` — `{ id, ...fields }`
- `delete_node` — `{ id }` (connected edges go too)
- `add_edge` — `{ sourceId, targetId, kind, label? }`
- `update_edge` / `delete_edge`

Within a batch, set `ref` on an `add_node` and reuse that alias as an edge endpoint to connect nodes created in the same call:

```json
{
  "timelineId": "…",
  "summary": "Map early observability tooling",
  "ops": [
    { "op": "add_node", "ref": "n1", "type": "event", "title": "Nagios released", "start": "1999" },
    { "op": "add_node", "ref": "n2", "type": "event", "title": "Prometheus 1.0", "start": "2016" },
    { "op": "add_edge", "sourceId": "n1", "targetId": "n2", "kind": "influenced" }
  ]
}
```

Dates can be fuzzy: `"1999"`, `"Q3 2008"`, `"2014-03"`, `"49 BCE"`. Clients are encouraged to cite sources — citations are stored on the node and shown in its detail panel.

---

## Commands

```bash
bun run dev          # dev server on http://localhost:3001 ($PORT overrides)
bun run build        # production build
bun run typecheck    # tsc --noEmit
bun run issue:key    # print the MCP access token
bun run mcp:stdio    # run the standalone stdio MCP server
bun run verify:mcp   # data-layer check of the apply_patch → Patch → undo/redo path
bun run db:seed      # seed example timelines (or one: bun run db:seed space-race)
bun run db:migrate   # apply migrations (also applied on server start)
```

## Configuration (`.env`)

| Var | Purpose |
|---|---|
| `DATABASE_URL` | SQLite file (default `local.db`). |
| `PORT` | Dev server port (default `3001`). |
| `BETTER_AUTH_SECRET` | Set a real secret outside local dev (`openssl rand -base64 32`). |
| `BETTER_AUTH_URL` | Auth base URL (default `http://localhost:3001`). |
| `STRATA_API_KEY` | The bearer token for the **stdio** server; mint with `bun run issue:key`. |

## Notes

- The app runs under **Node** (Vite SSR), so the DB uses `better-sqlite3`; scripts and the stdio server run via `tsx` for the same reason. Don't reintroduce `bun:sqlite`.
- Tech: TanStack Start + React 19, React Flow (canvas), Drizzle/SQLite, `@modelcontextprotocol/sdk`, Better Auth, Zod. See [`CLAUDE.md`](CLAUDE.md) for architecture detail.
