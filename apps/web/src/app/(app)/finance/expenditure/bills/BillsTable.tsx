"use client";

import { useMemo } from "react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { DataTable, StatusPill } from "../../../../_components/ds";
import { DataSourceBadge } from "../../../../_components/DataSourceBadge";
import { formatIndianDate } from "@/lib/formatters";
import { billPoHref, billPoLabel } from "@/lib/finance/billRefs";
import { useSeededResource } from "@/lib/sync/resource";

type Bill = {
  id: string;
  billNo: string;
  vendor: string;
  poRef?: string | null;
  /** The human PO number snapshotted from the GRN the bill was drafted from (GAP-FINANCE-EXPENDITURE-BILLS-06). */
  poNumber?: string | null;
  amount: string;
  submittedDate: string;
  dueDate?: string | null;
  threeWayMatch: string;
  status: string;
};

/** A bill with its PO cell resolved once, so the column, the text filter, the sort and the CSV all see the same text. */
type BillRow = Bill & { poLabel: string; poHref: string | null };

/**
 * The human PO number, linked to the purchase order when the ref names a page; plain text (never a dead link) otherwise,
 * and "—" when the bill has no PO. stopPropagation: the row itself is a link to the bill.
 */
function renderPoRef(b: BillRow) {
  if (!b.poHref) return b.poLabel;
  return <Link href={b.poHref} onClick={(e) => e.stopPropagation()}>{b.poLabel}</Link>;
}

export function BillsTable({ bills, source = "api" }: { bills: Bill[]; source?: "api" | "error" }) {
  const t = useTranslations("expenditureBillsTable");
  const { data: rows, provenance, offline, cachedAt } = useSeededResource<Bill[]>(
    "finance.bills",
    bills,
    source,
    (d) => d.length === 0,
  );
  const tableRows = useMemo<BillRow[]>(
    () => rows.map((b) => ({ ...b, poLabel: billPoLabel(b), poHref: billPoHref(b) })),
    [rows],
  );

  return (
    <>
      {/* UX-012: this badge is the ONLY place that reports data provenance for
          the rows shown below — it reads the same useSeededResource call as
          `rows`, so it can never disagree with what the table shows
          (UX-002's pattern; the page used to render a second, independent
          badge from the raw `source` prop — removed). */}
      <DataSourceBadge provenance={provenance ?? "live"} cachedAt={cachedAt} offline={offline} />
      <DataTable<BillRow>
        columns={[
          { key: "billNo", label: t("colBill"), render: (b) => <span className="mono">{b.billNo}</span> },
          { key: "vendor", label: t("colVendor") },
          {
            key: "poLabel",
            label: t("colPoRef"),
            // The human PO number, linked to the purchase order when the ref names a page; plain text (never a dead
            // link) otherwise, and "—" when the bill has no PO. stopPropagation: the row itself is a link to the bill.
            render: (b) => renderPoRef(b),
          },
          { key: "amount", label: t("colAmount"), align: "right", cellType: "amount" },
          { key: "submittedDate", label: t("colSubmitted"), render: (b) => formatIndianDate(b.submittedDate) },
          { key: "dueDate", label: t("colDue"), render: (b) => (b.dueDate ? formatIndianDate(b.dueDate) : "—") },
          { key: "threeWayMatch", label: t("colThreeWayMatch"), render: (b) => <StatusPill status={b.threeWayMatch} /> },
          { key: "status", label: t("colStatus"), render: (b) => <StatusPill status={b.status} /> },
        ]}
        rows={tableRows}
        rowHref={(b) => `/finance/expenditure/bills/${b.id}`}
        sortable
        filterable
        filterPlaceholder={t("filterPlaceholder")}
        pageSize={15}
        exportable exportAudit="finance/expenditure/bills"
        emptyIcon="🧾"
        emptyTitle={t("emptyTitle")}
        emptyMessage={t("emptyMessage")}
        emptyAction={
          <Link href="/help/finance" className="btn ghost" style={{ marginTop: 10 }}>
            {t("howBillsWork")}
          </Link>
        }
      />
    </>
  );
}
