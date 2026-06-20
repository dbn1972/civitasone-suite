# Skill — Installer Readiness Score (Vol 11)

**When to load:** Building or changing anything in `install-service`.

---

## What the score is

A single 0–100 number that tells the operator whether a freshly installed CivitasOne deployment is production-ready. Computed at end of install + recomputable on demand.

**Pass bar:** ≥ 85/100. Below 85, the installer marks deployment as "needs work" and produces a remediation checklist.

## Scoring rubric (Vol 11 §9)

| Category | Weight | What is measured |
|---|---|---|
| Security | 25 | TLS everywhere, secrets in Vault/SM (not env), JWT secret strength, password policy enabled, MFA enforced for admin, audit log enabled |
| Reliability | 20 | DB replication configured, Redis sentinel / cluster, queue redundancy, service replica count ≥ 2 for stateless, health checks passing for ≥ 5 minutes |
| Observability | 15 | Metrics scraped, logs shipped, traces shipped, dashboards installed, baseline alerts firing on test data |
| Backup / DR | 15 | DB backup configured + verified restore, object store versioning, retention policy set, RPO and RTO documented |
| Performance | 10 | Smoke load test passed, p95 latency under SLO, cache hit ratio measured |
| Documentation | 10 | Runbook present, on-call rotation noted, contact list filled, escalation policy linked |
| Operational hygiene | 5 | Patch level current, no default credentials remain, no test data in prod, license recorded |

Each category has 4–6 individual checks; passing each contributes proportionally to its weight.

## Algorithm

```
total = 0
for each category in rubric:
  passed_checks = run_checks(category)
  category_score = (passed_checks.count / category.total_checks) * category.weight
  total += category_score
return round(total)
```

## Categories with examples

### Security (25 pts)
- 4 pts: All inbound traffic TLS 1.2+
- 4 pts: All secrets sourced from Vault / Secrets Manager (no plaintext in env)
- 4 pts: JWT signing secret length ≥ 32 chars, rotated ≤ 90 days
- 4 pts: Password policy enforced (length, complexity, history)
- 5 pts: MFA enforced for `tenant.admin` and `platform.super_admin`
- 4 pts: Audit log writes flowing for last 5 minutes

### Reliability (20 pts)
- 5 pts: Postgres has at least 1 standby replica configured
- 4 pts: Redis sentinel OR cluster mode active
- 4 pts: Queue has cluster (Kafka brokers ≥ 3, RabbitMQ HA queues, SQS region failover)
- 4 pts: Stateless services running with replicas ≥ 2 (per Helm/ECS config)
- 3 pts: Health checks green for last 5 minutes on all services

### Observability (15 pts)
- 4 pts: Prometheus scraping all `/metrics` endpoints
- 3 pts: Logs shipping to Loki / CloudWatch with `correlationId` field present
- 3 pts: Traces shipping with OpenTelemetry collector
- 3 pts: Default dashboards installed (per service)
- 2 pts: At least one alert firing for synthetic test (proves alerting works end-to-end)

### Backup / DR (15 pts)
- 5 pts: Automated DB backup scheduled + last backup < 24h old
- 4 pts: Verified restore performed during install (script proves it)
- 3 pts: Object store versioning enabled + retention configured
- 3 pts: RPO and RTO documented in install report

### Performance (10 pts)
- 4 pts: Smoke load (100 RPS for 60s) completed with 0 errors
- 3 pts: p95 latency under SLO target on the smoke load
- 3 pts: Redis cache hit ratio ≥ 70% during smoke

### Documentation (10 pts)
- 3 pts: Runbook present and linked
- 3 pts: On-call rotation entered
- 2 pts: Contact list filled (DBA, SRE, security)
- 2 pts: Escalation policy linked

### Operational hygiene (5 pts)
- 2 pts: All container images at latest patched tag for current minor
- 1 pt: No default credentials still present
- 1 pt: No demo / test data in production tenant
- 1 pt: License record entered

## Reporting

The installer produces a JSON report:

```json
{
  "score": 87,
  "verdict": "ready",
  "categories": [
    { "name": "Security", "weight": 25, "score": 24, "checks": [{ "id": "tls_inbound", "passed": true }, ...] },
    ...
  ],
  "recommendations": [
    { "category": "Reliability", "id": "redis_sentinel", "action": "Enable Redis Sentinel for HA", "doc_link": "..." }
  ]
}
```

## On-demand recompute

`GET /install/readiness/current` — recomputes and returns current score. Used by tenant admin dashboard and by SRE dashboards. Cached 5 minutes.

## Forbidden patterns

- Inflating score by marking a check passed without actually running it
- Skipping a category if "not applicable" — instead, set its weight to 0 and document why
- Allowing the installer to go live below 85 without explicit override + override audit event
- Hiding failing checks from the operator
