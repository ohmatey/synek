import { useCallback, useEffect, useRef, useState } from 'react'
import { X, ChevronLeft, ChevronRight, Play, Volume2, VolumeX } from 'lucide-react'
import { cn } from '~/lib/utils'
import type { GraphNode, PovType, StoryDTO } from '~/lib/domain/types'
import { useSpeechSupported, useStoryNarration, warmUpSpeech } from './useStoryNarration'
import { ResizeHandle } from './ResizeHandle'

// Human labels for the story POV; only surfaced when it's not the default.
const POV_LABEL: Record<PovType, string> = {
  omniscient: 'Omniscient',
  first_person: 'First person',
  witness: 'Witness',
  diary: 'Diary',
}

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
  nodeById,
  paused,
  onPausedChange,
  speak,
  onSpeakChange,
  onClose,
  onSelectNode,
  onBeatChange,
  width,
  onResize,
  onCommitResize,
}: {
  story: StoryDTO
  momentTitle: string
  nodeById: Map<string, GraphNode>
  // Pause state is lifted to the canvas so the top story chip can drive it too.
  paused: boolean
  onPausedChange: (paused: boolean) => void
  // Read-aloud narration (Web Speech API). Lifted so the lens-bar transport + the
  // view-settings popover can drive it too; persisted per-timeline.
  speak: boolean
  onSpeakChange: (speak: boolean) => void
  onClose: () => void
  // Navigate the canvas selection to a related node (closes the reader first).
  onSelectNode: (id: string) => void
  // Report the active beat index as the reader steps; the canvas maps it to a
  // camera pan + the entity the detail panel shows (per-beat focusNodeId). Stable.
  onBeatChange: (index: number) => void
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
  const safeIndex = Math.min(index, Math.max(0, count - 1))
  const beat = beats[safeIndex]

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
    // Past the last beat → close (Stories convention). Keep the side effect OUT
    // of the state updater so it stays pure under StrictMode double-invoke.
    if (safeIndex >= count - 1) onClose()
    else setIndex((i) => i + 1)
  }, [safeIndex, count, onClose])
  const goPrev = useCallback(() => setIndex((i) => Math.max(0, i - 1)), [])

  // Report the active beat up as the reader steps so the canvas can pan + switch
  // the entity panel to this beat's focus. While on the cover (not started) report
  // -1 so the canvas keeps the moment framed. The canvas restores the moment
  // overview when reading ends (this panel unmounts), so no cleanup needed here.
  useEffect(() => {
    onBeatChange(started ? safeIndex : -1)
  }, [started, safeIndex, onBeatChange])

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
          if (speak) warmUpSpeech()
          setStarted(true)
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
    [started, speak, goNext, goPrev, onClose],
  )

  const navigateTo = useCallback(
    (id: string) => {
      onClose()
      onSelectNode(id)
    },
    [onClose, onSelectNode],
  )

  const durationMs = beat ? beatDurationMs(beat.bodyText) : MIN_BEAT_MS

  // Read-aloud narration. When on (and supported, and motion isn't reduced) speech
  // BECOMES the advance timer: the reader steps when the utterance ends, so the
  // active progress segment is rendered static (no misleading countdown) and the
  // CSS-fill onAnimationEnd advance is disabled — one advance source at a time.
  const speechSupported = useSpeechSupported()
  const speechDrivesAdvance = speak && speechSupported && !reduced
  useStoryNarration({
    beat,
    started,
    speak,
    paused,
    reduced,
    supported: speechSupported,
    onAdvance: goNext,
  })

  return (
    <aside
      ref={asideRef}
      className="story-reader"
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
                  i < safeIndex && 'is-done',
                  i === safeIndex && (reduced || speechDrivesAdvance ? 'is-current' : 'is-active'),
                )}
                style={
                  i === safeIndex && !reduced && !speechDrivesAdvance
                    ? { animationDuration: `${durationMs}ms`, animationPlayState: paused ? 'paused' : 'running' }
                    : undefined
                }
                onAnimationEnd={i === safeIndex && !reduced && !speechDrivesAdvance ? goNext : undefined}
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
          {speechSupported && (
            <button
              type="button"
              className="sv-ctrl"
              onClick={() => {
                warmUpSpeech()
                onSpeakChange(!speak)
              }}
              aria-pressed={speak}
              title={speak ? 'Mute narration' : 'Read aloud'}
              aria-label={speak ? 'Mute narration' : 'Read story aloud'}
            >
              {speak ? <Volume2 aria-hidden /> : <VolumeX aria-hidden />}
            </button>
          )}
          <button type="button" className="sv-ctrl" onClick={onClose} aria-label="Close story">
            <X aria-hidden />
          </button>
        </div>
      </header>

      {started ? (
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
            {beat && (
              <article className={cn('sv-beat', `sv-beat-${beat.kind}`)} key={beat.id}>
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
                    {beat.citations.map((c, i) => (
                      <div className="sv-cite" key={i}>
                        <span className="sv-cite-title">{c.title || 'Untitled source'}</span>
                        {c.quote?.trim() && <span className="sv-cite-quote">“{c.quote}”</span>}
                        {c.url?.trim() && (
                          <a className="sv-cite-link" href={c.url} target="_blank" rel="noreferrer noopener">
                            Open source ↗
                          </a>
                        )}
                      </div>
                    ))}
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
      ) : (
        /* Cover: title + hook + meta chips, with a Play button to begin the stepped,
           auto-advancing reader. */
        <div className="sv-cover">
          <div className="sv-intro">
            <h2 className="sv-title">{story.title}</h2>
            {story.hook && <p className="sv-hook">{story.hook}</p>}
          </div>
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
          <button
            type="button"
            className="sv-play"
            onClick={() => {
              // Prime the speech queue within this gesture so the first beat's
              // utterance isn't blocked on iOS (no-op when narration is off).
              if (speak) warmUpSpeech()
              setStarted(true)
            }}
            disabled={count === 0}
          >
            <Play aria-hidden />
            Play story
          </button>
        </div>
      )}
    </aside>
  )
}
