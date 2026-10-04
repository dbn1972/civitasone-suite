"use client";

import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { Button, ConfirmDialog, useConfirmAction } from "../../../_components/ds";
import { browserJson } from "@/lib/api/browserClient";

interface SignBatchActionProps {
  batchId: string;
  pfmsId: string;
}

/**
 * POST /v1/finance/pfms/:id/sign — signs a PFMS batch with the tenant's DSC signer (GAP-FINANCE-PFMS-01).
 * The signature is produced server-side from the canonical batch; nothing is pasted in. The request is queued
 * (202): the row's signature column updates once the signer has answered, so the list is refreshed after submit.
 * Irreversible.
 */
export function SignBatchAction({ batchId, pfmsId }: SignBatchActionProps) {
  const t = useTranslations("pfmsSignBatchAction");
  const router = useRouter();

  const { open, busy, error, trigger, cancel, confirm } = useConfirmAction({
    onConfirm: async () => {
      await browserJson(`v1/finance/pfms/${batchId}/sign`, { method: "POST", body: JSON.stringify({}) });
    },
    onSuccess: () => router.refresh(),
  });

  return (
    <>
      <Button type="button" aria-label={t("signAriaLabel", { pfmsId })} onClick={trigger} style={{ minHeight: 36 }}>
        {t("signButtonLabel")}
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
            <p style={{ fontSize: 13 }}>{t("changeNote")}</p>
          </div>
        }
        onConfirm={() => void confirm()}
        onCancel={cancel}
      />
    </>
  );
}
