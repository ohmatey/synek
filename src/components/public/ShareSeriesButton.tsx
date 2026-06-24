import { useState } from 'react'
import { Link2, Share2 } from 'lucide-react'
import { toast } from 'sonner'
import { cn } from '~/lib/utils'
import { publishSeriesShare } from '~/lib/server/series'
import { capture } from '~/lib/posthog/client'

// Owner-only in-app Share for a SERIES (ADR 0006 D10): makes the whole season
// public, then hands the viewer the public /sr/$slug link (native share sheet, else
// clipboard). When already shared it just (re)copies the link. Mirrors
// ShareStoryButton; never shown to non-owner viewers.
export function ShareSeriesButton({
  seriesId,
  className,
  shared = false,
  label,
  variant = 'icon',
}: {
  seriesId: string
  className?: string
  // Whether the series is already public — flips the icon/label to a copy affordance.
  shared?: boolean
  label?: string
  // `icon` = the compact toolbar control. `prominent` = a text+icon button that reads
  // "Publish to share" — the headline next step on a DRAFT card (design review,
  // Principle 5: build for the creator-publisher). Amber story accent as a carrier.
  variant?: 'icon' | 'prominent'
}) {
  const [busy, setBusy] = useState(false)
  const effLabel = label ?? (shared ? 'Copy this series’ public link' : 'Share this series publicly')

  const onShare = async () => {
    if (busy) return
    setBusy(true)
    try {
      const res = await publishSeriesShare({ data: { seriesId, isPublic: true } })
      if ('error' in res) {
        toast.error('Only the owner can share this series.')
        return
      }
      const url = `${window.location.origin}/sr/${res.slug}`
      if (!shared) capture('series_shared', { series_id: seriesId })
      try {
        if (navigator.share) {
          await navigator.share({ url, title: 'Read this series on Synek' })
        } else {
          await navigator.clipboard.writeText(url)
          toast.success(shared ? 'Public link copied' : 'Series is public — link copied', { description: url })
        }
      } catch {
        // share sheet dismissed — link is live regardless
      }
    } catch {
      toast.error('Could not share this series.')
    } finally {
      setBusy(false)
    }
  }

  if (variant === 'prominent') {
    return (
      <button
        type="button"
        className={cn(className ?? 'ch-card-publish')}
        onClick={onShare}
        disabled={busy}
        aria-label={effLabel}
        data-shared={shared ? '' : undefined}
        data-testid="share-series"
      >
        {shared ? <Link2 aria-hidden /> : <Share2 aria-hidden />}
        {shared ? 'Public link' : 'Publish to share'}
      </button>
    )
  }

  return (
    <button
      type="button"
      className={cn(className ?? 'sv-ctrl')}
      onClick={onShare}
      disabled={busy}
      aria-label={effLabel}
      data-shared={shared ? '' : undefined}
      data-testid="share-series"
    >
      {shared ? <Link2 aria-hidden /> : <Share2 aria-hidden />}
    </button>
  )
}
