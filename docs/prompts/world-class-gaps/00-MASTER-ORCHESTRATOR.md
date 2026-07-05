# MASTER ORCHESTRATOR — World-Class Module Enhancement

## Purpose
This is the master prompt to run modules 01–15 sequentially. Each module prompt performs a full cycle: audit existing code → identify gaps → implement missing features → write tests → verify → score.

## Execution Rules

1. **Run ONE module at a time** in numerical order (01 → 15)
2. **Do NOT start the next module** until the current one scores 10/10
3. Each module follows the same 6-phase lifecycle:
   - Phase A: Deep Audit (read all code in the target service/module)
   - Phase B: Gap Identification (compare against world-class benchmark)
   - Phase C: Implementation (code the missing features)
   - Phase D: Testing (write comprehensive tests, run them)
   - Phase E: Integration (verify cross-service events, typecheck, lint)
   - Phase F: Scoring (self-assess against the 10-point rubric)
4. If a module scores < 10/10, iterate on the failing criteria before proceeding
5. Respect existing architecture: CQRS, event-driven, outbox, RLS, bigint paise, zod validation
6. Never break existing tests or APIs (backward-compatible, additive changes only)

## How to Use

Copy-paste the following into a fresh session:

```
I want to execute the CivitasOne world-class gap-closing program.

Start with Module [NUMBER]: [NAME]

Read the prompt at: docs/prompts/world-class-gaps/[FILENAME]

Execute all 6 phases (Audit → Gaps → Implement → Test → Integrate → Score).
Do not stop until the module scores 10/10.
Report the final scorecard when complete.
```

## Module Execution Order

| # | Module | Prompt File | Service | Estimated Effort |
|---|--------|-------------|---------|-----------------|
| 01 | Workflow Engine | `01-workflow-engine.md` | workflow-service | High |
| 02 | Finance | `02-finance.md` | finance-service | High |
| 03 | HRMS | `03-hrms.md` | hrms-service | High |
| 04 | Procurement | `04-procurement.md` | procurement-service | Medium |
| 05 | Asset Management | `05-asset-management.md` | asset-service | Medium |
| 06 | Grant Management | `06-grant-management.md` | grant-service | Medium |
| 07 | Citizen Services | `07-citizen-services.md` | citizen-service | Medium |
| 08 | Project Management | `08-project-management.md` | project-service | Medium |
| 09 | Legal | `09-legal.md` | legal-service | Low-Medium |
| 10 | Audit | `10-audit.md` | audit-service | Medium |
| 11 | Notification | `11-notification.md` | notification-service | Medium |
| 12 | Analytics & BI | `12-analytics.md` | analytics-service | Medium |
| 13 | CRM | `13-crm.md` | crm-service | Medium |
| 14 | Helpdesk/ITSM | `14-helpdesk.md` | helpdesk-service | Medium |
| 15 | Payroll | `15-payroll.md` | payroll-service | Medium |

## Scoring Rubric (Universal — applies to ALL modules)

Each module is scored against these 10 criteria (1 point each):

| # | Criterion | What 1 point requires |
|---|-----------|----------------------|
| 1 | **Feature Completeness** | All gaps from the prompt's gap list are implemented |
| 2 | **API Coverage** | Every new feature has HTTP routes (zod-validated) + OpenAPI docs |
| 3 | **CQRS Compliance** | All writes go through command → consumer → outbox pattern |
| 4 | **Test Coverage** | Route coverage ≥ 80%, domain logic 100% unit-tested |
| 5 | **Cross-Service Integration** | Events published/consumed correctly, topics.ts updated |
| 6 | **Security** | Tenant isolation, RBAC, PII encryption where applicable |
| 7 | **Performance** | Queries indexed, pagination enforced, cache invalidation correct |
| 8 | **Migration Safety** | Additive-only SQL, IF NOT EXISTS, idempotent |
| 9 | **TypeScript Strictness** | No `any`, no `@ts-ignore`, passes `pnpm typecheck` |
| 10 | **Backward Compatibility** | No breaking changes to existing APIs or events |

## Progress Tracker

Copy this into the session to track progress:

```
## Progress
- [ ] 01 Workflow Engine: _/10
- [ ] 02 Finance: _/10
- [ ] 03 HRMS: _/10
- [ ] 04 Procurement: _/10
- [ ] 05 Asset Management: _/10
- [ ] 06 Grant Management: _/10
- [ ] 07 Citizen Services: _/10
- [ ] 08 Project Management: _/10
- [ ] 09 Legal: _/10
- [ ] 10 Audit: _/10
- [ ] 11 Notification: _/10
- [ ] 12 Analytics & BI: _/10
- [ ] 13 CRM: _/10
- [ ] 14 Helpdesk/ITSM: _/10
- [ ] 15 Payroll: _/10
```

## Constraints

- **Do NOT add new npm dependencies** without verifying maintenance status
- **Do NOT restructure existing code** — add alongside, never replace
- **Do NOT disable or skip existing tests**
- **All money values** use `bigint` paise — never `number` for currency
- **All timestamps** use `timestamptz`
- **All queries** must filter by `tenant_id`
- **All new tables** need RLS policies
- **Max page size** = 200 rows. No unbounded SELECTs.
