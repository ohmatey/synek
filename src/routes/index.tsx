import { createFileRoute, redirect } from '@tanstack/react-router'

// Multi-timeline + a real home land in Phase 1. For now, open the default timeline.
export const Route = createFileRoute('/')({
  beforeLoad: () => {
    throw redirect({ to: '/timelines/$id', params: { id: 'default' } })
  },
})
