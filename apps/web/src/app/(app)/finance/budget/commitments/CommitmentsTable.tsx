"use client";
import { useTranslations } from "next-intl";
import { DataTable } from "@/app/_components/ds";
import { DataSourceBadge } from "@/app/_components/DataSourceBadge";
import { useSeededResource } from "@/lib/sync/resource";
import { formatIndianDate, formatMoney } from "@/lib/formatters";
import { minorToDecimalString } from "@/lib/money";

type Row = Record<string, unknown>;

export const COMMITMENT_STATUSES = ["active", "partially_released", "fully_released", "cancelled"] as const;

/** Head display: "2202 · General Education" when the monitoring lookup knows it, else null (caller shows the localized fallback). */
export function headLabel(headId: unknown, heads?: Record<string, string>): string | null {
  return typeof headId === "string" ? (heads?.[headId] ?? null) : null;
}

export function CommitmentsTable({
  commitments,
  heads,
  source = "api",
}: {
  commitments: Row[];
  heads?: Record<string, string>;
  source?: "api" | "error";
}) {
  const t = useTranslations("financeCommitments");
  const { data: rows, provenance, offline, cachedAt } = useSeededResource<Row[]>(
    "finance.commitments", commitments, source, (d) => d.length === 0
  );
  const enriched = rows.map((r) => ({
    ...r,
    _head: headLabel(r.budget_head_id, heads) ?? t("unknownHead"),
    _type: String(r.reference_type ?? "").replace(/_/g, " "),
  }));
  return (
    <>
      <DataSourceBadge provenance={provenance ?? "live"} cachedAt={cachedAt} offline={offline} />
      <DataTable<Row>
        columns={[
          { key: "reference_no", label: t("colReference") },
          { key: "_type", label: t("colSource") },
          { key: "_head", label: t("colHead") },
          { key: "committed_minor", label: t("colCommitted"), align: "right", render: (r) => formatMoney(r.committed_minor as string | number | null), csv: (r) => minorToDecimalString(r.committed_minor as string | number | null) ?? "" },
          { key: "released_minor", label: t("colReleased"), align: "right", render: (r) => formatMoney(r.released_minor as string | number | null), csv: (r) => minorToDecimalString(r.released_minor as string | number | null) ?? "" },
          { key: "balance_minor", label: t("colBalance"), align: "right", render: (r) => formatMoney(r.balance_minor as string | number | null), csv: (r) => minorToDecimalString(r.balance_minor as string | number | null) ?? "" },
          { key: "status", label: t("colStatus"), cellType: "status" as const },
          { key: "committed_at", label: t("colCommittedOn"), render: (r) => formatIndianDate(r.committed_at as string | null | undefined), csv: (r) => String(r.committed_at ?? "") },
        ]}
        rows={enriched}
        sortable
        filterable
        filterPlaceholder={t("search")}
        pageSize={20}
        exportable exportAudit="finance/budget/commitments"
        csvPlainAmounts
        exportFilename="commitment-register"
        emptyIcon="🧾"
        emptyTitle={t("emptyTitle")}
        emptyMessage={t("emptyMessage")}
      />
    </>
  );
}
