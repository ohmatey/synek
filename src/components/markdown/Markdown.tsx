import { Fragment } from 'react'
import { cn } from '~/lib/utils'
import { parseMarkdown, type Inline } from '~/lib/domain/markdown'

// Renders the story-beat markdown subset as React ELEMENTS.
//
// No dangerouslySetInnerHTML anywhere: beat text is authored by an MCP client
// outside the app and is republished on the public /s/$slug page, so it must never
// be able to inject markup. Unsafe link hrefs are already dropped in the parser.
//
// Used by both readers so the in-app and public pages finally agree — they
// previously disagreed even about newlines (`white-space: pre-wrap` in-app only).

function Spans({ spans }: { spans: Inline[] }) {
  return (
    <>
      {spans.map((s, i) => {
        switch (s.t) {
          case 'strong':
            return <strong key={i}>{s.v}</strong>
          case 'em':
            return <em key={i}>{s.v}</em>
          case 'code':
            return <code key={i}>{s.v}</code>
          case 'link':
            return (
              <a key={i} href={s.href} target="_blank" rel="noreferrer noopener">
                {s.v}
              </a>
            )
          default:
            return <Fragment key={i}>{s.v}</Fragment>
        }
      })}
    </>
  )
}

export function Markdown({ source, className }: { source: string; className?: string }) {
  const blocks = parseMarkdown(source)
  if (blocks.length === 0) return null
  return (
    <div className={cn('md', className)}>
      {blocks.map((b, i) => {
        switch (b.k) {
          case 'heading':
            return b.level === 2 ? (
              <h2 key={i} className="md-h2">
                <Spans spans={b.spans} />
              </h2>
            ) : (
              <h3 key={i} className="md-h3">
                <Spans spans={b.spans} />
              </h3>
            )
          case 'quote':
            return (
              <blockquote key={i} className="md-quote">
                <Spans spans={b.spans} />
              </blockquote>
            )
          case 'list':
            return (
              <ul key={i} className="md-list">
                {b.items.map((item, j) => (
                  <li key={j}>
                    <Spans spans={item} />
                  </li>
                ))}
              </ul>
            )
          default:
            return (
              <p key={i}>
                <Spans spans={b.spans} />
              </p>
            )
        }
      })}
    </div>
  )
}
