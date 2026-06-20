You are replacing hardcoded tenant-admin dashboard metrics with live API data.
Read `apps/web/src/app/(app)/tenant-admin/page.tsx`.

## Current state

Page shows fake KPIs (readiness 92/100), static service health tiles, no API calls.

## Goal

Wire to real endpoints:

| UI element | API |
|------------|-----|
| Service health grid | `GET /api/v1/admin/health` |
| Module readiness | `node scripts/production-readiness-score.mjs` output via new `GET /api/v1/admin/health/readiness` OR embed score in admin health |
| Active users count | `GET /api/identity/users` (count) |
| Tenant modules | `GET /api/v1/admin/tenant/modules` (already used on settings page) |

## Rules

1. Server component + loaders pattern (no inline mock arrays).
2. Show `DataSourceBadge` on API failure.
3. Link quick actions to existing routes (`/audit`, `/plugins`, `/themes`).

## Deliverables

- `getTenantAdminDashboard()` loader in `loaders.ts`
- Refactored `tenant-admin/page.tsx`
- Optional: `GET /v1/admin/health/readiness` in admin-service wrapping score script

## Do NOT

- Re-introduce mock fallbacks in loaders
