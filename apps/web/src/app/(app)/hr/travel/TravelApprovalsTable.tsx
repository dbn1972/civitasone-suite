"use client";

/**
 * GAP-HR-TRAVEL-01: split out for the same reason as hr/advances/
 * AdvancesTable.tsx / hr/overtime/OvertimeTable.tsx -- the Actions column
 * needs a render() callback DataTable cannot accept from a Server
 * Component.
 *
 * Segregation of duties: a decision control is offered only on a PENDING
 * request that is NOT the viewer's own. The server already answers 403
 * SELF_APPROVAL and never lists the actor's own requests in this queue; this
 * is the matching UI guard so a stray own-row (e.g. a stale cache) can never
 * show Approve / Reject.
 */
import { useTranslations } from "next-intl";
import { DataTable } from "../../../_components/ds";
import { TravelApprovalActions } from "./TravelApprovalActions";
import type { TeamRow } from "./mapTravel";

export function TravelApprovalsTable({ rows, currentUserId }: { rows: TeamRow[]; currentUserId: string | null }) {
  const t = useTranslations("travel");
  const columns: { key: keyof TeamRow & string; label: string; cellType?: "status" | "amount" | "date"; render?: (row: TeamRow) => React.ReactNode }[] = [
    { key: "employee", label: t("colEmployee") },
    { key: "destination", label: t("colDestination") },
    { key: "purpose", label: t("colPurpose") },
    { key: "from_date", label: t("colFrom"), cellType: "date" },
    { key: "to_date", label: t("colTo"), cellType: "date" },
    { key: "mode", label: t("colMode") },
    { key: "advanceRequired", label: t("colAdvance"), cellType: "amount" },
    { key: "status", label: t("colStatus"), cellType: "status" },
    {
      key: "id" as const,
      label: t("colActions"),
      render: (row: TeamRow) => {
        if (row.status !== "pending") return null;
        if (currentUserId !== null && row.employeeId === currentUserId) {
          return <span style={{ color: "var(--mut)", fontSize: 12 }}>{t("ownRequestNote")}</span>;
        }
        return <TravelApprovalActions id={row.id} />;
      },
    },
  ];

  return (
    <DataTable<TeamRow>
      columns={columns}
      rows={rows}
      sortable
      filterable
      filterPlaceholder={t("approvalsFilterPlaceholder")}
      pageSize={15}
      emptyIcon="✈️"
      emptyTitle={t("approvalsEmptyTitle")}
      emptyMessage={t("approvalsEmptyMessage")}
    />
  );
}
