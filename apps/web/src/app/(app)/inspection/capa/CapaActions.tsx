"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

export type CapaRow = {
  id: string;
  status: string;
};

type RowProps = { id: string; status: string };

export function CapaRowAction({ id, status }: RowProps) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState<string | undefined>();

  const canComplete = status === "open" || status === "in_progress" || status === "overdue";
  const canVerify = status === "completed";

  if (!canComplete && !canVerify) {
    return <span style={{ color: "var(--ink2)", fontSize: 12 }}>—</span>;
  }

  async function complete() {
    setBusy(true);
    setError(undefined);
    setMessage("");
    try {
      const res = await fetch(`/api/proxy/v1/inspection/capa/${id}/complete`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          evidenceOfClosure: [{ source: "inspection-hub", note: "Marked complete from inspection hub" }],
        }),
      });
      if (res.status !== 202 && !res.ok) {
        throw new Error((await res.text()) || "Complete failed");
      }
      setMessage("CAPA completion accepted (queued).");
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "CAPA complete failed");
    } finally {
      setBusy(false);
    }
  }

  async function verify() {
    setBusy(true);
    setError(undefined);
    setMessage("");
    try {
      const res = await fetch(`/api/proxy/v1/inspection/capa/${id}/verify`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ effectivenessVerified: true }),
      });
      if (res.status !== 202 && !res.ok) {
        throw new Error((await res.text()) || "Verify failed");
      }
      setMessage("CAPA verification accepted (queued).");
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "CAPA verify failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
      <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
        {canComplete ? (
          <button type="button" className="btn ghost" disabled={busy} onClick={() => void complete()}>
            Complete
          </button>
        ) : null}
        {canVerify ? (
          <button type="button" className="btn ghost" disabled={busy} onClick={() => void verify()}>
            Verify
          </button>
        ) : null}
      </div>
      {message ? (
        <span role="status" aria-live="polite" style={{ fontSize: 11, color: "var(--good)" }}>
          {message}
        </span>
      ) : null}
      {error ? (
        <span role="alert" style={{ fontSize: 11, color: "var(--bad)" }}>
          {error}
        </span>
      ) : null}
    </div>
  );
}

type Props = { capas: CapaRow[] };

export function CapaActions({ capas }: Props) {
  const actionable = capas.filter(
    (row) => row.status === "open" || row.status === "in_progress" || row.status === "overdue" || row.status === "completed",
  );
  if (actionable.length === 0) return null;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 10, marginTop: 12 }}>
      {actionable.map((row) => (
        <div key={row.id} style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
          <span style={{ fontSize: 13, flex: 1 }}>{row.id.slice(0, 8)}… — {row.status}</span>
          <CapaRowAction id={row.id} status={row.status} />
        </div>
      ))}
    </div>
  );
}
