// The app holds no AI, so it can't populate a timeline itself. When a user creates
// a timeline we hand them a ready-made prompt to paste into their connected Claude,
// which builds it out via the apply_patch MCP tool. Mirrors story-prompt.ts so the
// "new timeline" dialog and any future surfaces speak the same instructions.
export function buildTimelinePrompt(input: {
  timelineId: string
  title: string
  topic?: string | null
}): string {
  const topic = input.topic?.trim()
  return (
    `Using the Synek MCP tools, build out this timeline with apply_patch.\n` +
    `- timelineId: ${input.timelineId}\n` +
    `- title: "${input.title}"\n` +
    (topic ? `- focus: ${topic}\n` : '') +
    `Add the key events, people, organizations and periods as typed nodes along the ` +
    `timeline, and wire the relationships between them with edges — all in one apply_patch ` +
    `call so it commits as a single undoable Patch. Anchor every node to a real date ` +
    `(use the right precision — year/quarter/month/day) and cite freely: ground each node ` +
    `with a real source (title + url + a short verbatim quote). Keep it faithful to what ` +
    `actually happened.`
  )
}

// "Improve this timeline" — a prompt that asks the connected Claude to review the
// current graph and fill it out, rather than build from scratch. Grounded in the
// read tools (get_layout_report / query_timeline) so the model looks before it
// edits, then commits changes via apply_patch.
export function buildImproveTimelinePrompt(input: { timelineId: string; title: string }): string {
  return (
    `Using the Synek MCP tools, review and improve this timeline.\n` +
    `- timelineId: ${input.timelineId}\n` +
    `- title: "${input.title}"\n` +
    `First call get_layout_report and query_timeline to see the current shape. Then improve it with apply_patch: ` +
    `fill gaps in under-covered eras, add missing key moments/people/organizations and the edges between them, ` +
    `merge or re-lane duplicate/mis-placed nodes, and add citations or images where they're missing. Group related ` +
    `changes into a single apply_patch call so each commits as one undoable Patch. Anchor every node to a real date ` +
    `with the right precision and keep everything faithful to what actually happened.`
  )
}
