# Runbook: policy-service

> Tier 2 (security-critical). Follows the standard template in `docs/operations/SLO-SLI-RUNBOOKS.md` §5.
> SLO: 99.95% availability (same as gateway — authorization is on the hot path), p95 evaluate < 10 ms, zero false-permits.

- **Purpose:** centralized RBAC/ABAC policy engine — role management (create/update with feature grants), permission assignment, policy binding (user-to-role mapping), policy evaluation (called on every request by gateway/services), ABAC rule engine (attribute-based conditions: time-of-day, IP, department, classification level), role-feature grants/revocations, and break-glass access requests. Owns `civitas_policy`. 5 modules but security-critical — every authorization decision passes through this service.

- **Owner / escalation:** primary: Security Engineering. Secondary: SRE + Platform Engineering. Page on evaluation latency > 50ms (cascading latency across all services) or any false-permit detection.

- **Dependencies:**
  - Own Postgres DB (`civitas_policy`), RLS enabled. Stores roles, permissions, bindings, ABAC rules.
  - Redis — policy evaluation cache (binding lookups must be < 10ms — cached aggressively with 60s TTL, invalidated on bind/revoke).
  - SQS/RabbitMQ topics (`src/topics.ts`): commands for role CRUD, permission add, binding create/revoke, break-glass request, ABAC rule CRUD, role-feature grant/revoke; events mirroring all mutations.
  - Cross-service: gateway-service (calls policy evaluate endpoint on every proxied request), all services (call policy for route-level authorization), identity-service (resolves user-to-binding on login).
  - Break-glass: emergency access elevation that bypasses normal policy. Every break-glass request is audit-logged and time-limited. Requires post-hoc review.
  - **Hot-path performance**: policy evaluation is called on every HTTP request. Latency here directly impacts platform-wide response times. The evaluate endpoint is the most latency-sensitive in the entire platform.

- **Key dashboards:**
  - `/ops/*` (heartbeat, DLQ, consumer error rate, outbox relay).
  - Grafana: evaluation rate (req/sec), evaluation p50/p95/p99 latency, cache hit ratio (must be > 95%), binding count by role, ABAC rule evaluation rate, break-glass usage, deny rate.
  - Alert: evaluation p95 > 50ms = CRITICAL (platform-wide cascade); cache hit ratio < 90% = CRITICAL (DB being hit directly — will not scale); break-glass opened = WARN (always review); binding-revoke failure = CRITICAL (access not being removed).

- **Common failure modes → action:**
  - *Evaluation latency spike* → first check Redis (policy cache). If Redis is slow or unreachable, every evaluation hits the DB (catastrophic at 1000 TPS). Fix Redis connectivity immediately. If Redis is healthy but latency is high, check if a recent bulk-binding-create flooded the cache with invalidations. Wait for cache warm-up (< 60s).
  - *Cache stale after binding revocation* → when a user's access is revoked, the cache key for that user-binding MUST be invalidated immediately (not TTL-based for security). If a revoked user still has access, check if the `policy.binding.revoked` consumer successfully invalidated the cache. This is a security-critical bug if not working.
  - *Break-glass access not expiring* → break-glass sessions have a configured TTL. If a session persists, the expiry event may not have fired. Manually revoke the break-glass binding. Review the session's actions via audit logs.
  - *ABAC rule evaluation incorrect* → ABAC rules are condition-based (time, IP, department, etc.). If access is incorrectly granted/denied, check the rule definition and the context attributes being evaluated. Rules are order-dependent — verify precedence.
  - *Role-feature grant not reflecting* → role-feature grants determine which UI modules/features are visible per role. If a granted feature isn't showing, verify the grant event was processed and the gateway's module-guard cache was invalidated.
  - *Bulk binding import failing* → large RBAC imports (from LDAP/AD sync) process in batches. If a batch fails, check for duplicate bindings (same user-role-tenant combination). Duplicates are rejected by the unique constraint.

- **Rollback:** redeploy previous image tag. CAUTION: policy rollback can change who has access to what. If a role/permission was added in the rolled-back version, users will lose access. Coordinate with affected teams before rollback.

- **Recovery (RPO/RTO):** restore DB from ≤15-min backup; replay outbox. IMMEDIATELY after restore: (1) force-rebuild the entire policy cache in Redis (all bindings, all roles, all ABAC rules); (2) verify no permissions were granted during the gap that should have been denied (audit log cross-reference); (3) confirm break-glass sessions that expired during the gap are actually closed.
