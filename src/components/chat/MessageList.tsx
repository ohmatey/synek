import type { UIMessage } from 'ai'

export function MessageList({ messages }: { messages: UIMessage[] }) {
  if (messages.length === 0) {
    return (
      <div className="messages">
        <div className="message message-assistant">
          Describe an industry or field and I’ll build a timeline of how it evolved — the events, the
          players, and the relationships between them.
        </div>
      </div>
    )
  }

  return (
    <div className="messages">
      {messages.map((m) => (
        <div key={m.id} className={`message message-${m.role}`}>
          {m.parts.map((part, i) => {
            if (part.type === 'text') return <span key={i}>{part.text}</span>
            // Attachments: inline image thumbnails, or a chip for documents.
            if (part.type === 'file') {
              return part.mediaType.startsWith('image/') ? (
                <img key={i} className="msg-image" src={part.url} alt={part.filename ?? 'attachment'} />
              ) : (
                <span key={i} className="msg-file">
                  📄 {part.filename ?? 'file'}
                </span>
              )
            }
            // Surface tool calls as small chips so the build is legible as it happens.
            if (part.type.startsWith('tool-')) {
              return (
                <span key={i} className="tool-chip">
                  {part.type.slice('tool-'.length)}
                </span>
              )
            }
            return null
          })}
        </div>
      ))}
    </div>
  )
}
