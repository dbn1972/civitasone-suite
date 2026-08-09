# HANDOFF — Municipal Sec5 Services (BRD Section 5)

**Branch:** `ai/feature-municipal-sec5-services`  
**Worktree:** `/home/ec2-user/wt/municipal-sec5-services`  
**Rescued from:** EC2 suite main untracked scaffolds (session c5159612)  
**Date:** 2026-08-09

## Summary

16 municipal micro-services scaffolded per MASTER-PROMPT-SEC5.md. All rescued off EC2 main into a dedicated worktree branch. **fire-service** and **advertisement-service** were partial — now complete.

## Service Status (16/16 scaffold complete)

| # | Service | Port | app.ts | worker.ts | Modules | Status |
|---|---------|------|--------|-----------|---------|--------|
| 1 | trade-service | 3070 | ✅ | ✅ | applications, approvals, licences, lifecycle | Complete |
| 2 | building-service | 3071 | ✅ | ✅ | applications, approvals, permits, lifecycle | Complete |
| 3 | fire-service | 3072 | ✅ | ✅ | applications, inspections, nocs, lifecycle | **Finished this session** |
| 4 | advertisement-service | 3073 | ✅ | ✅ | applications, approvals, permits, enforcement | **Finished this session** |
| 5 | vendor-service | 3074 | ✅ | ✅ | 4 modules | Complete |
| 6 | roadcut-service | 3075 | ✅ | ✅ | 4 modules | Complete |
| 7 | event-service | 3076 | ✅ | ✅ | 4 modules | Complete |
| 8 | refund-service | 3077 | ✅ | ✅ | 3 modules | Complete |
| 9 | sewerage-service | 3078 | ✅ | ✅ | 4 modules | Complete |
| 10 | swm-service | 3079 | ✅ | ✅ | 4 modules | Complete |
| 11 | drainage-service | 3080 | ✅ | ✅ | 3 modules | Complete |
| 12 | parks-service | 3081 | ✅ | ✅ | 4 modules | Complete |
| 13 | animal-service | 3082 | ✅ | ✅ | 3 modules | Complete |
| 14 | crematorium-service | 3083 | ✅ | ✅ | 3 modules | Complete |
| 15 | parking-service | 3084 | ✅ | ✅ | 4 modules | Complete |
| 16 | market-service | 3085 | ✅ | ✅ | 4 modules | Complete |
| — | shop-service | 3060 | ✅ | ✅ | registrations, approvals, permits, lifecycle | Reference template |

## Phase-2 Module Extensions (copied where present)

| Service | Module | Status |
|---------|--------|--------|
| asset-service | streetlight | ✅ Copied |
| asset-service | water-connection, water-meter, water-billing | ❌ Not on EC2 |
| helpdesk-service | sanitation, road-hotspot | ✅ Copied |
| inspection-service | encroachment, illegal-construction | ✅ Copied |
| estab-service | booking, citizen-lease | ✅ Copied |

## What Was Missing (Fixed)

### fire-service (3072)
- `src/app.ts`, `src/worker.ts`
- `routes.ts` + `consumer.ts` for: applications, inspections, nocs, lifecycle

### advertisement-service (3073)
- `src/app.ts`, `src/worker.ts`
- `permits/routes.ts`, `permits/consumer.ts`
- Full `enforcement/` module (schema, domain, repo, commands, routes, consumer)

## Next Steps (P1+)

1. **Migrations** — Create SQL migrations for each service DB (`civitas_{service}`) with RLS + FORCE RLS
2. **Workspace** — `pnpm-workspace.yaml` already includes `services/*`; run `pnpm install` in worktree
3. **Gateway** — Register routes in `gateway-service` for all 16 `/v1/{service}/*` prefixes
4. **PM2/ecosystem** — Add API + worker entries for each service port
5. **Tests** — Unit tests per module (happy + failure path), ≥80% coverage on changed code
6. **Typecheck** — `pnpm install && pnpm --filter @civitasone/{service}-service typecheck`
7. **Policy/RBAC** — Register roles (`fire_user`, `adv_enforcement`, etc.) in policy-service
8. **Events** — Wire cross-service consumers (billing for fees, notification for notices)
9. **Web screens** — Citizen portal + officer dashboards under `apps/web`

## Validation Commands

```bash
cd /home/ec2-user/wt/municipal-sec5-services
pnpm install
pnpm --filter @civitasone/fire-service typecheck
pnpm --filter @civitasone/advertisement-service typecheck
pnpm --filter @civitasone/trade-service typecheck  # reference
```

## Architecture Compliance

All services follow MASTER-PROMPT-SEC5 patterns:
- CQRS: routes → queue command → consumer → tx + outbox + audit
- Zod validation at route boundary
- Read-through cache via `@civitasone/cache`
- Module isolation (L2) — no cross-module schema imports
- Money as bigint paise + ISO 4217 currency
- Mandatory entity fields on all tables
