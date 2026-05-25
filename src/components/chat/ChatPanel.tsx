import { useState } from 'react'
import { MessageList } from './MessageList'

export function ChatPanel({ timelineId }: { timelineId: string }) {
  const [input, setInput] = useState('')

  return (
    <div className="chat">
      <header className="chat-header">
        <h1 className="chat-title">Strata</h1>
        <span className="chat-sub">timeline: {timelineId}</span>
      </header>

      <MessageList />

      <form
        className="chat-form"
        onSubmit={(e) => {
          e.preventDefault()
          // Phase 0: POST to /api/chat (streamText + tools), then refetch the graph.
        }}
      >
        <textarea
          className="chat-input"
          rows={2}
          placeholder="Try: map the history of observability tooling…"
          value={input}
          onChange={(e) => setInput(e.target.value)}
        />
        <button className="chat-send" type="submit" disabled>
          Send
        </button>
      </form>
      <p className="chat-note">AI wiring lands in Phase 0 — this is the shell.</p>
    </div>
  )
}
