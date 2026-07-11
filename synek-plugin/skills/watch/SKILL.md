---
name: watch
description: "Keep a Synek timeline current as the world changes — a keeper routine. Use when the user runs /synek:watch, asks to keep a timeline up to date / fresh / current, to track competitors, model releases, funding/acquisitions, or an ongoing field, or to auto-update / schedule a recurring routine for a timeline (a Living Timeline). Runs a keeper pass now — adds only what's new, one Patch — then offers to make it recurring in any MCP client."
argument-hint: <timeline>  (title or id — e.g. "Frontier AI Models". Omit to pick from a list.)
allowed-tools: ["mcp__plugin_synek_synek__list_timelines", "mcp__plugin_synek_synek__get_timeline", "mcp__plugin_synek_synek__query_timeline", "mcp__plugin_synek_synek__get_node", "mcp__plugin_synek_synek__get_layout_report", "mcp__plugin_synek_synek__apply_patch", "mcp__plugin_synek_synek__register_artifact", "mcp__plugin_synek_synek__search_artifacts", "WebSearch", "WebFetch"]
---

# /synek:watch — keep **$ARGUMENTS** current

Some timelines are *finished* — the history of Stoicism doesn't change. Others are **alive**: a competitive landscape, the run of frontier model releases, an ongoing research field. A **keeper routine** is what keeps a live timeline current — it periodically looks for what's happened since last time and adds *only the new developments*, as one undoable Patch.

There is no agent inside Synek. **You** are the keeper — the app is the canvas, your MCP client is the brain. So a "Living Timeline" isn't a feature the app runs; it's a routine *you* run against the existing MCP tools. This skill does two things:

1. **Run a keeper pass now** — find what's new, add it, report it. (Do this first — it's instant value and it proves the loop works before anyone commits to a schedule.)
2. **Make it recurring** — turn that pass into a routine the user can run on a cadence, in Claude Code or any MCP client.

Read the `building-timelines` skill first — it has the exact `apply_patch` op shapes, the closed edge-`kind` set, `ref` aliasing, and swimlanes. This skill assumes those and focuses on the part that's unique to keeping a timeline alive: **adding only what's genuinely new, without duplicating what's already there.**

---

## Part 1 — Run a keeper pass now

### 1. Identify the timeline
If `$ARGUMENTS` names a timeline, call `list_timelines` and match it (by title or id). If it's empty or ambiguous, show the list and ask which one. Keep the `id`. If `list_timelines` errors, stop and run `/synek:setup` — don't keep against a dead server.

### 2. Read what's already there (this is the dedup baseline — do not skip)
Call **`get_layout_report`** for the timeline. It's built for exactly this review: a **compact node index** (titles + dates), **lane health**, **axis dead zones**, **era/story coverage**, and the **source registry** (what's already cited). This tells you what the timeline already knows and *how recent* it is. Note the **latest node date** on the relevant lanes — that's your watermark: you're looking for things *after* it. For a denser look at one track, `query_timeline` with a type/lane filter.

### 3. Establish the scope brief
What is this timeline *watching*, and from where? Infer it from the title + existing nodes, or use the saved **routine recipe** (below) if one exists. A good brief is one sentence:
> *"Frontier LLM releases (Claude, GPT, Gemini, open-weights) — each new model as it ships, with capability/price deltas."*
> *"The vector-database market — funding, acquisitions, pivots, and notable launches among the main players."*

### 4. Gather new signal — scoped to the gap
`WebSearch` (and `WebFetch` to confirm details and get citable URLs) for developments **in the scope brief, after the watermark**. Query the gap, not the whole topic — e.g. *"frontier model releases since 2026-04"*, *"<competitor> funding OR acquisition 2026"*. Prefer primary/authoritative sources (a model card, a release post, an SEC/press filing, a paper) so every node you add can carry a real `citation`. If your own knowledge is fresher than search for some items, still verify the date.

### 5. Diff — keep only what's new
For each candidate development, check it against the node index from step 2:
- **Already on the timeline?** Skip it. (Match on the real-world event, not exact title wording.)
- **An update to an existing node** — e.g. a company you already track got acquired? That's an `update_node` (or a new `event` + an `acquired`/`succeeded` edge), not a duplicate entity.
- **Genuinely new?** It's an add. Most live-timeline additions are `event` nodes (a release, a raise, an acquisition, a result — a point in time, no `end`), placed on the right `lane`, wired with honest typed edges (`succeeded` from the prior model, `competed_with`, `acquired`, `caused`, `influenced`).

If nothing is new, **say so and stop** — "nothing new since `<date>`" is a correct and valuable keeper result. Don't manufacture filler to look busy.

### 6. Apply it as ONE Patch
Assemble all the new nodes + edges and send a single `apply_patch`. Give it a dated, countable `summary` so the history reads like a log of keeper runs:
> `summary: "Keeper run 2026-06-13 — +3 model releases"`

One run = one Patch = one `⌘Z` undoes the whole run if the user doesn't like it. Cite every added node. Set `subtype` on any entities. Keep edges few and meaningful.

### 7. Ground the signal (optional but encouraged)
For substantive sources, `register_artifact` so the evidence is stored, not just linked — `search_artifacts` first to avoid re-registering the same source. This is what keeps a live timeline *grounded* rather than drifting.

### 8. Report honestly
Tell the user, tightly:
- **Added:** N nodes (list them with dates).
- **Skipped:** already present (so they trust the dedup).
- **Unverified:** anything you found but couldn't confirm a date/source for — report it as *unverified*, **never invent** a date or a citation to fill a gap. A keeper that fabricates is worse than one that misses.
- The canvas link: `<origin>/timelines/<id>` — the origin is `http://localhost:3001` locally, or the hosted base URL (`SYNEK_MCP_URL` minus the `/api/mcp` suffix) when the plugin points at a deployed Synek.

Then offer Part 2.

---

## Part 2 — Make it recurring

First decide *whether* it should recur. On-demand `/synek:watch` is often enough and has zero failure modes. Offer a schedule when the timeline is genuinely fast-moving and the user wants it to stay current without thinking about it.

### The constraint depends on where Synek lives — local vs hosted
The one hard rule: **a scheduled cloud agent runs in Anthropic's cloud and cannot reach `localhost`.** So whether a cloud routine works comes down to where the Synek server is:

- **Local Synek** (`http://localhost:3001`) — a cloud routine can't reach it. Recurring has to run **on the same machine** (OS scheduler / `/loop`).
- **Hosted Synek** (a public `https://…` origin, the plugin pointed at it via `SYNEK_MCP_URL`) — a cloud routine **can** reach it. The hosted path unlocks true hands-off scheduling.

Pick the path that matches where this user's Synek lives:

| Path | When | How |
|---|---|---|
| **On-demand** (recommended start) | Always works; zero setup | The user runs `/synek:watch <timeline>` whenever they want a refresh. |
| **Recurring, local machine** | Local Synek, hands-off | An OS scheduler (`cron` / macOS `launchd`) runs **local, headless** Claude Code with the routine prompt on a cadence — it's on the same machine, so it reaches `localhost`. Or keep a session open and use `/loop` for a working day. |
| **Recurring, cloud routine** | **Hosted Synek** — the plugin points at a public `https://…/api/mcp` origin (`SYNEK_MCP_URL` set) | A normal Claude Code scheduled routine (`/schedule`) with the routine prompt. The cloud agent reaches the hosted origin and authorizes over OAuth just like the interactive client. (Still **don't** schedule a cloud routine against a localhost-only server — it can't connect.) |

Match the cadence to how fast the world moves: model releases ≈ weekly; a competitive landscape ≈ weekly/biweekly; a slow research field ≈ monthly. Don't over-poll — every run costs tokens and web calls.

### The routine recipe (the portable unit — works in any client)
A routine is just a saved prompt the user can paste into Claude Code's scheduler, an OS cron job, Claude Desktop (stdio MCP), or any MCP client. Produce one filled in for this timeline and hand it to the user to save:

```
You are the keeper for my Synek timeline "<TITLE>" (id <ID>).
Scope: <one-sentence scope brief — what this timeline watches and from where>.
Sources: prefer <primary/authoritative sources for this topic>.

Every run:
1. get_layout_report for <ID> to see what's already on it and the latest date.
2. WebSearch/WebFetch for developments in scope AFTER that latest date.
3. Drop anything already present (match the real event, not the wording).
4. apply_patch ONE batch of the genuinely-new nodes+edges, each cited,
   summary: "Keeper run <DATE> — +N <things>". register_artifact for key sources.
5. Report what you added, what you skipped, and anything unverified.
   Never invent a date or a citation. If nothing is new, say so and stop.
```

That recipe *is* the routine — the same text drives the on-demand run, the local cron, and a future cloud schedule. To run it in **any client**, the only requirements are that client's MCP connection to Synek (`/synek:setup` covers Claude Code; Claude Desktop uses the stdio binary) plus web access for the signal step.

---

## Quality bar

A keeper run is good when: it added **only** things that are actually new, every addition is **dated and cited**, duplicates were **caught and skipped**, the additions sit in the **right lanes** with **honest edges**, and the report is **straight** about what was verified vs. not. "Nothing new since <date>" is a passing run. A run that re-adds an existing model, or invents a launch date to look productive, is a failure even if every op succeeded.
