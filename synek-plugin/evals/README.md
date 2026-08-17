# building-timelines evals

A deterministic harness for checking that the `building-timelines` skill produces
timelines a person wants to look at, and specifically that it **swimlanes
parallel tracks** instead of dumping everything into one collision-stacked lane.

These files are dev tooling for the plugin, not part of the shipped skill.

```
evals/
  grade-timeline.mjs    deterministic graph-quality grader (no deps, run with node)
  dump-timeline.mjs     read a live timeline from the SQLite DB → get_timeline JSON
  cases.json            eval scenarios (prompt + grading flags)
  fixtures/             committed known-good / known-bad graphs for regression
```

## The rubric (what the grader checks)

Each check has a weight; the score is the weighted % earned. A timeline **fails**
if score < 80 **or** any critical (weight-3) check fails.

| Check | Weight | Why |
|---|---|---|
| ≥ 90% of nodes have a summary | 2 | Bare titles make cold cards. |
| every `entity` has a `subtype` | 1 | Drives card treatment (person/org/place/work). |
| some citations present (≥ 30%) | 1 | The product is about primary-source grounding. |
| **multi-track → ≥ 90% nodes laned** | 3 | The fix for the spaghetti: parallel actors get swimlanes. |
| **multi-track → ≥ minLanes lanes** | 2 | One lane per actor, not everything in one. |
| **no intra-lane `succeeded` edges** | 3 | Lane order already shows succession; chains = crossing hairball. |
| no `competed_with` edges | 1 | Side-by-side lanes already show rivalry. |
| **no group stacks > N rows** (N=2 with lanes, 3 without) | 3 | Directly measures the "stacked block" failure. |
| edge density ≤ 1.5 / node | 1 | Guards against a fully-connected hairball. |

"Multi-track" (parallel actors that should be swimlaned) is asserted with
`--multi-track`; otherwise it's inferred only when lanes are already present, so a
single long narrative is never told to invent lanes.

## Run it

Grade a fixture:

```
node synek-plugin/evals/grade-timeline.mjs synek-plugin/evals/fixtures/clean-swimlanes.json --multi-track --min-lanes 5
```

Grade a live timeline (reads `local.db` read-only, so it is safe alongside the app):

```
node synek-plugin/evals/dump-timeline.mjs <timelineId> | node synek-plugin/evals/grade-timeline.mjs - --multi-track --min-lanes 5
```

`--json` emits machine-readable output. Exit code is 0 on pass, 1 on fail, 2 on
bad input, so it drops straight into CI or a loop.

## Regression fixtures

- `fixtures/clean-swimlanes.json`: the AI-race timeline after swimlane cleanup. **Must PASS.**
- `fixtures/messy-no-lanes.json`: the same topic as the anti-pattern (no lanes, `succeeded` chains, `competed_with`). **Must FAIL** (tallest group needs 6 rows).

If a change to `grade-timeline.mjs` lets the messy fixture pass or the clean one
fail, the grader has regressed.

## Agentic eval (end-to-end: does the skill actually steer the model?)

The grader scores a finished graph; the cases test whether the skill *produces*
good graphs. To run a case end-to-end:

1. `create_timeline` → fresh id.
2. Give a model the case `prompt` with the `building-timelines` skill loaded and
   the `synek` MCP server connected, pointed at that timeline.
3. `node dump-timeline.mjs <id> | node grade-timeline.mjs - [--multi-track --min-lanes N]`
   using the case's flags.
4. Assert exit 0.

Run the whole suite by looping `cases.json`. Because each case is independent,
this fans out cleanly across subagents (one per case) when an orchestrated run is
wanted: build in parallel, grade each as it lands.
