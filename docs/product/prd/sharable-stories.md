# PRD — Sharable Stories (live, mobile, widget-rich)

**Status:** Slice 1 shipped (uncommitted) · 2026-06-13
**Owners:** Margot (product) · Wren (UX) · Kael (eng)
**Bet:** *Sharable stories drive acquisition.* A stranger opens a shared story on
their phone, finishes it, and passes it on — turning every story into a growth
surface for paid (ads) and owned (email) distribution.

## The bet, stated for validation

The riskiest assumption is **not** the email cadence or the live-updates — it is
that **someone who has never seen Synek opens a shared story on a phone, finds it
compelling enough to finish, and shares it.** Everything else is distribution or
amplification of that one artifact:

- **Email (3 unique stories/week)** = a distribution channel *for* the artifact
- **Ads** = paid distribution *for* the same artifact
- **Live-updating (e.g. competitor tracking)** = a retention/quality amplifier
- **Image generation** = a quality amplifier

So the validatable core is the **public, mobile, widget-rich story page itself.**
If it isn't compelling, no email or ad spend matters. It is also the surface every
other piece plugs into. Slice 1 builds exactly that.

## What shipped (Slice 1)

A public, no-auth, mobile-first **Reels reader** at **`/s/$slug`** that renders a
story as a full-screen stepped experience, where each beat/panel can carry a **live
widget** (timeline strip / globe / entity card) as its hero visual, with SSR
OpenGraph for link unfurls, an in-app **Share** action, and a **live "updated"**
stamp that polls for changes.

| Area | Detail |
|---|---|
| Data | `story_segments.widget` JSON (migration `0018`); `StoryBeatWidget` union (`kind: timeline\|globe\|entity`, `nodeIds`, `focusNodeId?`, `layout?`, `caption?`); `slug` on `StoryDTO`/`StoryListItem` |
| MCP | `write_story` gains per-beat `widget` (validated → warnings on dangling ids); description nudges clients to use widgets |
| Loader | `getPublicStory(slug)` server fn — **no auth**, gated on `timeline.isPublic`; ships the story + the lightweight nodes its cast/focus/widgets reference + theme + axis scale + `updatedAt` |
| Route | `src/routes/s.$slug.tsx` — SSR loader + `head` (og:title/description/image, twitter `summary_large_image`); applies the timeline theme; clean not-found |
| Reader | `PublicStoryReader` — full-screen Reels (progress, tap-zones, hold-to-pause, keyboard, narration, auto-play), SSR cover for unfurl/crawlers; widgets hydrate client-side |
| Widgets | `EntityCardWidget`, `TimelineStripWidget` (`makeTimeScale`), `GlobeMiniWidget` (lazy d3-geo, own chunk) |
| Share | `publishStoryShare(storyId)` (owner-gated) flips `timeline.isPublic` + returns the slug; owner-only Share button in the docked reader; public page has a native re-share |
| Growth | End panel "Make your own with Synek" CTA closes the loop; SSR OG card is the ad/email/social preview |
| Live | "Updated X ago" stamp + a poll → "tap to refresh" pill when the story changes |

**Verification:** `bun run verify:public-story` (data path: widget round-trip,
referenced-id resolution, public gate) · `e2e/public-story.spec.ts` (4 tests: cover
+ OG + live stamp, three widgets render, end CTA, not-found) · typecheck + build
green · full e2e suite 54/54.

## Decisions

1. **Sharing reuses `timeline.isPublic`** — no new per-story visibility primitive.
   Sharing a story publishes its timeline (same model as existing timeline
   sharing). Keeps the data-leak boundary at one well-understood flag.
2. **Widgets reference nodes by id, resolved at read time** — so a public story
   stays **live** as its graph changes (a competitor moment updates → the shared
   page reflects it). The loader ships only the referenced nodes.
3. **SSR head, client widgets** — OG/unfurl + cover are server-rendered (the ad/
   email preview and crawler content); the globe is lazy + client-only so text-only
   stories pay nothing for d3-geo.
4. **One tool surface** — widgets flow through the same `write_story` the BYO MCP
   client and the in-app agent already use; no new authoring path.

## Sequence (next slices)

- **Slice 2 — Weekly email digest** (the "3 unique/week"): a sender + a curation
  job selecting 3 stories, linking to their `/s/$slug` pages. Sits entirely on
  slice 1. *Out of current scope until earned.*
- **Slice 3 — Image generation on add** (key-gated, mirrors the OpenRouter "Run"
  path): generate a beat/cover image when one is requested rather than only linked.
- **Slice 4 — True realtime on public pages** (SSE) for live competitor tracking,
  replacing the 45s poll.

## Metrics (instrumentation in place)

- `story_shared { story_id }` — owner published a public link (supply signal)
- `public_story_opened` — a public page was played (reserved; wire on the route)
- Funnel to watch once live: share → open → completion (`story_completed`) → CTA
  click → signup. Completion + CTA-click are the leading indicators of the bet.

## Guardrail note

`CLAUDE.md` listed **public sharing** in the *deliberately deferred* scope. The
founder greenlit it for this bet (ads + sharing) on 2026-06-13; **story-level public
sharing is now in scope.** Multi-tenant hosting, billing, integrations, and public
*browsing* of whole workspaces remain deferred.
