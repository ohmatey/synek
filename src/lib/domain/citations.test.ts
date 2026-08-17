import { describe, expect, it } from 'bun:test'
import { citationHref, displayUrl } from './citations'

describe('citationHref', () => {
  it('returns an http(s) url so the card can link it', () => {
    expect(citationHref('https://plato.stanford.edu/entries/stoicism/')).toBe(
      'https://plato.stanford.edu/entries/stoicism/',
    )
    expect(citationHref('  http://example.com  ')).toBe('http://example.com')
  })

  it('refuses anything not navigable, so a print source renders without a dead link', () => {
    expect(citationHref(undefined)).toBeNull()
    expect(citationHref('')).toBeNull()
    expect(citationHref('   ')).toBeNull()
    expect(citationHref('Diogenes Laërtius, Lives VII')).toBeNull()
  })

  it('refuses non-http schemes rather than rendering them as an openable link', () => {
    expect(citationHref('javascript:alert(1)')).toBeNull()
    expect(citationHref('data:text/html,<script>')).toBeNull()
    expect(citationHref('file:///etc/passwd')).toBeNull()
  })
})

describe('displayUrl', () => {
  it('shows host + path without the scheme', () => {
    expect(displayUrl('https://en.wikipedia.org/wiki/Chrysippus')).toBe('en.wikipedia.org/wiki/Chrysippus')
  })

  it('drops a bare trailing slash', () => {
    expect(displayUrl('https://example.com/')).toBe('example.com')
  })

  it('elides a query string rather than printing a tracking tail', () => {
    expect(displayUrl('https://example.com/a?utm_source=x&utm_campaign=y')).toBe('example.com/a?…')
  })

  it('returns null for nothing, so the host line is omitted rather than blank', () => {
    expect(displayUrl(undefined)).toBeNull()
    expect(displayUrl('  ')).toBeNull()
  })

  it('degrades gracefully for a non-url string', () => {
    expect(displayUrl('Lives of the Eminent Philosophers')).toBe('Lives of the Eminent Philosophers')
  })
})
