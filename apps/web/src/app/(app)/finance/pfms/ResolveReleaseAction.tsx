"use client";

import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { Button, ConfirmDialog, useConfirmAction } from "../../../_components/ds";
import { useSettledRefresh } from "@/lib/finance/useSettledRefresh";
import { browserFetch, errorCodeFromResponse, errorMessageFromResponse } from "@/lib/api/browserClient";

/**
 * POST /v1/finance/pfms/batches/:id/resolve-release — a release whose outcome is unknown (the worker died mid-send, so the
 * file may or may not have reached PFMS). The operator checks the PFMS gateway and records the outcome: confirmed sent
 * (-> sent) or confirmed NOT sent (-> back to signed, may be released again). A reason is required; the user who started
 * the release cannot resolve it (maker-checker). Never auto-resent.
 */
function ResolveButton({ batchId, pfmsId, outcome }: { batchId: string; pfmsId: string; outcome: "sent" | "not_sent" }) {
  const t = useTranslations("pfmsResolveReleaseAction");
  const router = useRouter();
  const settle = useSettledRefresh(router);
  const k = outcome === "sent" ? "sent" : "notSent";
  const { open, busy, error, trigger, cancel, confirm } = useConfirmAction({
    onConfirm: async (reason) => {
      const res = await browserFetch(`v1/finance/pfms/batches/${batchId}/resolve-release`, {
        method: "POST", body: JSON.stringify({ outcome, reason: (reason ?? "").trim() }),
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
      <Button type="button" aria-label={t(`${k}AriaLabel`, { pfmsId })} onClick={trigger} style={{ minHeight: 36 }}>
        {t(`${k}Button`)}
      </Button>
      <ConfirmDialog
        open={open}
        title={t(`${k}Title`, { pfmsId })}
        confirmLabel={t(`${k}Confirm`)}
        danger
        requireReason
        reasonLabel={t("reasonLabel")}
        minReasonLength={5}
        maxReasonLength={500}
        busy={busy}
        errorMessage={error}
        description={<p>{t(`${k}Description`, { pfmsId })}</p>}
        onConfirm={(reason) => void confirm(reason)}
        onCancel={cancel}
      />
    </>
  );
}

export function ResolveReleaseAction({ batchId, pfmsId }: { batchId: string; pfmsId: string }) {
  return (
    <>
      <ResolveButton batchId={batchId} pfmsId={pfmsId} outcome="sent" />
      <ResolveButton batchId={batchId} pfmsId={pfmsId} outcome="not_sent" />
    </>
  );
}
