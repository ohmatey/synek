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
  // Whether the chat sidebar is shown. Toggled from the canvas toolbar; the
  // route shell reads it to slide the chat pane in/out.
  chatOpen: boolean
  setChatOpen: (open: boolean) => void
}

const Ctx = createContext<BuildStream>({
  pending: [],
  setPending: () => {},
  focusIds: [],
  setFocusIds: () => {},
  chatOpen: true,
  setChatOpen: () => {},
})

export function BuildStreamProvider({ children }: { children: ReactNode }) {
  const [pending, setPending] = useState<PendingNode[]>([])
  const [focusIds, setFocusIds] = useState<string[]>([])
  const [chatOpen, setChatOpen] = useState(true)
  return (
    <Ctx.Provider value={{ pending, setPending, focusIds, setFocusIds, chatOpen, setChatOpen }}>{children}</Ctx.Provider>
  )
}

export const useBuildStream = () => useContext(Ctx)
