"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button, ConfirmDialog } from "../../../_components/ds";
import { useTranslations } from "next-intl";

type Decision = "approved" | "rejected";

/**
 * GAP-HR-MEDICAL-05 (money-adjacent — human review requested, see PR):
 * approve/reject for a single pending medical claim. Backend
 * (medical/routes.ts's PATCH .../approve) already enforces HR_ROLES,
 * the pending-only state guard, and a race-safe atomic UPDATE — this
 * component only calls it; it does not re-implement any of that.
 *
 * Approve always sends the full claimed amount (claimedAmountMinor) as
 * approvedAmountMinor — a partial-amount override is NOT built here (that
 * belongs on a claim-detail page, which doesn't exist yet; out of scope for
 * this fix). Reject requires a typed reason via ConfirmDialog's own
 * maker-checker convention (requireReason), matching every other
 * reject/deny action in this app.
 */
export function ClaimActions({
  claimId,
  status,
  claimedAmountMinor,
}: {
  claimId: string;
  status: string;
  claimedAmountMinor: number | null;
}) {
  const t = useTranslations("medicalClaims");
  const router = useRouter();
  const [decision, setDecision] = useState<Decision | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | undefined>();

  if (status !== "pending") return null;

  async function submit(reason?: string) {
    if (!decision) return;
    setBusy(true);
    setError(undefined);
    try {
      const res = await fetch(`/api/proxy/v1/hrms/medical/claims/${claimId}/approve`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          status: decision,
          ...(decision === "approved" && claimedAmountMinor != null ? { approvedAmountMinor: claimedAmountMinor } : {}),
          ...(reason ? { remarks: reason } : {}),
        }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => null) as { message?: string } | null;
        throw new Error(body?.message ?? t("actionFailedMessage"));
      }
      setDecision(null);
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : t("actionFailedMessage"));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div style={{ display: "flex", gap: 6 }}>
      <Button variant="ghost" size="sm" onClick={() => setDecision("approved")}>{t("actionApprove")}</Button>
      <Button variant="ghost" size="sm" onClick={() => setDecision("rejected")}>{t("actionReject")}</Button>
      <ConfirmDialog
        open={decision !== null}
        title={decision === "approved" ? t("confirmApproveTitle") : t("confirmRejectTitle")}
        description={decision === "approved" ? t("confirmApproveBody") : t("confirmRejectBody")}
        confirmLabel={decision === "approved" ? t("actionApprove") : t("actionReject")}
        danger={decision === "rejected"}
        requireReason={decision === "rejected"}
        reasonLabel={t("remarksLabel")}
        busy={busy}
        errorMessage={error}
        onConfirm={(reason) => void submit(reason)}
        onCancel={() => setDecision(null)}
      />
    </div>
  );
}
