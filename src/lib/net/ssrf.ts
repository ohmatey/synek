// Server-side egress guard (SSRF defense).
//
// Synek's server fetches URLs that originate, directly or indirectly, from
// user/agent input — citation links and image URLs supplied through
// `apply_patch` / `write_story` (verified in `lib/mcp/warnings.ts`), and, once
// the P2 Realscript brand adapter lands (`lib/realscript/`), brand-asset URLs
// (logos, fonts, theme.css) plus the `REALSCRIPT_BASE_URL` base. In the
// multi-tenant hosted posture (open signup, single-instance deploy) an
// unguarded `fetch` of attacker-chosen URLs is a server-side request forgery
// vector: the server can be steered at the cloud metadata endpoint
// (169.254.169.254), loopback, or internal services, and the response
// status/content-type/connection-error becomes an oracle.
//
// This module is the single chokepoint for outbound fetches of
// externally-influenced URLs. It enforces, in order:
//   1. scheme allowlist (https only by default; http opt-in for the link
//      verifier where legacy sources are legitimately http),
//   2. no embedded credentials (`user:pass@`),
//   3. host is not an IP literal in a non-routable range,
//   4. an optional explicit host allowlist (used by the Realscript base URL),
//   5. DNS resolution where every resolved address is publicly routable
//      (closes the "attacker domain → A-record 169.254.169.254" case),
//   6. redirects followed manually with every hop re-validated (closes the
//      "public URL 302→internal" case).
//
// Known residual (documented, not yet closed — see ADR 0002 "Open / deferred"):
// a TOCTOU DNS-rebinding window remains because step 5 resolves the name and
// step 6's `fetch` resolves it again; fully closing it needs a custom undici
// dispatcher that pins the validated IP while preserving SNI. Out of scope for
// the present hardening; the common vectors above are closed.

import { BlockList, isIP } from 'node:net'
import { lookup } from 'node:dns/promises'

export type SsrfReason = 'invalid' | 'protocol' | 'credentials' | 'blocked' | 'unresolved' | 'redirects'

export class SsrfError extends Error {
  readonly reason: SsrfReason
  constructor(reason: SsrfReason, message: string) {
    super(message)
    this.name = 'SsrfError'
    this.reason = reason
  }
}

// Non-routable / special-use IPv4 ranges (RFC 1918, 6598, 5735, 3927, …).
const v4Blocked = new BlockList()
v4Blocked.addSubnet('0.0.0.0', 8, 'ipv4') // "this" network
v4Blocked.addSubnet('10.0.0.0', 8, 'ipv4') // private
v4Blocked.addSubnet('100.64.0.0', 10, 'ipv4') // CGNAT (RFC 6598)
v4Blocked.addSubnet('127.0.0.0', 8, 'ipv4') // loopback
v4Blocked.addSubnet('169.254.0.0', 16, 'ipv4') // link-local (incl. 169.254.169.254 metadata)
v4Blocked.addSubnet('172.16.0.0', 12, 'ipv4') // private
v4Blocked.addSubnet('192.0.0.0', 24, 'ipv4') // IETF protocol assignments
v4Blocked.addSubnet('192.0.2.0', 24, 'ipv4') // TEST-NET-1
v4Blocked.addSubnet('192.168.0.0', 16, 'ipv4') // private
v4Blocked.addSubnet('198.18.0.0', 15, 'ipv4') // benchmarking
v4Blocked.addSubnet('198.51.100.0', 24, 'ipv4') // TEST-NET-2
v4Blocked.addSubnet('203.0.113.0', 24, 'ipv4') // TEST-NET-3
v4Blocked.addSubnet('224.0.0.0', 4, 'ipv4') // multicast
v4Blocked.addSubnet('240.0.0.0', 4, 'ipv4') // reserved

// Non-routable / special-use IPv6 ranges.
const v6Blocked = new BlockList()
v6Blocked.addAddress('::', 'ipv6') // unspecified
v6Blocked.addAddress('::1', 'ipv6') // loopback
v6Blocked.addSubnet('::ffff:0:0', 96, 'ipv6') // IPv4-mapped (e.g. ::ffff:127.0.0.1)
v6Blocked.addSubnet('100::', 64, 'ipv6') // discard-only
v6Blocked.addSubnet('fc00::', 7, 'ipv6') // unique-local (ULA)
v6Blocked.addSubnet('fe80::', 10, 'ipv6') // link-local
v6Blocked.addSubnet('ff00::', 8, 'ipv6') // multicast

// A NAT64-embedded IPv4 (64:ff9b::a.b.c.d / hex tail) can smuggle a private v4
// past the v6 ranges above; pull it out and re-check against the v4 set.
function nat64EmbeddedV4(v6: string): string | null {
  const lower = v6.toLowerCase()
  if (!lower.startsWith('64:ff9b:')) return null
  const dotted = lower.match(/:((?:\d{1,3}\.){3}\d{1,3})$/)
  if (dotted) return dotted[1]!
  const hex = lower.match(/:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/)
  if (hex) {
    const hi = parseInt(hex[1]!, 16)
    const lo = parseInt(hex[2]!, 16)
    return `${(hi >> 8) & 0xff}.${hi & 0xff}.${(lo >> 8) & 0xff}.${lo & 0xff}`
  }
  return null
}

/** True if `ip` (a literal v4 or v6 address) is loopback/private/link-local/reserved. */
export function isBlockedIp(ip: string): boolean {
  const fam = isIP(ip)
  if (fam === 4) return v4Blocked.check(ip, 'ipv4')
  if (fam === 6) {
    const embedded = nat64EmbeddedV4(ip)
    if (embedded && isIP(embedded) === 4) return v4Blocked.check(embedded, 'ipv4')
    return v6Blocked.check(ip, 'ipv6')
  }
  return true // not a valid IP literal — fail closed
}

export type UrlGuardOptions = {
  /** Allow http:// in addition to https:// (default false — https only). */
  allowHttp?: boolean
  /** If set, the URL's hostname (lowercased) must be one of these exactly. */
  allowHosts?: string[]
}

function hostOf(url: URL): string {
  // URL.hostname keeps IPv6 in brackets; strip them for isIP / lookup.
  return url.hostname.replace(/^\[|\]$/g, '').toLowerCase()
}

/**
 * Synchronous structural validation: scheme, credentials, IP-literal host
 * range, and the optional host allowlist. Does NOT touch DNS or the network —
 * use this at construction time (e.g. validating REALSCRIPT_BASE_URL or a
 * brand-asset URL before persisting it). Throws SsrfError; returns the parsed URL.
 */
export function assertSafeUrl(rawUrl: string, opts: UrlGuardOptions = {}): URL {
  let url: URL
  try {
    url = new URL(rawUrl)
  } catch {
    throw new SsrfError('invalid', `"${rawUrl}" is not a valid URL`)
  }
  const okScheme = url.protocol === 'https:' || (opts.allowHttp === true && url.protocol === 'http:')
  if (!okScheme) {
    throw new SsrfError('protocol', `blocked scheme "${url.protocol}" (only ${opts.allowHttp ? 'http/https' : 'https'} allowed)`)
  }
  if (url.username || url.password) {
    throw new SsrfError('credentials', 'credentials embedded in the URL are not allowed')
  }
  const host = hostOf(url)
  if (isIP(host) !== 0 && isBlockedIp(host)) {
    throw new SsrfError('blocked', `host ${host} is a non-routable/internal address`)
  }
  if (opts.allowHosts && !opts.allowHosts.map((h) => h.toLowerCase()).includes(host)) {
    throw new SsrfError('blocked', `host ${host} is not in the allowlist`)
  }
  return url
}

/**
 * assertSafeUrl + DNS check: every address the hostname resolves to must be
 * publicly routable. Async. Throws SsrfError ('unresolved' if the name has no
 * routable address, 'blocked' if it points at an internal one).
 */
export async function assertFetchableUrl(rawUrl: string, opts: UrlGuardOptions = {}): Promise<URL> {
  const url = assertSafeUrl(rawUrl, opts)
  const host = hostOf(url)
  if (isIP(host) === 0) {
    let addrs: { address: string }[]
    try {
      addrs = await lookup(host, { all: true })
    } catch (e) {
      throw new SsrfError('unresolved', `could not resolve ${host} (${e instanceof Error ? e.message : 'DNS error'})`)
    }
    if (addrs.length === 0) throw new SsrfError('unresolved', `${host} did not resolve to any address`)
    for (const a of addrs) {
      if (isBlockedIp(a.address)) {
        throw new SsrfError('blocked', `${host} resolves to a non-routable/internal address (${a.address})`)
      }
    }
  }
  return url
}

export type SafeFetchOptions = UrlGuardOptions & {
  /** Max redirect hops to follow, each re-validated. Default 4. */
  maxRedirects?: number
}

/**
 * SSRF-guarded fetch. Validates the URL (scheme + DNS + range), follows
 * redirects manually re-validating each hop, and returns the final Response.
 * Throws SsrfError if any URL in the chain is unsafe. Pass `init` (method,
 * signal, headers) as for `fetch`; `redirect` is forced to 'manual' internally.
 */
export async function safeFetch(rawUrl: string, init: RequestInit = {}, opts: SafeFetchOptions = {}): Promise<Response> {
  const maxRedirects = opts.maxRedirects ?? 4
  let url = await assertFetchableUrl(rawUrl, opts)
  for (let hop = 0; ; hop++) {
    const res = await fetch(url, { ...init, redirect: 'manual' })
    const isRedirect = res.status >= 300 && res.status < 400 && res.headers.has('location')
    if (!isRedirect) return res
    if (hop >= maxRedirects) {
      void res.body?.cancel()
      throw new SsrfError('redirects', `exceeded ${maxRedirects} redirects`)
    }
    let next: URL
    try {
      next = new URL(res.headers.get('location')!, url)
    } catch {
      void res.body?.cancel()
      throw new SsrfError('invalid', 'redirect Location was not a valid URL')
    }
    void res.body?.cancel()
    url = await assertFetchableUrl(next.href, opts)
  }
}
