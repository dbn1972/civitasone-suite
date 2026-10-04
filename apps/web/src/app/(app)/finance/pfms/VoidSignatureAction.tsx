"use client";

import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { Button, ConfirmDialog, useConfirmAction } from "../../../_components/ds";
import { useSettledRefresh } from "@/lib/finance/useSettledRefresh";
import { browserFetch, errorCodeFromResponse, errorMessageFromResponse } from "@/lib/api/browserClient";

/**
 * POST /v1/finance/pfms/batches/:id/void-signature — clears the DSC signature of a signed, unsent batch (typically one that
 * changed after it was signed) so it can be signed again. Reason required; the user who signed it cannot void it
 * (maker-checker); audited with the voided certificate.
 */
export function VoidSignatureAction({ batchId, pfmsId }: { batchId: string; pfmsId: string }) {
  const t = useTranslations("pfmsVoidSignatureAction");
  const router = useRouter();
  const settle = useSettledRefresh(router);
  const { open, busy, error, trigger, cancel, confirm } = useConfirmAction({
    onConfirm: async (reason) => {
      const res = await browserFetch(`v1/finance/pfms/batches/${batchId}/void-signature`, {
        method: "POST", body: JSON.stringify({ reason: (reason ?? "").trim() }),
      });
      if (res.ok) return;
      const code = await errorCodeFromResponse(res);
      if (code === "MAKER_CHECKER_VIOLATION") throw new Error(t("refusedMakerChecker"));
      if (code === "INVALID_STATE") throw new Error(t("refusedState"));
      throw new Error(await errorMessageFromResponse(res));
    },
    onSuccess: () => settle(),
  });
  return (
    <>
      <Button type="button" aria-label={t("voidAriaLabel", { pfmsId })} onClick={trigger} style={{ minHeight: 36 }}>
        {t("voidButtonLabel")}
      </Button>
      <ConfirmDialog
        open={open}
        title={t("confirmTitle", { pfmsId })}
        confirmLabel={t("confirmLabel")}
        danger
        requireReason
        reasonLabel={t("reasonLabel")}
        minReasonLength={5}
        maxReasonLength={500}
        busy={busy}
        errorMessage={error}
        description={<p>{t("description", { pfmsId })}</p>}
        onConfirm={(reason) => void confirm(reason)}
        onCancel={cancel}
      />
    </>
  );
}
