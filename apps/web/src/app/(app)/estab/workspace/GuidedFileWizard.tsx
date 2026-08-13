"use client";

/**
 * GuidedFileWizard (X11) — walks an officer through the full eOffice lifecycle
 * in one place instead of disjoint screens:
 *   1. Receipt (diarise DAK)  →  2. Open file  →  3. Note & submit for approval
 *   →  4. Draft outgoing (DFA)  →  5. Done.
 * Each step calls the real estab endpoints and threads the created ids forward.
 */

import { useCallback, useEffect, useMemo, useState } from "react";

type Operator = { id: string; employeeId: string; division: string; deskRole: string; active: boolean };

const STEPS = ["Receipt", "Open file", "Note & submit", "Draft outgoing", "Done"] as const;
const CLASSIFICATIONS = ["public", "confidential", "secret", "top_secret"] as const;
const COMM_TYPES = ["letter", "order", "memo", "notification", "circular", "do_letter"] as const;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

async function postJson(path: string, body: unknown): Promise<Record<string, unknown>> {
  const res = await fetch(path, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  if (!res.ok) throw new Error((await res.text()) || `Request failed (${res.status})`);
  return (await res.json()) as Record<string, unknown>;
}

export function GuidedFileWizard() {
  const [step, setStep] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [operators, setOperators] = useState<Operator[]>([]);

  // Threaded state
  const [useDak, setUseDak] = useState(true);
  const [dakNo, setDakNo] = useState("");
  const [fromAddress, setFromAddress] = useState("");
  const [subject, setSubject] = useState("");
  const [inwardId, setInwardId] = useState<string | null>(null);

  const [dept, setDept] = useState("");
  const [classification, setClassification] = useState("confidential");
  const [currentWith, setCurrentWith] = useState("");
  const [initialNote, setInitialNote] = useState("");
  const [fileId, setFileId] = useState<string | null>(null);
  const [fileNo, setFileNo] = useState<string>("");

  const [submitted, setSubmitted] = useState(false);

  const [draftType, setDraftType] = useState("letter");
  const [draftSubject, setDraftSubject] = useState("");
  const [draftBody, setDraftBody] = useState("");
  const [recipientName, setRecipientName] = useState("");
  const [dfaNo, setDfaNo] = useState<string>("");

  useEffect(() => {
    void (async () => {
      try {
        const res = await fetch("/api/proxy/v1/estab/operators?activeOnly=true&limit=500");
        if (res.ok) setOperators(((await res.json()) as { data?: Operator[] }).data ?? []);
      } catch { /* picker optional */ }
    })();
  }, []);

  const activeOps = useMemo(() => operators.filter((o) => o.active), [operators]);

  const next = () => setStep((s) => Math.min(s + 1, STEPS.length - 1));

  // Step 1 → register DAK (or skip)
  const doReceipt = useCallback(async () => {
    setError(""); setBusy(true);
    try {
      if (subject.trim().length < 1) throw new Error("Subject is required.");
      if (useDak) {
        if (!dakNo.trim() || !fromAddress.trim()) throw new Error("DAK number and sender are required.");
        const r = await postJson("/api/proxy/v1/estab/inward", { dakNo: dakNo.trim(), fromAddress: fromAddress.trim(), subject: subject.trim() });
        setInwardId(typeof r.id === "string" ? r.id : null);
      } else {
        setInwardId(null);
      }
      next();
    } catch (e) { setError(e instanceof Error ? e.message : "Failed"); } finally { setBusy(false); }
  }, [useDak, dakNo, fromAddress, subject]);

  // Step 2 → open/create the file
  const doOpenFile = useCallback(async () => {
    setError(""); setBusy(true);
    try {
      if (!dept.trim()) throw new Error("Department is required.");
      if (!UUID_RE.test(currentWith)) throw new Error("Select the officer to hold the file.");
      let r: Record<string, unknown>;
      if (inwardId) {
        r = await postJson(`/api/proxy/v1/estab/inward/${inwardId}/open-file`, {
          dept: dept.trim(), currentWith, classification, ...(initialNote.trim() ? { initialNote: initialNote.trim() } : {}),
        });
      } else {
        r = await postJson("/api/proxy/v1/estab/files", {
          subject: subject.trim(), dept: dept.trim(), currentWith, classification,
          ...(initialNote.trim() ? { initialNote: initialNote.trim() } : {}),
        });
      }
      setFileId(typeof r.id === "string" ? r.id : null);
      next();
    } catch (e) { setError(e instanceof Error ? e.message : "Failed"); } finally { setBusy(false); }
  }, [inwardId, dept, currentWith, classification, initialNote, subject]);

  // Step 3 → find the draft noting and submit for approval
  const doSubmit = useCallback(async () => {
    setError(""); setBusy(true);
    try {
      if (!fileId) throw new Error("No file to submit.");
      // Fetch the file to resolve the draft noting created on open.
      let notingId: string | null = null;
      for (let attempt = 0; attempt < 4 && !notingId; attempt++) {
        const res = await fetch(`/api/proxy/v1/estab/files/${fileId}`);
        if (res.ok) {
          const f = (await res.json()) as { fileNo?: string; noteSheets?: Array<{ id: string; noteType?: string; noteStatus?: string }> };
          if (f.fileNo) setFileNo(f.fileNo);
          const draft = (f.noteSheets ?? []).find((n) => n.noteStatus === "draft");
          notingId = draft?.id ?? null;
        }
        if (!notingId) await new Promise((r) => setTimeout(r, 700));
      }
      if (!notingId) throw new Error("No draft note found yet — add a note on the file, then submit.");
      await postJson(`/api/proxy/v1/estab/files/${fileId}/submit-for-approval`, { notingId });
      setSubmitted(true);
      next();
    } catch (e) { setError(e instanceof Error ? e.message : "Failed"); } finally { setBusy(false); }
  }, [fileId]);

  // Step 4 → draft outgoing communication (DFA), optional
  const doDraft = useCallback(async (skip: boolean) => {
    setError(""); setBusy(true);
    try {
      if (!skip) {
        if (draftSubject.trim().length < 3 || draftBody.trim().length < 1) throw new Error("Draft subject and body are required.");
        const r = await postJson("/api/proxy/v1/estab/dfa", {
          fileId, communicationType: draftType, subject: draftSubject.trim(), body: draftBody.trim(),
          ...(recipientName.trim() ? { recipientName: recipientName.trim() } : {}),
        });
        setDfaNo(typeof r.dfaNo === "string" ? r.dfaNo : "");
      }
      next();
    } catch (e) { setError(e instanceof Error ? e.message : "Failed"); } finally { setBusy(false); }
  }, [fileId, draftType, draftSubject, draftBody, recipientName]);

  const labelStyle = { display: "grid", gap: 4, fontSize: "0.8125rem" } as const;

  return (
    <div style={{ display: "grid", gap: 18, marginTop: 18 }}>
      {/* Stepper */}
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
        {STEPS.map((s, i) => (
          <div key={s} style={{
            display: "flex", alignItems: "center", gap: 6, fontSize: "0.8125rem",
            color: i === step ? "#0f172a" : i < step ? "var(--good)" : "#94a3b8", fontWeight: i === step ? 600 : 400,
          }}>
            <span style={{
              width: 22, height: 22, borderRadius: "50%", display: "grid", placeItems: "center", fontSize: 12,
              background: i < step ? "var(--good)" : i === step ? "#4f46e5" : "#e2e8f0",
              color: i <= step ? "#fff" : "#64748b",
            }}>{i < step ? "✓" : i + 1}</span>
            {s}{i < STEPS.length - 1 ? <span aria-hidden="true" style={{ color: "#cbd5e1" }}>›</span> : null}
          </div>
        ))}
      </div>

      {error ? <p style={{ color: "var(--bad)", fontSize: "0.875rem" }}>{error}</p> : null}

      {/* Step 1 — Receipt */}
      {step === 0 ? (
        <div className="card"><div className="card-h"><h3>1 · Receipt (DAK)</h3></div>
          <div className="pad" style={{ display: "grid", gap: 12 }}>
            <label style={{ display: "flex", gap: 8, alignItems: "center", fontSize: "0.8125rem" }}>
              <input type="checkbox" checked={useDak} onChange={(e) => setUseDak(e.target.checked)} />
              <span>This file starts from an inward receipt (DAK)</span>
            </label>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: 12 }}>
              {useDak ? (
                <>
                  <label style={labelStyle}><span>DAK number</span><input value={dakNo} onChange={(e) => setDakNo(e.target.value)} placeholder="DAK/2026/001" /></label>
                  <label style={labelStyle}><span>From (sender)</span><input value={fromAddress} onChange={(e) => setFromAddress(e.target.value)} placeholder="Ministry / citizen / vendor" /></label>
                </>
              ) : null}
              <label style={{ ...labelStyle, gridColumn: "1 / -1" }}><span>Subject</span><input value={subject} onChange={(e) => setSubject(e.target.value)} /></label>
            </div>
            <div><button className="btn primary" disabled={busy} onClick={() => void doReceipt()}>{busy ? "Saving…" : "Continue"}</button></div>
          </div>
        </div>
      ) : null}

      {/* Step 2 — Open file */}
      {step === 1 ? (
        <div className="card"><div className="card-h"><h3>2 · Open file</h3></div>
          <div className="pad" style={{ display: "grid", gap: 12 }}>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: 12 }}>
              <label style={labelStyle}><span>Department</span><input value={dept} onChange={(e) => setDept(e.target.value)} placeholder="e.g. Administration" /></label>
              <label style={labelStyle}><span>Classification</span>
                <select value={classification} onChange={(e) => setClassification(e.target.value)}>
                  {CLASSIFICATIONS.map((c) => <option key={c} value={c}>{c.replace(/_/g, " ")}</option>)}
                </select>
              </label>
              <label style={labelStyle}><span>Mark to officer</span>
                {activeOps.length > 0 ? (
                  <select value={currentWith} onChange={(e) => setCurrentWith(e.target.value)}>
                    <option value="">Select operator…</option>
                    {activeOps.map((o) => <option key={o.id} value={o.employeeId}>{o.employeeId.slice(0, 8)}… · {o.division} · {o.deskRole}</option>)}
                  </select>
                ) : (
                  <input value={currentWith} onChange={(e) => setCurrentWith(e.target.value)} placeholder="officer UUID" />
                )}
              </label>
            </div>
            <label style={labelStyle}><span>Opening (yellow) note</span><textarea rows={3} value={initialNote} onChange={(e) => setInitialNote(e.target.value)} placeholder="Initial observation / proposal" /></label>
            <div style={{ display: "flex", gap: 8 }}>
              <button className="btn ghost" disabled={busy} onClick={() => setStep(0)}>Back</button>
              <button className="btn primary" disabled={busy} onClick={() => void doOpenFile()}>{busy ? "Opening…" : "Open file & continue"}</button>
            </div>
          </div>
        </div>
      ) : null}

      {/* Step 3 — Submit for approval */}
      {step === 2 ? (
        <div className="card"><div className="card-h"><h3>3 · Note &amp; submit for approval</h3></div>
          <div className="pad" style={{ display: "grid", gap: 12 }}>
            <p style={{ fontSize: "0.8125rem", color: "#64748b", margin: 0 }}>
              The opening note is on the file{fileId ? "" : " (open the file first)"}. Submitting routes it up the SO → US → DS chain;
              each level’s approval auto-signs a green note.
            </p>
            <div style={{ display: "flex", gap: 8 }}>
              <button className="btn primary" disabled={busy || !fileId} onClick={() => void doSubmit()}>{busy ? "Submitting…" : "Submit for approval"}</button>
              <a className="btn ghost" href="/estab/approvals">Open approvals queue</a>
            </div>
          </div>
        </div>
      ) : null}

      {/* Step 4 — Draft outgoing */}
      {step === 3 ? (
        <div className="card"><div className="card-h"><h3>4 · Draft outgoing communication (optional)</h3></div>
          <div className="pad" style={{ display: "grid", gap: 12 }}>
            <p style={{ fontSize: "0.8125rem", color: "#64748b", margin: 0 }}>
              Draft the letter/order that will issue once approved. It enters the DFA lifecycle (approve → sign → dispatch with enclosures).
            </p>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: 12 }}>
              <label style={labelStyle}><span>Type</span>
                <select value={draftType} onChange={(e) => setDraftType(e.target.value)}>
                  {COMM_TYPES.map((t) => <option key={t} value={t}>{t.replace(/_/g, " ")}</option>)}
                </select>
              </label>
              <label style={labelStyle}><span>Recipient (external, optional)</span><input value={recipientName} onChange={(e) => setRecipientName(e.target.value)} /></label>
              <label style={{ ...labelStyle, gridColumn: "1 / -1" }}><span>Subject</span><input value={draftSubject} onChange={(e) => setDraftSubject(e.target.value)} /></label>
            </div>
            <label style={labelStyle}><span>Draft body</span><textarea rows={5} value={draftBody} onChange={(e) => setDraftBody(e.target.value)} /></label>
            <div style={{ display: "flex", gap: 8 }}>
              <button className="btn ghost" disabled={busy} onClick={() => void doDraft(true)}>Skip</button>
              <button className="btn primary" disabled={busy} onClick={() => void doDraft(false)}>{busy ? "Drafting…" : "Create draft & finish"}</button>
            </div>
          </div>
        </div>
      ) : null}

      {/* Step 5 — Done */}
      {step === 4 ? (
        <div className="card"><div className="card-h"><h3>✓ File created &amp; routed</h3></div>
          <div className="pad" style={{ display: "grid", gap: 10, fontSize: "0.875rem" }}>
            <div>File {fileNo ? <b>{fileNo}</b> : "created"} {submitted ? "submitted for approval (SO → US → DS)." : "created."}</div>
            {dfaNo ? <div>Outgoing draft <b>{dfaNo}</b> created — manage it in the DFA workbench.</div> : null}
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 8 }}>
              {fileId ? <a className="btn primary" href={`/estab/files/${fileId}`}>Open the file</a> : null}
              <a className="btn ghost" href="/estab/approvals">Approvals queue</a>
              <a className="btn ghost" href="/estab/dfa">DFA workbench</a>
              <a className="btn ghost" href="/estab/inbox">My desk</a>
              <button className="btn ghost" onClick={() => window.location.reload()}>Start another</button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
