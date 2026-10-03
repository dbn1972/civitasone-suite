"use client";

/**
 * GAP-HR-EXPENSES-02: an expense claim had no reject endpoint at all, and
 * approvers had no way to reach a pending claim from the UI. Mirrors
 * hr/advances' ApproveAdvanceButton.tsx (same confirm-dialog pattern,
 * reject-requires-reason), gated by the page (approver-role rows only, and
 * never the row's own creator) -- the server enforces both checks
 * independently (self-approval/SoD, mandatory reason >= 3 chars); this
 * component is UX only, matching the backend's own validation so a
 * rejection never round-trips to a raw server error.
 */
import { useState } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { Button, ConfirmDialog } from "../../../_components/ds";
import { useFormError } from "@/lib/useFormError";

export function ExpenseApprovalActions({ id }: { id: string }) {
  const t = useTranslations("expenses");
  const router = useRouter();
  const [dialog, setDialog] = useState<"approve" | "reject" | null>(null);
  const [busy, setBusy] = useState(false);
  const formError = useFormError("expense claim decision");
  const [error, setError] = useState<string | undefined>(undefined);

  async function decide(action: "approve" | "reject", reason?: string) {
    setBusy(true);
    setError(undefined);
    try {
      const res = await fetch(`/api/proxy/v1/hrms/expenses/${id}/${action}`, {
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
        {t("approveLabel")}
      </Button>
      <Button size="sm" variant="ghost" onClick={() => { setDialog("reject"); setError(undefined); }}>
        {t("rejectLabel")}
      </Button>

      <ConfirmDialog
        open={dialog === "approve"}
        title={t("approveConfirmTitle")}
        description={t("approveConfirmDescription")}
        confirmLabel={t("approveLabel")}
        busy={busy}
        errorMessage={error}
        onConfirm={() => decide("approve")}
        onCancel={() => setDialog(null)}
      />
      <ConfirmDialog
        open={dialog === "reject"}
        title={t("rejectConfirmTitle")}
        description={t("rejectConfirmDescription")}
        confirmLabel={t("rejectLabel")}
        danger
        requireReason
        minReasonLength={3}
        reasonLabel={t("reasonLabel")}
        maxReasonLength={500}
        busy={busy}
        errorMessage={error}
        onConfirm={(reason) => decide("reject", reason)}
        onCancel={() => setDialog(null)}
      />
    </div>
  );
}
