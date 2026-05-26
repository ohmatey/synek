import type { Page } from '@playwright/test'

// Mock the only AI endpoint (/api/chat) so e2e needs no API key and is
// deterministic. The real route returns an AI SDK v6 UI-message-stream (SSE);
// we fulfill a minimal valid one the @ai-sdk/react useChat client can parse.
//
// ⚠️ The chunk shape + the `x-vercel-ai-ui-message-stream` header are
// version-sensitive (AI SDK 6). If useChat ever stops rendering the mocked
// text, diff a real toUIMessageStreamResponse() body and adjust here.

function sseBody(chunks: object[]): string {
  const lines = chunks.map((c) => `data: ${JSON.stringify(c)}\n\n`)
  lines.push('data: [DONE]\n\n')
  return lines.join('')
}

export async function mockChatSuccess(page: Page, text = 'Done — added to the timeline.') {
  await page.route('**/api/chat', async (route) => {
    await route.fulfill({
      status: 200,
      headers: {
        'content-type': 'text/event-stream',
        'x-vercel-ai-ui-message-stream': 'v1',
      },
      body: sseBody([
        { type: 'start' },
        { type: 'text-start', id: '0' },
        { type: 'text-delta', id: '0', delta: text },
        { type: 'text-end', id: '0' },
        { type: 'finish' },
      ]),
    })
  })
}

export async function mockChatError(page: Page, error = 'Set OPENROUTER_API_KEY to chat.') {
  await page.route('**/api/chat', async (route) => {
    await route.fulfill({
      status: 400,
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ error }),
    })
  })
}
