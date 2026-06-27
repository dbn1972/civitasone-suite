# CivitasOne Suite — Installation & Operations Guide

**Version:** 1.0  
**Date:** 2026-06-27  
**Aligned to:** Volume 6 Specification  
**Status:** Production baseline

---

## 1. Purpose & Supported Deployment Models

This guide covers install, bootstrap, validate, operate, upgrade, and recover CivitasOne across all supported deployment modes.

### Supported Modes

| Mode | Infrastructure | Use Case |
|------|---------------|----------|
| **Docker Compose** | Single host / on-prem box | Dev, staging, small PSU (<100 users) |
| **Helm / Kubernetes** | Any K8s cluster (EKS, AKS, on-prem) | Production govt deployments |
| **PM2 (bare metal)** | Direct on EC2/VM | Current staging environment |
| **Source download** | Developer workstation | Contribution / evaluation |

### Compatibility Matrix

| Component | Minimum | Tested |
|-----------|---------|--------|
| Node.js | 20.x | 20.11+ |
| PostgreSQL | 16.x | 16.4 |
| Redis | 7.x | 7.2 |
| Keycloak | 24.x | 24.0 |
| Queue (SQS/Kafka/RabbitMQ) | Any supported | SQS via LocalStack (dev), real SQS (prod) |
| OS | Linux (glibc 2.31+) | Amazon Linux 2023, Ubuntu 22.04 |

---

## 2. Prerequisites & Environment Assumptions

### Infrastructure Requirements

| Resource | Minimum (staging) | Recommended (prod) |
|----------|-------------------|-------------------|
| CPU | 4 vCPU | 16 vCPU |
| RAM | 16 GB | 64 GB |
| Storage | 100 GB SSD | 500 GB NVMe |
| Network | Internal LAN | Private VPC, NAT gateway for outbound |
| TLS | Self-signed (dev) | CA-signed wildcard (*.civitasone.gov.in) |

### Network Routes Required

| Service | Port | Direction |
|---------|------|-----------|
| Gateway (public) | 8080 | Inbound from load balancer |
| Web (public) | 3000 | Inbound from load balancer |
| PostgreSQL | 5432 | Internal only |
| Redis | 6379 | Internal only |
| Keycloak | 8180 | Internal (SSO callback must be LB-accessible) |
| SQS/LocalStack | 4566 | Internal only |
| Prometheus | 9090 | Internal (ops network) |
| Grafana | 3001 | Internal (ops network) |

### Secrets Model

All secrets are injected via environment variables. **Never committed to git.**

- `.env.local` for Docker Compose
- Kubernetes Secrets for Helm
- AWS Secrets Manager / SSM Parameter Store for ECS
- PM2 ecosystem.config.js reads from injected env

Reference: `.env.example` documents every required variable.

---

## 3. Installation Flows

### Flow A: Docker Compose (simplest)

```bash
# 1. Clone and configure
git clone <repo-url> && cd civitasone-suite
cp .env.example .env.local   # Fill all CHANGE_ME values

# 2. Provision infra
docker compose -f infra/docker-compose.yml up -d postgres redis keycloak localstack

# 3. Run migrations
pnpm run db:migrate

# 4. Bootstrap admin identity
node scripts/ci/bootstrap-postgres.sh

# 5. Start services
docker compose -f infra/docker-compose.prod.yml --env-file .env.local up -d

# 6. Validate
./scripts/ops/validate-install.sh
```

### Flow B: Helm / Kubernetes

```bash
# 1. Create namespace and secrets
kubectl create ns civitasone
kubectl create secret generic civitasone-secrets --from-env-file=.env.prod -n civitasone

# 2. Deploy infra (or use managed services)
helm install postgres bitnami/postgresql -f infra/onprem/helm/values.production.yaml -n civitasone
helm install redis bitnami/redis -n civitasone

# 3. Deploy CivitasOne
helm install civitasone infra/onprem/helm/civitasone/ \
  -f infra/onprem/helm/values.production.yaml \
  -n civitasone

# 4. Run migrations (via Job)
kubectl apply -f infra/onprem/k8s/base/migration-job.yaml -n civitasone

# 5. Validate
kubectl exec -it deploy/gateway -n civitasone -- curl localhost:8080/health
```

### Flow C: PM2 (bare metal)

```bash
# 1. Install dependencies
pnpm install --frozen-lockfile

# 2. Build
pnpm build

# 3. Bootstrap database
bash scripts/ci/bootstrap-postgres.sh

# 4. Start via PM2
pm2 start ecosystem.config.js
pm2 save && pm2 startup

# 5. Validate
curl http://localhost:8080/health
```

---

## 4. Bootstrap & First-Run Configuration

### Adapter Configuration

| Adapter | Config Source | Validation |
|---------|-------------|-----------|
| **PostgreSQL** | `DATABASE_URL` or `DATABASE_URL_<SVC>` | Connection test + migration status |
| **Redis** | `REDIS_URL` | SET/GET test + namespace isolation |
| **Queue (SQS)** | `QUEUE_DRIVER`, `AWS_*` vars | Publish/consume round-trip + DLQ |
| **Object Storage (S3)** | `AWS_S3_BUCKET`, `AWS_ENDPOINT_URL` | PUT/GET test |
| **Keycloak** | `KEYCLOAK_URL`, `KEYCLOAK_REALM`, `KEYCLOAK_CLIENT_*` | Token exchange test |
| **CDN** | Nginx/ALB in front of web | Route test to /_next/static |

### First-Run Steps

1. **Create super-admin user** in Keycloak realm `civitasone`
2. **Assign roles:** `super_admin`, `platform_admin`
3. **Login to web** → redirects to `/install` (installer wizard)
4. **Complete installer:** modules selection, org details, initial data import
5. **Verify:** all services show green on `/tenant-admin/operations`

---

## 5. Adapter Configuration Reference

See Table 1 in the specification. Implementation details:

| Adapter | File | Settings |
|---------|------|----------|
| PostgreSQL | `services/*/src/shared/db.ts` | Connection pool (max 20), TLS in prod, per-service credentials |
| Redis | `packages/cache/src/index.ts` | Namespace per service, TTL bounded [30s, 1h], stampede protection |
| SQS | `packages/queue/src/sqs-adapter.ts` | Visibility timeout 60s, DLQ after 3 attempts, message dedup |
| S3 | Via AWS SDK, bucket from env | Server-side encryption (AES-256), lifecycle: archive after 90d |
| Keycloak | `packages/auth/src/plugin.ts` | RS256 JWT validation, realm discovery, device trust header |

---

## 6. Post-Install Validation & Readiness Checks

Run the automated validation:

```bash
node scripts/production-readiness-score.mjs
```

### Checklist (must all pass):

- [ ] All services healthy: `curl localhost:8080/health` → `{ "status": "ok" }`
- [ ] Admin login via Keycloak SSO successful
- [ ] MFA enrollment works (TOTP setup + verify)
- [ ] Audit trail writes: create a test entity → verify in audit log
- [ ] Cache behavior: first call slow, second call fast (cache hit)
- [ ] Object storage: upload/download test file
- [ ] Queue round-trip: publish test message → consumer processes → verify in DB
- [ ] Notifications: send test email/SMS (if gateways configured)
- [ ] Background workers: `pm2 list` shows all *-worker processes online
- [ ] Monitoring: Prometheus scraping all targets, Grafana dashboards loading
- [ ] Alert routing: trigger test alert → verify delivery

### Readiness Score

The production readiness script (`scripts/production-readiness-score.mjs`) checks:
- All routes use `sendAccepted` / `sendValidated` (CQRS compliance)
- All services have workers and queue consumers
- All services register ops routes (health/metrics)
- Migration files exist and are numbered sequentially
- Security headers and RBAC enforcement present

Target: **100/100** before go-live.

---

## 7. Operations Model & Daily Runbook

### Daily Operations

| Time | Task | Tool |
|------|------|------|
| 09:00 | Health review | Grafana dashboard / `pm2 list` |
| 09:15 | Queue backlog check | `pm2 logs queue-service --lines 20` |
| 09:30 | Failed job review | Admin → Operations → DLQ section |
| 10:00 | Privileged action audit | Audit log → filter "breakglass" or "super_admin" |
| EOD | Backup verification | `ls -la /var/backups/civitasone/` — check today's dumps exist |

### Runbook per Service

Each service exposes:
- `GET /health` — liveness (200 = alive, 503 = unhealthy)
- `GET /ready` — readiness (200 = accepting traffic)
- `GET /metrics` — Prometheus scrape endpoint

Restart procedure:
```bash
pm2 restart <service-name> <service-name>-worker --update-env
```

### Escalation Path

1. **L1 (Operator):** Restart service, check logs, verify connectivity
2. **L2 (Platform Engineer):** Database investigation, queue DLQ, cache flush
3. **L3 (Product Engineering):** Code-level debugging, hotfix PR

### Support Boundaries

| Responsibility | Product Team | Operator |
|---------------|:---:|:---:|
| Application bugs | ✅ | |
| Infrastructure provisioning | | ✅ |
| Database performance tuning | Guidance | ✅ |
| Network/firewall configuration | | ✅ |
| Security patches (OS/runtime) | | ✅ |
| Security patches (app code) | ✅ | |
| Keycloak realm configuration | Docs | ✅ |
| Backup execution | | ✅ |
| Backup script maintenance | ✅ | |

---

## 8. Backup, Recovery & Disaster Procedures

### Backup Strategy

| Store | Method | Frequency | Retention |
|-------|--------|-----------|-----------|
| PostgreSQL (all DBs) | `pg_dump` compressed | Daily 02:00 UTC | 30 days |
| Redis (AOF) | Redis persistence + snapshot | Continuous | 7 days |
| Object Storage (S3) | Cross-region replication | Real-time | Lifecycle policy |
| Keycloak realm export | `kc.sh export` | Weekly | 4 exports |

### Backup Script

```bash
./scripts/ops/backup-databases.sh [BACKUP_DIR]
```

Databases backed up: civitas_hrms, civitas_payroll, civitas_finance, civitas_procurement, civitas_admin, civitas_identity, civitas_notification, civitas_workflow, civitas_audit (+ all others).

### Recovery Procedure

```bash
./scripts/ops/restore-drill.sh
```

1. Creates a scratch database
2. Restores latest backup
3. Validates row counts and referential integrity
4. Reports PASS/FAIL with timestamp

### Disaster Recovery

| Metric | Target |
|--------|--------|
| **RPO** (Recovery Point Objective) | 24 hours (daily backup) |
| **RTO** (Recovery Time Objective) | 4 hours |
| **Failover** | Manual (single-region); automatic (multi-region with RDS Multi-AZ) |

### DR Drill (Quarterly)

```bash
DRILL_DB=civitas_finance_drill ./scripts/ops/restore-drill.sh
```

Operator responsibilities during DR:
1. Stop inbound traffic (ALB drain)
2. Restore from latest backup
3. Run migrations if version mismatch
4. Validate via post-install checks
5. Resume traffic

---

## 9. Upgrade & Rollback Guidance

### Upgrade Process

```bash
# 1. Pre-deploy snapshot
tar -czf ~/civitas-backups/civitas-snapshot-$(date +%Y%m%d-%H%M%S).tgz \
  --exclude=node_modules --exclude=.next -C ~/CivitasOne civitasone-suite

# 2. Pull latest
cd ~/CivitasOne/civitasone-suite && git pull

# 3. Build
pnpm build

# 4. Run new migrations (if any)
pnpm run db:migrate

# 5. Rolling restart
pm2 restart all

# 6. Verify
curl -s http://localhost:8080/health
node scripts/production-readiness-score.mjs
```

### Rollback

```bash
./scripts/rollback.sh
```

This script:
1. Stops all PM2 processes
2. Restores from the latest snapshot tarball
3. Rebuilds
4. Restarts PM2

### Schema Migration Safety

- Migrations are forward-only (numbered sequentially: `0001_`, `0002_`, etc.)
- Each migration is idempotent (re-running doesn't fail)
- Destructive changes (DROP, column removal) are gated behind a 2-release deprecation cycle
- Rollback for schema: apply a compensating migration, never `DROP` in the rollback script

### Release Notes Template

Each release must include:
- Version number + date
- Migration notes (new tables, altered columns)
- Breaking changes (API, config, adapter)
- Known incompatibilities
- Rollback expectations

---

## 10. Troubleshooting & Support Boundaries

### Common Issues

| Symptom | Cause | Resolution |
|---------|-------|-----------|
| Service won't start | `DATABASE_URL` missing | Check `.env.local` or K8s secret |
| 401 on all requests | Keycloak realm misconfigured | Verify `KEYCLOAK_URL`, `KEYCLOAK_REALM` |
| Queue messages stuck | SQS visibility timeout | Increase `SQS_VISIBILITY_TIMEOUT` |
| Cache misses (slow) | Redis not connected | Check `REDIS_URL`, verify `redis-cli ping` |
| Object storage 403 | Bucket policy / credentials | Verify `AWS_S3_BUCKET`, `AWS_ACCESS_KEY_ID` |
| Plugin won't load | Theme/plugin service unhealthy | Check `pm2 logs plugin-service` |
| Slow queries | Missing index or unbounded scan | Check `pg_stat_activity`, add `.limit()` |
| Break-glass needed | Production emergency | Use `/tenant-admin/breakglass` → requires CISO approval |

### Structured Diagnostics

On install failure, the system captures:
- Service name and version
- Error code and message (no secrets)
- Adapter connectivity status
- Migration state
- Timestamp and correlation ID

These are logged to structured JSON (Loki-compatible) and never include credentials, tokens, or PII.

### Emergency Access (Break-Glass)

1. Operator submits break-glass request via UI or API
2. Platform admin approves (audit-logged)
3. Elevated access granted for specified duration
4. All actions during break-glass are audit-logged with `breakglass: true`
5. Access auto-revokes at expiry

---

## File Reference

| Path | Purpose |
|------|---------|
| `infra/DEPLOY.md` | Quick-start deployment guide |
| `infra/docker-compose.yml` | Dev infrastructure |
| `infra/docker-compose.prod.yml` | Production compose |
| `infra/onprem/helm/civitasone/` | Helm chart |
| `infra/onprem/k8s/` | Raw K8s manifests |
| `infra/onprem/ansible/` | Ansible provisioning roles |
| `infra/observability/` | Prometheus, Grafana, Loki, Alertmanager |
| `scripts/ops/backup-databases.sh` | Database backup |
| `scripts/ops/restore-drill.sh` | DR restore validation |
| `scripts/rollback.sh` | Quick rollback |
| `scripts/deployment-runbook.md` | Deploy/verify/rollback |
| `scripts/production-readiness-score.mjs` | Automated gate checker |
| `scripts/security/re-pentest.mjs` | Security re-validation |
| `.env.example` | All environment variables documented |
| `ecosystem.config.js` | PM2 process definitions |
| `Dockerfile` | Multi-stage service image |
