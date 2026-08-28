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

  // CAPA_TRANSITIONS (services/inspection-service/.../capa/domain.ts) only
  // allows open|overdue -> in_progress and in_progress|overdue -> completed —
  // there is intentionally NO open -> completed edge (a CAPA must pass
  // through in_progress first). Every offered button below corresponds to an
  // actually-legal transition: showing "Complete" for status "open" (as this
  // used to) always failed server-side with INVALID_TRANSITION, silently,
  // because the 202 had already been returned before the async consumer ran.
  const canStart = status === "open";
  const canComplete = status === "in_progress" || status === "overdue";
  const canVerify = status === "completed";

  if (!canStart && !canComplete && !canVerify) {
    return <span style={{ color: "var(--ink2)", fontSize: 12 }}>—</span>;
  }

  async function start() {
    setBusy(true);
    setError(undefined);
    setMessage("");
    try {
      // No body on this request — deliberately no Content-Type header either.
      // A `Content-Type: application/json` header with an empty body survives
      // the /api/proxy catch-all verbatim (it forwards whatever content-type
      // header the browser sent, regardless of whether there was a body) and
      // reaches Fastify's default JSON parser, which rejects an empty body
      // under that content-type with 400 FST_ERR_CTP_EMPTY_JSON_BODY —
      // confirmed live against the real service, not just inferred. Sending
      // no Content-Type here means no body is sent at all, which the route
      // (no zod schema on req.body) accepts correctly.
      const res = await fetch(`/api/proxy/v1/inspection/capa/${id}/start`, {
        method: "POST",
      });
      if (res.status !== 202 && !res.ok) {
        throw new Error((await res.text()) || "Start failed");
      }
      setMessage("CAPA start accepted (queued).");
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "CAPA start failed");
    } finally {
      setBusy(false);
    }
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
        {canStart ? (
          <button type="button" className="btn ghost" disabled={busy} onClick={() => void start()}>
            Start
          </button>
        ) : null}
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
