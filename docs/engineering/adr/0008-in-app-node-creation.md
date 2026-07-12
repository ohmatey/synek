# ADR 0008 — In-app node creation: a manual authoring seam that keeps the AI inversion

- **Status:** Accepted (founder chose "real create form + a prompt option" via AskUserQuestion, 2026-07-12). Implemented on branch `feat/canvas-add-surface`.
- **Date:** 2026-07-12
- **Deciders:** founder/Aaron (drove it — "add entity should be _add anything_"; locked the create-semantics fork) · engineering (boundary check + execution).
- **Scope:** A first-class **manual create** path for canvas nodes — `createNode` server fn + a unified **Add** surface (`AddMenu`: Create new · Place existing · New story) + the same three as real actions in **⌘K**, plus a `⋯ More` overflow so the top bar never clips on mobile. Retires the place-only `AddEntityMenu` chip.
- **Builds on:** ADR [0004](./0004-shared-entities.md) (shared entities — `createNode` co-creates the canonical entity + its placement) · the Patch invariant (`src/lib/db/patches.ts`) · the existing manual-edit path (`editNode`) and place path (`placeEntityOnTimeline`).
- **Explicitly NOT in scope:** in-app *AI* (unchanged — no model runs in-app by default); bulk/rich authoring (images, citations, coordinates stay in the node detail panel or come from the connected Claude); a mobile-native authoring layout.

---

## Context

Synek's founding posture (CLAUDE.md, `CanvasEmpty`, the MCP inversion) was **"the canvas is the viewer; your MCP client is the author."** Read literally, that had hardened into a real product gap: the app could **edit** a node (`editNode` → entity/graph patch) and **place** an existing shared entity (`placeEntityOnTimeline`), but there was **no way to CREATE a node in-app at all** — creation happened only through the MCP server's `apply_patch` (`PatchBuilder.addNode`, reachable solely from `src/lib/mcp/ops.ts`). A user with the app open but no MCP client connected could look and tweak, but not add.

The founder's framing — *"add entity should be an add-anything-to-the-timeline"* — surfaced the gap. The fork was whether "add new" should stay a **prompt hand-off** to the connected Claude (preserving the letter of the inversion) or become a **real in-app form**. Chosen (AskUserQuestion, 2026-07-12): **real create form + keep a prompt option** for richer/bulk adds.

The distinction that makes this safe: **the inversion is about _intelligence_, not about forbidding all manual input.** A "type a title and a date" form is data entry, not authorship-by-AI. Manual editing already existed; manual creation just completes the CRUD triangle. No model is introduced.

## Decision

1. **`createNode` server fn** (`src/lib/server/nodes.ts`) — owner-scoped, mirrors `placeEntityOnTimeline`: `requireUser` → owner-check the timeline → `parseDate` the human date string → `new PatchBuilder(...).addNode(...)` → `commitPatch`. One **atomic, undoable Patch** (⌘Z removes the node _and_ its co-created entity). Input: `{ timelineId, type, title, date, endDate?, summary?, lane?, subtype? }`. No new table, no migration.
2. **Unified Add surface** (`src/components/canvas/AddMenu.tsx`) — one owner "Add" button → **Create new** (a minimal form: type · title · fuzzy date with live preview · optional end/summary/track/subtype), **Place existing entity** (the retired `AddEntityMenu` body, rehomed as a dialog), **New story** (reuses `NewStoryDialog`).
3. **⌘K is the canonical command surface** — `CommandPalette` gains an **Add** group (Add new · Place existing · New story) as *real* actions (not prompt specs). The Add button and ⌘K share one set of controlled dialogs owned by `TimelineCanvas`.
4. **`⋯ More` overflow** (`MoreMenu.tsx`) — Display settings + Share/export fold behind one button (`CanvasSettings`/`ShareDialog` made controllable); the toolbar wraps instead of clipping on a phone.

## Consequences

- **CLAUDE.md updated** (the tech-stack AI row + Current status): "manual authoring is IN, AI is not." The "pure viewer" claim is superseded; the *no-in-app-intelligence* inversion stands.
- Manual CRUD is now complete (create · edit · place · delete), all through the one Patch engine — undo/redo and per-user isolation come for free.
- The MCP-client path is unchanged and remains the way to build *at scale* (bulk, cited, illustrated, geo-located). The in-app form is a "get one node on the timeline fast" affordance, not a replacement.
- New risk surface is minimal: `createNode` is a thin wrapper over already-proven code (`PatchBuilder.addNode` + `commitPatch`, exercised by `verify:mcp`) plus the owner check (copied from `placeEntityOnTimeline`) and `parseDate` (unit-tested).

## Alternatives considered

- **Prompt hand-off only** (keep the letter of the inversion): rejected — it makes "add anything" just another copy-a-prompt, which is what the founder was pushing back on.
- **Create form only, no prompt path:** rejected — loses the bulk/AI-assisted path that is Synek's actual strength.

## Migration & rollout

None. Additive server fn + UI; no schema change, no migration. Ships behind the owner gate (`isOwner`) like every other write.

## Open / deferred

- A **mobile-native authoring** layout (the create form is desktop-first; it fits a phone but isn't optimized).
- **Bulk/enriched create** stays a connected-Claude job by design.
- If the manual path grows (edges, multi-node), revisit whether an `add_edge` form belongs here too.
