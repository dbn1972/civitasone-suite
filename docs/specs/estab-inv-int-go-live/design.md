# Design Document

## Overview

This document records the design decisions for the go-live gap-closure work across
Establishment, Inventory, and the Procurement integration chain. It is the source of
truth for implementation choices so that agents (Kiro, Cursor) produce consistent
code without re-litigating decisions in each task.

---

## 1. Store Receipt Note (SRN)

**Location**: `services/inventory-service` — the SRN belongs to the inventory domain
because it records physical acceptance into store, not a procurement decision.

**DB schema** (PG schema `inventory`):
```sql
CREATE TABLE inventory.store_receipt_notes (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     uuid NOT NULL,
  grn_id        uuid NOT NULL REFERENCES grn.procurement_grns(id),
  store_officer_id uuid NOT NULL,
  received_at   timestamptz NOT NULL DEFAULT now(),
  remarks       text,
  status        text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','signed')),
  created_at    timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE inventory.store_receipt_notes ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_iso ON inventory.store_receipt_notes
  USING (tenant_id = current_setting('app.tenant_id')::uuid);
```

**API contract**:
- `POST /v1/inventory/srn` body: `{ grnId, remarks? }` → 201 `{ id, status: 'draft' }`
- `PATCH /v1/inventory/srn/:id/sign` → 200 `{ status: 'signed' }`
- `GET /v1/inventory/srn/:grnId` → 200 `{ srn | null }`

**Three-way match gate**: consumer in `matching/consumer.ts` checks `srn.status === 'signed'`
before publishing `payment.released`. If absent or draft, publishes `payment.blocked` with
`reason: 'SRN_MISSING'`.

**Web layout** (consistent with existing GRN pages):
- `/procurement/grn/[id]/page.tsx` — add SRN status chip + "Create SRN" link below acceptance status
- `/procurement/grn/[id]/srn/new/page.tsx` — minimal form (store officer pre-filled, received date, remarks, Sign & Submit button)
- `/procurement/grn/[id]/srn/page.tsx` — read-only view with signed badge

---

## 2. GRN Amendment

**State machine**: GRN statuses are `draft → under_inspection → accepted | rejected`.
Amendment is only allowed in `draft` and `under_inspection`. Once `accepted`, the
GRN is immutable — return 409.

**PATCH body**: `{ lines: [{ lineId, receivedQty, acceptedQty }] }`. Only line
quantities change; grnNo, vendorId, and poRef are immutable.

**UI pattern**: The GRN detail page renders a read-only summary with an "Amend" button
when status is editable. Clicking Amend replaces each qty cell with an `<input>` inline.
"Save changes" calls PATCH. Same approach as the existing `PayrollRunActions.tsx`
pattern (conditional render based on status).

---

## 3. Consumables Module

**Domain rule**: `isReorderRequired(balance, reorderLevel) = balance < reorderLevel`
(strict less-than; balance equals threshold does NOT trigger reorder).

**Balance delta**: `upsertBalance` uses `INSERT ... ON CONFLICT (tenant_id, item_id) DO UPDATE SET balance = excluded.balance + delta, updated_at = now()`.
This makes concurrent increments safe without application-level locking.

**Table**: `files.estab_consumables` (uses the `files` PG schema consistent with
other estab tables — not a new schema). Migration: add after existing estab migrations.

---

## 4. WCAG Implementation Patterns

### Skip Link
Use Tailwind's `sr-only` / `focus:not-sr-only` utility classes. The link must be the
*first* child of the layout wrapper (before the `<nav>` sidebar). Do not put it inside
the nav — it must be reachable before any navigation elements.

```tsx
<a
  href="#main-content"
  className="sr-only focus:not-sr-only focus:fixed focus:top-2 focus:left-2
             focus:z-50 focus:bg-white dark:focus:bg-slate-900
             focus:text-navy focus:px-4 focus:py-2 focus:rounded focus:shadow-lg
             focus:text-sm focus:font-semibold"
>
  Skip to main content
</a>
```

### Focus Trap (DispatchPOActions)
Prefer `@radix-ui/react-dialog` which already implements focus trapping (it is in the
project's dependency tree via shadcn/ui). Refactor `DispatchPOActions` to use
`Dialog` / `DialogContent` from `@/components/ui/dialog` instead of a custom overlay.
If refactoring is too large in scope, use `focus-trap-react` as a wrapper.

### ARIA Live Regions
- Use `aria-live="polite"` for notifications (non-interrupting).
- Use `aria-live="assertive"` only for wizard step announcements (user is expecting
  a response to their explicit action).
- Never put `aria-live` on an element that is conditionally rendered — it must
  persist in the DOM; only its *text content* changes.

### Color Contrast — Badge Colours
Approved replacement values (verified at 4.5:1 on white, 3:1 on `#F4F7FD` surface):

| Old | New | Ratio on white |
|---|---|---|
| `#FF6B00` (file status orange) | `#C55200` | 4.7:1 |

For status badges where background is the primary signal, use the badge background +
text pattern: light-bg with dark text. Example: `bg-[#FFF3E0] text-[#7A3300]` for
pending (5.2:1 on white surface).

### Chart Alternative Tables
Pattern: render `<table className="sr-only">` as a sibling immediately after the chart
component. Use the *same* data prop the chart receives. The table must not use
`display:none` or `visibility:hidden` — those hide from screen readers too.

```tsx
<ForecastChart data={forecast} />
<table className="sr-only" aria-label="Forecast data table">
  <thead><tr><th>Month</th><th>Predicted demand</th></tr></thead>
  <tbody>{forecast.map(row => <tr key={row.month}><td>{row.month}</td><td>{row.qty}</td></tr>)}</tbody>
</table>
```

---

## 5. E2E Spec Conventions

All E2E specs follow the existing pattern in `tests/e2e-live/`:
- Use `baseURL` from `process.env.PLAYWRIGHT_BASE_URL ?? 'https://localhost:3000'`
- Authenticate via `page.goto('/api/test/login?role=...')` (existing test-auth endpoint)
- Assert on accessible roles (`getByRole`, `getByLabel`) not on CSS selectors
- Each spec is independent: seed its own data via API before the test, clean up after

**Naming**: `{module}-{flow}-journey.spec.ts` for happy paths; `{concept}-mismatch.spec.ts`
for error/edge paths.

---

## 6. File Movement Timeline Design

**Component**: `MovementTimeline.tsx` — a pure presentational component.

**Data shape** (from `estab_file_movements`):
```ts
type Movement = {
  id: string
  fromOfficerId: string | null
  fromOfficerName: string | null
  toOfficerId: string
  toOfficerName: string
  action: string         // 'SENT' | 'RECEIVED' | 'RECALLED' | 'RETURNED'
  movedAt: string        // ISO date
  statusAtTime?: string  // file status at the time of movement
}
```

**Layout**: vertical list with a left-aligned timeline rail (2 px coloured line).
Each entry: date chip (left) → coloured dot on the rail → action verb → officer names
→ status badge. No external dependencies needed; pure CSS with Tailwind.

**Accessibility**: wrap in `<ol aria-label="File movement history">` with each entry
as `<li>`. The date must be a `<time datetime={isoDate}>` element.

---

## 7. Legacy Route Redirect Strategy

Use Next.js `redirects()` in `next.config.js` (runs at the edge, no JS bundle cost):

```js
async redirects() {
  return [
    { source: '/stock', destination: '/inventory', permanent: true },
    { source: '/stock/list', destination: '/inventory/list', permanent: true },
    { source: '/stock/ledger', destination: '/inventory/reconcile', permanent: true },
    { source: '/stock/dashboard', destination: '/inventory', permanent: true },
    { source: '/stock/:path*', destination: '/inventory/:path*', permanent: true },
  ]
}
```

The catch-all `/stock/:path*` must be the last entry (most specific first). This does
not require changing the stock-service proxy — that layer can remain as-is until the
full stock-service deprecation in a future sprint.
