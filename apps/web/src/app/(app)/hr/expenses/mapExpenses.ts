import { humanizeStatus } from "@/lib/formatters";

export type ApiExpense = {
  id: string;
  category: string;
  amount: number;
  description: string;
  date: string;
  receiptKey?: string;
  status: string;
  created_at: string;
  /** GAP-HR-EXPENSES-02: present only on an approvals-scope row (GET ?scope=approvals). */
  employeeName?: string;
};

export type Row = {
  id: string;
  category: string;
  amount: number;
  description: string;
  date: string | null;
  status: string;
  /** GAP-HR-EXPENSES-04: drives the Receipt column's link vs. "No receipt" state. */
  hasReceipt: boolean;
  /** GAP-HR-EXPENSES-02: only set on an approvals-scope row; absent (not just empty) on "my claims" rows. */
  employee?: string;
} & Record<string, unknown>;

/**
 * GAP-HR-EXPENSES-05: category used to render as a raw lowercase enum
 * ("travel") and date as a raw ISO string -- neither went through this
 * codebase's standard display helpers.
 *
 * `category` is humanized here, at the mapper level: DataTable has no
 * built-in "humanize an arbitrary enum" cellType (only "status" | "amount" |
 * "rupees" | "date" | "datetime" -- see DataTable.tsx), so this is the same
 * approach every other enum-display fix in this campaign uses.
 *
 * `date` is deliberately NOT pre-formatted here, unlike category -- verified
 * against DataTable.tsx's actual sort implementation (`compareValues`),
 * which sorts strictly on each column's own raw row value with no secondary
 * sort key available. Pre-formatting to "15 Apr 2025" here would make a
 * sort-by-date click sort lexicographically by day-of-month instead of
 * chronologically, with no way to route around it via a hidden field (there
 * is no per-column "sort by a different field" option). Keeping the raw ISO
 * value and setting cellType:"date" on the column instead (same convention
 * hr/advances' requestDate column already uses) produces byte-identical
 * display output -- DataTable calls this exact same formatIndianDate() at
 * render time -- without regressing sort. formatIndianDate's own test suite
 * (formatters.test.ts) already covers null/undefined/"" -> "—", which is what
 * DataTable's cellType:"date" renderer relies on for a missing date.
 */
export function mapExpenses(rows: ApiExpense[]): Row[] {
  return rows.map((e) => ({
    id: e.id,
    category: e.category ? humanizeStatus(e.category) : "—",
    amount: e.amount ?? 0,
    description: e.description ?? "—",
    date: e.date ?? e.created_at ?? null,
    status: e.status,
    hasReceipt: Boolean(e.receiptKey),
    ...(e.employeeName ? { employee: e.employeeName } : {}),
  }));
}
