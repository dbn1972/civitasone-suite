"use client";

import { userFacingErrorFromResponse } from "@/lib/api/userFacingFromResponse";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { ActionButton } from "@/app/_components/ds";

/**
 * Client-side lifecycle actions for a governed document.
 *
 * - Maker-checker: Approve/Publish are disabled when the current user is the author.
 * - Reject (withdraw back to draft) requires a reason.
 * - Publish lets the user choose review cycle months.
 * - Acknowledge shows "already acknowledged" when applicable.
 *
 * Server enforcement remains the authority for all transitions.
 */
export function PolicyActions({
  policyId,
  status,
  authorId,
  currentUserId,
  alreadyAcknowledged,
  isAdmin,
}: {
  policyId: string;
  status: string;
  authorId: string;
  currentUserId: string | null;
  alreadyAcknowledged: boolean;
  isAdmin: boolean;
}) {
  const router = useRouter();
  const [msg, setMsg] = useState("");
  const [reviewMonths, setReviewMonths] = useState(12);

  async function post(path: string, body?: Record<string, unknown>): Promise<void> {
    const res = await fetch(`/api/proxy/v1/knowledge/policies/${policyId}/${path}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body ?? {}),
    });
    if (!res.ok) throw await userFacingErrorFromResponse(res, "save");
    router.refresh();
  }

  const canSubmit = status === "draft";
  const canApprove = status === "under_review";
  const canPublish = status === "approved";
  const canAcknowledge = status === "published";

  // GAP-KNOWLEDGE-POLICIES-DETAIL-02: maker-checker UI hint
  const isAuthor = currentUserId != null && currentUserId === authorId;

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
          <>
            <ActionButton
              label="Approve"
              confirmTitle="Approve this document?"
              confirmDescription={
                isAuthor
                  ? "You are the author and cannot approve your own document (maker-checker)."
                  : "Maker-checker: only a different person from the author may approve. Approval moves the document to the publish stage."
              }
              disabled={isAuthor}
              onConfirm={async () => { await post("approve"); setMsg("Approved."); }}
            />
            {/* GAP-KNOWLEDGE-POLICIES-DETAIL-04: Reject / return to draft */}
            {isAdmin && (
              <ActionButton
                label="Return for changes"
                confirmTitle="Return this document for changes?"
                confirmDescription="The document returns to draft status. The author will be notified."
                danger
                requireReason
                minReasonLength={10}
                reasonLabel="Reason for returning"
                onConfirm={async (reason) => { await post("reject", { reason }); setMsg("Returned to author."); }}
              />
            )}
          </>
        )}
        {canPublish && (
          <>
            {/* GAP-KNOWLEDGE-POLICIES-DETAIL-03: configurable review cycle */}
            <label htmlFor="reviewMonths" style={{ fontSize: 13, color: "var(--ink2)" }}>
              Review cycle
              <select
                id="reviewMonths"
                value={reviewMonths}
                onChange={(e) => setReviewMonths(Number(e.target.value))}
                className="inp"
                style={{ marginLeft: 8, minHeight: 36, width: 100 }}
              >
                <option value={6}>6 months</option>
                <option value={12}>12 months</option>
                <option value={24}>24 months</option>
                <option value={36}>36 months</option>
              </select>
            </label>
            <ActionButton
              label="Publish"
              confirmTitle="Publish this document?"
              confirmDescription={
                isAuthor
                  ? "You are the author and cannot publish your own document (maker-checker)."
                  : `Publishing sets the effective date to today, schedules review in ${reviewMonths} months, and opens acknowledgement tracking.`
              }
              disabled={isAuthor}
              onConfirm={async () => {
                await post("publish", { reviewMonths });
                setMsg("Published.");
              }}
            />
          </>
        )}
        {/* GAP-KNOWLEDGE-POLICIES-DETAIL-05: already-acked state */}
        {canAcknowledge && !alreadyAcknowledged && (
          <ActionButton
            label="I have read & understood"
            confirmTitle="Acknowledge this document?"
            confirmDescription="Records that you have read and understood this document."
            onConfirm={async () => { await post("acknowledge", { note: "Read and understood" }); setMsg("Acknowledgement recorded."); }}
          />
        )}
        {canAcknowledge && alreadyAcknowledged && (
          <span style={{ color: "var(--ok, #059669)", fontSize: 14, fontWeight: 600 }}>
            ✓ You have acknowledged this document.
          </span>
        )}
        {!canSubmit && !canApprove && !canPublish && !canAcknowledge && (
          <span style={{ color: "var(--mut)", fontSize: 14 }}>No further actions for status &ldquo;{status.replace(/_/g, " ")}&rdquo;.</span>
        )}
        {msg && <span style={{ color: "var(--ok, #059669)", fontSize: 14, fontWeight: 600 }}>{msg}</span>}
      </div>
    </div>
  );
}
