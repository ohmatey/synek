import http from 'node:http'
import { readFile, stat } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { sendHeartbeat } from '../src/lib/telemetry/heartbeat'

// Minimal production server for e2e: serves the built client assets statically
// and falls back to the TanStack Start fetch handler (SSR + server fns + /api/*).
// Used by the Playwright harness instead of `vite dev`, whose virtual client
// entry doesn't hydrate in sandboxed/CI environments. Run after `vite build`.
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const CLIENT = path.join(ROOT, 'dist/client')
const PORT = Number(process.env.PORT) || 3001

const { default: server } = (await import(path.join(ROOT, 'dist/server/server.js'))) as {
  default: { fetch: (req: Request) => Promise<Response> }
}

const MIME: Record<string, string> = {
  '.js': 'text/javascript',
  '.css': 'text/css',
  '.svg': 'image/svg+xml',
  '.json': 'application/json',
  '.ico': 'image/x-icon',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.woff2': 'font/woff2',
}

// Resolve a request path to a real file inside dist/client, or null. Guards against
// path traversal by requiring the resolved path to stay within CLIENT.
async function staticFile(pathname: string): Promise<string | null> {
  if (pathname === '/') return null
  const fp = path.join(CLIENT, decodeURIComponent(pathname))
  if (!fp.startsWith(CLIENT)) return null
  try {
    return (await stat(fp)).isFile() ? fp : null
  } catch {
    return null
  }
}

http
  .createServer(async (req, res) => {
    try {
      const url = new URL(req.url ?? '/', `http://localhost:${PORT}`)

      const fp = await staticFile(url.pathname)
      if (fp) {
        res.writeHead(200, { 'content-type': MIME[path.extname(fp)] ?? 'application/octet-stream' })
        res.end(await readFile(fp))
        return
      }

      const hasBody = req.method && !['GET', 'HEAD'].includes(req.method)
      const body = hasBody
        ? await new Promise<Buffer>((resolve) => {
            const chunks: Buffer[] = []
            req.on('data', (c) => chunks.push(c as Buffer))
            req.on('end', () => resolve(Buffer.concat(chunks)))
          })
        : undefined

      const request = new Request(url, {
        method: req.method,
        headers: req.headers as Record<string, string>,
        body,
        // @ts-expect-error Node requires duplex when streaming a request body.
        duplex: 'half',
      })
      const resp = await server.fetch(request)
      res.writeHead(resp.status, Object.fromEntries(resp.headers))
      res.end(Buffer.from(await resp.arrayBuffer()))
    } catch (e) {
      res.writeHead(500, { 'content-type': 'text/plain' })
      res.end(String((e as Error)?.stack ?? e))
    }
  })
  .listen(PORT, () => {
    console.log(`serve-build listening on http://localhost:${PORT}`)
    // Opt-IN self-hoster heartbeat (LATER.3). No-op unless SYNEK_TELEMETRY is set
    // AND a project key is present; never throws. This is the prod/Docker entry, so
    // it fires once per server boot — not on dev, seeds, or the stdio MCP process.
    void sendHeartbeat()
  })
