/// <reference types="vite/client" />
import type { ReactNode } from 'react'
import { Outlet, createRootRoute, HeadContent, Scripts } from '@tanstack/react-router'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { ThemeProvider, themeInitScript } from '@synek/ui'
import { Toaster } from '~/components/ui/sonner'
import '@xyflow/react/dist/style.css'
import '../styles.css'

// Single-user, local-first: a module-level client is fine.
const queryClient = new QueryClient()

export const Route = createRootRoute({
  head: () => ({
    meta: [
      { charSet: 'utf-8' },
      { name: 'viewport', content: 'width=device-width, initial-scale=1' },
      { title: 'Synek' },
    ],
    links: [{ rel: 'icon', type: 'image/svg+xml', href: '/favicon.svg' }],
  }),
  component: RootComponent,
})

function RootComponent() {
  return (
    <QueryClientProvider client={queryClient}>
      <ThemeProvider>
        <RootDocument>
          <Outlet />
        </RootDocument>
      </ThemeProvider>
    </QueryClientProvider>
  )
}

function RootDocument({ children }: Readonly<{ children: ReactNode }>) {
  return (
    <html lang="en">
      <head>
        {/* Pre-hydration: read cookie + prefers-color-scheme, set <html data-theme>
            synchronously before first paint so the page never flashes the wrong theme.
            Must render in <head> (not via <Scripts/>) — runs before body parses. */}
        <script dangerouslySetInnerHTML={{ __html: themeInitScript }} />
        <HeadContent />
      </head>
      <body>
        {children}
        <Toaster />
        <Scripts />
      </body>
    </html>
  )
}
