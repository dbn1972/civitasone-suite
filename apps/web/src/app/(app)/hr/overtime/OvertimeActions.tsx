"use client";

/**
 * GAP-HR-OVERTIME-01: the page previously had no approve/reject control at
 * all -- PATCH .../approve|reject existed with no caller. Mirrors
 * hr/advances/ApproveAdvanceButton.tsx's pattern exactly. The backend now
 * also rejects the case where the deciding HR actor is the request's own
 * creator (server-enforced; this is UX only).
 *
 * Bug fix (caught after this file first shipped, before merge): the reject
 * dialog originally set maxReasonLength without requireReason --
 * ConfirmDialog's reason textarea only renders at all when requireReason
 * is set (there is no "optional but visible" mode in its API), so the
 * dialog's own description text ("...and the reason below") pointed at a
 * field that never appeared, and reject always sent reason: undefined.
 * Requiring one here is also a reasonable diligence nudge regardless --
 * the backend's own z.string().max(500).optional() stays unchanged.
 *
 * GAP-HR-OVERTIME-01 (rescan): approving a request someone else had already
 * decided used to surface the generic "could not find this object" copy and
 * leave the stale Pending row on screen. A 404/409 from the decide routes
 * (they pre-check status=pending) now means "already decided": say so in
 * plain words and refresh the list. The routes answer 202 because the write
 * is applied asynchronously, so a success is announced as "recorded, being
 * applied" rather than "done". The announcement goes through the global
 * toast when one is mounted (the decided row unmounts on refresh, taking any
 * row-local message with it) and falls back to a local role=status line.
 */
import { useState } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { Button, ConfirmDialog, useToastOptional } from "../../../_components/ds";
import { useFormError } from "@/lib/useFormError";

export function OvertimeActions({ id }: { id: string }) {
  const t = useTranslations("overtime");
  const tAction = useTranslations("action");
  const router = useRouter();
  const dsToast = useToastOptional();
  const [dialog, setDialog] = useState<"approve" | "reject" | null>(null);
  const [busy, setBusy] = useState(false);
  const formError = useFormError("overtime decision");
  const [error, setError] = useState<string | undefined>(undefined);
  const [notice, setNotice] = useState("");

  function announce(message: string, kind: "success" | "info") {
    if (dsToast) {
      dsToast.toast[kind](message);
      setNotice("");
    } else {
      setNotice(message);
    }
  }

  async function decide(action: "approve" | "reject", reason?: string) {
    setBusy(true);
    setError(undefined);
    try {
      const res = await fetch(`/api/proxy/v1/hrms/overtime-requests/${id}/${action}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(action === "reject" ? { reason } : {}),
      });
      if (res.status === 404 || res.status === 409) {
        // Decided by someone else (or removed) since this list was loaded.
        setDialog(null);
        announce(t("alreadyDecided"), "info");
        router.refresh();
        return;
      }
      if (!res.ok) {
        const resolved = await formError.fromResponse(res, "save");
        setError(resolved.message);
        return;
      }
      setDialog(null);
      announce(t("decisionQueued"), "success");
      router.refresh();
    } catch (caught) {
      setError(formError.fromException("save", caught).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
      <Button size="sm" variant="primary" onClick={() => { setDialog("approve"); setError(undefined); }}>
        {t("actionApprove")}
      </Button>
      <Button size="sm" variant="ghost" onClick={() => { setDialog("reject"); setError(undefined); }}>
        {t("actionReject")}
      </Button>
      {notice && <span role="status" style={{ fontSize: 12, color: "var(--mut)" }}>{notice}</span>}

      <ConfirmDialog
        open={dialog === "approve"}
        title={t("approveTitle")}
        description={t("approveDescription")}
        confirmLabel={t("actionApprove")}
        cancelLabel={tAction("cancel")}
        busy={busy}
        errorMessage={error}
        onConfirm={() => decide("approve")}
        onCancel={() => setDialog(null)}
      />
      <ConfirmDialog
        open={dialog === "reject"}
        title={t("rejectTitle")}
        description={t("rejectDescription")}
        confirmLabel={t("actionReject")}
        cancelLabel={tAction("cancel")}
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
