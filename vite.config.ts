import { defineConfig, type PluginOption } from 'vite'
import { tanstackStart } from '@tanstack/react-start/plugin/vite'
import viteReact from '@vitejs/plugin-react'
import tsconfigPaths from 'vite-tsconfig-paths'
import tailwindcss from '@tailwindcss/vite'

// Dev-only fix for the TanStack Start client entry not hydrating under `vite dev`.
// The SSR HTML emits `<script src="/@id/virtual:tanstack-start-client-entry">`, but
// on a cold dev server that raw id 404s (a Vite 7 + filter-based virtual-module
// resolution quirk in the pinned Start version) — so the client bundle never boots
// and the page is stuck pre-hydration. The `\0`-encoded form (`__x00__…`) DOES
// resolve, so rewrite the raw request to it. No effect on build.
function fixStartClientEntryDev(): PluginOption {
  const RAW = '/@id/virtual:tanstack-start-client-entry'
  const ENCODED = '/@id/__x00__virtual:tanstack-start-client-entry'
  return {
    name: 'synek:fix-start-client-entry-dev',
    apply: 'serve',
    configureServer(server) {
      server.middlewares.use((req, _res, next) => {
        if (req.url) {
          if (req.url === RAW) req.url = ENCODED
          else if (req.url.startsWith(RAW + '?')) req.url = ENCODED + req.url.slice(RAW.length)
        }
        next()
      })
    },
  }
}

export default defineConfig({
  server: {
    port: Number(process.env.PORT) || 3001,
  },
  // Workspace packages (@synek/ui) ship TS/JSX source — Vite must transform them
  // during SSR, not externalize them as bare imports.
  ssr: {
    noExternal: ['@synek/ui'],
  },
  // tsconfigPaths resolves the ~/* alias (Vite 7; the native resolve option is Vite 8+).
  plugins: [
    fixStartClientEntryDev(),
    tsconfigPaths(),
    tanstackStart(),
    viteReact(),
    tailwindcss(),
  ],
})
