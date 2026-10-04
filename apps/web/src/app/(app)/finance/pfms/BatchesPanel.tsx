"use client";

import { useTranslations } from "next-intl";
import { DataTable, EmptyState } from "../../../_components/ds";
import { SignBatchAction } from "./SignBatchAction";
import { BankFileAction } from "./BankFileAction";
import { SigningCell } from "./SigningCell";
import { ReleaseBatchAction } from "./ReleaseBatchAction";
import { ResolveReleaseAction } from "./ResolveReleaseAction";
import { VoidSignatureAction } from "./VoidSignatureAction";
import { canRelease, canSign, canVoid, needsResolve, parseRelease, parseSigning, releaseFailureKey } from "./signingStatus";
import { humanizeStatus } from "@/lib/formatters";
import type { PfmsBatchRow } from "./types";

/**
 * Read-only list — GET /v1/finance/pfms/batches. There is no POST create-batch
 * route registered on finance-service (see PR "## BACKEND FOLLOW-UPS"); batches
 * are created by the payments workflow, not from this console.
 */
export function BatchesPanel({ batches, canDownloadBankFile = true, canRelease: mayRelease = true }: { batches: PfmsBatchRow[]; canDownloadBankFile?: boolean; canRelease?: boolean }) {
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
        { key: "type", label: t("colType"), render: (row) => humanizeStatus(row.type) },
        { key: "amountMinor", label: t("colAmount"), align: "right", cellType: "amount" },
        { key: "agencyCode", label: t("colAgency") },
        { key: "schemeCode", label: t("colScheme") },
        { key: "ddoCode", label: t("colDdo") },
        { key: "submissionStatus", label: t("colStatus"), cellType: "status" },
        {
          // Sign status + certificate info. Only treasury-batch rows are ever signed; an e-Kuber row shows a dash.
          key: "signing",
          label: t("colSignature"),
          sortable: false,
          render: (row) => (row.channel === "treasury_batch" ? <SigningCell signing={parseSigning(row.signing)} /> : "—"),
        },
        {
          key: "id",
          label: t("colActions"),
          sortable: false,
          render: (row) => {
            // Sign / bank-file are treasury-batch concepts (DSC signing, NEFT
            // bank file for SFTP transmission). A row with channel ===
            // 'ekuber_adapter' is a completed live REST submission — the
            // backend now rejects both actions for it (INVALID_CHANNEL), so
            // don't offer them here either. See routes.ts's matching guard.
            if (row.channel !== "treasury_batch") return null;
            return (
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                {canDownloadBankFile && (
                  <BankFileAction batchId={row.id} pfmsId={row.pfmsId} submissionStatus={row.submissionStatus} />
                )}
                {mayRelease && canRelease(row.submissionStatus, parseSigning(row.signing)) && (
                  <ReleaseBatchAction batchId={row.id} pfmsId={row.pfmsId} />
                )}
                {mayRelease && canVoid(row.submissionStatus, parseSigning(row.signing)) && (
                  <VoidSignatureAction batchId={row.id} pfmsId={row.pfmsId} />
                )}
                {mayRelease && needsResolve(row.submissionStatus) && (
                  <ResolveReleaseAction batchId={row.id} pfmsId={row.pfmsId} />
                )}
                {needsResolve(row.submissionStatus) && (
                  <span role="alert" className="pill bad" style={{ width: "fit-content" }}>{t("sendUnknownNote")}</span>
                )}
                {(() => {
                  const key = releaseFailureKey(parseRelease(row.release).lastFailureCode);
                  return key && row.submissionStatus === "signed" ? (
                    <span role="status" className="pill warn" style={{ width: "fit-content" }}>{t(key)}</span>
                  ) : null;
                })()}
                {canSign(row.submissionStatus, parseSigning(row.signing)) && (
                  <SignBatchAction batchId={row.id} pfmsId={row.pfmsId} />
                )}
              </div>
            );
          },
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
