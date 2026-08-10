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

Ask what decision the user wants the follow to change (what they build? what they write about? what they buy?). If a candidate development wouldn't change that decision, it's out of scope — "watching, not a beat" is the right call, and a watching item gets **recorded in the keeper log** (step 2) with the trigger that would promote it, not silently dropped. Quote the final brief back and get a yes. **The brief is fixed once agreed** — it gets embedded verbatim in the routine recipe (step 4), and widening it later is a deliberate edit to the recipe, never drift inside a run.

When you name the preferred sources, name **both layers**: the vendors/actors who announce about themselves (release posts, filings, model cards) *and* the tooling/ecosystem layer around them (specs and protocol revisions, SDK releases, notable OSS, standards bodies). A source list that is only vendor announcements produces a press-release feed and misses the changes that most often alter what someone can actually build.

## 2. Set up the container (one-time)

- **Project:** `list_projects` — reuse one that fits, else `create_project` named for the topic.
- **Timeline:** `create_timeline` in it — this is the follow's world graph.
- **Series:** `create_series` — title = the follow's name, a one-line `hook` stating the scope brief's promise. For a follow the user wants **public**, pass `reviewMode: true` (or call `set_series_review_mode(true)` after) — see below.

**Choose the follow's visibility — and if it's public, REVIEW MODE is mandatory.** A follow can stay **private** (the default — owner-only, nothing to publish) or run **public** at `/sr/$slug`. The safety rule for an *automated* follow: **a public series must be in review mode.** With `reviewMode` on, every appended chapter is born a `draft` server-side — regardless of what the writer passes — so a scheduled run keeps writing into a public season and **nothing goes live until the owner approves it** (`patch_story` `update_meta status: "published"`, or the in-app series view). Without review mode, `set_series_public` publishes every future chapter the instant `write_story` runs — so **never make an automated follow public without review mode on.** (A hand-curated **standalone** public story — a one-off `write_story`, not appended to the series — is still a fine way to share a single highlight.)

- **Keeper log:** the routine's memory. It rides the Chapter I patch (step 3) — an `add_node` with `ref: "keeperlog"`, `type: "concept"`, `title: "Keeper log — <TITLE>"`, `lane: "Keeper log"`, `start` = today, no citations/images/coordinates, and this seed summary:

  ```
  KEEPER LOG — <TITLE>. Bookkeeping node, not a topic beat.
  LAST RUN: <today> · CADENCE: <cadence> · COVERED THROUGH: <Chapter I's latest instant>
  RUNS (newest first, keep 8):
  - <today> setup +N nodes, chapter I
  WATCHING (keep 7, newest first):
  - (none yet)
  ```

  Take its **real id from the patch `results`** — the recipe needs it, and a cold run has no other reliable way to find its own memory. Shape and exemptions: `building-timelines`, "The keeper log node."

Report the ids (project / timeline / series / keeper log node) — the routine recipe needs them.

## 3. Write Chapter I now (prove the loop before scheduling it)

Run the **`next-chapter`** loop once, with one deviation from its default: for a follow, the **grow-the-world step is always on** — the whole point is discovering what's new, and "the search ran and found nothing" is information; "the search didn't run" is a broken follow.

In short (the `next-chapter` skill owns the details): `get_series` + `get_layout_report` for the frontier and node index → `WebSearch`/`WebFetch` scoped to the brief, after the watermark, primary sources → diff against what's already there → `apply_patch` ONE cited batch with a dated, countable summary — **including the keeper log node from step 2, so the routine is born with a memory** → `register_artifact` for substantive sources → `write_story` with `appendToSeries`, anchored on the strongest new moment, every factual beat cited, closing with a "so what" beat that answers the decision from step 1. Chapter I seeds an empty world, so expect this first run to be mostly `apply_patch`.

Report honestly per the `next-chapter` quality bar: added / skipped-as-duplicate / unverified, never an invented date or citation, and the series link.

## 4. Make it recurring

Match the cadence to how fast the topic moves (releases ≈ weekly; a market ≈ weekly/biweekly; slow research ≈ monthly) — don't over-poll; every run costs tokens and web calls. Then produce the **routine recipe**: a self-contained prompt the user saves into whatever scheduler their client has. It must carry everything a cold session needs — future runs won't have this conversation.

```
You are the keeper-writer for my Synek follow "<TITLE>"
(project <PROJECT_ID>, timeline <TIMELINE_ID>, series <SERIES_ID>).
Keeper log node: <LOG_NODE_ID>, lane "Keeper log" — this routine's memory.
Cadence: <CADENCE>.
Scope brief (fixed — never widen the SUBJECT inside a run):
<THE AGREED BRIEF, VERBATIM>
It exists to inform this decision: <THE DECISION FROM STEP 1>.

Every run:
0. Note today's date. get_node <LOG_NODE_ID> — its summary is the run log:
   LAST RUN, RUNS (recent), WATCHING (items already weighed and deferred).
   If that id 404s, find it with query_timeline <TIMELINE_ID>
   lane:"Keeper log" full:true; if it genuinely doesn't exist, treat this as
   run 1 and re-create it in step 4. GAP = today - LAST RUN. If GAP is more
   than 1.5x <CADENCE>, scheduled runs were missed: widen the search WINDOW
   to cover the whole gap — never the scope — and state it in step 7.
1. get_series <SERIES_ID> and get_layout_report <TIMELINE_ID> — the frontier
   (latest chapter + latest covered instant) and the node index. IGNORE the
   "Keeper log" lane when reading the latest date; it is bookkeeping, not a beat.
2. WebSearch/WebFetch for in-scope developments after the earlier of the
   frontier instant and LAST RUN, primary sources preferred. Re-check every
   WATCHING item by name in the same pass.
3. Drop anything already present (match the real event, not the wording).
   Sort the rest:
     BEATS    — in scope, dated, citable. Nodes this run.
     WATCHING — real but under the scope bar (plausible-but-unconfirmed, or
                too small to change the decision above). Not a rejection:
                record it with the date first seen and the specific trigger
                that would promote it.
   A WATCHING item that now crosses the bar is PROMOTED — a cited node this
   run, removed from the list. Drop any WATCHING item after 4 re-checks or 60
   days without movement and record that it aged out.
4. apply_patch ONE batch containing BOTH:
     - the new cited nodes/edges (possibly none), and
     - update_node <LOG_NODE_ID> rewriting its summary to exactly:

         KEEPER LOG — <TITLE>. Bookkeeping node, not a topic beat.
         LAST RUN: <today> · CADENCE: <CADENCE> · COVERED THROUGH: <frontier date>
         RUNS (newest first, keep 8):
         - <today> <+N nodes, chapter <N> | none (log only)><, gap note>
         - <previous lines, oldest dropped>
         WATCHING (keep 7, newest first):
         - <item> — first seen <date>, rechecked <n>x, promote if <trigger>

   summary: "Keeper run <today> — +N <things>", or "Keeper run <today> — no
   new developments (log only)". SEND THIS PATCH EVERY RUN, including a run
   that found nothing — the log op is this run's proof of life, and without it
   "quiet week" and "the scheduler never fired" look identical. Never add
   filler nodes to look busy. Every citation needs a resolvable URL (or
   register_artifact with a transcript); search_artifacts first to avoid
   duplicates. The log node is never cited, never pinned to the globe, and
   never referenced by a chapter.
5. write_story with appendToSeries: <SERIES_ID> — the next chapter, every
   factual beat cited, closing with the "so what" for the decision above.
   If genuinely nothing new: write NO chapter — step 4's log patch is the
   trace. Never invent a date or citation, never repeat an earlier chapter.
6. NEVER publish from a scheduled run — no set_series_public, no
   patch_story status:"published". A public follow MUST be in review mode, so
   your appended chapter lands as a draft; leave every one for the owner to approve.
7. Report:
   - Since last run: <N> days<, "— M scheduled runs missed; check the
     scheduler" when the gap exceeded the cadence>.
   - Added / skipped-as-duplicate / unverified.
   - Watching: <N> carried, naming anything promoted or aged out.
   - Awaiting approval: <count of chapters get_series returned with status
     "draft">, if any.
   - The chapter link — or "no chapter this run".
8. Optional, never load-bearing: if you have file tools and <MIRROR_PATH>'s
   folder already exists, append the run line there for easy skimming. Skip
   silently otherwise — never create folders, never fail a run over it. The
   keeper log node is the only source of truth.
```

**Where the schedule lives depends on where Synek lives** — be upfront about the constraint rather than setting up a routine that can't connect:

| Synek origin | Viable schedulers |
|---|---|
| **Hosted** (an `https://…` origin, `SYNEK_MCP_URL` set) | Any: your client's scheduled tasks, OS cron/launchd running headless Claude Code, or a cloud routine — they can all reach the server. For headless runs, the static-key fallback in `/synek:setup` §2d (a `synek_…` key as a `Authorization: Bearer` header on an MCP server entry) is more robust than OAuth. |
| **Local** (`http://localhost:3001`, the default) | On-demand runs of this skill, `/loop` in an open session, or an OS scheduler on the *same machine*. A cloud routine **cannot** reach localhost — don't set one up. |

**The routine's memory lives in the graph, so it survives any runner.** A cloud routine gets a fresh sandbox every fire and would lose a file; it can always read the log node. If the routine runs locally and the user wants something greppable, fill in `<MIRROR_PATH>` (e.g. the routine's own folder) for step 8; if it runs in the cloud, **delete step 8** rather than leave a path that will never exist. Nothing ever *reads* the mirror to decide anything.

Hand the user the filled-in recipe plus the concrete scheduling step for their situation, and remind them: the first few scheduled runs deserve a read within a day or two — a follow nobody reads should be paused, not left burning tokens. If the series is in review mode, "read it" has a natural signal — an approved chapter. Drafts piling up unapproved *is* the unread count.

---

## Quality bar

A follow is set up well when: the scope brief is **narrow enough to reject things** and names the decision it serves; the series' visibility is deliberate (**private**, or **public with review mode on**) and the recipe forbids the scheduled run from publishing; Chapter I shipped **cited and deduped** as one Patch + one chapter; the recipe is **fully self-contained** (ids, brief, quality bar included); the scheduling advice matched where Synek actually runs; and the routine has a **memory** — a keeper log node, its id in the recipe — so a run can tell how long it's been, a nothing-new run still leaves a trace, and a deferred item comes back for a second look instead of being re-litigated from scratch. The failure modes: a brief that admits everything, a recipe that assumes context it won't have, a schedule pointed at a server it can't reach, or a routine that can't tell a quiet week from a dead scheduler.
