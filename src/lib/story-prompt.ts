// The app holds no AI, so it can't generate a story itself. Instead it hands the
// user a ready-made prompt to paste into their connected Claude, which writes the
// story back via the write_story MCP tool. Shared by the entity panel's per-moment
// ask-block and the AppBar's "New Story" dialog so both speak the same instructions.
//
// A story is written onto ONE moment (`momentId`), but its beats can spotlight a
// CAST of other entities via `focusNodeId` — so `featured` lets the user pick more
// entities to weave in as a guided tour (the canvas pans + the panel follows each
// beat's focus).
export function buildStoryPrompt(input: {
  nodeId: string
  timelineId: string
  title: string
  angle?: string | null
  featured?: { id: string; title: string }[]
}): string {
  const angle = input.angle?.trim()
  const featured = input.featured ?? []
  return (
    `Using the Synek MCP tools, write a short, source-grounded story onto this moment with write_story.\n` +
    `- momentId: ${input.nodeId}\n` +
    `- timelineId: ${input.timelineId}\n` +
    `- moment: "${input.title}"\n` +
    (angle ? `- angle: ${angle}\n` : '') +
    (featured.length
      ? `- also feature these entities (set a beat's focusNodeId to each so the canvas tours through them):\n` +
        featured.map((f) => `    - ${f.id} "${f.title}"\n`).join('')
      : '') +
    `Use 3–5 beats. Ground every factual beat with a real citation (title + url + a short verbatim quote). ` +
    `Keep it readable and faithful to what actually happened.` +
    (featured.length ? ` Give each featured entity at least one beat that focuses it.` : '')
  )
}
