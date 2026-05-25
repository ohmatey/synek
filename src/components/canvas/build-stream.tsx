import { createContext, useContext, useState, type ReactNode } from 'react'
import type { NodeType, Precision } from '~/lib/domain/types'

// A node the AI is placing *right now*, parsed from a streaming add_node tool
// call before the turn commits. Keyed by toolCallId. Lives in route-level
// context so the chat (which owns the stream) can hand it to the canvas.
export type PendingNode = {
  key: string
  type: NodeType
  title: string
  startInstant: number
  endInstant: number | null
  precision: Precision
}

type BuildStream = {
  pending: PendingNode[]
  setPending: (p: PendingNode[]) => void
  // Node ids the AI flagged as relevant to its latest answer — the canvas lenses
  // to these (dims the rest). Empty = no lens.
  focusIds: string[]
  setFocusIds: (ids: string[]) => void
}

const Ctx = createContext<BuildStream>({ pending: [], setPending: () => {}, focusIds: [], setFocusIds: () => {} })

export function BuildStreamProvider({ children }: { children: ReactNode }) {
  const [pending, setPending] = useState<PendingNode[]>([])
  const [focusIds, setFocusIds] = useState<string[]>([])
  return <Ctx.Provider value={{ pending, setPending, focusIds, setFocusIds }}>{children}</Ctx.Provider>
}

export const useBuildStream = () => useContext(Ctx)
