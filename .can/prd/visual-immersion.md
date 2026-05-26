---
phase: VIS
title: "Immersive timelines — the inhabited map"
status: proposed
era: "Map Layer (the canvas as experience)"
updated: 2026-05-26
---

# VIS — Immersive timelines (the inhabited map)

> **The promise.** Before you tap into a single story, the map already *feels* like a place that real people lived in. A person isn't a labeled box — it's a face. An era isn't a date range — it's a mood. The canvas stops being a diagram you read and becomes a world you want to lean into.

## Why this, why now

The pivot made **stories** the product and the canvas the **map** ([roadmap](../roadmap.md)). The north star is *"tap a moment → an AI tells a short, source-grounded story, in any voice that was there"* — that is the empathy payoff. But empathy doesn't start at the tap. It starts the instant the map loads.

Today the map undersells the product. We just gave every seeded node an image (34/34), which proved the appetite — but they render as identical little thumbnails clipped under a label. A 16th-century polymath and a 2018 logo get the same treatment. The map reads as a *schematic of facts*, not an *inhabited era*. Customers who came to **understand a time and the people in it** are met with a wiring diagram.

This phase makes the map do emotional work on first sight, so that the story layer (S1–S4) lands on a customer who is already leaning in. It is supporting capability for the story north star, not a replacement for it.

## Who this is for

| Persona | What they came for | What the map currently gives them |
|---|---|---|
| **The Sense-maker** (primary) | "Help me actually *understand* how this era unfolded." | A correct but cold node-and-edge diagram. |
| **The Empath** | "I want to feel the people, not just the dates." | Faces shrunk to 40px thumbnails, indistinguishable from logos. |
| **The Curator** | Building a timeline they're proud to revisit (and, later, share). | Ragged, mismatched images; nothing they'd screenshot. |

## Decisions carried in (from prior sessions)

| Fork | Decision | Source |
|---|---|---|
| Card subtype | Entities carry a `subtype` (person/org/place/work); **AI suggests, user overrides** | visual-cards session ([[strata-visual-cards]]) |
| Portrait style | **Period-authentic**, labelled "illustration, not a photograph" | visual-cards session |
| Image generation | `generate_image` chat tool exists (gpt-image-1, one undoable Patch, provenance + cache) | shipped |
| Image storage | **Data-URLs** in `node.metadata.images` | shipped |
| Seed imagery | Remote Wikimedia URLs (network-dependent, fine for assertions) | shipped |

## The experience

- **Open a timeline → it feels populated.** Person entities lead with a framed portrait; orgs show a clean logo lockup; events with imagery show a small scene; places/works get their own treatment. Period bands carry a faint era tint so the *mood* of the age reads at a glance.
- **Cards are legible at every zoom.** Images are consistently framed (no stretched logos, no decapitated portraits), so the map looks *designed*, not assembled.
- **"Make this come alive."** When a node is bare or generic, the user (or the AI, on request) can generate a period-authentic illustration in a click — reusing the existing `generate_image` flow — and undo it if it misses.
- **Visuals are readable, not just decorative.** Opening a node shows the image with its caption/source, so a face has a name and a provenance, not just a thumbnail.

## Goals

1. **First-sight empathy.** On opening any seeded timeline, a new viewer can tell *who is a person* vs an org/era within ~2 seconds, and is drawn to at least one face — without reading labels.
2. **The map looks designed, not assembled.** No stretched, clipped-through-the-head, or mismatched-aspect images at default zoom across all seed timelines.
3. **Bare moments are one click from alive.** Any node can acquire a fitting, period-authentic image via the existing generation flow, reversibly.
4. **Visuals carry meaning.** Every shown image has a caption/source surfaced in the detail panel — the image *informs*, it doesn't just fill space.
5. **The map survives offline.** Seed timelines render their imagery without a live network (so demos and first-run never show broken images).

## Non-goals (explicitly out of scope)

- **A deep entity ontology.** Four subtypes (person/org/place/work) only — no taxonomy of sub-sub-types, no per-subtype schema tables. *(Premature; metadata is enough.)*
- **A licensed-image sourcing pipeline / rights management.** We use Wikimedia + AI illustration (clearly labelled). No stock-photo integration, no rights clearance. *(Separate, heavy, and commercial — not pre-money Core.)*
- **Video, audio, animation, or 3D.** Static imagery + CSS atmosphere only. *(Scope/cost.)*
- **Replacing the story layer.** Visuals make the map inviting; the *understanding/empathy* depth still comes from S1–S4 stories. This phase must not absorb story scope.
- **A full theming engine / user-customizable palettes.** Atmosphere is a bounded, era-derived tint — not a design tool. *(Could-have surface, not a builder.)*
- **Sharing/exporting beautiful boards as a feature.** Export already exists at the data level; "make it gorgeous to share" is deferred with the rest of sharing (D.3).
- **Multi-image galleries / carousels per node.** One hero image per card in v1; the array supports more later.

## User stories

**The Empath**
- As someone exploring an unfamiliar era, I want people to appear as **faces, not boxes**, so the past feels populated by humans I can care about.
- As a reader, I want a face to have a **name and a caption** when I open it, so a portrait becomes a person rather than decoration.

**The Sense-maker**
- As a builder, I want **people, organizations, places, and works to look visually distinct**, so I can read the *shape* of an era at a glance without parsing every label.
- As a builder, I want **eras to carry a mood** (a period tint), so I can feel the boundaries between ages, not just see date ticks.

**The Curator**
- As a builder, I want a **bare or generically-illustrated node to become vividly illustrated in one action**, so I can bring a thin part of my timeline to life without leaving the canvas.
- As a builder, I want generated imagery to be **reversible (⌘Z)**, so I can experiment without fear of clutter.
- As a builder, I want my map to **look consistent and intentional**, so it's something I'm proud to revisit.

**Edge / empty states**
- As a builder of a brand-new (imageless) timeline, I want the map to still feel composed, so the absence of images reads as *clean*, not *broken*.
- As a viewer offline or on a flaky connection, I want seeded imagery to still appear, so my first impression isn't broken thumbnails.

## Requirements

### Must-have — P0 ("the inhabited map")
*The minimum that turns the diagram into a place. If cut, the core problem (cold map) remains.*

1. **Type-specific entity cards.** Add `subtype: 'person' | 'org' | 'place' | 'work'` to `NodeMetadata`; render distinct card layouts per subtype (portrait-led for person, logo lockup for org, etc.) in the canvas nodes ([EntityNode.tsx](../../src/components/canvas/nodes/EntityNode.tsx)). Falls back to today's look when `subtype`/image is absent.
   - *Given* an entity with `subtype: 'person'` and an image, *when* the canvas renders it, *then* the portrait leads the card (prominent, framed) with the name beneath/beside it.
   - *Given* an entity with no `subtype`, *then* it renders as today (no regression).
2. **Consistent image framing.** Images render with a fixed, designed frame per card slot (`object-fit: cover`, defined slot dimensions, face-safe aspect) so nothing stretches or clips awkwardly at default zoom.
   - *Given* any seed timeline at default zoom, *then* no image is stretched, and no portrait is cropped through the face.
3. **Subtype assignment, AI-suggested + user-overridable.** The AI sets a best-guess `subtype` on create/update (tool + prompt); the detail panel exposes a "Kind" control to correct it ([NodeDetailPanel.tsx](../../src/components/canvas/NodeDetailPanel.tsx)) — mirroring how `color`/`size` already work.
   - *Given* a user changes Kind in the detail panel, *when* they save, *then* it commits as one undoable Patch and the card re-renders.
4. **Composed empty state.** A timeline (or node) with no imagery renders as deliberately clean, not visibly missing — placeholder treatment reads as intentional.

### Should-have — P1 ("alive and legible")
*Big experience wins; the P0 map works without them.*

5. **One-click "Illustrate this."** A detail-panel affordance to generate a period-authentic image for the selected node via the existing `generate_image` path (reversible, cached, provenance-tracked). Today generation only happens if the chat model chooses to call the tool; this makes it a direct user action.
6. **Captions / source surfacing.** Show each image's `alt`/caption (and source link where known) in the detail panel, so visuals are legible and attributable.
7. **Replace generic placeholders.** Audit seed nodes currently sharing a stand-in (e.g. Datadog → generic dashboard; reused neural-net diagram) and give them distinct, fitting imagery (hand-picked or AI-generated).
8. **Offline-safe seed imagery.** Cache/bundle seed images locally so first-run and demos never render broken thumbnails, regardless of network. *(Resolves the remote-Wikimedia fragility.)*

### Could-have — P2 ("atmosphere")
*Designed for, not built now.*

9. **Period atmosphere.** A subtle era-derived tint on period bands / lanes, and/or a hero banner when a timeline opens, so an age has a *mood*. Bounded — derived, not user-themed.
10. **Place & work card depth.** Map-snippet treatment for places; cover-art/creator treatment for works — beyond the v1 image-in-a-frame.

## Success metrics

> **Honest constraint:** Synek is local-first with **no analytics/signal layer** (S5 is deferred per [CLAUDE.md] scope). We cannot instrument adoption funnels server-side. So success is defined as **observable proxies** a design partner (or the single user) can judge, plus a qualitative bar — not dashboard metrics.

**Leading (judge within a session / first run)**
- **First-sight legibility:** in a 5-second exposure test, a viewer correctly identifies which nodes are *people* ≥90% of the time. *(Method: design-partner test, n≥5.)*
- **Visual-defect rate:** 0 stretched/face-clipped/broken images across all 5 seed timelines at default zoom. *(Method: manual + the e2e canvas spec extended to assert framing.)*
- **"Illustrate this" success:** ≥80% of generated images are *kept* (not undone) on first try by the builder. *(Method: count keep-vs-⌘Z in a design-partner session.)*

**Lagging (judge over repeated use)**
- **Revisit pull:** design partners report the map is "something I'd come back to / screenshot" (qualitative; target: majority unprompted positive).
- **Empathy signal:** in interviews, partners describe the people on the map in *human* terms ("I wanted to know more about her") vs *data* terms ("there are six entities"). *(The real north-star proxy.)*
- **Story pull-through:** the visual layer increases the rate at which a viewer taps a moment to read its story (once S1 is live in-browser). *(Hypothesis to test when story UI is exercised.)*

## Open questions

- **[design] Face-safe cropping.** `object-fit: cover` can decapitate portraits. Do we need per-image focal-point hints, or is a portrait-tuned aspect + top-bias enough? *(Non-blocking; affects P0 #2.)*
- **[design/eng] Card density vs. richness.** Portrait-led cards are larger — does the existing height-aware lane layout (`layoutLaneY`) stay legible when many person cards crowd one era? *(Could need a zoom-dependent "compact vs. rich" card mode.)*
- **[eng] Storage at scale.** Data-URL images bloat the graph payload (every load ships all bytes). Fine for local-first now; flag the threshold where we move to file storage. *(Non-blocking for v1; revisit if a timeline gets image-heavy.)*
- **[eng] Offline seed caching location.** Bundle under `public/` (served paths) vs. a local data dir? Affects #8 and repo weight. *(Blocking for P1 #8 only.)*
- **[product/legal] Illustration labeling.** Confirm the "illustration, not a photograph" label placement for AI portraits of real figures, so we stay honest with the source-grounding ethos. *(Blocking before shipping P1 #5 broadly.)*
- **[product] Subtype inference accuracy.** If the AI mis-tags subtype often, the override is friction. Do we need a confidence threshold or a batch "fix kinds" action? *(Non-blocking; informs P0 #3.)*

## Timeline & phasing

No hard external deadline (pre-money Core). Suggested phasing — each independently shippable:

- **Phase A (P0): The inhabited map.** Subtype + person card + framing + composed empty state. *This is the demo that changes the first impression.* Verifiable via the existing Playwright harness ([[strata-preview-hydration]]) + extending the canvas spec to assert framing.
- **Phase B (P1): Alive & legible.** "Illustrate this" action, captions, placeholder cleanup, offline caching. *Needs `OPENAI_API_KEY` to exercise generation live.*
- **Phase C (P2): Atmosphere.** Era tint / hero banner; place & work depth.

**Dependencies:** Phase A is independent. Phase B's generation leans on the shipped `generate_image` tool. The story-pull-through metric can only be measured once S1's in-browser UI pass is done.

---

*Reconciliation:* This phase does not rename the substrate — "card" is a render treatment of an existing `node`; `subtype` is metadata, not a new table. It keeps the one-turn-one-Patch invariant (subtype edits and generated images commit as Patches; generation provenance stays in the separate `generations` ledger). It is a **Map-layer** capability that makes S1–S4 land harder, not a competing track.
