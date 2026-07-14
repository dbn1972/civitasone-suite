# Runbook: gateway-service

> Tier 0 (edge). Follows the standard template in `docs/operations/SLO-SLI-RUNBOOKS.md` §5.
> SLO: 99.95% availability, p95 proxy overhead < 50 ms (see §3).

- **Purpose:** single entry point (port 8080) for all external traffic. Terminates CORS/Helmet/rate-limit/quota, verifies JWTs at the edge (`jwt-edge.ts`), enforces module-guard and ABAC policy checks (`module-guard.ts`, `policy-check.ts`), then reverse-proxies to the correct upstream service via the route registry (`registry.ts`) and streams the response back without buffering.

- **Owner / escalation:** primary: SRE on-call. Secondary: Platform Architecture. Page on availability burn-rate >2%/30-day budget in 1h, or p95 proxy overhead > 100 ms sustained.

- **Dependencies:**
  - No own Postgres database — stateless proxy.
  - Redis (`REDIS_URL`/`GATEWAY_REDIS_URL`) — distributed rate-limit counters (`@fastify/rate-limit`) and per-tenant quota store (`quota-store.ts`); falls back to in-memory (per-pod, non-fleet-wide) if unset.
  - Keycloak 24 — JWT signature verification (JWKS) via `jwt-edge.ts`.
  - All 33 upstream services — proxied via `SERVICE_ROUTES` in `registry.ts` (identity :3001 → finance :3007 → ... → queue :3030); each upstream call wrapped in its own `@civitasone/circuit-breaker` instance (`upstream-proxy.ts`, 5 failures/60s → open 30s, state exposed at `/ops/breakers`).
  - `tenant-service` (:3002) — quota-check plugin (`GATEWAY_TENANT_URL`).
  - `policy-service` (:3003) — ABAC mutation checks (`checkPolicy`).
  - `admin-service` — pushes runtime config via authenticated `/internal/config` (PATCH), gated by `INTERNAL_SERVICE_SECRET` (timing-safe compare).

- **Key dashboards:**
  - `/ops/*` (heartbeat, DLQ n/a, captured errors) via `registerOpsRoutes`.
  - `/ops/breakers` — per-upstream circuit breaker state (open/closed/half-open) — check first for upstream degradation.
  - `/health` custom checks for `identity`, `finance`, `queue_upstream` (configurable via `IDENTITY_HEALTH_URL`/`FINANCE_HEALTH_URL`/`QUEUE_HEALTH_URL`).
  - Grafana: gateway p95 proxy overhead, 5xx rate, rate-limit rejection rate (429s), quota-check shadow-mode mismatches.

- **Common failure modes → action:**
  - *Upstream circuit breaker open for one service* → check `/ops/breakers`; that service is failing 5 consecutive requests. Investigate the upstream service's own runbook; the gateway will auto half-open after 30s — no gateway-side action needed unless multiple breakers open simultaneously (partial outage).
  - *429 spike (rate-limit)* → check whether it's the global 1000/min or per-tenant 200/min limit (`GATEWAY_RATE_LIMIT_MAX`/`GATEWAY_RATE_LIMIT_TENANT_MAX`); confirm Redis-backed store is reachable (if it fell back to in-memory, limits are per-pod and may look inconsistent across replicas).
  - *401 spike* → check Keycloak/JWKS reachability; `jwt-edge.ts` fails closed on JWKS fetch failure.
  - *403 spike (module-guard/policy)* → check `tenant-service`/`policy-service` reachability; a tenant-service outage should not silently allow — confirm module-guard fails closed.
  - *404 spike on a previously-working prefix* → check `registry.ts` for a route-table gap or a stale `GATEWAY_<SVC>_URL` env override pointing at a decommissioned host.
  - *CORS/CSP rejections in prod* → gateway refuses to start if `CORS_ORIGIN` is unset in `NODE_ENV=production` (fail-closed by design); verify the env var, do not loosen CSP directives to unblock.
  - *Large response memory pressure* → proxy streams upstream bodies (`Readable` piping); if memory still spikes, check for a service returning an unbounded/unpaginated payload (violates the 1MB payload standard).

- **Rollback:** redeploy previous gateway image tag; runtime config changes pushed via `/internal/config` are in-memory only and revert on restart (no migration to roll back — the gateway has no database).

- **Recovery (RPO/RTO):** stateless — no data to restore. RTO is the time to redeploy/restart the pod fleet (target: within the platform's standard blue-green rollback window, well under the 4h Tier-0 RTO). RPO: n/a (no persisted state).
