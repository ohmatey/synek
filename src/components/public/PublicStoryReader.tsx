import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  ChevronLeft,
  ChevronRight,
  Play,
  RotateCcw,
  Share2,
  Sparkles,
  Timer,
  TimerOff,
  Volume2,
  VolumeX,
} from 'lucide-react'
import { cn } from '~/lib/utils'
import type { GraphNode, PublicStoryDTO, StoryBeat } from '~/lib/domain/types'
import { POV_LABEL } from '~/lib/domain/story-labels'
import { formatInstant } from '~/lib/domain/dates'
import { timeAgo } from '~/lib/time-ago'
import { getPublicStory } from '~/lib/server/stories'
import { capture } from '~/lib/posthog/client'
import { sharedStorySignupHref } from '~/lib/posthog/attribution'
import { useSpeechSupported, useStoryNarration, warmUpSpeech } from '~/components/canvas/useStoryNarration'
import { BeatWidget } from './widgets/BeatWidget'

// The PUBLIC, mobile-first reels reader for a shared story (/s/$slug). Same
// stepped Reels/Stories model as the in-app docked reader, but full-screen and
// standalone — it renders each beat's LIVE widget (timeline / globe / entity) as
// the hero visual, carries an "updated X ago" stamp that polls for live changes,
// and ends on a "make your own" CTA that closes the growth loop. SSR-renders the
// cover so link unfurls + crawlers see real content; widgets hydrate on the client.

const WORDS_PER_MINUTE = 200
const MIN_BEAT_MS = 3500
const MAX_BEAT_MS = 12_000
const HOLD_THRESHOLD_MS = 220
// How often the live page re-checks for an updated story (competitor moves, new beats).
const POLL_MS = 45_000

function beatDurationMs(text: string): number {
  const words = text.trim().split(/\s+/).filter(Boolean).length
  const ms = 1500 + (words / WORDS_PER_MINUTE) * 60_000
  return Math.min(MAX_BEAT_MS, Math.max(MIN_BEAT_MS, ms))
}

export function PublicStoryReader({
  data,
  onNext,
  hasNext,
  chapterMeta,
  ctaLabel,
  nextChapterTitle,
  startSignal,
  hideCoverCta,
}: {
  data: PublicStoryDTO
  // Series continuation (ADR 0006 slice 4): when driven from a /sr/$slug season,
  // the end panel offers "Next chapter →" instead of only the make-your-own CTA.
  onNext?: () => void
  hasNext?: boolean
  // "Evolving book" chapter framing (local-162). When present, the cover renders as
  // a CHAPTER OPENER: an "Chapter N · {series}" eyebrow, book-language CTA, and the
  // production "beats" chip is dropped. The end panel names the next chapter.
  chapterMeta?: { number: number | null; seriesTitle: string }
  ctaLabel?: string
  nextChapterTitle?: string
  // Season page (/sr/$slug): the parent owns the single "Begin reading" CTA and the
  // chapter rail. Bumping `startSignal` begins playback of this chapter from the top
  // (the imperative entry point); `hideCoverCta` drops the reader's own cover play
  // button so the jacket/spine are the sole start controls — no competing CTA.
  startSignal?: number
  hideCoverCta?: boolean
}) {
  const inSeries = !!chapterMeta
  const { story, timelineTitle, updatedAt } = data
  const beats = story.beats
  const count = beats.length
  const nodeById = useMemo(() => new Map(data.nodes.map((n) => [n.id, n])), [data.nodes])

  const rootRef = useRef<HTMLElement>(null)
  const [index, setIndex] = useState(0)
  const [started, setStarted] = useState(false)
  const [ended, setEnded] = useState(false)
  const [paused, setPaused] = useState(false)
  const [speak, setSpeak] = useState(false)
  const [autoPlay, setAutoPlay] = useState(true)
  const [reduced, setReduced] = useState(false)

  const safeIndex = Math.min(index, Math.max(0, count - 1))
  const beat = beats[safeIndex]
  const playing = started && !ended

  // M.1 co-ship + M.4 demand side: one impression per public reader mount. Client
  // -only (the page is SSR'd) and carries the referrer as the share-attribution seam.
  useEffect(() => {
    capture('public_story_opened', {
      story_id: story.id,
      slug: story.slug,
      referrer: document.referrer || undefined,
    })
    // Mount-once: a fresh reader instance is a fresh open.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Reduced-motion → fully manual (no timed advance, static segments).
  useEffect(() => {
    if (typeof window === 'undefined' || !window.matchMedia) return
    const mq = window.matchMedia('(prefers-reduced-motion: reduce)')
    const update = () => setReduced(mq.matches)
    update()
    mq.addEventListener('change', update)
    return () => mq.removeEventListener('change', update)
  }, [])

  // Keep keyboard nav + Esc-less flow working without a click first. preventScroll
  // so focusing the reader doesn't yank the page past the season jacket/spine on a
  // /sr/$slug load (the reader sits below them in the document).
  useEffect(() => {
    rootRef.current?.focus({ preventScroll: true })
  }, [started])

  const goNext = useCallback(() => {
    if (safeIndex >= count - 1) setEnded(true)
    else setIndex((i) => i + 1)
  }, [safeIndex, count])
  const goPrev = useCallback(() => setIndex((i) => Math.max(0, i - 1)), [])

  const begin = useCallback(() => {
    if (speak) warmUpSpeech()
    setStarted(true)
  }, [speak])

  // Imperative start from the season page: a bumped `startSignal` (jacket "Begin
  // reading" or a spine row tap) plays this chapter from the top. The reader is
  // re-keyed per chapter, so a fresh mount carrying a non-zero signal autostarts the
  // newly selected chapter too. Guarded on >0 so the initial mount stays on the cover.
  useEffect(() => {
    if (!startSignal) return
    if (speak) warmUpSpeech()
    setIndex(0)
    setEnded(false)
    setStarted(true)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [startSignal])

  const replay = useCallback(() => {
    if (speak) warmUpSpeech()
    setIndex(0)
    setEnded(false)
  }, [speak])

  // Press-and-hold = pause; quick tap = navigate by zone.
  const holdRef = useRef<{ held: boolean; timer: ReturnType<typeof setTimeout> } | null>(null)
  const startHold = useCallback(() => {
    setPaused(true)
    const state = { held: false, timer: setTimeout(() => (state.held = true), HOLD_THRESHOLD_MS) }
    holdRef.current = state
  }, [])
  const endHold = useCallback(
    (dir: 'next' | 'prev') => {
      const state = holdRef.current
      holdRef.current = null
      setPaused(false)
      if (!state) return
      clearTimeout(state.timer)
      if (!state.held) (dir === 'next' ? goNext : goPrev)()
    },
    [goNext, goPrev],
  )
  const cancelHold = useCallback(() => {
    const state = holdRef.current
    holdRef.current = null
    if (state) clearTimeout(state.timer)
    setPaused(false)
  }, [])

  const onKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (!started) {
        if (e.key === 'ArrowRight' || e.key === ' ' || e.key === 'Enter') {
          e.preventDefault()
          begin()
        }
        return
      }
      if (ended) {
        if (e.key === 'ArrowLeft') {
          e.preventDefault()
          setEnded(false)
        }
        return
      }
      if (e.key === 'ArrowRight' || e.key === ' ') {
        e.preventDefault()
        goNext()
      } else if (e.key === 'ArrowLeft') {
        e.preventDefault()
        goPrev()
      }
    },
    [started, ended, begin, goNext, goPrev],
  )

  const durationMs = beat ? beatDurationMs(beat.bodyText) : MIN_BEAT_MS
  const autoAdvance = autoPlay && !reduced
  const speechSupported = useSpeechSupported()
  const speechDrivesAdvance = autoAdvance && speak && speechSupported
  const timerDrivesAdvance = autoAdvance && !speechDrivesAdvance
  const narrationAdvance = useCallback(() => {
    if (autoPlay) goNext()
  }, [autoPlay, goNext])
  useStoryNarration({
    beat,
    started: playing,
    speak,
    paused,
    reduced,
    supported: speechSupported,
    onAdvance: narrationAdvance,
  })

  // --- live updates: poll for a newer version, surface a refresh pill ---------
  const [hasUpdate, setHasUpdate] = useState(false)
  useEffect(() => {
    if (typeof window === 'undefined') return
    let alive = true
    const id = setInterval(async () => {
      try {
        const fresh = await getPublicStory({ data: story.slug })
        if (alive && fresh && fresh.updatedAt > updatedAt) setHasUpdate(true)
      } catch {
        // network hiccup — try again next tick
      }
    }, POLL_MS)
    return () => {
      alive = false
      clearInterval(id)
    }
  }, [story.slug, updatedAt])

  // "updated X ago": deterministic absolute date for SSR + first paint, relative
  // after mount (avoids a hydration mismatch on the clock).
  const [rel, setRel] = useState<string | null>(null)
  useEffect(() => {
    setRel(timeAgo(updatedAt))
    const id = setInterval(() => setRel(timeAgo(updatedAt)), 60_000)
    return () => clearInterval(id)
  }, [updatedAt])
  const updatedLabel = rel ?? formatInstant(updatedAt, 'day')

  const share = useCallback(async () => {
    if (typeof window === 'undefined') return
    const url = window.location.href
    try {
      if (navigator.share) {
        await navigator.share({ title: story.title, text: story.hook ?? story.title, url })
      } else {
        await navigator.clipboard.writeText(url)
      }
    } catch {
      // user dismissed the share sheet — no-op
    }
  }, [story.title, story.hook])

  return (
    <main
      ref={rootRef}
      className="psr"
      data-ended={ended || undefined}
      aria-label={`Story: ${story.title}`}
      tabIndex={-1}
      onKeyDown={onKeyDown}
    >
      <div className="psr-frame">
        {/* Segmented progress — one per beat; active fills over reading time and
            steps onAnimationEnd. Hidden on the cover. */}
        {started && !ended && (
          <div className="psr-progress" role="presentation">
            {beats.map((b, i) => (
              <div className="psr-seg" key={b.id}>
                <div
                  key={i === safeIndex ? `active-${safeIndex}` : `idle-${i}`}
                  className={cn(
                    'psr-seg-fill',
                    i < safeIndex && 'is-done',
                    i === safeIndex && (timerDrivesAdvance ? 'is-active' : 'is-current'),
                  )}
                  style={
                    i === safeIndex && playing && timerDrivesAdvance
                      ? { animationDuration: `${durationMs}ms`, animationPlayState: paused ? 'paused' : 'running' }
                      : undefined
                  }
                  onAnimationEnd={i === safeIndex && playing && timerDrivesAdvance ? goNext : undefined}
                />
              </div>
            ))}
          </div>
        )}

        {/* Chrome: brand + timeline + live stamp + controls. */}
        <header className="psr-head">
          <div className="psr-head-label">
            <a className="psr-brand" href="/">
              Synek
            </a>
            <span className="psr-sep" aria-hidden="true">
              ·
            </span>
            <span className="psr-timeline" title={timelineTitle}>
              {timelineTitle}
            </span>
          </div>
          <div className="psr-head-actions">
            <span className="psr-updated" title={`Updated ${formatInstant(updatedAt, 'day')}`}>
              <span className="psr-live-dot" aria-hidden="true" />
              Updated {updatedLabel}
            </span>
            <button
              type="button"
              className="psr-ctrl"
              onClick={() => setAutoPlay((v) => !v)}
              aria-pressed={autoPlay}
              aria-label={autoPlay ? 'Turn auto-play off' : 'Turn auto-play on'}
              data-testid="psr-autoplay"
            >
              {autoPlay ? <Timer aria-hidden /> : <TimerOff aria-hidden />}
            </button>
            {speechSupported && (
              <button
                type="button"
                className="psr-ctrl"
                onClick={() => {
                  warmUpSpeech()
                  setSpeak((v) => !v)
                }}
                aria-pressed={speak}
                aria-label={speak ? 'Mute narration' : 'Read aloud'}
              >
                {speak ? <Volume2 aria-hidden /> : <VolumeX aria-hidden />}
              </button>
            )}
            <button type="button" className="psr-ctrl" onClick={share} aria-label="Share this story">
              <Share2 aria-hidden />
            </button>
          </div>
        </header>

        {hasUpdate && (
          <button type="button" className="psr-update-pill" onClick={() => window.location.reload()}>
            <Sparkles size={13} aria-hidden /> This story just updated — tap to refresh
          </button>
        )}

        {playing ? (
          <>
            <div
              className="psr-zone psr-zone-prev"
              aria-hidden="true"
              onPointerDown={startHold}
              onPointerUp={() => endHold('prev')}
              onPointerLeave={cancelHold}
              onPointerCancel={cancelHold}
            />
            <div
              className="psr-zone psr-zone-next"
              aria-hidden="true"
              onPointerDown={startHold}
              onPointerUp={() => endHold('next')}
              onPointerLeave={cancelHold}
              onPointerCancel={cancelHold}
            />
            <BeatPanel beat={beat} nodeById={nodeById} index={safeIndex} count={count} />
            <footer className="psr-foot">
              <button
                type="button"
                className="psr-edge"
                onClick={goPrev}
                disabled={safeIndex === 0}
                aria-label="Previous beat"
              >
                <ChevronLeft aria-hidden />
              </button>
              <span className="psr-count">
                {safeIndex + 1} / {count}
              </span>
              <button type="button" className="psr-edge" onClick={goNext} aria-label="Next beat">
                <ChevronRight aria-hidden />
              </button>
            </footer>
          </>
        ) : ended ? (
          <div className="psr-end">
            <span className="psr-eyebrow">
              {hasNext ? (chapterMeta?.number != null ? `End of Chapter ${chapterMeta.number}` : 'End of chapter') : 'The end'}
            </span>
            <h2 className="psr-end-title">{story.title}</h2>
            {hasNext && onNext ? (
              <>
                <p className="psr-end-note">{nextChapterTitle ? `Next: ${nextChapterTitle}` : 'The story continues.'}</p>
                <button type="button" className="psr-cta" onClick={onNext}>
                  <ChevronRight size={16} aria-hidden />
                  Next chapter
                </button>
              </>
            ) : (
              <>
                <p className="psr-end-note">
                  This story is <strong>live</strong> — it keeps updating as the world does. Want to build one like it?
                </p>
                <a className="psr-cta" href={sharedStorySignupHref(story.slug)}>
                  <Sparkles size={16} aria-hidden />
                  Make your own with Synek
                </a>
              </>
            )}
            <div className="psr-end-actions">
              <button type="button" className="psr-replay" onClick={replay}>
                <RotateCcw size={15} aria-hidden /> Read again
              </button>
              <button type="button" className="psr-replay" onClick={share}>
                <Share2 size={15} aria-hidden /> Share
              </button>
            </div>
          </div>
        ) : (
          <div className="psr-cover" data-in-series={inSeries || undefined}>
            {story.coverImage && (
              <figure className={cn('psr-cover-art', story.coverImage.aspect === 'portrait' && 'is-portrait')}>
                <img src={story.coverImage.url} alt={story.coverImage.alt ?? ''} />
              </figure>
            )}
            <div className="psr-cover-body">
              {chapterMeta && (
                <span className="psr-chapter-eyebrow">
                  {chapterMeta.number != null ? `Chapter ${chapterMeta.number} · ` : ''}
                  {chapterMeta.seriesTitle}
                </span>
              )}
              {/* In a series the jacket owns the page <h1>; the chapter title is an
                  <h2> so the season page keeps a single top-level heading. */}
              {chapterMeta ? (
                <h2 className="psr-title">{story.title}</h2>
              ) : (
                <h1 className="psr-title">{story.title}</h1>
              )}
              {story.hook && <p className="psr-hook">{story.hook}</p>}
              {story.cast.length > 0 && (
                <div className="psr-cast" aria-label="Cast">
                  {story.cast.map((m, i) => {
                    const label = (m.nodeId && nodeById.get(m.nodeId)?.title) || m.name
                    if (!label) return null
                    return (
                      <span key={i} className="psr-cast-chip" title={m.role ?? undefined}>
                        {label}
                      </span>
                    )
                  })}
                </div>
              )}
              <div className="psr-meta">
                <span className={cn('psr-chip', story.depthTier === 'deep' && 'is-deep')}>
                  {story.depthTier === 'deep' ? 'Deep' : 'Light'}
                </span>
                {story.povType !== 'omniscient' && <span className="psr-chip">{POV_LABEL[story.povType]}</span>}
                {story.estimatedMinutes != null && <span className="psr-chip">~{story.estimatedMinutes} min</span>}
                {/* "Beats" is production vocabulary — dropped inside a series (book language). */}
                {!inSeries && (
                  <span className="psr-chip">
                    {count} {count === 1 ? 'beat' : 'beats'}
                  </span>
                )}
              </div>
              {!hideCoverCta && (
                <button type="button" className="psr-play" onClick={begin} disabled={count === 0}>
                  <Play aria-hidden />
                  {ctaLabel ?? 'Play story'}
                </button>
              )}
            </div>
          </div>
        )}
      </div>
    </main>
  )
}

// One beat panel: the hero visual (widget and/or image, by layout) + setting +
// body + mentions + citations.
function BeatPanel({
  beat,
  nodeById,
  index,
  count,
}: {
  beat: StoryBeat | undefined
  nodeById: Map<string, GraphNode>
  index: number
  count: number
}) {
  if (!beat) return null
  const bleed = beat.image?.layout === 'bleed'
  return (
    <div className="psr-stage" role="group" aria-roledescription="story beat" aria-label={`Beat ${index + 1} of ${count}`}>
      {bleed && beat.image && (
        <div className="psr-bleed" aria-hidden="true" key={`bleed-${beat.id}`}>
          <img src={beat.image.url} alt="" />
        </div>
      )}
      <article className={cn('psr-beat', `psr-beat-${beat.kind}`)} key={beat.id}>
        {beat.widget && <BeatWidget widget={beat.widget} nodeById={nodeById} />}
        {beat.image?.url && !bleed && (
          <figure className={cn('psr-img', `psr-img-${beat.image.layout ?? 'full'}`, beat.image.aspect === 'portrait' && 'is-portrait')}>
            {/* A broken/blocked image URL would otherwise leave an empty captioned frame;
                hide the whole figure when the image fails to load. */}
            <img
              src={beat.image.url}
              alt={beat.image.alt ?? ''}
              loading="lazy"
              onError={(e) => {
                const fig = e.currentTarget.closest('figure')
                if (fig) (fig as HTMLElement).style.display = 'none'
              }}
            />
            {beat.image.alt?.trim() && <figcaption>{beat.image.alt}</figcaption>}
          </figure>
        )}
        {beat.settingNote && <p className="psr-setting">{beat.settingNote}</p>}
        <p className="psr-text">{beat.bodyText}</p>
        {beat.relatedNodeIds.length > 0 && (
          <div className="psr-mentions">
            {beat.relatedNodeIds.map((id) => {
              const n = nodeById.get(id)
              if (!n) return null
              return (
                <span key={id} className="psr-mention">
                  {n.title}
                </span>
              )
            })}
          </div>
        )}
        {beat.citations.length > 0 && (
          <div className="psr-cites">
            {beat.citations.map((c, i) => (
              <div className="psr-cite" key={i}>
                <span className="psr-cite-title">{c.title || 'Source'}</span>
                {c.quote?.trim() && <span className="psr-cite-quote">“{c.quote}”</span>}
                {c.url?.trim() && (
                  <a className="psr-cite-link" href={c.url} target="_blank" rel="noreferrer noopener">
                    Open source ↗
                  </a>
                )}
              </div>
            ))}
          </div>
        )}
      </article>
    </div>
  )
}
