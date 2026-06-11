// The app holds no AI, so "Talk to" can't voice the entity itself — it hands the
// user a ready-made prompt to paste into their connected Claude, which writes a
// first-person, source-grounded story FROM that entity's point of view via the
// write_story MCP tool. Sibling of story-prompt.ts / timeline-prompt.ts; this is
// the lightweight front door to multi-POV (roadmap S3.4).
export function buildTalkToPrompt(input: {
  timelineId: string
  nodeId: string
  name: string
  // person | org | place | work | entity — shapes the pronoun/voice.
  kind: string
}): string {
  const asPerson = input.kind === 'person'
  const possessive = asPerson ? 'their' : `this ${input.kind}'s`
  return (
    `Using the Synek MCP tools, speak AS ${input.name} — write a first-person, source-grounded story from ` +
    `${possessive} point of view with write_story.\n` +
    `- timelineId: ${input.timelineId}\n` +
    `- speaker: "${input.name}" (${input.kind})\n` +
    `- speakerNodeId: ${input.nodeId}\n` +
    `First, with query_timeline / get_node, find the moment on this timeline where ${input.name}'s perspective is ` +
    `richest — an event they were part of, or the node most connected to them — and write the story onto that ` +
    `moment (momentId). Narrate in the FIRST PERSON as ${input.name}, constrained to only what they could plausibly ` +
    `have known, seen, or felt — never invent facts they couldn't know. Use 3–5 beats, ground every factual beat ` +
    `with a real citation (title + url + a short verbatim quote), and set each beat's focusNodeId so the canvas ` +
    `walks through what they're describing.`
  )
}
