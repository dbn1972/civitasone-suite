# syntax=docker/dockerfile:1.7
# ─────────────────────────────────────────────────────────────────────────────
# CivitasOne Suite — apps/web (Next.js 14) production image.
# Built from the repo root context:
#   docker build -f apps/web/Dockerfile -t civitasone/web:latest .
# Matches the pm2 runtime (`next start`); no source changes required.
# ─────────────────────────────────────────────────────────────────────────────
ARG NODE_VERSION=20.20.2

FROM node:${NODE_VERSION}-bookworm-slim AS deps
ENV PNPM_HOME=/pnpm
ENV PATH=$PNPM_HOME:$PATH
RUN corepack enable && corepack prepare pnpm@9.0.0 --activate
WORKDIR /repo
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json turbo.json tsconfig.base.json ./
COPY packages ./packages
COPY services ./services
COPY apps ./apps
RUN --mount=type=cache,id=pnpm,target=/pnpm/store \
    pnpm install --frozen-lockfile --ignore-scripts || pnpm install --no-frozen-lockfile --ignore-scripts

FROM deps AS build
WORKDIR /repo
ARG NEXT_PUBLIC_API_BASE_URL=http://localhost:8080
ENV NEXT_PUBLIC_API_BASE_URL=${NEXT_PUBLIC_API_BASE_URL}
ENV NEXT_TELEMETRY_DISABLED=1
RUN pnpm --filter "@civitasone/web..." run build

FROM node:${NODE_VERSION}-bookworm-slim AS runtime
ENV NODE_ENV=production \
    PORT=3000 \
    HOSTNAME=0.0.0.0 \
    NEXT_TELEMETRY_DISABLED=1
RUN apt-get update \
 && apt-get install -y --no-install-recommends tini wget \
 && rm -rf /var/lib/apt/lists/*
WORKDIR /repo
# Whole built workspace (web depends on @civitasone/* workspace packages that
# Next resolves at runtime via node_modules symlinks).
COPY --from=build /repo ./
RUN chown -R node:node /repo
USER node
WORKDIR /repo/apps/web
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=45s --retries=3 \
  CMD wget -qO- "http://127.0.0.1:3000/" >/dev/null 2>&1 || exit 1
ENTRYPOINT ["/usr/bin/tini", "--"]
CMD ["node", "node_modules/next/dist/bin/next", "start", "-p", "3000", "-H", "0.0.0.0"]
