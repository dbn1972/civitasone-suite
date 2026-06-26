# CivitasOne Suite — Deployment Guide

Two supported targets: **Docker Compose** (single host / on-prem box) and
**Helm** (Kubernetes). Both build from the same images. No secrets live in any
committed file — they are injected via env files (compose) or a Kubernetes
Secret (helm).

## Components

- **31 HTTP services** (Fastify, `dist/index.js`) + **queue** (`dist/server.js`)
  + **gateway** (`dist/index.js`, public) + **web** (Next.js).
- **CQRS workers** (`dist/worker.js`) for the services that ship one.
- Infra: PostgreSQL, Redis, Keycloak (OIDC/RS256), LocalStack (SQS/S3) or real AWS.

All images are built from:
- `Dockerfile` (repo root) — one parametrized multi-stage build for every
  service/worker (`--build-arg SERVICE=<name>-service ENTRY=dist/index.js PORT=<n>`).
- `apps/web/Dockerfile` — Next.js production image.

Containers run as the non-root `node` user (uid 1000), `NODE_ENV=production`,
bind `0.0.0.0`, and expose `/health` (liveness) and `/ready` (readiness).

---

## A. Docker Compose

```bash
cd <repo-root>
cp infra/.env.prod.example infra/.env      # fill REAL secrets; infra/.env is git-ignored
docker compose -f infra/docker-compose.prod.yml --env-file infra/.env build
docker compose -f infra/docker-compose.prod.yml --env-file infra/.env up -d
```

Validate the file without building:

```bash
docker compose -f infra/docker-compose.prod.yml --env-file infra/.env config -q
```

Every required secret uses `${VAR:?}` — compose refuses to start if unset.
The gateway is published on `${GATEWAY_PORT:-8080}`, web on `${WEB_PORT:-3000}`.

### Build & push to a registry

```bash
export IMAGE_REGISTRY=harbor.example.com/civitasone IMAGE_TAG=1.0.0
docker compose -f infra/docker-compose.prod.yml --env-file infra/.env build
docker compose -f infra/docker-compose.prod.yml --env-file infra/.env push
```

### Build a single service image manually

```bash
docker build -f Dockerfile \
  --build-arg SERVICE=identity-service \
  --build-arg ENTRY=dist/index.js \
  --build-arg PORT=3001 \
  -t civitasone/identity-service:latest .
```

---

## B. Helm (Kubernetes)

Chart: `infra/onprem/helm/civitasone`. It loops over `values.yaml > services`
to render a Deployment (+ Service + optional worker Deployment + optional HPA)
for all services, plus gateway, web, ConfigMap, ServiceAccount and Ingress.

### 1. Create the secret (out-of-band — never in values)

```bash
kubectl create secret generic civitasone-secrets \
  --from-literal=INTERNAL_SERVICE_SECRET=... \
  --from-literal=DEVICE_TRUST_SECRET=... \
  --from-literal=DATABASE_PASSWORD=... \
  --from-literal=MFA_ENC_KEY=... \
  --from-literal=PII_ENC_KEY=... \
  --from-literal=CITIZEN_PII_KEY=... \
  --from-literal=CRM_PII_KEY=...
```

### 2. Lint & render

```bash
helm lint infra/onprem/helm/civitasone
helm template civ infra/onprem/helm/civitasone --set ingress.host=civitasone.example.gov.in
```

### 3. Install / upgrade

```bash
helm upgrade --install civitasone infra/onprem/helm/civitasone \
  --namespace civitasone --create-namespace \
  --set image.registry=harbor.example.com/civitasone \
  --set image.tag=1.0.0 \
  --set ingress.host=civitasone.example.gov.in \
  --set autoscaling.enabled=true
```

Key values:
- `image.registry` / `image.tag` — image source (`<registry>/<svc>-service:<tag>`).
- `existingSecret` — name of the pre-created Secret (default `civitasone-secrets`).
- `config.*` — non-secret env (Redis/Keycloak/DB host) rendered into a ConfigMap.
- `services.<name>.replicas` — per-service replica count.
- `autoscaling.enabled` — switch to HPA-driven scaling for HTTP services.
- `ingress.host` — **required**; routes `/api`→gateway, `/`→web.

PostgreSQL/Redis/Keycloak/Meilisearch are expected as in-cluster dependencies
(e.g. Bitnami charts at `civitasone-postgresql`, `civitasone-redis`,
`civitasone-keycloak`) or external endpoints — point `config.DATABASE_HOST`,
`config.REDIS_URL`, `config.KEYCLOAK_URL` at them.

---

## Residual / out of scope

- Real container registry + Kubernetes cluster are required for an actual
  rollout (the chart references images by `<registry>/<svc>:<tag>`).
- Stateful infra charts (Postgres/Redis/Keycloak/Meilisearch subcharts) are
  referenced but not vendored here — wire them as dependencies or point at
  managed endpoints.
- DB bootstrap SQL (`infra/db/bootstrap/*.sql`) is mounted into the compose
  Postgres init dir; on Kubernetes run it as a Job/initContainer against the DB.
