"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { ConfirmDialog } from "@/app/_components/ds";

type Milestone = { id: string; title: string; status: string };

type Props = { projectId: string; milestones: Milestone[] };

export function ProjectDetailActions({ projectId, milestones }: Props) {
  const router = useRouter();
  const [target, setTarget] = useState<Milestone | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | undefined>(undefined);
  const [message, setMessage] = useState("");

  const pending = milestones.filter((m) => m.status === "pending");

  async function confirmComplete(reason?: string) {
    if (!target) return;
    setBusy(true);
    setError(undefined);
    try {
      const res = await fetch(
        `/api/proxy/v1/projects/${projectId}/milestones/${target.id}/complete`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ reason }),
        },
      );
      if (!res.ok) throw new Error((await res.text()) || "Request failed");
      setMessage(`Milestone “${target.title}” marked complete.`);
      setTarget(null);
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to complete milestone.");
    } finally {
      setBusy(false);
    }
  }

  function cancel() {
    if (busy) return;
    setTarget(null);
    setError(undefined);
  }

  if (pending.length === 0) {
    return message ? (
      <p role="status" aria-live="polite" style={{ fontSize: 13, color: "#047857", margin: 0 }}>
        {message}
      </p>
    ) : null;
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
      {pending.map((m) => (
        <button
          key={m.id}
          type="button"
          className="btn ghost"
          onClick={() => {
            setError(undefined);
            setMessage("");
            setTarget(m);
          }}
        >
          Complete: {m.title}
        </button>
      ))}
      {message ? (
        <p role="status" aria-live="polite" style={{ fontSize: 13, color: "#047857", margin: 0 }}>
          {message}
        </p>
      ) : null}

      <ConfirmDialog
        open={target !== null}
        title="Mark milestone as complete?"
        danger
        description={
          <>
            <p style={{ margin: "0 0 8px" }}>
              You are about to mark{" "}
              <strong>{target?.title ?? "this milestone"}</strong> as complete.
            </p>
            <p style={{ margin: 0 }}>
              This is a maker-checker action that <strong>triggers a fund release</strong> against
              the project and cannot be undone. A reason is recorded on the audit trail.
            </p>
          </>
        }
        confirmLabel="Confirm completion"
        requireReason
        reasonLabel="Reason for completion (recorded for audit)"
        busy={busy}
        errorMessage={error}
        onConfirm={(reason) => void confirmComplete(reason)}
        onCancel={cancel}
      />
    </div>
  );
}
