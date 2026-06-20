---
project: "Synek"
doc: deploy
target: sector137 cluster (loha / GitOps)
status: runbook (Phase 2 — hosted, single-instance SQLite, GitOps via ArgoCD)
updated: 2026-06-19
owner: Rook (platform) · Kael (eng)
supersedes: deploy-fly.md (Fly.io — retired 2026-06-19, founder decision)
---

# Deploying hosted Synek on the sector137 cluster

## TLDR

Hosted Synek runs on **the sector137 Kubernetes cluster** (the platform Aaron owns), delivered by **GitOps**: the deployment manifests live in the platform repo (`sector137-infra`), ArgoCD reconciles the cluster to them, and a sealed-secret carries the secrets. The app itself is unchanged — it is the existing single-user SQLite-on-a-volume [Dockerfile](../../Dockerfile) (migrate-on-boot, Node ABI for better-sqlite3), now built by **loha** into the cluster's Forgejo registry and rolled out by **ArgoCD Image Updater**.

The public origin is **`https://synek.sector137.io`**. Auth is per-user (open signup + email verification via Resend). The in-app agent is **per-user BYO OpenRouter key** by default — the operator does NOT set `OPENROUTER_API_KEY` unless they choose to fund a built-in agent.

> **The actuator is the repo, not the cluster.** You do not `kubectl apply` Synek by hand. You change the manifests in `sector137-infra`, commit, and ArgoCD converges the cluster. Secrets are sealed into git (encrypted); the plaintext never lands in the repo or the image.

## Hard constraints

- **One pod, one volume.** SQLite is single-writer. The Deployment is `replicas: 1` with a `Recreate` strategy and an RWO Longhorn PVC — never two pods on the one DB file, and the live-canvas SSE bus is in-process (single instance only). Do **not** scale out.
- **Persistent Longhorn volume at `/data`** — the SQLite file (`/data/synek.db` + WAL). Losing it loses everything; Longhorn replicates it 3× and snapshots it (see Backups).
- **Migrations apply on boot** (`SYNEK_MIGRATIONS_DIR=/app/drizzle`, fail-loud in prod).
- **Host must be a single label under `sector137.io`** — `synek.sector137.io` matches the cluster's `*.sector137.io` wildcard TLS cert; `foo.synek.sector137.io` would not.

## Where this is deployed from

| Thing | Location |
|---|---|
| App source + Dockerfile | this repo (`strata` / Synek) |
| loha CI pipeline (`.loha.yml`) | this repo — builds `git.sector137.io/sector137/synek-app` |
| GitOps manifests (overlay) | `sector137-infra` → `kubernetes/overlays/synek/` |
| ArgoCD Application | `sector137-infra` → `argocd/applications/apps/synek.yaml` |
| Sealed-secrets cert (to seal against) | `sector137-infra` → `scripts/sealed-secrets-cert.pem` |

## Required runtime env (exposed deploy)

An **exposed deploy** is detected at boot when `NODE_ENV=production` (the prod Docker image sets this) **or** `BETTER_AUTH_URL` points at a non-localhost origin. In that mode the app **refuses to boot** unless `BETTER_AUTH_SECRET` is set to a real value — it will not silently fall back to the in-source dev secret (which would let anyone forge sessions). It also **refuses to boot if `SYNEK_LOCAL_MODE` is set** on an exposed deploy (that flag signs every visitor in as one shared user — a total per-user-isolation bypass). Both guards live in `src/lib/auth/index.ts` (`resolveAuthSecret`, `assertLocalModeNotExposed`); each failure is loud and the safe state — a crashed boot you must fix, never a forge-able or tenant-collapsed public app.

| Env | Where | Required? | What it drives |
|---|---|---|---|
| `BETTER_AUTH_SECRET` | **sealed-secret** | **Yes** (exposed) | Session/token signing. Missing or = the dev fallback → boot refused. `openssl rand -base64 32`. |
| `BETTER_AUTH_URL` | **configmap** | **Yes** (exposed) | The public **HTTPS** origin (`https://synek.sector137.io`). Becomes `BASE_URL` → auth cookie domain, OAuth redirect, **and `MCP_RESOURCE = ${BASE_URL}/api/mcp`** (the MCP OAuth resource the synek plugin must match). A wrong value silently breaks the Claude-client connect flow. Not secret — it's a public origin — so it lives in the configmap. |
| `SYNEK_SECRETS_KEY` | **sealed-secret** | **Yes** | AES-GCM key encrypting each user's BYO OpenRouter key at rest (`user_settings`). `openssl rand -base64 32`. Lose/rotate it → stored keys become undecryptable. |
| `DATABASE_URL` | **configmap** | Yes | SQLite file on the volume — `/data/synek.db`. |
| `PORT` | **configmap** | Yes | Listen port (`3001`). Matches the Service `targetPort` and the Dockerfile `EXPOSE`. |
| `SYNEK_MIGRATIONS_DIR` | **configmap** | Yes | `/app/drizzle` — migrate-on-boot source. |
| `SYNEK_AGENT_DAILY_RUNS` / `SYNEK_AGENT_DAILY_TOKENS` | **configmap** | Optional | The METER safety cap (rolling-24h per-user ceiling). Inert in BYO-only mode (BYO runs are never capped); load-bearing only when `OPENROUTER_API_KEY` is set. Ship "on" at a conservative ceiling; `0`/unset disables that dimension. |
| `RESEND_API_KEY` | **sealed-secret** | Recommended | Verification + password-reset email (Resend). No-ops to a console warning if unset. |
| `SYNEK_EMAIL_FROM` | **configmap** | With Resend | From address for those emails (a public-ish identifier, not a secret). |
| `OPENROUTER_API_KEY` | **sealed-secret** | Optional | UNSET = per-user BYO key (default). Set = operator-funded built-in agent (then the `SYNEK_AGENT_DAILY_*` caps in the configmap are load-bearing). |
| `POSTHOG_API_KEY` / `POSTHOG_HOST` | **sealed-secret** / configmap | Optional | Server-side MCP analytics. Blank = disabled. |

> **Never set `SYNEK_LOCAL_MODE` on this deploy** — it bypasses the login wall and signs every visitor in as one shared user. The boot guard now refuses to start if it is set in exposed mode; keep it absent from the configmap regardless.

**Secret vs configmap split:** anything that signs, decrypts, or authenticates (`BETTER_AUTH_SECRET`, `SYNEK_SECRETS_KEY`, `RESEND_API_KEY`, `OPENROUTER_API_KEY`) goes in the **sealed-secret** (`synek-app-secrets`, encrypted in git). Public, non-sensitive runtime config (`BETTER_AUTH_URL`, `DATABASE_URL`, `PORT`, `SYNEK_MIGRATIONS_DIR`, the METER ceilings, `SYNEK_EMAIL_FROM`) goes in the **configmap** (`synek-config`, plain in git). The image bakes **no** secrets.

## One-time setup (founder / cluster operator)

These are the steps to go live. The manifests are already scaffolded in `sector137-infra`; what remains is the cluster-side, secret-bearing, irreversible-ish work that only the operator can do. **Order matters.**

### 1. DNS — point `synek.sector137.io` at the cluster

Add a DNS record (Cloudflare, the `sector137.io` zone) for `synek` pointing at the cluster's Traefik LoadBalancer IP (the same `192.168.1.120` the other `*.sector137.io` hosts resolve to — confirm against an existing host).

```
synek.sector137.io  →  CLUSTER_TRAEFIK_LB_IP
```

The wildcard `*.sector137.io` TLS cert already covers this host (Traefik `TLSStore` default), so there is **no per-host Certificate to create**. TLS is automatic once DNS resolves and the ingress syncs.

### 2. Seal the secrets (plaintext never enters git)

From the `sector137-infra` repo root. Generate the two app-secret values, write a plaintext Secret to `/tmp`, seal it against the committed cert, drop the sealed YAML into the overlay, and shred the plaintext.

```
cd ~/Documents/projects/sector137-infra
```

Write the plaintext Secret (replace the OpenRouter / Resend values; leave `OPENROUTER_API_KEY` out entirely for BYO-only mode):

```
cat > /tmp/synek-app-secrets-plaintext.yaml <<'EOF'
apiVersion: v1
kind: Secret
metadata:
  name: synek-app-secrets
  namespace: synek
type: Opaque
stringData:
  BETTER_AUTH_SECRET: "REPLACE_WITH_OPENSSL_RAND"
  SYNEK_SECRETS_KEY: "REPLACE_WITH_OPENSSL_RAND"
  RESEND_API_KEY: "REPLACE_WITH_RESEND_KEY"
EOF
```

Generate the two random values and paste them in (run each, copy the output into the file above):

```
openssl rand -base64 32
```
```
openssl rand -base64 32
```

Seal it into the overlay:

```
kubeseal --cert scripts/sealed-secrets-cert.pem -o yaml < /tmp/synek-app-secrets-plaintext.yaml > kubernetes/overlays/synek/secrets/synek-app-secrets.yaml
```

Shred the plaintext:

```
shred -u /tmp/synek-app-secrets-plaintext.yaml
```

Seal the registry pull-secret (`regcred`) so the cluster can pull `git.sector137.io/sector137/synek-app`:

```
kubectl create secret docker-registry regcred --namespace=synek --docker-server=git.sector137.io --docker-username=FORGEJO_USER --docker-password=FORGEJO_TOKEN_WITH_PACKAGE_READ --dry-run=client -o yaml | kubeseal --cert scripts/sealed-secrets-cert.pem -o yaml > kubernetes/overlays/synek/secrets/regcred.yaml
```

Uncomment the two `secrets/*.yaml` entries in `kubernetes/overlays/synek/kustomization.yaml`, then verify nothing plaintext slipped in:

```
grep -L encryptedData kubernetes/overlays/synek/secrets/*.yaml
```

(That should print nothing — every file under `secrets/` must contain `encryptedData`.)

### 3. Register the loha build pipeline

This repo (Synek) carries `.loha.yml` at its root — it builds `git.sector137.io/sector137/synek-app` on every push to `main`. In the loha UI (`loha.sector137.io`), connect the Synek source repo so the pipeline is registered. The first `main` build pushes the image; ArgoCD Image Updater then writes the resolved tag back into `kubernetes/overlays/synek/kustomization.yaml`.

### 4. Commit + push the overlay + Application

```
cd ~/Documents/projects/sector137-infra
```
```
git add argocd/applications/apps/synek.yaml kubernetes/overlays/synek/
```
```
git commit -m "feat(synek): GitOps overlay + ArgoCD Application for synek.sector137.io"
```
```
git push
```

The `apps-root` app-of-apps (recurse over `argocd/applications/apps/`) picks up `synek.yaml` and creates the ArgoCD Application; ArgoCD then syncs the `kubernetes/overlays/synek/` overlay (sync-wave 5 — after platform components). `CreateNamespace=true` creates the `synek` namespace.

### 5. First sync + verify

ArgoCD auto-syncs (`automated: { prune, selfHeal }`). Watch it land:

```
kubectl -n synek get pods,pvc,ingress,svc
```

Expected: one `synek` pod `Running` and `Ready` (the `/api/health` probe passes), a bound `synek-data` PVC, the `synek` Service, and the `synek` Ingress on `synek.sector137.io`.

### 6. Enable the daily backup (one-off)

The `synek-data` PVC already carries the opt-in label (synced by ArgoCD), but the Longhorn `RecurringJob` is bootstrapped imperatively (it lives in `longhorn-system`, like the BackupTarget). Apply it once:

```
cd ~/Documents/projects/sector137-infra
```
```
kubectl apply -f kubernetes/base/platform/longhorn/recurringjob-synek-backup.yaml
```

Verify:

```
kubectl -n longhorn-system get recurringjobs
```

(Re-running `scripts/bootstrap-longhorn.sh` does the same thing idempotently.)

## Verify (post-deploy)

- ArgoCD: the `synek` Application is `Synced` + `Healthy`.
- `kubectl -n synek logs deploy/synek` — migrate-on-boot ran; no `BETTER_AUTH_SECRET` / `SYNEK_SECRETS_KEY` / migrations errors, and **no `SYNEK_LOCAL_MODE` refusal** (it must be unset).
- Open `https://synek.sector137.io` — TLS valid (wildcard cert), sign up two accounts, confirm the verification email arrives (Resend) and that each account sees only its own timelines (tenant isolation).
- In `/api-keys`, paste an OpenRouter key for one account; a prompt dialog's **Run** works for that account and not the other.

## Connect a power user's MCP client (the synek plugin → hosted origin)

Hosting the viewer is only half of it — the point of the cloud deploy is that a remote power user can drive it from **their own** Claude Code. The synek plugin (`synek-plugin/`) connects over OAuth and is origin-configurable; pointing it at this deploy is a one-variable change on the user's side. No `.mcp.json` edit, no token paste.

**Prerequisite (server side):** `BETTER_AUTH_URL` is set to `https://synek.sector137.io` (see the env table above). That value flows to `BASE_URL` → `MCP_RESOURCE = ${BASE_URL}/api/mcp` and into every OAuth discovery document (`/.well-known/oauth-protected-resource`, `/.well-known/oauth-authorization-server`) and the `401 WWW-Authenticate` challenge — all origin-relative, nothing hardcodes localhost. If `BETTER_AUTH_URL` is wrong, the connect flow breaks silently; this is the one value that must be exactly the public origin.

**What the power user does:**

1. Install the synek plugin in their Claude Code (from the marketplace, or a local plugin dir).
2. Point it at this deploy by setting `SYNEK_MCP_URL` to the deploy's MCP endpoint **before launching `claude`**. This is the public origin + `/api/mcp`, no trailing slash:
   ```
   export SYNEK_MCP_URL=https://synek.sector137.io/api/mcp
   ```
   The plugin's bundled `.mcp.json` reads `${SYNEK_MCP_URL:-http://localhost:3001/api/mcp}` — unset = the local default (BYO local-first path, unchanged); set = this hosted origin. The variable is read from the shell environment at launch, so set it in the shell profile for a persistent connection.
3. Sign up / log in once at `https://synek.sector137.io` — email + password. That session is what the OAuth consent screen approves.
4. In Claude Code, run `/mcp` → select **synek** → **Authenticate**. A browser opens against the hosted origin → approve. Tokens refresh automatically after that.
5. Verify: `/synek:setup` (calls `list_timelines`) reports green, or run `/synek:map the space race` and open the returned canvas link.

**Why this works over HTTPS the same as localhost:** the OAuth callback is a loopback on the *user's* machine (`http://localhost:PORT/callback`), independent of where the server is hosted; Claude Code performs the full handshake against the discovery documents the server advertises from its own origin. The Better Auth `mcp` plugin does dynamic client registration, so there is no per-user redirect-URI to pre-register.

**Local-first is untouched.** A user who never sets `SYNEK_MCP_URL` connects to their own `http://localhost:3001` exactly as before — hosting is additive, opt-in configurability, not a replacement.

## Backups (local-103)

The Longhorn PVC (`synek-data`) is the entire datastore. Two layers protect it:

1. **Longhorn 3× replication** — the volume is replicated across three nodes (the cluster default storage class). A single node/disk loss does not lose data.
2. **A daily Longhorn `RecurringJob` → the in-cluster MinIO S3 backup target** — captures a point-in-time backup off the live replicas, so a logical corruption (a bad migration, an `rm`) is recoverable, not just a hardware loss. 7 backups retained (a week of restore points).

**Why this, not Litestream:** the cluster already has a Longhorn `BackupTarget` wired to MinIO (`sector137-infra/kubernetes/base/platform/longhorn/backuptarget-default.yaml` → `s3://longhorn-backups`). Backing up the whole volume needs zero app changes and no second process touching the single-writer SQLite file. Litestream would give a finer RPO (WAL streaming) but requires a sidecar reading the live DB — more moving parts against a single-writer file, and a dependency the image doesn't carry. For one small SQLite file, a daily volume backup is the right floor (survives both node loss and logical corruption). Revisit Litestream only if a ≤24h RPO proves too coarse.

**How it's wired (matches the existing Longhorn convention):** Longhorn RecurringJobs live in `longhorn-system` and are bootstrapped imperatively (like the BackupTarget), **not** via ArgoCD:
- The job manifest is `sector137-infra/kubernetes/base/platform/longhorn/recurringjob-synek-backup.yaml` and is applied by `scripts/bootstrap-longhorn.sh` (re-run it, idempotent, or `kubectl apply -f` the one file).
- The `synek-data` PVC **opts in** via a `recurring-job.longhorn.io/synek-daily-backup: enabled` label — that part IS in the GitOps overlay (`pvc.yaml`), so ArgoCD owns the opt-in and the bootstrap owns the schedule.

To run a one-off backup or restore, use the Longhorn UI or `kubectl -n longhorn-system get backups`.

## Notes

- **Scale ceiling:** when single-writer SQLite becomes the bottleneck, the Postgres bridge (roadmap NEXT.4) is the path — the schema is already kept portable, and the cluster has CNPG available. Until then, vertical scale only (the Deployment `resources` limits).
- **Seeding:** do NOT auto-seed the hosted instance. Seeding is opt-in; a fresh hosted DB starts empty.
- **Rollback:** every change here is a git revert in `sector137-infra` — ArgoCD reconciles back. The one exception is the sealed-secret values (re-seal to rotate) and the Longhorn volume data (restore from snapshot).
