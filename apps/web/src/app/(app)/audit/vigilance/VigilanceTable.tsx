"use client";

import { DataTable, StatusPill } from "@/app/_components/ds";
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

export function VigilanceTable({ rows, source }: { rows: VigilanceCaseSummary[]; source: "api" | "error" }) {
  const { data } = useSeededResource("audit.vigilance.cases", rows, source, (d) => d.length === 0);

  return (
    <DataTable<VigilanceCaseSummary & Record<string, unknown>>
      columns={[
        { key: "caseNo", label: "Case No.", sortable: true },
        { key: "officer", label: "Officer" },
        { key: "charges", label: "Charges" },
        { key: "inquiryStatus", label: "Inquiry Status", render: (row) => <StatusPill status={INQUIRY_LABELS[row.inquiryStatus as VigilanceCaseSummary["inquiryStatus"]] ?? String(row.inquiryStatus)} /> },
        { key: "outcome", label: "Outcome", render: (row) => <StatusPill status={OUTCOME_LABELS[row.outcome as VigilanceCaseSummary["outcome"]] ?? String(row.outcome)} /> },
      ]}
      rows={data as (VigilanceCaseSummary & Record<string, unknown>)[]}
      sortable
      filterable
      filterPlaceholder="Search vigilance cases..."
      pageSize={15}
      exportable
      exportFilename="vigilance-cases"
    />
  );
}
