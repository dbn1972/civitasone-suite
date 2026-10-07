"use client";

import { useRouter } from "next/navigation";
import { toHumanError } from "@/lib/messages";
import { ActionButton } from "@/app/_components/ds";

// DOM-002 — the real, second-actor inspection step. Deliberately does NOT
// collect or send an inspector id: PATCH /grns/:id/accept and
// /grns/:id/reject derive the inspector from the CALLER's own authenticated
// session (ctx.actorId server-side), so this form only ever expresses "I,
// the current logged-in user, accept/reject this GRN". If the current user
// is the same person who created the GRN, the server rejects with 403
// SOD_VIOLATION.
//
// GAP-PROCUREMENT-GRN-DETAIL-01 — Accept and Reject are irreversible,
// payment-relevant decisions, so each is now gated behind a ConfirmDialog
// (via ActionButton) instead of a one-click Button. Accept's dialog explains
// the three-way match is computed on confirm; Reject requires a reason.
// GAP-PROCUREMENT-GRN-DETAIL-03 — when the viewer created this GRN they
// cannot inspect it (SoD); the actions are disabled up front with an
// explanation rather than only learning after submit.

/**
 * Plain-language failure message for a failed GRN inspection decision. The
 * SOD_VIOLATION code gets a specific, catalogued explanation (not a raw echo)
 * — see docs/ENTERPRISE-GAP-REPORT-2026-09-07.md UX-003/UX-016.
 */
function grnInspectError(): string {
  const human = toHumanError("save", { area: "GRN inspection" });
  return `${human.what} ${human.next}`;
}

async function submitDecision(grnId: string, action: "accept" | "reject", reason?: string): Promise<void> {
  const res = await fetch(`/api/proxy/v1/procurement/grns/${grnId}/${action}`, {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(action === "accept" ? { remarks: reason?.trim() || undefined } : { reason: (reason ?? "").trim() }),
  });
  if (!res.ok) {
    let human = grnInspectError();
    try {
      const text = await res.text();
      const parsed = JSON.parse(text) as { code?: string };
      if (parsed.code === "SOD_VIOLATION") {
        human = "You created this GRN, so you cannot also inspect it — a different officer must accept or reject it.";
      }
    } catch { /* keep the catalogued fallback above */ }
    // Thrown so the ConfirmDialog surfaces the message (incl. the SoD copy)
    // inside the dialog rather than the fetch silently succeeding.
    throw new Error(human);
  }
}

export function InspectGrnForm({ grnId, grnNo, isCreator = false }: { grnId: string; grnNo?: string; isCreator?: boolean }) {
  const router = useRouter();
  const label = grnNo ? `GRN ${grnNo}` : "this GRN";

  if (isCreator) {
    return (
      <div className="card pad">
        <p role="status" style={{ margin: 0, fontSize: "0.875rem", color: "var(--muted, #6b7280)" }}>
          You created {label}, so you cannot also inspect it. Under separation of duties a different
          officer must accept or reject it. The Accept and Reject actions are disabled for you.
        </p>
        <div style={{ marginTop: 16, display: "flex", gap: 8 }}>
          <button type="button" className="btn primary" disabled aria-disabled="true" style={{ minHeight: 44 }}>Accept</button>
          <button type="button" className="btn ghost" disabled aria-disabled="true" style={{ minHeight: 44 }}>Reject</button>
        </div>
      </div>
    );
  }

  return (
    <div className="card pad">
      <p style={{ marginBottom: 12, fontSize: "0.875rem", color: "var(--muted, #6b7280)" }}>
        Inspect the received items and record a decision. You must be a different officer from
        whoever created this GRN.
      </p>
      <div style={{ display: "flex", gap: 8 }}>
        <ActionButton
          label="Accept"
          confirmTitle="Accept this GRN?"
          confirmDescription={
            <>
              Accepting {label} computes the three-way match (PO · receipt · inspection) that gates
              payment. This cannot be undone. Add optional acceptance remarks below.
            </>
          }
          confirmLabel="Accept GRN"
          optionalReason
          reasonLabel="Acceptance remarks (optional)"
          onConfirm={(reason) => submitDecision(grnId, "accept", reason)}
          onSuccess={() => router.refresh()}
        />
        <ActionButton
          label="Reject"
          className="btn danger"
          danger
          confirmTitle="Reject this GRN?"
          confirmDescription={
            <>
              Rejecting {label} records a failed inspection. This cannot be undone. A reason is
              required and will be audited.
            </>
          }
          confirmLabel="Reject GRN"
          requireReason
          minReasonLength={3}
          reasonLabel="Rejection reason (required)"
          onConfirm={(reason) => submitDecision(grnId, "reject", reason)}
          onSuccess={() => router.refresh()}
        />
      </div>
    </div>
  );
}
