// A deliberately SMALL markdown subset for story beats.
//
// Beats were plain text: one `<p>{bodyText}</p>` in each reader, so a beat could
// not carry a heading, a list, or an emphasised phrase, and the two readers even
// disagreed about newlines (the in-app one had `white-space: pre-wrap`, the public
// one did not, so identical text rendered as paragraphs in-app and one run-on
// block publicly).
//
// This parses to a small block/inline AST that the renderer turns into React
// ELEMENTS. Nothing here produces HTML strings and nothing calls
// dangerouslySetInnerHTML, so beat text written by an MCP client cannot inject
// markup — which matters because that text is authored outside the app and is
// republished on the public /s/$slug page.
//
// Supported, and no more: `##`/`###` headings, blank-line paragraphs, `-` bullets,
// `>` quotes, `**bold**`, `*italic*`/`_italic_`, `` `code` ``, and [links](url).
// Anything else stays literal text rather than silently disappearing.

export type Inline =
  | { t: 'text'; v: string }
  | { t: 'strong'; v: string }
  | { t: 'em'; v: string }
  | { t: 'code'; v: string }
  | { t: 'link'; v: string; href: string }

export type Block =
  | { k: 'heading'; level: 2 | 3; spans: Inline[] }
  | { k: 'para'; spans: Inline[] }
  | { k: 'quote'; spans: Inline[] }
  | { k: 'list'; items: Inline[][] }

// Links are restricted to http(s) for the same reason citations are: beat text is
// author-supplied, and `javascript:`/`data:` hrefs must never become clickable.
const SAFE_HREF = /^https?:\/\//i

// Order matters: `**` must be tried before `*`.
const INLINE_RE = /(\*\*[^*]+\*\*)|(\*[^*\n]+\*)|(_[^_\n]+_)|(`[^`\n]+`)|(\[[^\]\n]+\]\([^)\s]+\))/g

export function parseInline(src: string): Inline[] {
  const out: Inline[] = []
  let last = 0
  for (const m of src.matchAll(INLINE_RE)) {
    const i = m.index
    if (i > last) out.push({ t: 'text', v: src.slice(last, i) })
    const tok = m[0]
    if (tok.startsWith('**')) out.push({ t: 'strong', v: tok.slice(2, -2) })
    else if (tok.startsWith('`')) out.push({ t: 'code', v: tok.slice(1, -1) })
    else if (tok.startsWith('[')) {
      const split = tok.indexOf('](')
      const text = tok.slice(1, split)
      const href = tok.slice(split + 2, -1)
      // An unsafe or relative href degrades to plain text, never a dead/dangerous link.
      if (SAFE_HREF.test(href)) out.push({ t: 'link', v: text, href })
      else out.push({ t: 'text', v: text })
    } else out.push({ t: 'em', v: tok.slice(1, -1) })
    last = i + tok.length
  }
  if (last < src.length) out.push({ t: 'text', v: src.slice(last) })
  return out.length > 0 ? out : [{ t: 'text', v: '' }]
}

export function parseMarkdown(src: string): Block[] {
  const blocks: Block[] = []
  // Split on blank lines; within a chunk, single newlines join into one flow
  // except for lists, where each `-` starts an item.
  const chunks = (src ?? '').replace(/\r\n/g, '\n').split(/\n\s*\n/)

  for (const raw of chunks) {
    const chunk = raw.trim()
    if (!chunk) continue
    const lines = chunk.split('\n').map((l) => l.trim())

    if (lines.every((l) => l.startsWith('- ') || l.startsWith('* '))) {
      blocks.push({ k: 'list', items: lines.map((l) => parseInline(l.slice(2).trim())) })
      continue
    }
    if (lines.every((l) => l.startsWith('>'))) {
      blocks.push({ k: 'quote', spans: parseInline(lines.map((l) => l.replace(/^>\s?/, '')).join(' ')) })
      continue
    }
    const h = /^(#{2,3})\s+(.*)$/.exec(lines[0])
    if (h) {
      blocks.push({ k: 'heading', level: h[1].length as 2 | 3, spans: parseInline(h[2].trim()) })
      // A heading consumes only its own line; the rest of the chunk is a paragraph.
      const rest = lines.slice(1).join(' ').trim()
      if (rest) blocks.push({ k: 'para', spans: parseInline(rest) })
      continue
    }
    blocks.push({ k: 'para', spans: parseInline(lines.join(' ')) })
  }
  return blocks
}

// True when the source uses any block structure beyond a single paragraph. Lets a
// caller keep the old single-<p> treatment for the (very common) plain beat.
export function isRichMarkdown(src: string): boolean {
  const b = parseMarkdown(src)
  return b.length > 1 || (b[0] != null && b[0].k !== 'para')
}
