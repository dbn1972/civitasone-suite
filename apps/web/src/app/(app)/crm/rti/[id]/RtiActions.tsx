"use client";

import { useRouter } from "next/navigation";
import { ActionButton } from "../../../../_components/ds";
import { toHumanError } from "@/lib/messages";

/**
 * Plain-language failure message for a failed RTI lifecycle action. `patch`
 * is a plain async helper, not a component or hook, so it can't call the
 * useFormError hook; toHumanError is the same catalogued-message building
 * block that hook is built on -- never the backend's own message/error text
 * or the raw HTTP status. See docs/ENTERPRISE-GAP-REPORT-2026-09-07.md UX-003/UX-016.
 */
function rtiActionError(): string {
  const human = toHumanError("save", { area: "RTI request" });
  return `${human.what} ${human.next}`;
}

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
      throw new Error(rtiActionError());
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
