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
