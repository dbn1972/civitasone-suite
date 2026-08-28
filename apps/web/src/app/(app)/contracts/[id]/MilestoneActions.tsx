"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { ActionButton } from "../../../_components/ds";

export type ContractMilestone = {
  id: string;
  title: string;
  status: string;
  dueDate?: string;
};

type Props = { contractId: string; milestones: ContractMilestone[] };

export function MilestoneActions({ contractId, milestones }: Props) {
  const router = useRouter();
  // Shared per-milestone busy flag (not just each ActionButton's own internal
  // busy state) so the *sibling* action for the same milestone is also
  // disabled while one is in flight -- Complete and Mark late are mutually
  // exclusive outcomes for the same row.
  const [busyId, setBusyId] = useState<string | null>(null);
  const [message, setMessage] = useState("");

  const actionable = milestones.filter(
    (m) => m.status !== "completed" && m.status !== "completed_late",
  );

  // Both outcomes are TERMINAL -- the consumer refuses to re-apply either
  // command once a milestone is completed/completed_late (see
  // contracts/consumer.ts), and "late" additionally computes a real SLA
  // penalty that reduces what's payable to the vendor. Neither should fire
  // from a single unconfirmed click. A thrown error here is caught by
  // ActionButton's own useConfirmAction and shown inside the still-open
  // confirm dialog, in context, rather than in a banner below the list.
  async function act(milestoneId: string, kind: "complete" | "late", notes?: string) {
    setBusyId(milestoneId);
    try {
      const today = new Date().toISOString().slice(0, 10);
      const res = await fetch(
        `/api/proxy/v1/contract/contracts/${contractId}/milestones/${milestoneId}/${kind}`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(
            kind === "late"
              ? { achievedDate: today, notes: notes?.trim() || "Marked late from contract detail" }
              : { achievedDate: today },
          ),
        },
      );
      if (res.status !== 202 && !res.ok) {
        throw new Error((await res.text()) || "Request failed");
      }
      setMessage(kind === "late" ? "Late milestone accepted (queued)." : "Milestone completion accepted (queued).");
      router.refresh();
    } finally {
      setBusyId(null);
    }
  }

  if (actionable.length === 0 && !message) return null;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
      {actionable.map((m) => (
        <div key={m.id} style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
          <span style={{ fontSize: 13, flex: 1 }}>{m.title}</span>
          <ActionButton
            className="btn ghost"
            label="Complete"
            disabled={busyId === m.id}
            confirmTitle={`Mark "${m.title}" complete?`}
            confirmDescription="Records this milestone as delivered on time. This cannot be undone."
            confirmLabel="Yes, mark complete"
            onConfirm={() => act(m.id, "complete")}
          />
          <ActionButton
            className="btn ghost"
            label="Mark late"
            disabled={busyId === m.id}
            confirmTitle={`Mark "${m.title}" as delivered late?`}
            confirmDescription="Applies the contract's SLA delay penalty and reduces the net payable amount. This cannot be undone."
            confirmLabel="Yes, mark late"
            danger
            requireReason
            reasonLabel="Reason for the delay (recorded on the milestone)"
            onConfirm={(notes) => act(m.id, "late", notes)}
          />
        </div>
      ))}
      {message ? (
        <p role="status" aria-live="polite" style={{ fontSize: 13, color: "var(--good)", margin: 0 }}>
          {message}
        </p>
      ) : null}
    </div>
  );
}
