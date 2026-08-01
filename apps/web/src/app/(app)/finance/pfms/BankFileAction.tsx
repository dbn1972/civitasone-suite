"use client";

import { useConfirmAction, ConfirmDialog } from "../../../_components/ds";
import { browserFetch, errorMessageFromResponse } from "@/lib/api/browserClient";

interface BankFileActionProps {
  batchId: string;
  pfmsId: string;
  submissionStatus: string;
}

/**
 * GET /v1/finance/pfms/:id/bank-file — downloads the NEFT bank file CSV for a
 * PFMS batch (beneficiary account numbers). Note: the route is a GET on the
 * finance-service (verified in services/finance-service/src/modules/pfms/routes.ts),
 * not a POST — the download is triggered client-side via a fetch + blob so the
 * confirm gate below still applies before any sensitive data leaves the app.
 * Only valid for batches in "signed" or "pending" submission status (finance-service
 * returns 400 INVALID_STATE otherwise).
 */
export function BankFileAction({ batchId, pfmsId, submissionStatus }: BankFileActionProps) {
  const eligible = submissionStatus === "signed" || submissionStatus === "pending";

  const { open, busy, error, trigger, cancel, confirm } = useConfirmAction({
    onConfirm: async () => {
      const res = await browserFetch(`v1/finance/pfms/${batchId}/bank-file`, { method: "GET" });
      if (!res.ok) throw new Error(await errorMessageFromResponse(res));
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `pfms_${pfmsId}.csv`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    },
  });

  return (
    <>
      <button
        type="button"
        className="btn"
        aria-label={`Download bank file for PFMS batch ${pfmsId}`}
        onClick={trigger}
        disabled={!eligible}
        title={eligible ? undefined : "Bank file is only available for pending or signed batches."}
        style={{ minHeight: 36 }}
      >
        Bank File
      </button>
      <ConfirmDialog
        open={open}
        title={`Download bank file for batch ${pfmsId}?`}
        confirmLabel="Download"
        danger
        busy={busy}
        errorMessage={error}
        description={
          <>
            This generates and downloads the NEFT beneficiary bank file (account numbers, IFSC,
            amounts) for batch <strong>{pfmsId}</strong>. Handle the downloaded file per your
            department&apos;s data-handling policy.
          </>
        }
        onConfirm={() => void confirm()}
        onCancel={cancel}
      />
    </>
  );
}
