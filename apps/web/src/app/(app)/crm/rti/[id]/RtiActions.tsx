"use client";

import { useRouter } from "next/navigation";
import { ActionButton } from "../../../../_components/ds";

/**
 * RTI Act 2005 lifecycle actions.
 *
 * Status vocabulary (backend `RTI_STATUS`, services/crm-service rti-repo.ts):
 *   RECEIVED       initial
 *   TRANSFERRED    forwarded to another department (s.6(3))
 *   RESPONDED      CPIO has responded within the 30-day statutory window
 *   REJECTED       request rejected
 *   FIRST_APPEAL   applicant has raised a first appeal (s.19)
 *   SECOND_APPEAL  escalated to the Information Commission
 *   DISPOSED       terminal
 *
 * Available actions (per services/crm-service/src/modules/rti/rti-route.ts):
 *   Forward       PATCH /forward       { departmentRef }   TRANSFERRED
 *   Respond       PATCH /respond       { responseText }    RESPONDED
 *   First Appeal  PATCH /first-appeal  (RESPONDED/REJECTED only) FIRST_APPEAL
 *
 * There is no backend route yet for second appeal or final disposal, so those
 * statuses (and FIRST_APPEAL/SECOND_APPEAL/DISPOSED) are read-only here.
 */
export function RtiActions({ id, status }: { id: string; status: string }) {
  const router = useRouter();

  const canProgress = status === "RECEIVED" || status === "TRANSFERRED";
  const canAppeal = status === "RESPONDED" || status === "REJECTED";

  async function patch(action: string, payload?: Record<string, unknown>) {
    const res = await fetch(`/api/proxy/v1/crm/rti/${id}/${action}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      ...(payload ? { body: JSON.stringify(payload) } : {}),
    });
    if (!res.ok) {
      const json = await res.json().catch(() => ({}));
      const msg = (json as { message?: string }).message;
      throw new Error(msg ?? `Could not ${action} this RTI request (HTTP ${res.status})`);
    }
    router.refresh();
  }

  if (!canProgress && !canAppeal) {
    return (
      <span style={{ fontSize: 13, color: "var(--ink2)" }}>
        This RTI request is {status.replace(/_/g, " ").toLowerCase()} — no further action available here.
      </span>
    );
  }

  return (
    <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
      {canProgress && (
        <>
          {/* Forward to another department — s.6(3) transfer */}
          <ActionButton
            label="Forward"
            confirmTitle="Forward this RTI request?"
            confirmDescription="Transfers the request to another department under s.6(3) of the RTI Act. The statutory response clock does not reset."
            requireReason
            reasonLabel="Department / Office"
            onConfirm={(dept) => patch("forward", { departmentRef: dept })}
          />

          {/* Respond within the 30-day statutory deadline */}
          <ActionButton
            label="Respond"
            className="primary"
            confirmTitle="Record the response to this RTI request?"
            confirmDescription="Records the CPIO's response to the applicant. Make sure this is submitted within the 30-day statutory deadline."
            requireReason
            reasonLabel="Response text"
            onConfirm={(text) => patch("respond", { responseText: text })}
          />
        </>
      )}

      {canAppeal && (
        <ActionButton
          label="First Appeal"
          confirmTitle="Raise a first appeal?"
          confirmDescription="Escalates this request to first appeal under s.19 of the RTI Act. Only trigger this on the applicant's behalf."
          onConfirm={() => patch("first-appeal")}
        />
      )}
    </div>
  );
}
