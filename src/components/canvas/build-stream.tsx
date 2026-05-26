import { createContext, useContext, useState, type ReactNode } from 'react'
import type { NodeType, Precision } from '~/lib/domain/types'

// An optimistic node placement (kept for compatibility with the canvas layout,
// which can overlay nodes before a refetch). No longer driven by a chat stream.
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
  // Node ids to lens on (the canvas dims the rest). Empty = no lens.
  focusIds: string[]
  setFocusIds: (ids: string[]) => void
}

const Ctx = createContext<BuildStream>({
  pending: [],
  setPending: () => {},
  focusIds: [],
  setFocusIds: () => {},
})

export function BuildStreamProvider({ children }: { children: ReactNode }) {
  const [pending, setPending] = useState<PendingNode[]>([])
  const [focusIds, setFocusIds] = useState<string[]>([])
  return <Ctx.Provider value={{ pending, setPending, focusIds, setFocusIds }}>{children}</Ctx.Provider>
}

export const useBuildStream = () => useContext(Ctx)
