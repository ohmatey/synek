// Prompt builders for the node "verbs" (NEXT.5 — docs/product/prd/next5-verb-system.md).
// The app holds no AI, so each verb hands the user a ready-made prompt to paste into
// their connected Claude, which does the work via the Synek MCP tools. Siblings of
// talk-to-prompt.ts / story-prompt.ts / timeline-prompt.ts — same structured idiom
// (`- key: value` lines, look-before-you-edit, cite freely, stay faithful).

// EXPAND around a node — pull in directly-connected entities not yet on the
// timeline and wire the relationships. Drives apply_patch (add_node + add_edge).
export function buildExpandPrompt(input: {
  timelineId: string
  nodeId: string
  title: string
}): string {
  return (
    `Using the Synek MCP tools, expand the timeline around "${input.title}".\n` +
    `- timelineId: ${input.timelineId}\n` +
    `- around nodeId: ${input.nodeId}\n` +
    `First call get_node and query_timeline to see what's already connected to it. Then, in a single ` +
    `apply_patch, ADD the people, organizations, events, or concepts directly connected to ${input.title} ` +
    `that aren't on the timeline yet, and wire each to ${input.title} (and to each other where it fits) with ` +
    `edges of the right kind (caused / succeeded / influenced / …). Anchor every new node to a real date with ` +
    `the right precision, give it a face (a real, web-accessible image url) where you can, and ground it with a ` +
    `citation (title + url + a short verbatim quote). Only add real, genuinely connected entities — keep it faithful.`
  )
}

// IMPROVE a single node — tighten what's weak. Drives apply_patch (update_node).
export function buildImproveNodePrompt(input: {
  timelineId: string
  nodeId: string
  title: string
  kind: string
}): string {
  return (
    `Using the Synek MCP tools, improve this ${input.kind} on the timeline.\n` +
    `- timelineId: ${input.timelineId}\n` +
    `- nodeId: ${input.nodeId}\n` +
    `- ${input.kind}: "${input.title}"\n` +
    `First call get_node to read its current state. Then, with update_node in a single apply_patch: tighten the ` +
    `summary, sharpen the date/precision if it's vague, add a real sourced image (url) if it has none, and back ` +
    `its key claims with a citation (title + url + a short verbatim quote). Improve only what's weak — leave what's ` +
    `already good. Keep it faithful to what actually happened.`
  )
}

// WHAT ELSE was happening — add the concurrent context as a parallel lane. Drives
// apply_patch (add_node with a shared `lane`).
export function buildWhatsHappeningPrompt(input: {
  timelineId: string
  nodeId: string
  title: string
  date: string
}): string {
  return (
    `Using the Synek MCP tools, show what else was happening around "${input.title}" (${input.date}).\n` +
    `- timelineId: ${input.timelineId}\n` +
    `- anchor nodeId: ${input.nodeId}\n` +
    `- around: ${input.date}\n` +
    `Find other significant events, people, or works from the SAME period — and ideally the same region or field — ` +
    `that aren't on this timeline yet. In a single apply_patch, add them as nodes placed on a PARALLEL lane (give ` +
    `each the same \`lane\` label, e.g. "Meanwhile…" or the region/field) so they read as a contemporaneous track ` +
    `beside ${input.title}. Anchor each to a real date with the right precision and ground it with a citation ` +
    `(title + url + a short verbatim quote). Keep it faithful to what actually happened.`
  )
}

// FILL GAP — populate an empty stretch of the axis (a "dead zone"). Drives
// apply_patch (add_node) scoped to a date range. Surfaced by the canvas gap ghosts
// (NEXT.5 Tier 2 — docs/product/prd/next5-tier2-alive-canvas.md).
export function buildFillGapPrompt(input: {
  timelineId: string
  fromDate: string
  toDate: string
  years: number
}): string {
  return (
    `Using the Synek MCP tools, fill the empty stretch on this timeline between ${input.fromDate} and ` +
    `${input.toDate} (about ${input.years} years with nothing on it).\n` +
    `- timelineId: ${input.timelineId}\n` +
    `- span: ${input.fromDate} → ${input.toDate}\n` +
    `First call query_timeline / get_layout_report to see what's already there and not duplicate it. Then, in a ` +
    `single apply_patch, add the significant people, events, organizations, and works from this span that belong ` +
    `on the timeline, and wire edges to what already sits on either side of the gap. Anchor every new node to a ` +
    `real date within ${input.fromDate}–${input.toDate} with the right precision, give it a face (a real, ` +
    `web-accessible image url) where you can, and ground it with a citation (title + url + a short verbatim quote). ` +
    `Keep it faithful to what actually happened.`
  )
}

// EXTEND LANE — add to a thin swimlane ("rival track"). Drives apply_patch
// (add_node with the shared `lane`). Surfaced by a canvas lane invitation.
export function buildExtendLanePrompt(input: { timelineId: string; lane: string }): string {
  return (
    `Using the Synek MCP tools, add to the "${input.lane}" track on this timeline — it's currently thin.\n` +
    `- timelineId: ${input.timelineId}\n` +
    `- lane: "${input.lane}"\n` +
    `First call query_timeline to see what's already on this track. Then, in a single apply_patch, add the people, ` +
    `events, organizations, or works that belong on the "${input.lane}" track but aren't there yet — setting each ` +
    `new node's \`lane\` to "${input.lane}" so they join the same parallel track. Anchor each to a real date with ` +
    `the right precision and ground it with a citation (title + url + a short verbatim quote). Keep it faithful.`
  )
}

// POPULATE ERA — fill out a bare period. Drives apply_patch (add_node within the
// era's span). Surfaced by a canvas era invitation.
export function buildPopulateEraPrompt(input: {
  timelineId: string
  era: string
  fromDate: string
  toDate: string
}): string {
  return (
    `Using the Synek MCP tools, populate the "${input.era}" era (${input.fromDate}–${input.toDate}) — it has ` +
    `little on it.\n` +
    `- timelineId: ${input.timelineId}\n` +
    `- era: "${input.era}"\n` +
    `- span: ${input.fromDate} → ${input.toDate}\n` +
    `First call query_timeline / get_layout_report to see what's already in this era. Then, in a single apply_patch, ` +
    `add the significant people, events, organizations, and works from ${input.fromDate}–${input.toDate} that ` +
    `belong in it, wiring edges where it makes sense. Anchor each to a real date within the era with the right ` +
    `precision, give it a face (a real image url) where you can, and ground it with a citation (title + url + a ` +
    `short verbatim quote). Keep it faithful to what actually happened.`
  )
}
