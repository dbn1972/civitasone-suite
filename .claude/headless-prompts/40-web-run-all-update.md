# 40-web-run-all-update — Wire Nav Links + Dashboard Tiles + Final Typecheck

## Context

This is the final integration prompt for the CivitasOne web frontend. All module pages have been built by prompts 30-39. This prompt wires everything together: global navigation sidebar, the main dashboard module tiles, and runs a final typecheck to catch any remaining errors.

## Step 1 — Read all relevant files

Read these files to understand current state:

```
apps/web/src/app/(app)/layout.tsx
apps/web/src/app/(app)/dashboard/page.tsx
apps/web/src/app/(app)/finance/page.tsx
apps/web/src/app/(app)/hr/page.tsx
apps/web/src/app/(app)/procurement/page.tsx
apps/web/src/app/(app)/projects/page.tsx
apps/web/src/app/(app)/grants/page.tsx
apps/web/src/app/(app)/estab/page.tsx
apps/web/src/app/(app)/assets/page.tsx
apps/web/src/app/(app)/stock/page.tsx
apps/web/src/app/(app)/crm/page.tsx
apps/web/src/app/(app)/helpdesk/page.tsx
apps/web/src/app/(app)/citizen/page.tsx
apps/web/src/app/(app)/audit/page.tsx
apps/web/src/app/(app)/legal/page.tsx
apps/web/src/app/(app)/reports/page.tsx
apps/web/src/app/(app)/tenant-admin/page.tsx
```

## Step 2 — Update `apps/web/src/app/(app)/layout.tsx`

Read the existing layout.tsx carefully to understand the current nav structure (sidebar or header). Then update the navigation to include ALL modules grouped into categories.

The nav must have these groups and links. Use whatever nav component pattern already exists in the file (do not change the component structure — just update the links list):

```
Core:
  - Dashboard → /dashboard
  - Tenant Admin → /tenant-admin

Finance:
  - Finance → /finance
    - Dashboard → /finance/dashboard
    - Budget Formulation → /finance/budget/formulation
    - Sanctions → /finance/budget/sanctions
    - Bills → /finance/expenditure/bills
    - Advances → /finance/expenditure/advances
    - Utilization Certificates → /finance/expenditure/utilization-certificates
    - General Ledger → /finance/accounting/general-ledger
    - New Voucher → /finance/accounting/vouchers/new
    - Financial Statements → /finance/accounting/financial-statements
    - Chart of Accounts → /finance/chart-of-accounts
    - Payments → /finance/payments

Operations:
  - HR → /hr
  - Procurement → /procurement
  - Projects → /projects
  - Grants → /grants
  - Establishment → /estab
  - Assets → /assets
  - Stock → /stock

Citizen Services:
  - CRM → /crm
  - Helpdesk → /helpdesk
  - Citizen Portal → /citizen

Governance:
  - Audit → /audit
  - Legal → /legal

Platform:
  - Reports → /reports
  - Knowledge → /knowledge
  - Notifications → /notifications
```

If the layout uses a flat nav array (e.g., `const navLinks = [...]`), update it to add all missing items.
If the layout uses grouped sections, add the groups above.
If the layout already has some of these, update/add only the missing ones.

Do NOT break any existing nav component — read the file first and minimally edit the links/groups data.

## Step 3 — Update `apps/web/src/app/(app)/dashboard/page.tsx`

Read the existing dashboard page. It likely shows 6 module tiles. Update it to show ALL modules as tiles in a responsive grid.

The new dashboard must show one tile per major module. Each tile must have:
- Module name (text)
- Short description (1 line)
- Link to the module hub page

Here is the full tile list to show:

```typescript
const modules = [
  { name: "Finance", description: "Budgets, bills, payments, GL", href: "/finance" },
  { name: "HR & Payroll", description: "Employees, attendance, leave, payroll", href: "/hr" },
  { name: "Procurement", description: "Indents, vendors, POs, GRN", href: "/procurement" },
  { name: "Projects", description: "Projects, milestones, fund releases", href: "/projects" },
  { name: "Grants", description: "Grants, grantees, releases, UCs", href: "/grants" },
  { name: "Establishment", description: "Files, meetings, vehicles, compliance", href: "/estab" },
  { name: "Assets", description: "Fixed assets, maintenance, depreciation", href: "/assets" },
  { name: "Stock & Inventory", description: "SKUs, stock ledger, low stock alerts", href: "/stock" },
  { name: "CRM", description: "Contacts, deals, pipeline", href: "/crm" },
  { name: "Helpdesk", description: "Tickets, SLA, escalations", href: "/helpdesk" },
  { name: "Citizen Portal", description: "Requests, RTI, feedback", href: "/citizen" },
  { name: "Audit", description: "Observations, risk register, compliance", href: "/audit" },
  { name: "Legal", description: "Cases, hearings, court orders", href: "/legal" },
  { name: "Reports", description: "Analytics, KPIs, MIS", href: "/reports" },
  { name: "Knowledge", description: "Documents, records, search", href: "/knowledge" },
  { name: "Notifications", description: "Alerts, deliveries, preferences", href: "/notifications" },
  { name: "Tenant Admin", description: "Users, roles, settings, billing", href: "/tenant-admin" },
];
```

Render them in a grid:
```tsx
<div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-4">
  {modules.map((mod) => (
    <Link
      key={mod.href}
      href={mod.href}
      className="block bg-white border rounded-xl p-4 hover:border-blue-400 hover:shadow-md transition-all"
    >
      <h3 className="font-semibold text-gray-900 text-sm">{mod.name}</h3>
      <p className="text-xs text-gray-500 mt-1">{mod.description}</p>
    </Link>
  ))}
</div>
```

Keep any existing stats/summary cards at the top of the dashboard page — only update the module tiles section.

## Step 4 — Create missing hub pages

Check if these pages exist. If they do not exist, create minimal hub pages for them:

### `/knowledge/page.tsx` (if missing)
```tsx
import Link from "next/link";
import { PageShell } from "@civitasone/ui-kit";

export default function KnowledgePage() {
  const links = [
    { label: "Dashboard", href: "/knowledge/dashboard" },
    { label: "Document Repository", href: "/knowledge/repository" },
    { label: "Records Management", href: "/knowledge/records" },
    { label: "Search", href: "/knowledge/search" },
  ];
  return (
    <PageShell>
      <h1 className="text-2xl font-semibold mb-6">Knowledge Management</h1>
      <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
        {links.map((l) => (
          <Link key={l.href} href={l.href} className="block bg-white border rounded-lg p-4 hover:border-blue-400 text-sm font-medium text-gray-700">
            {l.label}
          </Link>
        ))}
      </div>
    </PageShell>
  );
}
```

### `/citizen/page.tsx` (if missing)
```tsx
import Link from "next/link";
import { PageShell } from "@civitasone/ui-kit";

export default function CitizenPage() {
  const links = [
    { label: "Service Requests", href: "/citizen/requests" },
    { label: "RTI Applications", href: "/citizen/rti" },
  ];
  return (
    <PageShell>
      <h1 className="text-2xl font-semibold mb-6">Citizen Portal</h1>
      <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
        {links.map((l) => (
          <Link key={l.href} href={l.href} className="block bg-white border rounded-lg p-4 hover:border-blue-400 text-sm font-medium text-gray-700">
            {l.label}
          </Link>
        ))}
      </div>
    </PageShell>
  );
}
```

## Step 5 — Run typecheck and fix errors

```bash
cd ~/CivitasOne/civitasone-suite
pnpm --filter @civitasone/schemas typecheck
pnpm --filter @civitasone/web typecheck
```

Read the full output carefully. Fix ALL TypeScript errors before completing this prompt.

Common categories of errors to fix:

### A. Missing type exports
If `packages/types/src/index.ts` is missing an export that `packages/schemas/src/web.ts` or loaders.ts references, add the type.

### B. Schema/type mismatch in loaders
Loaders that reference a schema `FinanceDashboardSchema` must import it from `packages/schemas/src/web.ts`. Check the import section of loaders.ts and add any missing imports.

### C. Dynamic route params typing
All `[id]` page components must have:
```typescript
export default async function SomePage({ params }: { params: { id: string } }) {
```

### D. Zod schema circular references
The `OrgChartNodeSchema` uses `z.lazy()` — if TypeScript complains about the type, use explicit type annotation:
```typescript
type OrgChartNodeType = z.infer<typeof OrgChartNodeSchema>;
```

### E. Import path issues
Loaders.ts should import schemas from `@civitasone/schemas`. Pages import loaders from `"../../../_data/loaders"` (adjust `../` count based on depth).

### F. "use client" + server imports
Pages marked `"use client"` must NOT import server-only modules. The voucher form, leave apply, file new, org chart, knowledge search pages are client components — ensure they only use browser-safe imports.

### G. Missing `z` import
If any schema file uses Zod without importing it, add: `import { z } from "zod";`

After fixing all errors, run typecheck again to confirm:
```bash
cd ~/CivitasOne/civitasone-suite
pnpm --filter @civitasone/schemas typecheck
pnpm --filter @civitasone/web typecheck
```

Both commands must exit with 0 errors before this prompt is considered complete.

## Step 6 — Final verification summary

After clean typecheck, output a summary listing:
1. All new pages created (path only)
2. All existing pages enhanced
3. Any pages skipped and why
4. Any TypeScript errors that were fixed

This summary is for the development team's record.
