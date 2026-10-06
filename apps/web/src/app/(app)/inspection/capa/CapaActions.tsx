"use client";

import { UserFacingError } from "@/lib/userFacingError";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { ActionButton } from "@/app/_components/ds";
import { useFormError } from "@/lib/useFormError";

type RowProps = { id: string; status: string };

export function CapaRowAction({ id, status }: RowProps) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState<string | undefined>();
  // GAP-INSPECTION-CAPA-03: use the app-standard useFormError so a failure
  // shows catalogued, clerk-safe copy instead of the raw response text
  // (res.text()) this used to throw.
  const formError = useFormError("capa");

  // CAPA_TRANSITIONS (services/inspection-service/.../capa/domain.ts) only
  // allows open|overdue -> in_progress and in_progress|overdue -> completed —
  // there is intentionally NO open -> completed edge (a CAPA must pass
  // through in_progress first). Every offered button corresponds to an
  // actually-legal transition.
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
      // No body / no Content-Type header: a Content-Type: application/json
      // header on a bodyless request is rejected by Fastify's JSON parser with
      // 400 FST_ERR_CTP_EMPTY_JSON_BODY (confirmed live). The /start route has
      // no zod body schema, so sending nothing is correct.
      const res = await fetch(`/api/proxy/v1/inspection/capa/${id}/start`, { method: "POST" });
      if (res.status !== 202 && !res.ok) {
        throw UserFacingError.from(await formError.fromResponse(res, "save"));
      }
      // GAP-INSPECTION-CAPA-04: honest async copy — the row changes once the
      // consumer runs, not immediately.
      setMessage("Start requested — the status will update shortly.");
      router.refresh();
    } catch (e) {
      setError(formError.fromException("save", e).message);
    } finally {
      setBusy(false);
    }
  }

  // GAP-INSPECTION-CAPA-01: completing a CAPA now requires real closure
  // remarks typed by the user; the hard-coded {source:'inspection-hub', note:
  // 'Marked complete from inspection hub'} evidence stub is gone. The remarks
  // become the evidenceOfClosure item the route requires (completeCapaSchema:
  // at least 1 item). ConfirmDialog gates submit until remarks are non-empty.
  async function completeWithRemarks(reason?: string) {
    const note = (reason ?? "").trim();
    if (!note) {
      // ConfirmDialog's requireReason already blocks this, but fail closed.
      throw new Error("Closure remarks are required.");
    }
    const res = await fetch(`/api/proxy/v1/inspection/capa/${id}/complete`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ evidenceOfClosure: [{ source: "user", note }] }),
    });
    if (res.status !== 202 && !res.ok) {
      throw UserFacingError.from(await formError.fromResponse(res, "save"));
    }
  }

  // GAP-INSPECTION-CAPA-02: effectiveness verification is a maker-checker
  // sign-off; it now requires an explicit confirmation with verification
  // remarks instead of firing on a single click. The verify route schema
  // (verifyCapaSchema) only carries effectivenessVerified, so the typed
  // remarks are a deliberate confirmation step (recorded here, not sent) —
  // see HUMAN REVIEW: persisting verifier remarks needs a backend field.
  async function verify(_reason?: string) {
    const res = await fetch(`/api/proxy/v1/inspection/capa/${id}/verify`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ effectivenessVerified: true }),
    });
    if (res.status !== 202 && !res.ok) {
      throw UserFacingError.from(await formError.fromResponse(res, "save"));
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
          <ActionButton
            label="Complete"
            className="btn ghost"
            confirmTitle="Complete this corrective action?"
            confirmDescription="Record what was done to close this CAPA. These remarks are saved as the closure evidence and cannot be left blank."
            confirmLabel="Mark complete"
            requireReason
            reasonLabel="Closure remarks"
            onConfirm={completeWithRemarks}
            onSuccess={() => {
              setMessage("Completion requested — the status will update shortly.");
              router.refresh();
            }}
          />
        ) : null}
        {canVerify ? (
          <ActionButton
            label="Verify"
            className="btn ghost"
            confirmTitle="Verify effectiveness?"
            confirmDescription="Confirm you have checked that this corrective action was effective. This is a sign-off step."
            confirmLabel="Confirm verification"
            requireReason
            reasonLabel="Verification remarks"
            onConfirm={verify}
            onSuccess={() => {
              setMessage("Verification requested — the status will update shortly.");
              router.refresh();
            }}
          />
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
