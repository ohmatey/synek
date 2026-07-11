---
"synek": minor
---

Canvas layout: node orientation, readable connector labels, and controllable suggestion ghosts.

- **Node shape** — event/concept nodes can render as the one-line pill (default) or a
  **stacked card** that wraps the title above the date, so long titles cost height instead
  of axis width. A per-timeline view setting (`viewSettings.nodeOrientation`), set from the
  display popover or the MCP `set_timeline_view` tool; no migration.
- **Edge labels off the nodes** — connector labels are now solved against the node rects
  (`placeEdgeLabel`) and rendered via a custom `LabeledEdge`, instead of React Flow's default
  midpoint label that landed on top of the next lane's card. Each placed label is an obstacle
  for the next, long labels ellipsize (full text on hover), and lane/row/gap spacing was
  widened to give connectors room.
- **Suggestion ghost controls** — the owner-only invitation ghosts (thin lane / gap / bare
  era) gain a global "Show suggestions" toggle, per-ghost dismiss (remembered per timeline),
  and an "Add to a track…" ⌘K action so hiding a ghost never loses the underlying prompt.
