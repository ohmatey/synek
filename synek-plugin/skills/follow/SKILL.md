---
name: follow
description: "Follow a topic in Synek — a living timeline + serialized story kept current on a schedule. Use when the user runs /synek:follow, asks to follow/track/monitor a topic over time, wants a recurring digest of a field (a market, a technology, a rivalry), or a timeline that stays current AND tells its story chapter by chapter. The packaged loop: scope brief → series → first chapter now → a recurring keeper-chapter routine for any MCP client."
argument-hint: <topic>  (e.g. "frontier AI models", "the space launch market". Omit to be asked.)
allowed-tools: ["mcp__plugin_synek_synek__list_projects", "mcp__plugin_synek_synek__create_project", "mcp__plugin_synek_synek__list_timelines", "mcp__plugin_synek_synek__create_timeline", "mcp__plugin_synek_synek__create_series", "mcp__plugin_synek_synek__get_series", "mcp__plugin_synek_synek__set_series_review_mode", "mcp__plugin_synek_synek__get_layout_report", "mcp__plugin_synek_synek__query_timeline", "mcp__plugin_synek_synek__get_node", "mcp__plugin_synek_synek__apply_patch", "mcp__plugin_synek_synek__write_story", "mcp__plugin_synek_synek__patch_story", "mcp__plugin_synek_synek__register_artifact", "mcp__plugin_synek_synek__search_artifacts", "WebSearch", "WebFetch"]
---

# /synek:follow — follow **$ARGUMENTS** on a living timeline

A **follow** is the packaged version of Synek's keeper pattern: one topic, one living timeline, one **private** serialized story that grows a chapter at a time — kept current by a routine *you* run on a cadence. There is no agent inside Synek; your MCP client is the keeper and the writer, the app is the canvas and the reader.

This skill is a thin orchestrator over two skills you should read first: **`building-timelines`** (the `apply_patch` op shapes, edge kinds, `ref` aliasing, lanes) and **`next-chapter`** (the frontier-reading, grow-the-world, chapter-writing loop). It adds the part neither owns end-to-end: turning "I want to follow X" into a scoped, scheduled, honest routine in one sitting.

Four steps: fix the scope → set up the container → write Chapter I now → make it recurring.

---

## 1. Fix the scope brief (the anti-firehose move — do not skip)

"Follow AI" is not followable — an unbounded scope produces a firehose digest nobody reads. Before touching any tool, agree a **scope brief** with the user: one or two sentences naming *what counts* and *what sources to prefer*. Good ones are narrow enough to say no with:

> *"Frontier LLM releases (Claude, GPT, Gemini, open-weights) — each new model as it ships, with capability/price deltas. Sources: model cards, official release posts."*
> *"The commercial launch market — flights, contracts, failures, and pricing moves by the main providers. Sources: launch providers' own announcements, FAA/NASA filings."*

Ask what decision the user wants the follow to change (what they build? what they write about? what they buy?). If a candidate development wouldn't change that decision, it's out of scope — "watching, not a beat" is the right call. Quote the final brief back and get a yes. **The brief is fixed once agreed** — it gets embedded verbatim in the routine recipe (step 4), and widening it later is a deliberate edit to the recipe, never drift inside a run.

## 2. Set up the container (one-time)

- **Project:** `list_projects` — reuse one that fits, else `create_project` named for the topic.
- **Timeline:** `create_timeline` in it — this is the follow's world graph.
- **Series:** `create_series` — title = the follow's name, a one-line `hook` stating the scope brief's promise. For a follow the user wants **public**, pass `reviewMode: true` (or call `set_series_review_mode(true)` after) — see below.

**Choose the follow's visibility — and if it's public, REVIEW MODE is mandatory.** A follow can stay **private** (the default — owner-only, nothing to publish) or run **public** at `/sr/$slug`. The safety rule for an *automated* follow: **a public series must be in review mode.** With `reviewMode` on, every appended chapter is born a `draft` server-side — regardless of what the writer passes — so a scheduled run keeps writing into a public season and **nothing goes live until the owner approves it** (`patch_story` `update_meta status: "published"`, or the in-app series view). Without review mode, `set_series_public` publishes every future chapter the instant `write_story` runs — so **never make an automated follow public without review mode on.** (A hand-curated **standalone** public story — a one-off `write_story`, not appended to the series — is still a fine way to share a single highlight.)

Report the ids (project / timeline / series) — the routine recipe needs them.

## 3. Write Chapter I now (prove the loop before scheduling it)

Run the **`next-chapter`** loop once, with one deviation from its default: for a follow, the **grow-the-world step is always on** — the whole point is discovering what's new, and "the search ran and found nothing" is information; "the search didn't run" is a broken follow.

In short (the `next-chapter` skill owns the details): `get_series` + `get_layout_report` for the frontier and node index → `WebSearch`/`WebFetch` scoped to the brief, after the watermark, primary sources → diff against what's already there → `apply_patch` ONE cited batch with a dated, countable summary → `register_artifact` for substantive sources → `write_story` with `appendToSeries`, anchored on the strongest new moment, every factual beat cited, closing with a "so what" beat that answers the decision from step 1. Chapter I seeds an empty world, so expect this first run to be mostly `apply_patch`.

Report honestly per the `next-chapter` quality bar: added / skipped-as-duplicate / unverified, never an invented date or citation, and the series link.

## 4. Make it recurring

Match the cadence to how fast the topic moves (releases ≈ weekly; a market ≈ weekly/biweekly; slow research ≈ monthly) — don't over-poll; every run costs tokens and web calls. Then produce the **routine recipe**: a self-contained prompt the user saves into whatever scheduler their client has. It must carry everything a cold session needs — future runs won't have this conversation.

```
You are the keeper-writer for my Synek follow "<TITLE>"
(project <PROJECT_ID>, timeline <TIMELINE_ID>, series <SERIES_ID>).
Scope brief (fixed — do not widen it inside a run):
<THE AGREED BRIEF, VERBATIM>
It exists to inform this decision: <THE DECISION FROM STEP 1>.

Every run:
1. get_series <SERIES_ID> and get_layout_report <TIMELINE_ID> — the frontier
   (latest chapter + latest covered instant) and the node index.
2. WebSearch/WebFetch for in-scope developments AFTER the frontier,
   primary sources preferred.
3. Drop anything already present (match the real event, not the wording).
4. apply_patch ONE cited batch, summary "Keeper run <DATE> — +N <things>";
   register_artifact for key sources (search_artifacts first).
5. write_story with appendToSeries: <SERIES_ID> — the next chapter, every
   factual beat cited, closing with the "so what" for the decision above.
   If genuinely nothing new: say so and STOP — write no chapter. Never
   invent a date or citation, never repeat an earlier chapter.
6. NEVER publish from a scheduled run — no set_series_public, no
   patch_story status:"published". A public follow MUST be in review mode, so
   your appended chapter lands as a draft; leave every one for the owner to approve.
7. Report: added / skipped / unverified, and the chapter link.
```

**Where the schedule lives depends on where Synek lives** — be upfront about the constraint rather than setting up a routine that can't connect:

| Synek origin | Viable schedulers |
|---|---|
| **Hosted** (an `https://…` origin, `SYNEK_MCP_URL` set) | Any: your client's scheduled tasks, OS cron/launchd running headless Claude Code, or a cloud routine — they can all reach the server. For headless runs, the static-key fallback in `/synek:setup` §2d (a `synek_…` key as a `Authorization: Bearer` header on an MCP server entry) is more robust than OAuth. |
| **Local** (`http://localhost:3001`, the default) | On-demand runs of this skill, `/loop` in an open session, or an OS scheduler on the *same machine*. A cloud routine **cannot** reach localhost — don't set one up. |

Hand the user the filled-in recipe plus the concrete scheduling step for their situation, and remind them: the first few scheduled runs deserve a read within a day or two — a follow nobody reads should be paused, not left burning tokens.

---

## Quality bar

A follow is set up well when: the scope brief is **narrow enough to reject things** and names the decision it serves; the series' visibility is deliberate (**private**, or **public with review mode on**) and the recipe forbids the scheduled run from publishing; Chapter I shipped **cited and deduped** as one Patch + one chapter; the recipe is **fully self-contained** (ids, brief, quality bar included); and the scheduling advice matched where Synek actually runs. The failure modes: a brief that admits everything, a recipe that assumes context it won't have, or a schedule pointed at a server it can't reach.
