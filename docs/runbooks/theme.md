# Runbook: theme-service

> Tier 3. Follows the standard template in `docs/operations/SLO-SLI-RUNBOOKS.md` §5.
> SLO: 99.0% availability, p95 read < 200 ms.

- **Purpose:** tenant branding and visual customization — design token management (colors, typography, spacing, border-radius), tenant branding (logo, favicon, brand colors, custom CSS), and email/PDF template theming. Owns `civitas_themes`. 3 modules. Low complexity, low risk — purely cosmetic. Outage means default branding shows (not a functional failure).

- **Owner / escalation:** primary: Frontend/UX Team. Secondary: SRE (low priority).

- **Dependencies:**
  - Own Postgres DB (`civitas_themes`), RLS enabled, tenant-scoped.
  - Redis — token/branding cache (frontend fetches theme tokens on page load — must be fast for perceived performance).
  - SQS/RabbitMQ topics (`src/topics.ts`): commands for token create, branding upsert, template create; events mirroring mutations.
  - Cross-service: web frontend (fetches theme tokens on load), notification-service/report-service (use templates for branded email/PDF output).
  - Storage: logos and assets stored in S3/MinIO.

- **Key dashboards:**
  - `/ops/*` (heartbeat, DLQ, consumer error rate, outbox relay).
  - Grafana: theme token fetch rate, branding update frequency (low — branding rarely changes).

- **Common failure modes → action:**
  - *Frontend showing default branding* → the web app fetches theme tokens at page load. If the theme endpoint is down, it falls back to default tokens. This is graceful degradation — not a P0. Fix when convenient.
  - *Branding upsert not reflecting* → verify the cache was invalidated after the upsert. Token cache TTL is 5 minutes. For immediate effect, force-invalidate the tenant's theme cache key.
  - *Logo upload failing* → logos go to S3/MinIO. Check storage connectivity. If storage is temporarily unreachable, the previous logo continues to display.
  - *Email/PDF template not branded* → notification and report services fetch template themes. If they're rendering with default branding, verify the theme template exists for the tenant. Templates may need to be created explicitly per tenant.

- **Rollback:** redeploy previous image tag. Theme tokens/branding are simple DB rows — easily reversible.

- **Recovery (RPO/RTO):** restore DB from ≤15-min backup. Low urgency — default branding displays during outage. After restore: rebuild theme cache in Redis. Logo assets in S3 are unaffected.
