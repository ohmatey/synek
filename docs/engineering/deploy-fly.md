---
project: "Synek"
doc: deploy
target: Fly.io
status: runbook (Phase 2 — hosted, single-instance SQLite)
updated: 2026-06-13
owner: Rook (platform) · Kael (eng)
---

# Deploying hosted Synek on Fly.io

## TLDR

Hosted Synek is a **single Fly machine** on a **persistent volume** holding one SQLite file. It is **not horizontally scalable** — two processes on one SQLite file corrupt it, and the live-canvas SSE bus is in-process. Auth is per-user (open signup + email verification via Resend). The in-app agent is **per-user BYO OpenRouter key** — the operator does NOT set `OPENROUTER_API_KEY`.

This is the local-first Core run as a hosted service; nothing about the app changes except the env it's given. The image is the existing [Dockerfile](../../Dockerfile) (migrate-on-boot, Node ABI for better-sqlite3).

## Hard constraints

- **One machine, one volume.** `min_machines_running = 1`, no scale-out (see [fly.toml](../../fly.toml)). `flyctl scale count 1` — never higher.
- **Persistent volume at `/data`** — the SQLite file (`/data/synek.db` + WAL). Losing it loses everything; back it up.
- **Migrations apply on boot** (`SYNEK_MIGRATIONS_DIR=/app/drizzle`, fail-loud in prod).

## One-time setup

1. Rename `app` in `fly.toml`, then create the app:
   ```
   flyctl apps create synek
   ```
2. Create the volume (one only — matches the one machine):
   ```
   flyctl volumes create synek_data --size 1 --region iad
   ```
3. Set secrets (never commit these; the operator/founder provides them):
   ```
   flyctl secrets set BETTER_AUTH_SECRET="$(openssl rand -base64 32)"
   ```
   ```
   flyctl secrets set BETTER_AUTH_URL="https://synek.fly.dev"
   ```
   ```
   flyctl secrets set SYNEK_SECRETS_KEY="$(openssl rand -base64 32)"
   ```
   ```
   flyctl secrets set RESEND_API_KEY="YOUR_RESEND_KEY"
   ```
   ```
   flyctl secrets set SYNEK_EMAIL_FROM="Synek <noreply@your-domain>"
   ```
   `BETTER_AUTH_URL` MUST be the public HTTPS origin — auth cookies, the MCP OAuth resource, and the verification / password-reset email links are all built from it. Use a custom domain via `flyctl certs add` if not using `*.fly.dev`.

   **Agent funding — pick a mode:**
   - **BYO-only (default).** Leave `OPENROUTER_API_KEY` UNSET. Each user pastes their own key in `/api-keys`; the operator funds nothing. The `SYNEK_AGENT_DAILY_*` ceilings are inert (BYO runs are never capped).
   - **Operator-funded built-in AI.** To let normal users use the agent without their own key, set the key as a SECRET:
     ```
     flyctl secrets set OPENROUTER_API_KEY="YOUR_OPENROUTER_KEY"
     ```
     Now the **METER safety cap** is load-bearing: the `SYNEK_AGENT_DAILY_RUNS` / `SYNEK_AGENT_DAILY_TOKENS` ceilings in `fly.toml` bound each user's operator-funded usage over a rolling 24h window (over the line → a friendly "limit reached, or add your own key" refusal). A user who adds their own key bypasses the cap (their spend). **Watch the OpenRouter bill the first weeks**, then tune the ceilings down to the real p90 from the `usage_ledger` table (`sqlite3 /data/synek.db 'select funded, count(*), sum(quantity) from usage_ledger where metric=\"agent_tokens\" group by funded'`).

## Deploy

```
flyctl deploy
```
```
flyctl scale count 1
```

## Verify (post-deploy)

- `flyctl status` — one machine, healthy (the `/` HTTP check passes).
- Open `https://<host>`, sign up two accounts; confirm the verification email arrives (Resend) and that each account sees only its own timelines (tenant isolation).
- In `/api-keys`, paste an OpenRouter key for one account; a prompt dialog's **Run** works for that account and not the other.
- `flyctl logs` — migrate-on-boot ran; no `SYNEK_SECRETS_KEY`/migrations errors.

## Notes

- **Backups:** `flyctl volumes snapshots` (or a scheduled `sqlite3 .backup`). The volume is the entire datastore.
- **Scale ceiling:** when single-writer SQLite becomes the bottleneck, the Postgres bridge (roadmap NEXT.4) is the path — schema is already kept portable. Until then, vertical scale only (`[[vm]]` size).
- **Seeding:** do NOT auto-seed a hosted instance. Seeding is opt-in; a fresh hosted DB starts empty.
