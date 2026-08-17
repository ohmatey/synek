import { describe, expect, it } from 'bun:test'
import { parseInline, parseMarkdown } from './markdown'

describe('parseMarkdown blocks', () => {
  it('keeps a plain beat as one paragraph', () => {
    const b = parseMarkdown('On 28 July the spec went final.')
    expect(b).toHaveLength(1)
    expect(b[0].k).toBe('para')
  })

  it('splits blank-line separated paragraphs, which the public reader used to collapse', () => {
    const b = parseMarkdown('First para.\n\nSecond para.')
    expect(b.map((x) => x.k)).toEqual(['para', 'para'])
  })

  it('joins single newlines within a paragraph', () => {
    const b = parseMarkdown('one\ntwo')
    expect(b).toHaveLength(1)
    expect(b[0]).toMatchObject({ k: 'para', spans: [{ t: 'text', v: 'one two' }] })
  })

  it('supports the multiple headings a beat needs', () => {
    const b = parseMarkdown('## Adopt\n\ntext\n\n### Watch\n\nmore')
    expect(b.map((x) => x.k)).toEqual(['heading', 'para', 'heading', 'para'])
    expect(b[0]).toMatchObject({ level: 2 })
    expect(b[2]).toMatchObject({ level: 3 })
  })

  it('reads a heading with body in the same chunk', () => {
    const b = parseMarkdown('## Title\nbody text')
    expect(b.map((x) => x.k)).toEqual(['heading', 'para'])
  })

  it('parses bullet lists and blockquotes', () => {
    expect(parseMarkdown('- one\n- two')).toEqual([
      { k: 'list', items: [[{ t: 'text', v: 'one' }], [{ t: 'text', v: 'two' }]] },
    ])
    expect(parseMarkdown('> quoted line')[0]).toMatchObject({ k: 'quote' })
  })

  it('ignores h1 and h4+ rather than mangling them', () => {
    expect(parseMarkdown('# Big')[0].k).toBe('para')
    expect(parseMarkdown('#### Small')[0].k).toBe('para')
  })

  it('survives empty input', () => {
    expect(parseMarkdown('')).toEqual([])
    expect(parseMarkdown('   \n\n  ')).toEqual([])
  })
})

describe('parseInline', () => {
  it('parses bold, italic and code', () => {
    expect(parseInline('a **b** c')).toEqual([
      { t: 'text', v: 'a ' },
      { t: 'strong', v: 'b' },
      { t: 'text', v: ' c' },
    ])
    expect(parseInline('_x_')).toEqual([{ t: 'em', v: 'x' }])
    expect(parseInline('`k`')).toEqual([{ t: 'code', v: 'k' }])
  })

  it('prefers ** over * so bold is not read as two italics', () => {
    expect(parseInline('**bold**')).toEqual([{ t: 'strong', v: 'bold' }])
  })

  it('parses an http link', () => {
    expect(parseInline('see [docs](https://example.com/a)')).toEqual([
      { t: 'text', v: 'see ' },
      { t: 'link', v: 'docs', href: 'https://example.com/a' },
    ])
  })

  // The invariant that matters is "no link element is produced", not the exact
  // leftover text: an href with nested parens (javascript:alert(1)) stops the
  // match early and leaves a stray ")" as literal text, which is harmless.
  it('never produces a link for an unsafe or relative href', () => {
    for (const src of ['[x](javascript:alert(1))', '[x](data:text/html,y)', '[x](/relative)', '[x](file:///etc)']) {
      const spans = parseInline(src)
      expect(spans.some((s) => s.t === 'link')).toBe(false)
      expect(spans.map((s) => s.v).join('')).toContain('x')
    }
  })

  it('still links a plain http href', () => {
    expect(parseInline('[x](https://example.com)').some((s) => s.t === 'link')).toBe(true)
  })

  it('leaves unmatched punctuation literal instead of eating it', () => {
    expect(parseInline('2 * 3 = 6')).toEqual([{ t: 'text', v: '2 * 3 = 6' }])
  })
})
