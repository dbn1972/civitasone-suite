"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

export type ContractMilestone = {
  id: string;
  title: string;
  status: string;
  dueDate?: string;
};

type Props = { contractId: string; milestones: ContractMilestone[] };

export function MilestoneActions({ contractId, milestones }: Props) {
  const router = useRouter();
  const [busyId, setBusyId] = useState<string | null>(null);
  const [message, setMessage] = useState("");
  const [error, setError] = useState<string | undefined>();

  const actionable = milestones.filter(
    (m) => m.status !== "completed" && m.status !== "completed_late",
  );

  async function act(milestoneId: string, kind: "complete" | "late") {
    setBusyId(milestoneId);
    setError(undefined);
    setMessage("");
    try {
      const today = new Date().toISOString().slice(0, 10);
      const res = await fetch(
        `/api/proxy/v1/contract/contracts/${contractId}/milestones/${milestoneId}/${kind}`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(
            kind === "late"
              ? { achievedDate: today, notes: "Marked late from contract detail" }
              : { achievedDate: today },
          ),
        },
      );
      if (res.status !== 202 && !res.ok) {
        throw new Error((await res.text()) || "Request failed");
      }
      setMessage(kind === "late" ? "Late milestone accepted (queued)." : "Milestone completion accepted (queued).");
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Milestone update failed");
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
          <button
            type="button"
            className="btn ghost"
            disabled={busyId === m.id}
            onClick={() => void act(m.id, "complete")}
          >
            Complete
          </button>
          <button
            type="button"
            className="btn ghost"
            disabled={busyId === m.id}
            onClick={() => void act(m.id, "late")}
          >
            Mark late
          </button>
        </div>
      ))}
      {message ? (
        <p role="status" aria-live="polite" style={{ fontSize: 13, color: "var(--good)", margin: 0 }}>
          {message}
        </p>
      ) : null}
      {error ? (
        <p role="alert" style={{ fontSize: 13, color: "var(--bad)", margin: 0 }}>
          {error}
        </p>
      ) : null}
    </div>
  );
}
