import { useNavigate } from '@tanstack/react-router'
import { toast } from 'sonner'
import { publishStoryShare } from '~/lib/server/stories'
import { capture } from '~/lib/posthog/client'
import type { HomeStoryCard } from '~/lib/domain/types'

// Shared story actions for the home surfaces (featured panel, story card, intro
// dialog) so Play / Continue writing / Share / Open canvas behave identically
// everywhere. `play` deep-links into the in-app reader AND requests autoplay
// (?autoplay), so the reader skips its cover and starts stepping immediately —
// the intro dialog is now the cover, so a second cover would be redundant.
export function useStoryActions(story: HomeStoryCard, projectId: string | null, source: string) {
  const navigate = useNavigate()

  const play = () => {
    capture('home_story_play_clicked', {
      project_id: projectId ?? undefined,
      story_id: story.storyId,
      source,
    })
    void navigate({
      to: '/timelines/$id',
      params: { id: story.timelineId },
      search: { story: story.storyId, autoplay: true },
    })
  }

  const continueWriting = () => {
    void navigate({
      to: '/timelines/$id',
      params: { id: story.timelineId },
      search: { view: 'stories', story: story.storyId },
    })
  }

  const openCanvas = () => {
    void navigate({ to: '/timelines/$id', params: { id: story.timelineId } })
  }

  const share = async () => {
    capture('home_share_clicked', { project_id: projectId ?? undefined, story_id: story.storyId, source })
    try {
      const res = await publishStoryShare({ data: story.storyId })
      if ('error' in res) {
        toast.error('Could not share this story.')
        return
      }
      const url = `${window.location.origin}/s/${res.slug}`
      capture('story_shared', { story_id: story.storyId })
      if (navigator.share) {
        await navigator.share({ url, title: 'Read this story on Synek' }).catch(() => {})
      } else {
        await navigator.clipboard.writeText(url)
        toast.success('Public link copied — anyone can read it', { description: url })
      }
    } catch {
      toast.error('Could not share this story.')
    }
  }

  return { play, continueWriting, openCanvas, share }
}
