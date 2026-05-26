import { createFileRoute } from '@tanstack/react-router'
import { auth } from '~/lib/auth'

// Better Auth's fetch-native handler, mounted as a catch-all under /api/auth/*.
export const Route = createFileRoute('/api/auth/$')({
  server: {
    handlers: {
      GET: ({ request }) => auth.handler(request),
      POST: ({ request }) => auth.handler(request),
    },
  },
})
