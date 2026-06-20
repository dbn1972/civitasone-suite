You are expanding CivitasOne web UI to cover backend services that have APIs but zero screens.
Read CLAUDE.md, `13-gap-remediation-index.md`, and `MODULES_AND_SCHEMA.md` §1.

## Goal

Add Next.js routes under `apps/web/src/app/(app)/` with server loaders in `_data/loaders.ts` for:

| Module route prefix | Service | Priority screens (from HTML prototypes) |
|--------------------|---------|----------------------------------------|
| `/estab` | estab-service | file list, file detail, dispatch |
| `/grants` | grant-service | schemes list, applications list |
| `/legal` | legal-service | cases list |
| `/assets` | asset-service (gateway `/api/v1/asset` → `/v1/assets`) | asset register |
| `/stock` | stock-service | items, ledger |
| `/projects` | project-service | projects list, scheme detail |
| `/billing` | billing-service | plans, tenant invoices |
| `/contracts` | contract-service | contracts list |
| `/notifications` | notification-service | templates, deliveries |
| `/reports` | report-service | report jobs |
| `/inventory` | inventory-service | items |
| `/telephony` | telephony-service | calls log |
| `/locations` | location-service | locations list |

## Rules

1. **No mock data** — every list page uses `fetchJson` loader pattern (see `finance/payments/page.tsx`).
2. Add Zod response schemas to `packages/schemas/src/web.ts` per entity.
3. Add nav links in `(app)/layout.tsx` only for modules marked MVP in `MASTER_BUILD_BRIEF.md`.
4. Use existing gateway paths; verify with `tests/contract/gateway.contract.test.ts`.
5. Each loader path must match an existing `GET` route in the target service.

## Deliverables

- New `page.tsx` files (list views minimum)
- Loader functions + mappers in `loaders.ts`
- Schemas in `packages/schemas/src/web.ts`
- Update `13-gap-remediation-index.md` checklist when done

## Do NOT

- Add write forms yet (read-only list screens first)
- Duplicate helpdesk (citizen-service owns citizen tickets — see prompt 16)
