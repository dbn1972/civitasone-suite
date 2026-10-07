"use client";

/**
 * GuidedFileWizard (X11) — walks an officer through the full eOffice lifecycle
 * in one place instead of disjoint screens:
 *   1. Receipt (diarise DAK)  →  2. Open file  →  3. Note & submit for approval
 *   →  4. Draft outgoing (DFA)  →  5. Done.
 * Each step calls the real estab endpoints and threads the created ids forward.
 *
 * Resilience (GAP-ESTAB-WORKSPACE-01/02/05): the created file id is reflected
 * into the URL (?fileId=…&step=3) so a refresh or accidental navigation on
 * step 3+ re-hydrates the file (via the server GET, which re-checks the
 * caller's permission) instead of orphaning a draft file no one can find. A
 * beforeunload guard warns while a file exists but has not been submitted.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { toHumanError } from "@/lib/messages";
import { Button, Stepper } from "@/app/_components/ds";

type Operator = { id: string; employeeId: string; division: string; deskRole: string; active: boolean };
type Employee = { id: string; name?: string; employeeId?: string; designation?: string };

const STEPS = ["Receipt", "Open file", "Note & submit", "Draft outgoing", "Done"] as const;
const ALL_CLASSIFICATIONS = ["public", "confidential", "secret", "top_secret"] as const;
const COMM_TYPES = ["letter", "order", "memo", "notification", "circular", "do_letter"] as const;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const CLASSIFICATION_HELP: Record<string, string> = {
  public: "Open information; no clearance required.",
  confidential: "Routine official matters; limited circulation.",
  secret: "Sensitive matters; only officers cleared for secret may hold the file.",
  top_secret: "Highest sensitivity; only officers cleared for top secret may hold the file.",
};

function titleCaseEnum(v: string): string {
  return v.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

/**
 * POST helper (GAP-ESTAB-WORKSPACE-05). Parses the service's JSON error body
 * ({ code, message }) and surfaces the server's clerk-safe message when present
 * (apiClient documents HttpError messages as clerk-safe), capped and never
 * including the raw status or body; otherwise falls back to the catalogued
 * message naming the step that failed. Returns the parsed JSON on success.
 */
async function postJson(path: string, body: unknown, stepLabel: string): Promise<Record<string, unknown>> {
  const res = await fetch(path, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  if (!res.ok) {
    let serverMessage = "";
    try {
      const parsed = (await res.json()) as { message?: unknown };
      if (typeof parsed.message === "string") serverMessage = parsed.message.slice(0, 200);
    } catch {
      /* non-JSON body — fall back to the catalogued message */
    }
    if (serverMessage) throw new Error(`${stepLabel}: ${serverMessage}`);
    const human = toHumanError("save", { area: stepLabel });
    throw new Error(`${stepLabel}: ${human.what} ${human.next}`);
  }
  return (await res.json()) as Record<string, unknown>;
}

export interface GuidedFileWizardProps {
  /** Hydrate an in-progress file from the URL (GAP-ESTAB-WORKSPACE-01). */
  initialFileId?: string;
  /** 1-based step to resume on (clamped to the valid range). */
  initialStep?: number;
}

export function GuidedFileWizard({ initialFileId, initialStep }: GuidedFileWizardProps = {}) {
  const router = useRouter();
  const [step, setStep] = useState(() => {
    if (initialFileId && typeof initialStep === "number") {
      return Math.min(Math.max(initialStep - 1, 0), STEPS.length - 1);
    }
    return 0;
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [operators, setOperators] = useState<Operator[]>([]);
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [operatorsError, setOperatorsError] = useState(false);
  const [allowedClassifications, setAllowedClassifications] =
    useState<readonly string[]>(ALL_CLASSIFICATIONS);
  const [hydrating, setHydrating] = useState(Boolean(initialFileId));

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
  const [noteWasEntered, setNoteWasEntered] = useState(false);
  const [fileId, setFileId] = useState<string | null>(initialFileId ?? null);
  const [fileNo, setFileNo] = useState<string>("");

  const [submitted, setSubmitted] = useState(false);

  const [draftType, setDraftType] = useState("letter");
  const [draftSubject, setDraftSubject] = useState("");
  const [draftBody, setDraftBody] = useState("");
  const [recipientName, setRecipientName] = useState("");
  const [dfaNo, setDfaNo] = useState<string>("");

  const loadOperators = useCallback(async (signal?: AbortSignal) => {
    setOperatorsError(false);
    try {
      const res = await fetch("/api/proxy/v1/estab/operators?activeOnly=true&limit=500", { signal });
      if (!res.ok) { setOperatorsError(true); return; }
      setOperators(((await res.json()) as { data?: Operator[] }).data ?? []);
    } catch (err) {
      if (err instanceof Error && err.name === "AbortError") return;
      setOperatorsError(true);
    }
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    void loadOperators(controller.signal);
    // Employee directory (GAP-ESTAB-WORKSPACE-04) — resolve officer names, not raw ids.
    void (async () => {
      try {
        const res = await fetch("/api/proxy/v1/hrms/employees?limit=200", { signal: controller.signal });
        if (!res.ok) return;
        const body = (await res.json()) as { data?: Employee[] } | Employee[];
        setEmployees(Array.isArray(body) ? body : (body.data ?? []));
      } catch (err) {
        if (err instanceof Error && err.name === "AbortError") return;
        /* directory optional; falls back to employee id label */
      }
    })();
    // Allowed classifications for THIS officer (GAP-ESTAB-WORKSPACE-03) — the
    // server also enforces this on create/open; the UI only offers what the
    // officer may actually use.
    void (async () => {
      try {
        const res = await fetch("/api/proxy/v1/estab/files/classifications", { signal: controller.signal });
        if (!res.ok) return;
        const body = (await res.json()) as { allowed?: string[] };
        if (Array.isArray(body.allowed) && body.allowed.length > 0) {
          setAllowedClassifications(body.allowed);
          setClassification((c) => (body.allowed!.includes(c) ? c : body.allowed![0]));
        }
      } catch (err) {
        if (err instanceof Error && err.name === "AbortError") return;
        /* fall back to all; server still enforces */
      }
    })();
    return () => controller.abort();
  }, [loadOperators]);

  // Hydrate an in-progress file from the URL (GAP-ESTAB-WORKSPACE-01/02). The
  // GET re-checks the caller's permission server-side; if it fails we drop back
  // to a blank wizard rather than letting the user act on a file they can't see.
  useEffect(() => {
    if (!initialFileId) return;
    const controller = new AbortController();
    void (async () => {
      try {
        const res = await fetch(`/api/proxy/v1/estab/files/${initialFileId}`, { signal: controller.signal });
        if (!res.ok) {
          setFileId(null);
          setStep(0);
          setError(toHumanError("load", { area: "the file" }).what);
          return;
        }
        const f = (await res.json()) as {
          fileNo?: string;
          classification?: string;
          noteSheets?: Array<{ noteStatus?: string }>;
        };
        if (f.fileNo) setFileNo(f.fileNo);
        if (f.classification) setClassification(f.classification);
        const alreadySubmitted = (f.noteSheets ?? []).some((n) => n.noteStatus === "submitted");
        if (alreadySubmitted) { setSubmitted(true); setStep(4); }
      } catch (err) {
        if (err instanceof Error && err.name === "AbortError") return;
        setFileId(null);
        setStep(0);
      } finally {
        setHydrating(false);
      }
    })();
    return () => controller.abort();
  }, [initialFileId]);

  // beforeunload guard (GAP-ESTAB-WORKSPACE-01): warn while a file was created
  // but not yet submitted for approval, so the user doesn't silently orphan it.
  useEffect(() => {
    if (!fileId || submitted) return;
    const handler = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = "";
    };
    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }, [fileId, submitted]);

  const activeOps = useMemo(() => operators.filter((o) => o.active), [operators]);
  const empName = useCallback((employeeId: string): string => {
    const e = employees.find((x) => x.id === employeeId || x.employeeId === employeeId);
    return e?.name ?? "—";
  }, [employees]);

  const next = () => setStep((s) => Math.min(s + 1, STEPS.length - 1));

  // Step 1 → register DAK (or skip)
  const doReceipt = useCallback(async () => {
    setError(""); setBusy(true);
    try {
      if (subject.trim().length < 1) throw new Error("Subject is required.");
      if (useDak) {
        if (!dakNo.trim() || !fromAddress.trim()) throw new Error("DAK number and sender are required.");
        const r = await postJson("/api/proxy/v1/estab/inward", { dakNo: dakNo.trim(), fromAddress: fromAddress.trim(), subject: subject.trim() }, "Register receipt");
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
      const hasNote = initialNote.trim().length > 0;
      let r: Record<string, unknown>;
      if (inwardId) {
        r = await postJson(`/api/proxy/v1/estab/inward/${inwardId}/open-file`, {
          dept: dept.trim(), currentWith, classification, ...(hasNote ? { initialNote: initialNote.trim() } : {}),
        }, "Open file");
      } else {
        r = await postJson("/api/proxy/v1/estab/files", {
          subject: subject.trim(), dept: dept.trim(), currentWith, classification,
          ...(hasNote ? { initialNote: initialNote.trim() } : {}),
        }, "Open file");
      }
      // GAP-ESTAB-WORKSPACE-05: do not advance without a real file id — advancing
      // with null would leave step 3 with a disabled Submit and the only way
      // forward being Back, which risks creating a duplicate file.
      const newId = typeof r.id === "string" ? r.id : null;
      if (!newId) throw new Error("Open file: the file could not be created (no file reference returned). Please try again.");
      setFileId(newId);
      setNoteWasEntered(hasNote);
      // Reflect the id into the URL so a refresh/navigation re-hydrates it
      // (GAP-ESTAB-WORKSPACE-01) rather than orphaning a draft file.
      router.replace(`/estab/workspace?fileId=${encodeURIComponent(newId)}&step=3`);
      next();
    } catch (e) { setError(e instanceof Error ? e.message : "Failed"); } finally { setBusy(false); }
  }, [inwardId, dept, currentWith, classification, initialNote, subject, router]);

  // Step 3 → find the draft noting and submit for approval. Polls with
  // exponential backoff up to ~10s (GAP-ESTAB-WORKSPACE-02) because the opening
  // note is created asynchronously by the backend consumer.
  const doSubmit = useCallback(async () => {
    setError(""); setBusy(true);
    try {
      if (!fileId) throw new Error("No file to submit.");
      let notingId: string | null = null;
      const delays = [0, 400, 800, 1600, 3200, 4000]; // cumulative ≈ 10s
      for (const delay of delays) {
        if (delay) await new Promise((r) => setTimeout(r, delay));
        let res: Response;
        try {
          res = await fetch(`/api/proxy/v1/estab/files/${fileId}`);
        } catch {
          continue; // transient fetch failure — keep polling
        }
        if (!res.ok) continue;
        const f = (await res.json()) as { fileNo?: string; noteSheets?: Array<{ id: string; noteStatus?: string }> };
        if (f.fileNo) setFileNo(f.fileNo);
        const draft = (f.noteSheets ?? []).find((n) => n.noteStatus === "draft");
        notingId = draft?.id ?? null;
        if (notingId) break;
      }
      if (!notingId) throw new Error("Note & submit: the opening note isn't ready yet. Open the file to add or check the note, then submit.");
      await postJson(`/api/proxy/v1/estab/files/${fileId}/submit-for-approval`, { notingId }, "Submit for approval");
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
        }, "Create draft");
        setDfaNo(typeof r.dfaNo === "string" ? r.dfaNo : "");
      }
      next();
    } catch (e) { setError(e instanceof Error ? e.message : "Failed"); } finally { setBusy(false); }
  }, [fileId, draftType, draftSubject, draftBody, recipientName]);

  // 'Start another' (GAP-ESTAB-WORKSPACE-01): reset state and clear the URL
  // instead of a full window.location.reload().
  const startAnother = useCallback(() => {
    setStep(0); setError("");
    setUseDak(true); setDakNo(""); setFromAddress(""); setSubject(""); setInwardId(null);
    setDept(""); setClassification(allowedClassifications[0] ?? "confidential"); setCurrentWith("");
    setInitialNote(""); setNoteWasEntered(false); setFileId(null); setFileNo("");
    setSubmitted(false); setDraftType("letter"); setDraftSubject(""); setDraftBody("");
    setRecipientName(""); setDfaNo("");
    router.replace("/estab/workspace");
  }, [router, allowedClassifications]);

  const labelStyle = { display: "grid", gap: 4, fontSize: "0.8125rem" } as const;
  const fileLink = fileId ? `/estab/files/${fileId}` : null;

  if (hydrating) {
    return <p role="status" style={{ marginTop: 18, color: "var(--mut)" }}>Loading the file…</p>;
  }

  return (
    <div style={{ display: "grid", gap: 18, marginTop: 18 }}>
      <Stepper steps={STEPS} current={step} ariaLabel="Guided file progress" />

      {error ? (
        <p role="alert" style={{ color: "var(--bad)", fontSize: "0.875rem" }}>{error}</p>
      ) : null}

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
            <div><Button disabled={busy} onClick={() => void doReceipt()}>{busy ? "Saving…" : "Continue"}</Button></div>
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
                <select value={classification} onChange={(e) => setClassification(e.target.value)} aria-describedby="classification-help">
                  {ALL_CLASSIFICATIONS.filter((c) => allowedClassifications.includes(c)).map((c) => (
                    <option key={c} value={c}>{titleCaseEnum(c)}</option>
                  ))}
                </select>
                <span id="classification-help" style={{ fontSize: "0.75rem", color: "var(--mut)" }}>
                  {CLASSIFICATION_HELP[classification] ?? ""}
                </span>
              </label>
              <div style={labelStyle}><span>Mark to officer</span>
                {operatorsError ? (
                  <span role="status" style={{ fontSize: "0.8125rem", color: "var(--bad)" }}>
                    Officer list could not be loaded.{" "}
                    <button type="button" className="lnk" onClick={() => void loadOperators()}>Retry</button>
                  </span>
                ) : activeOps.length > 0 ? (
                  <label>
                    <span style={{ position: "absolute", width: 1, height: 1, padding: 0, margin: -1, overflow: "hidden", clip: "rect(0 0 0 0)", whiteSpace: "nowrap", border: 0 }}>Mark to officer</span>
                    <select value={currentWith} onChange={(e) => setCurrentWith(e.target.value)} style={{ width: "100%" }}>
                      <option value="">Select operator…</option>
                      {activeOps.map((o) => (
                        <option key={o.id} value={o.employeeId}>
                          {empName(o.employeeId)} · {o.division} · {titleCaseEnum(o.deskRole)}
                        </option>
                      ))}
                    </select>
                  </label>
                ) : (
                  <span style={{ fontSize: "0.8125rem", color: "var(--mut)" }}>
                    No file operators are enrolled yet.{" "}
                    <a className="lnk" href="/estab/operators">Enrol operators</a> to mark the file to someone.
                  </span>
                )}
              </div>
            </div>
            <label style={labelStyle}><span>Opening (yellow) note</span><textarea rows={3} value={initialNote} onChange={(e) => setInitialNote(e.target.value)} placeholder="Initial observation / proposal" /></label>
            <div style={{ display: "flex", gap: 8 }}>
              <Button variant="ghost" disabled={busy} onClick={() => setStep(0)}>Back</Button>
              <Button disabled={busy} onClick={() => void doOpenFile()}>{busy ? "Opening…" : "Open file & continue"}</Button>
            </div>
          </div>
        </div>
      ) : null}

      {/* Step 3 — Submit for approval */}
      {step === 2 ? (
        <div className="card"><div className="card-h"><h3>3 · Note &amp; submit for approval</h3></div>
          <div className="pad" style={{ display: "grid", gap: 12 }}>
            <p style={{ fontSize: "0.8125rem", color: "var(--mut)", margin: 0 }}>
              {noteWasEntered
                ? "Your opening note is on the file. "
                : "Add your opening note on the file first. "}
              Submitting routes it up the SO → US → DS chain; each level’s approval auto-signs a green note.
            </p>
            <div style={{ fontSize: "0.8125rem" }}>
              Classification: <b>{titleCaseEnum(classification)}</b>
            </div>
            {busy ? <p role="status" style={{ fontSize: "0.8125rem", color: "var(--mut)", margin: 0 }}>Waiting for the note to be created…</p> : null}
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
              <Button disabled={busy || !fileId} onClick={() => void doSubmit()}>{busy ? "Submitting…" : "Submit for approval"}</Button>
              {fileLink ? <a className="btn ghost" href={fileLink} target="_blank" rel="noopener noreferrer">Open the file</a> : null}
              <a className="btn ghost" href="/estab/approvals">Open approvals queue</a>
            </div>
          </div>
        </div>
      ) : null}

      {/* Step 4 — Draft outgoing */}
      {step === 3 ? (
        <div className="card"><div className="card-h"><h3>4 · Draft outgoing communication (optional)</h3></div>
          <div className="pad" style={{ display: "grid", gap: 12 }}>
            <p style={{ fontSize: "0.8125rem", color: "var(--mut)", margin: 0 }}>
              Draft the letter/order that will issue once approved. It enters the DFA lifecycle (approve → sign → dispatch with enclosures).
            </p>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: 12 }}>
              <label style={labelStyle}><span>Type</span>
                <select value={draftType} onChange={(e) => setDraftType(e.target.value)}>
                  {COMM_TYPES.map((t) => <option key={t} value={t}>{titleCaseEnum(t)}</option>)}
                </select>
              </label>
              <label style={labelStyle}><span>Recipient (external, optional)</span><input value={recipientName} onChange={(e) => setRecipientName(e.target.value)} /></label>
              <label style={{ ...labelStyle, gridColumn: "1 / -1" }}><span>Subject</span><input value={draftSubject} onChange={(e) => setDraftSubject(e.target.value)} /></label>
            </div>
            <label style={labelStyle}><span>Draft body</span><textarea rows={5} value={draftBody} onChange={(e) => setDraftBody(e.target.value)} /></label>
            <div style={{ display: "flex", gap: 8 }}>
              <Button variant="ghost" disabled={busy} onClick={() => void doDraft(true)}>Skip</Button>
              <Button disabled={busy} onClick={() => void doDraft(false)}>{busy ? "Drafting…" : "Create draft & finish"}</Button>
            </div>
          </div>
        </div>
      ) : null}

      {/* Step 5 — Done */}
      {step === 4 ? (
        <div className="card"><div className="card-h"><h3>✓ File created &amp; routed</h3></div>
          <div className="pad" style={{ display: "grid", gap: 10, fontSize: "0.875rem" }}>
            <div>File {fileNo ? <b>{fileNo}</b> : "created"} {submitted ? "submitted for approval (SO → US → DS)." : "created."}</div>
            <div>Classification: <b>{titleCaseEnum(classification)}</b></div>
            {dfaNo ? <div>Outgoing draft <b>{dfaNo}</b> created — manage it in the DFA workbench.</div> : null}
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 8 }}>
              {fileLink ? <a className="btn primary" href={fileLink}>Open the file</a> : null}
              <a className="btn ghost" href="/estab/approvals">Approvals queue</a>
              <a className="btn ghost" href="/estab/dfa">DFA workbench</a>
              <a className="btn ghost" href="/estab/inbox">My desk</a>
              <Button variant="ghost" onClick={startAnother}>Start another</Button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
