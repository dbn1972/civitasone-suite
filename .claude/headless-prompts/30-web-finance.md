# 30-web-finance — Build Finance Module Web Screens

## Context

You are building Next.js web screens for the Finance module of CivitasOne, a government ERP platform.

### Pattern every screen MUST follow

1. **Server Component** — `apps/web/src/app/(app)/{module}/{screen}/page.tsx` — async function, calls a loader, renders JSX with Tailwind
2. **Loader** — added to `apps/web/src/app/_data/loaders.ts` — calls `fetchJson(apiPath, empty, { revalidateSeconds, telemetryKey, responseSchema, mapResponse })`
3. **Zod schema** — added to `packages/schemas/src/web.ts`
4. **Type** — summary types in `packages/types/src/index.ts`
5. **Components used**: `PageShell`, `DataSourceBadge` from `@civitasone/ui-kit` or `../../../_components/`
6. **Breadcrumb**: `<Link href="/module">Module</Link> / ScreenName`
7. **Stats row**: 4 `<div class="stat">` cards showing KPIs from API (or defaults if empty)
8. **Table**: `<table class="tbl">` with thead + tbody mapping over loader data
9. **Status pills**: `<span class="rounded-full bg-{color}-50 px-2 py-1 text-xs ...">status</span>`
10. **Error handling**: `{source === "error" ? <DataSourceBadge source={source} /> : null}`

### Gateway API prefix for finance
- finance: `/api/v1/finance`

## Step 1 — Read existing patterns

Read these files to understand existing conventions before writing any new code:

```
apps/web/src/app/(app)/finance/chart-of-accounts/page.tsx
apps/web/src/app/(app)/finance/payments/page.tsx
apps/web/src/app/_data/loaders.ts
packages/schemas/src/web.ts
packages/types/src/index.ts
apps/web/src/app/(app)/finance/page.tsx
```

Also read the HTML prototypes from `~/CivitasOne/erpnext-develop/finance-module/web/`:
- `dashboard.html`
- `chart-of-accounts.html`
- `budget-formulation.html`
- `budget-form.html`
- `sanctions.html`
- `sanction-detail.html`
- `bill-processing.html`
- `bill-detail.html`
- `general-ledger.html`
- `receipts-payments.html`
- `voucher-form.html`
- `payments-advice.html`
- `advances.html`
- `utilization-certificates.html`
- `financial-statements.html`

## Step 2 — Add Zod schemas to `packages/schemas/src/web.ts`

Add these schemas (append, do not overwrite existing content):

```typescript
// Finance schemas
export const FinanceDashboardSchema = z.object({
  budgetUtilisationPct: z.number().default(0),
  pendingSanctions: z.number().default(0),
  paymentsThisMonth: z.number().default(0),
  totalExpenditure: z.number().default(0),
});

export const BudgetSummarySchema = z.object({
  id: z.string(),
  majorHead: z.string(),
  subHead: z.string().optional(),
  sanctionedAmount: z.number(),
  releasedAmount: z.number(),
  expenditure: z.number(),
  balance: z.number(),
  status: z.string(),
  financialYear: z.string(),
});
export const BudgetSummaryListSchema = z.array(BudgetSummarySchema);

export const SanctionSummarySchema = z.object({
  id: z.string(),
  sanctionNo: z.string(),
  subject: z.string(),
  amount: z.number(),
  sanctionedBy: z.string(),
  date: z.string(),
  status: z.enum(["approved", "pending", "rejected"]),
  majorHead: z.string(),
});
export const SanctionSummaryListSchema = z.array(SanctionSummarySchema);

export const SanctionDetailSchema = SanctionSummarySchema.extend({
  lineItems: z.array(z.object({
    description: z.string(),
    amount: z.number(),
    head: z.string(),
  })).default([]),
  remarks: z.string().optional(),
  approvalTrail: z.array(z.object({
    actor: z.string(),
    action: z.string(),
    timestamp: z.string(),
  })).default([]),
});

export const BillSummarySchema = z.object({
  id: z.string(),
  billNo: z.string(),
  vendor: z.string(),
  amount: z.number(),
  submittedDate: z.string(),
  dueDate: z.string().optional(),
  status: z.enum(["pending", "approved", "paid", "rejected", "under_review"]),
  poRef: z.string().optional(),
  threeWayMatch: z.enum(["matched", "partial", "unmatched", "na"]).default("na"),
});
export const BillSummaryListSchema = z.array(BillSummarySchema);

export const BillDetailSchema = BillSummarySchema.extend({
  lineItems: z.array(z.object({
    description: z.string(),
    quantity: z.number(),
    unitPrice: z.number(),
    amount: z.number(),
    taxCode: z.string().optional(),
  })).default([]),
  grnRef: z.string().optional(),
  invoiceNo: z.string().optional(),
  paymentRef: z.string().optional(),
});

export const AdvanceSummarySchema = z.object({
  id: z.string(),
  advanceNo: z.string(),
  beneficiary: z.string(),
  type: z.enum(["employee", "vendor", "other"]),
  amount: z.number(),
  disbursedDate: z.string(),
  dueDate: z.string().optional(),
  adjustedAmount: z.number().default(0),
  balance: z.number(),
  status: z.enum(["active", "adjusted", "overdue", "closed"]),
});
export const AdvanceSummaryListSchema = z.array(AdvanceSummarySchema);

export const UCSummarySchema = z.object({
  id: z.string(),
  ucNo: z.string(),
  grantRef: z.string().optional(),
  grantee: z.string(),
  amount: z.number(),
  periodFrom: z.string(),
  periodTo: z.string(),
  submittedDate: z.string().optional(),
  status: z.enum(["pending", "submitted", "verified", "rejected"]),
});
export const UCSummaryListSchema = z.array(UCSummarySchema);

export const GLEntrySummarySchema = z.object({
  id: z.string(),
  voucherNo: z.string(),
  date: z.string(),
  accountCode: z.string(),
  accountName: z.string(),
  debit: z.number().default(0),
  credit: z.number().default(0),
  narration: z.string().optional(),
  referenceNo: z.string().optional(),
});
export const GLEntrySummaryListSchema = z.array(GLEntrySummarySchema);

export const FinancialStatementSummarySchema = z.object({
  id: z.string(),
  head: z.string(),
  openingBalance: z.number(),
  receipts: z.number(),
  payments: z.number(),
  closingBalance: z.number(),
  type: z.enum(["asset", "liability", "income", "expenditure"]),
});
export const FinancialStatementSummaryListSchema = z.array(FinancialStatementSummarySchema);
```

## Step 3 — Add types to `packages/types/src/index.ts`

Append these types (check if they already exist before adding):

```typescript
export type BudgetSummary = {
  id: string;
  majorHead: string;
  subHead?: string;
  sanctionedAmount: number;
  releasedAmount: number;
  expenditure: number;
  balance: number;
  status: string;
  financialYear: string;
};

export type SanctionSummary = {
  id: string;
  sanctionNo: string;
  subject: string;
  amount: number;
  sanctionedBy: string;
  date: string;
  status: "approved" | "pending" | "rejected";
  majorHead: string;
};

export type BillSummary = {
  id: string;
  billNo: string;
  vendor: string;
  amount: number;
  submittedDate: string;
  dueDate?: string;
  status: "pending" | "approved" | "paid" | "rejected" | "under_review";
  poRef?: string;
  threeWayMatch: "matched" | "partial" | "unmatched" | "na";
};

export type AdvanceSummary = {
  id: string;
  advanceNo: string;
  beneficiary: string;
  type: "employee" | "vendor" | "other";
  amount: number;
  disbursedDate: string;
  dueDate?: string;
  adjustedAmount: number;
  balance: number;
  status: "active" | "adjusted" | "overdue" | "closed";
};

export type UCSummary = {
  id: string;
  ucNo: string;
  grantRef?: string;
  grantee: string;
  amount: number;
  periodFrom: string;
  periodTo: string;
  submittedDate?: string;
  status: "pending" | "submitted" | "verified" | "rejected";
};

export type GLEntrySummary = {
  id: string;
  voucherNo: string;
  date: string;
  accountCode: string;
  accountName: string;
  debit: number;
  credit: number;
  narration?: string;
  referenceNo?: string;
};

export type FinancialStatementSummary = {
  id: string;
  head: string;
  openingBalance: number;
  receipts: number;
  payments: number;
  closingBalance: number;
  type: "asset" | "liability" | "income" | "expenditure";
};
```

## Step 4 — Add loaders to `apps/web/src/app/_data/loaders.ts`

Append these loader functions:

```typescript
export async function getFinanceDashboard() {
  return fetchJson("/api/v1/finance/accounts", {} as FinanceDashboardSchema, {
    revalidateSeconds: 60,
    telemetryKey: "finance.dashboard",
    responseSchema: FinanceDashboardSchema,
  });
}

export async function getFinanceBudgets() {
  return fetchJson("/api/v1/finance/budgets", [] as BudgetSummary[], {
    revalidateSeconds: 120,
    telemetryKey: "finance.budgets",
    responseSchema: BudgetSummaryListSchema,
  });
}

export async function getFinanceSanctions() {
  return fetchJson("/api/v1/finance/sanctions", [] as SanctionSummary[], {
    revalidateSeconds: 60,
    telemetryKey: "finance.sanctions",
    responseSchema: SanctionSummaryListSchema,
  });
}

export async function getFinanceSanctionById(id: string) {
  return fetchJson(`/api/v1/finance/sanctions/${id}`, null, {
    revalidateSeconds: 30,
    telemetryKey: "finance.sanction.detail",
    responseSchema: SanctionDetailSchema,
  });
}

export async function getFinanceBills() {
  return fetchJson("/api/v1/finance/bills", [] as BillSummary[], {
    revalidateSeconds: 60,
    telemetryKey: "finance.bills",
    responseSchema: BillSummaryListSchema,
  });
}

export async function getFinanceBillById(id: string) {
  return fetchJson(`/api/v1/finance/bills/${id}`, null, {
    revalidateSeconds: 30,
    telemetryKey: "finance.bill.detail",
    responseSchema: BillDetailSchema,
  });
}

export async function getFinanceAdvances() {
  return fetchJson("/api/v1/finance/advances", [] as AdvanceSummary[], {
    revalidateSeconds: 120,
    telemetryKey: "finance.advances",
    responseSchema: AdvanceSummaryListSchema,
  });
}

export async function getFinanceUCs() {
  return fetchJson("/api/v1/finance/utilization-certificates", [] as UCSummary[], {
    revalidateSeconds: 120,
    telemetryKey: "finance.ucs",
    responseSchema: UCSummaryListSchema,
  });
}

export async function getFinanceGLEntries() {
  return fetchJson("/api/v1/finance/journals", [] as GLEntrySummary[], {
    revalidateSeconds: 60,
    telemetryKey: "finance.gl",
    responseSchema: GLEntrySummaryListSchema,
  });
}

export async function getFinancialStatements() {
  return fetchJson("/api/v1/finance/statements", [] as FinancialStatementSummary[], {
    revalidateSeconds: 300,
    telemetryKey: "finance.statements",
    responseSchema: FinancialStatementSummaryListSchema,
  });
}
```

## Step 5 — Build each page

### 5.1 `/finance/dashboard/page.tsx`

Create `apps/web/src/app/(app)/finance/dashboard/page.tsx`:

```tsx
import Link from "next/link";
import { PageShell, DataSourceBadge } from "@civitasone/ui-kit";
import { getFinanceDashboard } from "../../../_data/loaders";

export default async function FinanceDashboardPage() {
  const { data, source } = await getFinanceDashboard();

  const stats = {
    budgetUtilisationPct: data?.budgetUtilisationPct ?? 0,
    pendingSanctions: data?.pendingSanctions ?? 0,
    paymentsThisMonth: data?.paymentsThisMonth ?? 0,
    totalExpenditure: data?.totalExpenditure ?? 0,
  };

  return (
    <PageShell>
      <div className="flex items-center justify-between mb-6">
        <div>
          <nav className="text-sm text-gray-500 mb-1">
            <Link href="/finance" className="hover:underline">Finance</Link>
            {" / "}Dashboard
          </nav>
          <h1 className="text-2xl font-semibold text-gray-900">Finance Dashboard</h1>
        </div>
      </div>

      {source === "error" ? <DataSourceBadge source={source} /> : null}

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
        <div className="stat bg-white rounded-lg border p-4">
          <p className="text-sm text-gray-500">Budget Utilisation</p>
          <p className="text-2xl font-bold text-blue-600">{stats.budgetUtilisationPct.toFixed(1)}%</p>
        </div>
        <div className="stat bg-white rounded-lg border p-4">
          <p className="text-sm text-gray-500">Pending Sanctions</p>
          <p className="text-2xl font-bold text-yellow-600">{stats.pendingSanctions}</p>
        </div>
        <div className="stat bg-white rounded-lg border p-4">
          <p className="text-sm text-gray-500">Payments This Month</p>
          <p className="text-2xl font-bold text-green-600">₹{(stats.paymentsThisMonth / 100).toLocaleString("en-IN")}</p>
        </div>
        <div className="stat bg-white rounded-lg border p-4">
          <p className="text-sm text-gray-500">Total Expenditure</p>
          <p className="text-2xl font-bold text-gray-900">₹{(stats.totalExpenditure / 100).toLocaleString("en-IN")}</p>
        </div>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
        {[
          { label: "Budget Formulation", href: "/finance/budget/formulation" },
          { label: "Sanctions", href: "/finance/budget/sanctions" },
          { label: "Bill Processing", href: "/finance/expenditure/bills" },
          { label: "Advances", href: "/finance/expenditure/advances" },
          { label: "Utilization Certificates", href: "/finance/expenditure/utilization-certificates" },
          { label: "General Ledger", href: "/finance/accounting/general-ledger" },
          { label: "New Voucher", href: "/finance/accounting/vouchers/new" },
          { label: "Financial Statements", href: "/finance/accounting/financial-statements" },
          { label: "Chart of Accounts", href: "/finance/chart-of-accounts" },
          { label: "Payments", href: "/finance/payments" },
        ].map((link) => (
          <Link
            key={link.href}
            href={link.href}
            className="block bg-white border rounded-lg p-4 hover:border-blue-400 hover:shadow-sm transition-all text-sm font-medium text-gray-700"
          >
            {link.label}
          </Link>
        ))}
      </div>
    </PageShell>
  );
}
```

### 5.2 `/finance/budget/formulation/page.tsx`

Create `apps/web/src/app/(app)/finance/budget/formulation/page.tsx`:

```tsx
import Link from "next/link";
import { PageShell, DataSourceBadge } from "@civitasone/ui-kit";
import { getFinanceBudgets } from "../../../../_data/loaders";

const statusColors: Record<string, string> = {
  approved: "bg-green-50 text-green-700",
  pending: "bg-yellow-50 text-yellow-700",
  rejected: "bg-red-50 text-red-700",
  draft: "bg-gray-50 text-gray-700",
};

export default async function BudgetFormulationPage() {
  const { data: budgets = [], source } = await getFinanceBudgets();

  const totalSanctioned = budgets.reduce((s, b) => s + b.sanctionedAmount, 0);
  const totalExpenditure = budgets.reduce((s, b) => s + b.expenditure, 0);
  const totalBalance = budgets.reduce((s, b) => s + b.balance, 0);
  const utilPct = totalSanctioned > 0 ? ((totalExpenditure / totalSanctioned) * 100).toFixed(1) : "0.0";

  return (
    <PageShell>
      <div className="flex items-center justify-between mb-6">
        <div>
          <nav className="text-sm text-gray-500 mb-1">
            <Link href="/finance" className="hover:underline">Finance</Link>
            {" / "}
            <Link href="/finance/budget/formulation" className="hover:underline">Budget</Link>
            {" / "}Formulation
          </nav>
          <h1 className="text-2xl font-semibold text-gray-900">Budget Formulation</h1>
        </div>
        <Link href="/finance/budget/sanctions/new" className="btn-primary px-4 py-2 rounded bg-blue-600 text-white text-sm hover:bg-blue-700">
          + New Budget
        </Link>
      </div>

      {source === "error" ? <DataSourceBadge source={source} /> : null}

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
        <div className="stat bg-white rounded-lg border p-4">
          <p className="text-sm text-gray-500">Total Budgets</p>
          <p className="text-2xl font-bold">{budgets.length}</p>
        </div>
        <div className="stat bg-white rounded-lg border p-4">
          <p className="text-sm text-gray-500">Sanctioned Amount</p>
          <p className="text-2xl font-bold text-blue-600">₹{(totalSanctioned / 100).toLocaleString("en-IN")}</p>
        </div>
        <div className="stat bg-white rounded-lg border p-4">
          <p className="text-sm text-gray-500">Expenditure</p>
          <p className="text-2xl font-bold text-red-600">₹{(totalExpenditure / 100).toLocaleString("en-IN")}</p>
        </div>
        <div className="stat bg-white rounded-lg border p-4">
          <p className="text-sm text-gray-500">Utilisation %</p>
          <p className="text-2xl font-bold text-green-600">{utilPct}%</p>
        </div>
      </div>

      <div className="bg-white rounded-lg border overflow-x-auto">
        <table className="tbl w-full text-sm">
          <thead className="bg-gray-50 text-gray-600 text-xs uppercase">
            <tr>
              <th className="px-4 py-3 text-left">Major Head</th>
              <th className="px-4 py-3 text-left">Sub Head</th>
              <th className="px-4 py-3 text-right">Sanctioned (₹)</th>
              <th className="px-4 py-3 text-right">Released (₹)</th>
              <th className="px-4 py-3 text-right">Expenditure (₹)</th>
              <th className="px-4 py-3 text-right">Balance (₹)</th>
              <th className="px-4 py-3 text-left">FY</th>
              <th className="px-4 py-3 text-left">Status</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {budgets.length === 0 ? (
              <tr>
                <td colSpan={8} className="px-4 py-8 text-center text-gray-400">No budget records found</td>
              </tr>
            ) : (
              budgets.map((b) => (
                <tr key={b.id} className="hover:bg-gray-50">
                  <td className="px-4 py-3 font-medium">{b.majorHead}</td>
                  <td className="px-4 py-3 text-gray-600">{b.subHead ?? "—"}</td>
                  <td className="px-4 py-3 text-right">₹{(b.sanctionedAmount / 100).toLocaleString("en-IN")}</td>
                  <td className="px-4 py-3 text-right">₹{(b.releasedAmount / 100).toLocaleString("en-IN")}</td>
                  <td className="px-4 py-3 text-right">₹{(b.expenditure / 100).toLocaleString("en-IN")}</td>
                  <td className="px-4 py-3 text-right">₹{(b.balance / 100).toLocaleString("en-IN")}</td>
                  <td className="px-4 py-3 text-gray-600">{b.financialYear}</td>
                  <td className="px-4 py-3">
                    <span className={`rounded-full px-2 py-1 text-xs font-medium ${statusColors[b.status] ?? "bg-gray-50 text-gray-700"}`}>
                      {b.status}
                    </span>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </PageShell>
  );
}
```

### 5.3 `/finance/budget/sanctions/page.tsx`

Create `apps/web/src/app/(app)/finance/budget/sanctions/page.tsx`:

```tsx
import Link from "next/link";
import { PageShell, DataSourceBadge } from "@civitasone/ui-kit";
import { getFinanceSanctions } from "../../../../_data/loaders";

const statusColors: Record<string, string> = {
  approved: "bg-green-50 text-green-700",
  pending: "bg-yellow-50 text-yellow-700",
  rejected: "bg-red-50 text-red-700",
};

export default async function SanctionsPage() {
  const { data: sanctions = [], source } = await getFinanceSanctions();

  const approved = sanctions.filter((s) => s.status === "approved").length;
  const pending = sanctions.filter((s) => s.status === "pending").length;
  const rejected = sanctions.filter((s) => s.status === "rejected").length;
  const totalAmount = sanctions.reduce((sum, s) => sum + s.amount, 0);

  return (
    <PageShell>
      <div className="flex items-center justify-between mb-6">
        <div>
          <nav className="text-sm text-gray-500 mb-1">
            <Link href="/finance" className="hover:underline">Finance</Link>
            {" / "}Budget{" / "}Sanctions
          </nav>
          <h1 className="text-2xl font-semibold text-gray-900">Sanctions</h1>
        </div>
        <Link href="/finance/budget/sanctions/new" className="px-4 py-2 rounded bg-blue-600 text-white text-sm hover:bg-blue-700">
          + New Sanction
        </Link>
      </div>

      {source === "error" ? <DataSourceBadge source={source} /> : null}

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
        <div className="stat bg-white rounded-lg border p-4">
          <p className="text-sm text-gray-500">Total</p>
          <p className="text-2xl font-bold">{sanctions.length}</p>
        </div>
        <div className="stat bg-white rounded-lg border p-4">
          <p className="text-sm text-gray-500">Approved</p>
          <p className="text-2xl font-bold text-green-600">{approved}</p>
        </div>
        <div className="stat bg-white rounded-lg border p-4">
          <p className="text-sm text-gray-500">Pending</p>
          <p className="text-2xl font-bold text-yellow-600">{pending}</p>
        </div>
        <div className="stat bg-white rounded-lg border p-4">
          <p className="text-sm text-gray-500">Total Amount</p>
          <p className="text-2xl font-bold text-blue-600">₹{(totalAmount / 100).toLocaleString("en-IN")}</p>
        </div>
      </div>

      <div className="bg-white rounded-lg border overflow-x-auto">
        <table className="tbl w-full text-sm">
          <thead className="bg-gray-50 text-gray-600 text-xs uppercase">
            <tr>
              <th className="px-4 py-3 text-left">Sanction No</th>
              <th className="px-4 py-3 text-left">Subject</th>
              <th className="px-4 py-3 text-left">Major Head</th>
              <th className="px-4 py-3 text-right">Amount (₹)</th>
              <th className="px-4 py-3 text-left">Sanctioned By</th>
              <th className="px-4 py-3 text-left">Date</th>
              <th className="px-4 py-3 text-left">Status</th>
              <th className="px-4 py-3 text-left">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {sanctions.length === 0 ? (
              <tr>
                <td colSpan={8} className="px-4 py-8 text-center text-gray-400">No sanctions found</td>
              </tr>
            ) : (
              sanctions.map((s) => (
                <tr key={s.id} className="hover:bg-gray-50">
                  <td className="px-4 py-3 font-mono text-xs">{s.sanctionNo}</td>
                  <td className="px-4 py-3">{s.subject}</td>
                  <td className="px-4 py-3 text-gray-600">{s.majorHead}</td>
                  <td className="px-4 py-3 text-right">₹{(s.amount / 100).toLocaleString("en-IN")}</td>
                  <td className="px-4 py-3">{s.sanctionedBy}</td>
                  <td className="px-4 py-3 text-gray-600">{s.date}</td>
                  <td className="px-4 py-3">
                    <span className={`rounded-full px-2 py-1 text-xs font-medium ${statusColors[s.status] ?? "bg-gray-50 text-gray-700"}`}>
                      {s.status}
                    </span>
                  </td>
                  <td className="px-4 py-3">
                    <Link href={`/finance/budget/sanctions/${s.id}`} className="text-blue-600 hover:underline text-xs">View</Link>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </PageShell>
  );
}
```

### 5.4 `/finance/budget/sanctions/[id]/page.tsx`

Create `apps/web/src/app/(app)/finance/budget/sanctions/[id]/page.tsx`:

```tsx
import Link from "next/link";
import { PageShell, DataSourceBadge } from "@civitasone/ui-kit";
import { getFinanceSanctionById } from "../../../../../_data/loaders";

const statusColors: Record<string, string> = {
  approved: "bg-green-50 text-green-700",
  pending: "bg-yellow-50 text-yellow-700",
  rejected: "bg-red-50 text-red-700",
};

export default async function SanctionDetailPage({ params }: { params: { id: string } }) {
  const { data: sanction, source } = await getFinanceSanctionById(params.id);

  return (
    <PageShell>
      <div className="mb-6">
        <nav className="text-sm text-gray-500 mb-1">
          <Link href="/finance" className="hover:underline">Finance</Link>
          {" / "}
          <Link href="/finance/budget/sanctions" className="hover:underline">Sanctions</Link>
          {" / "}{sanction?.sanctionNo ?? params.id}
        </nav>
        <h1 className="text-2xl font-semibold text-gray-900">Sanction Detail</h1>
      </div>

      {source === "error" ? <DataSourceBadge source={source} /> : null}

      {sanction ? (
        <div className="space-y-6">
          <div className="bg-white rounded-lg border p-6">
            <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
              <div>
                <p className="text-xs text-gray-500">Sanction No</p>
                <p className="font-mono font-medium">{sanction.sanctionNo}</p>
              </div>
              <div>
                <p className="text-xs text-gray-500">Status</p>
                <span className={`rounded-full px-2 py-1 text-xs font-medium ${statusColors[sanction.status] ?? "bg-gray-50 text-gray-700"}`}>
                  {sanction.status}
                </span>
              </div>
              <div>
                <p className="text-xs text-gray-500">Amount</p>
                <p className="font-semibold">₹{(sanction.amount / 100).toLocaleString("en-IN")}</p>
              </div>
              <div>
                <p className="text-xs text-gray-500">Major Head</p>
                <p>{sanction.majorHead}</p>
              </div>
              <div>
                <p className="text-xs text-gray-500">Sanctioned By</p>
                <p>{sanction.sanctionedBy}</p>
              </div>
              <div>
                <p className="text-xs text-gray-500">Date</p>
                <p>{sanction.date}</p>
              </div>
            </div>
            {sanction.remarks && (
              <div className="mt-4 pt-4 border-t">
                <p className="text-xs text-gray-500 mb-1">Remarks</p>
                <p className="text-sm">{sanction.remarks}</p>
              </div>
            )}
          </div>

          {sanction.lineItems.length > 0 && (
            <div className="bg-white rounded-lg border overflow-x-auto">
              <div className="px-4 py-3 border-b font-medium text-sm">Line Items</div>
              <table className="tbl w-full text-sm">
                <thead className="bg-gray-50 text-gray-600 text-xs uppercase">
                  <tr>
                    <th className="px-4 py-3 text-left">Description</th>
                    <th className="px-4 py-3 text-left">Head</th>
                    <th className="px-4 py-3 text-right">Amount (₹)</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {sanction.lineItems.map((item, i) => (
                    <tr key={i}>
                      <td className="px-4 py-3">{item.description}</td>
                      <td className="px-4 py-3 text-gray-600">{item.head}</td>
                      <td className="px-4 py-3 text-right">₹{(item.amount / 100).toLocaleString("en-IN")}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {sanction.approvalTrail.length > 0 && (
            <div className="bg-white rounded-lg border p-4">
              <div className="font-medium text-sm mb-3">Approval Trail</div>
              <div className="space-y-3">
                {sanction.approvalTrail.map((step, i) => (
                  <div key={i} className="flex gap-3 items-start">
                    <div className="w-2 h-2 rounded-full bg-blue-400 mt-1.5 flex-shrink-0" />
                    <div>
                      <p className="text-sm font-medium">{step.actor} — <span className="font-normal text-gray-600">{step.action}</span></p>
                      <p className="text-xs text-gray-400">{step.timestamp}</p>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      ) : (
        <div className="text-center py-12 text-gray-400">Sanction not found</div>
      )}
    </PageShell>
  );
}
```

### 5.5 `/finance/expenditure/bills/page.tsx`

Create `apps/web/src/app/(app)/finance/expenditure/bills/page.tsx`:

```tsx
import Link from "next/link";
import { PageShell, DataSourceBadge } from "@civitasone/ui-kit";
import { getFinanceBills } from "../../../../_data/loaders";

const statusColors: Record<string, string> = {
  pending: "bg-yellow-50 text-yellow-700",
  approved: "bg-green-50 text-green-700",
  paid: "bg-blue-50 text-blue-700",
  rejected: "bg-red-50 text-red-700",
  under_review: "bg-purple-50 text-purple-700",
};

const matchColors: Record<string, string> = {
  matched: "bg-green-50 text-green-700",
  partial: "bg-yellow-50 text-yellow-700",
  unmatched: "bg-red-50 text-red-700",
  na: "bg-gray-50 text-gray-500",
};

export default async function BillsPage() {
  const { data: bills = [], source } = await getFinanceBills();

  const pending = bills.filter((b) => b.status === "pending").length;
  const approved = bills.filter((b) => b.status === "approved").length;
  const paid = bills.filter((b) => b.status === "paid").length;
  const totalAmount = bills.reduce((s, b) => s + b.amount, 0);

  return (
    <PageShell>
      <div className="flex items-center justify-between mb-6">
        <div>
          <nav className="text-sm text-gray-500 mb-1">
            <Link href="/finance" className="hover:underline">Finance</Link>
            {" / "}Expenditure{" / "}Bills
          </nav>
          <h1 className="text-2xl font-semibold text-gray-900">Bill Processing</h1>
        </div>
      </div>

      {source === "error" ? <DataSourceBadge source={source} /> : null}

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
        <div className="stat bg-white rounded-lg border p-4">
          <p className="text-sm text-gray-500">Total Bills</p>
          <p className="text-2xl font-bold">{bills.length}</p>
        </div>
        <div className="stat bg-white rounded-lg border p-4">
          <p className="text-sm text-gray-500">Pending</p>
          <p className="text-2xl font-bold text-yellow-600">{pending}</p>
        </div>
        <div className="stat bg-white rounded-lg border p-4">
          <p className="text-sm text-gray-500">Paid</p>
          <p className="text-2xl font-bold text-blue-600">{paid}</p>
        </div>
        <div className="stat bg-white rounded-lg border p-4">
          <p className="text-sm text-gray-500">Total Value</p>
          <p className="text-2xl font-bold">₹{(totalAmount / 100).toLocaleString("en-IN")}</p>
        </div>
      </div>

      <div className="bg-white rounded-lg border overflow-x-auto">
        <table className="tbl w-full text-sm">
          <thead className="bg-gray-50 text-gray-600 text-xs uppercase">
            <tr>
              <th className="px-4 py-3 text-left">Bill No</th>
              <th className="px-4 py-3 text-left">Vendor</th>
              <th className="px-4 py-3 text-left">PO Ref</th>
              <th className="px-4 py-3 text-right">Amount (₹)</th>
              <th className="px-4 py-3 text-left">Submitted</th>
              <th className="px-4 py-3 text-left">Due</th>
              <th className="px-4 py-3 text-left">3-Way Match</th>
              <th className="px-4 py-3 text-left">Status</th>
              <th className="px-4 py-3 text-left">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {bills.length === 0 ? (
              <tr>
                <td colSpan={9} className="px-4 py-8 text-center text-gray-400">No bills found</td>
              </tr>
            ) : (
              bills.map((b) => (
                <tr key={b.id} className="hover:bg-gray-50">
                  <td className="px-4 py-3 font-mono text-xs">{b.billNo}</td>
                  <td className="px-4 py-3">{b.vendor}</td>
                  <td className="px-4 py-3 text-gray-500">{b.poRef ?? "—"}</td>
                  <td className="px-4 py-3 text-right">₹{(b.amount / 100).toLocaleString("en-IN")}</td>
                  <td className="px-4 py-3 text-gray-600">{b.submittedDate}</td>
                  <td className="px-4 py-3 text-gray-600">{b.dueDate ?? "—"}</td>
                  <td className="px-4 py-3">
                    <span className={`rounded-full px-2 py-1 text-xs ${matchColors[b.threeWayMatch]}`}>
                      {b.threeWayMatch}
                    </span>
                  </td>
                  <td className="px-4 py-3">
                    <span className={`rounded-full px-2 py-1 text-xs font-medium ${statusColors[b.status]}`}>
                      {b.status.replace("_", " ")}
                    </span>
                  </td>
                  <td className="px-4 py-3">
                    <Link href={`/finance/expenditure/bills/${b.id}`} className="text-blue-600 hover:underline text-xs">View</Link>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </PageShell>
  );
}
```

### 5.6 `/finance/expenditure/bills/[id]/page.tsx`

Create `apps/web/src/app/(app)/finance/expenditure/bills/[id]/page.tsx`:

```tsx
import Link from "next/link";
import { PageShell, DataSourceBadge } from "@civitasone/ui-kit";
import { getFinanceBillById } from "../../../../../_data/loaders";

const statusColors: Record<string, string> = {
  pending: "bg-yellow-50 text-yellow-700",
  approved: "bg-green-50 text-green-700",
  paid: "bg-blue-50 text-blue-700",
  rejected: "bg-red-50 text-red-700",
  under_review: "bg-purple-50 text-purple-700",
};

export default async function BillDetailPage({ params }: { params: { id: string } }) {
  const { data: bill, source } = await getFinanceBillById(params.id);

  return (
    <PageShell>
      <div className="mb-6">
        <nav className="text-sm text-gray-500 mb-1">
          <Link href="/finance" className="hover:underline">Finance</Link>
          {" / "}
          <Link href="/finance/expenditure/bills" className="hover:underline">Bills</Link>
          {" / "}{bill?.billNo ?? params.id}
        </nav>
        <h1 className="text-2xl font-semibold text-gray-900">Bill Detail</h1>
      </div>

      {source === "error" ? <DataSourceBadge source={source} /> : null}

      {bill ? (
        <div className="space-y-6">
          <div className="bg-white rounded-lg border p-6">
            <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
              <div><p className="text-xs text-gray-500">Bill No</p><p className="font-mono">{bill.billNo}</p></div>
              <div><p className="text-xs text-gray-500">Vendor</p><p>{bill.vendor}</p></div>
              <div>
                <p className="text-xs text-gray-500">Status</p>
                <span className={`rounded-full px-2 py-1 text-xs font-medium ${statusColors[bill.status]}`}>{bill.status.replace("_", " ")}</span>
              </div>
              <div><p className="text-xs text-gray-500">Amount</p><p className="font-semibold">₹{(bill.amount / 100).toLocaleString("en-IN")}</p></div>
              <div><p className="text-xs text-gray-500">PO Reference</p><p>{bill.poRef ?? "—"}</p></div>
              <div><p className="text-xs text-gray-500">GRN Reference</p><p>{bill.grnRef ?? "—"}</p></div>
              <div><p className="text-xs text-gray-500">Invoice No</p><p>{bill.invoiceNo ?? "—"}</p></div>
              <div><p className="text-xs text-gray-500">Submitted</p><p>{bill.submittedDate}</p></div>
              <div><p className="text-xs text-gray-500">3-Way Match</p><p>{bill.threeWayMatch}</p></div>
            </div>
          </div>

          {bill.lineItems.length > 0 && (
            <div className="bg-white rounded-lg border overflow-x-auto">
              <div className="px-4 py-3 border-b font-medium text-sm">Line Items</div>
              <table className="tbl w-full text-sm">
                <thead className="bg-gray-50 text-gray-600 text-xs uppercase">
                  <tr>
                    <th className="px-4 py-3 text-left">Description</th>
                    <th className="px-4 py-3 text-right">Qty</th>
                    <th className="px-4 py-3 text-right">Unit Price (₹)</th>
                    <th className="px-4 py-3 text-right">Amount (₹)</th>
                    <th className="px-4 py-3 text-left">Tax Code</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {bill.lineItems.map((item, i) => (
                    <tr key={i}>
                      <td className="px-4 py-3">{item.description}</td>
                      <td className="px-4 py-3 text-right">{item.quantity}</td>
                      <td className="px-4 py-3 text-right">₹{(item.unitPrice / 100).toLocaleString("en-IN")}</td>
                      <td className="px-4 py-3 text-right">₹{(item.amount / 100).toLocaleString("en-IN")}</td>
                      <td className="px-4 py-3 text-gray-500">{item.taxCode ?? "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      ) : (
        <div className="text-center py-12 text-gray-400">Bill not found</div>
      )}
    </PageShell>
  );
}
```

### 5.7 `/finance/expenditure/advances/page.tsx`

Create `apps/web/src/app/(app)/finance/expenditure/advances/page.tsx`:

```tsx
import Link from "next/link";
import { PageShell, DataSourceBadge } from "@civitasone/ui-kit";
import { getFinanceAdvances } from "../../../../_data/loaders";

const statusColors: Record<string, string> = {
  active: "bg-blue-50 text-blue-700",
  adjusted: "bg-green-50 text-green-700",
  overdue: "bg-red-50 text-red-700",
  closed: "bg-gray-50 text-gray-600",
};

export default async function AdvancesPage() {
  const { data: advances = [], source } = await getFinanceAdvances();

  const active = advances.filter((a) => a.status === "active").length;
  const overdue = advances.filter((a) => a.status === "overdue").length;
  const totalBalance = advances.reduce((s, a) => s + a.balance, 0);
  const totalDisbursed = advances.reduce((s, a) => s + a.amount, 0);

  return (
    <PageShell>
      <div className="flex items-center justify-between mb-6">
        <div>
          <nav className="text-sm text-gray-500 mb-1">
            <Link href="/finance" className="hover:underline">Finance</Link>
            {" / "}Expenditure{" / "}Advances
          </nav>
          <h1 className="text-2xl font-semibold text-gray-900">Advances</h1>
        </div>
      </div>

      {source === "error" ? <DataSourceBadge source={source} /> : null}

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
        <div className="stat bg-white rounded-lg border p-4">
          <p className="text-sm text-gray-500">Total Advances</p>
          <p className="text-2xl font-bold">{advances.length}</p>
        </div>
        <div className="stat bg-white rounded-lg border p-4">
          <p className="text-sm text-gray-500">Active</p>
          <p className="text-2xl font-bold text-blue-600">{active}</p>
        </div>
        <div className="stat bg-white rounded-lg border p-4">
          <p className="text-sm text-gray-500">Overdue</p>
          <p className="text-2xl font-bold text-red-600">{overdue}</p>
        </div>
        <div className="stat bg-white rounded-lg border p-4">
          <p className="text-sm text-gray-500">Outstanding Balance</p>
          <p className="text-2xl font-bold">₹{(totalBalance / 100).toLocaleString("en-IN")}</p>
        </div>
      </div>

      <div className="bg-white rounded-lg border overflow-x-auto">
        <table className="tbl w-full text-sm">
          <thead className="bg-gray-50 text-gray-600 text-xs uppercase">
            <tr>
              <th className="px-4 py-3 text-left">Advance No</th>
              <th className="px-4 py-3 text-left">Beneficiary</th>
              <th className="px-4 py-3 text-left">Type</th>
              <th className="px-4 py-3 text-right">Amount (₹)</th>
              <th className="px-4 py-3 text-right">Adjusted (₹)</th>
              <th className="px-4 py-3 text-right">Balance (₹)</th>
              <th className="px-4 py-3 text-left">Disbursed</th>
              <th className="px-4 py-3 text-left">Due</th>
              <th className="px-4 py-3 text-left">Status</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {advances.length === 0 ? (
              <tr>
                <td colSpan={9} className="px-4 py-8 text-center text-gray-400">No advances found</td>
              </tr>
            ) : (
              advances.map((a) => (
                <tr key={a.id} className="hover:bg-gray-50">
                  <td className="px-4 py-3 font-mono text-xs">{a.advanceNo}</td>
                  <td className="px-4 py-3">{a.beneficiary}</td>
                  <td className="px-4 py-3 capitalize text-gray-600">{a.type}</td>
                  <td className="px-4 py-3 text-right">₹{(a.amount / 100).toLocaleString("en-IN")}</td>
                  <td className="px-4 py-3 text-right">₹{(a.adjustedAmount / 100).toLocaleString("en-IN")}</td>
                  <td className="px-4 py-3 text-right font-medium">₹{(a.balance / 100).toLocaleString("en-IN")}</td>
                  <td className="px-4 py-3 text-gray-600">{a.disbursedDate}</td>
                  <td className="px-4 py-3 text-gray-600">{a.dueDate ?? "—"}</td>
                  <td className="px-4 py-3">
                    <span className={`rounded-full px-2 py-1 text-xs font-medium ${statusColors[a.status]}`}>{a.status}</span>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </PageShell>
  );
}
```

### 5.8 `/finance/expenditure/utilization-certificates/page.tsx`

Create `apps/web/src/app/(app)/finance/expenditure/utilization-certificates/page.tsx`:

```tsx
import Link from "next/link";
import { PageShell, DataSourceBadge } from "@civitasone/ui-kit";
import { getFinanceUCs } from "../../../../_data/loaders";

const statusColors: Record<string, string> = {
  pending: "bg-yellow-50 text-yellow-700",
  submitted: "bg-blue-50 text-blue-700",
  verified: "bg-green-50 text-green-700",
  rejected: "bg-red-50 text-red-700",
};

export default async function UCsPage() {
  const { data: ucs = [], source } = await getFinanceUCs();

  const pending = ucs.filter((u) => u.status === "pending").length;
  const submitted = ucs.filter((u) => u.status === "submitted").length;
  const verified = ucs.filter((u) => u.status === "verified").length;
  const totalAmount = ucs.reduce((s, u) => s + u.amount, 0);

  return (
    <PageShell>
      <div className="flex items-center justify-between mb-6">
        <div>
          <nav className="text-sm text-gray-500 mb-1">
            <Link href="/finance" className="hover:underline">Finance</Link>
            {" / "}Expenditure{" / "}Utilization Certificates
          </nav>
          <h1 className="text-2xl font-semibold text-gray-900">Utilization Certificates</h1>
        </div>
      </div>

      {source === "error" ? <DataSourceBadge source={source} /> : null}

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
        <div className="stat bg-white rounded-lg border p-4">
          <p className="text-sm text-gray-500">Total UCs</p>
          <p className="text-2xl font-bold">{ucs.length}</p>
        </div>
        <div className="stat bg-white rounded-lg border p-4">
          <p className="text-sm text-gray-500">Pending</p>
          <p className="text-2xl font-bold text-yellow-600">{pending}</p>
        </div>
        <div className="stat bg-white rounded-lg border p-4">
          <p className="text-sm text-gray-500">Verified</p>
          <p className="text-2xl font-bold text-green-600">{verified}</p>
        </div>
        <div className="stat bg-white rounded-lg border p-4">
          <p className="text-sm text-gray-500">Total Amount</p>
          <p className="text-2xl font-bold">₹{(totalAmount / 100).toLocaleString("en-IN")}</p>
        </div>
      </div>

      <div className="bg-white rounded-lg border overflow-x-auto">
        <table className="tbl w-full text-sm">
          <thead className="bg-gray-50 text-gray-600 text-xs uppercase">
            <tr>
              <th className="px-4 py-3 text-left">UC No</th>
              <th className="px-4 py-3 text-left">Grantee</th>
              <th className="px-4 py-3 text-left">Grant Ref</th>
              <th className="px-4 py-3 text-right">Amount (₹)</th>
              <th className="px-4 py-3 text-left">Period</th>
              <th className="px-4 py-3 text-left">Submitted</th>
              <th className="px-4 py-3 text-left">Status</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {ucs.length === 0 ? (
              <tr>
                <td colSpan={7} className="px-4 py-8 text-center text-gray-400">No utilization certificates found</td>
              </tr>
            ) : (
              ucs.map((u) => (
                <tr key={u.id} className="hover:bg-gray-50">
                  <td className="px-4 py-3 font-mono text-xs">{u.ucNo}</td>
                  <td className="px-4 py-3">{u.grantee}</td>
                  <td className="px-4 py-3 text-gray-500">{u.grantRef ?? "—"}</td>
                  <td className="px-4 py-3 text-right">₹{(u.amount / 100).toLocaleString("en-IN")}</td>
                  <td className="px-4 py-3 text-gray-600">{u.periodFrom} – {u.periodTo}</td>
                  <td className="px-4 py-3 text-gray-600">{u.submittedDate ?? "—"}</td>
                  <td className="px-4 py-3">
                    <span className={`rounded-full px-2 py-1 text-xs font-medium ${statusColors[u.status]}`}>{u.status}</span>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </PageShell>
  );
}
```

### 5.9 `/finance/accounting/general-ledger/page.tsx`

Create `apps/web/src/app/(app)/finance/accounting/general-ledger/page.tsx`:

```tsx
import Link from "next/link";
import { PageShell, DataSourceBadge } from "@civitasone/ui-kit";
import { getFinanceGLEntries } from "../../../../_data/loaders";

export default async function GeneralLedgerPage() {
  const { data: entries = [], source } = await getFinanceGLEntries();

  const totalDebit = entries.reduce((s, e) => s + e.debit, 0);
  const totalCredit = entries.reduce((s, e) => s + e.credit, 0);

  return (
    <PageShell>
      <div className="flex items-center justify-between mb-6">
        <div>
          <nav className="text-sm text-gray-500 mb-1">
            <Link href="/finance" className="hover:underline">Finance</Link>
            {" / "}Accounting{" / "}General Ledger
          </nav>
          <h1 className="text-2xl font-semibold text-gray-900">General Ledger</h1>
        </div>
        <Link href="/finance/accounting/vouchers/new" className="px-4 py-2 rounded bg-blue-600 text-white text-sm hover:bg-blue-700">
          + New Voucher
        </Link>
      </div>

      {source === "error" ? <DataSourceBadge source={source} /> : null}

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
        <div className="stat bg-white rounded-lg border p-4">
          <p className="text-sm text-gray-500">Total Entries</p>
          <p className="text-2xl font-bold">{entries.length}</p>
        </div>
        <div className="stat bg-white rounded-lg border p-4">
          <p className="text-sm text-gray-500">Total Debit</p>
          <p className="text-2xl font-bold text-red-600">₹{(totalDebit / 100).toLocaleString("en-IN")}</p>
        </div>
        <div className="stat bg-white rounded-lg border p-4">
          <p className="text-sm text-gray-500">Total Credit</p>
          <p className="text-2xl font-bold text-green-600">₹{(totalCredit / 100).toLocaleString("en-IN")}</p>
        </div>
        <div className="stat bg-white rounded-lg border p-4">
          <p className="text-sm text-gray-500">Balance</p>
          <p className={`text-2xl font-bold ${totalDebit === totalCredit ? "text-green-600" : "text-red-600"}`}>
            {totalDebit === totalCredit ? "Balanced" : "Unbalanced"}
          </p>
        </div>
      </div>

      <div className="bg-white rounded-lg border overflow-x-auto">
        <table className="tbl w-full text-sm">
          <thead className="bg-gray-50 text-gray-600 text-xs uppercase">
            <tr>
              <th className="px-4 py-3 text-left">Voucher No</th>
              <th className="px-4 py-3 text-left">Date</th>
              <th className="px-4 py-3 text-left">Account Code</th>
              <th className="px-4 py-3 text-left">Account Name</th>
              <th className="px-4 py-3 text-right">Debit (₹)</th>
              <th className="px-4 py-3 text-right">Credit (₹)</th>
              <th className="px-4 py-3 text-left">Narration</th>
              <th className="px-4 py-3 text-left">Reference</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {entries.length === 0 ? (
              <tr>
                <td colSpan={8} className="px-4 py-8 text-center text-gray-400">No GL entries found</td>
              </tr>
            ) : (
              entries.map((e) => (
                <tr key={e.id} className="hover:bg-gray-50">
                  <td className="px-4 py-3 font-mono text-xs">{e.voucherNo}</td>
                  <td className="px-4 py-3 text-gray-600">{e.date}</td>
                  <td className="px-4 py-3 font-mono text-xs">{e.accountCode}</td>
                  <td className="px-4 py-3">{e.accountName}</td>
                  <td className="px-4 py-3 text-right text-red-700">{e.debit > 0 ? `₹${(e.debit / 100).toLocaleString("en-IN")}` : "—"}</td>
                  <td className="px-4 py-3 text-right text-green-700">{e.credit > 0 ? `₹${(e.credit / 100).toLocaleString("en-IN")}` : "—"}</td>
                  <td className="px-4 py-3 text-gray-500 max-w-xs truncate">{e.narration ?? "—"}</td>
                  <td className="px-4 py-3 text-gray-500">{e.referenceNo ?? "—"}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </PageShell>
  );
}
```

### 5.10 `/finance/accounting/vouchers/new/page.tsx` — CLIENT COMPONENT

Create `apps/web/src/app/(app)/finance/accounting/vouchers/new/page.tsx`:

```tsx
"use client";

import { useState } from "react";
import Link from "next/link";

type LineItem = {
  accountCode: string;
  accountName: string;
  debit: string;
  credit: string;
};

export default function NewVoucherPage() {
  const [lines, setLines] = useState<LineItem[]>([
    { accountCode: "", accountName: "", debit: "", credit: "" },
    { accountCode: "", accountName: "", debit: "", credit: "" },
  ]);
  const [narration, setNarration] = useState("");
  const [date, setDate] = useState(new Date().toISOString().split("T")[0]);
  const [submitting, setSubmitting] = useState(false);
  const [toast, setToast] = useState<{ type: "success" | "error"; message: string } | null>(null);
  const [errors, setErrors] = useState<string[]>([]);

  const updateLine = (idx: number, field: keyof LineItem, value: string) => {
    setLines((prev) => prev.map((l, i) => (i === idx ? { ...l, [field]: value } : l)));
  };

  const addLine = () => setLines((prev) => [...prev, { accountCode: "", accountName: "", debit: "", credit: "" }]);
  const removeLine = (idx: number) => setLines((prev) => prev.filter((_, i) => i !== idx));

  const toPaise = (val: string) => Math.round(parseFloat(val || "0") * 100);

  const validate = () => {
    const errs: string[] = [];
    if (!date) errs.push("Date is required");
    if (!narration.trim()) errs.push("Narration is required");
    const validLines = lines.filter((l) => l.accountCode);
    if (validLines.length < 2) errs.push("At least 2 line items required");
    const totalDebit = validLines.reduce((s, l) => s + toPaise(l.debit), 0);
    const totalCredit = validLines.reduce((s, l) => s + toPaise(l.credit), 0);
    if (totalDebit !== totalCredit) errs.push(`Debit (₹${(totalDebit/100).toFixed(2)}) ≠ Credit (₹${(totalCredit/100).toFixed(2)})`);
    return errs;
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const errs = validate();
    if (errs.length > 0) { setErrors(errs); return; }
    setErrors([]);
    setSubmitting(true);

    try {
      const payload = {
        date,
        narration,
        lineItems: lines
          .filter((l) => l.accountCode)
          .map((l) => ({
            accountCode: l.accountCode,
            debitPaise: toPaise(l.debit),
            creditPaise: toPaise(l.credit),
          })),
      };

      const res = await fetch("/api/proxy/v1/finance/journals", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      if (res.status === 202 || res.ok) {
        setToast({ type: "success", message: "Voucher submitted successfully (202 Accepted)" });
        setLines([
          { accountCode: "", accountName: "", debit: "", credit: "" },
          { accountCode: "", accountName: "", debit: "", credit: "" },
        ]);
        setNarration("");
      } else {
        const body = await res.json().catch(() => ({}));
        setToast({ type: "error", message: body.message ?? `Error ${res.status}` });
      }
    } catch (err) {
      setToast({ type: "error", message: "Network error. Please try again." });
    } finally {
      setSubmitting(false);
      setTimeout(() => setToast(null), 5000);
    }
  };

  const totalDebit = lines.reduce((s, l) => s + toPaise(l.debit), 0);
  const totalCredit = lines.reduce((s, l) => s + toPaise(l.credit), 0);

  return (
    <div className="max-w-4xl mx-auto px-4 py-6">
      <div className="mb-6">
        <nav className="text-sm text-gray-500 mb-1">
          <Link href="/finance" className="hover:underline">Finance</Link>
          {" / "}
          <Link href="/finance/accounting/general-ledger" className="hover:underline">General Ledger</Link>
          {" / "}New Voucher
        </nav>
        <h1 className="text-2xl font-semibold text-gray-900">New Journal Voucher</h1>
      </div>

      {toast && (
        <div className={`mb-4 rounded-lg px-4 py-3 text-sm font-medium ${toast.type === "success" ? "bg-green-50 text-green-800 border border-green-200" : "bg-red-50 text-red-800 border border-red-200"}`}>
          {toast.message}
        </div>
      )}

      {errors.length > 0 && (
        <div className="mb-4 rounded-lg px-4 py-3 bg-red-50 border border-red-200">
          <ul className="text-sm text-red-700 space-y-1">
            {errors.map((e, i) => <li key={i}>• {e}</li>)}
          </ul>
        </div>
      )}

      <form onSubmit={handleSubmit} className="space-y-6">
        <div className="bg-white rounded-lg border p-6">
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Date</label>
              <input
                type="date"
                value={date}
                onChange={(e) => setDate(e.target.value)}
                className="w-full border rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                required
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Narration</label>
              <input
                type="text"
                value={narration}
                onChange={(e) => setNarration(e.target.value)}
                placeholder="Brief description of transaction"
                className="w-full border rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                required
              />
            </div>
          </div>
        </div>

        <div className="bg-white rounded-lg border overflow-x-auto">
          <div className="px-4 py-3 border-b flex items-center justify-between">
            <span className="font-medium text-sm">Line Items</span>
            <button type="button" onClick={addLine} className="text-blue-600 text-sm hover:underline">+ Add Row</button>
          </div>
          <table className="w-full text-sm">
            <thead className="bg-gray-50 text-gray-600 text-xs uppercase">
              <tr>
                <th className="px-3 py-2 text-left">Account Code</th>
                <th className="px-3 py-2 text-left">Account Name</th>
                <th className="px-3 py-2 text-right">Debit (₹)</th>
                <th className="px-3 py-2 text-right">Credit (₹)</th>
                <th className="px-3 py-2 text-center">Remove</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {lines.map((line, idx) => (
                <tr key={idx}>
                  <td className="px-3 py-2">
                    <input
                      type="text"
                      value={line.accountCode}
                      onChange={(e) => updateLine(idx, "accountCode", e.target.value)}
                      placeholder="e.g. 4001"
                      className="w-full border rounded px-2 py-1 text-xs focus:outline-none focus:ring-1 focus:ring-blue-400"
                    />
                  </td>
                  <td className="px-3 py-2">
                    <input
                      type="text"
                      value={line.accountName}
                      onChange={(e) => updateLine(idx, "accountName", e.target.value)}
                      placeholder="Account name"
                      className="w-full border rounded px-2 py-1 text-xs focus:outline-none focus:ring-1 focus:ring-blue-400"
                    />
                  </td>
                  <td className="px-3 py-2">
                    <input
                      type="number"
                      value={line.debit}
                      onChange={(e) => updateLine(idx, "debit", e.target.value)}
                      placeholder="0.00"
                      min="0"
                      step="0.01"
                      className="w-full border rounded px-2 py-1 text-xs text-right focus:outline-none focus:ring-1 focus:ring-blue-400"
                    />
                  </td>
                  <td className="px-3 py-2">
                    <input
                      type="number"
                      value={line.credit}
                      onChange={(e) => updateLine(idx, "credit", e.target.value)}
                      placeholder="0.00"
                      min="0"
                      step="0.01"
                      className="w-full border rounded px-2 py-1 text-xs text-right focus:outline-none focus:ring-1 focus:ring-blue-400"
                    />
                  </td>
                  <td className="px-3 py-2 text-center">
                    {lines.length > 2 && (
                      <button
                        type="button"
                        onClick={() => removeLine(idx)}
                        className="text-red-500 hover:text-red-700 text-xs"
                      >
                        ✕
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
            <tfoot className="bg-gray-50 border-t font-medium text-sm">
              <tr>
                <td colSpan={2} className="px-3 py-2 text-right text-gray-600">Totals:</td>
                <td className={`px-3 py-2 text-right ${totalDebit === totalCredit ? "text-green-700" : "text-red-700"}`}>
                  ₹{(totalDebit / 100).toLocaleString("en-IN", { minimumFractionDigits: 2 })}
                </td>
                <td className={`px-3 py-2 text-right ${totalDebit === totalCredit ? "text-green-700" : "text-red-700"}`}>
                  ₹{(totalCredit / 100).toLocaleString("en-IN", { minimumFractionDigits: 2 })}
                </td>
                <td />
              </tr>
            </tfoot>
          </table>
        </div>

        <div className="flex gap-3">
          <button
            type="submit"
            disabled={submitting}
            className="px-6 py-2 bg-blue-600 text-white rounded-md text-sm font-medium hover:bg-blue-700 disabled:opacity-50"
          >
            {submitting ? "Submitting…" : "Submit Voucher"}
          </button>
          <Link href="/finance/accounting/general-ledger" className="px-6 py-2 border rounded-md text-sm text-gray-600 hover:bg-gray-50">
            Cancel
          </Link>
        </div>
      </form>
    </div>
  );
}
```

### 5.11 `/finance/accounting/financial-statements/page.tsx`

Create `apps/web/src/app/(app)/finance/accounting/financial-statements/page.tsx`:

```tsx
import Link from "next/link";
import { PageShell, DataSourceBadge } from "@civitasone/ui-kit";
import { getFinancialStatements } from "../../../../_data/loaders";

const typeColors: Record<string, string> = {
  asset: "bg-blue-50 text-blue-700",
  liability: "bg-purple-50 text-purple-700",
  income: "bg-green-50 text-green-700",
  expenditure: "bg-red-50 text-red-700",
};

export default async function FinancialStatementsPage() {
  const { data: statements = [], source } = await getFinancialStatements();

  const totalReceipts = statements.filter((s) => s.type === "income").reduce((sum, s) => sum + s.receipts, 0);
  const totalPayments = statements.filter((s) => s.type === "expenditure").reduce((sum, s) => sum + s.payments, 0);
  const totalAssets = statements.filter((s) => s.type === "asset").reduce((sum, s) => sum + s.closingBalance, 0);
  const totalLiabilities = statements.filter((s) => s.type === "liability").reduce((sum, s) => sum + s.closingBalance, 0);

  return (
    <PageShell>
      <div className="flex items-center justify-between mb-6">
        <div>
          <nav className="text-sm text-gray-500 mb-1">
            <Link href="/finance" className="hover:underline">Finance</Link>
            {" / "}Accounting{" / "}Financial Statements
          </nav>
          <h1 className="text-2xl font-semibold text-gray-900">Financial Statements</h1>
        </div>
      </div>

      {source === "error" ? <DataSourceBadge source={source} /> : null}

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
        <div className="stat bg-white rounded-lg border p-4">
          <p className="text-sm text-gray-500">Total Receipts</p>
          <p className="text-2xl font-bold text-green-600">₹{(totalReceipts / 100).toLocaleString("en-IN")}</p>
        </div>
        <div className="stat bg-white rounded-lg border p-4">
          <p className="text-sm text-gray-500">Total Payments</p>
          <p className="text-2xl font-bold text-red-600">₹{(totalPayments / 100).toLocaleString("en-IN")}</p>
        </div>
        <div className="stat bg-white rounded-lg border p-4">
          <p className="text-sm text-gray-500">Total Assets</p>
          <p className="text-2xl font-bold text-blue-600">₹{(totalAssets / 100).toLocaleString("en-IN")}</p>
        </div>
        <div className="stat bg-white rounded-lg border p-4">
          <p className="text-sm text-gray-500">Total Liabilities</p>
          <p className="text-2xl font-bold text-purple-600">₹{(totalLiabilities / 100).toLocaleString("en-IN")}</p>
        </div>
      </div>

      <div className="bg-white rounded-lg border overflow-x-auto">
        <table className="tbl w-full text-sm">
          <thead className="bg-gray-50 text-gray-600 text-xs uppercase">
            <tr>
              <th className="px-4 py-3 text-left">Head</th>
              <th className="px-4 py-3 text-left">Type</th>
              <th className="px-4 py-3 text-right">Opening Balance (₹)</th>
              <th className="px-4 py-3 text-right">Receipts (₹)</th>
              <th className="px-4 py-3 text-right">Payments (₹)</th>
              <th className="px-4 py-3 text-right">Closing Balance (₹)</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {statements.length === 0 ? (
              <tr>
                <td colSpan={6} className="px-4 py-8 text-center text-gray-400">No financial statement data found</td>
              </tr>
            ) : (
              statements.map((s) => (
                <tr key={s.id} className="hover:bg-gray-50">
                  <td className="px-4 py-3 font-medium">{s.head}</td>
                  <td className="px-4 py-3">
                    <span className={`rounded-full px-2 py-1 text-xs capitalize ${typeColors[s.type]}`}>{s.type}</span>
                  </td>
                  <td className="px-4 py-3 text-right">₹{(s.openingBalance / 100).toLocaleString("en-IN")}</td>
                  <td className="px-4 py-3 text-right text-green-700">₹{(s.receipts / 100).toLocaleString("en-IN")}</td>
                  <td className="px-4 py-3 text-right text-red-700">₹{(s.payments / 100).toLocaleString("en-IN")}</td>
                  <td className="px-4 py-3 text-right font-semibold">₹{(s.closingBalance / 100).toLocaleString("en-IN")}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </PageShell>
  );
}
```

### 5.12 Update `/finance/page.tsx`

Read the existing `apps/web/src/app/(app)/finance/page.tsx` and update it to include all sub-module nav tiles with proper links to the new pages. The hub page must show tiles for all sub-modules. Keep the existing structure/styling but add any missing tiles. The full list should include:
- Dashboard (`/finance/dashboard`)
- Chart of Accounts (`/finance/chart-of-accounts`)
- Budget Formulation (`/finance/budget/formulation`)
- Sanctions (`/finance/budget/sanctions`)
- Bill Processing (`/finance/expenditure/bills`)
- Advances (`/finance/expenditure/advances`)
- Utilization Certificates (`/finance/expenditure/utilization-certificates`)
- General Ledger (`/finance/accounting/general-ledger`)
- New Voucher (`/finance/accounting/vouchers/new`)
- Financial Statements (`/finance/accounting/financial-statements`)
- Payments (`/finance/payments`)

## Step 6 — Verification

Run:
```bash
cd ~/CivitasOne/civitasone-suite
pnpm --filter @civitasone/schemas typecheck
pnpm --filter @civitasone/web typecheck
```

Fix any TypeScript errors before finishing. Common issues to watch for:
- Import paths (use relative imports, e.g., `"../../../../_data/loaders"`)
- Schema import names in loaders.ts
- Missing type exports
- `params` type in dynamic routes must be `{ params: { id: string } }`
