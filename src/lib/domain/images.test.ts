import { describe, expect, test } from 'bun:test'
import { imageUrlSchema, safeImage, safeImageUrl } from './images'

describe('safeImageUrl', () => {
  test('allows absolute http and https URLs', () => {
    expect(safeImageUrl('https://upload.wikimedia.org/a/b.jpg')).toBe('https://upload.wikimedia.org/a/b.jpg')
    expect(safeImageUrl('http://example.com/x.png')).toBe('http://example.com/x.png')
    expect(safeImageUrl('  HTTPS://Example.com/x.png  ')).toBe('HTTPS://Example.com/x.png')
  })

  test('allows data:image URIs (the node panel upload shape)', () => {
    expect(safeImageUrl('data:image/png;base64,iVBORw0KGgo=')).toBe('data:image/png;base64,iVBORw0KGgo=')
    expect(safeImageUrl('data:image/svg+xml;utf8,<svg/>')).toBe('data:image/svg+xml;utf8,<svg/>')
  })

  test('refuses executable and non-image schemes', () => {
    expect(safeImageUrl('javascript:alert(1)')).toBeNull()
    expect(safeImageUrl('JavaScript:alert(1)')).toBeNull()
    expect(safeImageUrl('data:text/html,<script>alert(1)</script>')).toBeNull()
    expect(safeImageUrl('data:application/javascript,alert(1)')).toBeNull()
    expect(safeImageUrl('file:///etc/passwd')).toBeNull()
    expect(safeImageUrl('blob:https://example.com/uuid')).toBeNull()
    expect(safeImageUrl('ftp://example.com/x.png')).toBeNull()
  })

  test('refuses relative, protocol-relative, empty, and whitespace-laden values', () => {
    expect(safeImageUrl('/uploads/x.png')).toBeNull()
    expect(safeImageUrl('//evil.example/x.png')).toBeNull()
    expect(safeImageUrl('x.png')).toBeNull()
    expect(safeImageUrl('')).toBeNull()
    expect(safeImageUrl('   ')).toBeNull()
    expect(safeImageUrl(undefined)).toBeNull()
    expect(safeImageUrl(null)).toBeNull()
    expect(safeImageUrl('https://example.com/a b.png')).toBeNull()
    expect(safeImageUrl('https://')).toBeNull()
  })
})

describe('safeImage', () => {
  test('passes an allowed image through by identity and nulls a refused one', () => {
    const ok = { url: 'https://example.com/a.jpg', alt: 'a' }
    expect(safeImage(ok)).toBe(ok)
    expect(safeImage({ url: 'javascript:alert(1)' })).toBeNull()
    expect(safeImage(null)).toBeNull()
    expect(safeImage(undefined)).toBeNull()
  })
})

describe('imageUrlSchema', () => {
  test('trims and accepts an allowed URL', () => {
    expect(imageUrlSchema.parse('  https://example.com/a.jpg ')).toBe('https://example.com/a.jpg')
  })

  test('rejects a refused URL with the shared message', () => {
    const r = imageUrlSchema.safeParse('javascript:alert(1)')
    expect(r.success).toBe(false)
    if (!r.success) expect(r.error.issues[0]?.message).toContain('http(s)')
  })

  test('composes with .optional() and .describe()', () => {
    const s = imageUrlSchema.describe('an image').optional()
    expect(s.safeParse(undefined).success).toBe(true)
    expect(s.safeParse('nope').success).toBe(false)
  })
})
