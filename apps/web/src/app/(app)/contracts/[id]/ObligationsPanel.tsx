"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

export type ContractObligation = {
  id: string;
  title: string;
  description?: string;
  dueDate?: string;
  status: string;
  ownerId?: string;
  version?: number;
};

type Props = { contractId: string; obligations: ContractObligation[] };

const STATUS_LABEL: Record<string, string> = {
  pending: "Pending",
  in_progress: "In progress",
  completed: "Completed",
  overdue: "Overdue",
};

export function ObligationsPanel({ contractId, obligations }: Props) {
  const router = useRouter();
  const [busyId, setBusyId] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState<string | undefined>();
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [dueDate, setDueDate] = useState("");
  const [ownerId, setOwnerId] = useState("");

  async function createObligation() {
    setCreating(true);
    setError(undefined);
    setMessage("");
    try {
      if (!title.trim()) throw new Error("Title is required");
      if (!dueDate) throw new Error("Due date is required");
      if (!ownerId.trim()) throw new Error("Owner is required");

      const res = await fetch("/api/proxy/v1/contract/obligations", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contractId,
          title: title.trim(),
          description: description.trim(),
          dueDate,
          ownerId: ownerId.trim(),
        }),
      });
      if (res.status !== 202 && !res.ok) {
        throw new Error((await res.text()) || "Create obligation failed");
      }
      setMessage("Obligation creation accepted (queued).");
      setTitle("");
      setDescription("");
      setDueDate("");
      setOwnerId("");
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Create obligation failed");
    } finally {
      setCreating(false);
    }
  }

  async function advanceStatus(obligationId: string, currentStatus: string, nextStatus: string, version: number) {
    setBusyId(obligationId);
    setError(undefined);
    setMessage("");
    try {
      const res = await fetch(`/api/proxy/v1/contract/obligations/${obligationId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: nextStatus, version }),
      });
      if (res.status !== 202 && !res.ok) {
        throw new Error((await res.text()) || "Update obligation failed");
      }
      setMessage(`Obligation status update to "${STATUS_LABEL[nextStatus] ?? nextStatus}" accepted (queued).`);
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Update obligation failed");
    } finally {
      setBusyId(null);
    }
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      {obligations.length === 0 ? (
        <p style={{ margin: 0, fontSize: 13, color: "var(--ink2)" }}>No obligations on this contract.</p>
      ) : (
        <ul style={{ margin: 0, paddingLeft: 18 }}>
          {obligations.map((o) => (
            <li key={o.id} style={{ marginBottom: 8, fontSize: 13 }}>
              <strong>{o.title}</strong> — <span className="pill mut">{STATUS_LABEL[o.status] ?? o.status}</span>
              {o.dueDate ? <span style={{ color: "var(--ink2)" }}> · due {o.dueDate}</span> : null}
              {o.status !== "completed" ? (
                <>
                  {" "}
                  {o.status === "pending" ? (
                    <button
                      type="button"
                      className="btn ghost"
                      disabled={busyId === o.id}
                      onClick={() => void advanceStatus(o.id, o.status, "in_progress", o.version ?? 1)}
                    >
                      Start
                    </button>
                  ) : null}
                  <button
                    type="button"
                    className="btn ghost"
                    disabled={busyId === o.id}
                    onClick={() => void advanceStatus(o.id, o.status, "completed", o.version ?? 1)}
                  >
                    Mark complete
                  </button>
                </>
              ) : null}
            </li>
          ))}
        </ul>
      )}

      <div style={{ display: "flex", flexWrap: "wrap", gap: 8, alignItems: "end" }}>
        <label style={{ fontSize: 12 }}>
          Title
          <input className="inp" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Submit progress report" />
        </label>
        <label style={{ fontSize: 12 }}>
          Description
          <input className="inp" value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Optional details" />
        </label>
        <label style={{ fontSize: 12 }}>
          Due date
          <input className="inp" type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} />
        </label>
        <label style={{ fontSize: 12 }}>
          Owner (user id)
          <input className="inp" value={ownerId} onChange={(e) => setOwnerId(e.target.value)} placeholder="uuid" />
        </label>
        <button type="button" className="btn" disabled={creating} onClick={() => void createObligation()}>
          Add obligation
        </button>
      </div>

      {message ? (
        <p role="status" aria-live="polite" style={{ fontSize: 13, color: "#047857", margin: 0 }}>
          {message}
        </p>
      ) : null}
      {error ? (
        <p role="alert" style={{ fontSize: 13, color: "#b91c1c", margin: 0 }}>
          {error}
        </p>
      ) : null}
    </div>
  );
}
