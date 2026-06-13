import { useCallback, useEffect, useRef, useState } from 'react'
import { X, ChevronLeft, ChevronRight, Play, RotateCcw, Volume2, VolumeX, Timer, TimerOff } from 'lucide-react'
import { cn } from '~/lib/utils'
import type { GraphNode, StoryDTO } from '~/lib/domain/types'
import { POV_LABEL } from '~/lib/domain/story-labels'
import { Tooltip, TooltipContent, TooltipTrigger } from '~/components/ui/tooltip'
import { CopyButton } from '~/components/home/CopyButton'
import { buildContinueStoryPrompt } from '~/lib/story-prompt'
import { capture } from '~/lib/posthog/client'
import { useSpeechSupported, useStoryNarration, warmUpSpeech } from './useStoryNarration'
import { ResizeHandle } from './ResizeHandle'

// Reels/Stories-style playback, DOCKED beside the entity dialog (not full-screen).
// One beat fills the panel at a time; segmented progress bars across the top
// auto-advance (the CSS fill animation IS the timer — onAnimationEnd steps). As the
// reader steps, it reports the active beat index up (onBeatChange); the canvas maps
// that to a camera pan + which entity the detail panel beside it shows (per-beat
// focusNodeId). Rendered as a plain <aside role="dialog"> — NOT a native <dialog> —
// so it sits in the canvas dock next to the panel instead of taking over the screen
// (this also sidesteps the StrictMode showModal() self-close gotcha entirely).
//
// Interaction model (matches Instagram/Snapchat Stories):
//   • Tap the right two-thirds → next beat (past the last → close). Tap the left
//     third → previous beat.
//   • Press-and-hold anywhere → pause; release → resume (distinguished from a tap
//     by a short hold threshold).
//   • Keyboard: →/Space next, ← previous, Esc close. Explicit Prev/Next/Pause/Close
//     buttons back the pointer affordances for keyboard + SR users.
//   • prefers-reduced-motion → no auto-advance and no animated fill; the reader
//     becomes fully manual (no content vanishing on a timer), segments static.

// Average adult reading speed; a story beat is short so we add a fixed floor.
const WORDS_PER_MINUTE = 200
const MIN_BEAT_MS = 3500
const MAX_BEAT_MS = 12_000
// Below this a pointer press counts as a tap (navigate); at or above it, a
// deliberate hold (pause, no navigation).
const HOLD_THRESHOLD_MS = 220

function beatDurationMs(text: string): number {
  const words = text.trim().split(/\s+/).filter(Boolean).length
  const ms = 1500 + (words / WORDS_PER_MINUTE) * 60_000
  return Math.min(MAX_BEAT_MS, Math.max(MIN_BEAT_MS, ms))
}

export function StoryReader({
  story,
  momentTitle,
  momentId,
  timelineId,
  nodeById,
  paused,
  onPausedChange,
  speak,
  onSpeakChange,
  autoPlay,
  onAutoPlayChange,
  onClose,
  onStart,
  onSelectNode,
  onBeatChange,
  solo,
  width,
  onResize,
  onCommitResize,
}: {
  story: StoryDTO
  momentTitle: string
  // The moment + timeline this story sits on — used to assemble the "continue this
  // story" prompt on the end panel.
  momentId: string
  timelineId: string
  nodeById: Map<string, GraphNode>
  // Pause state is lifted to the canvas so the top story chip can drive it too.
  paused: boolean
  onPausedChange: (paused: boolean) => void
  // Read-aloud narration (Web Speech API). Lifted so the lens-bar transport + the
  // view-settings popover can drive it too; persisted per-timeline.
  speak: boolean
  onSpeakChange: (speak: boolean) => void
  // Timed auto-advance (the Reels/Stories slideshow). On = beats advance on their
  // own; off = fully manual (step with taps/arrows), like reduced-motion. Lifted so
  // it persists per-timeline and the view-settings popover can drive it too.
  autoPlay: boolean
  onAutoPlayChange: (autoPlay: boolean) => void
  onClose: () => void
  // Fired when the reader leaves the cover and playback begins — the canvas uses it
  // to turn the timeline into the story's stage (timeline-as-stage). Optional.
  onStart?: () => void
  // Open an entity BESIDE the reader (a cast member / related-node link), WITHOUT
  // ending the story — stories run by themselves; opening an entity is an explicit,
  // optional gesture. The reader stays docked and keeps playing.
  onSelectNode: (id: string) => void
  // Report the active beat index as the reader steps; the canvas maps it to a
  // camera pan. Stable.
  onBeatChange: (index: number) => void
  // No entity panel is open beside the reader → dock flush at the right edge
  // (data-solo); with one open the reader slides to its left.
  solo?: boolean
  // Resizable width (px), owned by the canvas. Omit to use the CSS default and
  // hide the drag handle.
  width?: number
  onResize?: (next: number) => void
  onCommitResize?: () => void
}) {
  const asideRef = useRef<HTMLElement>(null)
  const beats = story.beats
  const count = beats.length
  const [index, setIndex] = useState(0)
  const [reduced, setReduced] = useState(false)
  // The reader opens on a cover (title + hook + meta); the stepped player + the
  // timed auto-advance only begin once the reader is "started" (Play pressed). On
  // the cover the canvas keeps the moment in focus (beat index -1 reported up).
  const [started, setStarted] = useState(false)
  // Stepping past the last beat lands on an end panel (wrap-up + "continue this
  // story" prompt) instead of closing outright. The moment stays framed there too.
  const [ended, setEnded] = useState(false)
  const safeIndex = Math.min(index, Math.max(0, count - 1))
  const beat = beats[safeIndex]
  // The stepped player is live only between the cover and the end panel.
  const playing = started && !ended

  // Engagement KPIs: a reader pressed Play (story_started), and reached the end
  // panel past the last beat (story_completed). Effects fire once per transition.
  useEffect(() => {
    if (started) capture('story_started', { timeline_id: timelineId, story_id: story.id })
  }, [started])
  useEffect(() => {
    if (ended) capture('story_completed', { timeline_id: timelineId, story_id: story.id, beats: count })
  }, [ended])

  // Focus the panel on mount so keyboard nav + Esc work without a click first —
  // and again when playback starts: clicking the cover's Play unmounts that
  // button with the cover, dropping focus to <body>, which would orphan the
  // aside's keydown handling (Esc/arrows).
  useEffect(() => {
    asideRef.current?.focus()
  }, [started])

  // Honor reduced-motion: turn the timed auto-advance + animated fill off.
  useEffect(() => {
    if (typeof window === 'undefined' || !window.matchMedia) return
    const mq = window.matchMedia('(prefers-reduced-motion: reduce)')
    const update = () => setReduced(mq.matches)
    update()
    mq.addEventListener('change', update)
    return () => mq.removeEventListener('change', update)
  }, [])

  const goNext = useCallback(() => {
    // Past the last beat → show the end panel (wrap-up + continue prompt) rather
    // than closing. Keep the side effect OUT of the state updater so it stays pure
    // under StrictMode double-invoke.
    if (safeIndex >= count - 1) setEnded(true)
    else setIndex((i) => i + 1)
  }, [safeIndex, count])
  const goPrev = useCallback(() => setIndex((i) => Math.max(0, i - 1)), [])

  // Leave the cover and begin the stepped player. Notifies the canvas so it can
  // raise the timeline as the story's stage (timeline-as-stage).
  const begin = useCallback(() => {
    // Prime the speech queue within this gesture so the first beat's utterance
    // isn't blocked on iOS (no-op when narration is off).
    if (speak) warmUpSpeech()
    setStarted(true)
    onStart?.()
  }, [speak, onStart])

  // Restart from the cover's first beat (the end panel's "Read again").
  const replay = useCallback(() => {
    if (speak) warmUpSpeech()
    setIndex(0)
    setEnded(false)
  }, [speak])

  // Report the active beat up as the reader steps so the canvas can pan + switch
  // the entity panel to this beat's focus. On the cover and the end panel (not
  // playing) report -1 so the canvas keeps the moment framed. The canvas restores
  // the moment overview when reading ends (this panel unmounts), so no cleanup here.
  useEffect(() => {
    onBeatChange(playing ? safeIndex : -1)
  }, [playing, safeIndex, onBeatChange])

  // Press-and-hold detection: a quick press is a tap (navigate by zone); a long
  // press pauses without navigating. Shared by both tap zones.
  const holdRef = useRef<{ held: boolean; timer: ReturnType<typeof setTimeout> } | null>(null)
  const startHold = useCallback(() => {
    onPausedChange(true)
    const state = { held: false, timer: setTimeout(() => (state.held = true), HOLD_THRESHOLD_MS) }
    holdRef.current = state
  }, [onPausedChange])
  const endHold = useCallback(
    (dir: 'next' | 'prev') => {
      const state = holdRef.current
      holdRef.current = null
      onPausedChange(false)
      if (!state) return
      clearTimeout(state.timer)
      if (!state.held) (dir === 'next' ? goNext : goPrev)()
    },
    [goNext, goPrev, onPausedChange],
  )
  const cancelHold = useCallback(() => {
    const state = holdRef.current
    holdRef.current = null
    if (state) clearTimeout(state.timer)
    onPausedChange(false)
  }, [onPausedChange])

  const onKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault()
        onClose()
        return
      }
      // On the cover, →/Space/Enter starts playback rather than stepping.
      if (!started) {
        if (e.key === 'ArrowRight' || e.key === ' ' || e.key === 'Spacebar' || e.key === 'Enter') {
          e.preventDefault()
          begin()
        }
        return
      }
      // On the end panel, ← steps back into the last beat; forward keys do nothing.
      if (ended) {
        if (e.key === 'ArrowLeft') {
          e.preventDefault()
          setEnded(false)
        }
        return
      }
      if (e.key === 'ArrowRight' || e.key === ' ' || e.key === 'Spacebar') {
        e.preventDefault()
        goNext()
      } else if (e.key === 'ArrowLeft') {
        e.preventDefault()
        goPrev()
      }
    },
    [started, ended, begin, goNext, goPrev, onClose],
  )

  // Open an entity beside the reader WITHOUT closing the story (decoupled): a cast
  // chip or related-node link is an optional side-trip, not an exit.
  const navigateTo = useCallback((id: string) => onSelectNode(id), [onSelectNode])

  const durationMs = beat ? beatDurationMs(beat.bodyText) : MIN_BEAT_MS

  // Whether the reader advances on its own at all. Off when the user turns
  // auto-play off OR motion is reduced — both make the reader fully manual.
  const autoAdvance = autoPlay && !reduced
  // Read-aloud narration. When on (and supported, and auto-advancing) speech
  // BECOMES the advance timer: the reader steps when the utterance ends, so the
  // active progress segment is rendered static (no misleading countdown) and the
  // CSS-fill onAnimationEnd advance is disabled — one advance source at a time.
  const speechSupported = useSpeechSupported()
  const speechDrivesAdvance = autoAdvance && speak && speechSupported
  // The CSS-fill timer drives advance only when auto-advancing and narration isn't
  // already the timer. When neither is true the segment is static and the reader
  // waits for a manual step (tap/arrow/Next).
  const timerDrivesAdvance = autoAdvance && !speechDrivesAdvance
  // Narration still reads each beat aloud while auto-play is off, but it must NOT
  // step — the reader waits for input. Guard the advance on auto-play.
  const narrationAdvance = useCallback(() => {
    if (autoPlay) goNext()
  }, [autoPlay, goNext])
  useStoryNarration({
    beat,
    // Stop narration once the reader reaches the end panel (cancels in-flight speech).
    started: playing,
    speak,
    paused,
    reduced,
    supported: speechSupported,
    onAdvance: narrationAdvance,
  })

  return (
    <aside
      ref={asideRef}
      className="story-reader"
      data-solo={solo || undefined}
      role="dialog"
      aria-label={`Story: ${story.title}`}
      tabIndex={-1}
      onKeyDown={onKeyDown}
    >
      {width != null && onResize && (
        <ResizeHandle width={width} onResize={onResize} onCommit={onCommitResize} label="Resize story reader" />
      )}
      {/* Segmented progress — one segment per beat; the active one animates fill
          over the beat's reading time and steps onAnimationEnd (the fill is the
          timer, so a hold-pause naturally delays the advance). Hidden on the cover. */}
      {started && (
        <div className="sv-progress" role="presentation">
          {beats.map((b, i) => (
            <div className="sv-seg" key={b.id}>
              <div
                // Re-key the active fill by index so each step restarts the fill from
                // 0; a pause/resume keeps the same key (toggles play-state instead).
                key={i === safeIndex ? `active-${safeIndex}` : `idle-${i}`}
                className={cn(
                  'sv-seg-fill',
                  (i < safeIndex || ended) && 'is-done',
                  i === safeIndex && !ended && (timerDrivesAdvance ? 'is-active' : 'is-current'),
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

      {/* Chrome: moment label + close (play/pause + stop live in the top story chip). */}
      <header className="sv-head">
        <div className="sv-head-label">
          <span className="sv-eyebrow">Story</span>
          <span className="sv-moment" title={momentTitle}>
            {momentTitle}
          </span>
        </div>
        <div className="sv-head-actions">
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                type="button"
                className="sv-ctrl"
                onClick={() => onAutoPlayChange(!autoPlay)}
                aria-pressed={autoPlay}
                aria-label={autoPlay ? 'Turn auto-play off' : 'Turn auto-play on'}
                data-testid="autoplay-toggle"
              >
                {autoPlay ? <Timer aria-hidden /> : <TimerOff aria-hidden />}
              </button>
            </TooltipTrigger>
            <TooltipContent>
              {autoPlay ? 'Auto-play on — beats advance on their own' : 'Auto-play off — advance beats yourself'}
            </TooltipContent>
          </Tooltip>
          {speechSupported && (
            <Tooltip>
              <TooltipTrigger asChild>
                <button
                  type="button"
                  className="sv-ctrl"
                  onClick={() => {
                    warmUpSpeech()
                    onSpeakChange(!speak)
                  }}
                  aria-pressed={speak}
                  aria-label={speak ? 'Mute narration' : 'Read story aloud'}
                >
                  {speak ? <Volume2 aria-hidden /> : <VolumeX aria-hidden />}
                </button>
              </TooltipTrigger>
              <TooltipContent>{speak ? 'Mute narration' : 'Read aloud'}</TooltipContent>
            </Tooltip>
          )}
          <button type="button" className="sv-ctrl" onClick={onClose} aria-label="Close story">
            <X aria-hidden />
          </button>
        </div>
      </header>

      {playing ? (
        <>
          {/* Tap zones — pointer-only affordance (real controls live in the chrome). */}
          <div
            className="sv-zone sv-zone-prev"
            aria-hidden="true"
            onPointerDown={startHold}
            onPointerUp={() => endHold('prev')}
            onPointerLeave={cancelHold}
            onPointerCancel={cancelHold}
          />
          <div
            className="sv-zone sv-zone-next"
            aria-hidden="true"
            onPointerDown={startHold}
            onPointerUp={() => endHold('next')}
            onPointerLeave={cancelHold}
            onPointerCancel={cancelHold}
          />

          {/* The active beat. */}
          <div
            className="sv-stage"
            role="group"
            aria-roledescription="story beat"
            aria-label={`Beat ${safeIndex + 1} of ${count}`}
          >
            {/* A bleed image backs the whole stage behind a scrim; other layouts
                render inside the beat itself. */}
            {beat?.image && beat.image.layout === 'bleed' && (
              <div className="sv-bleed" aria-hidden="true" key={`bleed-${beat.id}`}>
                <img src={beat.image.url} alt="" />
              </div>
            )}
            {beat && (
              <article
                className={cn(
                  'sv-beat',
                  `sv-beat-${beat.kind}`,
                  beat.image?.layout?.startsWith('inset') && 'has-inset',
                )}
                key={beat.id}
              >
                {beat.image && beat.image.layout !== 'bleed' && (
                  <figure
                    className={cn(
                      'sv-img',
                      `sv-img-${beat.image.layout ?? 'full'}`,
                      beat.image.aspect === 'portrait' && 'is-portrait',
                    )}
                  >
                    <img src={beat.image.url} alt={beat.image.alt ?? ''} loading="lazy" />
                    {beat.image.alt?.trim() && <figcaption>{beat.image.alt}</figcaption>}
                  </figure>
                )}
                {beat.settingNote && <p className="sv-setting">{beat.settingNote}</p>}
                <p className="sv-text">{beat.bodyText}</p>
                {beat.relatedNodeIds.length > 0 && (
                  <div className="sv-links">
                    {beat.relatedNodeIds.map((id) => {
                      const other = nodeById.get(id)
                      if (!other) return null
                      return (
                        <button key={id} type="button" className="sv-link" onClick={() => navigateTo(id)}>
                          → {other.title}
                        </button>
                      )
                    })}
                  </div>
                )}
                {beat.citations.length > 0 && (
                  <div className="sv-cites">
                    {beat.citations.map((c, i) => {
                      const body = c.transcript?.trim() || c.translation?.trim()
                      return (
                        <div className={cn('sv-cite', c.artifactId && 'is-artifact')} key={i}>
                          <span className="sv-cite-title">{c.title || 'Untitled source'}</span>
                          {c.reliability && (
                            <span className={cn('sv-cite-rel', `is-${c.reliability}`)}>{c.reliability}</span>
                          )}
                          {c.quote?.trim() && <span className="sv-cite-quote">“{c.quote}”</span>}
                          {/* Artifact-backed citation → tap to reveal the source card
                              (transcript / translation / image). Inline one-offs have
                              no artifactId and render exactly as before. */}
                          {c.artifactId && (body || c.imageUrl?.trim()) && (
                            <details className="sv-cite-card">
                              <summary>View artifact</summary>
                              {c.imageUrl?.trim() && (
                                <img className="sv-cite-img" src={c.imageUrl} alt={c.title} loading="lazy" />
                              )}
                              {c.transcript?.trim() && <p className="sv-cite-transcript">{c.transcript}</p>}
                              {c.translation?.trim() && (
                                <p className="sv-cite-translation">{c.translation}</p>
                              )}
                            </details>
                          )}
                          {c.url?.trim() && (
                            <a className="sv-cite-link" href={c.url} target="_blank" rel="noreferrer noopener">
                              Open source ↗
                            </a>
                          )}
                        </div>
                      )
                    })}
                  </div>
                )}
              </article>
            )}
          </div>

          {/* Bottom nav — prev / counter / next (real keyboard targets + tap affordance). */}
          <footer className="sv-foot">
            <button
              type="button"
              className="sv-edge sv-edge-prev"
              onClick={goPrev}
              disabled={safeIndex === 0}
              aria-label="Previous beat"
            >
              <ChevronLeft aria-hidden />
            </button>
            <span className="sv-count">
              {safeIndex + 1} / {count}
            </span>
            <button type="button" className="sv-edge sv-edge-next" onClick={goNext} aria-label="Next beat">
              <ChevronRight aria-hidden />
            </button>
          </footer>
        </>
      ) : ended ? (
        /* End panel: wrap up the story and invite the reader to continue it by
           copying a ready-made prompt to paste into their connected Claude. */
        <div className="sv-end">
          <div className="sv-intro">
            <span className="sv-eyebrow">The end</span>
            <h2 className="sv-title">{story.title}</h2>
            <p className="sv-end-note">
              That’s the story so far. Want to know what happens next? Copy the prompt below into your connected Claude
              and it will pick up the thread and add more beats — right here.
            </p>
          </div>
          <div className="sv-end-actions">
            <CopyButton
              text={buildContinueStoryPrompt({
                storyId: story.id,
                momentId,
                timelineId,
                title: story.title,
                beats: story.beats,
              })}
              label="Copy prompt to continue"
              copiedLabel="Copied — paste into Claude"
              variant="default"
              className="w-full"
              onCopy={() => capture('story_prompt_copied', { timeline_id: timelineId, mode: 'continue' })}
            />
            <button type="button" className="sv-replay" onClick={replay}>
              <RotateCcw aria-hidden />
              Read again
            </button>
          </div>
        </div>
      ) : (
        /* Cover: art + title + hook + meta chips + cast, with a Play button to begin
           the stepped, auto-advancing reader. */
        <div className="sv-cover">
          {story.coverImage && (
            <figure className={cn('sv-cover-art', story.coverImage.aspect === 'portrait' && 'is-portrait')}>
              <img src={story.coverImage.url} alt={story.coverImage.alt ?? ''} loading="lazy" />
            </figure>
          )}
          <div className="sv-intro">
            <h2 className="sv-title">{story.title}</h2>
            {story.hook && <p className="sv-hook">{story.hook}</p>}
          </div>
          {story.cast.length > 0 && (
            <div className="sv-cast" aria-label="Cast">
              {story.cast.map((m, i) => {
                const node = m.nodeId ? nodeById.get(m.nodeId) : undefined
                const label = node?.title ?? m.name
                if (!label) return null
                // Node-backed cast members jump to their node; name-only ones are
                // inert (they exist in prose but have no node yet).
                return node ? (
                  <button
                    key={i}
                    type="button"
                    className="sv-cast-chip"
                    onClick={() => navigateTo(node.id)}
                    title={m.role ?? undefined}
                  >
                    {label}
                  </button>
                ) : (
                  <span key={i} className="sv-cast-chip is-ghost" title={m.role ?? undefined}>
                    {label}
                  </span>
                )
              })}
            </div>
          )}
          <div className="sv-cover-meta">
            <span className={cn('sv-chip', story.depthTier === 'deep' && 'sv-chip-deep')}>
              {story.depthTier === 'deep' ? 'Deep' : 'Light'}
            </span>
            {story.povType !== 'omniscient' && <span className="sv-chip">{POV_LABEL[story.povType]}</span>}
            {story.estimatedMinutes != null && <span className="sv-chip">~{story.estimatedMinutes} min</span>}
            <span className="sv-chip">
              {count} {count === 1 ? 'beat' : 'beats'}
            </span>
          </div>
          <button type="button" className="sv-play" onClick={begin} disabled={count === 0}>
            <Play aria-hidden />
            Play story
          </button>
        </div>
      )}
    </aside>
  )
}
