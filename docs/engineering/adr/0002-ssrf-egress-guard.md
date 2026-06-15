# ADR 0002 — Server-side egress SSRF guard

- **Status:** Accepted (2026-06-15)
- **Date:** 2026-06-15
- **Deciders:** Kael (Chief Engineer, owner) · founder (security note + sign-off)
- **Scope:** Every server-side `fetch` of a URL that is, directly or indirectly, influenced by user/agent input — in the multi-tenant **hosted** posture (open signup, Fly.io single-instance).
- **Code:** `src/lib/net/ssrf.ts` (the guard) · `src/lib/mcp/warnings.ts` (first consumer — the citation/image URL verifier) · `scripts/verify-ssrf.ts` (`bun run verify:ssrf`)
- **Roadmap:** `../../product/roadmap.md` → *Hosting horizon*

---

## Context

Synek's server fetches URLs that originate from user/agent input. Today that is exactly one surface: `src/lib/mcp/warnings.ts` `fetchVerdict()` does a `HEAD`/`GET` (with `redirect: 'follow'`) on **citation links** and **image URLs** supplied through `apply_patch` / `write_story`, to tell the building MCP client which URLs are dead. The verdict it returns includes the HTTP status and, for images, the content-type.

In the **single-user self-hosted** Core this is harmless — the only person who can submit URLs is the host, fetching on their own box. **Phase 2 changed the threat model.** The committed multi-tenant posture (per-user isolation, **open signup** with email verification, Fly.io single-instance) means *any* signed-up user can submit URLs that the server then fetches from inside the deployment's network. That is a textbook **server-side request forgery (SSRF)** vector:

- A citation/image URL of `http://169.254.169.254/latest/meta-data/iam/security-credentials/` steers the server at the cloud **metadata endpoint** — credential theft.
- `http://127.0.0.1:<port>/` or `http://<internal-service>/` reaches services not exposed publicly.
- The returned **status code / content-type**, and the *connection error* (`ECONNREFUSED` vs timeout), turn the verifier into an **oracle** — a blind port/host scanner of the internal network.
- `redirect: 'follow'` let a *public* URL `302` to an internal one, bypassing any naive "is the host public" check on the original URL.

The founder flagged the same class forward: when the **P2 Realscript brand adapter** lands (`src/lib/realscript/`), it will resolve a base URL from `REALSCRIPT_BASE_URL` and fetch brand assets (logos, fonts, `theme.css`) for storage in a timeline/project `theme`. If that base URL — or any asset URL — is ever derived from per-user/per-request input rather than a fixed operator-set value, the identical hole opens. (As of this ADR neither `src/lib/realscript/` nor a `projects` table exists on `main`; the present `theme` column is `timelines.theme`.)

**The hard constraints this design lives inside:**

1. **No false positives on the live verifier.** `fetchVerdict` runs on every `apply_patch`; legitimate citations are routinely `http://` and occasionally bare-IP image CDNs. The guard must not start flagging real sources.
2. **No new dependency, no AI.** The inversion stands — the guard is pure Node stdlib.
3. **Self-host must stay unaffected in behavior.** A self-hoster fetching a LAN image is the host acting on their own network; the guard's *rejection* of private ranges is a defensible default, but the change must be a guard, not a feature teardown.

## Decision

Introduce **one chokepoint** for outbound fetches of externally-influenced URLs — `src/lib/net/ssrf.ts` — and route the existing verifier through it. No raw `fetch(userUrl)` anywhere in server code.

The guard enforces, in order:

1. **Scheme allowlist** — `https` only by default; `http` is opt-in (`allowHttp`) for the link verifier, where the IP-range check (not the scheme) is the actual SSRF defense.
2. **No embedded credentials** (`user:pass@…`).
3. **IP-literal host range check** — reject hosts that are literals in loopback / RFC 1918 private / link-local (incl. `169.254.169.254`) / CGNAT / IETF-reserved / multicast ranges, IPv4 **and** IPv6, including IPv4-mapped (`::ffff:…`) and NAT64 (`64:ff9b::…`) forms that smuggle a private v4 through a v6 address. Built on `node:net` `BlockList`.
4. **Optional explicit host allowlist** (`allowHosts`) — the shape the Realscript base URL uses (https-only + a single operator-set host).
5. **DNS resolution check** — resolve the hostname and reject if **any** resolved address is non-routable (closes "attacker domain → A-record `169.254.169.254`").
6. **Manual redirect following** — `redirect: 'manual'`, re-validating every hop against 1–5 (closes "public URL `302`→internal"), capped at 4 hops.

Three entry points: `assertSafeUrl` (sync, steps 1–4 — for construction-time validation like `REALSCRIPT_BASE_URL` or a brand-asset URL before it is persisted), `assertFetchableUrl` (adds step 5), and `safeFetch` (the full guard incl. step 6). `SsrfError` carries a `reason` (`invalid|protocol|credentials|blocked|unresolved|redirects`) so callers can map a refusal to the right outcome.

**First (and currently only) consumer:** `warnings.ts` `fetchVerdict` now calls `safeFetch(url, …, { allowHttp: true })` instead of `fetch(url, { redirect: 'follow' })`. A refusal maps to a **broken** verdict (so the agent removes the bad URL) except `unresolved`, which is **unverified** (transient DNS is inconclusive — matches the existing three-way verdict philosophy).

**Binding requirement (the forward part):** any future server-side fetch of an externally-influenced URL — explicitly including the **P2 Realscript brand adapter** — MUST go through this module. Realscript specifically:
- construct the brand client with `assertSafeUrl(REALSCRIPT_BASE_URL, { allowHosts: [<operator-set>] })` (default `https://app.realscript.com`), https-only, rejecting non-allowlisted/`http` hosts at construction;
- validate every brand-asset URL with `assertFetchableUrl` (or fetch via `safeFetch`) **before** persisting it to `theme`.

## Consequences

- **Closed now:** the live citation/image verifier can no longer be steered at the metadata endpoint, loopback, internal services, or be redirected to them; the status/content-type/error oracle over the internal network is shut.
- **Behavior delta on the live path:** URLs whose host is/resolves to a non-routable address are now reported `broken` instead of being fetched. For a public-internet deployment this only affects URLs that were never legitimate. **Self-host note:** a self-hoster who *intends* to reference a LAN image will now see it flagged — acceptable default; revisit with an operator opt-out only if a real user hits it.
- **One pattern to learn:** new fetch surfaces have an obvious, tested home; the Realscript adapter inherits the guard for free.
- **Cost:** one extra DNS `lookup` per uncached URL (verdicts are already cached; pacing already serializes per host) — negligible inside the 4 s budget.

## Alternatives considered

- **Blocklist host strings only (no DNS, no redirect re-check).** Rejected: trivially bypassed by a domain whose A-record is internal, or a public→internal redirect.
- **A dependency (e.g. `ssrf-req-filter`, a proxy allowlist).** Rejected: `node:net` `BlockList` + `dns/promises` cover it with zero supply-chain surface, consistent with the no-new-dep posture.
- **Block at the network layer (egress firewall / Fly private-network rules).** Complementary, not a substitute — defense in depth belongs in app code too, and self-host has no such layer. Worth adding at the platform layer later (Rook).
- **Full IP-pinning dispatcher to kill DNS rebinding now.** Deferred — see below.

## Open / deferred

- **DNS-rebinding TOCTOU (residual).** Step 5 resolves the name and step 6's `fetch` resolves it again, so a sub-TTL rebind racing the 4 s timeout could in principle slip an internal IP past validation. Closing it fully needs a custom undici dispatcher that pins the validated IP while preserving TLS SNI. The common vectors (direct internal literal, DNS-to-internal, redirect-to-internal) are closed; rebinding requires attacker-controlled authoritative DNS flipping inside a 4 s window. Tracked as a follow-up; revisit if the threat model warrants pinning.
- **Platform-layer egress controls** (Fly private-network / firewall) as defense in depth — Rook.
- **Operator opt-out for self-host LAN references**, only if a real user needs it.
