---
"synek": patch
---

Gate `getMcpToken` server fn to local mode only (security).

`getMcpToken` called `issueLocalToken()` with no `requireUser()` / `isLocalMode()`
gate, so it would mint a year-long bearer token for the deterministic
`local@synek.app` account (hardcoded password) to any caller. On an exposed deploy
that is an unauthenticated credential-minting endpoint for a shared account — a
tenant-isolation hole. It is now gated on `isLocalMode()` (mirroring
`ensureLocalSession`); hosted users mint a named key via the `requireUser`-gated
api-key RPCs or the OAuth flow. Latent until now — the endpoint was unreferenced,
so nothing invoked it — but closed so it can't be reintroduced.
