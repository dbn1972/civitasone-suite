"use client";

import { useCallback, useId, useState } from "react";
import { useRouter } from "next/navigation";

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

  const submit = useCallback(async () => {
    setError(null);
    setBusy(true);
    try {
      let url: string;
      let payload: Record<string, unknown>;
      if (mode === "reply") {
        if (!replyText.trim() || !respondedByRef.trim()) {
          throw new Error("Reply text and responder are required.");
        }
        url = `/api/proxy/v1/audit/observations/${obsId}/reply`;
        payload = { replyText: replyText.trim(), respondedByRef: respondedByRef.trim() };
      } else {
        if (!paraNo.trim() || !deptRef.trim() || !paraBody.trim()) {
          throw new Error("Para no., department and para body are required.");
        }
        url = `/api/proxy/v1/audit/observations/${obsId}/draft-para`;
        payload = { paraNo: paraNo.trim(), deptRef: deptRef.trim(), body: paraBody.trim() };
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
      onClose();
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Action failed.");
    } finally {
      setBusy(false);
    }
  }, [mode, obsId, replyText, respondedByRef, paraNo, deptRef, paraBody, onClose, router]);

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby={titleId}
      onKeyDown={(e) => { if (e.key === "Escape" && !busy) onClose(); }}
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
          {error && <div role="alert" style={{ color: "#b42318", fontSize: 13, marginTop: 4 }}>{error}</div>}
          <div style={{ display: "flex", gap: 8, justifyContent: "flex-end", marginTop: 12 }}>
            <button type="button" className="btn ghost" onClick={onClose} disabled={busy}>Cancel</button>
            <button type="button" className="btn primary" onClick={() => void submit()} disabled={busy}>
              {busy ? "Saving…" : mode === "reply" ? "Record reply" : "Refer para"}
            </button>
          </div>
        </div>
      </div>
    </div>
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
