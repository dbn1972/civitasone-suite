"use client";

import { useRouter } from "next/navigation";
import { ActionButton } from "../../../../_components/ds";

/**
 * Grievance lifecycle actions — CPGRAMS-aligned.
 *
 * Status vocabulary (post-0082 migration):
 *   REGISTERED  initial
 *   FORWARDED   assigned to department
 *   ATTENDED    being worked on
 *   DISPOSED    resolved or administratively closed (terminal)
 *   APPEAL      citizen first appeal (urgent priority)
 *
 * Available actions:
 *   Forward      PATCH /forward       { forwardedTo }   FORWARDED
 *   First Appeal PATCH /first-appeal  { appealReason }  APPEAL
 *   Resolve      PATCH /resolve       { resolution }    DISPOSED
 *   Close        PATCH /close         (admin only)      DISPOSED
 *
 * The legacy /escalate alias remains on the backend for backward compatibility.
 * The UI uses /first-appeal to match CPGRAMS portal terminology.
 */
export function GrievanceActions({ id, status }: { id: string; status: string }) {
  const router = useRouter();

  // DISPOSED is the only terminal state in CPGRAMS (covers both resolved + closed)
  const terminal = status === "DISPOSED";
  const disposed = status === "DISPOSED";

  async function patch(action: string, payload?: Record<string, unknown>) {
    const res = await fetch(`/api/proxy/v1/crm/grievances/${id}/${action}`, {
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
        This grievance is disposed — no further action available.
      </span>
    );
  }

  return (
    <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
      {/* Forward to department — CPGRAMS portal: forward to competent authority */}
      <ActionButton
        label="Forward"
        confirmTitle="Forward this grievance?"
        confirmDescription="Enter the department or office to which this grievance is being forwarded."
        requireReason
        reasonLabel="Department / Office"
        onConfirm={(dept) => patch("forward", { forwardedTo: dept })}
      />

      {/* First Appeal — citizen-initiated; bumps priority to urgent */}
      <ActionButton
        label="First Appeal"
        confirmTitle="File a first appeal?"
        confirmDescription="Record the citizen reason for appeal. The grievance is escalated to urgent priority."
        requireReason
        reasonLabel="Reason for appeal"
        onConfirm={(reason) => patch("first-appeal", { ...(reason ? { appealReason: reason } : {}) })}
      />

      {!disposed && (
        <ActionButton
          label="Resolve"
          className="primary"
          confirmTitle="Resolve this grievance?"
          confirmDescription="Record how the grievance was resolved. Status moves to DISPOSED in the CPGRAMS portal."
          requireReason
          reasonLabel="Resolution"
          onConfirm={(reason) => patch("resolve", { resolution: reason })}
        />
      )}

      <ActionButton
        label="Close"
        danger
        confirmTitle="Close this grievance?"
        confirmDescription="Administrative closure — grievance is marked DISPOSED. Requires administrator rights."
        onConfirm={() => patch("close")}
      />
    </div>
  );
}
