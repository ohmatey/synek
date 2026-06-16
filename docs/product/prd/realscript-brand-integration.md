---
project: "Synek"
track: "Realscript brand integration (P2)"
status: "SUPERSEDED (2026-06-15) — scrapped by founder as over-coupled. The server-side fetch/key/adapter/snapshot integration in this doc is NOT the plan. The live plan is the lean, inversion-true 3-slice P2 in roadmap.md: P2a cross-MCP brand-story skill (shipped) · P2b Synek brand kits + editor on Realscript's schema (built, gate green) · P2c brand sync (later, SSRF-guarded). Kept for reference only."
authors: ["Margot (product)", "Lyra (brand mapping)", "Kael (adapter spec)"]
updated: 2026-06-15
issues: []
pending-sync: true
links:
  - ../product-strategy.md
  - ../roadmap.md
  - ../stories-first-pivot.md
  - ../../engineering/adr/0003-projects-container.md
bets: ["B7 (dogfooding wedge)", "B3 (stories are the product)", "B6 (publish/share loop)"]
---

# Realscript Brand Integration

> **One-line promise:** a creator links their Realscript brand once, and every story they write
> in that project sounds like their brand, looks like their palette, and renders with their
> visual character — without a single per-beat configuration.

**Status:** proposed. Depends on P1 (Projects container, `#local-125`) landing first.
No ADR needed (Kael has confirmed all changes are additive to existing schema/module
boundaries). This PRD is the single source of truth for P2's scope, the connect→fetch→map→apply→voice
flow, and the issue breakdown that becomes the P2 pipeline.

---

## TLDR

- P2 wires Synek to Realscript's brand API as a genuine external consumer — not a thin wrapper but
  a full-contract exercise that tests the brand export against a different runtime (Bun/TanStack vs.
  pnpm/Next).
- A creator links a Realscript brand to a Project in one action; Synek fetches the brand kit,
  maps it to `projects.theme`, and every timeline in that project inherits the theme automatically
  (via the existing `resolveTimelineTheme` chain).
- The in-app agent's system prompt is pre-loaded with the brand's voice schema; every story beat it
  writes lands in the brand's voice without the creator having to do anything per beat.
- The BYO-client (Claude Desktop) gets the same brand context via the MCP `connect_brand` tool
  and/or the `synek://brand/:projectId` resource — identical contract, zero code difference.
- P2 is the first live test of **B7 (the dogfooding wedge bet)**; every contract gap it surfaces
  is a signal Realscript's platform team can act on.

---

## 1. Context / Why now

### The companion-app thesis

The stories-first repositioning (founder, 2026-06-14, `stories-first-pivot.md`) made one structural
claim above all others: Synek is **Realscript's companion app**. Realscript produces short-form
content at velocity; Synek is where the long-form, world-anchored, serialized work lives. The two
share brand identity and distribution — or they're just two apps that happen to be made by the same
company.

P2 is the first place that claim has to be true at the product level. Without brand integration, the
companion story is aspirational. With it, a Realscript customer opens Synek, links their brand, and
everything they create — the canvas palette, the story voice, the image generation style — reflects
their brand identity automatically. That is the companion-app experience. P1 (Projects) gives the
creator the container. P2 gives the container a soul.

### The dogfooding discipline

**B7 (the dogfooding wedge)** is a structural bet, not a feature: Synek as a genuine external
consumer of Realscript's API surfaces hardness that no internal app can. A monorepo component
import doesn't test rate limits. It doesn't test whether the SDK is Bun-installable. It doesn't
surface SSRF-class risks in hosted deployments. It doesn't reveal whether the CSS ETag flow works
across runtimes. Synek does all of that by being a real external consumer on a different stack.

The operating discipline is explicit and non-negotiable: **Synek builds what its own user needs;
Realscript surfaces are exercised as a byproduct.** A creator who themes their Project benefits from
the brand integration. The fact that this exercises Realscript's `/api/v1/brands/:brandId/kit`
endpoint is the dogfooding signal, not the goal. Never build a Synek feature to test Realscript.

### Why P2 before P3

P3 (the morning-chapter loop) requires a scheduled agent that writes in the brand's voice. Without
P2, the agent has no brand context — it writes in its own generic AI voice, which breaks the
"on-brand serialized story" promise. P2 is the prerequisite that makes P3's output publishable.
Additionally, P2 validates the simplest Realscript integration (read-only brand fetch) before P3
demands a more complex one (scheduled agent + potential Resend/scheduler touchpoints).

### The existing seams that make P2 buildable today

Every structural primitive P2 needs already exists in the codebase:

- `projects.brandRef` — nullable opaque brand id, added in P1 / ADR 0003 (D-brand). No new column
  needed to store the brand pointer.
- `TimelineTheme` — the full per-scheme hex color slot map + display font + texture + imageStyle +
  mood (Zod contract in `src/lib/domain/theme.ts`). Every field Lyra's mapping targets already has
  a typed slot.
- `resolveTimelineTheme(meta)` — the three-level chain `timeline.theme ?? project.theme ?? defaults`
  wired through `getGraph` and the MCP `get_timeline` / resource. Writing a brand-derived theme to
  `projects.theme` makes it inherit to every non-overriding timeline in the project for free.
- Per-user encrypted BYO-key pattern — `user_settings` + AES-GCM `lib/crypto/secrets.ts` +
  `SYNEK_SECRETS_KEY`. Adding `realscriptKeyEnc` is two new nullable columns following the exact
  same pattern as `openRouterKeyEnc`.
- `theme-warnings.ts` — the WCAG 3:1 non-text contrast checker already running on `set_timeline_theme`.
  P2 runs the same check on brand-derived themes at connect/refresh time.

P2 adds: the `@realscript/brands` SDK client, a pure brand→theme mapper, three server RPCs, two
MCP tools, one migration, and two UI cards. Nothing in the read path changes.

---

## 2. Personas / JTBD

**Primary — the digital-story creator / serial worldbuilder** who also has a Realscript workspace.
They have spent time in Realscript defining their brand: colors, fonts, voice schema, tone
guidelines. When they come to Synek to write a serialized world, they do not want to re-configure
that identity. Their JTBD:

1. **"Apply my brand to this world without re-doing what I already did in Realscript."** They
   built the brand in one tool; it should flow to the other. One connection, not a copy-paste.
2. **"Every story beat my AI writes should sound like me, not like a generic AI."** The voice
   schema they defined (personality traits, writing rules, tone spectrum, vocabulary) should
   constrain every `write_story` call automatically.
3. **"My published story should look like my brand when someone opens `/s/$slug`."** The canvas
   palette, the cover image style, the mood of every AI-generated image should be consistent with
   the brand the audience knows.

**Adjacent — the Realscript marketer.** Builds campaign narratives with Synek's story canvas.
Their brand is more rigorously defined (Realscript is their primary tool). They are the highest-
fidelity P2 user because they have complete brand definitions with full voice schemas. They validate
the Tier 3 (complete brand) path and surface the most contract gaps.

**The BYO-client power user.** Uses Claude Desktop or Claude Code as their MCP client against
Synek. For this persona, `connect_brand` is an MCP tool they call directly; the brand context
prepended to their client's system prompt is the payoff. They benefit from P2 without ever touching
the Synek UI.

---

## 3. The connect→fetch→map→apply→voice flow

The full flow in five steps:

### Step 1 — Connect

A creator opens Project settings and enters their Realscript brand ID or slug, then clicks
**Connect**. Synek calls the `connectBrand` server RPC:

- Decrypts the caller's per-user Realscript API key from `user_settings.realscriptKeyEnc`
  (AES-GCM, same `encryptSecret`/`decryptSecret` path as OpenRouter).
- Calls `GET /api/v1/brands/:brandId/kit?format=full` via `@realscript/brands` SDK (server-side
  only; key never reaches the browser).
- Compares the response's `X-Brands-Schema-Version` header against `MIN_COMPATIBLE_VERSION`
  (`'1.0.0'`); a major version bump returns a soft warning (advisory, not a crash).
- If the owner has no Realscript key: returns an `isError` result instructing them to add it in
  `/account` — same gating UX as the in-app agent without an OpenRouter key.

### Step 2 — Fetch

The kit response (`BrandKitResponse`) carries `identity`, `guidelines`, `visual_identity`,
`tokens`, and `llm_context` (the `BrandLLMContext` shape). P2 uses two parts:

- **`kit.tokens` (resolved) + `kit.visual_identity`** — for the theme mapping (colors, font,
  texture, imageStyle, mood).
- **`kit.llm_context`** — the compiled brand voice context block, stored verbatim in
  `projects.brandContext` (new nullable JSON column). This is a snapshot; it refreshes on Refresh.

The ETag from the response is stored alongside `brandSyncedAt` so future Refresh calls can use
`If-None-Match` for cheap 304-based staleness checks.

### Step 3 — Map

The pure mapper (`src/lib/realscript/brand-to-theme.ts`) takes the kit and produces a
`TimelineTheme`. The mapping is:

| Realscript source | TimelineTheme target | Transform |
|---|---|---|
| `brand.colors[0]` (primary) | `colors.dark.accentPrimary` + `colors.light.accentPrimary` | Use as-is if hex passes WCAG 3:1 against canvas bg (`#08090c` dark / `#fafbfc` light). Lighten for dark; darken for light until ratio ≥ 3:1. |
| `brand.colors[1]` or `tokenMappings.colors.brand.hover` | `colors.dark.accentStory` + `colors.light.accentStory` | Story badges + reader progress ring — the most visible per-brand surface. Prefer `brand.hover` (already tuned for visibility). WCAG 3:1 guard. |
| `brand.colors[2]` (or hue+30° from primary if absent) | `colors.dark.accentInfluence` + `colors.light.accentInfluence` | Influence edges. Derive if palette < 3 entries. WCAG 3:1 guard. |
| `brand.colors[3]` or `tokenMappings.colors.semantic.info` | `colors.dark.accentDialogue` + `colors.light.accentDialogue` | Dialogue/succeeded edges (forward-momentum meaning). Prefer structured semantic.info over raw index. WCAG 3:1 guard. |
| `brand.colors[4]` or `tokenMappings.colors.semantic.success` | `colors.dark.accentEra` + `colors.light.accentEra` | Era period rails (most persistent canvas surface). Never map `semantic.error` here (red reads as negative on historical spans). WCAG 3:1 guard. |
| `tokenMappings.colors.surface.base` (light) + `surface.raised` (dark); fallback: lightest/darkest palette hex desaturated to 20% | `colors.light.canvasBg` + `colors.dark.canvasBg` | The canvas wash is the brand's own background surface. Do NOT use the raw brand primary as canvasBg — it will fail contrast for all 5 accent slots. |
| `brand.fonts[]` filtered by `category === 'display'`, then `'heading'`, then `[0]` | `font.display` | Lossy enum mapping: serif→`'serif'`; slab-serif→`'slab'`; monospace→`'mono'`; rounded/geometric→`'rounded'`; grotesque/neo-grotesque→`'grotesk'`; other→`'default'`. Record real font name in `imageStyle` so AI prompts can request the visual character. |
| `brand.visualAesthetic` + `brand.toneGuidelines` + `voiceSchema.toneSpectrum[].value` | `texture` | Heuristic: 'minimal'/'clean'/'tech'→`'none'`; 'editorial'/'grid'/'Swiss'→`'grid'`; 'handcrafted'/'organic'→`'paper'`; 'subtle pattern'→`'dots'`. toneSpectrum formal (>60)→`'grid'` or `'none'`; casual (<40)→`'paper'` or `'dots'`. Default: `'none'`. |
| `brand.visualAesthetic` + `brand.styleGuidelines` + `brand.brandAttributes[]` + `voiceSchema.toneSpectrum[]` + `brand.colors` | `imageStyle` | ~80-word image-generation style fragment. Formula: [visual medium from `visualAesthetic`] + [palette mood: 'warm earth tones' / 'cool monochrome' etc.] + [era/texture from `styleGuidelines`] + [font character note] + [primary hex anchor 'with #XXXXXX accents']. This field feeds image prompts directly; specificity over brevity. |
| `brand.brandAttributes[]` + `voiceSchema.personalityTraits[]` (intensity desc) + `voiceSchema.toneSpectrum[]` (labelHigh if value >50 else labelLow) | `mood` | Collect, deduplicate, lowercase, trim to ≤ 12 tokens. Terse adjectives only — no sentences, no punctuation. |
| `brand.name` (trimmed to 60 chars) | `name` | Display name for the derived theme ('Acme Brand Theme'). |
| `brand.mission` + `brand.vision` + `brand.keyMessages` + `brand.brandVoice` + `brand.voiceSchema` | *(not stored in TimelineTheme)* | Routed to `voiceToAI` — injected into the agent system prompt and the MCP client's brand context block. Persisted in `projects.brandContext`, not in the theme JSON. |

**Fidelity tiers** (by `getBrandCompleteness()` score):

- **Tier 1 — Minimal (<30%):** map only `accentPrimary` from `colors[0]`; all other accent slots
  stay Synek defaults; `font: 'default'`; `texture: 'none'`; `imageStyle`/`mood` omitted. Agent
  writes in its own voice; brand is "registered" but visually thin. Acceptable degraded state.
- **Tier 2 — Partial (30–60%):** map available color entries; attempt font/texture derivation;
  compose partial `imageStyle`. Agent has brand direction but not precision (no structured voice
  rules).
- **Tier 3 — Complete (>70%, `voiceSchema` present):** full mapping as above. All five accent
  slots populated (WCAG-guarded derivations for any slots the palette doesn't reach). Full
  `voiceToAI` injection. This is the publishable state.

**Critical caveats (from Lyra's fidelity notes):**

1. **Palette compression is intentional and lossy.** Realscript supports up to 10 colors + 9
   semantic token roles; TimelineTheme has 5 accent slots + 1 canvasBg per scheme. Synek stores
   the brand's color *character*, not its full token spec. This is correct for a knowledge canvas
   that is not a full UI system.
2. **Font key is an enum, not a URL.** Synek loads its own font stacks per key. The brand's
   specific typeface cannot be injected at runtime — record it in `imageStyle` for AI prompts.
3. **LightningCSS / Tailwind v4 color-mix gotcha.** Brand hex values must go through the
   `resolveTimelineTheme` inline-var path on `.canvas-root` — they must NOT be baked into
   `tokens.css` at build time (lightningcss inlines `color-mix(var(--token))` to the dark value).
   The existing inline-var pattern already handles this correctly.
4. **Dual-scheme requirement.** A brand with only a light-mode token set generates a one-scheme
   theme; dark-mode canvas users see the WCAG warning and fall back to Synek defaults. Derive dark
   values from the light palette (lighten/desaturate until 3:1 against `#08090c`). Required for P2
   to be useful on the default dark canvas.
5. **WCAG scope mismatch.** Realscript's completeness check uses text-contrast thresholds (4.5:1).
   Synek's bar is 3:1 for non-text contrast (WCAG 1.4.11 — edges, rails, dots, badges) against a
   much darker canvas background (`#08090c`). A brand colour that passes Realscript's check can
   fail Synek's. The adapter must recheck with Synek's own `contrastRatio()` against Synek's
   canvas bg, not trust the Realscript score.

### Step 4 — Apply

After mapping, the adapter runs `themeContrastWarnings(mappedTheme)` from the existing
`src/lib/mcp/theme-warnings.ts` — same advisory, non-blocking contract as `set_timeline_theme`.
Then it writes:

- `projects.theme = mappedTheme` — the brand-derived `TimelineTheme`, written via the existing
  `updateProject({ theme })` path.
- `projects.brandRef = brandId` — the opaque brand pointer (already exists per ADR 0003).
- `projects.brandContext = kit.llm_context` — the BrandLLMContext snapshot (new JSON column).
- `projects.brandSyncedAt = now()` — the timestamp driving the staleness hint (new column).
- The ETag returned by the brand kit endpoint, stored alongside `brandSyncedAt`.

The `resolveTimelineTheme` chain (`timeline.theme ?? project.theme ?? defaults`) then inherits the
brand-derived theme to every timeline in the project that hasn't set an override. No read-path
changes.

**Slot-level inheritance:** the chain must merge slots individually, not replace whole scheme
objects. A timeline that overrides only `accentPrimary` must keep all other brand-derived accents.
Kael to confirm current merge behavior and enforce slot-level composition explicitly if needed.

### Step 5 — Voice (the payoff)

This is the step that closes the loop. Color mapping is the visible signal; voice is the actual
value.

**In-app agent:** when the in-app agent runs and the timeline's project has a non-null
`brandContext`, the agent runner (`src/lib/agent/runner.ts`) prepends the brand context as a
high-priority system block before the tool list and user prompt. Block structure:

```
[BRAND VOICE — read before writing any story beat]
Brand: {identity.name} — {identity.tagline}
Audience: {identity.targetAudience}
Attributes: {identity.attributes, comma-joined}
Mission: {guidelines.mission}
Core values: {coreValues[].name: description, joined}
Voice (free-text): {guidelines.brandVoice}
Tone guidelines: {guidelines.toneGuidelines}
Key messages: {guidelines.keyMessages}

[STRUCTURED VOICE — follow these over the free-text above if present]
Personality (intensity desc): {voiceSchema.personalityTraits, "TRAIT (N/10): description"}
Tone spectrum: {voiceSchema.toneSpectrum[].dimension: labelLow←value→labelHigh}
Writing rules:
  DO: {voiceSchema.writingRules[type==='do'], one per line with example}
  DON'T: {voiceSchema.writingRules[type==='dont'], one per line}
Vocabulary: prefer {preferred}; avoid {avoided}; jargon level: {jargonLevel}
Channel (story beats): {contentTypeVariations entry for 'editorial' or 'blog', else first entry}

[VISUAL STYLE — use in image prompts and node descriptions]
Image style: {theme.imageStyle}
Mood keywords: {theme.mood, comma-joined}
Primary colour: {brand.colors[0]} — reference this hex in image requests
Visual aesthetic: {guidelines.visualAesthetic}
```

The `write_story` agent call also receives a per-beat image instruction appended transparently:
`"For each beat image, request style: {imageStyle}; colour palette anchored to {primary hex};
mood: {mood}."` The user writes `"tell the story of the 2008 financial crisis"` — the brand
filter runs without any additional input.

**Channel variation selection:** when `voiceSchema.contentTypeVariations` exists, the agent
selects: story beats → `'editorial'` or `'blog'` channel entry; node descriptions → `'website'`
or closest match; fallback → first entry. If no matching channel exists, use the full voice
schema without channel adjustment.

**BYO MCP client:** `get_timeline` already returns the resolved graph. P2 adds a `brandContext`
field to the graph result when the project has a non-null `brandContext`. Additionally, a new MCP
resource `synek://brand/:projectId` returns the full `BrandLLMContext` block so external clients
can read it without re-fetching the full graph. The BYO client self-constrains from the same
signal the in-app agent uses.

**Public reader:** the `/s/$slug` no-auth page reads only the snapshotted `project.theme` (already
resolved into the `resolveTimelineTheme` chain). It never calls the Realscript API. This is
correct by design (snapshot, not live-fetch) and must be guarded by a test: the public loader
makes no realscript-client call.

---

## 4. In scope (P2 slice)

### Must-ship

- **Realscript API key storage:** `user_settings.realscriptKeyEnc` + `realscriptKeyPrefix`
  (nullable text columns, same AES-GCM pattern as `openRouterKeyEnc`). Migration 0021 (additive
  ADD COLUMN only).
- **Optional: `projects.brandSyncedAt`** (nullable `integer` timestamp_ms) for the
  staleness hint — recommended in the same migration.
- **SDK client module** (`src/lib/realscript/brand-client.ts`): thin wrapper over
  `createBrandsClient` from `@realscript/brands/client`. Base URL pinned to
  `REALSCRIPT_BASE_URL` env var (default `https://app.realscript.com`; https-only). ETag
  handling included.
- **Brand→theme mapper** (`src/lib/realscript/brand-to-theme.ts`): pure function, no network, no
  Drizzle imports. Takes the kit response and produces a `TimelineTheme`. Runs
  `resolveTokenMappings`/`resolveColorRef`/`resolveFontRef` from `@realscript/brands/utils` for
  token resolution — no reimplementation of token math. Handles all three fidelity tiers and
  degrades gracefully when brand fields are absent (never writes `undefined`/malformed hex — the
  `hexColor` Zod regex will reject them; must catch and fall back to Synek defaults per slot).
- **Server RPCs** (`src/lib/server/brand.ts`):
  - `connectBrand({ projectId, brandId | brandSlug })` — fetch+map+snapshot; writes
    `projects.theme` + `brandRef` + `brandContext` + `brandSyncedAt` + ETag; returns
    `{ ok, brandRef, syncedAt, warnings: string[] }` from `themeContrastWarnings`.
    `requireUser`-gated; owner-checked via existing `updateProject` ownerId predicate.
  - `refreshBrand({ projectId })` — re-run snapshot using existing `brandRef` + caller's current
    key; ETag/`If-None-Match` → 304 = no-op with `'no upstream changes'` note; same return shape.
  - `disconnectBrand({ projectId })` — clear `projects.brandRef` AND reset `projects.theme` to
    null (back to Synek defaults); same `updateProject` path.
  - Supporting (account page): `setRealscriptKey({ key })` / `clearRealscriptKey()` / surface
    `hasRealscriptKey` + `keyPrefix` in `getUserSettings`. Mirrors the OpenRouter key RPCs.
- **MCP tools** (added to `src/lib/mcp/registry.ts`):
  - `connect_brand(args: { projectId, brandId, brandSlug? })` — same logic as the server RPC;
    key decrypted from `ctx.ownerId` user_settings, never passed as a tool arg. Returns
    `{ ok, brandRef, syncedAt, warnings }`. Name communicates the side effect (fetch+map+theme),
    not just a ref write.
  - `refresh_brand(args: { projectId })` — re-snapshot.
  - Disconnect is either a `brandId: null` arg on `connect_brand` or a `disconnect_brand` tool
    (Kael to decide the cleaner MCP API; either is acceptable).
- **`projects.brandContext`** JSON column (new nullable, same migration or a separate additive
  one). Stores the `BrandLLMContext` snapshot. Read by the agent runner and the MCP graph response.
- **Agent runner injection** (`src/lib/agent/runner.ts`): when the timeline's project has non-null
  `brandContext`, prepend the structured brand voice block (§3, Step 5) as the first system
  message before the tool list and user prompt.
- **`get_timeline` / MCP resource extension**: add `brandContext` field to the graph result when
  project has one. Add `synek://brand/:projectId` resource returning the `BrandLLMContext`.
- **Account UI card:** `RealscriptKeyCard` beside `AgentKeyCard` in `/account` (or `/api-keys`).
  Gated on `secretsConfigured()` (same as OpenRouter card — no key UI if `SYNEK_SECRETS_KEY` is
  not set in the operator's env). Shows `hasRealscriptKey` + key prefix + Save/Clear.
- **Project settings UI:** a "Use a Realscript brand" section in project settings. Input for brand
  ID or slug. **Connect** / **Refresh** / **Disconnect** buttons calling the new RPCs. Shows
  `brandSyncedAt` as a human-readable timestamp + a staleness hint if the upstream brand has been
  updated since last sync (compare kit `updatedAt` / ETag on Refresh). WCAG warnings from the
  connect/refresh result rendered prominently (not buried).

### Out of scope for P2

- **Per-project Realscript key.** The key is per-user — one workspace API key grants access to all
  brands in the workspace. If a user has multiple Realscript workspaces, they choose which key to
  set (a single slot). Per-project key storage is deferred until multi-workspace or team scenarios
  arrive.
- **Public-project brand fetch.** The `/api/v1/public/brands/:slug` endpoint (no-auth) could
  allow shared/public projects to carry brand context without viewer credentials. Deferred —
  determine demand before adding an anonymous external dependency to the public reader path.
- **`set_timeline_theme` brand-binding via MCP.** Accepting `brandRef` directly in
  `set_timeline_theme` and performing server-side kit fetch + mapping is a clean extension that
  lets the BYO client participate in the brand-binding flow at the theme level, not just the
  project level. Deferred to fast-follow; P2's `connect_brand` tool covers the use case.
- **Automatic background refresh / polling.** Refresh is explicit (button + MCP tool). Background
  polling on project open is deferred until the value of live brand sync is validated.
- **The Tailwind config export (`format=tailwind`).** Merging Realscript's Tailwind output into
  Synek's Tailwind v4 config requires a flatten/normalize step that adds risk without value —
  Synek's theme system uses inline CSS vars, not Tailwind utility classes, for brand colors. Use
  `format=full` (JSON with resolved tokens) only.
- **Brand-derived typography scale, spacing, shadows, motion, z-index tokens.** Realscript's
  `tokenMappings` is rich; Synek's canvas only uses colors, a display font enum, and texture.
  The remaining token types have no Synek target. Storing them "for future use" adds schema
  weight for speculative value. If a future canvas feature needs border-radius tokens, add them
  then.
- **P3 (serialized stories + morning-chapter loop).** P2 gives the agent a brand voice; P3
  schedules the agent to write chapters. They're sequenced, not parallel.
- **P6 (social distribution via Realscript scheduler).** A separate integration; completely
  distinct from brand.

---

## 5. Adapter architecture

Kael's adapter spec has confirmed no separate ADR is needed — all changes are additive to existing
module boundaries. Summary for the build:

### New modules

- `src/lib/realscript/brand-client.ts` — thin wrapper over `createBrandsClient`. Server-side
  only. Validates `REALSCRIPT_BASE_URL` is https. Handles ETag round-trips.
- `src/lib/realscript/brand-to-theme.ts` — pure mapper: kit tokens/visual_identity →
  `TimelineTheme`. Uses `resolveTokenMappings`/`resolveColorRef`/`resolveFontRef` from SDK utils.
  Calls `getBrandCompleteness()` for fidelity tier detection. Domain-level (no network, no
  Drizzle); fully testable in isolation.
- `src/lib/server/brand.ts` — `connectBrand` / `refreshBrand` / `disconnectBrand` server fns.
  `requireUser`-gated; decrypts the per-user key; calls client + mapper; runs
  `themeContrastWarnings`; calls `updateProject`.

### Changed files

| File | Change |
|---|---|
| `src/lib/db/schema.ts` | Add `realscriptKeyEnc` + `realscriptKeyPrefix` to `userSettings`; add `brandContext` (JSON) + optional `brandSyncedAt` (integer timestamp_ms) to `projects`. |
| `src/lib/db/user-settings.ts` | `setUserRealscriptKey(userId, enc, prefix)` / `clearUserRealscriptKey(userId)` + extend `SettingsPatch` Pick. |
| `src/lib/server/user-settings.ts` | Accept/encrypt Realscript key; surface `hasRealscriptKey` + `prefix` in `getUserSettings` (`UserAgentSettings` type). |
| `src/lib/mcp/registry.ts` | Register `connect_brand` + `refresh_brand` (+ disconnect variant) tools. Add `synek://brand/:projectId` resource. |
| `src/lib/server/graph.ts` | Include `project.brandContext` in the graph result object when non-null. |
| `src/lib/agent/runner.ts` | Prepend brand voice block when `project.brandContext` is present. |
| `/account` or `/api-keys` UI | `RealscriptKeyCard` beside `AgentKeyCard`. |
| Project settings UI | Brand connection section (Connect/Refresh/Disconnect + sync timestamp + warnings). |

### Migration

**Migration 0021** — additive only, following the 0019 nullable-ADD shape. SQLite's `ALTER TABLE
... ADD COLUMN` applies cleanly for nullable columns with no FK changes. No NOT-NULL rebuild, no
data migration, no backfill needed.

```sql
ALTER TABLE user_settings ADD COLUMN realscript_key_enc text;
ALTER TABLE user_settings ADD COLUMN realscript_key_prefix text;
ALTER TABLE projects ADD COLUMN brand_context text;
ALTER TABLE projects ADD COLUMN brand_synced_at integer;
```

`projects.brandRef` already exists (ADR 0003). No column needed there.

Generate via `bun run db:generate`. Idempotent on server start.

---

## 6. Success metrics — tied to the bets

### B7 — Dogfooding wedge (primary validation signal for P2)

The bet's kill condition is: "integration is too thin to produce signal — Synek just wraps
Realscript without exercising real contract edges." Success means P2 finds at least one contract
gap or behavioral difference that wouldn't have surfaced in Realscript's own test suite.

**Tracking:** a running count of contract issues surfaced per integration phase, maintained in
`docs/product/dogfooding-log.md` (create on first finding). This is qualitative but bounded:
if P2 ships and produces zero findings, that is a signal the integration was too thin. If it
produces 3+, B7 is validated.

Initial expected findings (hypotheses):
- The `@realscript/brands` SDK may not be Bun-native-installable (axios/zod peer deps may
  have Node-ABI conflicts). Documenting the install path is signal.
- ETag caching behavior may differ between Next.js and TanStack's server fn layer — the 304
  short-circuit may not behave as documented on a non-Next runtime.
- WCAG non-text contrast failures are expected for brands optimized for white web UI surfaces.
  The contrast gap data feeds directly back to Realscript's brand completeness guidelines.
- Token resolution silent failures (malformed `tokenMappings`) will surface any gaps in
  `resolveTokenMappings`'s error behavior.

**Event:** `brand_connected { brand_id, fidelity_tier, warning_count }` — fires on successful
`connectBrand`. Lets us track adoption and which fidelity tier brands land in. PostHog.

### B3 — Stories are the product

If the voice injection works, the qualitative signal is that creators stop correcting AI-written
story beats for tone and register. This is a qualitative interview signal (next discovery pass
after P2 ships), not a PostHog event.

**Proxy metric:** `write_story` calls per project that have a connected brand vs. projects
without one. If on-brand projects have higher `write_story` call counts (creators are more
willing to run the agent when the output sounds right), the voice injection is working.

**Event:** `story_written_with_brand_context { project_id, brand_id }` — emitted from the
agent runner when `brandContext` is non-null and a `write_story` call completes. PostHog.

### B6 — Publish/share loop drives acquisition

The bet's question for P2: does a branded story page (`/s/$slug`) convert better than a
generic-themed one? This requires branded projects to actually publish (P2) and then measuring
`/s/$slug` engagement by whether the parent project has a connected brand.

**Event:** `public_story_viewed { has_brand_theme: boolean }` — the existing public page view
enriched with a brand flag derived from `project.brandRef` not-null. Enables the A/B read post
P2.

---

## 7. Acceptance criteria

- **AC1 — Key storage:** a user can enter a Realscript workspace API key in `/account`; it is
  encrypted and stored; the account page shows only the key prefix (never the plaintext); the user
  can clear it. The Drizzle schema type for `realscriptKeyEnc` is `text | null`.
- **AC2 — Connect:** with a valid key and a brand ID or slug, `connectBrand` fetches the brand kit
  via the SDK, maps it to a `TimelineTheme`, writes `projects.theme` + `brandRef` +
  `brandContext` + `brandSyncedAt`, and returns `{ ok: true, brandRef, syncedAt, warnings }`. No
  Realscript API call originates from the browser or the public reader.
- **AC3 — WCAG warnings surface:** when any mapped accent color fails 3:1 contrast against the
  Synek canvas background, the connect/refresh response includes a warning string; the project
  settings UI renders it prominently (not suppressed or in a console log).
- **AC4 — Theme inheritance:** after `connectBrand`, every timeline in that project that has not
  set its own `timeline.theme` resolves the brand-derived colors in the canvas (verified via a
  spot check of `resolveTimelineTheme`'s output in `getGraph`). A timeline that sets only
  `timeline.theme.colors.dark.accentPrimary` retains all other brand-derived accent slots (slot-
  level merge, not object replacement).
- **AC5 — Agent voice injection:** when the in-app agent runs on a timeline whose project has a
  non-null `brandContext`, the system prompt includes the brand voice block (§3, Step 5) before
  the tool list. Verified by reading the agent runner's constructed prompt in a test or debug log.
- **AC6 — BYO client access:** `get_timeline` returns a `brandContext` field when the project has
  one. The `synek://brand/:projectId` resource returns the `BrandLLMContext` shape for any project
  the caller owns. Both respect owner scoping (a non-owner cannot read another user's brand
  context).
- **AC7 — Refresh:** `refreshBrand` on a project with a current ETag returns `{ ok: true, note:
  'no upstream changes' }` when the brand has not changed (304); re-fetches and re-maps when the
  brand has changed (200). In both cases it does not crash.
- **AC8 — Disconnect:** `disconnectBrand` clears `projects.brandRef` to null AND sets
  `projects.theme` to null. After disconnect, `resolveTimelineTheme` returns Synek defaults
  (not the old brand-derived colors).
- **AC9 — Public reader isolation:** the `/s/$slug` no-auth page loads a story and renders with
  the brand-derived theme WITHOUT making any outbound call to `realscript.com`. Verified by
  asserting no network requests to `REALSCRIPT_BASE_URL` in the public loader (can be a test-
  level assertion or a runtime guard).
- **AC10 — Migration:** migration 0021 applies cleanly on a database that has migration 0020
  already applied. `bun run db:migrate` is idempotent. No existing rows are modified or deleted.
- **AC11 — MCP parity:** `connect_brand` and `refresh_brand` are available in `tools/list` and
  callable by a bearer-authenticated MCP client. They return the same `{ ok, brandRef, syncedAt,
  warnings }` shape as the server RPCs.
- **AC12 — No secret in MCP args:** the Realscript API key is never present in any MCP tool
  argument, MCP tool response, or server fn return value. It is decrypted server-side per call,
  used to authenticate the SDK request, and discarded. The `getUserSettings` return type includes
  `hasRealscriptKey: boolean` and `realscriptKeyPrefix: string | null` only.

---

## 8. Risks

| Risk | Severity | Mitigation |
|---|---|---|
| **SSRF in hosted deployment** | High | Pin `REALSCRIPT_BASE_URL` to an https allowlist (default `https://app.realscript.com`). Validate any brand asset URLs (`logoUrl`, font URLs referenced in `imageStyle`) against private/loopback/link-local ranges before using them in server-side fetches. Flag as a separate hardening task for hosted deployment. |
| **Brand-vs-canvas contrast mismatch** | Medium | Marketing brands tuned for white web pages frequently fail Synek's 3:1 non-text bar on `#08090c`. The WCAG gate makes this visible but does not block. UI must surface warnings prominently, not bury them in a collapsible. The mapper must check Synek's `contrastRatio()` independently — never trust Realscript's `getBrandCompleteness()` contrast signal for Synek's canvas. |
| **Token-resolution silent failure** | Medium | `exportBrandForLLM`/token resolution may fail silently on malformed `tokenMappings`. Mitigate: catch Zod parse failures and `undefined` slot values; degrade per-slot to Synek defaults rather than throwing or writing garbage hex. The `hexColor` Zod regex in `domain/theme.ts` is the backstop — catch its error and fallback cleanly. |
| **Snapshot staleness** | Low-Medium | Creator expects live brand updates; they don't flow without a Refresh. Mitigate: surface `brandSyncedAt` prominently; compare upstream `updatedAt` on Refresh to detect drift; make the Refresh action discoverable in the project settings UI. Document in onboarding copy. |
| **SDK Bun compatibility** | Low-Medium | The `@realscript/brands` package is documented as Bun-safe (axios+zod only) but this is a dogfooding hypothesis, not a verified fact. If axios has Node-ABI conflicts under Bun's module resolver, fall back to native `fetch` with manual JSON parsing. Document the finding in the B7 dogfooding log either way. |
| **Schema version drift** | Low | Realscript returns `X-Brands-Schema-Version: 1.0.0`. A future major bump could silently change kit shape. Mitigate: pin `MIN_COMPATIBLE_VERSION = '1.0.0'`; compare on every fetch; soft-warn on major mismatch (advisory, not a crash). |
| **Per-user key vs. per-project brand mismatch** | Low (P2) | A project themed by user A's key, if later reassigned (out of scope for P2 — single-owner projects), would have a `brandRef` the new owner's key can't refresh. Not a P2 risk; flag for P5/teams work. |
| **Texture derivation is heuristic** | Low | `brand.visualAesthetic` is free-text; there is no structured texture field in the Realscript schema. The texture slot will be wrong for brands with unusual aesthetic descriptions. Acceptable: texture is the most subjective slot and the easiest for a creator to override manually with `set_timeline_theme`. |

---

## 9. Open questions (carry into build)

1. **Per-user vs. per-project key:** is one `realscriptKeyEnc` per user correct for P2 (one
   workspace), or do we need a per-project key slot to support creators who manage multiple
   Realscript workspaces from one Synek account? Recommendation: ship single per-user slot for
   P2; surface the limitation only if multiple-workspace requests emerge from the first cohort.

2. **Slot-level vs. object-level merge in `resolveTimelineTheme`:** the `??` operator in the
   chain currently operates at the object level (`timeline.theme ?? project.theme`). If a timeline
   sets only one slot, it shadows the whole brand-derived color object. Kael to audit and enforce
   slot-level composition before P2 ships — this is a correctness requirement for the "brand =
   project floor, timeline = author override" model.

3. **`synek://brand/:projectId` resource vs. `brandContext` in graph:** should we add both (the
   resource for on-demand reads, the graph field for in-context access) or only one? Recommendation:
   add the `brandContext` field to the graph result first (minimal surface); add the resource in a
   fast-follow if BYO clients ask for on-demand access without pulling the full graph.

4. **`voiceSchema.contentTypeVariations` channel selection fallback:** when no `'editorial'` or
   `'blog'` channel entry exists, what does the agent use? Recommendation: use the first available
   variation; if no variations exist, use the full voice schema without channel adjustment. This
   must be documented in the brand context block so the agent understands it is using a fallback.

5. **Disconnect semantic:** should `disconnectBrand` reset `projects.theme` to `null` (Synek
   defaults) or to the last manually-set theme (if any)? Current recommendation: null — the
   "brand = project floor" model means disconnecting should return to the defaults, not silently
   retain what was brand-derived. A creator who wants to keep parts of the brand palette should
   use `set_timeline_theme` post-disconnect. Confirm with Kael before implementation.

---

## 10. Bets note

**B7 (dogfooding wedge) — primary.** P2 is B7's first live test. The bet's kill condition is that
the integration is too thin to produce signal. P2 must be built as a genuine external consumer
(SDK over raw fetch; real auth flow; real ETag caching; real WCAG checking against Synek's bar)
to produce signal. The number of contract gaps surfaced goes in `docs/product/dogfooding-log.md`.

**B3 (stories are the product) — secondary.** Brand voice injection is the mechanism that makes
agent-written story beats publishable. Without P2, the morning-chapter loop (P3) writes generic
AI copy that creators have to edit back to brand voice. P2 is the prerequisite that makes P3's
output feel authored.

**B6 (publish/share loop) — tertiary.** On-brand `/s/$slug` pages should convert better than
generic-themed ones. P2 is the precondition for measuring this hypothesis — you can't measure
brand's effect on acquisition without first making the tool capable of brand-consistent output.

**Side bet (record for the Bet Council):** "on-brand AI output reduces per-beat editing from
creators." Kill signal: `write_story` calls in brand-connected projects produce corrections at
the same rate as unbranded projects — in which case the voice injection is not influencing the
model and the system-prompt structure needs revision.

---

## 11. Issue breakdown (P2 pipeline)

These map to Sal issues. One issue per distinct deliverable. Horizon: all `next`.

| # | Title | Scope |
|---|---|---|
| P2-1 | Migration 0021 + schema changes | `user_settings` (2 cols) + `projects` (2 cols: `brand_context`, `brand_synced_at`). Additive ADD COLUMN only. |
| P2-2 | Realscript key storage + account UI | `setUserRealscriptKey` / `clearUserRealscriptKey` + `RealscriptKeyCard` in `/account`. Mirrors `AgentKeyCard` exactly. |
| P2-3 | Brand SDK client (`brand-client.ts`) | `createBrandsClient` wrapper, `REALSCRIPT_BASE_URL` pin, ETag handling, schema version check. |
| P2-4 | Brand→theme mapper (`brand-to-theme.ts`) | Pure function: kit → `TimelineTheme`. Three fidelity tiers, per-slot degradation, WCAG check via `themeContrastWarnings`. |
| P2-5 | Server RPCs: `connectBrand` / `refreshBrand` / `disconnectBrand` | Server fn layer; owner-gated; calls client + mapper + `updateProject`. |
| P2-6 | MCP tools: `connect_brand` / `refresh_brand` + resource | Registry additions; `synek://brand/:projectId` resource. Owner-scoped. |
| P2-7 | Agent runner voice injection | `runner.ts`: prepend brand context block when `project.brandContext` is non-null. Channel variation selection logic. |
| P2-8 | Graph result + BYO client access | `getGraph` / `get_timeline` adds `brandContext` field when present. |
| P2-9 | Project settings UI: brand connection section | Connect/Refresh/Disconnect flow, `brandSyncedAt` display, WCAG warning rendering. |
| P2-10 | Dogfooding log + contract gap tracking | `docs/product/dogfooding-log.md`; PostHog events (`brand_connected`, `story_written_with_brand_context`, `public_story_viewed.has_brand_theme`). |

**Sequencing:** P2-1 (migration) gates P2-2 through P2-9. P2-3 and P2-4 (client + mapper) can
build in parallel and gate P2-5. P2-5 gates P2-6, P2-7, P2-8, P2-9. P2-10 is a wrap item that
confirms instrumentation landed.

---

## 12. Fast-follows (post-P2)

- **`set_timeline_theme` accepting `brandRef`** — let the BYO client call `set_timeline_theme`
  with a `brandRef` instead of a full theme object; Synek performs the kit fetch + map + WCAG
  check server-side and returns the composed theme for the client to inspect and approve.
- **Public brand fetch for public projects** — use `/api/v1/public/brands/:slug` (no auth) when
  `brand.publicSections` includes `voice` and `tokens`, allowing public projects to carry brand
  context without the viewer needing Realscript credentials. Validates the sharing-drives-
  acquisition bet for branded public stories.
- **Background ETag poll on project open** — if `brandSyncedAt` is > 7 days old, check the
  upstream ETag on project load and surface a "brand updated" hint without a full re-fetch. Low
  cost (304 = no-op); high value for creators who actively iterate their brand.
- **Multi-workspace key slot** — if demand emerges for creators managing multiple Realscript
  workspaces, add a per-project `realscriptKeyRef` that points to a key in a user's key list.
  Deferred: P2 ships the single per-user slot and validates demand first.

---

## Change log

### 2026-06-15 — Initial PRD (Margot)

P2 PRD written. Synthesizes: verified Realscript API surface, Lyra brand→theme mapping table,
Kael adapter spec (modules, migration, server RPCs, MCP tools, key storage pattern). Bets tied to
B7 (primary), B3 (secondary), B6 (tertiary). 10 P2 pipeline issues staged for Sal. `pending-sync:
true` — sync to MCP on next connected session.
