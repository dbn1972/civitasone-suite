"use client";

import { useCallback, useId, useState } from "react";
import { useRouter } from "next/navigation";
import { ConfirmDialog } from "../../../../_components/ds";

type Mode = "reply" | "refer";

function Dialog({
  mode,
  obsId,
  department,
  onClose,
}: {
  mode: Mode;
  obsId: string;
  department?: string;
  onClose: () => void;
}) {
  const router = useRouter();
  const titleId = useId();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // reply fields
  const [replyText, setReplyText] = useState("");
  const [respondedByRef, setRespondedByRef] = useState(department ?? "");
  // refer (draft-para) fields
  const [paraNo, setParaNo] = useState("");
  const [deptRef, setDeptRef] = useState(department ?? "");
  const [paraBody, setParaBody] = useState("");

  // Confirm gate: shown before submitting the irreversible action
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  function validateForm(): boolean {
    if (mode === "reply") {
      if (!replyText.trim() || !respondedByRef.trim()) {
        setFormError("Reply text and responder are required.");
        return false;
      }
    } else {
      if (!paraNo.trim() || !deptRef.trim() || !paraBody.trim()) {
        setFormError("Para no., department and para body are required.");
        return false;
      }
    }
    setFormError(null);
    return true;
  }

  function handleProceedClick() {
    if (!validateForm()) return;
    setError(null);
    setConfirmOpen(true);
  }

  const submit = useCallback(async (reason?: string) => {
    setError(null);
    setBusy(true);
    try {
      let url: string;
      let payload: Record<string, unknown>;
      if (mode === "reply") {
        url = `/api/proxy/v1/audit/observations/${obsId}/reply`;
        payload = {
          replyText: replyText.trim(),
          respondedByRef: respondedByRef.trim(),
          ...(reason ? { reason: reason.trim() } : {}),
        };
      } else {
        url = `/api/proxy/v1/audit/observations/${obsId}/draft-para`;
        payload = {
          paraNo: paraNo.trim(),
          deptRef: deptRef.trim(),
          body: paraBody.trim(),
          ...(reason ? { reason: reason.trim() } : {}),
        };
      }
      const res = await fetch(url, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (!res.ok) {
        const txt = await res.text();
        throw new Error(`Action failed (${res.status}). ${txt.slice(0, 160)}`);
      }
      setConfirmOpen(false);
      onClose();
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Action failed.");
    } finally {
      setBusy(false);
    }
  }, [mode, obsId, replyText, respondedByRef, paraNo, deptRef, paraBody, onClose, router]);

  return (
    <>
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        onKeyDown={(e) => { if (e.key === "Escape" && !busy && !confirmOpen) onClose(); }}
        style={{ position: "fixed", inset: 0, background: "rgba(16,24,40,.45)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 100, padding: 16 }}
      >
        <div className="card" style={{ width: "min(520px,100%)", maxHeight: "90vh", overflowY: "auto" }}>
          <div className="card-h"><h3 id={titleId}>{mode === "reply" ? "Record auditee reply (ATN)" : "Refer — draft audit para"}</h3></div>
          <div className="pad" style={{ display: "flex", flexDirection: "column", gap: 4 }}>
            {mode === "reply" ? (
              <>
                <label className="lbl" htmlFor="rep-by">Responded by (dept / officer ref)</label>
                <input id="rep-by" className="inp" value={respondedByRef} onChange={(e) => setRespondedByRef(e.target.value)} placeholder="Finance Wing" />
                <label className="lbl" htmlFor="rep-text">Compliance reply</label>
                <textarea id="rep-text" className="inp" rows={5} value={replyText} onChange={(e) => setReplyText(e.target.value)} placeholder="Auditee response / action taken note…" />
              </>
            ) : (
              <>
                <label className="lbl" htmlFor="para-no">Para no.</label>
                <input id="para-no" className="inp" value={paraNo} onChange={(e) => setParaNo(e.target.value)} placeholder="PARA-2026-014" />
                <label className="lbl" htmlFor="para-dept">Department ref</label>
                <input id="para-dept" className="inp" value={deptRef} onChange={(e) => setDeptRef(e.target.value)} placeholder="Finance Wing" />
                <label className="lbl" htmlFor="para-body">Para body</label>
                <textarea id="para-body" className="inp" rows={5} value={paraBody} onChange={(e) => setParaBody(e.target.value)} placeholder="Draft para to refer to the audit committee…" />
              </>
            )}
            {formError && <div role="alert" style={{ color: "var(--bad)", fontSize: 13, marginTop: 4 }}>{formError}</div>}
            <div style={{ display: "flex", gap: 8, justifyContent: "flex-end", marginTop: 12 }}>
              <button type="button" className="btn ghost" onClick={onClose} disabled={busy}>Cancel</button>
              <button type="button" className="btn primary" onClick={handleProceedClick} disabled={busy}>
                {mode === "reply" ? "Record reply" : "Refer para"}
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* Confirm gate — required reason before the irreversible audit action executes */}
      <ConfirmDialog
        open={confirmOpen}
        title={mode === "reply" ? "Record auditee reply?" : "Refer observation as audit para?"}
        description={
          mode === "reply"
            ? "Recording this reply is permanent and will be added to the audit trail. Provide a reason (e.g., ATN reference or officer order no.)."
            : "Raising an audit para is an irreversible compliance action. Provide the authorisation reference or reason for raising."
        }
        confirmLabel={mode === "reply" ? "Confirm & record" : "Confirm & refer"}
        requireReason
        reasonLabel={mode === "reply" ? "Reason / ATN reference (required)" : "Authorisation / reason for raising para (required)"}
        busy={busy}
        errorMessage={error ?? undefined}
        onConfirm={(reason) => void submit(reason)}
        onCancel={() => { if (!busy) { setConfirmOpen(false); setError(null); } }}
      />
    </>
  );
}

export function ObservationActions({ obsId, department }: { obsId: string; department?: string }) {
  const [mode, setMode] = useState<Mode | null>(null);
  return (
    <>
      <button type="button" className="btn ghost" onClick={() => setMode("refer")}>Refer</button>
      <button type="button" className="btn primary" onClick={() => setMode("reply")}>Record Reply</button>
      {mode && <Dialog mode={mode} obsId={obsId} department={department} onClose={() => setMode(null)} />}
    </>
  );
}
