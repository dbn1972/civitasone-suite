"use client";

import Link from "next/link";
import { useTranslations } from "next-intl";
import { DataTable, StatusPill } from "../../../../_components/ds";
import { DataSourceBadge } from "../../../../_components/DataSourceBadge";
import { formatIndianDate } from "@/lib/formatters";
import { useSeededResource } from "@/lib/sync/resource";

type Bill = {
  id: string;
  billNo: string;
  vendor: string;
  poRef?: string | null;
  amount: string;
  submittedDate: string;
  dueDate?: string | null;
  threeWayMatch: string;
  status: string;
};

export function BillsTable({ bills, source = "api" }: { bills: Bill[]; source?: "api" | "error" }) {
  const t = useTranslations("expenditureBillsTable");
  const { data: rows, provenance, offline, cachedAt } = useSeededResource<Bill[]>(
    "finance.bills",
    bills,
    source,
    (d) => d.length === 0,
  );

  return (
    <>
      {/* UX-012: this badge is the ONLY place that reports data provenance for
          the rows shown below — it reads the same useSeededResource call as
          `rows`, so it can never disagree with what the table shows
          (UX-002's pattern; the page used to render a second, independent
          badge from the raw `source` prop — removed). */}
      <DataSourceBadge provenance={provenance ?? "live"} cachedAt={cachedAt} offline={offline} />
      <DataTable<Bill>
        columns={[
          { key: "billNo", label: t("colBill"), render: (b) => <span className="mono">{b.billNo}</span> },
          { key: "vendor", label: t("colVendor") },
          { key: "poRef", label: t("colPoRef"), render: (b) => b.poRef ?? "—" },
          { key: "amount", label: t("colAmount"), align: "right", cellType: "amount" },
          { key: "submittedDate", label: t("colSubmitted"), render: (b) => formatIndianDate(b.submittedDate) },
          { key: "dueDate", label: t("colDue"), render: (b) => (b.dueDate ? formatIndianDate(b.dueDate) : "—") },
          { key: "threeWayMatch", label: t("colThreeWayMatch"), render: (b) => <StatusPill status={b.threeWayMatch} label={b.threeWayMatch.replace("_", " ")} /> },
          { key: "status", label: t("colStatus"), render: (b) => <StatusPill status={b.status} label={b.status.replace("_", " ")} /> },
        ]}
        rows={rows}
        rowHref={(b) => `/finance/expenditure/bills/${b.id}`}
        sortable
        filterable
        filterPlaceholder={t("filterPlaceholder")}
        pageSize={15}
        exportable
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
