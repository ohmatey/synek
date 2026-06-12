# Project — Sal + Mira's domain

- **Work queue:** `.sector137/state.json` (repo root) — the offline source of truth when the sector137 MCP is unavailable. Issues carry sync envelopes (`meta.origin/serverId/dirty`); reconcile with `mcp__sector137__sync_state` when the MCP returns.
- **Rendered view:** [../product/roadmap.md](../product/roadmap.md) — Sal regenerates the roadmap after queue writes; never reads it as source of truth.
- Status reports and retros land here as `status-{YYYY-MM-DD}.md` / `retro-{topic}-{YYYY-MM-DD}.md`.
