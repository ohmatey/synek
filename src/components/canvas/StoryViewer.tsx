import { useCallback, useEffect, useRef, useState } from 'react'
import { Pause, Play, X, ChevronLeft, ChevronRight } from 'lucide-react'
import { cn } from '~/lib/utils'
import type { GraphNode, StoryDTO } from '~/lib/domain/types'

// Reels/Stories-style playback: a full-screen, tap-through reader for a story.
// One beat fills the screen at a time; segmented progress bars across the top
// auto-advance (the CSS fill animation IS the timer — onAnimationEnd steps), and
// the reader walks the canvas camera beat-to-beat behind the overlay (the same
// onCameraTargets seam the panel used). Built on a native <dialog> opened with
// showModal() so focus-trapping, top-layer stacking, and Esc-to-close come for
// free (accessible by default); tap-zones are a pointer affordance layered on top.
//
// Interaction model (matches Instagram/Snapchat Stories):
//   • Tap the right two-thirds → next beat (past the last → close). Tap the left
//     third → previous beat.
//   • Press-and-hold anywhere → pause; release → resume (distinguished from a tap
//     by a short hold threshold).
//   • Keyboard: →/Space next, ← previous, Esc close (native). Explicit Prev/Next/
//     Pause/Close buttons back the pointer affordances for keyboard + SR users.
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

export function StoryViewer({
  story,
  momentId,
  momentTitle,
  nodeById,
  onClose,
  onSelectNode,
  onCameraTargets,
}: {
  story: StoryDTO
  momentId: string
  momentTitle: string
  nodeById: Map<string, GraphNode>
  onClose: () => void
  // Navigate the canvas selection to a related node (closes the viewer first).
  onSelectNode: (id: string) => void
  // Pan the canvas camera to these node ids as the reader steps (GAP 1·B).
  onCameraTargets: (ids: string[]) => void
}) {
  const dialogRef = useRef<HTMLDialogElement>(null)
  const beats = story.beats
  const count = beats.length
  const [index, setIndex] = useState(0)
  const [paused, setPaused] = useState(false)
  const [reduced, setReduced] = useState(false)
  const safeIndex = Math.min(index, Math.max(0, count - 1))
  const beat = beats[safeIndex]

  // Open as a true modal (top layer + focus trap + Esc) on mount; close on unmount.
  // NOTE: the cleanup's d.close() fires the dialog's native 'close' event. React
  // StrictMode (dev) double-invokes this effect (setup → cleanup → setup), so that
  // 'close' fires spuriously during mount — which is exactly why we DON'T bind the
  // parent close to the dialog's onClose below (only to user dismissal). See onCancel.
  useEffect(() => {
    const d = dialogRef.current
    if (d && !d.open) d.showModal()
    return () => {
      if (d?.open) d.close()
    }
  }, [])

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

  // Walk the canvas camera to the active beat's first related node (or the moment
  // at every beat with no link), and restore the moment overview when the viewer
  // closes — so the map glides behind the story as you tap through it.
  useEffect(() => {
    onCameraTargets([beat?.relatedNodeIds[0] ?? momentId])
  }, [safeIndex, beat, momentId, onCameraTargets])
  useEffect(() => () => onCameraTargets([momentId]), [momentId, onCameraTargets])

  // Press-and-hold detection: a quick press is a tap (navigate by zone); a long
  // press pauses without navigating. Shared by both tap zones.
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
      if (e.key === 'ArrowRight' || e.key === ' ' || e.key === 'Spacebar') {
        e.preventDefault()
        goNext()
      } else if (e.key === 'ArrowLeft') {
        e.preventDefault()
        goPrev()
      }
    },
    [goNext, goPrev],
  )

  const navigateTo = useCallback(
    (id: string) => {
      onClose()
      onSelectNode(id)
    },
    [onClose, onSelectNode],
  )

  const durationMs = beat ? beatDurationMs(beat.bodyText) : MIN_BEAT_MS

  return (
    <dialog
      ref={dialogRef}
      className="story-viewer"
      aria-label={`Story: ${story.title}`}
      // Only treat USER dismissal (Esc → 'cancel') as a close. We deliberately do
      // NOT bind onClose to the native 'close' event: our own d.close() (incl. the
      // StrictMode-cleanup one) fires 'close' too, and routing that to the parent
      // would tear the viewer down the instant it opened in dev. Explicit closes
      // (the X button, tap navigation) call onClose directly.
      onCancel={onClose}
      onKeyDown={onKeyDown}
    >
      {/* Segmented progress — one segment per beat; the active one animates fill
          over the beat's reading time and steps onAnimationEnd (the fill is the
          timer, so a hold-pause naturally delays the advance). */}
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
                i === safeIndex && (reduced ? 'is-current' : 'is-active'),
              )}
              style={
                i === safeIndex && !reduced
                  ? { animationDuration: `${durationMs}ms`, animationPlayState: paused ? 'paused' : 'running' }
                  : undefined
              }
              onAnimationEnd={i === safeIndex && !reduced ? goNext : undefined}
            />
          </div>
        ))}
      </div>

      {/* Chrome: moment label + transport controls (backing the tap zones for
          keyboard + screen-reader users). */}
      <header className="sv-head">
        <div className="sv-head-label">
          <span className="sv-eyebrow">Story</span>
          <span className="sv-moment" title={momentTitle}>
            {momentTitle}
          </span>
        </div>
        <div className="sv-head-actions">
          {!reduced && (
            <button
              type="button"
              className="sv-ctrl"
              onClick={() => setPaused((p) => !p)}
              aria-label={paused ? 'Resume' : 'Pause'}
              aria-pressed={paused}
            >
              {paused ? <Play aria-hidden /> : <Pause aria-hidden />}
            </button>
          )}
          <button type="button" className="sv-ctrl" onClick={onClose} aria-label="Close story">
            <X aria-hidden />
          </button>
        </div>
      </header>

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
      <div className="sv-stage" role="group" aria-roledescription="story beat" aria-label={`Beat ${safeIndex + 1} of ${count}`}>
        {safeIndex === 0 && (
          <div className="sv-intro">
            <h2 className="sv-title">{story.title}</h2>
            {story.hook && <p className="sv-hook">{story.hook}</p>}
          </div>
        )}
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

      {/* Edge chevrons — visible affordance + real keyboard targets. */}
      <button
        type="button"
        className="sv-edge sv-edge-prev"
        onClick={goPrev}
        disabled={safeIndex === 0}
        aria-label="Previous beat"
      >
        <ChevronLeft aria-hidden />
      </button>
      <button type="button" className="sv-edge sv-edge-next" onClick={goNext} aria-label="Next beat">
        <ChevronRight aria-hidden />
      </button>

      <footer className="sv-foot">
        <span className="sv-count">
          {safeIndex + 1} / {count}
        </span>
      </footer>
    </dialog>
  )
}
