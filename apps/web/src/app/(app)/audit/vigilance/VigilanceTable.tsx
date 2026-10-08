"use client";

import { DataTable, StatusPill, RevealableValue } from "@/app/_components/ds";
import { DataSourceBadge } from "@/app/_components/DataSourceBadge";
import { useSeededResource } from "@/lib/sync/resource";
import type { VigilanceCaseSummary } from "@/app/_data/loaders";

const INQUIRY_LABELS: Record<VigilanceCaseSummary["inquiryStatus"], string> = {
  preliminary_enquiry: "Preliminary Enquiry",
  under_investigation: "Under Investigation",
  charge_sheet_issued: "Charge Sheet Issued",
  inquiry_complete: "Inquiry Complete",
};

const OUTCOME_LABELS: Record<VigilanceCaseSummary["outcome"], string> = {
  pending: "Pending",
  major_penalty: "Major Penalty",
  minor_penalty: "Minor Penalty",
  exonerated: "Exonerated",
};

export function VigilanceTable({ rows, source, canViewPII = false }: { rows: VigilanceCaseSummary[]; source: "api" | "error"; canViewPII?: boolean }) {
  const { data, provenance, offline, cachedAt } = useSeededResource("audit.vigilance.cases", rows, source, (d) => d.length === 0);

  // GAP-AUDIT-VIGILANCE-02 (DPDP): officer identity + charge text are
  // disciplinary data. The page sends only the SERVER-MASKED value in the RSC
  // payload (never the clear value, even to privileged roles). A PII reader
  // (canViewPII) gets an audited reveal control that round-trips to
  // POST /v1/audit/vigilance/:id/reveal, which returns the clear value AND
  // writes a `vigilance_reveal` audit event in the same transaction. A
  // non-reader sees the mask with no reveal, and no client-side CSV export.
  const revealCell = (field: "officer" | "charges", label: string) =>
    (row: VigilanceCaseSummary) => (
      <RevealableValue
        maskedText={field === "officer" ? row.officer : row.charges}
        revealPath={`v1/audit/vigilance/${row.id}/reveal`}
        revealBody={{ field }}
        pick={(json) => (json as { data?: { value?: string | null } })?.data?.value}
        canReveal={canViewPII}
        label={label}
        fallback="••••"
      />
    );

  return (
    <>
      {/* GAP-AUDIT-VIGILANCE-05: the only provenance indicator for the rows
          below, fed by the SAME useSeededResource call (pattern: citizen alerts). */}
      <DataSourceBadge provenance={provenance ?? "live"} cachedAt={cachedAt} offline={offline} />
      <DataTable<VigilanceCaseSummary & Record<string, unknown>>
        columns={[
          { key: "caseNo", label: "Case No.", sortable: true },
          { key: "officer", label: "Officer", render: (row) => revealCell("officer", "officer")(row) },
          { key: "charges", label: "Charges", render: (row) => revealCell("charges", "charges")(row) },
          { key: "inquiryStatus", label: "Inquiry Status", render: (row) => <StatusPill status={INQUIRY_LABELS[row.inquiryStatus as VigilanceCaseSummary["inquiryStatus"]] ?? String(row.inquiryStatus)} /> },
          { key: "outcome", label: "Outcome", render: (row) => <StatusPill status={OUTCOME_LABELS[row.outcome as VigilanceCaseSummary["outcome"]] ?? String(row.outcome)} /> },
        ]}
        rows={data as (VigilanceCaseSummary & Record<string, unknown>)[]}
        sortable
        filterable
        filterPlaceholder="Search vigilance cases..."
        pageSize={15}
        exportable={canViewPII}
        exportFilename="vigilance-cases"
      />
    </>
  );
}
