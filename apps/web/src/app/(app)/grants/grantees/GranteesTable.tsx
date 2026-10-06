"use client";

import type { ReactNode } from "react";
import { DataTable, StatusPill } from "@/app/_components/ds";
import { maskLast4 } from "@/app/_components/ds/Masked";
import { DataSourceBadge } from "@/app/_components/DataSourceBadge";
import { formatMoney } from "@/lib/formatters";
import type { GranteeSummary } from "@civitasone/types";
import { useSeededResource } from "@/lib/sync/resource";

/**
 * GAP-GRANTS-GRANTEES-05: the Type pill used to print the raw enum uppercased
 * ("SOCIETY"). A fixed label map gives proper display copy; StatusPill already
 * has tones for individual/institution/society/mission via STATUS_MAP, so the
 * pill colour is unchanged.
 */
const GRANTEE_TYPE_LABELS: Record<GranteeSummary["type"], string> = {
  individual: "Individual",
  institution: "Institution",
  society: "Society",
  mission: "Mission",
};

type Col = {
  key: keyof GranteeSummary & string;
  label: string;
  align?: "left" | "right" | "center";
  render?: (row: GranteeSummary) => ReactNode;
};

function buildColumns(canViewRegistration: boolean): Col[] {
  return [
    { key: "granteeCode", label: "Code" },
    { key: "name", label: "Name" },
    {
      key: "type",
      label: "Type",
      render: (row) => <StatusPill status={row.type} label={GRANTEE_TYPE_LABELS[row.type] ?? row.type} />,
    },
    {
      key: "registrationNo",
      label: "Registration No",
      // GAP-GRANTS-GRANTEES-04 (DPDP, safest default — flagged for security/DPO
      // confirmation): a registration/registry number can be a PAN- or
      // Aadhaar-adjacent identifier for an individual grantee, so it is masked
      // to the last 4 for non-privileged roles. Privileged grants roles see it
      // in the clear (canViewRegistration from the server). This is UI-side
      // minimisation; true redaction needs the API to omit the clear value for
      // unprivileged roles — flagged for HUMAN REVIEW.
      render: (row) =>
        row.registrationNo ? (canViewRegistration ? row.registrationNo : maskLast4(row.registrationNo)) : "—",
    },
    { key: "activeGrants", label: "Active Grants", align: "right" },
    { key: "totalGrantsReceived", label: "Total Received", align: "right", render: (row) => formatMoney(row.totalGrantsReceived) },
    { key: "ucCompliancePct", label: "UC Compliance %", align: "right", render: (row) => `${row.ucCompliancePct.toFixed(1)}%` },
  ];
}

export function GranteesTable({
  grantees,
  source = "api",
  canViewRegistration = false,
}: {
  grantees: GranteeSummary[];
  source?: "api" | "error";
  canViewRegistration?: boolean;
}) {
  const { data: rows, provenance, offline, cachedAt } = useSeededResource<GranteeSummary[]>(
    "grants.grantees",
    grantees,
    source,
    (d) => d.length === 0,
  );

  return (
    <>
      {/* UX-012: this badge is the ONLY place that reports data provenance for
          the rows shown below — it reads the same useSeededResource call as
          `rows`, so it can never disagree with what the table shows. */}
      <DataSourceBadge provenance={provenance ?? "live"} cachedAt={cachedAt} offline={offline} />
      <DataTable<GranteeSummary>
        columns={buildColumns(canViewRegistration)}
        rows={rows}
        rowLinkPrefix="/grants/grantees/"
        rowLinkKey="id"
        sortable
        filterable
        filterPlaceholder="Filter grantees…"
        pageSize={15}
      />
    </>
  );
}
