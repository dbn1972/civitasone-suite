"use client";

import { useTranslations } from "next-intl";
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
  const t = useTranslations("pfmsBatchesPanel");

  if (batches.length === 0) {
    return (
      <EmptyState
        icon="📦"
        title={t("emptyTitle")}
        message={t("emptyMessage")}
      />
    );
  }

  return (
    <DataTable<PfmsBatchRow>
      columns={[
        { key: "pfmsId", label: t("colPfmsId") },
        { key: "type", label: t("colType") },
        { key: "amountMinor", label: t("colAmount"), align: "right", cellType: "amount" },
        { key: "agencyCode", label: t("colAgency") },
        { key: "schemeCode", label: t("colScheme") },
        { key: "ddoCode", label: t("colDdo") },
        { key: "submissionStatus", label: t("colStatus"), cellType: "status" },
        {
          key: "id",
          label: t("colActions"),
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
      filterPlaceholder={t("filterPlaceholder")}
      pageSize={15}
    />
  );
}
