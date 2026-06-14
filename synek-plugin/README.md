# Synek — Claude Code plugin

**Talk to Claude on the left, watch your Synek timeline build itself on the right.**

This plugin is the on-ramp for [Synek](../) (display name *Chronograph*): it wires Claude Code to your **local** Synek MCP server and teaches Claude how to build good timelines, so you can type `/synek:map Stoicism` and watch the canvas populate — faces, events, eras, and the connections between them.

Synek is single-user and local-first: it runs on your machine, stores everything in one SQLite file, and holds no AI of its own. This plugin is the "Claude on the left" half of that experience.

## What's in the box

| Component | What it does |
|---|---|
| **MCP server** (`.mcp.json`) | Auto-connects Claude Code to your local Synek server at `http://localhost:3001/api/mcp` over HTTP, authenticated via **OAuth** (one browser "Authorize" click — no token to paste). Exposes `list_timelines`, `create_timeline`, `get_timeline`, `query_timeline`, `get_node`, `get_layout_report`, `apply_patch`, `register_artifact`, `search_artifacts`, `undo`, `redo` (and more). |
| `/synek:map <topic>` | The hero command. Creates a timeline, researches the topic, and builds it in one atomic Patch, then hands back the canvas link. |
| `/synek:watch <timeline>` | Keep an *ongoing* timeline current — competitors, model releases, funding/acquisitions, novel research. Runs a keeper pass now (adds **only what's new**, one Patch), then offers to make it recurring in Claude Code or any client. |
| `/synek:setup` | Health check. Verifies the server is reachable and you're authorized; walks you through fixing whatever's broken. |
| `building-timelines` skill | Passive knowledge Claude loads automatically when working with Synek — the atomic-Patch contract, exact op shapes, the closed edge-`kind` set, `ref` aliasing, the heuristics that make a timeline rich instead of a row of gray boxes, and when to offer a keeper routine. |

## Prerequisites

1. **Synek running locally.** From the Synek repo: `bun install` then `bun run setup` (one-step: database + a starter timeline), then `bun run dev`. Serves `http://localhost:3001`.
2. **A Synek account, logged in.** Open `http://localhost:3001` and **sign up / log in** (local email + password). That session is what you approve during the one-time OAuth "Authorize" — there's no key to copy.

## Install

**From a marketplace (for others):**

```bash
/plugin marketplace add ohmatey/synek
/plugin install synek@synek
```

**Local (developing on the plugin itself):** from the Synek repo root, add `./synek-plugin` as a local plugin dir via Claude Code's `/plugin` menu.

Then connect — **one click, no token:**

1. Run `/mcp` in Claude Code → select **synek** → **Authenticate**.
2. A browser opens at `http://localhost:3001` → approve the request (you're already logged in).
3. Done — tokens refresh automatically. Try `/synek:map Stoicism`.

## Configuration

| Env var | Purpose | Default |
|---|---|---|
| `SYNEK_MCP_URL` | Override the MCP endpoint if Synek runs on a non-default host/port — **including a hosted Synek** (point it at `https://your-host/api/mcp` and re-authenticate via `/mcp`). | `http://localhost:3001/api/mcp` |

> **Local or hosted, same plugin.** The plugin talks to whatever Synek `SYNEK_MCP_URL` points at — your local server or a hosted one. (A hosted Synek can also run prompts itself via its own in-app **Run** button when the operator configures an agent key; the plugin path stays available either way.)

No `SYNEK_API_KEY` is needed for the plugin — auth is OAuth. (A `synek_…` API key still works as a fallback if you add an `Authorization: Bearer` header to the `synek` server in `.mcp.json`; it's mainly for the Claude Desktop / stdio path.)

## Verify it's working

1. Run `/mcp` — you should see the `synek` server connected.
2. Run `/synek:setup` — it calls `list_timelines` and reports green, or tells you exactly what to fix.
3. Run `/synek:map the space race` — a timeline builds and you get a link to open it.

## Notes & scope

- **Local-first by design.** The connection is plain `http://localhost` (loopback to your own machine) — that's correct here, not a security gap. There's a local login (email/password) and API keys you manage in-app, but no cloud endpoint and no hosted/team mode.
- **One writer at a time.** This plugin uses the **HTTP** transport so the running viewer and the MCP server stay in one process (which is what makes live canvas updates work). Don't also run the standalone stdio MCP server against the same database.
- **Out of scope** (matches Synek's core guardrail): hosted/cloud instances, teams/workspaces, billing, public sharing, third-party integrations, and any **in-app** agent / background scheduler / signal-ingestion service. One person, one local instance. Note `/synek:watch` does **not** add a scheduler to the app — Synek stays a pure viewer + MCP server; keeping a timeline current is a routine **you** run from *your* client (on-demand, or via your own OS cron), which is the same inversion the whole product is built on.

## Keeping a timeline alive (`/synek:watch`)

Some timelines are finished history; others are *alive* — a competitive landscape, the run of frontier model releases, an ongoing field. `/synek:watch <timeline>` is the **keeper**: it reads what's already on the timeline, searches for what's happened since, and adds **only the genuinely new** developments as one undoable Patch (each cited) — then offers to make it recurring.

Because Synek runs on your machine (`localhost`), the recurring options are honest about reach:

- **On-demand** — run `/synek:watch <timeline>` whenever you want a refresh. Always works, zero setup.
- **Recurring, local** — an OS scheduler (`cron`/`launchd`) running headless Claude Code on your machine, or `/loop` in an open session. It's local, so it reaches your local server.
- **Recurring, cloud routine** — only viable once the server is reachable from the cloud (a future hosted Synek). A scheduled *cloud* agent can't reach `localhost`, so don't point one at a purely-local server.

The routine is just a saved prompt (a scope brief + the keeper steps), so the same recipe works in Claude Code or any MCP client.
- **No portraits via MCP.** `apply_patch` sets `subtype` (so a person card is *ready* for a portrait) and `citations`, but image uploads happen in the canvas's detail panel.

## License

MIT © 2026 Aaron McPherson
