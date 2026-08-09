# HANDOFF — Municipal Sec5 Services (BRD Section 5)

**Branch:** `ai/feature-municipal-sec5-services`  
**Worktree:** `/home/ec2-user/wt/municipal-sec5-services` (local mirror: `/Users/debabratanayak_1/Projects/wt/municipal-sec5-services`)  
**PR:** https://github.com/dbn1972/civitasone-suite/pull/590  
**Rescued from:** EC2 suite main untracked scaffolds (session c5159612)  
**Date:** 2026-08-09

## Validation Status (2026-08-09 session 3 — P2 migrations + PM2)

| Check | Result |
|-------|--------|
| `pnpm install` | ✅ Pass (96 workspace projects) |
| `@civitasone/fire-service typecheck` | ✅ Pass (after exactOptionalPropertyTypes fixes in repo list opts) |
| `@civitasone/advertisement-service typecheck` | ✅ Pass (after submittedAt null + enforcement list opts fix) |
| `@civitasone/trade-service typecheck` | ✅ Pass (spot-check; submittedAt null fix) |
| Workspace coverage | ✅ `pnpm-workspace.yaml` includes `services/*` — all 17 municipal packages (16 Sec5 + shop) auto-included |
| Gateway routes | ✅ All 17 registered in `services/gateway-service/src/registry.ts` (ports 3060–3085) |
| **Migrations** | ✅ **17× `0001_init.sql`** (16 Sec5 + shop) — schemas/tables from `schema.ts`, RLS + FORCE RLS, outbox/inbox |
| **PM2/ecosystem** | ✅ **17 API + 17 worker** entries in `ecosystem.config.js` (ports 3060–3085) |
| Smoke tests | ✅ `fire-service/tests/domain-smoke.test.ts` (3), `advertisement-service/tests/domain-smoke.test.ts` (4), `gateway-service/tests/municipal-registry.test.ts` (18) |

**Prerequisite:** Build shared packages before service typecheck (`pnpm turbo run build --filter='@civitasone/outbox' ...` or full package build). Packages export from `dist/`; unbuilt packages cause TS2307.

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

1. ~~**Migrations**~~ — Done: 17× `0001_init.sql` with RLS + FORCE RLS + outbox/inbox (generator: `scripts/dev/generate-municipal-migrations.mjs`)
2. ~~**Workspace**~~ — Done: `services/*` glob covers all municipal packages; `pnpm install` verified
3. ~~**Gateway**~~ — Done: all 17 routes in `registry.ts`; env override via `GATEWAY_{SERVICE}_URL`
4. ~~**PM2/ecosystem**~~ — Done: 17 API + 17 worker entries (3060–3085) in `ecosystem.config.js`
5. ~~**Tests (smoke)**~~ — Domain smoke tests added for fire + advertisement; expand to ≥80% module coverage
6. ~~**Typecheck**~~ — fire, advertisement, trade pass after repo type fixes + package build
7. **Policy/RBAC** — Register roles (`fire_user`, `adv_enforcement`, etc.) in policy-service
8. **Events** — Wire cross-service consumers (billing for fees, notification for notices)
9. **Web screens** — Citizen portal + officer dashboards under `apps/web`
10. **DB bootstrap** — Ensure `civitas_{service}` databases + `{service}_svc` roles exist in infra seed/bootstrap for all 17 services

## Gateway Routes (registered)

All municipal services proxy via `services/gateway-service/src/registry.ts`:

| Service | Gateway prefix | Port | Env override |
|---------|---------------|------|--------------|
| shop | `/api/v1/shop` | 3060 | `GATEWAY_SHOP_URL` |
| trade | `/api/v1/trade` | 3070 | `GATEWAY_TRADE_URL` |
| building | `/api/v1/building` | 3071 | `GATEWAY_BUILDING_URL` |
| fire | `/api/v1/fire` | 3072 | `GATEWAY_FIRE_URL` |
| advertisement | `/api/v1/advertisement` | 3073 | `GATEWAY_ADVERTISEMENT_URL` |
| vendor | `/api/v1/vendor` | 3074 | `GATEWAY_VENDOR_URL` |
| roadcut | `/api/v1/roadcut` | 3075 | `GATEWAY_ROADCUT_URL` |
| event | `/api/v1/event` | 3076 | `GATEWAY_EVENT_URL` |
| refund | `/api/v1/refund` | 3077 | `GATEWAY_REFUND_URL` |
| sewerage | `/api/v1/sewerage` | 3078 | `GATEWAY_SEWERAGE_URL` |
| swm | `/api/v1/swm` | 3079 | `GATEWAY_SWM_URL` |
| drainage | `/api/v1/drainage` | 3080 | `GATEWAY_DRAINAGE_URL` |
| parks | `/api/v1/parks` | 3081 | `GATEWAY_PARKS_URL` |
| animal | `/api/v1/animal` | 3082 | `GATEWAY_ANIMAL_URL` |
| crematorium | `/api/v1/crematorium` | 3083 | `GATEWAY_CREMATORIUM_URL` |
| parking | `/api/v1/parking` | 3084 | `GATEWAY_PARKING_URL` |
| market | `/api/v1/market` | 3085 | `GATEWAY_MARKET_URL` |

Upstream path defaults to `/v1/{service}` (prefix minus `/api`).

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
