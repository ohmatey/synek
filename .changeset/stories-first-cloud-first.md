---
"synek": minor
---

Stories-first, cloud-first (v0.2.0).

Re-centers the product on **stories** and shifts the posture to cloud-first / fully
self-hostable / progressively enhanced, while keeping the MCP inversion intact.

- **Stories** — `write_story` (cast, cover, per-beat images + live timeline/globe/entity
  widgets), a docked reader, multiple stories per moment, a Stories view lens, read-aloud
  narration + auto-play, and a public no-auth `/s/$slug` reels page (SSR OpenGraph).
- **Projects** — a top-level container above timelines (migration 0020), move in/out, a
  cinematic Netflix-style home, and `/p/$slug`.
- **Globe** — d3-geo orthographic globe lens + globe story mode (GS1–GS4: per-beat camera,
  interactive zoom, floating cards, era ribbon, dated scrubber).
- **Canvas** — per-timeline themes, the verb system + ⌘K palette, timeline scroller,
  deep-linkable URL state, node restyle, resizable docked panels.
- **Intelligence** — optional key-gated in-app agent (OpenRouter "Run") over the shared MCP
  tool registry; richer MCP surface (`query_timeline`, `get_node`, `get_layout_report`,
  `set_timeline_view`, `set_timeline_theme`); artifact grounding (S2).
- **Hosting** — multi-tenant Phase 2 (per-user isolation, open signup + email auth, per-user
  BYO encrypted OpenRouter key) + self-host Docker / Fly.io.
- **Security** — server-side SSRF egress guard (`src/lib/net/ssrf.ts`, ADR 0002) closing a
  live URL-verifier vector.
