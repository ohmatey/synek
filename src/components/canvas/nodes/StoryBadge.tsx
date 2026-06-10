import { BookOpen } from 'lucide-react'
import type { CanvasNodeData } from '../types'

// Depth badge (N.5.3): a small marker on moments that carry a story, drawing the
// eye toward nodes worth opening. Deep stories read a touch bolder than light
// ones. Mirrors the sf-cite badge pattern; rendered inside each node type.
export function StoryBadge({ data }: { data: CanvasNodeData }) {
  if (!data.hasStory) return null
  const deep = data.storyDepth === 'deep'
  return (
    <span
      className={`sf-story-badge${deep ? ' sf-story-badge-deep' : ''}`}
      title={deep ? 'Has a deep story — open to read' : 'Has a story — open to read'}
    >
      <BookOpen aria-hidden />
    </span>
  )
}
