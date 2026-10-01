"use client";

/**
 * GAP-HR-EXPENSES-02/04: split out of page.tsx (a Server Component) because
 * the Receipt and (approvals-mode) Actions columns below need a `render:`
 * callback -- DataTable explicitly cannot receive a function prop from a
 * Server Component (see its own doc comment; GAP-HR-EXPENSES-01 / PR #1647
 * is the exact crash class this avoids). Mirrors the established
 * AdvancesTable.tsx split used by hr/advances/page.tsx for the same reason.
 *
 * One component serves both "my claims" and "approvals" views (`mode` prop)
 * rather than two near-duplicates: the Employee column and the Actions
 * column only apply to `mode === "approvals"`.
 */
import type { ReactNode } from "react";
import { DataTable } from "../../../_components/ds";
import { ExpenseApprovalActions } from "./ExpenseApprovalActions";
import { ExpenseReceiptLink } from "./ExpenseReceiptLink";
import type { Row } from "./mapExpenses";

type Column = {
  key: keyof Row & string;
  label: string;
  cellType?: "status" | "amount" | "date";
  render?: (row: Row) => ReactNode;
};

export function ExpensesTable({
  rows,
  mode,
  filterPlaceholder,
  emptyIcon,
  emptyTitle,
  emptyMessage,
  labels,
}: {
  rows: Row[];
  mode: "mine" | "approvals";
  filterPlaceholder: string;
  emptyIcon: string;
  emptyTitle: string;
  emptyMessage: string;
  labels: {
    employee: string;
    category: string;
    amount: string;
    description: string;
    date: string;
    status: string;
    receipt: string;
    actions: string;
  };
}) {
  const columns: Column[] = [
    ...(mode === "approvals" ? [{ key: "employee", label: labels.employee } satisfies Column] : []),
    { key: "category", label: labels.category },
    { key: "amount", label: labels.amount, cellType: "amount" },
    { key: "description", label: labels.description },
    { key: "date", label: labels.date, cellType: "date" },
    { key: "status", label: labels.status, cellType: "status" },
    {
      // Synthetic key -- this column is entirely `render`-driven (a fetched,
      // short-lived URL, not a plain row field), same convention as
      // AdvancesTable.tsx reusing "id" for its own render-only column.
      key: "id",
      label: labels.receipt,
      render: (row) => <ExpenseReceiptLink id={row.id} hasReceipt={row.hasReceipt} />,
    },
    ...(mode === "approvals"
      ? [{
          // Distinct synthetic key from the Receipt column above ("id") --
          // two columns sharing one key would collide on React's list key
          // and on DataTable's own sort-state tracking (`sortKey === col.key`).
          key: "hasReceipt",
          label: labels.actions,
          render: (row) => <ExpenseApprovalActions id={row.id} />,
        } satisfies Column]
      : []),
  ];

  return (
    <DataTable<Row>
      columns={columns}
      rows={rows}
      sortable
      filterable
      filterPlaceholder={filterPlaceholder}
      pageSize={15}
      emptyIcon={emptyIcon}
      emptyTitle={emptyTitle}
      emptyMessage={emptyMessage}
    />
  );
}
