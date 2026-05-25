import { useEffect, useMemo, useRef, useState, type ChangeEvent } from 'react'
import { useChat } from '@ai-sdk/react'
import { DefaultChatTransport, type UIMessage } from 'ai'
import { useNavigate } from '@tanstack/react-router'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { MessageList } from './MessageList'
import { getMessages } from '~/lib/server/messages'
import { useBuildStream, type PendingNode } from '~/components/canvas/build-stream'
import { parseDate } from '~/lib/domain/dates'
import { filesToParts } from '~/lib/files'
import { takeAttachments } from '~/lib/pending-attachments'
import type { StoredMessage } from '~/lib/db/messages'
import type { NodeType, Precision } from '~/lib/domain/types'

const ACCEPT = 'image/*,.pdf,.txt,.md,.csv,.json'

export function ChatPanel({ timelineId, initialPrompt }: { timelineId: string; initialPrompt?: string }) {
  // Seed the thread from the persisted transcript. Gate render until it's
  // loaded so useChat initializes with the right messages (it reads them once).
  const { data: initial } = useQuery({
    queryKey: ['messages', timelineId],
    queryFn: () => getMessages({ data: timelineId }),
  })

  return (
    <div className="chat">
      <header className="chat-header">
        <h1 className="chat-title">Strata</h1>
        <span className="chat-sub">timeline: {timelineId}</span>
      </header>
      {initial === undefined ? (
        <div className="messages">
          <div className="message message-assistant">Loading conversation…</div>
        </div>
      ) : (
        <ChatThread key={timelineId} timelineId={timelineId} initial={initial} initialPrompt={initialPrompt} />
      )}
    </div>
  )
}

function ChatThread({
  timelineId,
  initial,
  initialPrompt,
}: {
  timelineId: string
  initial: StoredMessage[]
  initialPrompt?: string
}) {
  const [input, setInput] = useState('')
  const [files, setFiles] = useState<File[]>([])
  const fileRef = useRef<HTMLInputElement>(null)
  const queryClient = useQueryClient()
  const navigate = useNavigate()
  const { setPending, setFocusIds } = useBuildStream()
  // Carry timelineId on every request so turns hit the timeline you're viewing
  // (not the 'default' fallback) and persist against it.
  const transport = useMemo(
    () => new DefaultChatTransport({ api: '/api/chat', body: { timelineId } }),
    [timelineId],
  )

  const { messages, sendMessage, status, error, regenerate, clearError } = useChat({
    id: timelineId,
    messages: initial as UIMessage[],
    transport,
    onFinish: async () => {
      // Real nodes are in the DB now — refetch, then drop the optimistic overlay
      // (await so the real nodes land before the pending ones disappear).
      await queryClient.invalidateQueries({ queryKey: ['graph', timelineId] })
      setPending([])
      // Mark the persisted transcript stale so a later remount reloads it.
      void queryClient.invalidateQueries({ queryKey: ['messages', timelineId] })
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

  // Clear the overlay if the thread unmounts mid-stream (e.g. switching timelines).
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
  // timeline, then drop ?prompt so a reload doesn't resend it.
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
          rows={2}
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
