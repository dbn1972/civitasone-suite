"use client";

/**
 * GAP-FINANCE-VENDORS-01 / -DETAIL-04: approve or reject a PENDING vendor from its detail page.
 * POST /v1/finance/vendors/:id/approve | /reject. finance-service enforces maker != checker (the
 * user who created the vendor cannot approve it) and the pending-only guard race-safely; this only
 * avoids offering Approve to the creator and shows the server's plain-language refusal otherwise.
 * The decision is bound to the vendor `version` the checker is looking at (a vendor edited since is a 409), and a
 * 202 means "queued": the page re-reads until the decision lands.
 */
import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { ActionButton } from "@/app/_components/ds";
import { browserFetch } from "@/lib/api/browserClient";
import { workflowErrorMessage } from "@/lib/finance/workflowErrors";
import { useSettledRefresh } from "@/lib/finance/useSettledRefresh";

export function VendorApprovalActions({ id, name, createdByMe, version }: { id: string; name: string; createdByMe: boolean; version: number }) {
  const t = useTranslations("financeVendorApproval");
  const te = useTranslations("financeWorkflowErrors");
  const router = useRouter();
  const settle = useSettledRefresh(router);
  const [note, setNote] = useState<string | null>(null);
  const idemKey = useRef(globalThis.crypto.randomUUID());

  async function decide(decision: "approve" | "reject", reason?: string) {
    const res = await browserFetch(`v1/finance/vendors/${id}/${decision}`, {
      method: "POST",
      headers: { "x-idempotency-key": idemKey.current },
      body: JSON.stringify({ version, ...(reason ? { reason } : {}) }),
    });
    if (!res.ok) {
      idemKey.current = globalThis.crypto.randomUUID();
      throw new Error(await workflowErrorMessage(res, (k) => te(k), "save", "vendor"));
    }
  }

  return (
    <>
      {createdByMe ? <span role="note" style={{ fontSize: 12, color: "var(--mut)" }}>{t("cannotApproveOwn")}</span> : (
        <ActionButton
          label={t("approveLabel")}
          className="btn primary"
          confirmTitle={t("approveTitle", { name })}
          confirmDescription={t("approveDescription")}
          confirmLabel={t("approveConfirm")}
          onConfirm={() => decide("approve")}
          onSuccess={() => { setNote(t("approvalSubmitted")); settle(); }}
        />
      )}
      <ActionButton
        label={t("rejectLabel")}
        className="btn ghost"
        danger
        confirmTitle={t("rejectTitle", { name })}
        confirmDescription={t("rejectDescription")}
        confirmLabel={t("rejectConfirm")}
        requireReason
        reasonLabel={t("reasonLabel")}
        minReasonLength={5}
        maxReasonLength={500}
        onConfirm={(reason) => decide("reject", reason)}
        onSuccess={() => { setNote(t("rejectionSubmitted")); settle(); }}
      />
      {note ? <span role="status" style={{ fontSize: 12 }}>{note}</span> : null}
    </>
  );
}
