"use client";

import { useRouter } from "next/navigation";
import { ActionButton } from "../../../../_components/ds";

/**
 * Grievance lifecycle actions.
 *
 * The detail page previously linked to /assign and /resolve sub-routes that were
 * never built, so both buttons 404'd and the register was effectively read-only
 * despite the service exposing assign, escalate, resolve and close. Actioning a
 * grievance is a single decision, so it is taken inline through ConfirmDialog
 * (which also captures the resolution text) rather than on a separate screen.
 *
 * Assign is deliberately not offered here: it needs `assignedTo` as a user id,
 * which requires an officer picker this module does not yet have. Shipping a
 * button that cannot supply a valid body would just move the 404 to a 400.
 *
 * Close is restricted to crm_admin/super_admin server-side; for a crm_user the
 * API answers 403 and the dialog surfaces that message rather than failing quietly.
 */
export function GrievanceActions({ id, status }: { id: string; status: string }) {
  const router = useRouter();

  const terminal = status === "closed" || status === "cancelled";
  const resolved = status === "resolved";

  /** All four transitions are PATCH — they mutate the existing grievance. */
  async function patch(action: string, payload?: Record<string, unknown>) {
    const res = await fetch(`/api/v1/crm/grievances/${id}/${action}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      ...(payload ? { body: JSON.stringify(payload) } : {}),
    });
    if (!res.ok) {
      const json = await res.json().catch(() => ({}));
      const msg = (json as { message?: string }).message;
      throw new Error(msg ?? `Could not ${action} this grievance (HTTP ${res.status})`);
    }
    router.refresh();
  }

  if (terminal) {
    return (
      <span style={{ fontSize: 13, color: "var(--ink2)" }}>
        This grievance is {status} — no further action available.
      </span>
    );
  }

  return (
    <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
      <ActionButton
        label="Escalate"
        confirmTitle="Escalate this grievance?"
        confirmDescription="Escalation is recorded on the grievance with the time and the reason given."
        requireReason
        reasonLabel="Reason for escalation"
        onConfirm={(reason) => patch("escalate", { ...(reason ? { reason } : {}) })}
      />
      {!resolved && (
        <ActionButton
          label="Resolve"
          className="primary"
          confirmTitle="Resolve this grievance?"
          confirmDescription="Record how the grievance was resolved. This is stored as the resolution."
          requireReason
          reasonLabel="Resolution"
          onConfirm={(reason) => patch("resolve", { resolution: reason })}
        />
      )}
      <ActionButton
        label="Close"
        danger
        confirmTitle="Close this grievance?"
        confirmDescription="Closing is final — the grievance can no longer be escalated or resolved. Requires administrator rights."
        onConfirm={() => patch("close")}
      />
    </div>
  );
}
