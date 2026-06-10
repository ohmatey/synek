# Synek — Claude Code plugin

**Talk to Claude on the left, watch your Synek timeline build itself on the right.**

This plugin is the on-ramp for [Synek](../) (display name *Chronograph*): it wires Claude Code to your **local** Synek MCP server and teaches Claude how to build good timelines, so you can type `/synek:map Stoicism` and watch the canvas populate — faces, events, eras, and the connections between them.

Synek is single-user and local-first: it runs on your machine, stores everything in one SQLite file, and holds no AI of its own. This plugin is the "Claude on the left" half of that experience.

## What's in the box

| Component | What it does |
|---|---|
| **MCP server** (`.mcp.json`) | Auto-connects Claude Code to your local Synek server at `http://localhost:3001/api/mcp` over HTTP, authenticated via **OAuth** (one browser "Authorize" click — no token to paste). Exposes `list_timelines`, `create_timeline`, `get_timeline`, `apply_patch`, `undo`, `redo`. |
| `/synek:map <topic>` | The hero command. Creates a timeline, researches the topic, and builds it in one atomic Patch, then hands back the canvas link. |
| `/synek:setup` | Health check. Verifies the server is reachable and you're authorized; walks you through fixing whatever's broken. |
| `building-timelines` skill | Passive knowledge Claude loads automatically when working with Synek — the atomic-Patch contract, exact op shapes, the closed edge-`kind` set, `ref` aliasing, and the heuristics that make a timeline rich instead of a row of gray boxes. |

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
| `SYNEK_MCP_URL` | Override the MCP endpoint if Synek runs on a non-default host/port. | `http://localhost:3001/api/mcp` |

No `SYNEK_API_KEY` is needed for the plugin — auth is OAuth. (A `synek_…` API key still works as a fallback if you add an `Authorization: Bearer` header to the `synek` server in `.mcp.json`; it's mainly for the Claude Desktop / stdio path.)

## Verify it's working

1. Run `/mcp` — you should see the `synek` server connected.
2. Run `/synek:setup` — it calls `list_timelines` and reports green, or tells you exactly what to fix.
3. Run `/synek:map the space race` — a timeline builds and you get a link to open it.

## Notes & scope

- **Local-first by design.** The connection is plain `http://localhost` (loopback to your own machine) — that's correct here, not a security gap. There's a local login (email/password) and API keys you manage in-app, but no cloud endpoint and no hosted/team mode.
- **One writer at a time.** This plugin uses the **HTTP** transport so the running viewer and the MCP server stay in one process (which is what makes live canvas updates work). Don't also run the standalone stdio MCP server against the same database.
- **Out of scope** (matches Synek's core guardrail): hosted/cloud instances, teams/workspaces, billing, public sharing, scheduled/background updates, third-party integrations. One person, one local instance, one Claude Code session.
- **No portraits via MCP.** `apply_patch` sets `subtype` (so a person card is *ready* for a portrait) and `citations`, but image uploads happen in the canvas's detail panel.

## License

MIT © 2026 Aaron McPherson
