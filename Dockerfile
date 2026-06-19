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

# ---- runtime stage: no compilers, just the built app + node_modules ----
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

# Whole tree carried over: dist/, drizzle/ (migrations applied on boot), node_modules
# (incl. the Node-ABI better-sqlite3 binary + tsx), scripts/serve-build.ts. No *.db
# or .env are copied (see .dockerignore) — data comes from the mounted volume.
COPY --from=build /app /app

# /data is group-writable (0775, gid 10001) so the non-root user can write the
# SQLite file + WAL — both via the baked owner locally and via k8s fsGroup:10001.
RUN mkdir -p /data \
  && chown -R synek:synek /app /data \
  && chmod 0775 /data
VOLUME ["/data"]
EXPOSE 3001

USER 10001:10001

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||3001)+'/').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

# Invoke tsx directly (not `npm start`) so the image is self-contained and does not
# depend on package.json scripts. tsx is installed into node_modules above.
CMD ["./node_modules/.bin/tsx", "scripts/serve-build.ts"]
