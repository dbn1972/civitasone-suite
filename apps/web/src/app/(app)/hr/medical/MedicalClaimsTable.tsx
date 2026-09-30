"use client";

import Link from "next/link";
import { DataTable } from "../../../_components/ds";
import { useTranslations } from "next-intl";
import { ClaimActions } from "./ClaimActions";

export type MedicalClaimRow = {
  id: string;
  caseRef: string;
  employeeId: string;
  employeeLabel: string;
  claimType: string;
  hospital: string;
  amount: number | null;
  approvedAmount: number | null;
  claimantType: string;
  filedDate: string;
  status: string;
  /** Unused as a value — a render column needs a real column key; the
   * actions cell below ignores it and renders from the whole row. */
  actions: string;
} & Record<string, unknown>;

// GAP-HR-MEDICAL-06 (COPY): claimType used to print the raw enum value
// (indoor/outdoor/reimbursement/advance) verbatim.
const CLAIM_TYPE_KEYS = ["indoor", "outdoor", "reimbursement", "advance"] as const;

export function MedicalClaimsTable({ rows, canApprove }: { rows: MedicalClaimRow[]; canApprove: boolean }) {
  const t = useTranslations("medicalClaims");

  const columns: {
    key: keyof MedicalClaimRow & string;
    label: string;
    cellType?: "status" | "amount";
    sortable?: boolean;
    render?: (row: MedicalClaimRow) => React.ReactNode;
  }[] = [
    { key: "caseRef", label: t("colClaimRef") },
    {
      key: "employeeLabel",
      label: t("colEmployee"),
      render: (r) => (r.employeeLabel !== "—" ? <Link href={`/hr/employees/${r.employeeId}`}>{r.employeeLabel}</Link> : <span>—</span>),
    },
    {
      key: "claimType",
      label: t("colClaimType"),
      render: (r) => <span>{(CLAIM_TYPE_KEYS as readonly string[]).includes(r.claimType) ? t(`claimType.${r.claimType}`) : r.claimType}</span>,
    },
    { key: "hospital", label: t("colHospital") },
    { key: "amount", label: t("colClaimedAmount"), cellType: "amount" },
    { key: "approvedAmount", label: t("colApproved"), cellType: "amount" },
    { key: "claimantType", label: t("colClaimant") },
    { key: "filedDate", label: t("colFiledDate"), sortable: false },
    { key: "status", label: t("colStatus"), cellType: "status" },
    // GAP-HR-MEDICAL-05: File claim link is on the page header; approve/
    // reject actions live here, one per pending row, HR/finance roles only
    // (canApprove, computed server-side from the real session).
    ...(canApprove ? [{
      key: "actions" as const,
      label: t("colActions"),
      sortable: false,
      render: (r: MedicalClaimRow) => (
        <ClaimActions claimId={r.id} status={r.status} claimedAmountMinor={r.amount} />
      ),
    }] : []),
  ];

  return (
    <DataTable<MedicalClaimRow>
      columns={columns}
      rows={rows}
      sortable
      filterable
      filterPlaceholder={t("filterPlaceholder")}
      pageSize={15}
      emptyIcon="🏥"
      emptyTitle={t("emptyTitle")}
      emptyMessage={t("emptyMessage")}
    />
  );
}
