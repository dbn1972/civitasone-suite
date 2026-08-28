"use client";

import { useRouter } from "next/navigation";
import { ActionButton } from "../../../../_components/ds";

/**
 * Service request lifecycle actions.
 *
 * The service exposes PATCH /v1/crm/service-requests/:id/status but nothing in
 * the UI called it, so a request could be raised and then never progressed.
 * Each transition is a single decision taken inline; the reason captured by
 * ConfirmDialog is stored as the resolution note.
 */
export function ServiceRequestActions({ id, status }: { id: string; status: string }) {
  const router = useRouter();

  const terminal = status === "closed" || status === "cancelled";

  async function setStatus(next: string, resolution?: string) {
    const res = await fetch(`/api/proxy/v1/crm/service-requests/${id}/status`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status: next, ...(resolution ? { resolution } : {}) }),
    });
    if (!res.ok) {
      const json = await res.json().catch(() => ({}));
      throw new Error((json as { message?: string }).message ?? `Could not update status (HTTP ${res.status})`);
    }
    router.refresh();
  }

  if (terminal) {
    return (
      <span style={{ fontSize: 13, color: "var(--ink2)" }}>
        This request is {status} — no further action available.
      </span>
    );
  }

  return (
    <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
      {status === "open" && (
        <ActionButton
          label="Start work"
          confirmTitle="Move to in progress?"
          confirmDescription="Marks this request as being actively worked on."
          onConfirm={() => setStatus("in_progress")}
        />
      )}
      {status !== "pending" && status !== "resolved" && (
        <ActionButton
          label="Mark pending"
          confirmTitle="Mark this request pending?"
          confirmDescription="Use this when the request is waiting on the citizen or another department."
          requireReason
          reasonLabel="What is it waiting on?"
          onConfirm={(reason) => setStatus("pending", reason)}
        />
      )}
      {status !== "resolved" && (
        <ActionButton
          label="Resolve"
          className="primary"
          confirmTitle="Resolve this request?"
          confirmDescription="Record how the request was fulfilled. The citizen is notified."
          requireReason
          reasonLabel="Resolution"
          onConfirm={(reason) => setStatus("resolved", reason)}
        />
      )}
      <ActionButton
        label="Close"
        danger
        confirmTitle="Close this request?"
        confirmDescription="Closing is final — the request can no longer be actioned."
        requireReason
        reasonLabel="Closing remarks"
        onConfirm={(reason) => setStatus("closed", reason)}
      />
    </div>
  );
}
