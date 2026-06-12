---
phase: KEYS
title: "API keys — the MCP front door"
status: built
era: "MCP connection (the front door)"
updated: 2026-05-26
---

# KEYS — API keys (the MCP front door)

> **The promise.** Connecting a client is a first-class, legible act: name a key, copy it once, see it listed, revoke it when you're done. The credential stops being a single opaque token you re-reveal (quietly minting year-long sessions each time) and becomes a small, honest set of keys you actually manage.

## Why this, why now

The inversion made the **MCP server the product surface** ([roadmap](../roadmap.md) §1.6) — the token *is* the front door. But the door has one un-labelled key under the mat: a single Better Auth **session token**, surfaced by a one-shot "Reveal token" button. It can't be named, listed, revoked, or rotated, and every reveal runs `signInEmail` again — minting a fresh year-long session while the old ones linger invisibly. For a product whose whole job is "connect your client and build," that's the roughest edge on the most important path.

Better Auth **1.6.11 ships no `api-key` plugin** (bundled plugins: `bearer`, `jwt`, `mcp`, `one-time-token`, …), so this is a small purpose-built feature, not a config flag.

## Who this is for

| Persona | What they came for | What they get today |
|---|---|---|
| **The Connector** (primary) | "Wire Claude Desktop / Code to my canvas and start building." | One opaque token, copy-from-a-button, no way to tell which client has what. |
| **The Multi-client user** | Different keys for laptop CLI vs desktop app. | Re-reveal mints duplicate sessions; no labels; no list. |
| **The Security-minded** | "Rotate/kill a key I pasted somewhere." | No revoke. The only "rotation" is accumulating more live sessions. |

## Scope posture (guardrail)

Stays inside CLAUDE.md's **single-user, local-first Core**. This is *named, listable, revocable keys for the one local user* — not per-key scopes, not teams, not quotas/expiry policy, not audit logs, not cloud sync. (Those live in Deferred → S5 Users + signal.)

## Decisions carried in

| Fork | Decision | Rationale |
|---|---|---|
| Approach | **Custom `api_keys` table** (not session sidecar) | Purpose-built, hashed at rest, decoupled from session expiry; clean show-once + revoke + last-used |
| Reveal model | **Show once** on creation, then prefix + label only | Standard API-key UX; nothing sensitive persisted in plaintext |
| Back-compat | Guard tries api-key path, **falls back to `getSession`** | Existing minted session tokens keep working; no forced cutover |
| `bun run issue:key` | **Repointed** to mint an `api_keys` row (prints `synek_…` once) | One token model; CLI and UI now produce the same kind of key |
| First-run | **Auto-seed a "Default" key** and surface its secret once in the panel | New users land with a ready-to-copy key, never a hashed key whose secret is lost |

## The experience end

On the home page, the *Connect an MCP client* panel becomes a **Keys** panel:

- **Create:** type a label → a `synek_…` key is generated and shown **once** with a copy button and a "you won't see this again" note.
- **List:** a table of keys — label, prefix (`synek_a1b2…`), created, last used, and a **Revoke** action.
- **Revoke:** the key stops authorizing `/api/mcp` and stdio immediately.

The endpoint URL stays exactly as today; only the credential UX changes.

## Data model

New table `api_keys` (Postgres-portable, per the schema conventions in `src/lib/db/schema.ts`):

| Column | Type | Notes |
|---|---|---|
| `id` | `text` PK | `crypto.randomUUID()` |
| `label` | `text` | user-supplied name |
| `keyHash` | `text` | `sha256(rawKey)` hex — the secret is **never** stored |
| `prefix` | `text` | first ~12 chars of the raw key, for display |
| `createdAt` | `integer` (timestamp_ms) | |
| `lastUsedAt` | `integer` (timestamp_ms) nullable | stamped on successful auth |
| `revokedAt` | `integer` (timestamp_ms) nullable | non-null = revoked |

Raw key format: `synek_<32 random bytes, base64url>`. One migration (`drizzle/000N_…`).

## Surface to build

- **`src/lib/auth/api-keys.ts`** — `createApiKey(label) → { raw, row }`, `listApiKeys()`, `revokeApiKey(id)`, `verifyApiKey(token) → row | null` (hash + lookup, ignore revoked, stamp `lastUsedAt`).
- **`src/lib/auth/guard.ts`** — both `requireApiKey` (HTTP) and `assertApiKey` (stdio): if Bearer starts with `synek_`, run `verifyApiKey`; otherwise fall through to the existing `auth.api.getSession`. One integration point, two callers (`api/mcp.ts`, `mcp/stdio.ts`) unchanged.
- **`src/lib/server/api-keys.ts`** — server fns `createApiKey`, `listApiKeys`, `revokeApiKey` for the UI.
- **`src/routes/index.tsx`** — replace the `ConnectPanel` reveal block with the Keys panel (create / list / revoke / show-once).
- **Tests** — unit (hash/verify/revoke/lastUsed); extend `e2e/mcp.spec.ts` (create key → call `apply_patch` → revoke → 401); keep the existing 401-without-Bearer case.
- **Docs** — update the plugin `synek-setup` skill + READMEs (“mint a token” → “create an API key in the Keys panel”).

## Back-compat & migration

- Existing session tokens still authorize (guard fallback) — no break for anyone already connected.
- First home load auto-seeds a **"Default"** key and shows its secret once (so the panel is never empty and the secret is never lost). Revoked rows count, so a full revoke never resurrects it.
- `SYNEK_API_KEY` (stdio) accepts either a `synek_` key or a legacy session token, transparently.

## Out of scope (this phase)

Per-key scopes/permissions · expiry/rotation policy · usage quotas · audit log · multi-user.

## Acceptance

- Create a labelled key in the UI; the raw secret is shown once and never again.
- `Authorization: Bearer synek_…` authorizes `/api/mcp`; revoking it yields `401` on the next call.
- Legacy session tokens still authorize (no regression in `e2e/mcp.spec.ts`).
- `bun run typecheck` clean; `bun run build` green; e2e suite green.

## Effort

~0.5–1 day. Migration + key module (~2h), guard + server fns (~1–2h), Keys UI (~2–3h), tests + docs (~2h).

## Status — built

Migration `0007`, `lib/auth/api-keys.ts` (+ `ensureDefaultApiKey`), the guard fallback, server fns (`initApiKeys` / `createApiKey` / `listApiKeys` / `revokeApiKey`), the home Keys panel with first-run **Default** key (secret shown once), and `scripts/issue-key.ts` repointed to mint an `api_keys` row. Verified: `typecheck` clean · `vite build` green · e2e **19/19** (incl. *key authorizes → revoke → 401* and the Keys-panel UI).

## Follow-up — browser auth (built)

Key management is now **gated behind login** (roadmap §1.6 + the public-self-hosting posture: an open `localhost` instance must not let any visitor mint a key). **Open multi-user** registration via Better Auth email/password.

- `lib/auth/client.ts` (Better Auth React client) + `lib/auth/session.ts` (`getCurrentUser` / `requireUser` via `getRequestHeaders`).
- Home *Connect* panel is session-aware (client-only `KeysSection`): logged out → sign-up / log-in (`AuthForms`); logged in → account row + Sign out + keys. Timelines stay public (same UX).
- Key RPCs (`initApiKeys` / `createApiKey` / `listApiKeys` / `revokeApiKey`) call `requireUser` — server-side gate, not just hidden UI.
- **API keys scoped per user**: `api_keys.user_id` (migration `0008`); list/create/revoke/ensureDefault filter by owner. `verifyApiKey` stays a global hash lookup (a valid key authorizes MCP regardless of owner — consistent while timelines are shared).
- `issue:key` resolves a user (email arg or first user) since the CLI has no session.

Verified: `typecheck` clean · `vite build` green · e2e **19/19** (home test signs up → creates a key; canvas node-selection hardened to `dispatchEvent`; cold-start timeout headroom in the Playwright config).

## Follow-up — per-user timelines + sharing (built)

Timelines are now **owned per account** (no "workspace" entity — direct `timelines.ownerId → user.id`), **private by default**, with a per-timeline **public toggle + share URL**. Access: list = your own; view = owner *or* `isPublic`; create/edit/rename/delete/toggle = owner; **MCP = scoped to the key's owner**.

- Schema: `timelines.ownerId` + `isPublic` (migration `0009`, with a backfill of pre-ownership rows to the first user). New `getTimelineMeta` / `setTimelinePublic` / `canView` in `db/graph.ts`; all CRUD owner-scoped.
- Server fns: `timelines.ts` + new `setTimelineVisibility` require a session; `getGraph` is visibility-aware (returns `ok` with `isOwner`/`isPublic`, or `notFound`/`forbidden`, and no longer auto-creates); `nodes.ts` + `patches.ts` (undo/redo) assert ownership.
- MCP: the guard resolves the owner (`verifyApiKey().userId` or session user) and threads it `route → handleMcpRequest → buildMcpServer(ownerId) → tools`; every tool is owner-scoped (verified: a second account's key sees 0 timelines and is denied `get_timeline` on the demo's public id).
- Frontend: home timelines are login-gated + client-only; the canvas renders **read-only for non-owners** (`NodeDetailPanel readOnly`, hidden undo/redo + rename) and shows `notFound`/`private` states; owners get a **Share** control (toggle + copy URL) in `AppBar`.
- Seed: a **demo account** (`demo@synek.app` / `demo-password-123`, env-overridable) owns the 5 example timelines, all `isPublic: true` — so the open-canvas demo and URL-based viewing stay login-free, and signing in as demo lists them.

Verified: `typecheck` clean · `vite build` green · e2e **19/19** (home logs in as demo; node-detail edits as owner; canvas/seed-data view the public seeds anonymously; MCP keys owned by demo) · live MCP owner-isolation check.

### Still deferred

Invitations / per-user sharing ACLs (only a single public on/off), org/team workspaces, transferring ownership, public timeline discovery/listing — the rest of the **S5 — Users + signal** track.
