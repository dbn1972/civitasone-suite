# UAT Changelog

## 2026-07-04 — Platform-wide audit gap closure (P0–P3 + Wave 1 + Addendum)

### Bugs Fixed

| # | Bug | Files Touched | User-Visible Change |
|---|-----|---------------|---------------------|
| P0-1 | Analytics query builder 404 | `apps/web/.../RunQueryForm.tsx` | "Run Query" button now works |
| P0-2 | RTI Transfer 404 | `citizen-service/modules/rti/` | Officers can transfer RTI requests |
| P0-3 | Stock category/UOM dropdowns 404 | `stock-service/modules/item/` | Category and UOM dropdowns load |
| P0-4 | Legal reminders lost on restart | `legal-service/modules/reminders/` | Reminders persist to database |
| P0-5 | Notification bell shows fake data | `apps/web/_components/NotificationBell.tsx` | Bell shows real notifications |
| P0-6 | Theme customCss XSS | `theme-service/modules/tokens/brand-routes.ts` | Custom CSS sanitized |
| P0-7 | Install steps Run/Skip/Retry 404 | `install-service/modules/stages/routes.ts` | Wizard buttons work |
| P0-8 | Plugin enable/disable 404 | `apps/web/(app)/plugins/PluginActions.tsx` | Plugin buttons call correct API |
| P0-13 | Install wizard dead end-to-end | `install-service/worker.ts` | Steps advance through DAG |
| P0-14 | Report jobs stuck at "queued" | `report-service/modules/jobs/consumer.ts` | Reports render and download |
| P0-16 | Analytics export no download | `analytics-service/modules/queries/` | Export download returns real file |
| P0-17 | Plugin hooks never fire | `plugin-service/modules/runtime/consumer.ts` | Hooks execute on event |
| P0-18 | Click-to-call dials nobody | `telephony-service/modules/calls/commands.ts` | Outbound calls dial carrier |
| P0-19 | Gateway policy fails open | `gateway-service/src/policy-check.ts` | Enforce mode denies on failure |
| P0-20 | Webhooks unauthenticated | `telephony-service/modules/webhooks/routes.ts` | Unsigned webhooks rejected |
| P1-21 | Rate-limit resets per pod | `gateway-service/src/quota-store.ts` | Redis-backed fleet-wide limits |
| P2-22 | Invoice history always empty | `tenant-service/modules/subscriptions/routes.ts` | Returns real invoices |

### Tests Added

| Test File | Coverage |
|-----------|----------|
| `packages/storage/src/index.test.ts` | Presigned URLs carry X-Amz-Signature |
| `packages/render/src/render.test.ts` | PDF/XLSX/CSV rendering correctness |
| `audit-service/tests/hash-chain.test.ts` | Tamper detection, chain integrity |
| `audit-service/tests/signing.test.ts` | HMAC signing + verification |

### Manual UAT Verification Needed

1. **Install Wizard** — Click "Run" on step → verify it advances. Click "Skip" → verify skipped. Complete all → verify wizard done.
2. **Report Downloads** — Create job → wait for "completed" → download → verify real PDF/XLSX opens.
3. **Analytics Export** — Run query → Export → verify download link works.
4. **Notification Bell** — Click bell → verify real notifications (not sample data).
5. **Stock Item Form** — Go to new item → verify Category/UOM dropdowns load.
6. **RTI Transfer** — Officer opens RTI → Transfer → verify 202 accepted.
7. **Plugin Hooks** — Register hook → trigger event → verify execution logged.
8. **Gateway Policy** — Set POLICY_ENFORCE=true → stop policy-service → request → verify 503 denied.
9. **Webhook Auth** — POST to twilio webhook without signature → verify 401.

### Risk Areas

- `packages/auth` — timingSafeEqual added. All services affected. Verify login works.
- `packages/db` — tenantTransaction added. Only finance-service uses it. Others unchanged.
- `gateway-service policy-check` — enforce mode now denies on failure. Verify POLICY_ENFORCE is not accidentally set.
- `payroll-service` — PII encryption requires PII_ENC_KEY env var. Migration 0019 must be applied.
