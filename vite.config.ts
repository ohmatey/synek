import { defineConfig } from 'vite'
import { tanstackStart } from '@tanstack/react-start/plugin/vite'
import viteReact from '@vitejs/plugin-react'
import tsconfigPaths from 'vite-tsconfig-paths'

export default defineConfig({
  server: {
    port: Number(process.env.PORT) || 3001,
  },
  // tsconfigPaths resolves the ~/* alias (Vite 7; the native resolve option is Vite 8+).
  plugins: [tsconfigPaths(), tanstackStart(), viteReact()],
})
