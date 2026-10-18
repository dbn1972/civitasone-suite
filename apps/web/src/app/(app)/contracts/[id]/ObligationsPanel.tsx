"use client";

import { userFacingErrorFromResponse } from "@/lib/api/userFacingFromResponse";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { ActionButton, EntityPicker } from "../../../_components/ds";
import { searchIdentityUsers, resolveIdentityUsers } from "@/lib/entityAdapters/identityUser";
import { formatIndianDate } from "@/lib/formatters";

export type ContractObligation = {
  id: string;
  title: string;
  description?: string;
  dueDate?: string;
  status: string;
  ownerId?: string;
  version?: number;
};

// GAP-CONTRACTS-DETAIL-06: intervals for post-202 polling.
const POLL_DELAYS = [5_000, 10_000];

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
  // GAP-CONTRACTS-DETAIL-06: pending obligation writes (id -> prevStatus).
  const [pendingMap, setPendingMap] = useState<Map<string, string>>(new Map());
  const pollTimers = useRef<ReturnType<typeof setTimeout>[]>([]);
  const [error, setError] = useState<string | undefined>();
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [dueDate, setDueDate] = useState("");
  const [ownerId, setOwnerId] = useState("");

  // Clear pending entries when props update (server re-render caught up).
  useEffect(() => {
    setPendingMap((prev) => {
      if (prev.size === 0) return prev;
      const next = new Map(prev);
      let changed = false;
      for (const [id, prevStatus] of next) {
        const current = obligations.find((o) => o.id === id);
        if (!current || current.status !== prevStatus) { next.delete(id); changed = true; }
      }
      return changed ? next : prev;
    });
  }, [obligations]);
  useEffect(() => {
    const timers = pollTimers.current;
    return () => { for (const t of timers) clearTimeout(t); };
  }, []);

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
        throw await userFacingErrorFromResponse(res, "save");
      }
      setMessage("Obligation creation received — it will appear shortly.");
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

  // Throws on failure -- deliberately. "Mark complete" below is wrapped in
  // ActionButton, whose own useConfirmAction catches this and shows the
  // error inside the still-open confirm dialog. "Start" is a plain button
  // (see start() below), which needs its own try/catch instead: it must not
  // let a rejection here swallow the failure silently.
  async function advanceStatus(obligationId: string, nextStatus: string, version: number) {
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
        throw await userFacingErrorFromResponse(res, "save");
      }
      // GAP-CONTRACTS-DETAIL-06: track as Pending and poll.
      const prevStatus = obligations.find((o) => o.id === obligationId)?.status ?? "";
      setPendingMap((prev) => new Map(prev).set(obligationId, prevStatus));
      setMessage(`Status change to "${STATUS_LABEL[nextStatus] ?? nextStatus}" received — it will update shortly.`);
      router.refresh();
      for (const delay of POLL_DELAYS) {
        pollTimers.current.push(setTimeout(() => router.refresh(), delay));
      }
    } finally {
      setBusyId(null);
    }
  }

  // "Start" (pending -> in_progress) is a plain, unconfirmed button -- no
  // ActionButton wraps it to catch a rejection from advanceStatus, so this
  // needs its own error handling to avoid a silent failure.
  async function start(obligationId: string, version: number) {
    try {
      await advanceStatus(obligationId, "in_progress", version);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Update obligation failed");
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
              {/* GAP-CONTRACTS-DETAIL-06: Pending pill while write propagates. */}
              {pendingMap.has(o.id) ? (
                <span className="pill mut" aria-label="Status update pending" style={{ marginInlineStart: 4 }}>Pending</span>
              ) : null}
              {o.dueDate ? <span style={{ color: "var(--ink2)" }}> · due {formatIndianDate(o.dueDate)}</span> : null}
              {o.status !== "completed" ? (
                <>
                  {" "}
                  {o.status === "pending" ? (
                    <button
                      type="button"
                      className="btn ghost"
                      disabled={busyId === o.id}
                      onClick={() => void start(o.id, o.version ?? 1)}
                    >
                      Start
                    </button>
                  ) : null}{" "}
                  {/* Terminal transition (validateStatusTransition: completed -> [])
                      -- once marked complete, this obligation can never be reopened
                      through the app, so it goes behind a confirmation. */}
                  <ActionButton
                    className="btn ghost"
                    label="Mark complete"
                    disabled={busyId === o.id}
                    confirmTitle={`Mark "${o.title}" complete?`}
                    confirmDescription="This obligation cannot be reopened afterward."
                    confirmLabel="Yes, mark complete"
                    onConfirm={() => advanceStatus(o.id, "completed", o.version ?? 1)}
                  />
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
          Owner
          {/* GAP-CONTRACTS-DETAIL-03: pick the obligation owner by name via the
              shared identity-user adapter, instead of pasting a raw 36-char
              UUID. EntityPicker returns the selected user's id, which the
              server validates as a uuid (createObligationBody.ownerId). */}
          <EntityPicker
            value={ownerId || null}
            onChange={(v) => setOwnerId(Array.isArray(v) ? (v[0] ?? "") : (v ?? ""))}
            search={searchIdentityUsers}
            resolve={resolveIdentityUsers}
            placeholder="Search users by name…"
            aria-label="Owner"
          />
        </label>
        <button type="button" className="btn" disabled={creating} onClick={() => void createObligation()}>
          Add obligation
        </button>
      </div>

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
