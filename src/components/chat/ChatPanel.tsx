import { useEffect, useMemo, useRef, useState, type ChangeEvent } from 'react'
import { useChat } from '@ai-sdk/react'
import { DefaultChatTransport, type UIMessage } from 'ai'
import { useNavigate } from '@tanstack/react-router'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { MessageList } from './MessageList'
import { getMessages } from '~/lib/server/messages'
import { listSessions, createSession, deleteSession } from '~/lib/server/sessions'
import { useBuildStream, type PendingNode } from '~/components/canvas/build-stream'
import { parseDate } from '~/lib/domain/dates'
import { filesToParts } from '~/lib/files'
import { takeAttachments } from '~/lib/pending-attachments'
import type { StoredMessage } from '~/lib/db/messages'
import type { ChatSessionSummary, NodeType, Precision } from '~/lib/domain/types'

const ACCEPT = 'image/*,.pdf,.txt,.md,.csv,.json'

export function ChatPanel({ timelineId, initialPrompt }: { timelineId: string; initialPrompt?: string }) {
  const queryClient = useQueryClient()
  // The timeline's chat threads. "New chat" adds one; History switches between them.
  const { data: sessions } = useQuery({
    queryKey: ['sessions', timelineId],
    queryFn: () => listSessions({ data: timelineId }),
  })
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null)
  const [historyOpen, setHistoryOpen] = useState(false)
  const creating = useRef(false)
  const headerRef = useRef<HTMLElement>(null)

  // Dismiss the History popover on outside-click or Escape.
  useEffect(() => {
    if (!historyOpen) return
    const onDown = (e: MouseEvent) => {
      if (headerRef.current && !headerRef.current.contains(e.target as Node)) setHistoryOpen(false)
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setHistoryOpen(false)
    }
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [historyOpen])

  // Bootstrap: default to the latest thread, or create the first one (also covers
  // a freshly-created timeline arriving from the home prompt bar).
  useEffect(() => {
    if (activeSessionId || !sessions) return
    if (sessions.length > 0) {
      setActiveSessionId(sessions[0].id)
      return
    }
    if (creating.current) return
    creating.current = true
    void (async () => {
      const created = await createSession({ data: { timelineId } })
      await queryClient.invalidateQueries({ queryKey: ['sessions', timelineId] })
      setActiveSessionId(created.id)
      creating.current = false
    })()
  }, [activeSessionId, sessions, timelineId, queryClient])

  async function newChat() {
    setHistoryOpen(false)
    const created = await createSession({ data: { timelineId } })
    await queryClient.invalidateQueries({ queryKey: ['sessions', timelineId] })
    setActiveSessionId(created.id)
  }

  async function removeSession(id: string) {
    await deleteSession({ data: id })
    await queryClient.invalidateQueries({ queryKey: ['sessions', timelineId] })
    // Drop selection if we deleted the open thread — bootstrap re-picks or recreates.
    if (id === activeSessionId) setActiveSessionId(null)
  }

  const activeTitle = sessions?.find((s) => s.id === activeSessionId)?.title ?? 'New conversation'

  return (
    <div className="chat">
      <header className="chat-header" ref={headerRef}>
        <div className="chat-bar">
          <span className="chat-bar-title" title={activeTitle}>
            {activeTitle}
          </span>
          <div className="chat-bar-actions">
            <button type="button" className="chat-bar-btn" onClick={() => void newChat()} title="Start a new chat">
              + New chat
            </button>
            <button
              type="button"
              className="chat-bar-btn"
              onClick={() => setHistoryOpen((v) => !v)}
              aria-expanded={historyOpen}
              title="Chat history"
            >
              History ▾
            </button>
          </div>
        </div>
        {historyOpen && (
          <SessionHistory
            sessions={sessions ?? []}
            activeId={activeSessionId}
            onPick={(id) => {
              setActiveSessionId(id)
              setHistoryOpen(false)
            }}
            onDelete={(id) => void removeSession(id)}
          />
        )}
      </header>
      {activeSessionId ? (
        <Thread key={activeSessionId} timelineId={timelineId} sessionId={activeSessionId} initialPrompt={initialPrompt} />
      ) : (
        <div className="messages">
          <div className="message message-assistant">Loading conversation…</div>
        </div>
      )}
    </div>
  )
}

function SessionHistory({
  sessions,
  activeId,
  onPick,
  onDelete,
}: {
  sessions: ChatSessionSummary[]
  activeId: string | null
  onPick: (id: string) => void
  onDelete: (id: string) => void
}) {
  return (
    <div className="chat-history" role="menu">
      {sessions.length === 0 ? (
        <div className="chat-history-empty">No conversations yet.</div>
      ) : (
        sessions.map((s) => (
          <div key={s.id} className={`chat-history-row${s.id === activeId ? ' is-active' : ''}`}>
            <button type="button" className="chat-history-open" onClick={() => onPick(s.id)} role="menuitem">
              <span className="chat-history-title">{s.title}</span>
              <span className="chat-history-date">{new Date(s.updatedAt).toLocaleDateString()}</span>
            </button>
            <button
              type="button"
              className="chat-history-del"
              onClick={() => onDelete(s.id)}
              aria-label={`Delete ${s.title}`}
              title="Delete conversation"
            >
              ✕
            </button>
          </div>
        ))
      )}
    </div>
  )
}

// Gate render until the thread's transcript is loaded, so useChat initializes
// with the right messages (it reads them once). Keyed by sessionId in the parent.
function Thread({
  timelineId,
  sessionId,
  initialPrompt,
}: {
  timelineId: string
  sessionId: string
  initialPrompt?: string
}) {
  const { data: initial } = useQuery({
    queryKey: ['messages', sessionId],
    queryFn: () => getMessages({ data: sessionId }),
  })
  if (initial === undefined) {
    return (
      <div className="messages">
        <div className="message message-assistant">Loading conversation…</div>
      </div>
    )
  }
  return <ChatThread timelineId={timelineId} sessionId={sessionId} initial={initial} initialPrompt={initialPrompt} />
}

function ChatThread({
  timelineId,
  sessionId,
  initial,
  initialPrompt,
}: {
  timelineId: string
  sessionId: string
  initial: StoredMessage[]
  initialPrompt?: string
}) {
  const [input, setInput] = useState('')
  const [files, setFiles] = useState<File[]>([])
  const fileRef = useRef<HTMLInputElement>(null)
  const queryClient = useQueryClient()
  const navigate = useNavigate()
  const { setPending, setFocusIds } = useBuildStream()
  // Carry timelineId + the thread's sessionId on every request so turns hit the
  // timeline you're viewing and persist against the open thread.
  const transport = useMemo(
    () => new DefaultChatTransport({ api: '/api/chat', body: { timelineId, sessionId } }),
    [timelineId, sessionId],
  )

  const { messages, sendMessage, status, error, regenerate, clearError } = useChat({
    id: sessionId,
    messages: initial as UIMessage[],
    transport,
    onFinish: async () => {
      // Real nodes are in the DB now — refetch, then drop the optimistic overlay
      // (await so the real nodes land before the pending ones disappear).
      await queryClient.invalidateQueries({ queryKey: ['graph', timelineId] })
      setPending([])
      // Mark the persisted transcript stale so a later remount reloads it, and
      // refresh the thread list (a new turn can rename/reorder the open thread).
      void queryClient.invalidateQueries({ queryKey: ['messages', sessionId] })
      void queryClient.invalidateQueries({ queryKey: ['sessions', timelineId] })
    },
  })

  const busy = status === 'submitted' || status === 'streaming'

  // While the AI streams, surface its in-flight add_node calls so nodes appear
  // on the canvas as they're placed (the overlay clears on finish/unmount).
  useEffect(() => {
    if (status !== 'streaming' && status !== 'submitted') return
    const last = messages[messages.length - 1]
    if (!last || last.role !== 'assistant') return
    const next: PendingNode[] = []
    for (const part of last.parts) {
      const p = part as unknown as {
        type: string
        state?: string
        toolCallId?: string
        input?: { type?: NodeType; title?: string; start?: string; end?: string; precision?: Precision }
      }
      if (p.type !== 'tool-add_node') continue
      if (p.state !== 'input-available' && p.state !== 'output-available') continue
      const input = p.input
      if (!input?.title || !input?.start || !input?.type) continue
      const s = parseDate(input.start)
      next.push({
        key: p.toolCallId ?? `${last.id}:${next.length}`,
        type: input.type,
        title: input.title,
        startInstant: s.instant,
        endInstant: input.end ? parseDate(input.end).instant : null,
        precision: input.precision ?? s.precision,
      })
    }
    setPending(next)
  }, [messages, status, setPending])

  // Clear the overlay if the thread unmounts mid-stream (e.g. switching threads).
  useEffect(() => () => setPending([]), [setPending])

  // Lens: mirror the latest answer's `focus` tool call onto the canvas. Derives
  // from the most recent assistant message, so a build turn (no focus) clears it.
  useEffect(() => {
    let lastAssistant: UIMessage | undefined
    for (let i = messages.length - 1; i >= 0; i--) {
      if (messages[i]!.role === 'assistant') {
        lastAssistant = messages[i]
        break
      }
    }
    const ids: string[] = []
    for (const part of lastAssistant?.parts ?? []) {
      const p = part as unknown as { type: string; input?: { ids?: string[] } }
      if (p.type === 'tool-focus' && Array.isArray(p.input?.ids)) ids.push(...p.input.ids)
    }
    setFocusIds(ids)
  }, [messages, setFocusIds])

  useEffect(() => () => setFocusIds([]), [setFocusIds])

  // If the home page kicked this off with a prompt, send it once on a fresh
  // thread, then drop ?prompt so a reload doesn't resend it.
  const autoSent = useRef(false)
  useEffect(() => {
    if (autoSent.current || !initialPrompt || initial.length > 0) return
    autoSent.current = true
    const files = takeAttachments(timelineId) // stashed by the home prompt bar
    void sendMessage(files?.length ? { text: initialPrompt, files } : { text: initialPrompt })
    void navigate({ to: '/timelines/$id', params: { id: timelineId }, search: {}, replace: true })
  }, [initialPrompt, initial.length, sendMessage, navigate, timelineId])

  function onPickFiles(e: ChangeEvent<HTMLInputElement>) {
    const picked = Array.from(e.target.files ?? [])
    if (picked.length) setFiles((fs) => [...fs, ...picked])
    e.target.value = '' // let the same file be picked again
  }

  async function send() {
    const text = input.trim()
    if ((!text && files.length === 0) || busy) return
    const fileParts = files.length ? await filesToParts(files) : undefined
    setInput('')
    setFiles([])
    void sendMessage(fileParts ? { text, files: fileParts } : { text })
  }

  return (
    <>
      <MessageList messages={messages} />
      {busy && (
        <div className="chat-status" aria-live="polite">
          <span className="chat-spinner" aria-hidden />
          {status === 'submitted' ? 'Thinking…' : 'Building the timeline…'}
        </div>
      )}
      {status === 'error' && (
        <div className="chat-error" role="alert">
          <span className="chat-error-msg">
            {error?.message || 'That turn failed — check your connection or OPENROUTER_API_KEY, then retry.'}
          </span>
          <div className="chat-error-actions">
            <button type="button" onClick={() => void regenerate()}>
              Retry
            </button>
            <button type="button" onClick={() => clearError()}>
              Dismiss
            </button>
          </div>
        </div>
      )}
      {files.length > 0 && (
        <div className="chat-attachments">
          {files.map((f, i) => (
            <span className="chat-attachment" key={`${f.name}:${i}`}>
              <span className="chat-attachment-name">
                {f.type.startsWith('image/') ? '🖼' : '📄'} {f.name}
              </span>
              <button
                type="button"
                className="chat-attachment-remove"
                onClick={() => setFiles((fs) => fs.filter((_, j) => j !== i))}
                aria-label={`Remove ${f.name}`}
              >
                ✕
              </button>
            </span>
          ))}
        </div>
      )}
      <form
        className="chat-form"
        onSubmit={(e) => {
          e.preventDefault()
          void send()
        }}
      >
        <input ref={fileRef} type="file" multiple accept={ACCEPT} className="chat-file-input" onChange={onPickFiles} />
        <button
          type="button"
          className="chat-attach"
          onClick={() => fileRef.current?.click()}
          title="Attach images or documents"
          aria-label="Attach files"
          disabled={busy}
        >
          📎
        </button>
        <textarea
          className="chat-input"
          rows={1}
          placeholder="Try: map the history of observability tooling…"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault()
              void send()
            }
          }}
        />
        <button className="chat-send" type="submit" disabled={busy || (!input.trim() && files.length === 0)}>
          {busy ? '…' : 'Send'}
        </button>
      </form>
    </>
  )
}
