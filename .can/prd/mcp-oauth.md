---
phase: OAUTH
title: "Browser OAuth for the MCP front door"
status: spike-complete (not built)
era: "MCP connection (the front door)"
updated: 2026-06-10
---

# OAUTH — one-click "Authorize" instead of paste-a-token

> **The promise.** Connecting Claude stops being "mint a key → copy it → `export SYNEK_API_KEY=…` → restart." The plugin's `.mcp.json` carries no secret; on first use Claude Code shows the server as *needs auth*, the user clicks **Authenticate**, a browser opens, they approve with the local login they already have, and tokens refresh automatically forever after.

This is the next on-ramp unlock **after `npx synek`** (the installer is built; see [[strata-onramp-plugin-oauth]] / roadmap NOW.1). It polishes the credential step, which only matters once getting Synek *running* is easy.

## Spike result — the assumption holds (2026-06-10)

Both halves were verified before committing to build.

**Client (Claude Code).** Per the Claude Code MCP docs:
- A header-less HTTP/SSE MCP server that responds `401` (with `WWW-Authenticate`) or advertises `/.well-known/oauth-protected-resource` → Claude Code runs automatic discovery (RFC 9728 → RFC 8414) and an OAuth 2.0 authorization-code flow.
- **Plugin-bundled MCP servers behave identically to user-configured ones** — no plugin-specific OAuth limitation.
- **Dynamic Client Registration (RFC 7591) supported by default** (also CIMD; manual `--client-id/--client-secret` as fallback).
- **Localhost loopback is fully supported, plain `http://` is fine**; callback port is random or pinned via `--callback-port`. Tokens stored securely; auto-refresh when the server advertises `offline_access`.
- **Not zero-touch:** the user runs `/mcp → Authenticate` once (browser opens). Still one approval vs. the four-step token dance.
- Version note: an `authServerMetadataUrl` override needs Claude Code **v2.1.64+** (only relevant if our discovery paths don't line up by default).

**Server (Better Auth).** `better-auth@1.6.11` already bundles the `mcp` plugin (no new dependency) — confirmed it exports `mcp`, `withMcpAuth`, `getMCPProtectedResourceMetadata`, `oAuthProtectedResourceMetadata`, `oAuthDiscoveryMetadata`, and is built on `oidcProvider` (which provides DCR). `mcp({ loginPage, resource?, oidcConfig? })` registers `/.well-known/oauth-authorization-server` and the authorize/token endpoints; `withMcpAuth` guards the resource and returns the spec-compliant 401 + metadata pointer. The login page the flow needs already exists (the KEYS work shipped local email/password auth).

## Surface to build (sketch — ~0.5–1 day)

- **`src/lib/auth/index.ts`** — add the `mcp({ loginPage: '/', resource: '<BASE_URL>/api/mcp', oidcConfig: { … } })` plugin to `betterAuth({ plugins: [...] })`. Keep `bearer()` for back-compat.
- **Discovery endpoints** — ensure Claude Code can reach them. Better Auth serves auth-server metadata under its handler base (`/api/auth/.well-known/oauth-authorization-server`); expose `/.well-known/oauth-protected-resource` for the **resource** (`/api/mcp`) via `getMCPProtectedResourceMetadata`, advertising `/api/auth` as the `authorization_servers` entry. **This routing is the main integration risk** — confirm the paths Claude Code probes resolve (root-level `.well-known` may need a thin route that returns the plugin's metadata).
- **`src/routes/api/mcp.ts` + `auth/guard.ts`** — dual-path guard: try the existing `synek_…` bearer key first (unchanged), else delegate to OAuth via `withMcpAuth` (validate the access token, 401 + `WWW-Authenticate` when absent). One integration point, both credential models live side by side.
- **`synek-plugin/.mcp.json`** — drop the `Authorization` header (OAuth becomes the default for the plugin/HTTP path). Optionally keep a documented "static key" variant.
- **Docs** — update `synek-plugin` `setup` skill + READMEs: "click Authenticate in `/mcp`" replaces the export-a-key step for Claude Code.

## Keep the bearer key — don't remove it

OAuth is **HTTP/SSE only**. The **stdio** MCP server (Claude Desktop path) and headless/CI use **must** keep using `SYNEK_API_KEY`. So this is *additive*: OAuth for the plugin/HTTP front door, the `synek_…` key for stdio + as a fallback. Nothing about the existing key system is removed.

## Scope posture (guardrail)

Stays **local-first, single-user**. This is a **loopback OAuth provider on the user's own machine** authorizing their own Claude — NOT third-party SSO, NOT a hosted identity service, NOT teams. Better Auth's `oidcProvider` runs entirely local. Don't let it grow into account infrastructure beyond what KEYS already shipped.

## Open questions before build

1. Exact `.well-known` routing so Claude Code's RFC 9728/8414 probes resolve against our `/api/auth` issuer + `/api/mcp` resource (the one real unknown).
2. Whether to keep a header-carrying `.mcp.json` variant for users who'd rather not do the browser step.
3. `loginPage` UX: the approval/consent screen — reuse the home login, or a dedicated minimal consent page.

## Acceptance (when built)

- Plugin `.mcp.json` has no secret; a fresh Claude Code shows `synek` as *needs auth*; `/mcp → Authenticate` opens the browser, the local login approves, and `apply_patch` then works.
- Token auto-refreshes (no re-auth on expiry).
- Existing `synek_…` bearer keys still authorize `/api/mcp` (no regression); stdio path unchanged.
- `bun run typecheck` clean; e2e green (extend `e2e/mcp.spec.ts` with an OAuth-path case).
