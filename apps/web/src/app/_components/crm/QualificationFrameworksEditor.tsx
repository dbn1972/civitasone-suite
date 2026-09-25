"use client";
/**
 * QualificationFrameworksEditor — LQ-001 admin. CRUD for per-business-line
 * qualification frameworks and their questions. GET on mount; each framework
 * card saves independently (POST when new, PUT when it has an id) and can be
 * deleted behind a ConfirmDialog. On a failed load we show the saved-info badge
 * and never fabricate an empty framework set as fact (source==="error").
 */
import { useEffect, useId, useRef, useState } from "react";
import { DataSourceBadge } from "../DataSourceBadge";
import { ConfirmDialog, EmptyState, Button } from "../ds";
import {
  getFrameworks,
  createFramework,
  updateFramework,
  deleteFramework,
  type QualificationFramework,
  type QualQuestion,
  type LqSource,
} from "@/lib/crm/leadQualification";

const inputStyle = { width: "100%", padding: 8, minHeight: 40, borderRadius: 8, border: "1px solid var(--line)" } as const;
const labelStyle = { display: "block", fontSize: 12, color: "var(--muted)", marginBottom: 4, fontWeight: 600 } as const;

/**
 * services/crm-service leads/qualification-validators.ts requires a
 * question's weight to be z.number().int().min(0).max(100) -- round + clamp
 * here so a partial or fractional entry (this input allowed any 0.5-stepped
 * value with no upper bound) never lands something the backend rejects.
 */
function sanitizeNumber(raw: string): number {
  const n = Math.round(Number(raw));
  if (!Number.isFinite(n) || n < 0) return 0;
  return Math.min(100, n);
}

function blankFramework(): QualificationFramework {
  return { name: "", businessLine: "", active: true, questions: [] };
}

export function QualificationFrameworksEditor() {
  const [frameworks, setFrameworks] = useState<QualificationFramework[]>([]);
  const [source, setSource] = useState<LqSource | "loading">("loading");
  const [busyIdx, setBusyIdx] = useState<number | null>(null);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [confirmIdx, setConfirmIdx] = useState<number | null>(null);
  const headingId = useId();

  // Stable per-row React keys, independent of array position -- see
  // ElectFlexBenefitForm.tsx (apps/web/src/app/(app)/hr/payroll/flex-benefits)
  // for the full rationale. Two levels here:
  //  - Outer (frameworks): a saved framework already keys on its real
  //    `fw.id`; only an unsaved draft (no id yet) fell back to the array
  //    index, so removing one unsaved draft while a later one was focused
  //    shifted it into the removed draft's key.
  //  - Inner (questions): QualQuestion carries no id at all, so every
  //    framework's question list was fully index-keyed.
  // Both carry no server/domain id suitable to send back to the API, so
  // parallel id lists (regenerated whenever load() replaces the whole
  // frameworks array, and kept in step by the mutators below) stand in.
  const nextFrameworkRowId = useRef(0);
  const [frameworkRowIds, setFrameworkRowIds] = useState<number[]>([]);
  const frameworkKeyFor = (fi: number) => frameworkRowIds[fi] ?? fi;

  const nextQuestionRowId = useRef(0);
  const [questionRowIds, setQuestionRowIds] = useState<number[][]>([]);
  const questionKeyFor = (fi: number, qi: number) => questionRowIds[fi]?.[qi] ?? qi;

  async function load(isLive: () => boolean = () => true) {
    setSource("loading");
    const { data, source: s } = await getFrameworks();
    if (!isLive()) return;
    setFrameworks(data);
    setFrameworkRowIds(data.map(() => nextFrameworkRowId.current++));
    setQuestionRowIds(data.map((f) => f.questions.map(() => nextQuestionRowId.current++)));
    setSource(s);
  }

  useEffect(() => {
    let live = true;
    void load(() => live);
    return () => { live = false; };
  }, []);

  function update(idx: number, patch: Partial<QualificationFramework>) {
    setFrameworks((prev) => prev.map((f, i) => (i === idx ? { ...f, ...patch } : f)));
  }

  function updateQuestion(fi: number, qi: number, patch: Partial<QualQuestion>) {
    setFrameworks((prev) =>
      prev.map((f, i) =>
        i === fi ? { ...f, questions: f.questions.map((q, j) => (j === qi ? { ...q, ...patch } : q)) } : f,
      ),
    );
  }

  function addQuestion(fi: number) {
    setFrameworks((prev) =>
      prev.map((f, i) => (i === fi ? { ...f, questions: [...f.questions, { text: "", weight: 1 }] } : f)),
    );
    setQuestionRowIds((prev) => prev.map((ids, i) => (i === fi ? [...ids, nextQuestionRowId.current++] : ids)));
  }

  function removeQuestion(fi: number, qi: number) {
    setFrameworks((prev) =>
      prev.map((f, i) => (i === fi ? { ...f, questions: f.questions.filter((_, j) => j !== qi) } : f)),
    );
    setQuestionRowIds((prev) => prev.map((ids, i) => (i === fi ? ids.filter((_, j) => j !== qi) : ids)));
  }

  async function save(idx: number) {
    setMessage("");
    setError("");
    const fw = frameworks[idx];
    if (!fw.name.trim() || !fw.businessLine.trim()) {
      setError("A framework needs a name and a business line before it can be saved.");
      return;
    }
    setBusyIdx(idx);
    try {
      if (fw.id) await updateFramework(fw.id, fw);
      else await createFramework(fw);
      setMessage(`Framework "${fw.name}" saved.`);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not save the framework.");
    } finally {
      setBusyIdx(null);
    }
  }

  async function confirmDelete(idx: number) {
    const fw = frameworks[idx];
    setMessage("");
    setError("");
    if (!fw.id) {
      // Unsaved draft — just drop it from the list.
      setFrameworks((prev) => prev.filter((_, i) => i !== idx));
      setFrameworkRowIds((ids) => ids.filter((_, i) => i !== idx));
      setQuestionRowIds((ids) => ids.filter((_, i) => i !== idx));
      setConfirmIdx(null);
      return;
    }
    setBusyIdx(idx);
    try {
      await deleteFramework(fw.id);
      setMessage(`Framework "${fw.name}" deleted.`);
      setConfirmIdx(null);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not delete the framework.");
    } finally {
      setBusyIdx(null);
    }
  }

  if (source === "loading") {
    return (
      <p role="status" aria-live="polite" style={{ fontSize: 13, color: "var(--muted)" }}>
        Loading qualification frameworks…
      </p>
    );
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <div className="card">
        <div className="card-h">
          <h3 id={headingId}>Qualification frameworks</h3>
          {source === "error" ? <DataSourceBadge source="error" /> : null}
        </div>
        {message ? <p role="status" aria-live="polite" style={{ fontSize: 13, color: "#047857", padding: "0 12px" }}>{message}</p> : null}
        {error ? <p role="alert" aria-live="assertive" style={{ fontSize: 13, color: "#b42318", padding: "0 12px" }}>{error}</p> : null}
        <div className="pad">
          <Button
            type="button"
            variant="ghost"
            onClick={() => {
              setFrameworks((prev) => [...prev, blankFramework()]);
              setFrameworkRowIds((ids) => [...ids, nextFrameworkRowId.current++]);
              setQuestionRowIds((ids) => [...ids, []]);
            }}
          >
            + Add framework
          </Button>
        </div>
      </div>

      {frameworks.length === 0 ? (
        <EmptyState
          icon="🧭"
          title="No frameworks yet"
          message="Add a qualification framework for a business line, then add the questions that decide whether a lead qualifies."
        />
      ) : (
        frameworks.map((fw, fi) => (
          <div className="card" key={fw.id ?? frameworkKeyFor(fi)} aria-label={`Framework ${fi + 1}`}>
            <div className="pad" style={{ display: "grid", gap: 14 }}>
              <div style={{ display: "grid", gap: 14, gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))" }}>
                <div>
                  <label htmlFor={`${headingId}-name-${fi}`} style={labelStyle}>Name</label>
                  <input id={`${headingId}-name-${fi}`} value={fw.name} onChange={(e) => update(fi, { name: e.target.value })} placeholder="e.g. BANT — Government sales" style={inputStyle} />
                </div>
                <div>
                  <label htmlFor={`${headingId}-bl-${fi}`} style={labelStyle}>Business line</label>
                  <input id={`${headingId}-bl-${fi}`} value={fw.businessLine} onChange={(e) => update(fi, { businessLine: e.target.value })} placeholder="e.g. government, psu" style={inputStyle} />
                </div>
                <div>
                  <label style={{ ...labelStyle, marginTop: 24 }}>
                    <input type="checkbox" checked={fw.active} onChange={(e) => update(fi, { active: e.target.checked })} style={{ marginRight: 6 }} />
                    Active
                  </label>
                </div>
              </div>

              <div>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                  <h4 style={{ margin: "8px 0" }}>Questions</h4>
                  <Button type="button" variant="ghost" size="sm" onClick={() => addQuestion(fi)}>+ Add question</Button>
                </div>
                {fw.questions.length === 0 ? (
                  <p style={{ fontSize: 13, color: "var(--muted)" }}>No questions yet.</p>
                ) : (
                  <table className="tbl">
                    <thead>
                      <tr>
                        <th>Question</th>
                        <th style={{ textAlign: "right" }}>Weight</th>
                        <th><span className="sr-only">Actions</span></th>
                      </tr>
                    </thead>
                    <tbody>
                      {fw.questions.map((q, qi) => (
                        <tr key={q.id ?? questionKeyFor(fi, qi)}>
                          <td>
                            <label className="sr-only" htmlFor={`${headingId}-q-${fi}-${qi}`}>Question {qi + 1} text</label>
                            <input id={`${headingId}-q-${fi}-${qi}`} value={q.text} onChange={(e) => updateQuestion(fi, qi, { text: e.target.value })} style={inputStyle} />
                          </td>
                          <td className="num">
                            <label className="sr-only" htmlFor={`${headingId}-w-${fi}-${qi}`}>Question {qi + 1} weight</label>
                            <input
                              id={`${headingId}-w-${fi}-${qi}`}
                              type="number" min={0} max={100} step={1}
                              value={Number.isFinite(q.weight) ? q.weight : ""}
                              aria-invalid={Number.isFinite(q.weight) ? undefined : true}
                              onChange={(e) => updateQuestion(fi, qi, { weight: sanitizeNumber(e.target.value) })}
                              style={{ width: 80, padding: 6, minHeight: 40, borderRadius: 8, border: "1px solid var(--line)", textAlign: "right" }}
                            />
                          </td>
                          <td>
                            <Button type="button" variant="ghost" size="sm" onClick={() => removeQuestion(fi, qi)} aria-label={`Remove question ${qi + 1}`}>Remove</Button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </div>

              <div style={{ display: "flex", gap: 8 }}>
                <Button type="button" disabled={busyIdx === fi} onClick={() => void save(fi)}>
                  {busyIdx === fi ? "Saving…" : "Save framework"}
                </Button>
                <Button type="button" variant="danger" disabled={busyIdx === fi} onClick={() => setConfirmIdx(fi)}>
                  Delete
                </Button>
              </div>
            </div>
          </div>
        ))
      )}

      <ConfirmDialog
        open={confirmIdx !== null}
        title="Delete this framework?"
        danger
        description="Removing a qualification framework stops it being offered on lead detail screens. This is recorded in the audit trail."
        confirmLabel="Delete framework"
        busy={busyIdx !== null && busyIdx === confirmIdx}
        onCancel={() => setConfirmIdx(null)}
        onConfirm={() => { if (confirmIdx !== null) void confirmDelete(confirmIdx); }}
      />
    </div>
  );
}
