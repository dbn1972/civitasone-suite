# Runbook: identity-service

> Tier 0 (auth). Follows the standard template in `docs/operations/SLO-SLI-RUNBOOKS.md` §5.
> SLO: 99.95% availability, p95 token validate < 150 ms (see §3).

- **Purpose:** authentication and identity domain of record — user/session lifecycle, MFA, RBAC (roles/permissions/grants), password reset. Backs Keycloak-issued RS256 JWTs and is the gateway's public-prefix exception (`/api/identity` is unauthenticated for login/refresh).

- **Owner / escalation:** primary: Security on-call. Secondary: SRE. Page immediately on any login-path outage (full outage per Charter §38.5 — "no logins"); page on token-validate p95 > 300ms (2× target).

- **Dependencies:**
  - Own Postgres DB (`civitas_identity`).
  - Redis — session/token cache (read-through via `@civitasone/cache`).
  - SQS/RabbitMQ topics (`src/topics.ts`): commands `identity.user.create/update/deactivate`, `identity.session.create/revoke/revoke_all`, `identity.user.reset_password`, `identity.mfa.enable`, and the RBAC command set (`identity.rbac.role.*`, `identity.rbac.permission.*`); events `identity.user.created/updated/deactivated`, `identity.session.created/revoked/revoked_all`, `identity.mfa.enabled`, RBAC `*.created/granted/revoked/assigned`.
  - Keycloak 24 (OIDC/SAML) — upstream IdP; `@civitasone/auth` verifies JWKS-signed tokens.
  - Gateway — routes `/api/identity`, `/api/v1/admin/users`, `/api/v1/sync`, `/api/v1/devices` all resolve to identity-service (port 3001).

- **Key dashboards:**
  - `/ops/*` (heartbeat, DLQ, consumer error rate, outbox relay failures).
  - Gateway `/ready` custom check on identity — a failing check here is a platform-wide signal (gateway also health-checks identity directly).
  - Grafana: p95 token-validate latency (150ms target), session-create rate, MFA-enable rate, RBAC grant/revoke audit volume.

- **Common failure modes → action:**
  - *Consumer stalled* (heartbeat stale on `identity-worker`) → restart worker; inspect last message on the session/user command topics; check DB connectivity.
  - *DLQ filling on session/user commands* → read DLQ `error`; poison messages (bad producer, e.g. malformed create-user payload) need an upstream fix; transient (DB/Redis blip) → redrive after dependency recovery.
  - *401 spike platform-wide* → check Keycloak reachability and JWKS endpoint first (identity-service itself may be healthy but unable to reach the IdP); verify `INTERNAL_SERVICE_SECRET` hasn't rotated out of sync with the gateway.
  - *p95 token-validate high* → check Redis hit rate for the session/JWKS cache first (cache miss forces a live Keycloak round-trip); then DB slow queries on session lookups.
  - *MFA enrollment failures* → check `identity.mfa.enable` command consumer logs; confirm no PII (email/phone) leaked into logs per the never-log-PII rule.
  - *RBAC grant not taking effect* → confirm the `identity.rbac.role.assigned`/`permission.granted` event was published and consumed by dependent services' local RBAC caches; check outbox relay lag.

- **Rollback:** redeploy previous image tag. Migrations are forward-only — never auto-rollback schema; restore from backup if a bad migration corrupts session/RBAC data.

- **Recovery (RPO/RTO):** restore DB from ≤15-min backup (RPO ≤15 min, Charter §28.3); replay outbox; verify audit continuity for every RBAC/session mutation since last backup. RTO ≤4h — a prolonged identity outage is a full-outage incident (no logins platform-wide) and takes escalation priority over all other Tier-0/1 recovery.
