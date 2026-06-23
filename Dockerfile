# Synek — single-user, self-hostable image.
#
# Runtime is NODE (not Bun): the app links better-sqlite3's native Node-ABI binary,
# which Bun cannot load. We therefore install + build with Node so the compiled
# .node matches the runtime, and run the server under tsx via the same
# scripts/serve-build.ts the e2e harness uses.
#
# Data lives in SQLite at $DATABASE_URL — mount a PERSISTENT volume at /data or a
# redeploy wipes every timeline. SINGLE WRITER ONLY: run exactly one container and
# do NOT also run the stdio MCP server against the same file. Do not horizontally
# scale — SQLite + WAL is one writer.
#
#   docker build -t synek .
#   docker run -d --name synek -p 3001:3001 \
#     -v synek-data:/data \
#     -e BETTER_AUTH_SECRET="$(openssl rand -base64 32)" \
#     -e BETTER_AUTH_URL="https://your.public.host" \
#     synek
#
# BETTER_AUTH_URL MUST be the real public origin (it drives the auth cookie, the
# OAuth redirect, and the MCP resource id). Terminate TLS in front (Caddy/Traefik/
# platform) — OAuth + secure cookies need HTTPS.
#
# Opt-in self-hoster telemetry (LATER.3): the PUBLISHED image bakes the project's
# own PostHog *ingest* key (phc_…, public/write-only by design) via the build arg
# below, so an operator who opts IN at run time sends ONE anonymous heartbeat
# (install_id hash, version, db_backend) per boot — never any graph content. The
# opt-in flag is NOT baked, so a default image still sends nothing. Operators
# consent at run time:  -e SYNEK_TELEMETRY=1
#   docker build --build-arg SYNEK_TELEMETRY_KEY=phc_xxx -t synek .   # publisher
#   docker run ... -e SYNEK_TELEMETRY=1 synek                          # operator opts in
#
# IMAGE SIZE: the runtime stage carries ONLY production node_modules (dev tooling —
# vite, playwright, typescript, tailwind, drizzle-kit, @types — is pruned after the
# build) plus the built dist/, migrations, and the tsx entry script. This keeps every
# layer small enough to push through a size-capped ingress (e.g. Cloudflare's ~100MB
# request limit); a single fat node_modules layer would 413. tsx is a *runtime*
# dependency here (it launches the server), so it lives in package.json dependencies.

# ---- build stage: full toolchain, compile native deps, produce dist/ ----
FROM node:22-bookworm-slim AS build
WORKDIR /app

# better-sqlite3 builds from source when no prebuilt matches this Node/platform.
RUN apt-get update \
  && apt-get install -y --no-install-recommends python3 make g++ ca-certificates \
  && rm -rf /var/lib/apt/lists/*

# Install against package.json (the repo is bun-locked; for byte-reproducible
# installs generate a package-lock.json and switch this to `npm ci`).
COPY package.json ./
COPY packages ./packages
RUN npm install

COPY . .
RUN npm run build

# Drop dev-only dependencies so the runtime node_modules is lean. better-sqlite3's
# compiled .node and tsx survive (both are production deps); migrations run via
# drizzle-orm's migrator at boot, NOT the drizzle-kit CLI, so pruning it is safe.
RUN npm prune --omit=dev

# ---- runtime stage: no compilers, only the built app + production node_modules ----
FROM node:22-bookworm-slim AS runtime
WORKDIR /app
# Project-owned PostHog ingest key for the opt-in heartbeat (blank = an image that
# never phones home). Public/write-only key — safe to bake. Override at build:
# --build-arg SYNEK_TELEMETRY_KEY=phc_xxx
ARG SYNEK_TELEMETRY_KEY=
ENV NODE_ENV=production \
    PORT=3001 \
    DATABASE_URL=/data/synek.db \
    SYNEK_MIGRATIONS_DIR=/app/drizzle \
    SYNEK_TELEMETRY_KEY=$SYNEK_TELEMETRY_KEY \
    SYNEK_TELEMETRY_HOST=https://us.i.posthog.com

# Non-root user with a FIXED uid/gid so Kubernetes can own the SQLite data volume
# deterministically (the Deployment sets fsGroup/runAsUser to 10001) and a local
# `docker run -v synek-data:/data` gets a volume Docker pre-seeds with this owner.
RUN groupadd --system --gid 10001 synek \
  && useradd --system --uid 10001 --gid synek synek

# Copy ONLY what the server needs at runtime, each as its own layer so none is huge:
#   node_modules — pruned to prod deps (incl. the better-sqlite3 .node + tsx)
#   dist/        — vite build output (client assets + server bundle)
#   drizzle/     — migrations applied on boot via drizzle-orm
#   scripts/     — serve-build.ts entry
#   src/         — TS imported by the entry at runtime (e.g. telemetry/heartbeat)
#   package.json — ESM "type":"module" resolution for tsx
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY --from=build /app/drizzle ./drizzle
COPY --from=build /app/scripts ./scripts
COPY --from=build /app/src ./src
COPY --from=build /app/package.json ./package.json

# /data is group-writable (0775, gid 10001) so the non-root user can write the
# SQLite file + WAL — both via the baked owner locally and via k8s fsGroup:10001.
RUN mkdir -p /data \
  && chown -R synek:synek /app /data \
  && chmod 0775 /data
VOLUME ["/data"]
EXPOSE 3001

USER 10001:10001

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||3001)+'/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

# Invoke tsx directly (not `npm start`) so the image is self-contained and does not
# depend on package.json scripts. tsx is a production dependency (see note above).
CMD ["./node_modules/.bin/tsx", "scripts/serve-build.ts"]
