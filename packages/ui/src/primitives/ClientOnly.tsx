import { useEffect, useState, type ReactNode } from 'react'

/**
 * Renders children only after mount — for client-only libs (React Flow, etc.)
 * whose modules touch `window` and would crash under SSR.
 */
export function ClientOnly({
  children,
  fallback = null,
}: {
  children: ReactNode
  fallback?: ReactNode
}) {
  const [mounted, setMounted] = useState(false)
  useEffect(() => {
    setMounted(true)
  }, [])
  return <>{mounted ? children : fallback}</>
}
