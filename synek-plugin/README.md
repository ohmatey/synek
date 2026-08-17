# Synek: Claude Code plugin

**Talk to Claude on the left, watch your Synek timeline build itself on the right.**

This plugin is the on-ramp for [Synek](../) (display name *Chronograph*): it wires Claude Code to your Synek MCP server and teaches Claude how to build good timelines, so you can type `/synek:map Stoicism` and watch the canvas populate with faces, events, eras, and the connections between them.

Synek is local-first: by default it runs on your machine, stores everything in one SQLite file, and holds no AI of its own. **It also deploys to the cloud.** Point this plugin at a hosted origin (`SYNEK_MCP_URL`, below) and the same one-click OAuth connect works against your deployed instance. Either way, this plugin is the "Claude on the left" half of the experience.

## What's in the box

| Component | What it does |
|---|---|
| **MCP server** (`.mcp.json`) | Auto-connects Claude Code to your local Synek server at `http://localhost:3001/api/mcp` over HTTP, authenticated via **OAuth** (one browser "Authorize" click, with no token to paste). Exposes `list_timelines`, `create_timeline`, `get_timeline`, `query_timeline`, `get_node`, `get_layout_report`, `apply_patch`, `update_timeline_memory`, `register_artifact`, `search_artifacts`, `undo`, `redo` (and more). |
| `/synek:map <topic>` | The hero command. Creates a timeline, researches the topic, and builds it in one atomic Patch, then hands back the canvas link. |
| `/synek:story <topic/moment>` | Tell an **immersive story** on a timeline moment (node-backed cast, cited beats, camera choreography across the globe and timeline, live widgets) and, on request, publish it to the public `/s/<slug>` page. |
| `/synek:watch <timeline>` | Keep an *ongoing* timeline current: competitors, model releases, funding/acquisitions, novel research. Runs a keeper pass now (adds **only what's new**, one Patch), then offers to make it recurring in Claude Code or any client. |
| `/synek:next-chapter <series>` | The morning-chapter loop: read a series' frontier, optionally grow the world with new cited nodes, write the next chapter without repeating earlier ones. |
| `/synek:follow <topic>` | Follow a topic end-to-end: fix a scope brief, set up a **private** living series, write Chapter I now, and hand back a self-contained recurring routine you can schedule in any MCP client. |
| `/synek:brand-story <brand>` | Write a Synek story in a **Realscript brand's** voice and palette. Needs the Realscript `real` plugin connected alongside this one. |
| `/synek:setup` | Health check. Verifies the server is reachable and you're authorized; walks you through fixing whatever's broken (including a skills-only install with no MCP server yet). |
| `building-timelines` skill | Passive knowledge Claude loads automatically when working with Synek: the atomic-Patch contract, exact op shapes, the closed edge-`kind` set, `ref` aliasing, swimlanes, node images (**faces**) and coordinates/geoScope (**places**, the globe lens), the per-timeline **memory** store, the sourcing bar (openable links, two sources on anything load-bearing, `sourceType`), and the house prose rule. |

## Prerequisites

1. **Synek running locally.** From the Synek repo: `bun install` then `bun run setup` (one-step: database + a starter timeline), then `bun run dev`. Serves `http://localhost:3001`.
2. **A Synek account, logged in.** Open `http://localhost:3001` and **sign up / log in** (local email + password). That session is what you approve during the one-time OAuth "Authorize". There's no key to copy.

## Install

**From a marketplace (for others):**

```bash
/plugin marketplace add ohmatey/synek
/plugin install synek@synek
```

**Local (developing on the plugin itself):** from the Synek repo root, add `./synek-plugin` as a local plugin dir via Claude Code's `/plugin` menu.

**Skills only, via `npx skills` (any agent):** the skills also install standalone from the public repo:

```bash
npx skills add ohmatey/synek
```

Two caveats for a skills-only install: (1) **the MCP connection doesn't come along** (`.mcp.json` is a plugin feature), so connect once with `claude mcp add --transport http synek http://localhost:3001/api/mcp` (or your hosted origin; `/synek:setup` walks you through it), and (2) the skill names are unnamespaced (`map`, `setup`, `watch`, …) in a shared skills directory, so watch for collisions with other packs. The plugin install avoids both issues and is the recommended path for Claude Code.

> **Versioning rule:** any change to `skills/` MUST bump `version` in `.claude-plugin/plugin.json`. Installed plugins are cached by version, so a skill added without a bump silently never reaches installed copies (this happened to `next-chapter`).

Then connect. **One click, no token:**

1. Run `/mcp` in Claude Code → select **synek** → **Authenticate**.
2. A browser opens at `http://localhost:3001` → approve the request (you're already logged in).
3. Done. Tokens refresh automatically. Try `/synek:map Stoicism`.

## Configuration

| Env var | Purpose | Default |
|---|---|---|
| `SYNEK_MCP_URL` | Override the MCP endpoint if Synek runs on a non-default host/port, **including a hosted Synek** (point it at `https://your-host/api/mcp` and re-authenticate via `/mcp`). | `http://localhost:3001/api/mcp` |

> **Local or hosted, same plugin.** The plugin talks to whatever Synek `SYNEK_MCP_URL` points at: your local server or a hosted one. (A hosted Synek can also run prompts itself via its own in-app **Run** button when the operator configures an agent key; the plugin path stays available either way.)

The plugin needs no `SYNEK_API_KEY` because auth is OAuth. (A `synek_…` API key still works as a fallback if you add an `Authorization: Bearer` header to the `synek` server in `.mcp.json`; it's mainly for the Claude Desktop / stdio path.)

## Verify it's working

1. Run `/mcp`. You should see the `synek` server connected.
2. Run `/synek:setup`. It calls `list_timelines` and reports green, or tells you exactly what to fix.
3. Run `/synek:map the space race`. A timeline builds and you get a link to open it.

## Notes & scope

- **Local-first by default, hosted by choice.** With nothing configured the connection is plain `http://localhost` (loopback to your own machine), which is correct rather than a security gap. Set `SYNEK_MCP_URL` to a public `https://…/api/mcp` origin and the same plugin connects to a **deployed** Synek over the same OAuth flow. Cloud is a *deploy mode* of the same app rather than a separate product.
- **One writer at a time.** This plugin uses the **HTTP** transport so the running viewer and the MCP server stay in one process (which is what makes live canvas updates work). Don't also run the standalone stdio MCP server against the same database.
- **Still out of scope** (matches Synek's core guardrail): teams/workspaces/roles, billing, third-party integrations (Slack/Notion), enterprise SSO/audit, and any **in-app** background scheduler / signal-ingestion service. Hosting is a single-tenant-per-user deploy of the same local-first app, not a multi-tenant team product. Note `/synek:watch` does **not** add a scheduler to the app. Synek stays a pure viewer + MCP server; keeping a timeline current is a routine **you** run from *your* client (on-demand, your own OS cron, or, against a hosted origin, a Claude Code cloud schedule), which is the same inversion the whole product is built on.

## Keeping a timeline alive (`/synek:watch`)

Some timelines are finished history; others are *alive*: a competitive landscape, the run of frontier model releases, an ongoing field. `/synek:watch <timeline>` is the **keeper**: it reads what's already on the timeline, searches for what's happened since, and adds **only the genuinely new** developments as one undoable Patch (each cited). It then offers to make it recurring.

The recurring options depend on where your Synek lives, because a cloud routine can reach a hosted origin but never `localhost`:

- **On-demand**: run `/synek:watch <timeline>` whenever you want a refresh. Always works, zero setup.
- **Recurring, local**: an OS scheduler (`cron`/`launchd`) running headless Claude Code on your machine, or `/loop` in an open session. It's local, so it reaches your local server.
- **Recurring, cloud routine**: viable when the plugin points at a **hosted** Synek (`SYNEK_MCP_URL` = a public `https://…/api/mcp`). Then a Claude Code cloud schedule reaches the origin and authorizes over OAuth like any client. Don't point a cloud routine at a purely-local server, because it can't reach `localhost`.

The routine is just a saved prompt (a scope brief + the keeper steps), so the same recipe works in Claude Code or any MCP client.
- **Faces and places via MCP.** `apply_patch` takes node `images` (real, web-sourced URLs such as a Wikimedia portrait or an org logo; Synek renders, never generates) and `location` + `lat`/`lng` coordinates that plot nodes on the globe lens (`geoScope` marks the honestly-placeless). File *uploads* still happen in the canvas's detail panel.

## License

MIT © 2026 Aaron McPherson
