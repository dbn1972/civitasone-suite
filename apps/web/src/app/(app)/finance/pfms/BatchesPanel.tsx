"use client";

import { DataTable, EmptyState } from "../../../_components/ds";
import { SignBatchAction } from "./SignBatchAction";
import { BankFileAction } from "./BankFileAction";
import type { PfmsBatchRow } from "./types";

/**
 * Read-only list — GET /v1/finance/pfms/batches. There is no POST create-batch
 * route registered on finance-service (see PR "## BACKEND FOLLOW-UPS"); batches
 * are created by the payments workflow, not from this console.
 */
export function BatchesPanel({ batches }: { batches: PfmsBatchRow[] }) {
  if (batches.length === 0) {
    return (
      <EmptyState
        icon="📦"
        title="No PFMS batches yet"
        message="PFMS batches are created by the payments workflow when a bill is routed for PFMS/treasury disbursement. None have been recorded for this tenant yet."
      />
    );
  }

  return (
    <DataTable<PfmsBatchRow>
      columns={[
        { key: "pfmsId", label: "PFMS ID" },
        { key: "type", label: "Type" },
        { key: "amountMinor", label: "Amount", align: "right", cellType: "amount" },
        { key: "agencyCode", label: "Agency" },
        { key: "schemeCode", label: "Scheme" },
        { key: "ddoCode", label: "DDO" },
        { key: "submissionStatus", label: "Status", cellType: "status" },
        {
          key: "id",
          label: "Actions",
          sortable: false,
          render: (row) => (
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
              <BankFileAction batchId={row.id} pfmsId={row.pfmsId} submissionStatus={row.submissionStatus} />
              {row.submissionStatus !== "signed" && (
                <SignBatchAction batchId={row.id} pfmsId={row.pfmsId} />
              )}
            </div>
          ),
        },
      ]}
      rows={batches}
      sortable
      filterable
      filterPlaceholder="Filter by PFMS ID, agency, or scheme…"
      pageSize={15}
    />
  );
}
