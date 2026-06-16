import { useState } from 'react'
import { Link2, Share2 } from 'lucide-react'
import { toast } from 'sonner'
import { cn } from '~/lib/utils'
import { publishStoryShare } from '~/lib/server/stories'
import { capture } from '~/lib/posthog/client'

// Owner-only in-app Share: makes THIS story public (per-story, independent of the
// timeline — it does NOT publish the whole timeline), then hands the viewer the
// public /s/$slug link (native share sheet, else clipboard). When the story is
// already shared it just (re)copies the link. Rendered in the docked reader header;
// never shown to non-owner viewers.
export function ShareStoryButton({
  storyId,
  className,
  shared = false,
  label,
}: {
  storyId: string
  className?: string
  // Whether the story is already public — flips the icon/label to a copy affordance.
  shared?: boolean
  label?: string
}) {
  const [busy, setBusy] = useState(false)
  const effLabel = label ?? (shared ? 'Copy this story’s public link' : 'Share this story publicly')

  const onShare = async () => {
    if (busy) return
    setBusy(true)
    try {
      // Idempotent: sets the story public (no-op if already) and returns the slug.
      const res = await publishStoryShare({ data: storyId })
      if ('error' in res) {
        toast.error('Only the owner can share this story.')
        return
      }
      const url = `${window.location.origin}/s/${res.slug}`
      if (!shared) capture('story_shared', { story_id: storyId })
      try {
        if (navigator.share) {
          await navigator.share({ url, title: 'Read this story on Synek' })
        } else {
          await navigator.clipboard.writeText(url)
          toast.success(shared ? 'Public link copied' : 'Story is public — link copied', { description: url })
        }
      } catch {
        // share sheet dismissed — link is live regardless
      }
    } catch {
      toast.error('Could not share this story.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <button
      type="button"
      className={cn(className ?? 'sv-ctrl')}
      onClick={onShare}
      disabled={busy}
      aria-label={effLabel}
      data-shared={shared ? '' : undefined}
      data-testid="share-story"
    >
      {shared ? <Link2 aria-hidden /> : <Share2 aria-hidden />}
    </button>
  )
}
