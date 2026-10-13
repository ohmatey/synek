import {
  assertSafeUrl,
  assertFetchableUrl,
  isBlockedIp,
  redirectSafeHeaders,
  capResponseBody,
  makeGuardedLookup,
  assertRoutableAddresses,
  ssrfDispatcher,
  safeFetch,
  SsrfError,
} from '../src/lib/net/ssrf'
import { createServer } from 'node:http'
import type { AddressInfo } from 'node:net'
import { fetch as undiciFetch } from 'undici'

// Data-layer proof of the server-side egress guard (ADR 0002) WITHOUT touching
// the network: asserts the IP-range classifier, the synchronous URL guard
// (scheme / credentials / IP-literal / allowlist), and the DNS-resolution guard
// against loopback names. Run under Node: `bun run verify:ssrf`.

let passed = 0
function assert(cond: boolean, msg: string) {
  if (!cond) throw new Error(`FAIL: ${msg}`)
  passed++
  console.log(`  ✓ ${msg}`)
}

async function rejects(reason: SsrfError['reason'], fn: () => unknown | Promise<unknown>, msg: string) {
  try {
    await fn()
  } catch (e) {
    assert(e instanceof SsrfError && e.reason === reason, `${msg} → SsrfError(${reason})`)
    return
  }
  throw new Error(`FAIL: ${msg} → expected SsrfError(${reason}), got no throw`)
}

async function allows(fn: () => unknown | Promise<unknown>, msg: string) {
  await fn()
  assert(true, msg)
}

async function main() {
  console.log('isBlockedIp — non-routable ranges:')
  for (const ip of ['127.0.0.1', '10.0.0.5', '172.16.0.1', '192.168.1.1', '169.254.169.254', '100.64.0.1', '0.0.0.0']) {
    assert(isBlockedIp(ip) === true, `${ip} blocked (v4)`)
  }
  for (const ip of ['::1', '::', 'fe80::1', 'fc00::1', '::ffff:127.0.0.1', '64:ff9b::a9fe:a9fe']) {
    assert(isBlockedIp(ip) === true, `${ip} blocked (v6 / mapped / NAT64)`)
  }
  for (const ip of ['2002:7f00:1::1', '2002:0a00:0001::', '2002:a9fe:a9fe::']) {
    assert(isBlockedIp(ip) === true, `${ip} blocked (6to4-embedded private v4)`)
  }
  console.log('isBlockedIp — public addresses pass:')
  for (const ip of ['1.1.1.1', '8.8.8.8', '93.184.216.34', '2606:4700:4700::1111', '2002:0808:0808::']) {
    assert(isBlockedIp(ip) === false, `${ip} allowed`)
  }

  console.log('redirectSafeHeaders — credential stripping on cross-origin redirect:')
  {
    const base = new Headers({ authorization: 'Bearer secret', cookie: 'sid=1', 'x-keep': 'yes' })
    const same = redirectSafeHeaders(base, 'https://app.realscript.com', 'https://app.realscript.com')
    assert(same.get('authorization') === 'Bearer secret', 'same-origin redirect keeps Authorization')
    const cross = redirectSafeHeaders(base, 'https://app.realscript.com', 'https://evil.example.com')
    assert(cross.get('authorization') === null, 'cross-origin redirect strips Authorization')
    assert(cross.get('cookie') === null, 'cross-origin redirect strips Cookie')
    assert(cross.get('x-keep') === 'yes', 'cross-origin redirect keeps non-credential headers')
  }

  console.log('capResponseBody — response size cap:')
  {
    const over = capResponseBody(new Response(new Blob([new Uint8Array(32)]).stream()), 8)
    await rejects('too_large', () => over.arrayBuffer(), 'body over maxBytes errors the stream')
    const under = capResponseBody(new Response(new Blob([new Uint8Array(4)]).stream()), 8)
    await allows(() => under.arrayBuffer(), 'body under maxBytes reads fine')
    const head = capResponseBody(new Response(null, { status: 204 }), 8)
    assert(head.body === null, 'null-body (HEAD/204) response is passed through unwrapped')
  }

  console.log('assertSafeUrl — scheme / credentials / IP literal:')
  await rejects('protocol', () => assertSafeUrl('http://example.com'), 'http rejected when https-only')
  await allows(() => assertSafeUrl('http://example.com', { allowHttp: true }), 'http allowed with allowHttp')
  await rejects('protocol', () => assertSafeUrl('file:///etc/passwd'), 'file:// rejected')
  await rejects('protocol', () => assertSafeUrl('gopher://x/'), 'gopher:// rejected')
  await rejects('credentials', () => assertSafeUrl('https://user:pass@example.com'), 'embedded credentials rejected')
  await rejects('blocked', () => assertSafeUrl('https://169.254.169.254/latest/meta-data/', { allowHttp: true }), 'metadata IP literal rejected')
  await rejects('blocked', () => assertSafeUrl('http://127.0.0.1:8080/', { allowHttp: true }), 'loopback IP literal rejected')
  await rejects('blocked', () => assertSafeUrl('http://[::1]:9200/', { allowHttp: true }), 'IPv6 loopback literal rejected')
  await allows(() => assertSafeUrl('https://en.wikipedia.org/wiki/Stoicism'), 'public https URL allowed')

  console.log('assertSafeUrl — host allowlist (Realscript base-URL shape):')
  await allows(() => assertSafeUrl('https://app.realscript.com/brands/x', { allowHosts: ['app.realscript.com'] }), 'allowlisted host allowed')
  await rejects('blocked', () => assertSafeUrl('https://evil.example.com/', { allowHosts: ['app.realscript.com'] }), 'off-allowlist host rejected')
  await rejects('protocol', () => assertSafeUrl('http://app.realscript.com/', { allowHosts: ['app.realscript.com'] }), 'allowlist still enforces https')

  console.log('assertFetchableUrl — DNS resolution guard:')
  await rejects('blocked', () => assertFetchableUrl('http://localhost:5432/', { allowHttp: true }), 'localhost resolves to loopback → blocked')
  await allows(() => assertFetchableUrl('https://example.com/'), 'public hostname resolves to a routable address')

  console.log('assertRoutableAddresses — shared by the pre-flight and the connect-time lookup:')
  await rejects('unresolved', () => assertRoutableAddresses('x.test', []), 'empty answer → unresolved')
  await rejects('blocked', () => assertRoutableAddresses('x.test', [{ address: '93.184.216.34' }, { address: '10.0.0.1' }]), 'ONE internal address among public ones → blocked')
  await allows(() => assertRoutableAddresses('x.test', [{ address: '93.184.216.34' }, { address: '2606:4700:4700::1111' }]), 'all-public answer passes')

  console.log('makeGuardedLookup — connect-time pinning (fake resolver, no network):')
  type LookupResult = { err: unknown; address: unknown; family: unknown }
  const runLookup = (resolver: Parameters<typeof makeGuardedLookup>[0], all: boolean) =>
    new Promise<LookupResult>((resolve) => {
      makeGuardedLookup(resolver)('rebind.test', { all, family: 0 }, (err, address, family) => resolve({ err, address, family }))
    })
  {
    const pub = [{ address: '93.184.216.34', family: 4 }]
    const r1 = await runLookup(async () => pub, false)
    assert(r1.err === null && r1.address === '93.184.216.34' && r1.family === 4, 'public answer → the validated address is what the socket gets (single shape)')
    const r2 = await runLookup(async () => pub, true)
    assert(r2.err === null && Array.isArray(r2.address) && (r2.address as { address: string }[])[0]!.address === '93.184.216.34', 'public answer honours the all:true shape (happy-eyeballs)')
    const r3 = await runLookup(async () => [{ address: '169.254.169.254', family: 4 }], true)
    assert(r3.err instanceof SsrfError && (r3.err as SsrfError).reason === 'blocked', 'metadata address → SsrfError(blocked), not handed to the socket')
    const r4 = await runLookup(async () => [{ address: '127.0.0.1', family: 4 }], false)
    assert(r4.err instanceof SsrfError && (r4.err as SsrfError).reason === 'blocked', 'loopback answer (single shape) → blocked')
    const r5 = await runLookup(async () => { throw new Error('ENOTFOUND') }, false)
    assert(r5.err instanceof SsrfError && (r5.err as SsrfError).reason === 'unresolved', 'resolver failure → unresolved')
    // The rebinding shape itself: a pre-flight that saw "public" cannot vouch for the
    // connect, because the connect asks again and gets the attacker's second answer.
    const answers = [pub, [{ address: '10.0.0.7', family: 4 }]]
    const rebinding = async () => answers.shift()!
    const preflight = await runLookup(rebinding, false)
    const atConnect = await runLookup(rebinding, false)
    assert(preflight.err === null, 'rebinding: first resolution (pre-flight) sees a public address')
    assert(atConnect.err instanceof SsrfError && (atConnect.err as SsrfError).reason === 'blocked', 'rebinding: the SECOND resolution (the connect) is blocked')
  }

  console.log('ssrfDispatcher — the real connect path refuses an internal target even if the pre-flight were skipped:')
  {
    let hits = 0
    const server = createServer((_req, res) => {
      hits++
      res.end('internal-secret')
    })
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
    const port = (server.address() as AddressInfo).port
    try {
      let caught: unknown
      try {
        await undiciFetch(`http://localhost:${port}/`, { dispatcher: ssrfDispatcher() })
      } catch (e) {
        caught = e
      }
      const cause = (caught as { cause?: unknown } | undefined)?.cause
      assert(cause instanceof SsrfError && cause.reason === 'blocked', 'localhost → connect refused by the lookup guard (SsrfError(blocked) as the cause)')
      assert(hits === 0, 'the loopback server received ZERO requests')
      await rejects('blocked', () => safeFetch(`http://localhost:${port}/`, {}, { allowHttp: true }), 'safeFetch surfaces it as a plain SsrfError(blocked)')
      assert(hits === 0, 'still zero requests after safeFetch')
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()))
    }
  }

  console.log('safeFetch — a public target still works through the pinned dispatcher (needs network):')
  {
    const res = await safeFetch('https://example.com/', { method: 'HEAD' })
    assert(res.status >= 200 && res.status < 400, `HEAD https://example.com/ → ${res.status}`)
    assert((res.headers.get('content-type') ?? '').length > 0 || res.status >= 300, 'response headers are readable')
  }

  console.log(`\nverify:ssrf — ${passed} assertions passed ✓`)
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e)
  process.exit(1)
})
