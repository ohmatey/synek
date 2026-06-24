# ADR 0007 — Brands as a first-class entity; remove projects from the UI

- **Status:** Accepted (founder decisions via AskUserQuestion, 2026-06-24).
- **Date:** 2026-06-24
- **Deciders:** founder (locked the four design forks via AskUserQuestion) · design (Wren — stories-first IA) · engineering (boundary mapping + execution).
- **Scope:** (1) Make **brands a first-class, listed entity** referenced by stories and series (not folded into a project); (2) **remove every projects surface from the UI** while keeping `projectId` as invisible plumbing. Grew out of two browser UX walkthroughs + a founder review.
- **Explicitly NOT in scope (KEPT):** the `projects` table, `projectId` FKs, `ensureDefaultProject`, owner-scoping, the MCP project tools (`create_project`/`list_projects`/`get_project`), and the `/p/$slug` resolver — all remain as plumbing. Per-story sharing, the canvas/stories engine, and the agent runner are untouched.

---

## Context

The populated home opened on a grid of (mostly empty) **project containers** — the opposite of the stories-first positioning. Separately, brand data was split across **two** representations: a dormant `brands` table (full CRUD, no UI) and an **active inline `projects.brand`** kit, and a brand only fed *voice* into story prompts — the visual theme was a *separate* cascade (`story.theme ?? series.theme ?? project.theme`) the brand never touched.

**Four forks the founder locked (AskUserQuestion, 2026-06-24):**
1. **Brand → theme = one-shot seed.** Applying a brand WRITES a derived `TimelineTheme` into the scope's `theme` (then freely tweakable). Editing the kit later does NOT restyle already-themed scopes. **Voice always resolves live** from the referenced brand.
2. **Cascade:** `story.brandId ?? series.brandId ?? project.brandId` (the default project = the workspace default).
3. **Projects fully removed from the UI** (one implicit space; `projectId` stays plumbing).
4. **Brand library lives as a Home row** ("Brand kits").

---

## Decision

**Brands (migration 0030).** Add `stories.brandId` + `story_series.brandId` (FK → `brands.id`, `ON DELETE SET NULL`). The migration backfills each project's inline `projects.brand` kit into a `brands` row and points `projects.brandId` at it (the inline column is **deprecated, kept**, dropped later). New helpers:
- `deriveThemeFromBrand(kit)` (`src/lib/theme/`) — palette/fonts/aesthetic → `TimelineTheme` (the heuristic seed).
- `applyBrandToStory` / `applyBrandToSeries` — set `brandId` **and** seed the scope's theme.
- Voice resolves through the cascade in `getTimelineBrandInfo` / `getStoryBrandInfo` via the `brands` table (not the inline column).
- Workspace default via `getDefaultBrandId` / `setDefaultBrand` (the default project's `brandId`, surfaced without exposing the project).
- MCP: `list_brands`, `set_story_brand`, `set_series_brand`, `create_series.brandId` — the BYO client can reference brands.
- UI: `BrandLibraryDialog` (list / create / edit / delete / set-default, reusing `BrandKitFields`) on a home **Brand kits** row; a reusable `BrandPicker` on the story dialog and the series detail page.

**Projects UI cull.** Delete `ProjectCard`, `ProjectHero`, `NewProjectDialog`, `MoveToProjectSubmenu` (+ orphaned `StoryCard`, `useMoveTimeline`, `ProjectBrandingDialog`). Rewrite `ProjectsWorkspace` to lead **Recently updated → Series → Timelines → Entities** behind a "Your library" action bar; remove the header Projects button and `?project` filtering. Keep all server/db/MCP project plumbing and the `/p/$slug` + `projects.tsx` resolvers (back-compat; `?project` is now ignored).

---

## Consequences

- **Brands are reusable and referenceable** at three levels; the agent and the UI both reference them; the visual seed is a copy (kit edits don't retro-restyle) while voice is live — matching the locked "propose-then-tweak" model.
- **The home is stories-first**; one-world users never meet the project concept, yet `projectId` keeps owner-scoping, theme inheritance, and MCP organization intact.
- **Deferred:** dropping the inline `projects.brand` column (a later migration once the FK path is proven); per-beat cast filtering on the globe (needs a `write_story` schema change); the home `NewStoryDialog` brand picker (the canvas dialog has it).

## Alternatives considered

- **Remove the projects table** (not just the UI) — rejected: a load-bearing, recently-built owner-scoped seam carrying theme/brand inheritance and the fiction-world future; a UI problem doesn't justify a schema rip-out.
- **Brand binds theme live** (re-derive at render) — rejected by the founder in favor of one-shot seed (simpler, reuses the existing theme cascade unchanged).

## Open / deferred

Drop `projects.brand`; per-beat instant for scrubber-vs-narrative accuracy; per-beat globe cast subset; Realscript brand sync (still P2c).
