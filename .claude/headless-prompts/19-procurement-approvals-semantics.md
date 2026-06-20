You are fixing the procurement approvals screen semantic mismatch.
Read `apps/web/src/app/(app)/procurement/approvals/page.tsx` and `loaders.ts` `getProcurementApprovals`.

## Problem

- Screen title: "Approvals"
- Loader calls: `GET /api/v1/procurement/indents?status=pending`
- `mapApprovals()` expects approval-shaped objects; indents return different schema → empty UI on 200

## Options (pick A)

**A:** Add dedicated endpoint `GET /api/v1/procurement/approvals` in procurement-service aggregating pending indents + PO approvals into `ApprovalSummary` shape.

**B:** Fix `mapApprovals()` to map indent fields correctly and rename screen to "Pending Indents".

## If Option A

1. Add `modules/approvals/` in procurement-service (read-only query, no new tables — joins indents/POs).
2. Response schema: `{ data: ApprovalSummary[] }` matching `@civitasone/types`.
3. Update loader path to `/api/v1/procurement/approvals`.
4. Add contract test entry.

## Verify

```bash
pnpm --filter @civitasone/procurement-service build
pnpm --filter @civitasone/web typecheck
```
