import type { StoryDTO } from '~/lib/domain/types'

// The story reader — playback on the canvas. Lives in the same right-docked slot
// as NodeDetailPanel (mutually exclusive). One beat at a time; Back/Next steps it
// while the canvas (left) stays framed + lensed on the moment.
export function StoryReaderPanel({
  momentTitle,
  story,
  beat,
  busy,
  error,
  nodeTitles,
  onBeat,
  onRegenerate,
  onFocusRelated,
  onClose,
}: {
  momentTitle: string
  story: StoryDTO | null
  beat: number
  busy: false | 'loading' | 'regenerating'
  error: string | null
  nodeTitles: Record<string, string>
  onBeat: (i: number) => void
  onRegenerate: () => void
  onFocusRelated: (id: string) => void
  onClose: () => void
}) {
  const total = story?.segments.length ?? 0
  const idx = Math.min(beat, Math.max(0, total - 1))
  const seg = story?.segments[idx]

  return (
    <div className="detail-panel story-panel" role="dialog" aria-label="Story reader">
      <header className="detail-head story-head">
        <div className="story-head-meta">
          {story && (
            <span
              className={`story-depth story-depth-${story.depthTier}`}
              title={story.depthTier === 'deep' ? 'deep — handcrafted' : 'light — generated'}
            >
              {story.depthTier === 'deep' ? '✦' : '⚡'} {story.depthTier}
            </span>
          )}
          <span className="story-moment" title={momentTitle}>
            {momentTitle}
          </span>
        </div>
        <div className="story-head-actions">
          {story && (
            <button
              type="button"
              className="story-regen"
              onClick={onRegenerate}
              disabled={!!busy}
              title="Generate a fresh telling (archives this one)"
            >
              {busy === 'regenerating' ? 'Composing…' : '↻ Regenerate'}
            </button>
          )}
          <button type="button" className="detail-close" onClick={onClose} title="Close" aria-label="Close">
            ✕
          </button>
        </div>
      </header>

      {busy === 'loading' && !story ? (
        <div className="story-loading">
          <div className="story-spinner" aria-hidden />
          <p>Composing the story…</p>
        </div>
      ) : error ? (
        <div className="story-error">
          <p className="story-error-msg">{error}</p>
          <button type="button" className="story-retry" onClick={onRegenerate}>
            Try again
          </button>
        </div>
      ) : story && seg ? (
        <>
          <h2 className="story-title">{story.title}</h2>
          {story.hook && <p className="story-hook">{story.hook}</p>}

          <div className={`story-seg story-seg-${seg.kind}`} key={seg.id}>
            <span className="story-seg-kind">{seg.kind}</span>
            <p className="story-seg-body">{seg.bodyText}</p>
            {seg.settingNote && <p className="story-seg-setting">{seg.settingNote}</p>}
            {seg.relatedNodeIds.length > 0 && (
              <div className="story-related">
                <span className="story-related-label">On the map</span>
                {seg.relatedNodeIds.map((id) => (
                  <button
                    type="button"
                    key={id}
                    className="story-related-link"
                    onClick={() => onFocusRelated(id)}
                    title="Center on the timeline"
                  >
                    {nodeTitles[id] ?? 'related moment'}
                  </button>
                ))}
              </div>
            )}
          </div>

          <footer className="story-nav">
            <button type="button" className="story-nav-btn" onClick={() => onBeat(idx - 1)} disabled={idx <= 0}>
              ← Back
            </button>
            <span className="story-beat-count">
              Beat {idx + 1} of {total}
            </span>
            <button type="button" className="story-nav-btn" onClick={() => onBeat(idx + 1)} disabled={idx >= total - 1}>
              Next →
            </button>
          </footer>
        </>
      ) : null}
    </div>
  )
}
