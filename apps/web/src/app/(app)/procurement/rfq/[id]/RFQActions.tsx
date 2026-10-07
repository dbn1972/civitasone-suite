"use client";

import { useRouter } from "next/navigation";
import { ActionButton, useToast } from "@/app/_components/ds";
import { useSessionIdentity } from "@/lib/auth/useSessionIdentity";
import { userFacingErrorFromResponse } from "@/lib/api/userFacingFromResponse";
import { daysUntilIST } from "@/lib/formatters";

const PROC_ROLES = ["procurement_officer", "procurement_admin", "super_admin"];

/**
 * GAP-PROCUREMENT-RFQ-DETAIL-01: the RFQ detail route used to be a dead end —
 * quotes could be collected but nothing could close the RFQ or award it, even
 * though the list already counted "Awarded" RFQs. The close/award lifecycle
 * now exists server-side (procurement-service rfq/routes.ts: POST
 * .../close and .../award, PROC_ROLES-gated, SoD-enforced, audit-emitting).
 * This surfaces it:
 *   - issued  → Close (stop accepting responses).
 *   - closed  → Award (to the officer-selected winning response; a mandatory
 *               justification is recorded as the award decision).
 * Award is only offered once the closing day has passed AND at least one
 * response exists (an RFQ with no bids has nothing to award). Buttons are
 * hidden for users without a procurement write role — DISPLAY ONLY; the
 * server re-checks the role, the state transition and separation-of-duties,
 * so hiding here can never grant anything, only avoid offering a 403.
 */
export function RFQActions({
  rfqId,
  status,
  closingDate,
  responseCount,
  awardCandidate,
  createdBy,
}: {
  rfqId: string;
  status: string;
  closingDate: string;
  responseCount: number;
  /** The response the officer would award (lowest/L1); null when none/sealed. */
  awardCandidate: { responseId: string; vendorName: string } | null;
  createdBy?: string | null;
}) {
  const router = useRouter();
  const { roles, userId, loaded } = useSessionIdentity();
  const { toast } = useToast();

  const canWrite = loaded && roles.some((r) => PROC_ROLES.includes(r));
  if (!canWrite) return null;

  async function close(): Promise<void> {
    const res = await fetch(`/api/proxy/v1/procurement/rfqs/${rfqId}/close`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "{}",
    });
    if (!res.ok) throw await userFacingErrorFromResponse(res, "save");
  }

  async function award(reason?: string): Promise<void> {
    if (!awardCandidate) throw new Error("No awardable response.");
    const res = await fetch(`/api/proxy/v1/procurement/rfqs/${rfqId}/award`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ responseId: awardCandidate.responseId, justification: reason ?? "" }),
    });
    if (!res.ok) throw await userFacingErrorFromResponse(res, "save");
  }

  if (status === "issued") {
    return (
      <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
        <ActionButton
          label="Close RFQ"
          confirmTitle="Close this RFQ?"
          confirmDescription="No further vendor responses will be accepted after closing. The RFQ can then be awarded to one of the quotes received."
          confirmLabel="Close RFQ"
          onConfirm={close}
          onSuccess={() => {
            toast.info("Close request accepted; status will update shortly.");
            router.refresh();
          }}
        />
      </div>
    );
  }

  if (status === "closed") {
    const closingPassed = (daysUntilIST(closingDate) ?? 1) <= 0;
    // Maker-checker: never offer Award to the RFQ's own creator (server also
    // rejects self-award with 403 SoD).
    const isCreator = loaded && !!userId && !!createdBy && userId === createdBy;
    if (!closingPassed || responseCount === 0 || !awardCandidate) {
      return (
        <p style={{ fontSize: 12, color: "var(--mut)", margin: 0 }}>
          {responseCount === 0
            ? "No responses were received, so there is nothing to award."
            : !closingPassed
              ? "Award becomes available after the closing date."
              : "Award is unavailable while bid amounts are sealed."}
        </p>
      );
    }
    if (isCreator) {
      return (
        <p style={{ fontSize: 12, color: "var(--mut)", margin: 0 }}>
          You issued this RFQ, so it must be awarded by a different officer.
        </p>
      );
    }
    return (
      <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
        <ActionButton
          label={`Award to ${awardCandidate.vendorName} (L1)`}
          confirmTitle="Award this RFQ?"
          confirmDescription="This awards the RFQ to the lowest responsive quote (L1) and rejects the others. A written justification is mandatory and recorded in the audit trail. This cannot be undone."
          confirmLabel="Award"
          requireReason
          reasonLabel="Award justification (required)"
          onConfirm={award}
          onSuccess={() => {
            toast.info("Award request accepted; status will update shortly.");
            router.refresh();
          }}
        />
      </div>
    );
  }

  return null;
}
