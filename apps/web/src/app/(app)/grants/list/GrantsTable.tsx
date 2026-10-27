"use client";

import type { ReactNode } from "react";
import { DataTable } from "@/app/_components/ds";
import { MaskedReveal } from "@/app/_components/ds/MaskedReveal";
import { DataSourceBadge } from "@/app/_components/DataSourceBadge";
import { formatIndianDate } from "@/lib/formatters";
import type { GrantSummary } from "@civitasone/types";
import { useSeededResource } from "@/lib/sync/resource";

type Col = {
  key: keyof GrantSummary & string;
  label: string;
  align?: "left" | "right";
  cellType?: "status" | "amount";
  render?: (row: GrantSummary) => ReactNode;
};

/** grant-service audited reveal endpoint (same contract as crm / hrms), relative to /api/proxy. */
const GRANTS_PII_REVEAL_PATH = "v1/grants/pii/reveal";

/**
 * GAP-GRANTS-LIST-03 (UAT B4): grant-service now masks a natural person's name at source
 * (granteeNameMasked) and offers an audited reveal. The client-side mask below only remains as
 * defence in depth for a response that predates that flag.
 *
 * Original note - GAP-GRANTS-LIST-03 (DPDP, safest default — flagged for DPO/HUMAN REVIEW):
 * a grantee may be a natural person, and the grants list is visible to every
 * module viewer. Without a type flag on GrantSummary we cannot single out
 * natural persons, so the conservative DPDP default is to show the name
 * masked (first character only) to read-only roles and in the clear to
 * privileged grants roles. Over-masking institutions is an accepted tradeoff
 * vs. exposing individual names; true redaction needs the API to omit the
 * clear value for unprivileged roles.
 */
function maskName(name: string): string {
  const trimmed = name.trim();
  if (!trimmed) return "—";
  return `${trimmed[0]}${"•".repeat(Math.max(trimmed.length - 1, 2))}`;
}

function buildColumns(canViewGranteeName: boolean): Col[] {
  return [
    { key: "grantNo", label: "Grant No" },
    { key: "title", label: "Title" },
    {
      key: "granteeName",
      label: "Grantee",
      render: (row) => {
        if (!row.granteeName) return "—";
        if (row.granteeNameMasked === true) {
          // The server already hid the name. Maker roles may reveal it (reason required, audited).
          return canViewGranteeName && row.granteeId ? (
            <MaskedReveal
              maskedText={row.granteeName}
              resourceType="grantee"
              resourceId={row.granteeId}
              field="name"
              label="grantee name"
              revealPath={GRANTS_PII_REVEAL_PATH}
            />
          ) : (
            row.granteeName
          );
        }
        if (row.granteeNameMasked === false) return row.granteeName; // institution: not personal data
        return canViewGranteeName ? row.granteeName : maskName(row.granteeName); // legacy response
      },
    },
    { key: "sanctionDate", label: "Sanction Date", render: (row) => formatIndianDate(row.sanctionDate) },
    // GAP-GRANTS-LIST-04: cells already render ₹ (cellType "amount"), so the
    // headings carry no inconsistent "(₹)" unit — all three money columns are
    // labelled uniformly without it.
    { key: "totalAmount", label: "Total", align: "right", cellType: "amount" },
    { key: "disbursedAmount", label: "Disbursed", align: "right", cellType: "amount" },
    { key: "pendingAmount", label: "Pending", align: "right", cellType: "amount" },
    { key: "status", label: "Status", cellType: "status" },
  ];
}

export function GrantsTable({
  grants,
  source = "api",
  canViewGranteeName = false,
}: {
  grants: GrantSummary[];
  source?: "api" | "error";
  canViewGranteeName?: boolean;
}) {
  const { data: rows, provenance, offline, cachedAt } = useSeededResource<GrantSummary[]>(
    "grants.list",
    grants,
    source,
    (d) => d.length === 0,
  );

  return (
    <>
      {/* UX-012: this badge is the ONLY place that reports data provenance for
          the rows shown below — it reads the same useSeededResource call as
          `rows`, so it can never disagree with what the table shows. */}
      <DataSourceBadge provenance={provenance ?? "live"} cachedAt={cachedAt} offline={offline} />
      <DataTable<GrantSummary>
        columns={buildColumns(canViewGranteeName)}
        rows={rows}
        rowLinkPrefix="/grants/"
        rowLinkKey="id"
        sortable
        filterable
        filterPlaceholder="Filter grants…"
        pageSize={15}
      />
    </>
  );
}
