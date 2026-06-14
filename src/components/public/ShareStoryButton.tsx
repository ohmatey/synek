import { useState } from 'react'
import { Share2 } from 'lucide-react'
import { toast } from 'sonner'
import { cn } from '~/lib/utils'
import { publishStoryShare } from '~/lib/server/stories'
import { capture } from '~/lib/posthog/client'

// Owner-only in-app Share: publishes the story's timeline (the same isPublic
// primitive as timeline sharing) so the /s/$slug page is world-readable, then
// hands the viewer the public link (native share sheet, else clipboard). Rendered
// in the docked reader header; never shown to non-owner viewers.
export function ShareStoryButton({
  storyId,
  className,
  label = 'Share this story publicly',
}: {
  storyId: string
  className?: string
  label?: string
}) {
  const [busy, setBusy] = useState(false)

  const onShare = async () => {
    if (busy) return
    setBusy(true)
    try {
      const res = await publishStoryShare({ data: storyId })
      if ('error' in res) {
        toast.error(res.error === 'forbidden' ? 'Only the owner can share this story.' : 'Could not share this story.')
        return
      }
      const url = `${window.location.origin}/s/${res.slug}`
      capture('story_shared', { story_id: storyId })
      try {
        if (navigator.share) {
          await navigator.share({ url, title: 'Read this story on Synek' })
        } else {
          await navigator.clipboard.writeText(url)
          toast.success('Public link copied — anyone can read it', { description: url })
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
      aria-label={label}
      data-testid="share-story"
    >
      <Share2 aria-hidden />
    </button>
  )
}
