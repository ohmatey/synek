---
name: watch
description: "Keep a Synek timeline current as the world changes: a keeper routine. Use when the user runs /synek:watch, asks to keep a timeline up to date / fresh / current, to track competitors, model releases, funding/acquisitions, or an ongoing field, or to auto-update / schedule a recurring routine for a timeline (a Living Timeline). Runs a keeper pass now (adds only what's new, one Patch), then offers to make it recurring in any MCP client."
argument-hint: <timeline>  (title or id, e.g. "Frontier AI Models". Omit to pick from a list.)
allowed-tools: ["mcp__plugin_synek_synek__list_timelines", "mcp__plugin_synek_synek__get_timeline", "mcp__plugin_synek_synek__query_timeline", "mcp__plugin_synek_synek__get_node", "mcp__plugin_synek_synek__get_layout_report", "mcp__plugin_synek_synek__apply_patch", "mcp__plugin_synek_synek__update_timeline_memory", "mcp__plugin_synek_synek__register_artifact", "mcp__plugin_synek_synek__search_artifacts", "WebSearch", "WebFetch"]
---

# /synek:watch: keep **$ARGUMENTS** current

Some timelines are *finished*. The history of Stoicism doesn't change. Others are **alive**: a competitive landscape, the run of frontier model releases, an ongoing research field. A **keeper routine** is what keeps a live timeline current. It periodically looks for what's happened since last time and adds *only the new developments*, as one undoable Patch.

There is no agent inside Synek. **You** are the keeper. The app is the canvas; your MCP client is the brain. A "Living Timeline" is a routine *you* run against the existing MCP tools, not something the app runs on its own. This skill does two things:

1. **Run a keeper pass now**: find what's new, add it, report it. (Do this first. It gives instant value and proves the loop works before anyone commits to a schedule.)
2. **Make it recurring**: turn that pass into a routine the user can run on a cadence, in Claude Code or any MCP client.

Read the `building-timelines` skill first. It has the exact `apply_patch` op shapes, the closed edge-`kind` set, `ref` aliasing, and swimlanes. This skill assumes those and focuses on the part that's unique to keeping a timeline alive: **adding only what's genuinely new, without duplicating what's already there.**

---

## Part 1: Run a keeper pass now

### 1. Identify the timeline
If `$ARGUMENTS` names a timeline, call `list_timelines` and match it (by title or id). If it's empty or ambiguous, show the list and ask which one. Keep the `id`. If `list_timelines` errors, stop and run `/synek:setup`. Don't keep against a dead server.

### 2. Read what's already there (this is the dedup baseline; do not skip)
Call **`get_layout_report`** for the timeline. It's built for exactly this review: a **compact node index** (titles + dates), **lane health**, **axis dead zones**, **era/story coverage**, and the **source registry** (what's already cited). This tells you what the timeline already knows and *how recent* it is. Note the **latest node date** on the relevant lanes. That's your watermark: you're looking for things *after* it. For a denser look at one track, `query_timeline` with a type/lane filter.

**The same call returns the timeline's `memory`**, the standing record this routine keeps (see `building-timelines`, "Timeline memory: the timeline's standing context"). It lives on the timeline, not in the graph, so nothing is excluded from the watermark: the latest node date is simply the latest node date. Read **both regions**. The user's `brief`, `notes` and `references` are **instructions**: what this timeline covers and excludes, their standing editorial rules, and the sources to check every run. Your own `cadence`, `coveredThrough`, `watching` and `runs` tell you when you last looked and what you already weighed and set aside.

Then note today's date and compute the gap: `today − the date of the newest entry in memory's runs` (fall back to `coveredThrough` when there are no runs yet). If that gap is more than **1.5× the stated cadence**, **scheduled runs were missed**: cover the whole gap in step 4 and say so in step 8. No memory yet (an on-demand pass, or a routine created before memory existed)? Fall back to the frontier date and report the gap as unknown.

If this timeline still carries an old **`Keeper log`** node from a previous version of this plugin, migrate it now: copy its RUNS and WATCHING into memory with `update_timeline_memory`, then delete the node in this run's patch (step 6).

### 3. Establish the scope brief
What is this timeline *watching*, and from where? Memory's `brief` is the answer when it's set, and it is the user's, so treat it as fixed. Otherwise infer it from the title + existing nodes, or use the saved **routine recipe** (below) if one exists. A good brief is one sentence:
> *"Frontier LLM releases (Claude, GPT, Gemini, open-weights): each new model as it ships, with capability/price deltas."*
> *"The vector-database market: funding, acquisitions, pivots, and notable launches among the main players."*

### 4. Gather new signal, scoped to the gap
`WebSearch` (and `WebFetch` to confirm details and get citable URLs) for developments **in the scope brief**, across the window `[min(coveredThrough, watermark), today]`, not merely after the watermark, or a missed run's developments fall through the crack. Query the gap, not the whole topic. Examples: *"frontier model releases since 2026-04"*, *"<competitor> funding OR acquisition 2026"*. Work through memory's `references` first, since those are the sources the user pinned to this timeline. **Re-check every `watching` item by name** in the same pass; remembering them is the whole point of writing them down.

> Widening the **window** after a missed run is required. Widening the **scope** never is; the brief is fixed. A three-week gap means three weeks of the *same* brief, not a looser one.

Prefer primary/authoritative sources (a model card, a release post, an SEC/press filing, a paper) so every node you add can carry a real `citation`. If your own knowledge is fresher than search for some items, still verify the date.

**Sweep the ecosystem layer too, not just the vendors.** The obvious sources are announcements issued by the entity that *is* the subject: a vendor's release post, a provider's filing. Those are necessary and insufficient. They systematically miss the tooling and standards layer where a lot of what actually changes a practitioner's options lives (framework and SDK releases, protocol/spec revisions and deprecations, package registries, standards bodies, notable OSS repos). Search both, or the timeline becomes a vendor press-release feed.

### 5. Diff: keep only what's new
For each candidate development, check it against the node index from step 2:
- **Already on the timeline?** Skip it. (Match on the real-world event, not exact title wording.)
- **An update to an existing node**, e.g. a company you already track got acquired? That's an `update_node` (or a new `event` + an `acquired`/`succeeded` edge), not a duplicate entity.
- **Genuinely new?** It's an add. Most live-timeline additions are `event` nodes (a release, a raise, an acquisition, a result: a point in time, no `end`), placed on the right `lane`, wired with honest typed edges (`succeeded` from the prior model, `competed_with`, `acquired`, `caused`, `influenced`).
- **Real, but under the scope bar?** Plausible-but-unconfirmed, or too small to be a beat. That's a **`watching`** item, not a rejection. Carry it in memory with `firstSeen` (the date you first saw it) and **the specific trigger that would promote it**, as `promoteIf` ("a company post or filing", "a dated GA announcement"). A `watching` item that now crosses the bar is **promoted**: it becomes a normal cited node in this run's patch and leaves the list.
- **Age items out.** Drop a `watching` item after **4 re-checks or 60 days** without movement, and record that it aged out. A watch list that only grows is a second firehose.

If nothing is new, **say so, then still send the memory update (step 6) and stop.** "Nothing new since `<date>`" is a correct and valuable keeper result, but a null run that leaves *no trace* is indistinguishable from a scheduler that never fired. Recording the run is not manufacturing filler; adding topic nodes to look busy is.

### 6. Apply it as ONE Patch
The content of a run goes out as **exactly one** `apply_patch`, containing the new nodes + edges. Give it a dated, countable `summary` so the history reads like a log of keeper runs:
> `summary: "Keeper run 2026-06-13: +3 model releases"`
> `summary: "Keeper run 2026-06-20: +1 acquisition, 1 watched item promoted"`

One run = one Patch = one `⌘Z` undoes the whole run if the user doesn't like it. Cite every added node. Set `subtype` on any entities. Keep edges few and meaningful. Keep the `patchId` the call returns. **A run that found nothing has nothing to patch: skip the `apply_patch` entirely.**

Then close every run, including one that found nothing, with **one** `update_timeline_memory { timelineId, patch: { … } }` carrying:

- **`appendRun`**: `{ date: "<today, ISO>", summary: "+3 model releases"` (or `"no new developments"`)`, patchId: "<from the patch above>" }`. Append rather than rewriting a runs array; the store prepends and trims. Pass the `patchId` so a run someone later undid reads as undone. Omit `patchId` when you sent no patch.
- **`coveredThrough`**: today, as an ISO calendar date. It is how far you have **looked**, so it advances on a nothing-new run while the latest node date stays put.
- **`watching`**: the carried list from step 5, each `{ item, firstSeen, rechecked, promoteIf }`, minus anything promoted or aged out.

Set `cadence` too when it changed. Writes are **field-scoped**, so only the keys you pass change: logging a run cannot clobber the user's `brief`/`notes`/`references`, and you never write those three unless the user asks. Dates are ISO calendar dates (`"2026-08-17"`); the schema rejects other formats. **This update is the run's proof of life**, and it is not part of the undo/redo Patch stack, which is exactly why the `patchId` matters: undoing the content patch leaves the run entry standing, marked with the patch that is now gone.

### 7. Ground the signal (optional but encouraged)
For substantive sources, `register_artifact` so the evidence is stored, not just linked. Call `search_artifacts` first to avoid re-registering the same source. This is what keeps a live timeline *grounded* rather than drifting.

### 8. Report honestly
Tell the user, tightly:
- **Since last run:** N days, plus *"M scheduled runs missed; check the scheduler"* when the gap exceeded the cadence, or *"first recorded run"* when memory holds no runs yet.
- **Added:** N nodes (list them with dates).
- **Skipped:** already present (so they trust the dedup).
- **Watching:** N carried, naming anything **promoted** to a node or **aged out** this run.
- **Unverified:** anything you found but couldn't confirm a date/source for. Report it as *unverified*, and **never invent** a date or a citation to fill a gap. A keeper that fabricates is worse than one that misses.
- The canvas link: `<origin>/timelines/<id>`. The origin is `http://localhost:3001` locally, or the hosted base URL (`SYNEK_MCP_URL` minus the `/api/mcp` suffix) when the plugin points at a deployed Synek.

Then offer Part 2.

---

## Part 2: Make it recurring

First decide *whether* it should recur. On-demand `/synek:watch` is often enough and has zero failure modes. Offer a schedule when the timeline is genuinely fast-moving and the user wants it to stay current without thinking about it.

### The constraint depends on where Synek lives: local vs hosted
The one hard rule: **a scheduled cloud agent runs in Anthropic's cloud and cannot reach `localhost`.** So whether a cloud routine works comes down to where the Synek server is:

- **Local Synek** (`http://localhost:3001`): a cloud routine can't reach it. Recurring has to run **on the same machine** (OS scheduler / `/loop`).
- **Hosted Synek** (a public `https://…` origin, the plugin pointed at it via `SYNEK_MCP_URL`): a cloud routine **can** reach it. The hosted path unlocks true hands-off scheduling.

Pick the path that matches where this user's Synek lives:

| Path | When | How |
|---|---|---|
| **On-demand** (recommended start) | Always works; zero setup | The user runs `/synek:watch <timeline>` whenever they want a refresh. |
| **Recurring, local machine** | Local Synek, hands-off | An OS scheduler (`cron` / macOS `launchd`) runs **local, headless** Claude Code with the routine prompt on a cadence; it's on the same machine, so it reaches `localhost`. Or keep a session open and use `/loop` for a working day. |
| **Recurring, cloud routine** | **Hosted Synek**: the plugin points at a public `https://…/api/mcp` origin (`SYNEK_MCP_URL` set) | A normal Claude Code scheduled routine (`/schedule`) with the routine prompt. The cloud agent reaches the hosted origin and authorizes over OAuth just like the interactive client. (Still **don't** schedule a cloud routine against a localhost-only server; it can't connect.) |

Match the cadence to how fast the world moves: model releases ≈ weekly; a competitive landscape ≈ weekly/biweekly; a slow research field ≈ monthly. Don't over-poll: every run costs tokens and web calls.

### The routine recipe (the portable unit that works in any client)
The routine needs no setup patch and no baked-in id. **Its memory already lives on the timeline**: `get_layout_report` returns it and `update_timeline_memory` writes it, so a cold run always finds its own context. If the user just settled the scope, cadence or standing sources with you, write them once now with `update_timeline_memory { timelineId, patch: { brief, cadence, references } }`. Those are the user's answer, and every later run reads them as instructions.

A routine is just a saved prompt the user can paste into Claude Code's scheduler, an OS cron job, Claude Desktop (stdio MCP), or any MCP client. Produce one filled in for this timeline and hand it to the user to save:

```
You are the keeper for my Synek timeline "<TITLE>" (id <ID>).
Cadence: <CADENCE>.
Scope: <one-sentence scope brief covering what this timeline watches and from where>.
Sources: prefer <primary/authoritative sources for this topic>. Sweep the
tooling/ecosystem layer too (specs, SDKs, notable OSS), not just vendors.

Every run:
0. Note today's date.
1. get_layout_report <ID>: what's already on it, the latest node date, AND the
   timeline's `memory`, which is this routine's memory. brief, notes and
   references are the user's: read them as instructions and do not rewrite
   them. cadence, coveredThrough, watching and runs are yours. GAP = today -
   the date of the newest entry in runs (coveredThrough if there are none
   yet). If GAP is more than 1.5x <CADENCE>, runs were missed. Widen the
   search WINDOW to cover the whole gap (never the scope) and report it. No
   memory yet? Treat this as run 1 and use the latest node date.
2. WebSearch/WebFetch for in-scope developments after the earlier of that
   latest node date and coveredThrough. Work through the references in memory,
   and re-check every watching item by name too.
3. Sort candidates: already present -> skip (match the real event, not the
   wording); in scope, dated and citable -> a node this run; real but under
   the scope bar -> watching, with the trigger that would promote it. A
   watching item that now crosses the bar is promoted to a node. Drop any
   watching item after 4 re-checks or 60 days and record it as aged out.
4. apply_patch ONE batch: the new cited nodes/edges, summary "Keeper run
   <today>: +N <things>". Keep the patchId it returns. FOUND NOTHING? Send no
   patch at all. Then, EVERY run including a nothing-new one, send ONE
   update_timeline_memory (it is the run's only trace, and it is not on the
   undo stack):

     update_timeline_memory { timelineId: "<ID>", patch: {
       coveredThrough: "<today, ISO>",
       appendRun: { date: "<today, ISO>",
                    summary: "+N <things>" or "no new developments",
                    patchId: "<from the patch above, omit if none>" },
       watching: [ { item: "<item>", firstSeen: "<ISO date>", rechecked: <n>,
                     promoteIf: "<trigger>" } ]
     } }

   Writes are field-scoped, so this cannot touch brief/notes/references; use
   appendRun rather than rewriting a runs array. coveredThrough is how far you
   LOOKED, so it advances even on a nothing-new run. Dates are ISO calendar
   dates. Never add filler nodes to look busy. Every citation needs a
   resolvable URL (or register_artifact with a transcript); search_artifacts
   first.
5. Report: since last run (and any missed runs), added, skipped, unverified,
   watching (N, naming anything promoted or aged out). Never invent a date or
   a citation. If nothing is new, say so, after the memory update, not instead of it.
```

That recipe *is* the routine: the same text drives the on-demand run, the local cron, and a future cloud schedule. To run it in **any client**, the only requirements are that client's MCP connection to Synek (`/synek:setup` covers Claude Code; Claude Desktop uses the stdio binary) plus web access for the signal step.

---

## Quality bar

A keeper run is good when: it added **only** things that are actually new, every addition is **dated and cited**, duplicates were **caught and skipped**, the additions sit in the **right lanes** with **honest edges**, and the report is **straight** about what was verified vs. not. "Nothing new since <date>" is a passing run, **but only if it left a memory update.** A run that can't say how long it's been since the last one has no memory, and a keeper with no memory can't tell a quiet week from a dead scheduler. A run that re-adds an existing model, or invents a launch date to look productive, has failed the user however cleanly its ops applied.
