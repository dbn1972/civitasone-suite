# CivitasOne Suite — Deployment Guide

**Version:** 0.1.0 · **License:** AGPL-3.0 · **Audience:** Platform / DevOps engineers

CivitasOne is a multi-tenant governance platform for Indian Government, PSU, Section-8,
cooperative, and small-office deployments. It comprises **33 Fastify microservices**, a
**Next.js 14** web front-end, and a **Flutter 3.3+** mobile app, backed by **PostgreSQL 16**,
**Redis 7**, **AWS SQS**, and **Keycloak 24** (RS256 OIDC).

This guide covers every supported deployment target: Docker Compose (dev/staging),
Kubernetes via the shipped Helm chart (production), AWS via Terraform, and an on-prem
Ansible pattern. It also documents the full environment-variable reference, database
migration strategy, per-service health endpoints, and rollback procedures.

---

## 1. Architecture at a glance

Every service is independently deployable, owns its **own PostgreSQL database**
(`civitas_<service>`, database-per-service, 32 databases total), and exposes a uniform ops
surface (`/health`, `/ready`, `/metrics`, `/openapi.json`). East–west traffic between
services is authenticated with `INTERNAL_SERVICE_SECRET`; north–south client traffic enters
through the **gateway** edge reverse proxy on port **8080**.

```mermaid
graph TD
    subgraph Clients
        WEB[Next.js 14 Web]
        MOB[Flutter Mobile]
    end

    WEB --> GW
    MOB --> GW

    GW[Gateway edge proxy :8080]
    KC[Keycloak 24 OIDC RS256]

    GW -->|JWT verify via JWKS| KC

    subgraph Core Platform
        ID[identity :3001]
        TEN[tenant :3002]
        POL[policy :3003]
        AUD[audit :3004]
        INST[install :3005]
        NOT[notification :3006]
    end

    subgraph Business Services
        FIN[finance :3007]
        PROC[procurement :3008]
        CON[contract :3009]
        HR[hrms :3012]
        PAY[payroll :3013]
        WF[workflow :3029]
        ANA[analytics :3031]
    end

    GW --> ID & TEN & POL & AUD & INST & NOT
    GW --> FIN & PROC & CON & HR & PAY & WF & ANA

    ID & TEN & POL & AUD & FIN & PROC --> PG[(PostgreSQL 16<br/>via pgbouncer :6432)]
    ID & TEN & POL & FIN --> RD[(Redis 7)]
    AUD & NOT & WF --> SQS[[AWS SQS / LocalStack]]
```

Full service/port map is in [§6 Environment reference](#6-environment-variable-reference).

---

## 2. Docker Compose (dev & staging)

Two compose files ship in the repository:

| File | Purpose |
|------|---------|
| `infra/docker-compose.yml` | Local development. Brings up Postgres 16, Redis 7, Keycloak 24, **LocalStack** (SQS), pgbouncer, and all services with hot-reload. |
| `infra/docker-compose.prod.yml` | Single-host staging / small production. Pinned image tags, no LocalStack (uses real SQS), resource limits, restart policies. |

### 2.1 Development bring-up

```bash
# From repo root
cp .env.example .env                 # fill secrets — see §6

# Infra first (Postgres, Redis, Keycloak, LocalStack, pgbouncer)
docker compose -f infra/docker-compose.yml up -d postgres redis keycloak localstack pgbouncer

# Bootstrap the 32 per-service databases + run migrations
pnpm run db:bootstrap                 # creates civitas_<service> databases
pnpm -r run db:migrate                # Drizzle migrations, all workspaces

# Bring up application services
docker compose -f infra/docker-compose.yml up -d
```

LocalStack emulates SQS in dev; services point at it via `AWS_ENDPOINT_URL=http://localstack:4566`.

### 2.2 Staging (single host)

```bash
docker compose -f infra/docker-compose.prod.yml pull
docker compose -f infra/docker-compose.prod.yml up -d
```

Staging uses **real AWS SQS** — leave `AWS_ENDPOINT_URL` unset so the AWS SDK resolves the
regional endpoint. Point services at a managed Postgres (or a hardened single node) and set
`DATABASE_URL` through pgbouncer (`:6432`).

---

## 3. Kubernetes / Helm (production)

The production target is Kubernetes. A first-class Helm chart lives at
`infra/onprem/helm/civitasone`. Real templates in the chart:

| Template | Renders |
|----------|---------|
| `templates/deployment.yaml` | One `Deployment` per service, env from `configmap` + `existingSecret`, liveness/readiness probes wired to `/health` and `/ready`. |
| `templates/service.yaml` | `ClusterIP` `Service` per microservice on its assigned port. |
| `templates/gateway.yaml` | The edge gateway Deployment + Service on `:8080`. |
| `templates/ingress.yaml` | TLS ingress terminating at the gateway. |
| `templates/hpa.yaml` | `HorizontalPodAutoscaler` (CPU/mem targets) per service. |
| `templates/pdb.yaml` | `PodDisruptionBudget` to preserve quorum during node drains. |
| `templates/networkpolicy.yaml` | East–west lockdown: only gateway → service and service → its DB/Redis/SQS egress. |
| `templates/configmap.yaml` | Non-secret env (ports, URLs, TTLs). |
| `templates/serviceaccount.yaml` | Per-workload SA (IRSA-friendly for AWS). |
| `templates/_helpers.tpl` | Shared naming/label helpers. |

### 3.1 Install

```bash
# Secrets are supplied out-of-band as a k8s Secret named civitasone-secrets
kubectl create secret generic civitasone-secrets \
  --from-env-file=./secrets.env -n civitasone

helm upgrade --install civitasone infra/onprem/helm/civitasone \
  --namespace civitasone --create-namespace \
  --set image.tag=0.1.0 \
  --set existingSecret=civitasone-secrets \
  --set ingress.host=civitasone.gov.example.in \
  -f values.production.yaml
```

`existingSecret` must reference `civitasone-secrets`; the chart never templates raw secret
values. Non-secret config (ports, cache TTLs, service URLs) comes from the `ConfigMap`.

### 3.2 Probe wiring

Every Deployment sets:

```yaml
livenessProbe:
  httpGet: { path: /health, port: <svc-port> }
  initialDelaySeconds: 10
  periodSeconds: 15
readinessProbe:
  httpGet: { path: /ready, port: <svc-port> }
  periodSeconds: 10
  failureThreshold: 3
```

`/ready` returns **503** if the service cannot reach its DB, Redis, or SQS, so a service is
removed from Endpoints during dependency outages rather than serving errors.

---

## 4. AWS (Terraform)

Terraform lives at `infra/aws`:

- `infra/aws/envs/production` — the production environment root module (VPC wiring, EKS/RDS
  references, and the SQS queues consumed by services).
- `infra/aws/modules/sqs` — reusable SQS module (main queue + dead-letter queue per topic,
  redrive policy, encryption).

```bash
cd infra/aws/envs/production
terraform init
terraform plan  -out tfplan
terraform apply tfplan
```

The SQS module provisions the queues that `notification`, `audit`, `workflow`, and other
event-producing services publish to via the embedded `@civitasone/queue` library. In AWS,
services authenticate to SQS with IRSA (mapped through the chart's `serviceaccount.yaml`),
so no static AWS keys are needed.

---

## 5. On-prem with Ansible (recommended pattern — not a shipped playbook)

> **Honesty note:** there is **no Ansible playbook in the repository today.** The Helm chart
> under `infra/onprem/helm/civitasone` is the supported on-prem artifact. The following is a
> *recommended* Ansible pattern for air-gapped government data centres that prefer VM-based
> deployment over Kubernetes. Treat it as a design you would author, not something you can
> `ansible-playbook` out of the box.

Recommended role layout:

```
ansible/
  inventories/prod/hosts.ini      # db, cache, app, gateway groups
  roles/
    postgres/                     # PG16 install, civitas_<service> DBs, RLS GUC
    pgbouncer/                    # transaction-mode pooler on :6432
    redis/                        # Redis 7 with maxmemory-policy
    keycloak/                     # realm import from infra/keycloak
    civitas_service/              # systemd unit per service, env from vault
    gateway/                      # edge proxy on :8080 + TLS
    observability/                # Prometheus, Grafana, Alertmanager
  site.yml
```

Key practices to encode in the roles:

- Store all secrets in **Ansible Vault**; render them into per-service `EnvironmentFile=`
  systemd drop-ins (mirrors the k8s `existingSecret` model).
- Import the Keycloak realm from `infra/keycloak` during the `keycloak` role.
- Reuse the same Prometheus/Grafana/Alertmanager configs shipped in `infra/observability`.
- Run `pnpm -r run db:migrate` from a one-shot `civitas_migrate` play gated behind a
  maintenance flag (see §7).

---

## 6. Environment variable reference

### 6.1 Shared across every service

| Variable | Purpose |
|----------|---------|
| `NODE_ENV` | `development` / `production`. |
| `PORT` | Service listen port (see §6.3 table). |
| `DATABASE_URL` | Postgres DSN, **routed through pgbouncer** `:6432`, DB = `civitas_<service>`. |
| `REDIS_URL` | Redis 7 connection string for the read-through cache. |
| `QUEUE_DRIVER` | Queue broker: `sqs` (AWS/LocalStack), `rabbitmq` (on-prem), or `memory` (tests). |
| `AWS_REGION` | SQS region (when QUEUE_DRIVER=sqs, e.g. `ap-south-1`). |
| `AWS_ENDPOINT_URL` | **Dev only** — `http://localstack:4566`. Unset in AWS to use the real endpoint. |
| `RABBITMQ_URL` | RabbitMQ connection (when QUEUE_DRIVER=rabbitmq, e.g. `amqp://user:pass@rabbit:5672`). |
| `KEYCLOAK_URL` | Keycloak base URL for OIDC discovery. |
| `KEYCLOAK_REALM` | Realm name (imported from `infra/keycloak`). |
| `JWKS_URI` | JWKS endpoint used to verify RS256 access tokens. |
| `METRICS_TOKEN` | Bearer token guarding `GET /metrics` (else internal-IP allowlist). |
| `INTERNAL_SERVICE_SECRET` | Shared secret authenticating east–west service calls. |
| `SEARCH_ENGINE` | Search provider: `meilisearch` (default) or `opensearch`. |
| `MEILISEARCH_HOST` | Meilisearch URL (when `SEARCH_ENGINE=meilisearch`). Default: `http://localhost:7700`. |
| `MEILISEARCH_API_KEY` | Meilisearch API key. |
| `OPENSEARCH_NODE` | OpenSearch URL (when `SEARCH_ENGINE=opensearch`). Default: `http://localhost:9200`. |
| `OPENSEARCH_USERNAME` | OpenSearch basic auth username. |
| `OPENSEARCH_PASSWORD` | OpenSearch basic auth password. |
| `PII_ENC_KEY` | AES-256-GCM key for PII field encryption (32 bytes, base64). |
| `LOG_LEVEL` | pino level (`info` default). Logs are structured JSON. |

### 6.2 Service-specific examples

| Service | Notable env |
|---------|-------------|
| `notification :3006` | `SQS_NOTIFICATION_QUEUE_URL`, SMTP/SMS provider creds. |
| `finance :3007` | `SQS_OUTBOX_QUEUE_URL` (transactional outbox relay). |
| `payroll :3013` | `PFMS_*` integration creds for e-payment. |
| `audit :3004` | `AUDIT_HASH_SEED` for the append-only SHA-256 chain. |
| `gateway :8080` | `UPSTREAM_*` service URLs, rate-limit config. |

### 6.3 Service → port map

| Service | Port | Service | Port |
|---------|------|---------|------|
| identity | 3001 | asset | 3015 |
| tenant | 3002 | report | 3016 |
| policy | 3003 | plugin | 3017 |
| audit | 3004 | theme | 3018 |
| install | 3005 | grant | 3019 |
| notification | 3006 | citizen | 3020 |
| finance | 3007 | legal | 3021 |
| procurement | 3008 | admin | 3022 |
| contract | 3009 | billing | 3023 |
| estab | 3010 | crm | 3024 |
| stock | 3011 | inventory | 3025 |
| hrms | 3012 | telephony | 3026 |
| payroll | 3013 | helpdesk | 3027 |
| project | 3014 | knowledge | 3028 |
| workflow | 3029 | analytics | 3031 |
| location | 4012 | gateway | 8080 |

`queue` is an **embedded library** (`@civitasone/queue`), not a network service — it is
imported by producers/consumers rather than deployed separately. pgbouncer listens on
**6432** (transaction mode).

---

## 7. Database migration strategy

- **Database-per-service.** Each of the 32 services owns `civitas_<service>`; there is no
  shared schema and no cross-service foreign keys.
- **Drizzle ORM 0.30.** Migrations are generated and versioned per service. Apply with:

  ```bash
  # single service
  pnpm --filter @civitasone/finance run db:migrate
  # all services
  pnpm -r run db:migrate
  ```

- **Bootstrap** the databases before first migration with `pnpm run db:bootstrap`.
- **Row-Level Security.** Tenant-scoped tables enforce RLS on `tenant_id`; every
  tenant-scoped transaction sets the `current_tenant_id()` GUC so RLS policies isolate data.
- **Order of operations on deploy:** run migrations *before* rolling out new service pods.
  Migrations must be **backward-compatible** (expand → migrate → contract) so old pods keep
  running during the roll-out.
- **Money columns** are `BigInt` **paise** — never floats. Migrations that touch money must
  preserve integer typing.

---

## 8. Health-check endpoints

All 33 services expose the same ops surface:

| Endpoint | Semantics |
|----------|-----------|
| `GET /health` | Liveness — process is up. Cheap, no dependency checks. |
| `GET /ready` | Readiness — checks DB, Redis, and SQS. Returns **503** on any failure so the pod leaves Endpoints. |
| `GET /metrics` | Prometheus exposition. Guarded by `METRICS_TOKEN` bearer or internal-IP allowlist. |
| `GET /openapi.json` | Machine-readable OpenAPI spec for the service. |

Probe examples (substitute the port from §6.3):

```bash
curl -f http://identity:3001/health          # liveness
curl -f http://finance:3007/ready            # 503 if DB/Redis/SQS down
curl -H "Authorization: Bearer $METRICS_TOKEN" http://audit:3004/metrics
```

---

## 9. Rollback procedures

### 9.1 Kubernetes / Helm

```bash
helm history civitasone -n civitasone
helm rollback civitasone <PREVIOUS_REVISION> -n civitasone --wait
```

Because migrations are expand/contract and backward-compatible, rolling application pods
back to the previous image is safe **without** reversing the migration. Only reverse a
migration if the *contract* phase already dropped columns the old code needs — in that case
apply the prepared down-migration for that service first.

### 9.2 Docker Compose (staging)

```bash
docker compose -f infra/docker-compose.prod.yml pull   # after pinning previous tag
docker compose -f infra/docker-compose.prod.yml up -d
```

### 9.3 Data safety

- Take a `pg_dump` (or ensure a PITR-capable WAL archive exists) **before** any contract-phase
  migration. RPO/RTO targets are covered in `SELF-HOSTING.md`.
- The `audit` hash chain is append-only and immutable — never roll it back; a bad deploy is
  corrected forward with a compensating entry, not by rewriting history.

### 9.4 Post-rollback checklist

1. `/ready` returns 200 on every service.
2. Gateway `:8080` health is green and JWKS verification against Keycloak succeeds.
3. SQS consumers are draining (no growing queue depth / DLQ spike).
4. Error rate back under the 1% SLO (see `PERFORMANCE.md`).

---

## 10. Related documents

- `SELF-HOSTING.md` — hardware sizing, network topology, backup/DR, monitoring.
- `PERFORMANCE.md` — pooling, caching, k6 methodology, SLOs.
- `COMPLIANCE.md` — DPDP, CERT-In, GFR-2017, CSMOP, IT Act 65B mapping.
