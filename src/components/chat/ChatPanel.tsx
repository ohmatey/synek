import { useState } from 'react'
import { useChat } from '@ai-sdk/react'
import { useQueryClient } from '@tanstack/react-query'
import { MessageList } from './MessageList'

export function ChatPanel({ timelineId }: { timelineId: string }) {
  const [input, setInput] = useState('')
  const queryClient = useQueryClient()

  const { messages, sendMessage, status } = useChat({
    onFinish: () => {
      // The turn's tool calls have committed to the DB — refetch the canvas graph.
      void queryClient.invalidateQueries({ queryKey: ['graph', timelineId] })
    },
  })

  const busy = status === 'submitted' || status === 'streaming'

  function send() {
    const text = input.trim()
    if (!text || busy) return
    void sendMessage({ text })
    setInput('')
  }

  return (
    <div className="chat">
      <header className="chat-header">
        <h1 className="chat-title">Strata</h1>
        <span className="chat-sub">timeline: {timelineId}</span>
      </header>

      <MessageList messages={messages} />

      <form
        className="chat-form"
        onSubmit={(e) => {
          e.preventDefault()
          send()
        }}
      >
        <textarea
          className="chat-input"
          rows={2}
          placeholder="Try: map the history of observability tooling…"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault()
              send()
            }
          }}
        />
        <button className="chat-send" type="submit" disabled={busy || !input.trim()}>
          {busy ? '…' : 'Send'}
        </button>
      </form>
    </div>
  )
}
