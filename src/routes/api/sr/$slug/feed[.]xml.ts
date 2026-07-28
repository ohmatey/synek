import { createFileRoute } from '@tanstack/react-router'
import { getSeriesRowBySlug, seriesFeedItems } from '~/lib/db/series'

// PUBLIC, no-auth RSS feed for a shared season (local-160): /api/sr/$slug/feed.xml.
// The account-less subscription channel — pull-based, so no email, no login. Gated on
// the SERIES being public (mirrors getPublicSeries); a private/missing series returns
// 404 indistinguishably. Ships only `published` chapters (seriesFeedItems), newest
// first, each linking to the season page (chapters don't have their own public page on
// this axis). Advertised from sr.$slug.tsx via <link rel="alternate">.

const base = (): string => (process.env.BETTER_AUTH_URL?.trim() || 'http://localhost:3001').replace(/\/$/, '')

const esc = (s: string): string =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&apos;')

const rfc822 = (ms: number): string => (ms > 0 ? new Date(ms).toUTCString() : new Date(0).toUTCString())

export const Route = createFileRoute('/api/sr/$slug/feed.xml')({
  server: {
    handlers: {
      GET: ({ params }) => {
        const series = getSeriesRowBySlug(params.slug)
        if (!series || !series.isPublic) return new Response('not found', { status: 404 })

        const seasonUrl = `${base()}/sr/${series.slug}`
        const feedUrl = `${base()}/api/sr/${series.slug}/feed.xml`
        const items = seriesFeedItems(series.id)
        const lastBuild = items[0]?.createdAt ?? series.updatedAt?.getTime() ?? 0

        const itemsXml = items
          .map((it) => {
            const label = it.chapterNumber != null ? `Chapter ${it.chapterNumber}: ${it.title}` : it.title
            // Per-item link anchors the season page; guid is the stable chapter slug.
            return `    <item>
      <title>${esc(label)}</title>
      <link>${esc(seasonUrl)}</link>
      <guid isPermaLink="false">${esc(it.slug)}</guid>
      <pubDate>${rfc822(it.createdAt)}</pubDate>${it.hook ? `\n      <description>${esc(it.hook)}</description>` : ''}
    </item>`
          })
          .join('\n')

        const xml = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom">
  <channel>
    <title>${esc(series.title)}</title>
    <link>${esc(seasonUrl)}</link>
    <atom:link href="${esc(feedUrl)}" rel="self" type="application/rss+xml" />
    <description>${esc(series.hook ?? `A serialized story on Synek.`)}</description>
    <lastBuildDate>${rfc822(lastBuild)}</lastBuildDate>
${itemsXml}
  </channel>
</rss>`

        return new Response(xml, {
          headers: { 'content-type': 'application/rss+xml; charset=utf-8', 'cache-control': 'public, max-age=300' },
        })
      },
    },
  },
})
