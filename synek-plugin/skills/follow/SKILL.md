---
name: follow
description: "Follow a topic in Synek: a living timeline + serialized story kept current on a schedule. Use when the user runs /synek:follow, asks to follow/track/monitor a topic over time, wants a recurring digest of a field (a market, a technology, a rivalry), or a timeline that stays current AND tells its story chapter by chapter. The packaged loop: scope brief → series → first chapter now → a recurring keeper-chapter routine for any MCP client."
argument-hint: <topic>  (e.g. "frontier AI models", "the space launch market". Omit to be asked.)
allowed-tools: ["mcp__plugin_synek_synek__list_projects", "mcp__plugin_synek_synek__create_project", "mcp__plugin_synek_synek__list_timelines", "mcp__plugin_synek_synek__create_timeline", "mcp__plugin_synek_synek__create_series", "mcp__plugin_synek_synek__get_series", "mcp__plugin_synek_synek__set_series_review_mode", "mcp__plugin_synek_synek__get_layout_report", "mcp__plugin_synek_synek__query_timeline", "mcp__plugin_synek_synek__get_node", "mcp__plugin_synek_synek__apply_patch", "mcp__plugin_synek_synek__update_timeline_memory", "mcp__plugin_synek_synek__write_story", "mcp__plugin_synek_synek__patch_story", "mcp__plugin_synek_synek__register_artifact", "mcp__plugin_synek_synek__search_artifacts", "WebSearch", "WebFetch"]
---

# /synek:follow: follow **$ARGUMENTS** on a living timeline

A **follow** is the packaged version of Synek's keeper pattern: one topic, one living timeline, one **private** serialized story that grows a chapter at a time. A routine *you* run on a cadence keeps it current. There is no agent inside Synek; your MCP client is the keeper and the writer, the app is the canvas and the reader.

This skill is a thin orchestrator over two skills you should read first: **`building-timelines`** (the `apply_patch` op shapes, edge kinds, `ref` aliasing, lanes) and **`next-chapter`** (the frontier-reading, grow-the-world, chapter-writing loop). It adds the part neither owns end-to-end: turning "I want to follow X" into a scoped, scheduled, honest routine in one sitting.

Four steps: fix the scope → set up the container → write Chapter I now → make it recurring.

---

## 1. Fix the scope brief (the anti-firehose move; do not skip)

"Follow AI" is not followable. An unbounded scope produces a firehose digest nobody reads. Before touching any tool, agree a **scope brief** with the user: one or two sentences naming *what counts* and *what sources to prefer*. Good ones are narrow enough to say no with:

> *"Frontier LLM releases (Claude, GPT, Gemini, open-weights). Each new model as it ships, with capability/price deltas. Sources: model cards, official release posts."*
> *"The commercial launch market: flights, contracts, failures, and pricing moves by the main providers. Sources: launch providers' own announcements, FAA/NASA filings."*

Ask what decision the user wants the follow to change (what they build? what they write about? what they buy?). If a candidate development wouldn't change that decision, it's out of scope. "Watching, not a beat" is the right call, and a watching item gets **recorded in the timeline's memory** (step 2) with the trigger that would promote it, rather than being silently dropped. Quote the final brief back and get a yes. **The brief is fixed once agreed.** It gets embedded verbatim in the routine recipe (step 4), and widening it later is a deliberate edit to the recipe, never drift inside a run.

When you name the preferred sources, name **both layers**: the vendors/actors who announce about themselves (release posts, filings, model cards) *and* the tooling/ecosystem layer around them (specs and protocol revisions, SDK releases, notable OSS, standards bodies). A source list that is only vendor announcements produces a press-release feed and misses the changes that most often alter what someone can actually build.

## 2. Set up the container (one-time)

- **Project:** `list_projects`. Reuse one that fits, else `create_project` named for the topic.
- **Timeline:** `create_timeline` in it. This is the follow's world graph.
- **Series:** `create_series`. Title = the follow's name, plus a one-line `hook` stating the scope brief's promise. For a follow the user wants **public**, pass `reviewMode: true` (or call `set_series_review_mode(true)` after). See below.

**Choose the follow's visibility. If it's public, REVIEW MODE is mandatory.** A follow can stay **private** (the default: owner-only, nothing to publish) or run **public** at `/sr/$slug`. The safety rule for an *automated* follow: **a public series must be in review mode.** With `reviewMode` on, every appended chapter is born a `draft` server-side (regardless of what the writer passes), so a scheduled run keeps writing into a public season and **nothing goes live until the owner approves it** (`patch_story` `update_meta status: "published"`, or the in-app series view). Without review mode, `set_series_public` publishes every future chapter the instant `write_story` runs, so **never make an automated follow public without review mode on.** (Sharing a single highlight is still fine via a hand-curated **standalone** public story: a one-off `write_story` that is not appended to the series.)

- **Memory:** the routine's memory is the timeline's own owner-private `memory` record, which lives on the timeline and not in the graph. Set it up immediately after the Chapter I patch (step 3) with one `update_timeline_memory`:

  ```
  update_timeline_memory {
    timelineId: "<TIMELINE_ID>",
    patch: {
      brief: "<THE AGREED SCOPE BRIEF, VERBATIM>",
      cadence: "<cadence>",
      coveredThrough: "<today, ISO>",
      appendRun: { date: "<today>", routine: "follow",
                   summary: "setup +N nodes, chapter I",
                   patchId: "<the Chapter I patch id>" }
    }
  }
  ```

  `brief` belongs to the user's half of the record, so writing it here is the one time you set it: the user just agreed it out loud. Later runs read it as instructions and leave it alone. Every later run also reads the whole record back from `get_layout_report`, which returns it as a top-level `memory` field, so **the recipe carries no memory id at all**. That is the simplification: a cold session finds its own memory inside the report it already asks for, instead of needing an id baked into the recipe to look anything up. Shape and field meanings: `building-timelines`, "Timeline memory: the timeline's standing context." If this follow is an old one that still carries a node in a `Keeper log` lane, migrate its `RUNS` and `WATCHING` into memory with `update_timeline_memory`, then delete that node.

Report the ids (project / timeline / series). The routine recipe needs them.

## 3. Write Chapter I now (prove the loop before scheduling it)

Run the **`next-chapter`** loop once, with one deviation from its default: for a follow, the **grow-the-world step is always on**. The whole point is discovering what's new, and "the search ran and found nothing" is information; "the search didn't run" is a broken follow.

In short (the `next-chapter` skill owns the details): `get_series` + `get_layout_report` for the frontier and node index → `WebSearch`/`WebFetch` scoped to the brief, after the watermark, primary sources → diff against what's already there → `apply_patch` ONE cited batch with a dated, countable summary → `register_artifact` for substantive sources → `write_story` with `appendToSeries`, anchored on the strongest new moment, every factual beat cited, closing with a "so what" beat that answers the decision from step 1 → the one `update_timeline_memory` from step 2, so the routine is born with a memory. Chapter I seeds an empty world, so expect this first run to be mostly `apply_patch`.

Report honestly per the `next-chapter` quality bar: added / skipped-as-duplicate / unverified, never an invented date or citation, and the series link.

## 4. Make it recurring

Match the cadence to how fast the topic moves (releases ≈ weekly; a market ≈ weekly/biweekly; slow research ≈ monthly). Don't over-poll; every run costs tokens and web calls. Then produce the **routine recipe**: a self-contained prompt the user saves into whatever scheduler their client has. It must carry everything a cold session needs, because future runs won't have this conversation.

```
You are the keeper-writer for my Synek follow "<TITLE>"
(project <PROJECT_ID>, timeline <TIMELINE_ID>, series <SERIES_ID>).
This routine's memory is the timeline's own memory record: you read it from
get_layout_report and write it with update_timeline_memory. It is not a node.
Cadence: <CADENCE>.
Scope brief (fixed; never widen the SUBJECT inside a run):
<THE AGREED BRIEF, VERBATIM>
It exists to inform this decision: <THE DECISION FROM STEP 1>.

Every run:
0. Note today's date. get_layout_report <TIMELINE_ID>; its `memory` field is
   this routine's memory, in two halves. The USER's half is instructions for
   this run: `brief` (the scope), `notes` (standing editorial instructions),
   `references` (standing sources). Never rewrite those three. YOURS is the
   record: `coveredThrough` (how far you have LOOKED), `runs` (recent runs),
   `watching` (items already weighed and deferred). If memory comes back empty,
   treat this as run 1. GAP = today - the newest date in `runs`, or
   `coveredThrough` when there are no runs yet. If GAP is more than 1.5x
   <CADENCE>, scheduled runs were missed: widen the search WINDOW (never the
   scope) to cover the whole gap, and state it in step 7.
1. get_series <SERIES_ID> for the frontier (latest chapter), and read the
   latest covered instant and the node index off step 0's layout report.
2. WebSearch/WebFetch for in-scope developments after the earlier of the
   frontier instant and `coveredThrough`, primary sources preferred. Check every
   standing `references` entry and re-check every WATCHING item in the same pass.
3. Drop anything already present (match the real event, not the wording).
   Sort the rest:
     BEATS:    in scope, dated, citable. Nodes this run.
     WATCHING: real but under the scope bar (plausible-but-unconfirmed, or
               too small to change the decision above). Not a rejection:
               record it with the date first seen and the specific trigger
               that would promote it.
   A WATCHING item that now crosses the bar is PROMOTED: a cited node this
   run, removed from the list. Drop any WATCHING item after 4 re-checks or 60
   days without movement and record that it aged out.
4. apply_patch ONE batch of the new cited nodes/edges, summary: "Keeper run
   <today>: +N <things>". On a run that found nothing, send no patch at all;
   step 5's memory write is that run's trace. Never add filler nodes to look
   busy. Every citation needs a resolvable URL (or register_artifact with a
   transcript); search_artifacts first to avoid duplicates. Keep the patchId
   the call returns, because step 5 records it.
5. write_story with appendToSeries: <SERIES_ID> for the next chapter, every
   factual beat cited, closing with the "so what" for the decision above.
   If genuinely nothing new: write NO chapter, because the memory write below
   is the trace. Never invent a date or citation, never repeat an earlier chapter.

   Then close EVERY run, including one that found nothing, with ONE
   update_timeline_memory <TIMELINE_ID> carrying only the fields you changed:

       patch: {
         coveredThrough: "<today>",
         appendRun: { date: "<today>", routine: "follow",
                      summary: "<+N nodes, chapter <N> | none (memory only)>
                                <, gap note>",
                      patchId: "<step 4's patch id, when there was one>" },
         watching: [ { item: "<item>", firstSeen: "<date>", rechecked: <n>,
                       promoteIf: "<trigger>" } ]
       }

   `coveredThrough` advances even on a run that found nothing, because it is how
   far you LOOKED, not the latest node date. Use appendRun rather than sending a
   whole runs array; the store prepends and trims. Writes are FIELD-SCOPED, so
   logging a run cannot clobber the brief/notes/references the user owns, and the
   user editing notes in the app cannot drop your history. All dates are ISO
   calendar dates ("2026-08-17"); the schema rejects anything else. Pass the
   patchId so a run someone later undid reads as undone. Without this call a
   quiet week and a scheduler that never fired look identical.
6. NEVER publish from a scheduled run: no set_series_public, no
   patch_story status:"published". A public follow MUST be in review mode, so
   your appended chapter lands as a draft; leave every one for the owner to approve.
7. Report:
   - Since last run: <N> days<, plus "M scheduled runs missed; check the
     scheduler" when the gap exceeded the cadence>.
   - Added / skipped-as-duplicate / unverified.
   - Watching: <N> carried, naming anything promoted or aged out.
   - Awaiting approval: <count of chapters get_series returned with status
     "draft">, if any.
   - The chapter link, or "no chapter this run".
8. Optional, never load-bearing: if you have file tools and <MIRROR_PATH>'s
   folder already exists, append the run line there for easy skimming. Skip
   silently otherwise. Never create folders, never fail a run over it. The
   timeline's memory is the only source of truth.
```

**Where the schedule lives depends on where Synek lives.** Be upfront about the constraint rather than setting up a routine that can't connect:

| Synek origin | Viable schedulers |
|---|---|
| **Hosted** (an `https://…` origin, `SYNEK_MCP_URL` set) | Any: your client's scheduled tasks, OS cron/launchd running headless Claude Code, or a cloud routine. They can all reach the server. For headless runs, the static-key fallback in `/synek:setup` §2d (a `synek_…` key as a `Authorization: Bearer` header on an MCP server entry) is more robust than OAuth. |
| **Local** (`http://localhost:3001`, the default) | On-demand runs of this skill, `/loop` in an open session, or an OS scheduler on the *same machine*. A cloud routine **cannot** reach localhost, so don't set one up. |

**The routine's memory lives on the timeline, so it survives any runner.** A cloud routine gets a fresh sandbox every fire and would lose a file; it always gets the memory back on the `get_layout_report` it opens with. If the routine runs locally and the user wants something greppable, fill in `<MIRROR_PATH>` (e.g. the routine's own folder) for step 8; if it runs in the cloud, **delete step 8** rather than leave a path that will never exist. Nothing ever *reads* the mirror to decide anything.

Hand the user the filled-in recipe plus the concrete scheduling step for their situation, and remind them: the first few scheduled runs deserve a read within a day or two. A follow nobody reads should be paused, not left burning tokens. If the series is in review mode, "read it" has a natural signal, which is an approved chapter. Drafts piling up unapproved *is* the unread count.

---

## Quality bar

A follow is set up well when: the scope brief is **narrow enough to reject things** and names the decision it serves; the series' visibility is deliberate (**private**, or **public with review mode on**) and the recipe forbids the scheduled run from publishing; Chapter I shipped **cited and deduped** as one Patch + one chapter; the recipe is **fully self-contained** (ids, brief, quality bar included); the scheduling advice matched where Synek actually runs; and the routine has a **memory** (the timeline's own memory record, seeded at setup and read back from `get_layout_report` every run) so a run can tell how long it's been, a nothing-new run still leaves a trace, and a deferred item comes back for a second look instead of being re-litigated from scratch. The failure modes: a brief that admits everything, a recipe that assumes context it won't have, a schedule pointed at a server it can't reach, or a routine that can't tell a quiet week from a dead scheduler.
