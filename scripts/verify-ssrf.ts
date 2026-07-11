import {
  assertSafeUrl,
  assertFetchableUrl,
  isBlockedIp,
  redirectSafeHeaders,
  capResponseBody,
  SsrfError,
} from '../src/lib/net/ssrf'

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

  console.log(`\nverify:ssrf — ${passed} assertions passed ✓`)
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e)
  process.exit(1)
})
