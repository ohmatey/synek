import type { PovType } from './types'

// Human labels for a story's POV — shown wherever it's surfaced (the reader cover,
// the Stories-view card) but only when it's not the default omniscient voice.
export const POV_LABEL: Record<PovType, string> = {
  omniscient: 'Omniscient',
  first_person: 'First person',
  witness: 'Witness',
  diary: 'Diary',
}
