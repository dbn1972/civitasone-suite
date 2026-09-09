# syntax=docker/dockerfile:1.7
# ─────────────────────────────────────────────────────────────────────────────
# CivitasOne Suite — shared multi-stage Dockerfile for all Fastify services
# + workers. Parametrized by build args so a single file builds every service.
#
#   docker build -f Dockerfile \
#     --build-arg SERVICE=identity-service \
#     --build-arg ENTRY=dist/index.js \
#     --build-arg PORT=3001 \
#     -t civitasone/identity-service:latest .
#
# The whole pnpm workspace is needed at build time because every service
# depends on workspace packages (@civitasone/*). turbo builds those first
# (^build). The runtime image is a slim, non-root node:20 with only the
# workspace dist + production node_modules.
# ─────────────────────────────────────────────────────────────────────────────

ARG NODE_VERSION=20.20.2

# ── deps: install full workspace (incl. dev deps) for the build ──────────────
FROM node:${NODE_VERSION}-bookworm-slim AS deps
ENV PNPM_HOME=/pnpm
ENV PATH=$PNPM_HOME:$PATH
RUN corepack enable && corepack prepare pnpm@9.0.0 --activate
WORKDIR /repo
# Copy manifests + lockfile first for better layer caching.
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json turbo.json tsconfig.base.json ./
COPY packages ./packages
COPY services ./services
COPY apps ./apps
RUN --mount=type=cache,id=pnpm,target=/pnpm/store \
    pnpm install --frozen-lockfile --ignore-scripts || pnpm install --no-frozen-lockfile --ignore-scripts

# ── build: compile the whole workspace (turbo builds deps first) ─────────────
FROM deps AS build
WORKDIR /repo
ARG SERVICE
# Build the target service and everything it depends on.
RUN pnpm --filter "@civitasone/${SERVICE}..." run build

# ── prune: produce a production-only node_modules for the runtime ────────────
# NOTE (SEC-004 fixup): this stage used to be `FROM deps` — which already has
# the FULL (dev+prod) node_modules installed on disk — and ran
# `pnpm install --frozen-lockfile --prod` on top of it. That does NOT
# retroactively remove devDependencies already present (confirmed: adding an
# explicit `pnpm prune --prod` afterwards *also* left them, since pnpm's
# workspace-wide prune did not touch the already-linked .pnpm store content in
# this version). The fix is to never let a full dev install happen in this
# stage's history: build it fresh, independently of `deps`, from just the
# lockfile + manifests, so `--prod` genuinely never resolves devDependencies.
# Without this, every runtime image shipped every service's dev/test/build
# tooling (stryker, vitest, eslint, ...) — confirmed via a live Trivy scan of
# the actual `civitasone/*-service:scan` images built from this Dockerfile,
# which turned up ~70 avoidable HIGH/CRITICAL node-pkg CVE findings per image,
# all traceable to this one gap.
FROM node:${NODE_VERSION}-bookworm-slim AS prune
ENV PNPM_HOME=/pnpm
ENV PATH=$PNPM_HOME:$PATH
RUN corepack enable && corepack prepare pnpm@9.0.0 --activate
WORKDIR /repo
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json turbo.json tsconfig.base.json ./
COPY packages ./packages
COPY services ./services
COPY apps ./apps
RUN --mount=type=cache,id=pnpm,target=/pnpm/store \
    pnpm install --frozen-lockfile --prod --ignore-scripts || pnpm install --no-frozen-lockfile --prod --ignore-scripts

# ── runtime: slim, non-root ──────────────────────────────────────────────────
FROM node:${NODE_VERSION}-bookworm-slim AS runtime
ARG SERVICE
ARG ENTRY=dist/index.js
ARG PORT=3000
ENV NODE_ENV=production \
    PORT=${PORT} \
    BIND_HOST=0.0.0.0 \
    SERVICE_DIR=/repo/services/${SERVICE} \
    SERVICE_ENTRY=${ENTRY}
# tini for proper signal handling; wget for the healthcheck.
# SEC-004 fixup: also apply available Debian point-release security updates
# (apt-get upgrade) — a live Trivy scan found fixed-but-unapplied CRITICAL/HIGH
# CVEs in the base image's libgnutls30/libcap2 packages (e.g. CVE-2026-33845),
# each with a point-release fix already published in the same Debian 12
# release. This is a same-release patch bump, not a base-image major upgrade.
RUN apt-get update \
 && apt-get upgrade -y \
 && apt-get install -y --no-install-recommends tini wget \
 && rm -rf /var/lib/apt/lists/*
# SEC-004 fixup: strip the npm CLI bundled into the base node image. It is
# never invoked at runtime (the container runs `node <entry>` directly; pnpm
# is only used at build time, in a different stage) but its own bundled
# dependencies (tar, pacote, sigstore, ip-address, minimatch, ...) still show
# up as real, fixable CRITICAL/HIGH CVEs in a Trivy scan of the shipped image.
# Removing unused CLI tooling from a runtime image is standard hardening, and
# a live Trivy scan confirmed it also eliminates this whole finding category.
RUN rm -rf /usr/local/lib/node_modules/npm \
           /usr/local/bin/npm /usr/local/bin/npx /usr/local/bin/corepack
WORKDIR /repo
# Bring in the pruned (prod-only) workspace node_modules + package manifests,
# then overlay the compiled dist output from the build stage.
COPY --from=prune  /repo/node_modules        ./node_modules
COPY --from=prune  /repo/packages            ./packages
COPY --from=prune  /repo/services            ./services
COPY --from=prune  /repo/package.json        ./package.json
COPY --from=prune  /repo/pnpm-workspace.yaml ./pnpm-workspace.yaml
COPY --from=build  /repo/packages            ./packages
COPY --from=build  /repo/services            ./services
# Drop privileges — node:20 image ships an unprivileged `node` user.
RUN chown -R node:node /repo
USER node
WORKDIR /repo/services/${SERVICE}
EXPOSE ${PORT}
HEALTHCHECK --interval=30s --timeout=5s --start-period=40s --retries=3 \
  CMD wget -qO- "http://127.0.0.1:${PORT}/health" >/dev/null 2>&1 || exit 1
ENTRYPOINT ["/usr/bin/tini", "--"]
CMD ["sh", "-c", "node ${SERVICE_ENTRY}"]
