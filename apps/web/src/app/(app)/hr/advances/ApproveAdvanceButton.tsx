"use client";

/**
 * GAP-HR-ADVANCES-02: an advance previously had no way to leave "Pending"
 * from the UI -- PATCH .../approve existed with no caller, and no reject
 * endpoint existed at all. This renders both actions for a single pending
 * row, gated by the page (HR-role rows only, and never the row's own
 * creator -- the server enforces both checks independently; this is UX
 * only). Approve is a plain confirmation; reject requires a typed reason
 * (server: 1-500 chars), mirroring the backend's own validation so a
 * client-side rejection never round-trips to a raw server error.
 */
import { useState } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { Button, ConfirmDialog } from "../../../_components/ds";
import { useFormError } from "@/lib/useFormError";

export function ApproveAdvanceButton({ id }: { id: string }) {
  // GAP-HR-ADVANCES-07: every label / dialog string comes from advances.* (no English literals).
  const t = useTranslations("advances");
  const router = useRouter();
  const [dialog, setDialog] = useState<"approve" | "reject" | null>(null);
  const [busy, setBusy] = useState(false);
  const formError = useFormError("advance decision");
  const [error, setError] = useState<string | undefined>(undefined);

  async function decide(action: "approve" | "reject", reason?: string) {
    setBusy(true);
    setError(undefined);
    try {
      const res = await fetch(`/api/proxy/v1/hrms/salary-advances/${id}/${action}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: action === "reject" ? JSON.stringify({ reason }) : undefined,
      });
      if (!res.ok) {
        const resolved = await formError.fromResponse(res, "save");
        setError(resolved.message);
        return;
      }
      setDialog(null);
      router.refresh();
    } catch (caught) {
      setError(formError.fromException("save", caught).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div style={{ display: "flex", gap: 8 }}>
      <Button size="sm" variant="primary" onClick={() => { setDialog("approve"); setError(undefined); }}>
        {t("approveBtn")}
      </Button>
      <Button size="sm" variant="ghost" onClick={() => { setDialog("reject"); setError(undefined); }}>
        {t("rejectBtn")}
      </Button>

      <ConfirmDialog
        open={dialog === "approve"}
        title={t("approveDialogTitle")}
        description={t("approveDialogDescription")}
        confirmLabel={t("approveBtn")}
        busy={busy}
        errorMessage={error}
        onConfirm={() => decide("approve")}
        onCancel={() => setDialog(null)}
      />
      <ConfirmDialog
        open={dialog === "reject"}
        title={t("rejectDialogTitle")}
        description={t("rejectDialogDescription")}
        confirmLabel={t("rejectBtn")}
        danger
        requireReason
        reasonLabel={t("rejectReasonLabel")}
        maxReasonLength={500}
        busy={busy}
        errorMessage={error}
        onConfirm={(reason) => decide("reject", reason)}
        onCancel={() => setDialog(null)}
      />
    </div>
  );
}
