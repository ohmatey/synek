# Changelog

## 0.1.0 — 2026-05-27

First tagged release. Strata (display name **Synek**) is a local-first, **MCP-driven**
timeline knowledge canvas: the app holds no AI of its own — your MCP client (Claude
Desktop / Claude Code) builds and edits timelines, and the canvas is the viewer.

### Architecture
- **MCP server** over two transports — Streamable HTTP at `/api/mcp` and a stdio binary
  (`bun run mcp:stdio`). Tools: `list_timelines`, `create_timeline`, `get_timeline`,
  `apply_patch`, `undo`, `redo`, plus a read-only `strata://timeline/{id}` resource.
- **One logical edit = one atomic, undoable Patch** — `apply_patch` carries a batch of ops
  (add/update/delete node/edge) committed as a single Patch; `ref` aliases wire edges to
  nodes created in the same call.

### Accounts & access
- **Better Auth** email/password accounts (open multi-user registration).
- **API keys** — named, hashed (sha256), revocable, show-once. Managed in the home
  *Connect an MCP client* panel (sign in required) or via `bun run issue:key`. A "Default"
  key is minted on a user's first visit. Auth falls back to session tokens for legacy keys.

### Per-user timelines + sharing
- Each account **owns its timelines** (direct `ownerId`, no "workspace" entity).
- **Private by default**, with a per-timeline **public toggle + share URL**. Access: list =
  your own; view = owner or public; create/edit/rename/delete/toggle = owner.
- The **MCP server is scoped to the key's owner** — a key only sees and edits that account's
  timelines.
- The canvas renders **read-only** for public/non-owner viewers; owners get a Share control.

### Demo
- The seed creates a demo account (`demo@strata.app` / `demo-password-123`, env-overridable)
  that owns 5 public example timelines, so the open-canvas demo and URL viewing work without
  login.

### Verification
`bun run typecheck`, `bun run build`, `bun run verify:mcp` (data-layer Patch/undo path), and
the Playwright e2e suite (19 tests — home/auth, canvas, seed-data, node-detail, MCP) all pass.
