"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { ActionButton } from "@/app/_components/ds";

/**
 * Client-side lifecycle actions for a governed document.
 *
 * Publishing is maker-checker gated server-side (the approver/publisher must
 * differ from the author) and is irreversible for the effective date, so it is
 * gated behind a ConfirmDialog. Acknowledgement records "read & understood" for
 * the current employee. All calls go through the auth-cookie proxy.
 */
export function PolicyActions({ policyId, status }: { policyId: string; status: string }) {
  const router = useRouter();
  const [msg, setMsg] = useState("");

  async function post(path: string, body?: Record<string, unknown>): Promise<void> {
    const res = await fetch(`/api/proxy/v1/knowledge/policies/${policyId}/${path}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body ?? {}),
    });
    if (!res.ok) throw new Error((await res.text()) || `Failed to ${path}.`);
    router.refresh();
  }

  const canSubmit = status === "draft";
  const canApprove = status === "under_review";
  const canPublish = status === "approved";
  const canAcknowledge = status === "published";

  return (
    <div className="card">
      <div className="card-h"><h3>Lifecycle actions</h3></div>
      <div className="pad" style={{ display: "flex", flexWrap: "wrap", gap: 10, alignItems: "center" }}>
        {canSubmit && (
          <ActionButton
            label="Submit for review"
            confirmTitle="Submit for review?"
            confirmDescription="Moves the draft into the review queue."
            onConfirm={async () => { await post("submit"); setMsg("Submitted for review."); }}
          />
        )}
        {canApprove && (
          <ActionButton
            label="Approve"
            confirmTitle="Approve this document?"
            confirmDescription="Maker-checker: you must not be the author. Approval moves the document to the publish stage."
            onConfirm={async () => { await post("approve"); setMsg("Approved."); }}
          />
        )}
        {canPublish && (
          <ActionButton
            label="Publish"
            confirmTitle="Publish this document?"
            confirmDescription="Publishing sets the effective date, notifies affected users and opens acknowledgement tracking."
            onConfirm={async () => { await post("publish", { reviewMonths: 12 }); setMsg("Published."); }}
          />
        )}
        {canAcknowledge && (
          <ActionButton
            label="I have read & understood"
            confirmTitle="Acknowledge this document?"
            confirmDescription="Records that you have read and understood this document."
            onConfirm={async () => { await post("acknowledge", { note: "Read and understood" }); setMsg("Acknowledgement recorded."); }}
          />
        )}
        {!canSubmit && !canApprove && !canPublish && !canAcknowledge && (
          <span style={{ color: "var(--ink3, #94a3b8)", fontSize: 14 }}>No further actions for status “{status.replace(/_/g, " ")}”.</span>
        )}
        {msg && <span style={{ color: "var(--ok, #059669)", fontSize: 14, fontWeight: 600 }}>{msg}</span>}
      </div>
    </div>
  );
}
