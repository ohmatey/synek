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

// Home "New story" — for a fresh, empty timeline (the new-creator empty state). The
// app holds no AI, so it hands the connected Claude a prompt that does BOTH halves in
// one sitting: build a small cited timeline, then write a story onto its most pivotal
// moment. So a brand-new user gets a populated canvas + a readable story from a single
// paste, rather than an empty timeline they then have to ask to fill.
export function buildNewStoryPrompt(input: {
  timelineId: string
  title: string
  topic?: string | null
}): string {
  const topic = input.topic?.trim()
  return (
    `Using the Synek MCP tools, build this timeline and write a story onto it.\n` +
    `- timelineId: ${input.timelineId}\n` +
    `- title: "${input.title}"\n` +
    (topic ? `- about: ${topic}\n` : '') +
    `1. FIRST add the key moments, people, organizations and periods as typed nodes with apply_patch — ` +
    `anchor each to a real date (use the right precision) and cite freely (title + url + a short verbatim quote). ` +
    `One batch = one undoable Patch.\n` +
    `2. THEN pick the most pivotal moment and call write_story on it: 3–5 beats, a cast of the key figures, and a ` +
    `per-beat focusNodeId/lens so the canvas tours through them as the reader reads. Ground every factual beat with ` +
    `a real citation. Keep it readable and faithful to what actually happened.`
  )
}

// Home "New series" — a fresh series with no chapters yet (the new-creator empty
// state, series mode). Asks the connected Claude to set the opening world in motion
// and write Chapter I, appending it to the series so the season auto-numbers from 1.
// Differs from buildNextChapterPrompt: that one reads an EXISTING watermark; this
// bootstraps an empty series and tells the client which timeline to populate.
export function buildNewSeriesPrompt(input: {
  seriesId: string
  timelineId: string
  title: string
  topic?: string | null
}): string {
  const topic = input.topic?.trim()
  return (
    `Using the Synek MCP tools, start the serialized series “${input.title}” — set the world in motion and write Chapter I.\n` +
    `- seriesId: ${input.seriesId}\n` +
    `- timelineId: ${input.timelineId}\n` +
    (topic ? `- about: ${topic}\n` : '') +
    `1. FIRST add the opening era's moments, people, organizations and periods as typed nodes on the timeline with ` +
    `apply_patch — anchor each to a real date (right precision) and cite freely (title + url + a short verbatim quote).\n` +
    `2. THEN write Chapter I with write_story using appendToSeries: "${input.seriesId}" (this links it as the first ` +
    `chapter and auto-numbers it). Anchor it on the pivotal opening moment (momentId). Use beats that move, a cast of ` +
    `the key figures, and per-beat focusNodeId/lens to choreograph the canvas. Ground every factual beat with a real ` +
    `citation.\n` +
    `Write later chapters from the series — each picks up past the frontier so the season never repeats itself.`
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

// The "write the next chapter" prompt — the morning-chapter loop's headline action,
// handed to the user's connected Claude (the app holds no AI). Unlike
// buildContinueStoryPrompt (which UPDATES one story in place), this APPENDS a new
// chapter to a SERIES. It is self-sufficient: it tells the client to read the series
// watermark itself (get_series), so the caller only needs the id, title, and count —
// no need to ship the frontier. Mirrors synek-plugin/skills/next-chapter/SKILL.md.
export function buildNextChapterPrompt(input: {
  seriesId: string
  seriesTitle: string
  chapterCount: number
}): string {
  const { seriesId, seriesTitle, chapterCount } = input
  const where =
    chapterCount === 0
      ? `This series has no chapters yet — write Chapter I and set the world in motion.`
      : `This series has ${chapterCount} ${chapterCount === 1 ? 'chapter' : 'chapters'} so far — write the next one.`
  return (
    `Using the Synek MCP tools, write the NEXT CHAPTER of the series “${seriesTitle}”.\n` +
    `- seriesId: ${seriesId}\n\n` +
    `${where}\n\n` +
    `1. FIRST call get_series("${seriesId}") to read the chapters in order and the derived frontier (the latest ` +
    `chapter number and the latest instant any covered node sits at). That is your anti-duplication watermark.\n` +
    `2. Decide ONE clear thing that happens next — the next era, the consequence of the last chapter, or a parallel ` +
    `thread now due. Advance PAST the frontier; never retell what an earlier chapter already covered.\n` +
    `3. Write it with write_story using appendToSeries: "${seriesId}" (this links it as the next chapter and ` +
    `auto-numbers it). Anchor it on a moment (momentId) — an existing timeline node, or one you add first.\n` +
    `4. Make it a real chapter: beats that move, every factual beat grounded in a real citation (title + url + a ` +
    `short verbatim quote), a cast of the key figures, per-beat focusNodeId/lens to choreograph the canvas, and the ` +
    `SAME voice and depth as the earlier chapters.\n\n` +
    `If the next chapter needs events or people not on the timeline yet, research them on the web first, then add ` +
    `them as ONE cited apply_patch batch BEFORE writing the chapter. If there is genuinely nothing new to tell yet, ` +
    `say so rather than invent — a fabricated chapter is worse than a thinner season.`
  )
}
