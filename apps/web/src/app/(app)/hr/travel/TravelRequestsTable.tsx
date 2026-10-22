"use client";

/**
 * GAP-HR-TRAVEL-01/02: the requester's own list. Split out of page.tsx (a
 * Server Component) because the Actions column needs a `render:` callback --
 * DataTable cannot receive a function prop from a Server Component. Shows
 * the advance as a formatted amount (paise on the wire), the approver's
 * rejection reason to the requester, and -- for an APPROVED request only --
 * a link into the expense-claim form pre-linked to that trip.
 */
import Link from "next/link";
import { useTranslations } from "next-intl";
import { DataTable } from "../../../_components/ds";
import type { Row } from "./mapTravel";

/** `/hr/expenses?travelRequestId=<id>` -- the id is API data, encoded for the query string. */
export function claimExpensesHref(travelRequestId: string): string {
  return `/hr/expenses?travelRequestId=${encodeURIComponent(travelRequestId)}`;
}

export function TravelRequestsTable({ rows, isApprover }: { rows: Row[]; isApprover: boolean }) {
  const t = useTranslations("travel");
  const columns: { key: keyof Row & string; label: string; cellType?: "status" | "amount" | "date"; hideOnMobile?: boolean; render?: (row: Row) => React.ReactNode }[] = [
    { key: "destination", label: t("colDestination") },
    { key: "purpose", label: t("colPurpose") },
    // GAP-HR-TRAVEL-04: cellType "date" -- a node-postgres DATE column can
    // arrive as an ISO timestamp ("...T00:00:00.000Z").
    { key: "from_date", label: t("colFrom"), cellType: "date" },
    { key: "to_date", label: t("colTo"), cellType: "date" },
    { key: "mode", label: t("colMode") },
    // GAP-HR-TRAVEL-02: advance_required (paise) was fetched but never shown.
    { key: "advanceRequired", label: t("colAdvance"), cellType: "amount" },
    { key: "status", label: t("colStatus"), cellType: "status" },
    // GAP-HR-TRAVEL-01: the requester must be able to see WHY a request was rejected.
    { key: "rejectionReason", label: t("colRejectionReason"), hideOnMobile: true },
    {
      key: "id",
      label: t("colActions"),
      render: (row) =>
        row.canClaim ? (
          <Link
            href={claimExpensesHref(row.id)}
            className="btn ghost sm"
            aria-label={t("claimExpensesAria", { destination: row.destination })}
          >
            {t("claimExpenses")}
          </Link>
        ) : null,
    },
  ];

  return (
    <DataTable<Row>
      columns={columns}
      rows={rows}
      sortable
      filterable
      filterPlaceholder={t("filterPlaceholder")}
      pageSize={15}
      emptyIcon="✈️"
      emptyTitle={t("emptyTitle")}
      emptyMessage={isApprover ? t("emptyMessageApprover") : t("emptyMessage")}
    />
  );
}
