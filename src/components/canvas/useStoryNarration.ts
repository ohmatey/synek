import { useEffect, useRef, useState, useSyncExternalStore } from 'react'
import type { StoryBeat } from '~/lib/domain/types'

// Browser Web Speech API narration for the story reader. No deps, no server —
// `window.speechSynthesis` is a built-in. Speech is OPTIONAL (opt-in) and, when
// on, becomes the auto-advance timer (the reader steps when the utterance ends).

// Voice names that signal a modern neural/premium engine (varies by browser/OS).
const PREMIUM_VOICE = /natural|neural|premium|enhanced|samantha|ava|allison|serena|aria|jenny|google|siri|daniel|karen|moira|tessa/i

// --- Narration preferences (device-global) --------------------------------
// Voice/rate/pitch are device-specific (available voices differ per machine), so
// they live in their own localStorage key — NOT the per-timeline ScalePref — and
// in a tiny pub/sub store so the settings menu and an in-flight reader stay synced.
export type NarrationPrefs = {
  // null = auto-pick the best available voice; otherwise a SpeechSynthesisVoice.voiceURI.
  voiceURI: string | null
  rate: number
  pitch: number
}

// A touch slower than 1.0 reads warmer and less clipped than the engine default.
export const DEFAULT_NARRATION_PREFS: NarrationPrefs = { voiceURI: null, rate: 0.95, pitch: 1.0 }
export const NARRATION_RATE_RANGE = { min: 0.6, max: 1.4, step: 0.05 } as const
export const NARRATION_PITCH_RANGE = { min: 0.6, max: 1.4, step: 0.05 } as const

const NARRATION_KEY = 'synek:narration'
const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n))

function loadNarrationPrefs(): NarrationPrefs {
  if (typeof window === 'undefined') return DEFAULT_NARRATION_PREFS
  try {
    const raw = window.localStorage.getItem(NARRATION_KEY)
    if (!raw) return DEFAULT_NARRATION_PREFS
    const p = JSON.parse(raw) as Partial<NarrationPrefs>
    return {
      voiceURI: typeof p.voiceURI === 'string' ? p.voiceURI : null,
      rate: typeof p.rate === 'number' ? clamp(p.rate, NARRATION_RATE_RANGE.min, NARRATION_RATE_RANGE.max) : DEFAULT_NARRATION_PREFS.rate,
      pitch: typeof p.pitch === 'number' ? clamp(p.pitch, NARRATION_PITCH_RANGE.min, NARRATION_PITCH_RANGE.max) : DEFAULT_NARRATION_PREFS.pitch,
    }
  } catch {
    return DEFAULT_NARRATION_PREFS
  }
}

// Lazily seeded once per client bundle; getSnapshot must return a stable ref.
let prefsStore: NarrationPrefs = loadNarrationPrefs()
const prefsListeners = new Set<() => void>()

function emitPrefs() {
  for (const l of prefsListeners) l()
}

export function updateNarrationPrefs(patch: Partial<NarrationPrefs>): void {
  prefsStore = { ...prefsStore, ...patch }
  if (typeof window !== 'undefined') {
    try {
      window.localStorage.setItem(NARRATION_KEY, JSON.stringify(prefsStore))
    } catch {
      // ignore quota / disabled storage
    }
  }
  emitPrefs()
}

// Subscribe to the device-global narration prefs. Returns [prefs, update].
export function useNarrationPrefs(): [NarrationPrefs, (patch: Partial<NarrationPrefs>) => void] {
  const prefs = useSyncExternalStore(
    (cb) => {
      prefsListeners.add(cb)
      return () => prefsListeners.delete(cb)
    },
    () => prefsStore,
    () => DEFAULT_NARRATION_PREFS,
  )
  return [prefs, updateNarrationPrefs]
}

// --- Voice list + selection ------------------------------------------------

// Cached auto-pick, invalidated when the voice list changes (it loads async).
let cachedAutoVoice: SpeechSynthesisVoice | null = null
let cachedSignature = ''

// Best-available narration voice when the user hasn't chosen one. Prefers
// English, then modern/premium names, then LOCAL voices (network voices buffer
// and sound choppy), then the platform default.
function autoSelectVoice(voices: SpeechSynthesisVoice[]): SpeechSynthesisVoice | null {
  if (!voices.length) return null
  const signature = voices.map((v) => v.voiceURI).join('|')
  if (signature === cachedSignature && cachedAutoVoice) return cachedAutoVoice
  cachedSignature = signature

  const en = voices.filter((v) => v.lang.toLowerCase().startsWith('en'))
  const pool = en.length ? en : voices
  const score = (v: SpeechSynthesisVoice) => {
    let s = 0
    if (PREMIUM_VOICE.test(v.name)) s += 10
    if (v.localService) s += 3 // local = no network buffering / choppiness
    if (/en[-_]us/i.test(v.lang)) s += 1
    if (v.default) s += 1
    return s
  }
  cachedAutoVoice = pool.slice().sort((a, b) => score(b) - score(a))[0] ?? null
  return cachedAutoVoice
}

// Resolve the voice to speak with: the user's chosen voice if still present,
// else the auto pick. Returns null before voices load → engine uses its default.
export function resolveNarrationVoice(prefs: NarrationPrefs): SpeechSynthesisVoice | null {
  if (typeof window === 'undefined' || !('speechSynthesis' in window)) return null
  const voices = window.speechSynthesis.getVoices()
  if (!voices.length) return null
  if (prefs.voiceURI) {
    const chosen = voices.find((v) => v.voiceURI === prefs.voiceURI)
    if (chosen) return chosen
  }
  return autoSelectVoice(voices)
}

// Live list of available voices (loads async; refreshes on 'voiceschanged'),
// sorted English-first then alphabetically for the settings menu.
export function useNarrationVoices(): SpeechSynthesisVoice[] {
  const [voices, setVoices] = useState<SpeechSynthesisVoice[]>([])
  useEffect(() => {
    if (typeof window === 'undefined' || !('speechSynthesis' in window)) return
    const synth = window.speechSynthesis
    const update = () => {
      const next = synth.getVoices().slice().sort((a, b) => {
        const aEn = a.lang.toLowerCase().startsWith('en') ? 0 : 1
        const bEn = b.lang.toLowerCase().startsWith('en') ? 0 : 1
        return aEn - bEn || a.name.localeCompare(b.name)
      })
      setVoices(next)
    }
    update()
    synth.addEventListener('voiceschanged', update)
    return () => synth.removeEventListener('voiceschanged', update)
  }, [])
  return voices
}

// --- Support flag + gesture unlock ----------------------------------------

// True only on the client where SpeechSynthesis exists. Mounted-guarded so SSR
// renders `false` and the first client render matches (no hydration mismatch),
// flipping to the real value after mount. Also primes the async voice list so a
// good voice is ready by the time the first beat speaks.
export function useSpeechSupported(): boolean {
  const [supported, setSupported] = useState(false)
  useEffect(() => {
    const ok = typeof window !== 'undefined' && 'speechSynthesis' in window
    setSupported(ok)
    if (!ok) return
    const synth = window.speechSynthesis
    // Kick the async load + refresh the auto-pick cache when voices arrive (Chrome
    // populates getVoices() only after the first call + a 'voiceschanged' event).
    synth.getVoices()
    const refresh = () => synth.getVoices()
    synth.addEventListener('voiceschanged', refresh)
    return () => synth.removeEventListener('voiceschanged', refresh)
  }, [])
  return supported
}

// iOS Safari only allows speech that originates from a user gesture. The first
// beat's utterance is created in an effect (not a click), so it can be blocked —
// call this from the gestures that begin/enable narration (cover Play, speak-on
// toggles) to unlock the queue. Best-effort: a no-op resume is enough to prime it.
export function warmUpSpeech(): void {
  if (typeof window === 'undefined' || !('speechSynthesis' in window)) return
  try {
    window.speechSynthesis.resume()
  } catch {
    // ignore — narration simply stays gesture-gated on this platform
  }
}

// Speak a one-line sample with the current voice/rate/pitch — backs the settings
// menu "Preview" button so the user can audition a change without playing a story.
const SAMPLE_LINE = 'The canvas remembers everything, one beat at a time.'
export function speakNarrationSample(prefs: NarrationPrefs, text: string = SAMPLE_LINE): void {
  if (typeof window === 'undefined' || !('speechSynthesis' in window)) return
  const synth = window.speechSynthesis
  synth.cancel()
  const utterance = new SpeechSynthesisUtterance(text)
  const voice = resolveNarrationVoice(prefs)
  if (voice) utterance.voice = voice
  utterance.rate = prefs.rate
  utterance.pitch = prefs.pitch
  synth.speak(utterance)
}

// --- Reader narration driver ----------------------------------------------

// What we read aloud per beat: the scene-setting note (if any) then the body,
// matching what's shown on screen — e.g. "Rain on cobblestones. The general
// crossed the river."
function beatSpeech(beat: StoryBeat): string {
  return [beat.settingNote, beat.bodyText].filter(Boolean).join('. ').trim()
}

// Drive narration for the active beat. When `speak` is on and supported, speaks
// the current beat on entry and calls `onAdvance` when the utterance finishes
// naturally (the reader uses this instead of its CSS-timer advance). `paused`,
// `onAdvance` and the device prefs are held in refs so toggling pause / changing
// a setting mid-beat doesn't restart the current utterance (it applies next beat).
export function useStoryNarration({
  beat,
  started,
  speak,
  paused,
  reduced,
  supported,
  onAdvance,
}: {
  beat: StoryBeat | undefined
  started: boolean
  speak: boolean
  paused: boolean
  reduced: boolean
  supported: boolean
  onAdvance: () => void
}): void {
  const [prefs] = useNarrationPrefs()
  const pausedRef = useRef(paused)
  pausedRef.current = paused
  const onAdvanceRef = useRef(onAdvance)
  onAdvanceRef.current = onAdvance
  const prefsRef = useRef(prefs)
  prefsRef.current = prefs

  const active = started && speak && supported && !!beat
  const beatId = beat?.id

  // Speak the active beat. Re-fires when the beat changes (or narration toggles
  // on); cleanup cancels any in-flight speech so a manual step / close / unmount
  // doesn't bleed audio. NOT keyed on `paused`/`prefs` — pause/resume is handled
  // below and a settings change applies to the next beat (or via Preview).
  useEffect(() => {
    if (!active || !beat) return
    const synth = window.speechSynthesis
    const utterance = new SpeechSynthesisUtterance(beatSpeech(beat))
    const voice = resolveNarrationVoice(prefsRef.current)
    if (voice) utterance.voice = voice
    utterance.rate = prefsRef.current.rate
    utterance.pitch = prefsRef.current.pitch
    let cancelled = false
    utterance.onend = () => {
      // Natural end → advance, but never when reduced-motion is set (those users
      // opted out of timed auto-advance; they step manually and hear each beat).
      if (!cancelled && !reduced) onAdvanceRef.current()
    }
    synth.cancel()
    synth.speak(utterance)
    // Honor a pause that was already active when this beat began.
    if (pausedRef.current) synth.pause()
    // Chrome silently stops a single utterance after ~15s; a periodic no-op
    // pause/resume while it's still speaking resets that timer so long beats
    // don't cut off mid-sentence. Skipped while the user has it paused.
    const keepAlive = setInterval(() => {
      if (synth.speaking && !pausedRef.current) {
        synth.pause()
        synth.resume()
      }
    }, 12_000)
    return () => {
      cancelled = true
      clearInterval(keepAlive)
      synth.cancel()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active, beatId, reduced])

  // Pause/resume the current utterance to match the reader's pause state without
  // restarting it. resume()/pause() on an idle queue is a harmless no-op.
  useEffect(() => {
    if (!active) return
    const synth = window.speechSynthesis
    if (paused) synth.pause()
    else synth.resume()
  }, [active, paused])
}
