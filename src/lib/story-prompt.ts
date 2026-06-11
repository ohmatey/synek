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

// The reader's end panel hands the user a prompt to EXTEND the story they just
// finished. write_story replaces a story's beats when passed an existing storyId,
// so the prompt embeds the beats so far verbatim and asks Claude to re-supply them
// then append new ones — keeping the same story (not spawning a fresh one).
export function buildContinueStoryPrompt(input: {
  storyId: string
  momentId: string
  timelineId: string
  title: string
  beats: { bodyText: string }[]
}): string {
  const soFar = input.beats.map((b, i) => `  ${i + 1}. ${b.bodyText.trim()}`).join('\n')
  return (
    `Using the Synek MCP tools, CONTINUE this story — pick up where it left off and extend it with more beats.\n` +
    `- timelineId: ${input.timelineId}\n` +
    `- momentId: ${input.momentId}\n` +
    `- storyId: ${input.storyId}\n` +
    `- story: "${input.title}"\n\n` +
    `Pass this storyId to write_story to UPDATE the story in place: re-supply ALL the existing beats below verbatim, ` +
    `then APPEND your new ones after them.\n\n` +
    `The story so far:\n${soFar}\n\n` +
    `Add 2–4 new beats that move the narrative forward in the same voice and point of view. Ground every factual ` +
    `beat with a real citation (title + url + a short verbatim quote). You can set a beat's focusNodeId to another ` +
    `entity on this timeline so the canvas tours through it as the reader reaches that beat.`
  )
}
