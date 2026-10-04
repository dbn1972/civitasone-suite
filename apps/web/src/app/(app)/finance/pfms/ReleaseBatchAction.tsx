"use client";

import { useRouter } from "next/navigation";
import { useSettledRefresh } from "@/lib/finance/useSettledRefresh";
import { useTranslations } from "next-intl";
import { Button, ConfirmDialog, useConfirmAction } from "../../../_components/ds";
import { browserFetch, errorCodeFromResponse, errorMessageFromResponse } from "@/lib/api/browserClient";
import { releaseRefusalKey } from "./signingStatus";

interface ReleaseBatchActionProps {
  batchId: string;
  pfmsId: string;
}

/**
 * POST /v1/finance/pfms/batches/:id/release — sends a DSC-signed batch to PFMS (GAP-FINANCE-PFMS-01). finance-service
 * re-verifies the stored signature against the batch as it stands now, enforces the production gate and maker-checker,
 * sends the file once and records it. A refusal comes back with a machine code; each known code gets its own message.
 * The request is queued (202), so the list is refreshed after submit. Irreversible.
 */
export function ReleaseBatchAction({ batchId, pfmsId }: ReleaseBatchActionProps) {
  const t = useTranslations("pfmsReleaseBatchAction");
  const router = useRouter();
  const settle = useSettledRefresh(router);

  const { open, busy, error, trigger, cancel, confirm } = useConfirmAction({
    onConfirm: async () => {
      const res = await browserFetch(`v1/finance/pfms/batches/${batchId}/release`, { method: "POST", body: JSON.stringify({}) });
      if (res.ok) return;
      const key = releaseRefusalKey(await errorCodeFromResponse(res));
      throw new Error(key ? t(key) : await errorMessageFromResponse(res));
    },
    // 202: the send happens in the worker. Re-read until it lands; a failed send shows on the row (releaseFailed).
    onSuccess: () => settle(),
  });

  return (
    <>
      <Button type="button" aria-label={t("releaseAriaLabel", { pfmsId })} onClick={trigger} style={{ minHeight: 36 }}>
        {t("releaseButtonLabel")}
      </Button>
      <ConfirmDialog
        open={open}
        title={t("confirmTitle", { pfmsId })}
        confirmLabel={t("confirmLabel")}
        danger
        busy={busy}
        errorMessage={error}
        description={
          <div style={{ display: "grid", gap: 8 }}>
            <p>{t.rich("description", { pfmsId, b: (chunks) => <strong>{chunks}</strong> })}</p>
            <p style={{ fontSize: 13 }}>{t("checksNote")}</p>
          </div>
        }
        onConfirm={() => void confirm()}
        onCancel={cancel}
      />
    </>
  );
}
