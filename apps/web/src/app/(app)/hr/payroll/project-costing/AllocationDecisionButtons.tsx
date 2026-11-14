"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { Button, ConfirmDialog } from "../../../../_components/ds";
import { browserFetch, errorCodeFromResponse, errorMessageFromResponse } from "@/lib/api/browserClient";

type Props = { allocationId: string; requestedBy: string; currentUserId: string | null; label: string };

/**
 * Approve / reject one pending allocation (maker-checker: the requester sees no
 * buttons, and the server refuses a self-decision anyway). Approving an
 * allocation back-dated into an already-costed month books a reclassification,
 * which the confirm text says.
 */
export function AllocationDecisionButtons({ allocationId, requestedBy, currentUserId, label }: Props) {
  const t = useTranslations("projectCosting");
  const router = useRouter();
  const [pending, setPending] = useState<"approve" | "reject" | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | undefined>();

  if (currentUserId && currentUserId === requestedBy) return <span style={{ color: "var(--ink2)", fontSize: "0.85rem" }}>{t("awaitingOther")}</span>;

  async function decide() {
    if (!pending) return;
    setBusy(true);
    setError(undefined);
    try {
      const res = await browserFetch(`v1/payroll/project-costing/allocations/${allocationId}/decision`, {
        method: "POST", body: JSON.stringify({ decision: pending }),
      });
      if (!res.ok) {
        const code = await errorCodeFromResponse(res);
        if (code === "SELF_APPROVAL") throw new Error(t("selfApprovalError"));
        throw new Error(await errorMessageFromResponse(res));
      }
      setPending(null);
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : t("networkError"));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
      <Button type="button" style={{ minHeight: 44 }} onClick={() => setPending("approve")} aria-label={t("approveAria", { label })}>{t("approveBtn")}</Button>
      <Button type="button" variant="secondary" style={{ minHeight: 44 }} onClick={() => setPending("reject")} aria-label={t("rejectAria", { label })}>{t("rejectBtn")}</Button>
      <ConfirmDialog
        open={pending !== null}
        title={pending === "approve" ? t("approveTitle") : t("rejectTitle")}
        confirmLabel={pending === "approve" ? t("approveBtn") : t("rejectBtn")}
        busy={busy}
        errorMessage={error}
        description={pending === "approve" ? t("approveDescription", { label }) : t("rejectDescription", { label })}
        onConfirm={() => void decide()}
        onCancel={() => !busy && setPending(null)}
      />
    </div>
  );
}
