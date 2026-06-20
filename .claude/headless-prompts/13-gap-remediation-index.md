# Gap Remediation Index — Claude Headless Prompts

Run these prompts **in order** after the P0/P1 fixes committed in the main branch.
Each prompt is self-contained; read `CLAUDE.md` and `MODULES_AND_SCHEMA.md` first.

## Already fixed (do not re-run)

| ID | Item | Status |
|----|------|--------|
| P0-1 | CRM deals + activities APIs (`crm-service`) | ✅ Done |
| P0-2 | CRM web pages wired to loaders | ✅ Done |
| P1-1 | Gateway prefix fixes (project/asset/notification) | ✅ Done |
| P1-2 | Chart of accounts → `GET /api/v1/finance/accounts` | ✅ Done |
| P1-3 | Journal entry form → `POST /api/v1/finance/journals` | ✅ Done |
| P1-4 | `resolveContext` → `@civitasone/auth/context` | ✅ Done |
| P3-1 | Contract test loader-path mapping | ✅ Done |
| P2-14 | Web UI module expansion (12 modules, list screens) | ✅ Done |
| P2-15 | Notification adapters (SMTP + in_app Redis) | ✅ Done |
| P2-16 | Helpdesk canonical owner (Option A) | ✅ Done |
| P3-17 | Knowledge / workflow / analytics services + web | ✅ Done |
| P2-18 | Tenant-admin live metrics | ✅ Done |
| P2-19 | Procurement approvals endpoint | ✅ Done |

## Prompts to run

_All gap remediation prompts complete._

## Verification after each prompt

```bash
pnpm --filter @civitasone/<service> build
pnpm --filter @civitasone/web typecheck
node scripts/production-readiness-score.mjs
pnpm vitest run tests/contract/gateway.contract.test.ts
```

## Screen→API mapping source

- Spec screens: `~/CivitasOne/erpnext-develop/*-module/web/`
- Implemented APIs: `services/*/src/modules/**/routes.ts`
- Web loaders: `apps/web/src/app/_data/loaders.ts`
