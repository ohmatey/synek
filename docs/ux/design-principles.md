---
project: "Synek"
owner: Wren (design)
updated: 2026-06-23
status: Active — the WHY behind Synek's design; decision lenses for UX work
links: [design-doc.md, cinematic-home.md, ../product/product-strategy.md, ../../CLAUDE.md]
---

# Synek — Design Principles

## TLDR

- These are **decision tests**, not a mission statement. When a design call is ambiguous, run it past the relevant principle below — if the change fails the test, it's the wrong change.
- The spine: **stories are the product** (P1), the canvas is a **lens, not a destination** (P2), and **the world should feel alive** (P3). Everything else serves those three.
- Grounded in the shipped product: stories-first home, immersive per-beat lens switching, local-first posture, the creator-publisher persona, and sharing-as-acquisition.
- Companion doc: [design-doc.md](design-doc.md) is the WHAT/HOW (tokens, layout, patterns). This is the WHY.

---

## How to use this doc

Each principle is a one-line claim plus a short rationale and, where useful, a **test** — a question you can answer yes/no about a specific design. If a proposed change can't pass the test of the principle it touches, it doesn't ship without an explicit, recorded override (the way the founder overrode the sharing guardrail). Principles can be in tension; when they are, the lower-numbered one usually wins (the list is roughly ordered by gravity).

---

## The principles

### 1. The story is the destination; everything else is a lens

Synek is a tool for creating immersive, **serialized stories**. The timeline, the globe, and the entity cards exist to make a story navigable and inhabited — they are not the artifact. The home leads with the creator's best story; the canvas is where you orient before you write the next chapter.

**Test:** does this change make a story easier to read, write, or publish? If it only makes the canvas a better file browser, it's working against the product.

### 2. Cinematic gravity at the top, practical navigation below

The first thing a creator sees should feel like walking into a world — a full-bleed hero, not a list. Utility (timelines, entities, resources) is visible but subordinate, living in the rows beneath the fold. Passive grandeur up top; active tools below.

**Test:** does the most important thing on the screen have the most visual weight? A search bar and a paginated grid are a failure of this principle.

### 3. The world should feel alive, but never anxious

Motion serves arrival and discovery — the hero loads in gracefully, a card responds to a scroll. It never auto-rotates, never demands attention, never animates for its own sake. The immersive per-beat lens switching (globe ↔ timeline) is the purest expression: the camera moves *because the story moved*, not to show off.

**Test:** does this motion communicate a state change the user caused or expects? If it's ambient decoration, cut it.

### 4. Local-first is the default, not a degraded mode

Anyone downloads Synek and runs it locally against their own MCP client or local model — no account, no server, fully featured. Cloud is a *deploy mode*. The design must never make the local user feel like they're missing the "real" product, and must never make a cloud-only affordance the primary path.

**Test:** with no API key and no network, is the core creator loop fully intact and unmarred by disabled buttons or upsells?

### 5. Build for the creator-publisher, not the private researcher

The persona is someone building a living world *for an audience* and publishing it. The private researcher is served but not designed for. We don't add friction for them; we don't build features that only serve build-with-no-audience.

**Test:** does this help a creator build → publish → grow, or does it only help someone curate a private archive?

### 6. Sharing is the growth engine — design the shared artifact first

The public `/s/$slug` reader is how a new user discovers Synek. It is mobile-first, widget-rich, and must look finished to a stranger who has no context. The share path narrows from "browse a feed" to "share a link" — so every shared link carries the full first impression.

**Test:** would this story page convince someone who's never heard of Synek to make their own? OG image, scrim, cast chips, live widgets all serve that.

### 7. Reuse the system before inventing chrome

The design system is shipped and coherent (shadcn/ui new-york on Tailwind v4, semantic tokens in `@synek/ui`). New surfaces compose existing atoms — `psr-cast-chip`, the scrim treatment, `segmentSurface`, the carrier-accent node rule — rather than minting new components or tokens. The cinematic home shipped with **zero new color tokens**.

**Test:** can this be built from existing tokens and patterns? If you're reaching for a new `--color-*` variable, justify why the palette is genuinely insufficient.

### 8. The data owns position; the user owns attention

On the canvas, node x-position derives from date and y from type lane — nodes are non-draggable because position *means something*. The user's agency is directing attention (pan, zoom, select, play a story), not rearranging truth. Don't add affordances that let the user fight the data model.

**Test:** does this control let the user express intent (where to look, what to read) without corrupting what the graph asserts?

### 9. One logical edit is one undoable step

Every edit — whether from an MCP client or a manual panel edit — is one atomic Patch with a clean inverse. The UI must never produce a half-applied state or an edit the user can't cleanly undo. ⌘Z is sacred.

**Test:** after this action, does exactly one ⌘Z return the user to exactly where they were?

### 10. Accent with restraint; neutral by default

Color carries meaning, not decoration. Story is amber (`--color-accent-story`), era is teal (`--color-accent-era`), and these are *carriers* — applied to text, borders, and small fills, never as colored perimeters around neutral bodies (the node design language's carrier-accent rule). Surfaces stay neutral; accents point.

**Test:** is each use of accent color encoding a type or state? Decorative color is a smell.

### 11. Empty states are directive, not apologetic

A new creator's home doesn't show a grid of empty categories — it shows one clear next action ("Your world starts here"). Empty is an opportunity to point at the obvious next step, rendered with the same branded tone as a full surface, never a broken-looking placeholder.

**Test:** does the empty state make the next action obvious, or does it just say "nothing here yet"?

### 12. Accessible by construction, not by audit

Reduced-motion is honored globally (one reset in `styles.css`, no per-component overrides). Contrast meets AA on themed readers and is enforced in e2e. Roving focus, labels, and ARIA are part of the component, not a follow-up ticket.

**Test:** does this work with a keyboard, a screen reader, and `prefers-reduced-motion: reduce` *as built* — not after a remediation pass?

### 13. Theme is the creator's, within guardrails

A project/timeline/story can carry its own theme (accents, display font, mood, image style) — the creator's brand expresses through the surface. But the system supplies the contrast guarantees and the structural layout; freedom is in the palette and font, not in breaking readability.

**Test:** can a creator make it *theirs* without being able to make it unreadable? Theme warnings (WCAG contrast) are the guardrail.

### 14. Recognition consistency between in-app and public

The in-app `StoryReader` and the public `/s/$slug` reader share visual language — the Play button, cast chips, cover treatment — so a creator recognizes their published artifact as the same thing they built. Divergence here breaks trust in what "publish" produces.

**Test:** does the in-app preview look like what the audience will see? If the public page is a different design, the creator can't trust the preview.

---

## Change Log

| Date | Change |
|---|---|
| 2026-06-23 | Initial principles set established (Wren). Grounded in the shipped stories-first product, the pure-app cull (ADR 0005), and the [cinematic home proposal](cinematic-home.md). |
